import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createContinuityServer, type ContinuityServerInstance } from "../src/proxy/server.js";
import { ScriptedLLM } from "../src/core/llm.js";
import { executeWithFailover } from "../src/proxy/failover.js";

describe("Milestone M10: Local Continuity Daemon & HTTP Proxy", () => {
  let serverInstance: ContinuityServerInstance;
  let baseUrl: string;

  beforeAll(async () => {
    // Start server on ephemeral port (0) with in-memory SQLite store and scripted LLM
    const scripted = new ScriptedLLM();
    scripted.onTask("classify", JSON.stringify(["coding", "debugging"]));
    scripted.onTask(
      "capsule",
      `
## Goal
Debug Redis distributed lock timeouts.

## Decisions and Rationale
Use monotonic drift compensation.

## Constraints and Preferences
Preserve cluster safety.

## Symptom and Exact Error
Lock acquisition timed out.

## Ruled Out (with why)
Increasing timeout to 10000ms caused thread exhaustion.

## Stack and Environment
TypeScript, Redis.

## Files and Components
\`redis_mutex.ts\`: mutex implementation.

## Conventions to Follow
Use monotonic clock.

## Implemented vs Pending
Implemented drift mutex.

## Current State
Drift mutex working.

## Open Questions
None.

## Next Step
Run stress tests.
`.trim()
    );

    serverInstance = await createContinuityServer({
      port: 0,
      dbPath: ":memory:",
      llm: scripted,
    });
    const port = await serverInstance.listen();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.close();
    }
  });

  it("handles GET /api/health with status ok and model information", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
    expect(body.cheap_model).toBeDefined();
    expect(body.strong_model).toBeDefined();
  });

  it("responds to CORS OPTIONS preflight with 204 and permissive headers", async () => {
    const res = await fetch(`${baseUrl}/api/handoff`, {
      method: "OPTIONS",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnop",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });

  it("processes POST /api/handoff from browser extension and returns envelope with 3-line handshake", async () => {
    const handoffPayload = {
      title: "Redis Lock Debugging",
      source: "chatgpt",
      target: "claude",
      messages: [
        { role: "user", content: "We are getting lock timeouts on 3 of 5 redis nodes." },
        {
          role: "assistant",
          content: "Here is the code:\n```typescript\nexport class DriftCompensatedMutex {}\n```",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "chrome-extension://abcdefghijklmnop",
      },
      body: JSON.stringify(handoffPayload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.conversation_id).toBeDefined();
    expect(data.types).toContain("coding");
    expect(data.types).toContain("debugging");
    expect(data.target).toBe("claude");
    expect(data.envelope).toContain("<handoff>");
    expect(data.envelope).toContain("Goal: <1 line>");
    expect(data.envelope).toContain("Current State: <1 line>");
    expect(data.envelope).toContain("Next Step: <1 line>");
    expect(data.envelope).toContain("DriftCompensatedMutex");

    // Verify it was stored in working memory
    const stored = serverInstance.store.getLatestCapsule(data.conversation_id);
    expect(stored).not.toBeNull();
    expect(stored?.title).toBe("Redis Lock Debugging");
  });

  it("handles OpenAI-compatible POST /v1/chat/completions", async () => {
    const completionPayload = {
      model: "gpt-4o",
      messages: [
        { role: "user", content: "Hello from Cursor" },
      ],
    };

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(completionPayload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("chat.completion");
    expect(data.choices).toHaveLength(1);
    expect(data.choices[0].message.role).toBe("assistant");
    expect(data.choices[0].message.content).toBeDefined();
  });

  it("executes automatic 429 failover to fallback provider", async () => {
    let primaryAttempts = 0;
    let fallbackAttempts = 0;

    const mockPrimary = async () => {
      primaryAttempts++;
      const err = new Error("Rate limit exceeded");
      (err as any).status = 429;
      throw err;
    };

    const mockFallback = async () => {
      fallbackAttempts++;
      return "Fallback provider response";
    };

    const result = await executeWithFailover([mockPrimary, mockFallback]);

    expect(primaryAttempts).toBe(1);
    expect(fallbackAttempts).toBe(1);
    expect(result.result).toBe("Fallback provider response");
    expect(result.failoverOccurred).toBe(true);
  });
});
