#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConversations } from "../src/ingest/index.js";
import { synthesizeCapsule } from "../src/core/capsule.js";
import { ScriptedLLM, GeminiClient } from "../src/core/llm.js";
import { formatCapsule } from "../src/deliver/formatters/index.js";
import config from "../src/config.js";

export interface EvalOptions {
  caseDir?: string;
  dryRun?: boolean;
  live?: boolean;
}

export interface EvalScores {
  classification: number;
  sections: number;
  ruledOut: number;
  artifacts: number;
  handshake: number;
}

export interface EvalReport {
  passed: boolean;
  totalScore: number;
  scores: EvalScores;
  details: string[];
}

export async function runEvaluation(options: EvalOptions = {}): Promise<EvalReport> {
  const caseDir = options.caseDir || path.resolve("eval/cases/sample_debugging");
  const isDryRun = options.dryRun ?? !options.live;

  const convFile = path.join(caseDir, "conversation.md");
  const caseFile = path.join(caseDir, "case.json");

  const caseData = JSON.parse(await fs.readFile(caseFile, "utf-8"));
  const conversations = await loadConversations(convFile);
  const conv = conversations[0];

  let llm;
  if (isDryRun || config.isOffline) {
    const scripted = new ScriptedLLM();
    scripted.onTask("classify", JSON.stringify(caseData.expected_types));
    scripted.onTask(
      "capsule",
      `
## Goal
Resolve Redlock distributed lock acquisition timeouts in Redis cluster.

## Decisions and Rationale
Implemented DriftCompensatedMutex measuring local monotonic clock elapsed time to validate lease validity.

## Constraints and Preferences
Cluster configuration must remain valid without disabling security bounds.

## Symptom and Exact Error
Redlock acquisition timeout: failed to acquire lock on 3 of 5 nodes within 1500ms.

## Ruled Out (with why)
Increasing lock timeout from 1500ms to 10000ms strictly ruled out: caused cascading thread pool starvation and memory exhaustion under load.

## Stack and Environment
TypeScript, Redis cluster, Redlock protocol.

## Files and Components
\`redis_mutex.ts\`: DriftCompensatedMutex class with monotonic drift compensation.

## Conventions to Follow
Use performance.now() for monotonic elapsed timing.

## Implemented vs Pending
Implemented DriftCompensatedMutex; pending clock drift stress testing.

## Current State
DriftCompensatedMutex implemented with local elapsed compensation.

## Open Questions
None.

## Next Step
Run clock drift unit tests with fake timers.
`.trim()
    );
    llm = scripted;
  } else {
    llm = new GeminiClient();
  }

  const capsule = await synthesizeCapsule(conv, llm);
  const claudeEnvelope = formatCapsule(capsule, "claude");
  const geminiEnvelope = formatCapsule(capsule, "gemini");

  const details: string[] = [];
  const scores: EvalScores = {
    classification: 0,
    sections: 0,
    ruledOut: 0,
    artifacts: 0,
    handshake: 0,
  };

  // 1. Classification Check
  const hasAllTypes = caseData.expected_types.every((t: string) => capsule.types.includes(t as any));
  if (hasAllTypes) {
    scores.classification = 1;
    details.push("✓ Domain Classification: Correctly identified " + capsule.types.join(", "));
  } else {
    details.push("✗ Domain Classification: Missing expected types " + caseData.expected_types);
  }

  // 2. Required Sections Check
  const missingRequired = caseData.required_sections.filter(
    (sec: string) => !capsule.sections[sec] || capsule.sections[sec] === "Not established in the conversation."
  );
  if (missingRequired.length === 0) {
    scores.sections = 1;
    details.push("✓ Required Sections: All required sections established");
  } else {
    details.push("✗ Required Sections: Missing or unestablished " + missingRequired.join(", "));
  }

  // 3. Ruled Out Preservation Check
  const ruledOutText = (capsule.sections["Ruled Out (with why)"] || "").toLowerCase();
  const hasRuledOut = caseData.ruled_out_terms.some((term: string) => ruledOutText.includes(term.toLowerCase()));
  if (hasRuledOut) {
    scores.ruledOut = 1;
    details.push("✓ Ruled Out Preservation: Captured dead-end approach: '" + capsule.sections["Ruled Out (with why)"] + "'");
  } else {
    details.push("✗ Ruled Out Preservation: Failed to record ruled-out dead end");
  }

  // 4. Verbatim Artifact Fidelity Check
  const combinedArtifactCode = capsule.artifacts.map((a) => a.code).join("\n");
  const hasSymbols = caseData.required_symbols.every((sym: string) => combinedArtifactCode.includes(sym));
  if (hasSymbols && capsule.artifacts.length > 0) {
    scores.artifacts = 1;
    details.push("✓ Verbatim Artifact Fidelity: Exact code symbols preserved without LLM paraphrase");
  } else {
    details.push("✗ Verbatim Artifact Fidelity: Missing required symbols in code blocks");
  }

  // 5. 3-Line Handshake Check
  const claudeHasHandshake =
    claudeEnvelope.includes("Goal: <1 line>") &&
    claudeEnvelope.includes("Current State: <1 line>") &&
    claudeEnvelope.includes("Next Step: <1 line>");
  const geminiHasHandshake =
    geminiEnvelope.includes("Goal: <1 line>") &&
    geminiEnvelope.includes("Current State: <1 line>") &&
    geminiEnvelope.includes("Next Step: <1 line>");

  if (claudeHasHandshake && geminiHasHandshake) {
    scores.handshake = 1;
    details.push("✓ 3-Line Handshake: Directive present in both Claude XML and Gemini Markdown envelopes");
  } else {
    details.push("✗ 3-Line Handshake: Missing handshake directive in envelopes");
  }

  const totalPoints =
    scores.classification + scores.sections + scores.ruledOut + scores.artifacts + scores.handshake;
  const totalScore = (totalPoints / 5) * 100;
  const passed = totalScore === 100;

  return { passed, totalScore, scores, details };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const isLive = process.argv.includes("--live");
  const isDryRun = process.argv.includes("--dry-run") || !isLive;

  console.log(`\n======================================================`);
  console.log(` Running Golden Session Continuity Benchmark (${isDryRun ? "Offline Dry-Run" : "Live Gemini API"})`);
  console.log(`======================================================\n`);

  runEvaluation({ dryRun: isDryRun, live: isLive })
    .then((report) => {
      for (const d of report.details) {
        console.log(d);
      }
      console.log(`\nTotal Continuity Score: ${report.totalScore}% (${report.passed ? "PASSED" : "FAILED"})\n`);
      process.exit(report.passed ? 0 : 1);
    })
    .catch((err) => {
      console.error("Evaluation runtime failure:", err);
      process.exit(1);
    });
}
