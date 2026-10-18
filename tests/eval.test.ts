import { describe, it, expect } from "vitest";
import { runEvaluation } from "../eval/run_eval.js";
import path from "node:path";

describe("Milestone M9: Golden Evaluation Harness & Contract Verification", () => {
  it("passes all evaluation benchmarks on sample_debugging test case in offline dry-run mode", async () => {
    const caseDir = path.resolve("eval/cases/sample_debugging");
    const report = await runEvaluation({ caseDir, dryRun: true });

    expect(report.passed).toBe(true);
    expect(report.scores.classification).toBe(1);
    expect(report.scores.artifacts).toBe(1);
    expect(report.scores.sections).toBe(1);
    expect(report.scores.handshake).toBe(1);
    expect(report.totalScore).toBe(100);
  });
});
