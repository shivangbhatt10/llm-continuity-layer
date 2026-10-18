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
 */
export function extractChatGPTFromHTML(html: string): ExtractedTurn[] {
  const turns: ExtractedTurn[] = [];

  // Match conversation turn containers or data-message-author-role blocks
  const turnRegex =
    /<(?:article|div)[^>]*data-message-author-role="(user|assistant)"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
  let match: RegExpExecArray | null;

  while ((match = turnRegex.exec(html)) !== null) {
    const role = match[1].toLowerCase() === "user" ? "user" : "assistant";
    const rawContent = match[2];
    const content = cleanTurnContent(rawContent);
    if (content) {
      turns.push({ role, content });
    }
  }

  // Fallback: search for data-testid="conversation-turn-..." if author-role wasn't matched on parent
  if (turns.length === 0) {
    const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let articleMatch: RegExpExecArray | null;
    while ((articleMatch = articleRegex.exec(html)) !== null) {
      const articleContent = articleMatch[1];
      const role = /data-message-author-role="user"/i.test(articleContent)
        ? "user"
        : /data-message-author-role="assistant"/i.test(articleContent)
        ? "assistant"
        : null;

      if (role) {
        const content = cleanTurnContent(articleContent);
        if (content) {
          turns.push({ role, content });
        }
      }
    }
  }

  return turns;
}

/**
 * Extracts conversation turns from Claude HTML.
 */
export function extractClaudeFromHTML(html: string): ExtractedTurn[] {
  const turns: ExtractedTurn[] = [];

  // Regex to extract user messages and assistant messages sequentially
  const messageRegex =
    /<div[^>]*(data-testid="user-message"|class="[^"]*font-claude-message[^"]*")[^>]*>([\s\S]*?)<\/div>/gi;
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
  // Clean platform suffix from title (e.g. "Fixing bug - ChatGPT" -> "Fixing bug")
  title = title
    .replace(/\s*-\s*ChatGPT$/i, "")
    .replace(/\s*\|\s*Claude$/i, "")
    .replace(/\s*-\s*Gemini$/i, "")
    .trim();

  let turns: ExtractedTurn[] = [];

  if (platform === "chatgpt") {
    // Query DOM nodes directly
    const turnElements = doc.querySelectorAll("[data-message-author-role]");
    turnElements.forEach((el) => {
      const role = el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
      const content = cleanTurnContent(el.innerHTML);
      if (content) turns.push({ role, content });
    });
  } else if (platform === "claude") {
    const userNodes = doc.querySelectorAll('[data-testid="user-message"], .font-user-message');
    const assistantNodes = doc.querySelectorAll(".font-claude-message");
    // Interleave turns by vertical document order
    const all = Array.from(doc.querySelectorAll('[data-testid="user-message"], .font-user-message, .font-claude-message'));
    all.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    all.forEach((el) => {
      const isUser = el.matches('[data-testid="user-message"], .font-user-message');
      const content = cleanTurnContent(el.innerHTML);
      if (content) turns.push({ role: isUser ? "user" : "assistant", content });
    });
  } else if (platform === "gemini") {
    const allTurns = doc.querySelectorAll(".user-query-container, .model-response-text, user-query, model-response");
    allTurns.forEach((el) => {
      const isUser = el.className.includes("user-query") || el.tagName.toLowerCase() === "user-query";
      const content = cleanTurnContent(el.innerHTML);
      if (content) turns.push({ role: isUser ? "user" : "assistant", content });
    });
  }

  // Fallback to HTML string extractor if querySelectorAll returned empty due to DOM shadow roots
  if (turns.length === 0) {
    const bodyHtml = doc.body ? doc.body.innerHTML : "";
    if (platform === "chatgpt") turns = extractChatGPTFromHTML(bodyHtml);
    else if (platform === "claude") turns = extractClaudeFromHTML(bodyHtml);
    else if (platform === "gemini") turns = extractGeminiFromHTML(bodyHtml);
  }

  return { platform, title, turns };
}
