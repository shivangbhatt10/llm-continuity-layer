import type { Conversation, Message, Role } from "../core/schema.js";

const SPEAKER_REGEX = /^(You said|ChatGPT said|User|Human|Claude|Assistant|Gemini):\s*(.*)$/i;

function normalizeSpeakerRole(speaker: string): Role {
  const s = speaker.toLowerCase();
  if (s === "you said" || s === "user" || s === "human") {
    return "user";
  }
  if (s === "chatgpt said" || s === "assistant" || s === "claude" || s === "gemini") {
    return "assistant";
  }
  return "unknown";
}

function deriveTitle(content: string): string {
  const firstLine = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return "Untitled Paste";
  if (firstLine.length > 80) {
    return `${firstLine.slice(0, 77)}...`;
  }
  return firstLine;
}

/**
 * Parses conversational text copied directly from web chat interfaces (Gotcha #5).
 * 
 * Enforces:
 * - Speaker markers are only matched OUTSIDE code fences.
 * - Supports ChatGPT ("You said: / ChatGPT said:"), Claude ("Human: / Claude:"), and standard ("User: / Assistant:").
 * - Fallback to a single "unknown" turn with parse_warning if no speaker markers exist.
 * - Extracts clean title from the first user turn.
 */
export function parsePaste(content: string, id: string = "paste-conv"): Conversation {
  const lines = content.split("\n");

  interface RawTurn {
    role: Role;
    lines: string[];
  }

  const turns: RawTurn[] = [];
  let currentTurn: RawTurn | null = null;
  let markersFound = 0;

  let inFence = false;
  let fenceDelimiter = "";

  for (const line of lines) {
    const trimmed = line.trimStart();
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

    if (!inFence) {
      const speakerMatch = trimmed.match(SPEAKER_REGEX);
      if (speakerMatch) {
        markersFound++;
        const speaker = speakerMatch[1];
        const remainder = speakerMatch[2].trim();
        const role = normalizeSpeakerRole(speaker);

        if (currentTurn) {
          turns.push(currentTurn);
        }
        currentTurn = { role, lines: remainder ? [remainder] : [] };
        continue;
      }
    }

    if (currentTurn) {
      currentTurn.lines.push(line);
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  // Fallback: If no speaker markers were found across the text
  if (markersFound === 0) {
    const trimmedContent = content.trim();
    return {
      id,
      source: "paste",
      title: deriveTitle(trimmedContent),
      messages: [
        {
          role: "unknown",
          content: trimmedContent,
          id: "turn-1",
        },
      ],
      meta: {
        parse_warning: "No speaker markers found in paste. Stored as single unknown message.",
      },
    };
  }

  // Convert raw turns to canonical Message objects
  const messages: Message[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const turnContent = turn.lines.join("\n").trim();
    if (turnContent.length > 0) {
      messages.push({
        role: turn.role,
        content: turnContent,
        id: `turn-${messages.length + 1}`,
      });
    }
  }

  const title = messages.length > 0 ? deriveTitle(messages[0].content) : "Untitled Paste";

  return {
    id,
    source: "paste",
    title,
    messages,
    meta: {
      speaker_markers_found: markersFound,
    },
  };
}
