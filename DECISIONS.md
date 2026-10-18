# Architectural Decision Log (DECISIONS.md)

This log records architectural decisions, rationale, deviations, and edge cases encountered during the phased implementation of `llm-continuity-layer`.

---

## ADR-0001: Node.js ESM Foundation & Two-Tier Model Routing Precedence

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**: 
  Session continuity requires ingesting potentially long multi-turn conversations and synthesizing state capsules. Processing these transcripts with large frontier reasoning models exclusively creates prohibitive latency and cost ($O(N)$ token usage on chunking). Additionally, testing must be 100% offline-first without requiring real API keys.
- **Decision**:
  1. Standardize on Node.js modern ESM (`"type": "module"`, `NodeNext` module resolution) and TypeScript.
  2. Implement a two-tier model configuration in `src/config.ts`:
     - `cheapModel`: Defaults to `gemini-3.1-flash-lite` (used for `classify`, `chunk_summary`, `merge_notes`).
     - `strongModel`: Defaults to `gemini-3.8-flash` (used for `capsule` synthesis).
     - Universal `ML_MODEL` override: When set, it overrides both tiers to enable single-model execution when preferred.
  3. Support completely offline configuration evaluation: If `GEMINI_API_KEY` is not present in the environment, the configuration system initializes safely with `apiKey: undefined` rather than throwing at import time.
- **Alternatives Rejected**:
  - *Single hardcoded model*: Rejected because running map-reduce chunking on long transcripts through expensive reasoning models exhausts quotas and incurs unnecessary cost.
  - *Runtime throw on missing API key*: Rejected because unit tests and `--dry-run` CLI operations must run without requiring live network access or active API keys.
- **Consequences**:
  - Clean separation between cheap classification/chunking steps and strong synthesis steps.
  - Complete offline determinism for Vitest test runs.

---

## ADR-0002: ChatGPT Tree Linearization via Backward Parent Traversal

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**:
  ChatGPT export files represent conversations as trees where prompt revisions, model regenerations, and branching happen inside a single `mapping` dictionary (Gotcha #1). Iterating the dictionary keys produces an unordered transcript with abandoned dead-end drafts interspersed with valid turns.
- **Decision**:
  1. Primary Path: When `current_node` is present, traverse backward along `parent` links until the root is reached, using a `visited` set to prevent cycles, and reverse the array to reconstruct the exact active chronological branch.
  2. Fallback Path: If `current_node` is null or missing, locate the root node (`parent === null`) and traverse forward by always selecting the *last child* (`children[children.length - 1]`), corresponding to the latest edit or generation.
- **Alternatives Rejected**:
  - *Iterating mapping dictionary keys*: Rejected because key iteration order bears no relation to conversation chronology and scrambles distinct branches.
  - *Topological sorting of all nodes*: Rejected because it includes abandoned branches and regenerations that the user discarded.
- **Consequences**:
  - Downstream ingest modules receive a clean, single chronological array of nodes.

