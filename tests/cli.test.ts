import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCLI } from "../src/cli.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("CLI Interface (Milestone M8)", () => {
  let tempDir: string;
  let sampleMdPath: string;
  let dbPath: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-test-"));
    sampleMdPath = path.join(tempDir, "sample_chat.md");
    dbPath = path.join(tempDir, "test_continuity.db");

    const sampleMd = `# Building Event Sourcing with SQLite
> **Source**: https://chatgpt.com/c/test-cli-123
> **Total Turns**: 2

## Turn 1: 👤 User
How should we structure an append-only event log table in SQLite?
---

## Turn 2: 🤖 Assistant
Use an integer primary key autoincrement ID and a payload blob:
\`\`\`sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
\`\`\`
---
`;
    await fs.writeFile(sampleMdPath, sampleMd, "utf-8");
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored for Windows file handles
    }
  });

  it("ml list outputs discovered conversations and metadata", async () => {
    const res = await runCLI(["list", sampleMdPath]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Building Event Sourcing with SQLite");
    expect(res.stdout).toContain("Turns: 2");
  });

  it("ml capsule --dry-run --target claude outputs complete XML handoff offline", async () => {
    const res = await runCLI(["capsule", sampleMdPath, "--dry-run", "--target", "claude"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("<handoff>");
    expect(res.stdout).toContain("<handoff_instructions>");
    expect(res.stdout).toContain("Goal: <1 line>");
    expect(res.stdout).toContain("</handoff>");
  });

  it("ml capsule --dry-run --target gemini --save persists capsule to SQLite", async () => {
    const res = await runCLI([
      "capsule",
      sampleMdPath,
      "--dry-run",
      "--target",
      "gemini",
      "--save",
      "--db",
      dbPath,
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("# State Continuity Handoff");
    expect(res.stdout).toContain("Saved capsule version");
  });

  it("ml show <id> reads saved capsule from SQLite working memory", async () => {
    const res = await runCLI(["show", "sample_chat", "--db", dbPath]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Building Event Sourcing with SQLite");
    expect(res.stdout).toContain("Version: 1");
  });

  it("ml models lists available models or prints helpful guidance when offline", async () => {
    const res = await runCLI(["models"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("gemini-3.1-flash-lite");
    expect(res.stdout).toContain("gemini-3.8-flash");
  });

  it("ml --help displays usage including ml serve command", async () => {
    const res = await runCLI(["--help"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("ml serve [options]");
    expect(res.stdout).toContain("--port <number>");
  });
});
