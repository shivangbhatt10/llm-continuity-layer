import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { linearizeChatGPTBranch } from "../core/linearize.js";
import type {
  Conversation,
  Message,
  Role,
  RawChatGPTConversation,
  ChatGPTMappingNode,
} from "../core/schema.js";

/** Internal content types that should never leak into canonical turns (Gotcha #2) */
export const INTERNAL_CONTENT_TYPES = new Set([
  "thoughts",
  "reasoning_recap",
  "user_editable_context",
  "model_editable_context",
  "tether_browsing_display",
  "tether_quote",
  "system_error",
]);

const MAX_TOOL_OUTPUT_CHARS = 2000;

/**
 * Extracts and formats text content from a ChatGPT message node.
 * Wraps code blocks with fences and language tags, and truncates tool outputs (Gotcha #3).
 */
function extractNodeContent(node: ChatGPTMappingNode): string {
  const content = node.message?.content;
  if (!content) return "";

  const contentType = content.content_type || "text";

  // Code content type (Gotcha #3)
  if (contentType === "code") {
    const lang = (content.language as string) || "";
    let codeBody = "";
    if (typeof content.text === "string") {
      codeBody = content.text;
    } else if (Array.isArray(content.parts)) {
      codeBody = content.parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("\n");
    }
    return `\`\`\`${lang}\n${codeBody}\n\`\`\``;
  }

  // Execution output from tools (Gotcha #3)
  if (contentType === "execution_output") {
    let out = "";
    if (typeof content.text === "string") {
      out = content.text;
    } else if (Array.isArray(content.parts)) {
      out = content.parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("\n");
    }
    if (out.length > MAX_TOOL_OUTPUT_CHARS) {
      const head = out.slice(0, 1000);
      const tail = out.slice(-800);
      out = `${head}\n\n[... output truncated ...]\n\n${tail}`;
    }
    return out;
  }

  // Standard text content
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const maybeText = (part as { text?: unknown }).text;
          if (typeof maybeText === "string") return maybeText;
          return JSON.stringify(part);
        }
        return String(part ?? "");
      })
      .filter((s) => s.length > 0)
      .join("\n");
  }

  if (typeof content.text === "string") {
    return content.text;
  }

  return "";
}

/**
 * Normalizes author role to canonical Role type.
 */
function normalizeRole(authorRole?: string): Role {
  if (!authorRole) return "unknown";
  const r = authorRole.toLowerCase();
  if (r === "user") return "user";
  if (r === "assistant") return "assistant";
  if (r === "tool") return "tool";
  return "unknown";
}

/**
 * Parses a single raw ChatGPT conversation into the canonical Conversation schema.
 * 
 * Enforces:
 * - Gotcha #1: Linearization of mapping tree from current_node.
 * - Gotcha #2: Filtering system roles, hidden nodes, and internal thought steps.
 * - Gotcha #3: Merging consecutive assistant turns and formatting code blocks.
 */
export function parseChatGPTConversation(raw: RawChatGPTConversation): Conversation {
  const activeNodes = linearizeChatGPTBranch(raw.mapping, raw.current_node);
  const messages: Message[] = [];

  for (const node of activeNodes) {
    const msg = node.message;
    if (!msg || !msg.author) continue;

    // Filter out system messages (Gotcha #2)
    if (msg.author.role === "system") continue;

    // Filter out visually hidden nodes (Gotcha #2)
    if (msg.metadata?.is_visually_hidden_from_conversation === true) continue;

    // Filter out internal thought/reasoning content types (Gotcha #2)
    const contentType = msg.content?.content_type;
    if (contentType && INTERNAL_CONTENT_TYPES.has(contentType)) continue;

    const role = normalizeRole(msg.author.role);
    const content = extractNodeContent(node).trim();
    if (!content) continue;

    const messageId = msg.id || node.id;
    const ts = msg.create_time ? Math.floor(msg.create_time * 1000) : null;

    // Merge consecutive assistant messages (Gotcha #3: prose + code execution split)
    if (role === "assistant" && messages.length > 0 && messages[messages.length - 1].role === "assistant") {
      messages[messages.length - 1].content = `${messages[messages.length - 1].content}\n\n${content}`;
    } else {
      messages.push({
        role,
        content,
        id: messageId,
        ts,
      });
    }
  }

  return {
    id: raw.id,
    source: "chatgpt",
    title: raw.title || "Untitled",
    messages,
    created_at: raw.create_time ? Math.floor(raw.create_time * 1000) : null,
    updated_at: raw.update_time ? Math.floor(raw.update_time * 1000) : null,
    meta: {
      original_node_count: Object.keys(raw.mapping || {}).length,
      active_node_count: activeNodes.length,
    },
  };
}

/**
 * Loads conversations from a single conversations.json, sharded folder, or .zip archive (Gotcha #4).
 */
export async function loadChatGPTExport(targetPath: string): Promise<Conversation[]> {
  const stat = await fs.stat(targetPath);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(targetPath);
    // Find conversations*.json or any .json files
    let jsonFiles = entries.filter((f) => f.startsWith("conversations") && f.endsWith(".json"));
    if (jsonFiles.length === 0) {
      jsonFiles = entries.filter((f) => f.endsWith(".json"));
    }

    const conversations: Conversation[] = [];
    for (const f of jsonFiles) {
      const fullPath = path.join(targetPath, f);
      const parsed = await loadChatGPTExport(fullPath);
      conversations.push(...parsed);
    }
    return conversations;
  }

  // Handle .zip archive
  if (targetPath.endsWith(".zip")) {
    const tempExtractDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-zip-"));
    try {
      execSync(`tar -xf "${targetPath}" -C "${tempExtractDir}"`);
      return await loadChatGPTExport(tempExtractDir);
    } finally {
      await fs.rm(tempExtractDir, { recursive: true, force: true });
    }
  }

  // Handle single .json file
  if (targetPath.endsWith(".json")) {
    const rawData = await fs.readFile(targetPath, "utf-8");
    const parsedJson = JSON.parse(rawData);

    if (Array.isArray(parsedJson)) {
      return parsedJson.map((item) => parseChatGPTConversation(item as RawChatGPTConversation));
    } else if (parsedJson && typeof parsedJson === "object" && "mapping" in parsedJson) {
      return [parseChatGPTConversation(parsedJson as RawChatGPTConversation)];
    }
  }

  return [];
}
