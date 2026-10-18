/**
 * Coding domain-specific sections (Section 3.2).
 * Prevents target LLM from rewriting working modules or violating repo conventions.
 */

export const CODING_SECTIONS = [
  "Stack and Environment",
  "Files and Components",
  "Conventions to Follow",
  "Implemented vs Pending",
] as const;
