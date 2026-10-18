import { describe, it, expect } from "vitest";
import { scrubChatGPTUnicodeAndCitations } from "../src/ingest/unicode_scrubber.js";
import { parseScrapedMarkdown } from "../src/ingest/scraped_md.js";
import { detectFormat } from "../src/ingest/index.js";

describe("Unicode & Citation Scrubber (Gotcha #14, Gotcha #17)", () => {
  it("replaces entity groups with their display name outside code fences", () => {
    const raw = 'According to \ue200entity\ue202["website","Semantic Scholar","https://semanticscholar.org"]\ue201 research is promising.';
    const result = scrubChatGPTUnicodeAndCitations(raw);
    expect(result.text).toBe("According to Semantic Scholar research is promising.");
    expect(result.entitiesReplaced).toBe(1);
  });

  it("removes cite groups and remaining PUA characters outside code fences", () => {
    const raw = "Quantum computing is scaling \ue200cite\ue202turn0search3\ue201 rapidly\ue002.";
    const result = scrubChatGPTUnicodeAndCitations(raw);
    expect(result.text).toBe("Quantum computing is scaling  rapidly.");
  });

  it("strips leaked inline file citations outside code fences only", () => {
    const raw = `
Check the implementation fileL8-L28 for details.

\`\`\`python
# This code variable should not be touched
fileL8 = 100
\`\`\`
Another citation at fileL5-L10.
`;
    const result = scrubChatGPTUnicodeAndCitations(raw);
    expect(result.text).toContain("Check the implementation  for details.");
    expect(result.text).toContain("Another citation at .");
    expect(result.text).toContain("fileL8 = 100");
    expect(result.strippedCitations).toBe(2);
  });

  it("preserves private-use Unicode characters if they occur inside code fences", () => {
    const raw = `
Outside \ue200cite\ue202tag\ue201 text.

\`\`\`python
# Unicode inside fence preserved
pua_char = "\\ue200"
\`\`\`
`;
    const result = scrubChatGPTUnicodeAndCitations(raw);
    expect(result.text).toContain('pua_char = "\\ue200"');
    expect(result.text).not.toContain("Outside \ue200");
  });
});

describe("Scraped Markdown Parser (Gotcha #5, #14)", () => {
  const sampleMarkdown = `# Debugging SQLite Concurrency

> **Source**: https://chatgpt.com/c/12345
> **Scraped At**: 2026-10-18T10:00:00Z
> **Total Turns**: 2

## Turn 1: 👤 User
[Attached Document: schema.sql]
We are encountering SQLITE_BUSY errors during concurrent writes.
Here is what we tried:
\`\`\`sql
-- Attempted lock
BEGIN IMMEDIATE;
\`\`\`
---

## Turn 2: 🤖 Assistant
You need to enable WAL mode.
\`\`\`markdown
Inside this fence, watch out:
## Turn 99: 👤 User
Do not split on the line above!
\`\`\`
PRAGMA journal_mode=WAL;
---
`;

  it("parses metadata headers, turns, roles, and trims trailing dashes", () => {
    const conv = parseScrapedMarkdown(sampleMarkdown);
    expect(conv.title).toBe("Debugging SQLite Concurrency");
    expect(conv.source).toBe("https://chatgpt.com/c/12345");
    expect(conv.messages.length).toBe(2);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[1].role).toBe("assistant");
    expect(conv.messages[0].content.endsWith("---")).toBe(false);
    expect(conv.messages[1].content.endsWith("---")).toBe(false);
  });

  it("ignores ## Turn headers inside code fences (Gotcha #5)", () => {
    const conv = parseScrapedMarkdown(sampleMarkdown);
    expect(conv.messages.length).toBe(2);
    expect(conv.messages[1].content).toContain("## Turn 99: 👤 User");
    expect(conv.messages[1].content).toContain("Do not split on the line above!");
  });

  it("records attachments and cleans attachment syntax from content", () => {
    const conv = parseScrapedMarkdown(sampleMarkdown);
    expect(conv.meta.attachments).toEqual(["schema.sql"]);
  });

  it("flags parse_warning when parsed turns do not match Total Turns header", () => {
    const mismatchMd = `# Quick Chat
> **Total Turns**: 5

## Turn 1: 👤 User
Hello
---
`;
    const conv = parseScrapedMarkdown(mismatchMd);
    expect(conv.messages.length).toBe(1);
    expect(conv.meta.parse_warning).toBeDefined();
    expect(String(conv.meta.parse_warning)).toContain("Expected 5 turns from header, but parsed 1 turns");
  });
});

describe("Content-Based Format Detector (Gotcha #14)", () => {
  it("detects scraped markdown from its header structure", () => {
    const content = "# Sample Chat\n> **Source**: https://claude.ai\n## Turn 1: 👤 User\nHello";
    expect(detectFormat(content)).toBe("scraped_md");
  });

  it("detects chatgpt json export from mapping structure", () => {
    const content = JSON.stringify([{ id: "c1", title: "Test", mapping: {} }]);
    expect(detectFormat(content)).toBe("chatgpt_export");
  });

  it("detects plain paste from speaker lines", () => {
    const content = "User: Can you explain transformers?\n\nAssistant: Certainly!";
    expect(detectFormat(content)).toBe("paste");
  });

  it("skips non-chat files like README.md", () => {
    const content = "# My Awesome Project\n\nThis is a standard documentation file with no conversation markers.";
    expect(detectFormat(content)).toBe("unknown");
  });
});
