import { describe, it, expect } from "vitest";
import {
  parseCapsuleSections,
  selectRecentTurns,
  synthesizeCapsule,
} from "../src/core/capsule.js";
import { ScriptedLLM } from "../src/core/llm.js";
import type { Conversation, Message } from "../src/core/schema.js";

describe("State Capsule Engine (Gotchas #8, #10, #19)", () => {
  describe("Tolerant Section Parsing (Gotcha #8)", () => {
    it("parses valid sections and ignores # comments inside code blocks", () => {
      const rawMarkdown = `
## Goal
Resolve deadlocks in database transaction pool.

## Decisions and Rationale
We chose optimistic concurrency with row versions.

## Current State
Working on the repository layer.
\`\`\`python
# ## Goal: this comment inside code must not split the section!
def execute_query():
    pass
\`\`\`

## Next Step
Run integration tests.
`;

      const requestedSections = [
        "Goal",
        "Decisions and Rationale",
        "Constraints and Preferences",
        "Current State",
        "Next Step",
      ];

      const { sections, missingSections } = parseCapsuleSections(rawMarkdown, requestedSections);

      expect(sections["Goal"]).toBe("Resolve deadlocks in database transaction pool.");
      expect(sections["Decisions and Rationale"]).toBe("We chose optimistic concurrency with row versions.");
      expect(sections["Current State"]).toContain("def execute_query():");
      expect(sections["Next Step"]).toBe("Run integration tests.");

      // Constraints was not in the markdown -> defaulted and tracked
      expect(sections["Constraints and Preferences"]).toBe("Not established in the conversation.");
      expect(missingSections).toContain("Constraints and Preferences");
    });
  });

  describe("Recent Turns Selection & Head/Tail Budget (Gotcha #10)", () => {
    it("always keeps at least the last 2 turns, even if they exceed character budget", () => {
      const messages: Message[] = [
        { role: "user", content: "Turn 1" },
        { role: "assistant", content: "Turn 2" },
        { role: "user", content: "Turn 3: important request" },
        { role: "assistant", content: "Turn 4: final answer" },
      ];

      // Very small budget
      const selected = selectRecentTurns(messages, 20);
      expect(selected.length).toBe(2);
      expect(selected[0].content).toBe("Turn 3: important request");
      expect(selected[1].content).toBe("Turn 4: final answer");
    });

    it("truncates individual oversized messages 40% head / 60% tail with marker", () => {
      const hugeContent = "HEAD_" + "A".repeat(400) + "_MIDDLE_" + "Z".repeat(600) + "_TAIL";
      const messages: Message[] = [
        { role: "user", content: hugeContent },
        { role: "assistant", content: "Normal reply" },
      ];

      const selected = selectRecentTurns(messages, 5000, 300); // maxTurnChars = 300
      expect(selected[0].content).toContain("[... middle omitted ...]");
      expect(selected[0].content.startsWith("HEAD_")).toBe(true);
      expect(selected[0].content.endsWith("_TAIL")).toBe(true);
    });
  });

  describe("Capsule Synthesis", () => {
    it("assembles complete capsule with verbatim artifacts and classification", async () => {
      const scripted = new ScriptedLLM();
      scripted.onTask("classify", JSON.stringify(["coding", "debugging"]));
      scripted.onTask(
        "capsule",
        `
## Goal
Debug WebSocket reconnection drops.

## Current State
Identified ping/pong timeout mismatch.

## Next Step
Update heartbeat interval to 30s.
`
      );

      const conversation: Conversation = {
        id: "c-ws-1",
        source: "scraped_md",
        title: "WebSocket Debugging",
        messages: [
          { role: "user", content: "Our socket disconnects every 60 seconds." },
          {
            role: "assistant",
            content: "Here is the client config:\n```typescript\nexport const heartbeat = 30000;\n```",
          },
        ],
        meta: {},
      };

      const capsule = await synthesizeCapsule(conversation, scripted);

      expect(capsule.conversation_id).toBe("c-ws-1");
      expect(capsule.title).toBe("WebSocket Debugging");
      expect(capsule.types).toEqual(["coding", "debugging"]);
      expect(capsule.sections["Goal"]).toBe("Debug WebSocket reconnection drops.");
      expect(capsule.next_step).toBe("Update heartbeat interval to 30s.");

      // Verbatim artifact attached
      expect(capsule.artifacts.length).toBe(1);
      expect(capsule.artifacts[0].code).toContain("export const heartbeat = 30000;");

      // Recent turns attached
      expect(capsule.recent_turns.length).toBe(2);
    });
  });
});
