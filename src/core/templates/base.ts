/**
 * Common Header and Tail sections shared by all domain state capsules.
 */

export const COMMON_HEADER = [
  "Goal",
  "Decisions and Rationale",
  "Constraints and Preferences",
] as const;

export const COMMON_TAIL = [
  "Current State",
  "Open Questions",
] as const;

export const FINAL_ACTION_SECTION = "Next Step";
