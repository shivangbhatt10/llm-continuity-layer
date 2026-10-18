import dotenv from "dotenv";

// Load .env into process.env if present
dotenv.config();

export interface Config {
  /** Model used for cheap, high-frequency operations: classification, chunk notes, note merges */
  cheapModel: string;
  /** Model used for strong reasoning: capsule synthesis, final evaluations */
  strongModel: string;
  /** Gemini API key (optional during offline test and dry-run execution) */
  apiKey?: string;
  /** Flag indicating whether the environment lacks an active API key */
  isOffline: boolean;
}

export const DEFAULT_CHEAP_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_STRONG_MODEL = "gemini-3.8-flash";

/**
 * Loads and resolves runtime configuration from the provided environment dictionary.
 * 
 * Precedence Rules (Gotcha #12):
 * 1. Granular tier settings (ML_CHEAP_MODEL, ML_STRONG_MODEL) take highest priority.
 * 2. Universal ML_MODEL applies to any tier not explicitly set.
 * 3. Default models (gemini-3.1-flash-lite, gemini-3.8-flash) apply when unset.
 * 
 * Secret Hygiene (Gotcha #13):
 * API key is extracted safely; if absent, isOffline is set to true without throwing.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const universal = env.ML_MODEL?.trim() || undefined;
  const cheap = env.ML_CHEAP_MODEL?.trim() || universal || DEFAULT_CHEAP_MODEL;
  const strong = env.ML_STRONG_MODEL?.trim() || universal || DEFAULT_STRONG_MODEL;
  const apiKey = env.GEMINI_API_KEY?.trim() || undefined;

  return {
    cheapModel: cheap,
    strongModel: strong,
    apiKey,
    isOffline: !apiKey,
  };
}

export const config: Config = loadConfig(process.env);
export default config;
