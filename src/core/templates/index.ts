import type { ConversationType } from "../schema.js";
import { COMMON_HEADER, COMMON_TAIL, FINAL_ACTION_SECTION } from "./base.js";
import { CODING_SECTIONS } from "./coding.js";
import { DEBUGGING_SECTIONS } from "./debugging.js";
import { RESEARCH_SECTIONS } from "./research.js";
import { LEARNING_SECTIONS } from "./learning.js";

export * from "./base.js";
export * from "./coding.js";
export * from "./debugging.js";
export * from "./research.js";
export * from "./learning.js";

/**
 * Returns the ordered array of section titles required for a given set of conversation types (Section 3.2).
 * 
 * Invariants:
 * - Common Header is always first (Goal, Decisions, Constraints).
 * - Debugging domain automatically includes coding sections (Gotcha #19).
 * - Common Tail follows domain sections (Current State, Open Questions).
 * - Next Step is always the final action section.
 */
export function getTemplateSections(types: ConversationType[]): string[] {
  const sections: string[] = [...COMMON_HEADER];

  const typeSet = new Set(types);

  if (typeSet.has("debugging")) {
    sections.push(...DEBUGGING_SECTIONS);
    // Gotcha #19: debugging implies coding
    sections.push(...CODING_SECTIONS);
  } else if (typeSet.has("coding")) {
    sections.push(...CODING_SECTIONS);
  }

  if (typeSet.has("research")) {
    sections.push(...RESEARCH_SECTIONS);
  }

  if (typeSet.has("learning")) {
    sections.push(...LEARNING_SECTIONS);
  }

  sections.push(...COMMON_TAIL);
  sections.push(FINAL_ACTION_SECTION);

  // Return deduplicated in preserved order
  return Array.from(new Set(sections));
}
