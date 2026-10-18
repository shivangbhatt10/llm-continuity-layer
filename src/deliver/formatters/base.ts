/**
 * Dynamic Code Fence Sizing (Gotcha #6).
 * Inspects code for backtick runs and selects a fence length strictly greater than
 * the longest backtick run inside the code (minimum 3 backticks).
 */
export function getSafeFence(code: string): string {
  let maxBacktickRun = 0;
  const matches = code.matchAll(/`+/g);

  for (const match of matches) {
    if (match[0].length > maxBacktickRun) {
      maxBacktickRun = match[0].length;
    }
  }

  const fenceLength = Math.max(3, maxBacktickRun + 1);
  return "`".repeat(fenceLength);
}

export const THREE_LINE_HANDSHAKE_DIRECTIVE = `
1. Do NOT restart the task, re-ask settled questions, or re-propose anything listed in <ruled_out>.
2. Begin your VERY FIRST reply with a 3-line state confirmation:
   - Goal: <1 line>
   - Current State: <1 line>
   - Next Step: <1 line>
3. Immediately after those 3 lines, execute the <next_step>.
`.trim();
