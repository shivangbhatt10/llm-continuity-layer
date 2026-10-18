export type Platform = "chatgpt" | "claude" | "gemini" | "unknown";

export interface ExtractedTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SessionExtraction {
  platform: Platform;
  title: string;
  turns: ExtractedTurn[];
}

/**
 * Detects the active AI web surface from the window hostname.
 */
export function detectPlatform(hostname: string): Platform {
  const host = hostname.toLowerCase();
  if (host.includes("chatgpt.com") || host.includes("openai.com")) {
    return "chatgpt";
  }
  if (host.includes("claude.ai")) {
    return "claude";
  }
  if (host.includes("gemini.google.com")) {
    return "gemini";
  }
  return "unknown";
}

/**
 * Decodes standard HTML entities into plain text.
 */
function decodeEntities(encoded: string): string {
  return encoded
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Converts HTML fragments with `<pre><code>` blocks into clean, fenced Markdown text.
 */
export function cleanTurnContent(html: string): string {
  let text = html;

  // Replace <pre><code class="language-xyz">...</code></pre> with fenced code
  text = text.replace(
    /<pre[^>]*><code(?: class="[^"]*language-([a-zA-Z0-9#+_-]+)[^"]*")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, lang, code) => {
      const languageTag = lang || "";
      const decodedCode = decodeEntities(code.replace(/<[^>]+>/g, "").trim());
      return `\n\`\`\`${languageTag}\n${decodedCode}\n\`\`\`\n`;
    }
  );

  // Replace paragraph endings and line breaks with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities and collapse excessive blank lines
  text = decodeEntities(text);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Extracts conversation turns from ChatGPT HTML / articles.
 * Resilient to modern 2024-2026 ChatGPT DOM updates.
 */
export function extractChatGPTFromHTML(html: string): ExtractedTurn[] {
  const turns: ExtractedTurn[] = [];

  // 1. Scan for <article> blocks or conversation-turn containers
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let articleMatch: RegExpExecArray | null;

  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const block = articleMatch[1];
    let role: "user" | "assistant" | null = null;

    if (
      /data-message-author-role="user"/i.test(block) ||
      />\s*You\s+said:?\s*</i.test(block) ||
      /<h[1-6][^>]*class="[^"]*sr-only[^"]*"[^>]*>\s*You said:?\s*<\/h[1-6]>/i.test(block)
    ) {
      role = "user";
    } else if (
      /data-message-author-role="assistant"/i.test(block) ||
      />\s*(?:ChatGPT|Assistant)\s+said:?\s*</i.test(block) ||
      /<h[1-6][^>]*class="[^"]*sr-only[^"]*"[^>]*>\s*(?:ChatGPT|Assistant) said:?\s*<\/h[1-6]>/i.test(block)
    ) {
      role = "assistant";
    } else if (/<div[^>]*class="[^"]*markdown[^"]*"[^>]*>/i.test(block)) {
      role = "assistant";
    } else if (/<div[^>]*class="[^"]*whitespace-pre-wrap[^"]*"[^>]*>/i.test(block)) {
      role = "user";
    }

    if (role) {
      // Strip accessibility heading before cleaning content
      const cleanBlock = block.replace(
        /<(?:h[1-6]|div|span)[^>]*>(?:You said|ChatGPT said|Assistant said):?<\/(?:h[1-6]|div|span)>/gi,
        ""
      );
      const content = cleanTurnContent(cleanBlock);
      if (content) {
        turns.push({ role, content });
      }
    }
  }

  // 2. Fallback: match direct data-message-author-role blocks
  if (turns.length === 0) {
    const turnRegex =
      /<(?:article|div|section)[^>]*data-message-author-role="(user|assistant)"[^>]*>([\s\S]*?)<\/(?:article|div|section)>/gi;
    let match: RegExpExecArray | null;

    while ((match = turnRegex.exec(html)) !== null) {
      const role = match[1].toLowerCase() === "user" ? "user" : "assistant";
      const content = cleanTurnContent(match[2]);
      if (content) {
        turns.push({ role, content });
      }
    }
  }

  // 3. Fallback: Parse speaker markers from lines
  if (turns.length === 0) {
    const lines = html.replace(/<[^>]+>/g, "\n").split("\n");
    let currentRole: "user" | "assistant" | null = null;
    let currentLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (/^You said:?$/i.test(line)) {
        if (currentRole && currentLines.length > 0) {
          turns.push({ role: currentRole, content: currentLines.join("\n").trim() });
          currentLines = [];
        }
        currentRole = "user";
      } else if (/^(?:ChatGPT|Assistant) said:?$/i.test(line)) {
        if (currentRole && currentLines.length > 0) {
          turns.push({ role: currentRole, content: currentLines.join("\n").trim() });
          currentLines = [];
        }
        currentRole = "assistant";
      } else if (currentRole) {
        currentLines.push(line);
      }
    }

    if (currentRole && currentLines.length > 0) {
      turns.push({ role: currentRole, content: currentLines.join("\n").trim() });
    }
  }

  return turns;
}

/**
 * Extracts conversation turns from Claude HTML.
 */
export function extractClaudeFromHTML(html: string): ExtractedTurn[] {
  const turns: ExtractedTurn[] = [];

  const messageRegex =
    /<div[^>]*(data-testid="user-message"|class="[^"]*(?:font-claude-message|font-user-message|standard-markdown)[^"]*")[^>]*>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;

  while ((match = messageRegex.exec(html)) !== null) {
    const isUser = match[1].includes("user-message");
    const role = isUser ? "user" : "assistant";
    const content = cleanTurnContent(match[2]);
    if (content) {
      turns.push({ role, content });
    }
  }

  return turns;
}

/**
 * Extracts conversation turns from Gemini HTML.
 */
export function extractGeminiFromHTML(html: string): ExtractedTurn[] {
  const turns: ExtractedTurn[] = [];

  const turnRegex =
    /<(?:div|user-query|model-response)[^>]*(class="[^"]*(user-query-container|model-response-text)[^"]*"|user-query|model-response)[^>]*>([\s\S]*?)<\/(?:div|user-query|model-response)>/gi;
  let match: RegExpExecArray | null;

  while ((match = turnRegex.exec(html)) !== null) {
    const indicator = match[1].toLowerCase();
    const isUser = indicator.includes("user-query");
    const role = isUser ? "user" : "assistant";
    const content = cleanTurnContent(match[3]);
    if (content) {
      turns.push({ role, content });
    }
  }

  return turns;
}

/**
 * Browser-native extraction running inside content scripts.
 */
export function extractActiveSession(doc: Document = document): SessionExtraction {
  const platform = detectPlatform(window.location.hostname);
  let title = doc.title || "Active AI Session";
  title = title
    .replace(/\s*-\s*ChatGPT$/i, "")
    .replace(/\s*\|\s*Claude$/i, "")
    .replace(/\s*-\s*Gemini$/i, "")
    .trim();

  let turns: ExtractedTurn[] = [];

  if (platform === "chatgpt") {
    // 1. Check <article> elements
    const articles = doc.querySelectorAll("article, [data-testid^='conversation-turn']");
    if (articles.length > 0) {
      articles.forEach((art, idx) => {
        let role: "user" | "assistant" | null = null;
        const authorAttr =
          art.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role") ||
          art.getAttribute("data-message-author-role");

        if (authorAttr === "user" || authorAttr === "assistant") {
          role = authorAttr as "user" | "assistant";
        } else {
          const textHeader = art.querySelector("h5, h6, .sr-only")?.textContent || "";
          if (/you said/i.test(textHeader)) {
            role = "user";
          } else if (/chatgpt said|assistant said/i.test(textHeader)) {
            role = "assistant";
          } else if (art.querySelector(".markdown")) {
            role = "assistant";
          } else if (art.querySelector(".whitespace-pre-wrap")) {
            role = "user";
          } else {
            role = idx % 2 === 0 ? "user" : "assistant";
          }
        }

        const clone = art.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".sr-only, h5, h6").forEach((el) => {
          if (/said/i.test(el.textContent || "")) el.remove();
        });

        const targetContainer =
          role === "assistant" && clone.querySelector(".markdown")
            ? clone.querySelector(".markdown")!
            : role === "user" && clone.querySelector(".whitespace-pre-wrap")
            ? clone.querySelector(".whitespace-pre-wrap")!
            : clone;

        const content = cleanTurnContent(targetContainer.innerHTML);
        if (content) turns.push({ role, content });
      });
    }

    // 2. Direct attribute fallback
    if (turns.length === 0) {
      const turnElements = doc.querySelectorAll("[data-message-author-role]");
      turnElements.forEach((el) => {
        const role = el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
        const content = cleanTurnContent(el.innerHTML);
        if (content) turns.push({ role, content });
      });
    }
  } else if (platform === "claude") {
    const all = Array.from(
      doc.querySelectorAll('[data-testid="user-message"], .font-user-message, .font-claude-message')
    );
    all.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    all.forEach((el) => {
      const isUser = el.matches('[data-testid="user-message"], .font-user-message');
      const content = cleanTurnContent(el.innerHTML);
      if (content) turns.push({ role: isUser ? "user" : "assistant", content });
    });
  } else if (platform === "gemini") {
    const allTurns = Array.from(
      doc.querySelectorAll(".user-query-container, .model-response-text, user-query, model-response")
    );
    allTurns.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    allTurns.forEach((el) => {
      const isUser = el.className.includes("user-query") || el.tagName.toLowerCase() === "user-query";
      const content = cleanTurnContent(el.innerHTML);
      if (content) turns.push({ role: isUser ? "user" : "assistant", content });
    });
  }

  // Universal HTML and text fallback
  if (turns.length === 0 && doc.body) {
    const bodyHtml = doc.body.innerHTML;
    if (platform === "chatgpt") turns = extractChatGPTFromHTML(bodyHtml);
    else if (platform === "claude") turns = extractClaudeFromHTML(bodyHtml);
    else if (platform === "gemini") turns = extractGeminiFromHTML(bodyHtml);
  }

  return { platform, title, turns };
}
