import fs from "node:fs/promises";
import path from "node:path";
import type { Conversation } from "../core/schema.js";
import { parseScrapedMarkdown } from "./scraped_md.js";
import { loadChatGPTExport } from "./chatgpt_export.js";

export type IngestFormat = "scraped_md" | "chatgpt_export" | "paste" | "unknown";

/**
 * Inspects file content (not just extension) to detect transcript format (Gotcha #14).
 * Safely skips non-chat files like README.md.
 */
export function detectFormat(content: string): IngestFormat {
  const trimmed = content.trim();

  // 1. ChatGPT JSON export check
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.includes('"mapping"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && "mapping" in parsed[0]) {
        return "chatgpt_export";
      }
      if (parsed && typeof parsed === "object" && "mapping" in parsed) {
        return "chatgpt_export";
      }
    } catch {
      // Ignore JSON parse errors and continue checks
    }
  }

  // 2. Scraped Markdown check: requires Turn headers and metadata quotes
  const hasTurnHeader = /^## Turn \d+:\s*(?:[^\w\s]*\s*)?(User|Assistant)/m.test(content);
  const hasScrapedMetadata = />\s*\*\*(?:Source|Scraped At|Total Turns)\*\*/i.test(content);

  if (hasTurnHeader && (hasScrapedMetadata || content.includes("# "))) {
    return "scraped_md";
  }

  // 3. Raw clipboard paste check: speaker markers (outside fences)
  const PASTE_MARKERS = /^(?:You said:|ChatGPT said:|User:|Human:|Claude:|Assistant:|Gemini:)/m;
  if (PASTE_MARKERS.test(content)) {
    return "paste";
  }

  return "unknown";
}

/**
 * Loads conversations from a file or folder, automatically dispatching to the right parser.
 */
export async function loadConversations(targetPath: string): Promise<Conversation[]> {
  const stat = await fs.stat(targetPath);

  if (stat.isDirectory()) {
    // Check if it's a sharded ChatGPT export or folder of files
    const entries = await fs.readdir(targetPath);
    if (entries.some((f) => f.startsWith("conversations") && f.endsWith(".json"))) {
      return loadChatGPTExport(targetPath);
    }

    const conversations: Conversation[] = [];
    for (const file of entries) {
      const fullPath = path.join(targetPath, file);
      const subStat = await fs.stat(fullPath);
      if (subStat.isFile()) {
        const fileContent = await fs.readFile(fullPath, "utf-8");
        const format = detectFormat(fileContent);
        if (format === "scraped_md") {
          conversations.push(parseScrapedMarkdown(fileContent, path.basename(file, path.extname(file))));
        } else if (format === "chatgpt_export") {
          const exportConv = await loadChatGPTExport(fullPath);
          conversations.push(...exportConv);
        }
      }
    }
    return conversations;
  }

  if (targetPath.endsWith(".zip")) {
    return loadChatGPTExport(targetPath);
  }

  const content = await fs.readFile(targetPath, "utf-8");
  const format = detectFormat(content);

  switch (format) {
    case "scraped_md":
      return [parseScrapedMarkdown(content, path.basename(targetPath, path.extname(targetPath)))];
    case "chatgpt_export":
      return loadChatGPTExport(targetPath);
    case "paste":
      // Delegated to paste_parser (M3b)
      return [parseScrapedMarkdown(content, path.basename(targetPath, path.extname(targetPath)))];
    default:
      throw new Error(`Unsupported or unrecognized transcript format in ${targetPath}`);
  }
}
