import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore } from "../src/store/db.js";
import type { Capsule } from "../src/core/schema.js";

describe("SQLite Working Memory Store (Section 4 & Schema)", () => {
  let store: SQLiteStore;

  const sampleCapsule: Capsule = {
    conversation_id: "conv-store-1",
    title: "Database Performance Tuning",
    source: "chatgpt",
    types: ["coding", "debugging"],
    sections: {
      Goal: "Eliminate deadlocks in transaction manager",
      "Decisions and Rationale": "Adopted optimistic locking with retry backoff",
      "Current State": "Repository layer updated and tested",
      "Next Step": "Benchmark under 500 concurrent workers",
    },
    next_step: "Benchmark under 500 concurrent workers",
    recent_turns: [
      { role: "user", content: "We need to test under high load." },
      { role: "assistant", content: "I will generate a load testing script." },
    ],
    artifacts: [
      {
        lang: "typescript",
        code: "export function runBenchmark() { return true; }",
        message_index: 1,
        role: "assistant",
        label: "benchmark.ts",
      },
    ],
    created_at: Date.now(),
    meta: {
      summary_mode: "direct",
    },
  };

  beforeEach(() => {
    store = new SQLiteStore(":memory:");
  });

  it("saves capsule and assigns initial version 1", () => {
    const saved = store.saveCapsule(sampleCapsule);
    expect(saved.version).toBe(1);
    expect(saved.conversation_id).toBe("conv-store-1");
  });

  it("auto-increments version when saving subsequent updates for same conversation", () => {
    const v1 = store.saveCapsule(sampleCapsule);
    expect(v1.version).toBe(1);

    const updatedCapsule: Capsule = {
      ...sampleCapsule,
      next_step: "Run final verification",
    };

    const v2 = store.saveCapsule(updatedCapsule);
    expect(v2.version).toBe(2);

    const latest = store.getLatestCapsule("conv-store-1");
    expect(latest?.version).toBe(2);
    expect(latest?.next_step).toBe("Run final verification");
  });

  it("preserves round-trip equality for sections, types, artifacts, and recent turns", () => {
    store.saveCapsule(sampleCapsule);
    const restored = store.getLatestCapsule("conv-store-1");

    expect(restored).not.toBeNull();
    expect(restored?.conversation_id).toBe(sampleCapsule.conversation_id);
    expect(restored?.title).toBe(sampleCapsule.title);
    expect(restored?.types).toEqual(sampleCapsule.types);
    expect(restored?.sections).toEqual(sampleCapsule.sections);
    expect(restored?.next_step).toBe(sampleCapsule.next_step);
    expect(restored?.artifacts).toEqual(sampleCapsule.artifacts);
    expect(restored?.recent_turns).toEqual(sampleCapsule.recent_turns);
  });

  it("lists all latest capsules across conversations", () => {
    store.saveCapsule(sampleCapsule);
    store.saveCapsule({
      ...sampleCapsule,
      conversation_id: "conv-store-2",
      title: "Second Chat",
    });

    const list = store.listCapsules();
    expect(list.length).toBe(2);
    const ids = list.map((c) => c.conversation_id);
    expect(ids).toContain("conv-store-1");
    expect(ids).toContain("conv-store-2");
  });

  it("retrieves specific historical version by conversationId and version number", () => {
    store.saveCapsule({ ...sampleCapsule, next_step: "Step 1" });
    store.saveCapsule({ ...sampleCapsule, next_step: "Step 2" });

    const historicalV1 = store.getCapsuleByVersion("conv-store-1", 1);
    expect(historicalV1?.version).toBe(1);
    expect(historicalV1?.next_step).toBe("Step 1");

    const historicalV2 = store.getCapsuleByVersion("conv-store-1", 2);
    expect(historicalV2?.version).toBe(2);
    expect(historicalV2?.next_step).toBe("Step 2");
  });
});
