import { describe, it, expect } from "vitest";
import { classifyConversation, heuristicClassify } from "../src/core/classify.js";
import { ScriptedLLM } from "../src/core/llm.js";
import type { Conversation, Message } from "../src/core/schema.js";

function makeConv(messages: Message[]): Conversation {
  return {
    id: "test-c1",
    source: "test",
    title: "Test Conversation",
    messages,
    meta: {},
  };
}

describe("Multi-Label Domain Classifier (Gotcha #19)", () => {
  it("enforces rule: debugging automatically implies coding", async () => {
    const scripted = new ScriptedLLM();
    scripted.onTask("classify", JSON.stringify(["debugging"]));

    const conv = makeConv([
      { role: "user", content: "We have a null pointer exception in login controller." },
    ]);

    const types = await classifyConversation(conv, scripted);
    expect(types).toContain("debugging");
    expect(types).toContain("coding");
  });

  it("limits primary labels to at most 2", async () => {
    const scripted = new ScriptedLLM();
    scripted.onTask("classify", JSON.stringify(["coding", "research", "learning", "general"]));

    const conv = makeConv([{ role: "user", content: "Teach me how to code transformers" }]);
    const types = await classifyConversation(conv, scripted);

    expect(types.length).toBeLessThanOrEqual(2);
  });

  it("uses heuristic fallback when LLM output is malformed or LLM fails", async () => {
    const scripted = new ScriptedLLM();
    scripted.onTask("classify", "not json at all");

    const conv = makeConv([
      { role: "user", content: "TypeError: Cannot read properties of undefined in auth.ts" },
    ]);

    const types = await classifyConversation(conv, scripted);
    expect(types).toContain("debugging");
    expect(types).toContain("coding");
  });

  it("heuristicClassify detects coding from code keywords", () => {
    const text = "function calculateTotal(items: Item[]) { return items.reduce(...); }";
    const types = heuristicClassify(text);
    expect(types).toContain("coding");
  });

  it("heuristicClassify detects research from academic/literature terms", () => {
    const text = "Let's do a literature review of recent papers on bi-temporal memory graphs.";
    const types = heuristicClassify(text);
    expect(types).toContain("research");
  });

  it("heuristicClassify detects learning from tutoring cues", () => {
    const text = "I am a beginner in rust. Can you explain ownership with an analogy?";
    const types = heuristicClassify(text);
    expect(types).toContain("learning");
  });
});
