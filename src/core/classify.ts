import type { Conversation, ConversationType, LLMClient } from "./schema.js";
import { buildClassificationPrompt } from "./prompts.js";

const VALID_TYPES: Set<ConversationType> = new Set([
  "coding",
  "debugging",
  "research",
  "learning",
  "general",
]);

/**
 * Deterministic heuristic domain classifier (Gotcha #19).
 * Used as an offline fallback when no LLM is available or when parsing fails.
 */
export function heuristicClassify(text: string): ConversationType[] {
  const lower = text.toLowerCase();

  const isDebugging =
    lower.includes("error") ||
    lower.includes("traceback") ||
    lower.includes("exception") ||
    lower.includes("bug") ||
    lower.includes("fail") ||
    lower.includes("cannot read properties") ||
    lower.includes("undefined") ||
    lower.includes("segfault");

  if (isDebugging) {
    // Gotcha #19: debugging implies coding
    return ["coding", "debugging"];
  }

  const isCoding =
    lower.includes("def ") ||
    lower.includes("class ") ||
    lower.includes("function ") ||
    lower.includes("import ") ||
    lower.includes("const ") ||
    lower.includes("let ") ||
    lower.includes("interface ") ||
    lower.includes("return ") ||
    lower.includes("npm ") ||
    lower.includes("git ");

  if (isCoding) {
    return ["coding"];
  }

  const isResearch =
    lower.includes("paper") ||
    lower.includes("papers") ||
    lower.includes("literature") ||
    lower.includes("study") ||
    lower.includes("hypothesis") ||
    lower.includes("sources") ||
    lower.includes("citation") ||
    lower.includes("thesis");

  if (isResearch) {
    return ["research"];
  }

  const isLearning =
    lower.includes("beginner") ||
    lower.includes("teach me") ||
    lower.includes("explain like") ||
    lower.includes("analogy") ||
    lower.includes("tutoring") ||
    lower.includes("what is the difference") ||
    lower.includes("understand");

  if (isLearning) {
    return ["learning"];
  }

  return ["general"];
}

/**
 * Multi-label domain classifier with LLM pass and heuristic fallback (Gotcha #19).
 * 
 * Rules:
 * 1. 'debugging' automatically implies 'coding'.
 * 2. Limit to the 1-2 primary labels describing what the session work IS.
 */
export async function classifyConversation(
  conversation: Conversation,
  llm?: LLMClient
): Promise<ConversationType[]> {
  // Aggregate recent turns for classification context
  const textSample = conversation.messages
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  if (!llm) {
    return heuristicClassify(textSample);
  }

  try {
    const system = buildClassificationPrompt();
    const prompt = `Classify this conversation transcript into 1-2 primary domain labels:\n\n${textSample}`;

    const rawResponse = await llm.complete(system, prompt, { task: "classify" });

    // Clean markdown code blocks if model wrapped JSON in ```json
    const cleaned = rawResponse
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      let types: ConversationType[] = parsed.filter((t): t is ConversationType =>
        VALID_TYPES.has(t as ConversationType)
      );

      // Gotcha #19: debugging implies coding
      if (types.includes("debugging") && !types.includes("coding")) {
        types.unshift("coding");
      }

      // Limit to at most 2 primary labels
      if (types.length > 2) {
        types = types.slice(0, 2);
      }

      if (types.length > 0) {
        return types;
      }
    }
  } catch {
    // If LLM fails or returns unparseable JSON, fall back gracefully
  }

  return heuristicClassify(textSample);
}
