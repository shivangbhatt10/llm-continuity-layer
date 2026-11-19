import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createContinuityMcpServer, type ContinuityMcpInstance } from "../src/mcp/server.js";
import { SQLiteStore } from "../src/store/db.js";
import type { Capsule } from "../src/core/schema.js";

describe("Milestone M13: Continuity MCP Server for AI Harnesses", () => {
  let mcpInstance: ContinuityMcpInstance;
  let client: Client;
  let store: SQLiteStore;

  const sampleCapsule1: Capsule = {
    conversation_id: "chatgpt-redis-lock",
    title: "Redis Distributed Mutex Incident",
    source: "chatgpt",
    types: ["coding", "debugging"],
    sections: {
      Goal: "Resolve Redlock timeout failures under high concurrency",
      "Decisions and Rationale": "Implemented monotonic performance.now() elapsed drift compensation",
      "Constraints and Preferences": "Must retain 5-node quorum without disabling auth",
      "Current State": "DriftCompensatedMutex implemented and passing unit tests",
      "Ruled Out (with why)": "Increasing lock timeout to 10000ms caused thread starvation and OOM crashes",
      "Next Step": "Benchmark under 1000 simulated clock-drift spikes",
    },
    next_step: "Benchmark under 1000 simulated clock-drift spikes",
    recent_turns: [
      { role: "user", content: "We are getting timeout errors on 3 of 5 redis nodes." },
      { role: "assistant", content: "I will implement a drift-compensated mutex." },
    ],
    artifacts: [
      {
        lang: "typescript",
        code: "export class DriftCompensatedMutex { acquire() { return true; } }",
        message_index: 1,
        role: "assistant",
        label: "src/redis_mutex.ts",
      },
    ],
    created_at: 10000,
    meta: { client: "chrome-extension" },
  };

  const sampleCapsule2: Capsule = {
    conversation_id: "claude-cloud-study",
    title: "Cloud Computing Architect Study Plan",
    source: "claude",
    types: ["learning"],
    sections: {
      Goal: "Master distributed systems and consensus protocols for AWS/GCP architecture exams",
      "Learner Level": "Advanced backend engineer",
      "Current State": "Covered Raft and Paxos consensus basics",
      "Next Step": "Deep dive into Multi-Paxos vs EPaxos tradeoffs",
    },
    next_step: "Deep dive into Multi-Paxos vs EPaxos tradeoffs",
    recent_turns: [
      { role: "user", content: "What is the difference between Raft and Paxos?" },
      { role: "assistant", content: "Raft is leader-driven with linear log consistency." },
    ],
    artifacts: [],
    created_at: 20000,
    meta: { client: "chrome-extension" },
  };

  beforeEach(async () => {
    store = new SQLiteStore(":memory:");
    mcpInstance = createContinuityMcpServer({ store });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpInstance.server.connect(serverTransport);

    client = new Client(
      { name: "test-harness", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    mcpInstance.close();
  });

  it("registers all 4 core continuity MCP tools with schemas", async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("get_latest_handoff");
    expect(toolNames).toContain("list_saved_sessions");
    expect(toolNames).toContain("search_sessions");
    expect(toolNames).toContain("save_checkpoint");
  });

  describe("list_saved_sessions tool", () => {
    it("returns message when memory is empty", async () => {
      const res = await client.callTool({
        name: "list_saved_sessions",
        arguments: {},
      });
      const text = (res.content as any)[0].text;
      expect(text).toContain("No continuity sessions found in working memory");
    });

    it("lists saved sessions with summaries ordered by latest update", async () => {
      store.saveCapsule(sampleCapsule1);
      store.saveCapsule(sampleCapsule2);

      const res = await client.callTool({
        name: "list_saved_sessions",
        arguments: { limit: 10 },
      });
      const text = (res.content as any)[0].text;
      const parsed = JSON.parse(text);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      // Newest first (sampleCapsule2 created_at: 20000 > sampleCapsule1: 10000)
      expect(parsed[0].conversation_id).toBe("claude-cloud-study");
      expect(parsed[0].source).toBe("claude");
      expect(parsed[1].conversation_id).toBe("chatgpt-redis-lock");
      expect(parsed[1].source).toBe("chatgpt");
    });
  });

  describe("get_latest_handoff tool", () => {
    it("returns latest session formatted with Claude XML-hybrid envelope and 3-line handshake", async () => {
      store.saveCapsule(sampleCapsule1);
      store.saveCapsule(sampleCapsule2);

      // Latest overall is sampleCapsule2
      const res = await client.callTool({
        name: "get_latest_handoff",
        arguments: { target_format: "claude" },
      });
      const text = (res.content as any)[0].text;

      expect(text).toContain("<handoff>");
      expect(text).toContain("<handoff_instructions>");
      expect(text).toContain("Goal: <1 line>");
      expect(text).toContain("Current State: <1 line>");
      expect(text).toContain("Next Step: <1 line>");
      expect(text).toContain("Master distributed systems and consensus protocols");
      expect(text).toContain("Deep dive into Multi-Paxos vs EPaxos tradeoffs");
    });

    it("returns specific conversation in Gemini Markdown format with dynamic fences", async () => {
      store.saveCapsule(sampleCapsule1);
      store.saveCapsule(sampleCapsule2);

      const res = await client.callTool({
        name: "get_latest_handoff",
        arguments: {
          conversation_id: "chatgpt-redis-lock",
          target_format: "gemini",
        },
      });
      const text = (res.content as any)[0].text;

      expect(text).toContain("# State Continuity Handoff");
      expect(text).toContain("## Handoff Instructions");
      expect(text).toContain("Goal: <1 line>");
      expect(text).toContain("DriftCompensatedMutex");
      expect(text).toContain("Ruled Out (with why)");
      expect(text).toContain("Increasing lock timeout to 10000ms");
    });

    it("returns raw JSON capsule when target_format is raw", async () => {
      store.saveCapsule(sampleCapsule1);

      const res = await client.callTool({
        name: "get_latest_handoff",
        arguments: { target_format: "raw" },
      });
      const text = (res.content as any)[0].text;
      const parsed = JSON.parse(text);

      expect(parsed.conversation_id).toBe("chatgpt-redis-lock");
      expect(parsed.artifacts.length).toBe(1);
      expect(parsed.artifacts[0].label).toBe("src/redis_mutex.ts");
    });

    it("returns error message when specific conversation_id does not exist", async () => {
      const res = await client.callTool({
        name: "get_latest_handoff",
        arguments: { conversation_id: "nonexistent-id" },
      });
      const text = (res.content as any)[0].text;
      expect(text).toContain('No continuity capsule found for conversation ID: "nonexistent-id"');
    });
  });

  describe("search_sessions tool", () => {
    it("finds matching sessions by keyword across title, goals, and sections", async () => {
      store.saveCapsule(sampleCapsule1);
      store.saveCapsule(sampleCapsule2);

      const res1 = await client.callTool({
        name: "search_sessions",
        arguments: { query: "Redlock" },
      });
      const parsed1 = JSON.parse((res1.content as any)[0].text);
      expect(parsed1.length).toBe(1);
      expect(parsed1[0].conversation_id).toBe("chatgpt-redis-lock");
      expect(parsed1[0].matchSnippet).toContain("Goal: Resolve Redlock timeout");

      const res2 = await client.callTool({
        name: "search_sessions",
        arguments: { query: "Paxos" },
      });
      const parsed2 = JSON.parse((res2.content as any)[0].text);
      expect(parsed2.length).toBe(1);
      expect(parsed2[0].conversation_id).toBe("claude-cloud-study");

      const resEmpty = await client.callTool({
        name: "search_sessions",
        arguments: { query: "kubernetes_helm_chart_392" },
      });
      const textEmpty = (resEmpty.content as any)[0].text;
      expect(textEmpty).toContain("No continuity sessions matched query");
    });
  });

  describe("save_checkpoint tool", () => {
    it("saves a new checkpoint capsule from the harness and auto-increments version", async () => {
      const res1 = await client.callTool({
        name: "save_checkpoint",
        arguments: {
          conversation_id: "harness-session-1",
          title: "Refactor Database Migration Layer",
          goal: "Migrate SQLite migrations to transactional DDL",
          current_state: "Created schema runner and tested rollback hooks",
          next_step: "Add integration tests for foreign key constraints",
          ruled_out: "Raw string interpolation ruled out due to SQL injection vulnerability",
          artifacts: [
            {
              lang: "typescript",
              code: "export function runMigration() { return true; }",
              label: "src/migrate.ts",
            },
          ],
          source: "claude-code",
        },
      });

      const text1 = (res1.content as any)[0].text;
      expect(text1).toContain("Saved checkpoint v1");
      expect(text1).toContain("harness-session-1");

      // Verify it can be retrieved immediately via get_latest_handoff
      const handoffRes = await client.callTool({
        name: "get_latest_handoff",
        arguments: { conversation_id: "harness-session-1", target_format: "raw" },
      });
      const capsule = JSON.parse((handoffRes.content as any)[0].text);
      expect(capsule.title).toBe("Refactor Database Migration Layer");
      expect(capsule.sections["Goal"]).toBe("Migrate SQLite migrations to transactional DDL");
      expect(capsule.sections["Ruled Out (with why)"]).toContain("Raw string interpolation");
      expect(capsule.artifacts[0].code).toContain("runMigration");

      // Save version 2
      const res2 = await client.callTool({
        name: "save_checkpoint",
        arguments: {
          conversation_id: "harness-session-1",
          title: "Refactor Database Migration Layer",
          goal: "Migrate SQLite migrations to transactional DDL",
          current_state: "Foreign key integration tests passed",
          next_step: "Commit and push branch to origin",
          source: "claude-code",
        },
      });
      const text2 = (res2.content as any)[0].text;
      expect(text2).toContain("Saved checkpoint v2");
    });
  });
});
