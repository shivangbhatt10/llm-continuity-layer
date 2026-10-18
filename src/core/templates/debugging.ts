/**
 * Debugging domain-specific sections (Section 3.2).
 * Automatically includes coding domain sections (Gotcha #19).
 * Prevents target LLM from re-suggesting dead ends already proven broken.
 */

export const DEBUGGING_SECTIONS = [
  "Symptom and Exact Error",
  "Environment",
  "Ruled Out (with why)",
  "Leading Hypothesis",
  "Last Attempt and Result",
] as const;
