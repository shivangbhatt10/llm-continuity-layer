import { describe, it, expect } from "vitest";
import {
  chunkConversation,
  summarizeTranscript,
  mergeChunkNotes,
} from "../src/core/chunk_summarize.js";
import { ScriptedLLM } from "../src/core/llm.js";
import type { Message } from "../src/core/schema.js";

describe("Guaranteed-Termination Chunk Summarizer (Gotcha #11)", () => {
  it("runs in direct mode for short conversations without chunking LLM calls", async () => {
    const scripted = new ScriptedLLM();
    const messages: Message[] = [
      { role: "user", content: "Hello, can you help me write a quick script?" },
      { role: "assistant", content: "Sure, what language do you prefer?" },
    ];

    const result = await summarizeTranscript(messages, scripted, { thresholdChars: 5000 });
    expect(result.mode).toBe("direct");
    expect(result.text).toContain("Hello, can you help me write a quick script?");
    expect(scripted.callCount).toBe(0);
  });

  it("runs in notes mode for long conversations, generating chunk notes and merging", async () => {
    const scripted = new ScriptedLLM();
    scripted.onTask("chunk_summary", "- Bullet point note from chunk");
    scripted.onTask("merge_notes", "- Consolidated note covering full session");

    // Create long transcript exceeding threshold
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Detailed message turn number ${i}: ` + "x".repeat(400),
      });
    }

    const result = await summarizeTranscript(messages, scripted, {
      thresholdChars: 2000,
      chunkTargetChars: 1500,
    });

    expect(result.mode).toBe("notes");
    expect(result.text).toContain("Consolidated note covering full session");
    expect(scripted.callCount).toBeGreaterThanOrEqual(2);
  });

  it("splits single oversized messages into (part k/n) chunks", () => {
    const hugeMessage: Message = {
      role: "user",
      content: "Line 1: important context\n" + "B".repeat(6000) + "\nLine 3: final context",
    };

    const chunks = chunkConversation([hugeMessage], 2000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toContain("(part 1/");
    expect(chunks[1].text).toContain("(part 2/");
  });

  it("mergeChunkNotes terminates reliably on large batches without infinite loops", async () => {
    const scripted = new ScriptedLLM();
    scripted.onTask("merge_notes", "- Merged note batch summary");

    const manyNotes = Array.from({ length: 15 }, (_, i) => `- Note ${i}: fact about system`);
    const merged = await mergeChunkNotes(manyNotes, scripted, 2000);

    expect(typeof merged).toBe("string");
    expect(merged.length).toBeGreaterThan(0);
    expect(scripted.callCount).toBeGreaterThan(0);
  });
});
