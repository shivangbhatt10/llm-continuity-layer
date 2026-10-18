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

---

## ADR-0003: ChatGPT Export Sanitization & Consecutive Node Merging

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**:
  Raw ChatGPT export files contain internal system messages, hidden browsing display artifacts, and thinking steps (Gotcha #2). Furthermore, assistant replies containing code execution are frequently split across multiple consecutive nodes (prose followed by a separate `code` node). Without merging, this violates the alternating `user/assistant` conversation invariant required by Anthropic Claude and Google Gemini APIs (Gotcha #3). Exports may also arrive as single `.json` files, sharded directories (`conversations-000.json`), or `.zip` archives (Gotcha #4).
- **Decision**:
  1. Filter out `system` roles, nodes marked `is_visually_hidden_from_conversation === true`, and internal content types (`thoughts`, `reasoning_recap`, `tether_browsing_display`, `system_error`).
  2. Automatically merge consecutive `assistant` nodes into a single coherent turn, formatting `code` content types into fenced blocks with their language tag.
  3. Truncate raw `tool` outputs exceeding 2,000 characters to prevent context window saturation while preserving head and tail diagnostic traces.
  4. Implement multi-format loading for single JSON, sharded JSON folders, and `.zip` archives using built-in Windows `tar` utility to avoid heavy native dependencies.
- **Alternatives Rejected**:
  - *Leaving split assistant nodes as separate messages*: Rejected because Claude and Gemini APIs reject consecutive turns of the same role without synthetic padding.
  - *Adding third-party native zip extraction packages*: Rejected to keep the Node.js toolchain portable and native across Windows, Linux, and macOS without node-gyp build failures.
- **Consequences**:
  - Clean `Conversation[]` AST ready for multi-domain classification and token compaction.

---

## ADR-0004: Fence-Bounded Unicode/Citation Sanitization & Scraped Markdown Ingestion

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**:
  Puppeteer-scraped Markdown and browser extension captures often leak ChatGPT Private-Use Unicode characters (`U+E000`–`U+F8FF`), entity envelopes (`\ue200entity\ue202[...]`), cite tags (`\ue200cite...`), and DOM source citations (`fileL8-L28`) (Gotchas #14, #17). Furthermore, markdown code snippets may contain lines resembling turn headers (e.g. `## Turn 2: 👤 User`) or valid code variables matching citation patterns (`fileL8 = 100`) (Gotcha #5).
- **Decision**:
  1. Implement a fence-aware line scanner in `unicode_scrubber.ts` that tracks entry and exit of code fences (` ``` ` and ` ~~~ `).
  2. Outside code fences only:
     - Replace entity wrappers with the entity's human-readable display name (the 2nd element of the array).
     - Strip cite tags and stray PUA Unicode characters.
     - Strip leaked `fileL8-L28` citations and record the count in metadata.
  3. Inside code fences: Preserve all characters and lines 100% verbatim.
  4. In `scraped_md.ts`, split turns on `## Turn \d+:` strictly outside code fences, trim one trailing `---` turn separator, parse attachment markers into `meta.attachments`, and flag discrepancies between parsed turn count and `Total Turns` header.
  5. In `index.ts`, implement content-based detection (`detectFormat`) that safely ignores non-chat files like `README.md`.
- **Alternatives Rejected**:
  - *Global regex replacement*: Rejected because it strips code variables and breaks code syntax.
  - *Extension-based format detection (`.md`)*: Rejected because scanning directories containing documentation (`README.md`, `CONTRIBUTING.md`) would attempt to parse non-conversational files.
- **Consequences**:
  - Deterministic ingestion of scraped markdown with complete fence isolation and metadata verification.

---

## ADR-0005: Fence-Aware Clipboard Paste Parser & Fallback Degradation

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**:
  Users frequently copy transcripts directly from browser web interfaces into their clipboard (Gotcha #5). These pastes use varying speaker marker conventions (`You said: / ChatGPT said:` for ChatGPT, `Human: / Claude: / Assistant:` for Claude, `User: / Gemini:` for Gemini). Code snippets pasted inside these transcripts frequently contain comments or string literals containing speaker tokens (e.g., `// User: fix bug`).
- **Decision**:
  1. Maintain strict code fence state tracking (` ``` ` and ` ~~~ `). Speaker markers are evaluated only when outside active fences.
  2. Normalize diverse provider labels to canonical roles (`user` vs `assistant`).
  3. When zero speaker markers are found across the input, gracefully degrade to a single turn with `role: "unknown"`, preserving the full text and setting `meta.parse_warning`.
  4. Automatically derive a conversation title from the first non-empty message line (truncated to 80 chars).
- **Alternatives Rejected**:
  - *Naive regex turn splitting*: Slices code snippets whenever a comment or string literal contains a speaker token.
  - *Throwing an error on unstructured pastes*: Degrades user experience when pasting plain queries or single-reply transcripts.
- **Consequences**:
  - Seamless ingestion of raw clipboard data across ChatGPT, Claude, and Gemini web interfaces.




