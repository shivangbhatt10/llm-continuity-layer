import type { Capsule } from "../../core/schema.js";
import { formatClaudeCapsule } from "./claude.js";
import { formatGeminiCapsule } from "./gemini.js";

export * from "./base.js";
export * from "./claude.js";
export * from "./gemini.js";

export type TargetProvider = "claude" | "gemini" | "chatgpt" | "markdown";

/**
 * Formats a State Capsule into a target provider handoff envelope (Section 3.3).
 */
export function formatCapsule(
  capsule: Capsule,
  target: TargetProvider = "gemini"
): string {
  switch (target) {
    case "claude":
      return formatClaudeCapsule(capsule);
    case "gemini":
    case "chatgpt":
    case "markdown":
    default:
      return formatGeminiCapsule(capsule);
  }
}
