import { describe, it, expect } from "vitest";
import { loadConfig, type Config } from "../src/config.js";

describe("Configuration & Model Precedence (Gotcha #12 & Gotcha #13)", () => {
  it("uses default models when no environment variables are set", () => {
    const config: Config = loadConfig({});
    expect(config.cheapModel).toBe("gemini-3.1-flash-lite");
    expect(config.strongModel).toBe("gemini-3.8-flash");
    expect(config.apiKey).toBeUndefined();
  });

  it("respects granular ML_CHEAP_MODEL and ML_STRONG_MODEL overrides", () => {
    const config: Config = loadConfig({
      ML_CHEAP_MODEL: "my-cheap-model",
      ML_STRONG_MODEL: "my-strong-model",
    });
    expect(config.cheapModel).toBe("my-cheap-model");
    expect(config.strongModel).toBe("my-strong-model");
  });

  it("uses ML_MODEL as a universal fallback for both tiers when set", () => {
    const config: Config = loadConfig({
      ML_MODEL: "universal-model",
    });
    expect(config.cheapModel).toBe("universal-model");
    expect(config.strongModel).toBe("universal-model");
  });

  it("prioritizes granular tier settings over ML_MODEL", () => {
    const config: Config = loadConfig({
      ML_MODEL: "universal-model",
      ML_CHEAP_MODEL: "explicit-cheap",
    });
    expect(config.cheapModel).toBe("explicit-cheap");
    expect(config.strongModel).toBe("universal-model");
  });

  it("extracts GEMINI_API_KEY when provided", () => {
    const config: Config = loadConfig({
      GEMINI_API_KEY: "sk-test-secret-12345",
    });
    expect(config.apiKey).toBe("sk-test-secret-12345");
  });

  it("initializes safely without crashing in offline mode when API key is missing", () => {
    const config: Config = loadConfig({});
    expect(config.isOffline).toBe(true);
  });
});
