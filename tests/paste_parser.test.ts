import { describe, it, expect } from "vitest";
import { parsePaste } from "../src/ingest/paste_parser.js";

describe("Fence-Aware Paste Parser (Gotcha #5)", () => {
  it("parses standard ChatGPT web copy-paste with 'You said:' and 'ChatGPT said:'", () => {
    const paste = `You said:
How do I configure TypeScript for NodeNext ESM?

ChatGPT said:
You need to set module and moduleResolution to NodeNext in tsconfig.json.
`;

    const conv = parsePaste(paste);
    expect(conv.messages.length).toBe(2);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].content).toContain("How do I configure TypeScript for NodeNext ESM?");
    expect(conv.messages[1].role).toBe("assistant");
    expect(conv.messages[1].content).toContain("You need to set module and moduleResolution to NodeNext");
  });

  it("parses Claude and generic pastes with 'Human:' and 'Assistant:' or 'Claude:'", () => {
    const paste = `Human:
Can we optimize this query?

Claude:
Here is the indexed version:
\`\`\`sql
CREATE INDEX idx_user ON users(email);
\`\`\`
`;

    const conv = parsePaste(paste);
    expect(conv.messages.length).toBe(2);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[1].role).toBe("assistant");
    expect(conv.messages[1].content).toContain("CREATE INDEX idx_user");
  });

  it("ignores speaker markers inside code fences (Gotcha #5)", () => {
    const paste = `User:
Here is the authentication controller:
\`\`\`typescript
// User: internal comment that must not split
class AuthController {
  login() {
    console.log("Assistant: logging in");
  }
}
\`\`\`

Assistant:
That looks secure.
`;

    const conv = parsePaste(paste);
    expect(conv.messages.length).toBe(2);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].content).toContain("// User: internal comment that must not split");
    expect(conv.messages[0].content).toContain('console.log("Assistant: logging in");');
    expect(conv.messages[1].role).toBe("assistant");
    expect(conv.messages[1].content).toBe("That looks secure.");
  });

  it("falls back to single unknown message with parse_warning when no speaker markers exist", () => {
    const paste = "This is a single block of text copied from somewhere without any user or assistant markers.";
    const conv = parsePaste(paste);

    expect(conv.messages.length).toBe(1);
    expect(conv.messages[0].role).toBe("unknown");
    expect(conv.messages[0].content).toBe(paste);
    expect(conv.meta.parse_warning).toBeDefined();
    expect(String(conv.meta.parse_warning)).toContain("No speaker markers found");
  });

  it("derives a clean conversation title from the first message", () => {
    const paste = `You said:
Explain the difference between optimistic and pessimistic locking in databases.

ChatGPT said:
Optimistic locking assumes collisions are rare...
`;

    const conv = parsePaste(paste);
    expect(conv.title).toBe("Explain the difference between optimistic and pessimistic locking in databases.");
  });
});
