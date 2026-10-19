import type { LLMClient, Message } from "./schema.js";
import { buildChunkNotesPrompt, buildMergeNotesPrompt } from "./prompts.js";

export const DEFAULT_CHUNK_THRESHOLD_CHARS = 12000;
export const DEFAULT_CHUNK_TARGET_CHARS = 6000;

export interface Chunk {
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface SummaryResult {
  mode: "direct" | "notes";
  text: string;
}

/**
 * Splits conversation turns into chunks under the target size (Gotcha #11).
 * Oversized single messages are split into (part k/n) chunks on line boundaries.
 */
export function chunkConversation(
  messages: Message[],
  targetChars: number = DEFAULT_CHUNK_TARGET_CHARS
): Chunk[] {
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentChars = 0;
  let startIndex = 0;

  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    const prefix = `${msg.role.toUpperCase()}: `;
    const fullMsgText = prefix + msg.content;

    // Check if this single message is oversized
    if (fullMsgText.length > targetChars) {
      // Flush any accumulated lines
      if (currentLines.length > 0) {
        chunks.push({
          text: currentLines.join("\n\n"),
          startIndex,
          endIndex: idx - 1,
        });
        currentLines = [];
        currentChars = 0;
      }

      // Partition the single oversized message
      const totalParts = Math.ceil(fullMsgText.length / targetChars);
      const lines = msg.content.split("\n");
      let partLines: string[] = [];
      let partChars = 0;
      let partIndex = 1;

      for (const line of lines) {
        if (partChars + line.length + 1 > targetChars && partLines.length > 0) {
          chunks.push({
            text: `${msg.role.toUpperCase()} (part ${partIndex}/${totalParts}):\n${partLines.join("\n")}`,
            startIndex: idx,
            endIndex: idx,
          });
          partIndex++;
          partLines = [line];
          partChars = line.length;
        } else {
          partLines.push(line);
          partChars += line.length + 1;
        }
      }

      if (partLines.length > 0) {
        chunks.push({
          text: `${msg.role.toUpperCase()} (part ${partIndex}/${totalParts}):\n${partLines.join("\n")}`,
          startIndex: idx,
          endIndex: idx,
        });
      }

      startIndex = idx + 1;
      continue;
    }

    if (currentChars + fullMsgText.length + 2 > targetChars && currentLines.length > 0) {
      chunks.push({
        text: currentLines.join("\n\n"),
        startIndex,
        endIndex: idx - 1,
      });
      currentLines = [fullMsgText];
      currentChars = fullMsgText.length;
      startIndex = idx;
    } else {
      currentLines.push(fullMsgText);
      currentChars += fullMsgText.length + 2;
    }
  }

  if (currentLines.length > 0) {
    chunks.push({
      text: currentLines.join("\n\n"),
      startIndex,
      endIndex: messages.length - 1,
    });
  }

  return chunks;
}

/**
 * Hierarchical Map-Reduce Note Merger with Guaranteed Termination (Gotcha #11).
 */
export async function mergeChunkNotes(
  notes: string[],
  llm: LLMClient,
  maxBatchChars: number = 6000
): Promise<string> {
  let currentNotes = notes.filter((n) => n.trim().length > 0);

  if (currentNotes.length === 0) return "";
  if (currentNotes.length === 1) return currentNotes[0];

  const maxRounds = 10;
  let round = 0;

  while (currentNotes.length > 1 && round < maxRounds) {
    round++;
    const nextNotes: string[] = [];
    let batch: string[] = [];
    let batchChars = 0;

    for (let i = 0; i < currentNotes.length; i++) {
      const note = currentNotes[i];

      if (batchChars + note.length > maxBatchChars && batch.length > 0) {
        const merged = await llm.complete(
          buildMergeNotesPrompt(),
          batch.join("\n\n---\n\n"),
          { task: "merge_notes" }
        );
        nextNotes.push(merged);
        batch = [note];
        batchChars = note.length;
      } else {
        batch.push(note);
        batchChars += note.length;
      }
    }

    if (batch.length > 0) {
      if (batch.length === 1 && nextNotes.length > 0) {
        // Avoid lonely trailing note; merge with previous reduced note
        const prev = nextNotes.pop()!;
        const merged = await llm.complete(
          buildMergeNotesPrompt(),
          `${prev}\n\n---\n\n${batch[0]}`,
          { task: "merge_notes" }
        );
        nextNotes.push(merged);
      } else {
        const merged = await llm.complete(
          buildMergeNotesPrompt(),
          batch.join("\n\n---\n\n"),
          { task: "merge_notes" }
        );
        nextNotes.push(merged);
      }
    }

    // Gotcha #11: Guarantee strict reduction progress
    if (nextNotes.length >= currentNotes.length) {
      // Force pairwise merge of the first two notes
      const forced = await llm.complete(
        buildMergeNotesPrompt(),
        `${currentNotes[0]}\n\n---\n\n${currentNotes[1]}`,
        { task: "merge_notes" }
      );
      currentNotes = [forced, ...currentNotes.slice(2)];
    } else {
      currentNotes = nextNotes;
    }
  }

  return currentNotes[0] || "";
}

/**
 * Dual-mode transcript summarizer:
 * - Direct mode for short transcripts
 * - Notes map-reduce mode for long transcripts
 */
export async function summarizeTranscript(
  messages: Message[],
  llm: LLMClient,
  options?: { thresholdChars?: number; chunkTargetChars?: number }
): Promise<SummaryResult> {
  const threshold = options?.thresholdChars || DEFAULT_CHUNK_THRESHOLD_CHARS;
  const chunkTarget = options?.chunkTargetChars || DEFAULT_CHUNK_TARGET_CHARS;

  const fullText = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  if (fullText.length <= threshold) {
    return { mode: "direct", text: fullText };
  }

  // Notes mode: chunk -> summarize each chunk in parallel -> merge notes
  const chunks = chunkConversation(messages, chunkTarget);
  const chunkNotes: string[] = await Promise.all(
    chunks.map((chunk) =>
      llm.complete(buildChunkNotesPrompt(), chunk.text, { task: "chunk_summary" })
    )
  );

  const mergedNotes = await mergeChunkNotes(chunkNotes, llm, chunkTarget);
  return { mode: "notes", text: mergedNotes };
}
