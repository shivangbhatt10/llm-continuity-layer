import { describe, it, expect } from "vitest";
import {
  getSafeFence,
  formatCapsule,
} from "../src/deliver/formatters/index.js";
import type { Capsule } from "../src/core/schema.js";

describe("Target Deliver Formatters & 3-Line Handshake (Section 3.3, Gotcha #6)", () => {
  const sampleCapsule: Capsule = {
    conversation_id: "c-fmt-1",
    title: "Cache Layer Migration",
    source: "scraped_md",
    types: ["coding", "debugging"],
    sections: {
      Goal: "Migrate in-memory cache to Redis cluster",
      "Decisions and Rationale": "Selected redis-cluster with key tags for sharding",
      "Ruled Out (with why)": "Memcached rejected because persistence and pub/sub needed",
      "Current State": "Redis adapter written and tested locally",
      "Next Step": "Deploy Redis Sentinel configuration to staging",
    },
    next_step: "Deploy Redis Sentinel configuration to staging",
    recent_turns: [
      { role: "user", content: "Is the sentinel failover verified?" },
      { role: "assistant", content: "Yes, verified locally with docker-compose." },
    ],
    artifacts: [
      {
        lang: "typescript",
        code: "export const redisClient = createClient();",
        message_index: 1,
        role: "assistant",
        label: "redis.ts",
      },
    ],
    created_at: Date.now(),
    meta: {},
  };

  describe("Dynamic Backtick Fence Sizing (Gotcha #6)", () => {
    it("returns 3 backticks when code contains no backticks", () => {
      expect(getSafeFence("const a = 1;")).toBe("```");
    });

    it("returns 4 backticks when code contains 3 consecutive backticks", () => {
      const code = "```python\nprint('nested')\n```";
      expect(getSafeFence(code)).toBe("````");
    });

    it("returns 5 backticks when code contains 4 consecutive backticks", () => {
      const code = "````markdown\n```python\nprint(1)\n```\n````";
      expect(getSafeFence(code)).toBe("`````");
    });
  });

  describe("Claude Formatter (XML-Hybrid Envelope)", () => {
    it("formats capsule with <handoff>, <handoff_instructions>, 3-line handshake, and XML tags", () => {
      const output = formatCapsule(sampleCapsule, "claude");

      expect(output).toContain("<handoff>");
      expect(output).toContain("<handoff_instructions>");
      // 3-Line Handshake assertions
      expect(output).toContain("1. Do NOT restart the task, re-ask settled questions, or re-propose anything listed in <ruled_out>.");
      expect(output).toContain("2. Begin your VERY FIRST reply with a 3-line state confirmation:");
      expect(output).toContain("- Goal: <1 line>");
      expect(output).toContain("- Current State: <1 line>");
      expect(output).toContain("- Next Step: <1 line>");
      expect(output).toContain("3. Immediately after those 3 lines, execute the <next_step>.");

      // Ruled out tag
      expect(output).toContain("<ruled_out>");
      expect(output).toContain("Memcached rejected because persistence");

      // Artifact tag
      expect(output).toContain('<artifact lang="typescript" label="redis.ts">');
      expect(output).toContain("export const redisClient = createClient();");

      // Next step tag
      expect(output).toContain("<next_step>");
      expect(output).toContain("Deploy Redis Sentinel configuration to staging");
      expect(output).toContain("</handoff>");
    });
  });

  describe("Gemini & Markdown Formatter", () => {
    it("formats capsule with Markdown envelope, dynamic fences, and 3-line handshake", () => {
      const output = formatCapsule(sampleCapsule, "gemini");

      expect(output).toContain("# State Continuity Handoff");
      expect(output).toContain("## Handoff Instructions");
      expect(output).toContain("Goal: <1 line>");
      expect(output).toContain("Current State: <1 line>");
      expect(output).toContain("Next Step: <1 line>");
      expect(output).toContain("## Goal");
      expect(output).toContain("Migrate in-memory cache to Redis cluster");
      expect(output).toContain("## Next Step");
      expect(output).toContain("Deploy Redis Sentinel configuration to staging");
      expect(output).toContain("```typescript");
    });

    it("uses dynamic backtick fences when artifact has internal backticks in Markdown format", () => {
      const capsuleWithBackticks: Capsule = {
        ...sampleCapsule,
        artifacts: [
          {
            lang: "markdown",
            code: "```sh\nls -la\n```",
            message_index: 0,
            role: "assistant",
          },
        ],
      };

      const output = formatCapsule(capsuleWithBackticks, "markdown");
      expect(output).toContain("````markdown");
      expect(output).toContain("```sh\nls -la\n```");
      expect(output).toContain("````");
    });
  });
});
