import { describe, it, expect } from "vitest";
import {
  detectPlatform,
  extractChatGPTFromHTML,
  extractClaudeFromHTML,
  extractGeminiFromHTML,
  cleanTurnContent,
} from "../src/extension/extractors.js";

describe("Milestone M11: Web Extension DOM Extractors", () => {
  it("detects platform correctly from hostname", () => {
    expect(detectPlatform("chatgpt.com")).toBe("chatgpt");
    expect(detectPlatform("chat.openai.com")).toBe("chatgpt");
    expect(detectPlatform("claude.ai")).toBe("claude");
    expect(detectPlatform("gemini.google.com")).toBe("gemini");
    expect(detectPlatform("example.com")).toBe("unknown");
  });

  it("extracts turns from ChatGPT HTML with code blocks and roles", () => {
    const html = `
      <article data-testid="conversation-turn-2">
        <div data-message-author-role="user">
          <p>How do I implement a distributed mutex in Redis with Node?</p>
        </div>
      </article>
      <article data-testid="conversation-turn-3">
        <div data-message-author-role="assistant">
          <p>Here is how to do it safely:</p>
          <pre><code class="language-typescript">export class SafeMutex {
  acquire(): boolean { return true; }
}</code></pre>
        </div>
      </article>
    `;

    const turns = extractChatGPTFromHTML(html);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toContain("How do I implement a distributed mutex");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toContain("SafeMutex");
    expect(turns[1].content).toContain("```typescript");
  });

  it("extracts turns from Claude HTML with user and assistant messages", () => {
    const html = `
      <div data-testid="user-message">
        Why does Redlock fail under clock drift?
      </div>
      <div class="font-claude-message">
        Redlock assumes monotonic physical time bounds. If a system clock steps backward or drifts:
        <pre><code class="language-bash">redis-cli info stats</code></pre>
      </div>
    `;

    const turns = extractClaudeFromHTML(html);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toContain("Why does Redlock fail");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toContain("Redlock assumes monotonic physical time bounds");
    expect(turns[1].content).toContain("```bash");
  });

  it("extracts turns from Gemini HTML with user query and model response", () => {
    const html = `
      <div class="user-query-container">
        Show me the performance.now() elapsed calculation.
      </div>
      <div class="model-response-text">
        Here is the elapsed monotonic clock check:
        <pre><code class="language-typescript">const elapsed = performance.now() - startTime;</code></pre>
      </div>
    `;

    const turns = extractGeminiFromHTML(html);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toContain("Show me the performance.now()");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toContain("const elapsed = performance.now()");
  });

  it("cleans turn content and formats safe markdown code blocks", () => {
    const raw = `
      <div>
        <p>First line</p>
        <pre><code>console.log("hello");</code></pre>
        <p>Second line</p>
      </div>
    `;
    const cleaned = cleanTurnContent(raw);
    expect(cleaned).toContain("First line");
    expect(cleaned).toContain("console.log(\"hello\");");
    expect(cleaned).toContain("Second line");
  });
});
