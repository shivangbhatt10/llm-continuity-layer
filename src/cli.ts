#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "./config.js";
import { loadConversations } from "./ingest/index.js";
import { DryRunLLM, GeminiClient } from "./core/llm.js";
import { synthesizeCapsule } from "./core/capsule.js";
import { SQLiteStore } from "./store/db.js";
import { formatCapsule, type TargetProvider } from "./deliver/formatters/index.js";

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Parses and executes CLI commands programmatically.
 */
export async function runCLI(args: string[]): Promise<CLIResult> {
  const outLines: string[] = [];
  const errLines: string[] = [];

  const log = (msg: string) => outLines.push(msg);
  const error = (msg: string) => errLines.push(msg);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    log(`
Cross-Provider LLM Continuity & Memory Layer CLI (ml)

Usage:
  ml list <path>                           List conversations in file or folder
  ml capsule <path> [options]              Synthesize a State Capsule
  ml show <id> [options]                   Inspect a saved capsule in SQLite store
  ml models                                List supported Gemini frontier models

Options for 'capsule':
  --target <claude|gemini|markdown>        Target delivery format (default: gemini)
  --dry-run                                Execute offline with zero API calls
  --save                                   Save capsule into SQLite store
  --db <path>                              SQLite database path (default: continuity.db)
  --out <file>                             Write formatted envelope to file
`.trim());
    return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 0 };
  }

  const command = args[0];

  try {
    switch (command) {
      case "list": {
        const targetPath = args[1] || ".";
        const conversations = await loadConversations(targetPath);

        if (conversations.length === 0) {
          log(`No conversations discovered in: ${targetPath}`);
          return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 0 };
        }

        log(`\nDiscovered ${conversations.length} conversation(s) in: ${targetPath}\n`);
        for (let i = 0; i < conversations.length; i++) {
          const c = conversations[i];
          log(`[${i + 1}] Title: ${c.title}`);
          log(`    ID: ${c.id}`);
          log(`    Source: ${c.source}`);
          log(`    Turns: ${c.messages.length}`);
          if (c.meta.parse_warning) {
            log(`    Warning: ${c.meta.parse_warning}`);
          }
          log("");
        }
        break;
      }

      case "capsule": {
        const targetPath = args[1];
        if (!targetPath) {
          error("Error: Please provide a transcript file path. Example: ml capsule transcript.md");
          return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 1 };
        }

        // Parse options
        const isDryRun = args.includes("--dry-run");
        const shouldSave = args.includes("--save");
        const targetIdx = args.indexOf("--target");
        const target = (targetIdx !== -1 && args[targetIdx + 1] ? args[targetIdx + 1] : "gemini") as TargetProvider;
        const dbIdx = args.indexOf("--db");
        const dbPath = dbIdx !== -1 && args[dbIdx + 1] ? args[dbIdx + 1] : "continuity.db";
        const outIdx = args.indexOf("--out");
        const outFile = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : null;

        const conversations = await loadConversations(targetPath);
        if (conversations.length === 0) {
          error(`Error: No valid conversations found in ${targetPath}`);
          return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 1 };
        }

        const conv = conversations[0];

        // Model selection (Gotcha #12, Gotcha #13)
        let llm;
        if (isDryRun || config.isOffline) {
          llm = new DryRunLLM();
        } else {
          log(`[Privacy Notice] Sending transcript data to Gemini API (${config.cheapModel} & ${config.strongModel})...\n`);
          llm = new GeminiClient();
        }

        const capsule = await synthesizeCapsule(conv, llm);

        // Optional save to SQLite Working Memory
        if (shouldSave) {
          const store = new SQLiteStore(dbPath);
          const saved = store.saveCapsule(capsule);
          store.close();
          log(`[Store] Saved capsule version ${saved.version} for conversation '${saved.conversation_id}' to: ${dbPath}\n`);
        }

        // Target provider envelope formatting
        const formatted = formatCapsule(capsule, target);

        if (outFile) {
          await fs.writeFile(outFile, formatted, "utf-8");
          log(`[Output] Formatted handoff written to: ${outFile}\n`);
        }

        log(formatted);
        break;
      }

      case "show": {
        const id = args[1];
        if (!id) {
          error("Error: Please provide a conversation ID. Example: ml show conv-1");
          return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 1 };
        }

        const dbIdx = args.indexOf("--db");
        const dbPath = dbIdx !== -1 && args[dbIdx + 1] ? args[dbIdx + 1] : "continuity.db";
        const verIdx = args.indexOf("--version");
        const version = verIdx !== -1 && args[verIdx + 1] ? parseInt(args[verIdx + 1], 10) : null;

        const store = new SQLiteStore(dbPath);
        const capsule = version
          ? store.getCapsuleByVersion(id, version)
          : store.getLatestCapsule(id);
        store.close();

        if (!capsule) {
          error(`Error: Capsule for conversation '${id}' not found in ${dbPath}`);
          return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 1 };
        }

        log(`\nConversation: ${capsule.title} (ID: ${capsule.conversation_id})`);
        log(`Version: ${capsule.version}`);
        log(`Source: ${capsule.source}`);
        log(`Types: ${capsule.types.join(", ")}`);
        log(`Next Step: ${capsule.next_step}`);
        log(`Artifacts: ${capsule.artifacts.length}`);
        log(`Recent Turns: ${capsule.recent_turns.length}\n`);

        for (const [sec, text] of Object.entries(capsule.sections)) {
          log(`--- ${sec} ---`);
          log(text);
          log("");
        }
        break;
      }

      case "models": {
        log(`\nConfigured Two-Tier Model Architecture (Gotcha #12):`);
        log(`  Cheap Tier (Classification & Chunking): ${config.cheapModel}`);
        log(`  Strong Tier (State Capsule Synthesis): ${config.strongModel}`);
        if (config.apiKey) {
          log(`\nAPI Key: Detected (${config.apiKey.slice(0, 6)}...${config.apiKey.slice(-4)})`);
        } else {
          log(`\nAPI Key: Not detected in environment (Offline mode active).`);
          log(`To enable live generation, add GEMINI_API_KEY to your .env file.`);
        }
        log(`\nSupported Frontier Models:`);
        log(`  - gemini-3.1-flash-lite (Cost-efficient, ultra-fast for classification & notes)`);
        log(`  - gemini-3.8-flash      (Default strong model for state capsule synthesis)`);
        log(`  - gemini-4-argon        (Frontier reasoning model for ultra-complex sessions)`);
        break;
      }

      default:
        error(`Unknown command: '${command}'. Run 'ml --help' for usage.`);
        return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 1 };
    }

    return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 0 };
  } catch (err: unknown) {
    error(`Fatal error: ${(err as Error).message}`);
    return { stdout: outLines.join("\n"), stderr: errLines.join("\n"), exitCode: 1 };
  }
}

// Direct execution from CLI
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCLI(process.argv.slice(2)).then((res) => {
    if (res.stdout) console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
    process.exit(res.exitCode);
  });
}
