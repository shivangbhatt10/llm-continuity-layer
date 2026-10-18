import type { Capsule, Conversation, LLMClient, Message } from "./schema.js";
import { classifyConversation } from "./classify.js";
import { getTemplateSections } from "./templates/index.js";
import { extractArtifacts, deduplicateArtifacts } from "./artifacts.js";
import { summarizeTranscript } from "./chunk_summarize.js";
import { buildCapsuleSystemPrompt } from "./prompts.js";

export const NOT_ESTABLISHED = "Not established in the conversation.";

export interface ParsedSections {
  sections: Record<string, string>;
  missingSections: string[];
}

/**
 * Tolerant Section Parser (Gotcha #8).
 * Only splits on ## <Section Title> when the heading matches a requested section.
 * Ignores # comments inside code blocks or prose.
 */
export function parseCapsuleSections(
  rawMarkdown: string,
  requestedSections: string[]
): ParsedSections {
  const lines = rawMarkdown.split("\n");
  const sectionMap: Record<string, string[]> = {};
  const sectionLookup = new Map<string, string>();

  for (const s of requestedSections) {
    sectionLookup.set(s.toLowerCase(), s);
  }

  let inFence = false;
  let fenceDelimiter = "";
  let currentSection: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const delim = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceDelimiter = delim[0];
      } else if (delim[0] === fenceDelimiter && delim.length >= 3) {
        inFence = false;
        fenceDelimiter = "";
      }
    }

    if (!inFence && trimmed.startsWith("## ")) {
      const headingCandidate = trimmed.replace(/^##\s+/, "").trim().toLowerCase();
      const matchedCanonical = sectionLookup.get(headingCandidate);

      if (matchedCanonical) {
        currentSection = matchedCanonical;
        if (!sectionMap[currentSection]) {
          sectionMap[currentSection] = [];
        }
        continue;
      }
    }

    if (currentSection) {
      sectionMap[currentSection].push(line);
    }
  }

  const finalSections: Record<string, string> = {};
  const missingSections: string[] = [];

  for (const requested of requestedSections) {
    const rawLines = sectionMap[requested];
    const text = rawLines ? rawLines.join("\n").trim() : "";

    if (text.length > 0 && text.toLowerCase() !== NOT_ESTABLISHED.toLowerCase()) {
      finalSections[requested] = text;
    } else {
      finalSections[requested] = NOT_ESTABLISHED;
      missingSections.push(requested);
    }
  }

  return { sections: finalSections, missingSections };
}

/**
 * Selects recent turns under budget, truncating oversized messages (Gotcha #10).
 * Always preserves at least the last 2 turns.
 */
export function selectRecentTurns(
  messages: Message[],
  budgetChars: number = 4000,
  maxTurnChars: number = 1000
): Message[] {
  if (messages.length === 0) return [];

  const selectedReversed: Message[] = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    let content = msg.content;

    // Truncate individual oversized turns 40% head / 60% tail
    if (content.length > maxTurnChars) {
      const headLen = Math.floor(maxTurnChars * 0.4);
      const tailLen = Math.floor(maxTurnChars * 0.6);
      const head = content.slice(0, headLen);
      const tail = content.slice(-tailLen);
      content = `${head}\n\n[... middle omitted ...]\n\n${tail}`;
    }

    const turnChars = content.length;

    // Always keep at least the last 2 turns
    if (selectedReversed.length < 2 || totalChars + turnChars <= budgetChars) {
      selectedReversed.push({
        role: msg.role,
        content,
        id: msg.id,
        ts: msg.ts,
      });
      totalChars += turnChars;
    } else {
      break;
    }
  }

  return selectedReversed.reverse();
}

/**
 * Synthesizes a canonical State Capsule from a conversation.
 */
export async function synthesizeCapsule(
  conversation: Conversation,
  llm: LLMClient
): Promise<Capsule> {
  // 1. Multi-label domain classification (Gotcha #19)
  const types = await classifyConversation(conversation, llm);

  // 2. Resolve domain template sections (Section 3.2)
  const requestedSections = getTemplateSections(types);

  // 3. Extract and deduplicate code artifacts (Gotcha #6, Gotcha #18)
  const rawArtifacts = extractArtifacts(conversation.messages);
  const artifacts = deduplicateArtifacts(rawArtifacts);

  // 4. Summarize transcript (direct vs notes mode, Gotcha #11)
  const summaryResult = await summarizeTranscript(conversation.messages, llm);

  // 5. Synthesize sections via Strong Model
  const systemPrompt = buildCapsuleSystemPrompt(requestedSections);
  const userPrompt = `Synthesize the state capsule from the following transcript content:\n\n${summaryResult.text}`;

  const rawCapsuleMarkdown = await llm.complete(systemPrompt, userPrompt, {
    task: "capsule",
  });

  // 6. Tolerant section parsing (Gotcha #8)
  const { sections, missingSections } = parseCapsuleSections(
    rawCapsuleMarkdown,
    requestedSections
  );

  // 7. Extract next step
  const nextStep =
    sections["Next Step"] && sections["Next Step"] !== NOT_ESTABLISHED
      ? sections["Next Step"]
      : "Continue task execution based on the current state.";

  // 8. Select recent turns budget (Gotcha #10)
  const recentTurns = selectRecentTurns(conversation.messages);

  return {
    conversation_id: conversation.id,
    title: conversation.title,
    source: conversation.source,
    types,
    sections,
    next_step: nextStep,
    recent_turns: recentTurns,
    artifacts,
    created_at: Date.now(),
    meta: {
      ...conversation.meta,
      summary_mode: summaryResult.mode,
      missing_sections: missingSections,
      raw_artifact_count: rawArtifacts.length,
      deduped_artifact_count: artifacts.length,
    },
  };
}
