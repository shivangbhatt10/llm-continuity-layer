/**
 * Learning domain-specific sections (Section 3.2).
 * Prevents target LLM from re-teaching mastered concepts or jumping too far ahead.
 */

export const LEARNING_SECTIONS = [
  "Learner Level",
  "Understood vs Shaky",
  "Analogies That Worked",
  "Misconceptions Corrected",
  "Teaching Sequence Position",
] as const;
