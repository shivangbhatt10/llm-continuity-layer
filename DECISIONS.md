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

---

## ADR-0006: Dual-Tier LLM Architecture, Injection Defense & Fail-Fast Error Handling

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**:
  Interfacing with frontier LLMs for continuity compilation requires strict security, budget efficiency, and resilience:
  1. Untrusted transcripts may contain prompt injection attacks or instructions to execute code (Gotcha #7).
  2. High-volume chunking and domain classification can rapidly deplete rate limits and budget if routed to expensive reasoning models (Gotcha #12).
  3. Models with hidden thinking tokens (`thought`) can starve output tokens if headroom is insufficient (Gotcha #16).
  4. Retrying permanent errors (e.g. invalid API keys `401` or model not found `404`) hangs execution fruitlessly (Gotcha #15).
  5. The test suite and evaluation harness must be capable of running 100% offline without live network or API keys.
- **Decision**:
  1. Implement `GeminiClient` using `@google/genai` (>= 2.29.1) Interactions API (`client.interactions.create`), routing cheap operations (`classify`, `chunk_summary`, `merge_notes`) to `gemini-3.1-flash-lite` and strong synthesis (`capsule`) to `gemini-3.8-flash`.
  2. Implement `isPermanentError` vs `isTransientError`: fail immediately without retrying on `400`, `401`, `403`, `404`, `NOT_FOUND`, `INVALID_ARGUMENT`, `PERMISSION_DENIED`, prompting the user to check keys or run `ml models`. Retry transient `429` and `5xx` with exponential backoff.
  3. Embed `SYSTEM_INJECTION_DEFENSE` into all system prompts, mandating that the model treat transcripts strictly as passive data.
  4. Provide `ScriptedLLM` (deterministic response routing by task or substring) and `DryRunLLM` (structured offline simulation) for zero-cost testing.
  5. Assemble domain-adaptive section templates via `getTemplateSections`, ensuring `debugging` automatically inherits `coding` sections (Gotcha #19).
- **Alternatives Rejected**:
  - *Blind retries on all errors*: Retrying `404 Model Not Found` 5 times wastes 30 seconds of user time before failing.
  - *Single frontier model*: Running map-reduce chunking on large transcripts through expensive models causes rate-limit exhaustion.
- **Consequences**:
  - Secure, cost-optimized, and resilient LLM execution with 100% offline-verifiable testability.

---

## ADR-0007: Symbol-Aware Code Block Superseding (The 96-Block Rule) & Domain Classification

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**:
  Long technical chats frequently generate 50–100 code blocks (Gotcha #18). Naive deduplication mechanisms fail catastrophically:
  1. Grouping by `language + first line` erroneously treats separate source modules that share `import requests` or `'use strict'` as identical files, discarding valid modules.
  2. Replacing an older block with the latest block erases full 200-line implementations when the model generates a 5-line patch snippet later in the chat.
  3. Fences can be nested (e.g., markdown snippets describing python code) and break with naive backtick splitting (Gotcha #6).
  4. Scattered 1-line shell commands pollute the token budget.
  5. Sessions require bounded domain classification with the invariant that `debugging` implies `coding` (Gotcha #19).
- **Decision**:
  1. Use backreference multiline regular expressions (`^(`{3,})([^\n]*)\n([\s\S]*?)^\1\s*$`) to capture arbitrary depth nested fences, and extract file labels from preceding markdown headings (`## 📄 path/file.py`).
  2. Implement language-specific symbol extraction (`extractSymbols`) detecting `function`, `class`, `interface`, `type`, `def`, `fn`.
  3. Enforce **The 96-Block Rule**: A newer block supersedes an older block ONLY if it defines every symbol the older block defined (or contains 100% of the older block's lines). Small patches never supersede full source files.
  4. Automatically filter noise blocks (<150 chars of lone URLs, search terms, or raw sample JSON).
  5. Consolidate scattered single-line shell commands into a single deduplicated shell script block.
  6. Enforce that `debugging` automatically injects `coding` as a prerequisite domain, capped at a maximum of 2 primary domain labels, backed by a deterministic keyword heuristic fallback.
- **Alternatives Rejected**:
  - *Deduplicating by language + first line*: Catastrophically drops distinct source files that share common imports.
  - *Pure recency overwrites*: Erases working modules when an assistant provides a targeted diff or patch snippet.
- **Consequences**:
  - 100% verbatim preservation of active codebase state with zero code corruption.

---

## ADR-0008: Dual-Mode Guaranteed-Termination Chunking & Tolerant Capsule Assembly

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**:
  Synthesizing concise, high-fidelity state capsules from varied conversation lengths poses multiple failure modes:
  1. Passing 50+ turn transcripts directly into a single prompt triggers context degradation and lost-in-the-middle hallucination.
  2. Recursive map-reduce summarization can enter infinite loops if the LLM's summarized output fails to decrease in length (Gotcha #11).
  3. Single oversized turns (e.g. pasted logs or large files) break token windows.
  4. Raw LLM responses often contain code snippets with internal `#` comments (e.g. `// ## Goal:` or `# Section`), which break naive regex section splitters (Gotcha #8).
  5. Code artifacts paraphrased by models incur silent syntax errors and dropped edge cases (Gotcha #10).
- **Decision**:
  1. Implement dual-mode summarization in `chunk_summarize.ts`:
     - `direct` mode for short conversations (<12,000 chars), bypassing intermediate chunk summaries.
     - `notes` mode for long conversations: partition into chunks, extract bullet notes via `gemini-3.1-flash-lite`, and hierarchically merge notes.
  2. Guarantee termination in `mergeChunkNotes`: batch merge under character limits, and if a reduction round fails to decrease the note count, force pairwise merging of the first two notes.
  3. Partition single oversized messages into `(part k/n)` chunks on line boundaries.
  4. In `capsule.ts`, parse sections tolerantly by matching headings only when outside code fences and only when matching an expected domain template section. Default missing sections to `"Not established in the conversation."` and track in `meta.missing_sections`.
  5. Zero-touch verbatim artifact preservation: code artifacts extracted via AST/regex are spliced directly into `capsule.artifacts` without LLM paraphrase.
  6. Enforce turn budgeting in `selectRecentTurns`: always retain at least the last 2 turns, truncating individual oversized turns 40% head / 60% tail with `[... middle omitted ...]`.
- **Alternatives Rejected**:
  - *Unbounded recursive summarization*: Risks infinite loops when model outputs plateau in size.
  - *Paraphrasing code artifacts*: Causes code drift, syntax corruption, and dropped error handlers.
  - *Naive heading regex*: Breaks section parsing when code blocks contain `#` comments.
- **Consequences**:
  - Predictable, deterministic state synthesis with 100% code integrity and guaranteed termination.


