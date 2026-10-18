import crypto from "node:crypto";
import path from "node:path";
import type { Artifact, Message } from "./schema.js";

/**
 * Extracts declared symbols (functions, classes, interfaces, types) from code (Gotcha #18).
 */
export function extractSymbols(code: string, lang: string = ""): Set<string> {
  const symbols = new Set<string>();
  const l = lang.toLowerCase();

  // Python symbols: def foo, class Bar
  if (l === "python" || l === "py") {
    const pyRegex = /^\s*(?:async\s+)?(?:def|class)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = pyRegex.exec(code)) !== null) {
      symbols.add(match[1]);
    }
    return symbols;
  }

  // TypeScript / JavaScript symbols: function, class, interface, type, const
  if (["typescript", "ts", "javascript", "js", "tsx", "jsx"].includes(l)) {
    const tsRegex = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = tsRegex.exec(code)) !== null) {
      symbols.add(match[1]);
    }
    return symbols;
  }

  // Go symbols: func Foo, type Bar
  if (l === "go") {
    const goRegex = /^\s*(?:func(?:\s*\([^)]*\))?|type)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = goRegex.exec(code)) !== null) {
      symbols.add(match[1]);
    }
    return symbols;
  }

  // Rust symbols: fn foo, struct Bar, enum Baz, trait Qux
  if (l === "rust" || l === "rs") {
    const rsRegex = /^\s*(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = rsRegex.exec(code)) !== null) {
      symbols.add(match[1]);
    }
    return symbols;
  }

  // General fallback: match any function/class/def
  const genRegex = /^\s*(?:export\s+)?(?:def|function|class|interface|type|fn)\s+([a-zA-Z0-9_]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = genRegex.exec(code)) !== null) {
    symbols.add(match[1]);
  }

  return symbols;
}

/**
 * Extracts code blocks from conversation messages using backreference fences (Gotcha #6).
 * Preserves preceding file labels (e.g. ## 📄 `app/services/x.py`).
 */
