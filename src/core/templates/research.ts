/**
 * Research domain-specific sections (Section 3.2).
 * Prevents target LLM from fabricating citations or losing source-to-claim mappings.
 */

export const RESEARCH_SECTIONS = [
  "Research Question and Thesis",
  "Outline and Section Status",
  "Sources and What They Support",
  "Claims and Evidence",
  "Citation Style",
  "Open Gaps",
] as const;
