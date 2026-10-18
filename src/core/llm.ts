import { GoogleGenAI } from "@google/genai";
import config from "../config.js";
import type { LLMClient, LLMTask } from "./schema.js";

/**
 * Gotcha #15: Error Classification.
 * Permanent errors must FAIL IMMEDIATELY without wasteful retries.
 */
export function isPermanentError(error: unknown): boolean {
  if (!error) return false;

  const errObj = error as Record<string, unknown>;
  const status = Number(errObj.status || errObj.statusCode || 0);

  // Permanent HTTP codes
  if ([400, 401, 403, 404].includes(status)) {
    return true;
  }

  const message = String(errObj.message || error || "");
  const code = String(errObj.code || "");

  const permanentPatterns = [
    /400/i,
    /401/i,
    /403/i,
    /404/i,
    /NOT_FOUND/i,
    /INVALID_ARGUMENT/i,
    /PERMISSION_DENIED/i,
    /UNAUTHENTICATED/i,
    /Unauthorized/i,
    /API_KEY_INVALID/i,
  ];

  const transientPatterns = [
    /429/i,
    /500/i,
    /502/i,
    /503/i,
    /504/i,
    /RESOURCE_EXHAUSTED/i,
    /UNAVAILABLE/i,
  ];

  // If it matches a transient pattern first, it is NOT permanent
  if (transientPatterns.some((p) => p.test(message) || p.test(code))) {
    return false;
  }

  return permanentPatterns.some((p) => p.test(message) || p.test(code));
}

/**
 * Gotcha #15: Transient errors (rate limits, network blips) should retry with backoff.
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  const errObj = error as Record<string, unknown>;
  const status = Number(errObj.status || errObj.statusCode || 0);

  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const message = String(errObj.message || error || "");
  const code = String(errObj.code || "");

  const transientPatterns = [
    /429/i,
    /500/i,
    /502/i,
    /503/i,
    /504/i,
    /RESOURCE_EXHAUSTED/i,
    /UNAVAILABLE/i,
    /DEADLINE_EXCEEDED/i,
    /ETIMEDOUT/i,
    /ECONNRESET/i,
    /fetch failed/i,
    /rate limit/i,
  ];

  return transientPatterns.some((p) => p.test(message) || p.test(code));
}

/**
 * ScriptedLLM for 100% deterministic offline unit testing.
 */
export class ScriptedLLM implements LLMClient {
  readonly name = "ScriptedLLM";
  public callCount = 0;
  public history: Array<{
    system: string;
    prompt: string;
    options?: { maxTokens?: number; task?: LLMTask };
  }> = [];

  private taskResponses = new Map<LLMTask, string>();
  private substringResponses = new Map<string, string>();
  private defaultResponse: string = "Scripted response";

  onTask(task: LLMTask, response: string): this {
    this.taskResponses.set(task, response);
    return this;
  }

  onSubstring(substring: string, response: string): this {
    this.substringResponses.set(substring, response);
    return this;
  }

  setDefault(response: string): this {
    this.defaultResponse = response;
    return this;
  }

  async complete(
    system: string,
    prompt: string,
    options?: { maxTokens?: number; task?: LLMTask }
  ): Promise<string> {
    this.callCount++;
    this.history.push({ system, prompt, options });

    if (options?.task && this.taskResponses.has(options.task)) {
      return this.taskResponses.get(options.task)!;
    }

    for (const [sub, res] of this.substringResponses.entries()) {
      if (prompt.includes(sub)) {
        return res;
      }
    }

    return this.defaultResponse;
  }
}

/**
 * DryRunLLM for zero-cost offline CLI simulation without API keys.
 */
export class DryRunLLM implements LLMClient {
  readonly name = "DryRunLLM";

  async complete(
    _system: string,
    prompt: string,
    options?: { maxTokens?: number; task?: LLMTask }
  ): Promise<string> {
    const task = options?.task;

    if (task === "classify") {
      const lower = prompt.toLowerCase();
      if (lower.includes("error") || lower.includes("bug") || lower.includes("exception") || lower.includes("traceback")) {
        return JSON.stringify(["coding", "debugging"]);
      }
      return JSON.stringify(["coding"]);
    }

    if (task === "chunk_summary" || task === "merge_notes") {
      return "- Initial state analyzed offline\n- Key constraints preserved\n- Current pointer maintained";
    }

    // Default: capsule markdown
    return `
## Goal
Execute state continuity and maintain architectural invariants across models.

## Decisions and Rationale
Standardized on two-tier model routing and offline-verifiable TDD.

## Constraints and Preferences
Preserve verbatim code artifacts and enforce 3-line handshake.

## Current State
State capsule generated offline via DryRunLLM.

## Next Step
Review capsule sections and verify downstream target envelope formatting.
`.trim();
  }
}

/**
 * GeminiClient using @google/genai Interactions API (SDK >= 2.29.1).
 * Enforces two-tier model routing (Gotcha #12) and permanent vs transient retry logic (Gotcha #15).
 */
export class GeminiClient implements LLMClient {
  readonly name = "GeminiClient";
  private client: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || config.apiKey;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not set. Run with --dry-run or configure GEMINI_API_KEY in .env."
      );
    }
    this.client = new GoogleGenAI({ apiKey: key });
  }

  async complete(
    system: string,
    prompt: string,
    options?: { maxTokens?: number; task?: LLMTask }
  ): Promise<string> {
    const task = options?.task;

    // Gotcha #12: Two-tier model routing
    const isCheapTask =
      task === "classify" || task === "chunk_summary" || task === "merge_notes";
    const model = isCheapTask ? config.cheapModel : config.strongModel;

    const maxRetries = 3;
    let attempt = 0;
    let delayMs = 1000;

    while (attempt < maxRetries) {
      try {
        // Gotcha #16: Allocate ample output token headroom for thinking models
        const maxTokens = options?.maxTokens || (isCheapTask ? 2048 : 4096);

        const interaction = await this.client.interactions.create({
          model,
          input: prompt,
          system_instruction: system,
          generation_config: {
            max_output_tokens: maxTokens,
          },
        });

        const output = interaction.output_text;
        if (!output || output.trim().length === 0) {
          throw new Error(`Model ${model} returned an empty output_text.`);
        }

        return output.trim();
      } catch (err: unknown) {
        attempt++;

        // Gotcha #15: Permanent errors fail fast immediately
        if (isPermanentError(err)) {
          throw new Error(
            `Permanent Gemini API error with model '${model}': ${
              (err as Error).message
            }. Run 'ml models' to inspect available models.`
          );
        }

        // Retry transient errors with exponential backoff
        if (isTransientError(err) && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2;
          continue;
        }

        throw err;
      }
    }

    throw new Error(`GeminiClient failed after ${maxRetries} attempts.`);
  }
}