export function extractArtifacts(messages: Message[]): Artifact[] {
  const artifacts: Artifact[] = [];

  // Gotcha #6: Regex with backreference to match closing fence of exact equal length
  // e.g. ````markdown ... ```` captures nested ```python blocks whole
  const FENCE_REGEX = /^(`{3,})([^\n]*)\n([\s\S]*?)^\1\s*$/gm;
  const LABEL_REGEX = /(?:##|\*\*|📄)?\s*`?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)`?\s*$/m;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    const content = msg.content;

    let match: RegExpExecArray | null;
    FENCE_REGEX.lastIndex = 0;

    while ((match = FENCE_REGEX.exec(content)) !== null) {
      const lang = match[2].trim() || "text";
      const code = match[3].replace(/\n$/, ""); // strip single trailing newline

      // Look at the text immediately preceding the fence (up to 200 chars) for file labels
      const preText = content.slice(Math.max(0, match.index - 200), match.index);
      const preLines = preText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      let label: string | null = null;

      if (preLines.length > 0) {
        const lastPreLine = preLines[preLines.length - 1];
        const labelMatch = lastPreLine.match(LABEL_REGEX);
        if (labelMatch) {
          label = labelMatch[1].trim();
        }
      }

      const sha256 = crypto.createHash("sha256").update(code.trim()).digest("hex");

      artifacts.push({
        lang,
        code,
        message_index: msgIdx,
        role: msg.role,
        label,
        sha256,
      });
    }
  }

  return artifacts;
}

const SHELL_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

function isNoiseBlock(artifact: Artifact): boolean {
  const trimmed = artifact.code.trim();

  // Keep all shell commands
  if (SHELL_LANGS.has(artifact.lang.toLowerCase())) {
    return false;
  }

  // Keep blocks > 150 chars
  if (trimmed.length >= 150) {
    return false;
  }

  // Under 150 chars: Check if it's pure URLs, search queries, or minimal JSON without code logic
  const isUrl = /^https?:\/\/\S+$/m.test(trimmed) && !trimmed.includes("const ") && !trimmed.includes("def ");
  const isPlainJson = (trimmed.startsWith("{") && trimmed.endsWith("}")) && !trimmed.includes("function") && !trimmed.includes("def");

  return isUrl || isPlainJson;
}

/**
 * Symbol-Aware Code Block Deduplication Engine (Gotcha #18 - The 96-Block Rule).
 * 
 * Rules:
 * 1. Never deduplicate purely by language + first line.
 * 2. Exact duplicates collapse to the newest block.
 * 3. Filter noise blocks (<150 chars of URLs or static JSON).
 * 4. Merge scattered 1-line shell commands into a single deduplicated shell script block.
 * 5. A newer block supersedes an older block ONLY if it defines every symbol defined by the older block.
 */
export function deduplicateArtifacts(artifacts: Artifact[]): Artifact[] {
  if (artifacts.length === 0) return [];

  // Step 1: Filter noise blocks
  const filtered = artifacts.filter((a) => !isNoiseBlock(a));

  // Step 2: Extract and merge scattered single-line shell commands
  const shellCommands: string[] = [];
  const nonShellArtifacts: Artifact[] = [];
  let firstShellMessageIndex = 0;

  for (const art of filtered) {
    if (SHELL_LANGS.has(art.lang.toLowerCase()) && !art.label) {
      const lines = art.code
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));

      if (shellCommands.length === 0) {
        firstShellMessageIndex = art.message_index;
      }

      for (const line of lines) {
        if (!shellCommands.includes(line)) {
          shellCommands.push(line);
        }
      }
    } else {
      nonShellArtifacts.push(art);
    }
  }

  // Step 3: Exact duplicate collapse (keep newest message_index)
  const dedupedMap = new Map<string, Artifact>();
  for (const art of nonShellArtifacts) {
    const key = art.sha256 || art.code.trim();
    const existing = dedupedMap.get(key);
    if (!existing || art.message_index >= existing.message_index) {
      dedupedMap.set(key, art);
    }
  }

  const uniqueArtifacts = Array.from(dedupedMap.values());

  // Step 4: Symbol-aware superseding
  // Group candidates by label (basename) or symbol overlap
  const finalArtifacts: Artifact[] = [];
  const supersededIndices = new Set<number>();

  for (let i = 0; i < uniqueArtifacts.length; i++) {
    const older = uniqueArtifacts[i];
    const olderSymbols = extractSymbols(older.code, older.lang);

    for (let j = i + 1; j < uniqueArtifacts.length; j++) {
      const newer = uniqueArtifacts[j];

      // Check if they are candidates for the same file
      const sameLabel =
        older.label &&
        newer.label &&
        path.basename(older.label).toLowerCase() === path.basename(newer.label).toLowerCase();

      // Same first line protection: NEVER supersede unless same label or strict symbol superset
      const newerSymbols = extractSymbols(newer.code, newer.lang);

      if (sameLabel) {
        // If same label, newer supersedes older ONLY if newer defines all symbols of older
        // OR newer contains 100% of lines of older
        const hasAllSymbols =
          olderSymbols.size > 0 &&
          Array.from(olderSymbols).every((s) => newerSymbols.has(s));

        const containsAllLines = older.code.length > 0 && newer.code.includes(older.code.trim());

        if (hasAllSymbols || containsAllLines) {
          supersededIndices.add(i);
          break;
        }
      } else if (olderSymbols.size > 0 && newerSymbols.size > 0 && older.lang === newer.lang) {
        // Without labels: newer supersedes older only if newer defines every symbol AND more
        const isStrictSuperset =
          newerSymbols.size >= olderSymbols.size &&
          Array.from(olderSymbols).every((s) => newerSymbols.has(s));

        if (isStrictSuperset) {
          supersededIndices.add(i);
          break;
        }
      }
    }

    if (!supersededIndices.has(i)) {
      finalArtifacts.push(older);
    }
  }

  // Append merged shell block if commands were collected
  if (shellCommands.length > 0) {
    finalArtifacts.push({
      lang: "bash",
      code: shellCommands.join("\n"),
      message_index: firstShellMessageIndex,
      role: "assistant",
    });
  }

  return finalArtifacts;
}
