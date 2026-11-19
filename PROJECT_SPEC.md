# Cross-Provider LLM Continuity & Memory Layer (`llm-continuity-layer`)
## Comprehensive System Architecture & Engineering Specification

---

## 1. Executive Overview

### 1.1 The Problem
Modern software development and knowledge work increasingly depend on frontier Large Language Models (LLMs) such as OpenAI (ChatGPT / GPT-4o / o-series), Anthropic (Claude 3.5 Sonnet / 3.7 Sonnet), and Google (Gemini 3 / 4 series). However, working sessions routinely hit walls:
1. **Usage Quotas & Rate Limits**: An in-flight, deep debugging session on ChatGPT or Claude hits a sudden hard hourly or daily limit (`429 Too Many Requests`).
2. **Context Window Degradation & Drift**: As conversations exceed 20+ turns, frontier models experience attention dilution ("lost-in-the-middle"), forgetting earlier constraints or repeating broken suggestions.
3. **Model Specialization Needs**: A user may initiate an architectural concept in ChatGPT, want to switch to Claude 3.7 for nuanced refactoring, and finish by asking Gemini for deep documentation synthesis.

### 1.2 The Failure of Naive Workarounds
When users attempt to switch providers manually, they either:
- **Copy-Paste Raw Chat Logs**: Bloats the target context window with thousands of tokens of superseded, buggy code and conversational filler.
- **Rely on Naive Semantic Retrieval (Chunk-based RAG)**: Slices prior turns into arbitrary embedding chunks. Because a buggy draft from Turn 3 and a working draft from Turn 14 share >95% lexical overlap, vector search retrieves both indiscriminately, corrupting the code state and stripping temporal constraint lineage.
- **Lose "Ruled Out" History**: Models repeatedly re-propose solutions that the user spent 10 turns debugging and proving broken ("dead-end loops").

### 1.3 The Solution: `llm-continuity-layer`
`llm-continuity-layer` is a high-speed, local-first continuity engine and browser extension that serializes an active multi-turn working session into a clean, portable **Handoff State Capsule**. It extracts working code deterministically (0% LLM code corruption), identifies explicit user constraints, records negative decision history (`Ruled Out`), and delivers a target-tailored injection envelope featuring an automated **3-Line Handshake Protocol**.

---

## 2. Architecture & System Design

### 2.1 High-Level Architectural Flow

```
                      +-------------------------------------------------------+
                      |                 Source LLM Surfaces                   |
                      |  [chatgpt.com]        [claude.ai]    [gemini.google]  |
                      +-------------------------------------------------------+
                                                 |
                                  (1) One-Click "Handoff"
                                                 v
                      +-------------------------------------------------------+
                      |           Manifest V3 Browser Extension               |
                      |  - Direct Internal API Fetch (<200ms)                 |
                      |    * /backend-api/conversation (ChatGPT)              |
                      |    * /api/organizations/.../chat_conversations (Claude)
                      |  - Resilient DOM Scraper Fallback                     |
                      |  - Speculative Pre-Warming Engine                     |
                      +-------------------------------------------------------+
                                                 |
                                  (2) HTTP POST /api/handoff
                                                 v
+---------------------------------------------------------------------------------------------+
|                          Local Continuity Daemon (Node.js :4141)                            |
|                                                                                             |
|  +---------------------------------------------------------------------------------------+  |
|  | Ingestion, Linearization & Sanitization                                               |  |
|  | - unicode_scrubber.ts : Strips PUA Unicode (\ue200-\ue202) & fileL.. outside fences   |  |
|  | - linearize.ts        : Walks backward from current_node to root (ChatGPT DAG)       |  |
|  | - paste_parser.ts     : Fence-aware speaker segmentation                              |  |
|  +---------------------------------------------------------------------------------------+  |
|                                            |                                                |
|  +---------------------------------------------------------------------------------------+  |
|  | Deterministic Artifact Extraction & Compaction                                        |  |
|  | - artifacts.ts        : Regex backreference extraction (```` fences)                 |  |
|  | - 96-Block Rule       : Symbol-aware AST dedup (extractSymbols: def, class, fn)       |  |
|  | - Code Replacement    : Replaces blocks >4 lines with [Code Artifact: lang] in summary |  |
|  | - Error Pinning       : Detects verbatim stack traces & errors (0% loss)              |  |
|  | - Pivot Highlighting  : Tags user corrections with [USER CONSTRAINT / PIVOT]          |  |
|  +---------------------------------------------------------------------------------------+  |
|                                            |                                                |
|  +---------------------------------------------------------------------------------------+  |
|  | High-Speed Synthesis Engine (Gemini Interactions API / Fallback)                      |  |
|  | - classify.ts        : Heuristic multi-label classifier (0ms)                         |  |
|  | - SHA-256 Turn Cache  : In-memory hash cache for sub-2ms repeated calls               |  |
|  | - LLM Synthesizer     : Single-pass capsule synthesis via gemini-3.1-flash-lite        |  |
|  | - Offline Fallback    : Instant deterministic capsule generation if quota exhausted   |  |
|  +---------------------------------------------------------------------------------------+  |
|                                            |                                                |
|  +---------------------------------------------------------------------------------------+  |
|  | Delivery Formatters & Memory Persistence                                              |  |
|  | - SQLiteStore         : Versioned transactional storage in continuity.db              |  |
|  | - Claude Formatter    : XML-hybrid envelope (<handoff>, <ruled_out>, <artifacts>)    |  |
|  | - Gemini / Markdown   : Markdown envelope with dynamic fence sizing (max_backticks+1) |  |
|  | - 3-Line Handshake    : Protocol forcing target LLM to acknowledge state & execute     |  |
|  +---------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------+
                                                 |
                       (3) Return Envelope & Store in chrome.storage
                                                 v
                      +-------------------------------------------------------+
                      |           Target Tab Injection Pipeline               |
                      |  - Opens https://claude.ai/new or gemini or chatgpt   |
                      |  - Polls for editor (ProseMirror / Quill / Textarea)  |
                      |  - Auto-populates envelope & dispatches input events  |
                      |  - Surfaces Confirmation Toast: "✓ Auto-Filled!"      |
                      +-------------------------------------------------------+
```

### 2.2 Component Responsibilities

1. **Browser Content Script (`src/extension/content.js`)**:
   - Injected into ChatGPT, Claude, and Gemini tabs.
   - Extracts conversation turns using direct internal JSON endpoint calls (`/backend-api/conversation/<id>` on ChatGPT and organization conversation endpoints on Claude) or clean DOM parsing fallback.
   - Triggers speculative pre-warming on pill click, submits handoff requests, saves the resulting envelope to `chrome.storage.local`, and auto-types the text into the newly spawned target window.
2. **Local HTTP Daemon & Proxy (`src/proxy/server.ts`)**:
   - Fast, local Node.js HTTP server running on `http://127.0.0.1:4141`.
   - Exposes `/api/handoff` for browser extensions, `/api/health` for monitoring, and `/v1/chat/completions` / `/v1/messages` drop-in proxies with automated 429 failover cascades.
   - Maintains an in-memory SHA-256 turn-hash cache for sub-2ms response times on repeated handoffs.
3. **Compaction & Ingestion Pipeline (`src/ingest/`, `src/core/`)**:
   - `unicode_scrubber.ts`: Resolves private-use Unicode entity references (`\ue200entity\ue202[...]`) and strips citation markers (`fileL8-L28`) outside code fences.
   - `linearize.ts`: Linearizes ChatGPT's parent/child branching message tree back into the active linear timeline.
   - `artifacts.ts`: Deterministically parses fenced code blocks with backreferences and applies the "96-Block Rule" (symbol superset checks) to discard stale/buggy code iterations while preserving working files.
4. **State Capsule Engine (`src/core/capsule.ts`, `src/core/chunk_summarize.ts`)**:
   - Replaces heavy code blocks with lightweight token references before LLM summarization.
   - Pins verbatim runtime stack traces and highlights user constraints (`[USER CONSTRAINT / PIVOT]`).
   - Uses `gemini-3.1-flash-lite` via `@google/genai` Interactions API in a single pass (up to 100,000 chars) to synthesize domain-specific sections (`Goal`, `Decisions`, `Ruled Out`, `Current State`, `Next Step`).
5. **Persistence Layer (`src/store/db.ts`)**:
   - Synchronous, zero-network transactional persistence powered by Node.js built-in `DatabaseSync` (`node:sqlite`).
   - Stores versioned capsules (`v1`, `v2`, `v3`) and raw extracted message JSON in `continuity.db`.

---

## 3. Core Features & Capabilities

### 3.1 Sub-Second Direct Internal API Extraction
Rather than relying on fragile DOM scraping that fails when ChatGPT virtualizes or unmounts out-of-view messages, the extension taps into the same internal JSON endpoints the web application itself calls:
- **ChatGPT**: Uses `fetch('/api/auth/session')` to obtain the user's active session bearer token, then calls `fetch('/backend-api/conversation/<id>')`. It walks the internal tree node-by-node from `current_node` to root in `<150ms`.
- **Claude**: Intercepts organization UUIDs via `/api/organizations` and queries `/api/organizations/<org>/chat_conversations/<uuid>` to retrieve exact message markdown directly.

### 3.2 Symbol-Aware Code Deduplication (The 96-Block Rule)
In long coding or debugging sessions, 50+ code blocks often accumulate. Naive deduplication by filename or first line breaks because multiple files start with `import os` or `package main`.
Our algorithm:
1. Extracts declared symbols per language:
   - Python: `def <name>`, `class <name>`
   - TypeScript/JavaScript: `function <name>`, `class <name>`, `interface <name>`, `type <name>`
   - Go: `func <name>`, `type <name>`
   - Rust: `fn <name>`, `struct <name>`, `enum <name>`, `trait <name>`
2. Merges scattered one-line shell commands into a single deduplicated `bash` block.
3. Filters out noise blocks (<150 chars of static JSON or lone URLs).
4. Drops older blocks **only if** the newer block defines every symbol defined by the older block (or contains 100% of its lines).

### 3.3 The 3-Line Handshake Protocol
When models receive a long handoff prompt, they frequently hallucinate, summarize the prompt back to the user, or restart completed work. The 3-Line Handshake Directive explicitly instructs the destination model:
```xml
<handoff_instructions>
1. Do NOT restart the task, re-ask settled questions, or re-propose anything listed in <ruled_out>.
2. Begin your VERY FIRST reply with a 3-line state confirmation:
   - Goal: <1 line>
   - Current State: <1 line>
   - Next Step: <1 line>
3. Immediately after those 3 lines, execute the <next_step>.
</handoff_instructions>
```

### 3.4 Speculative Pre-Warming & In-Memory SHA-256 Cache
To eliminate perceived latency:
- The moment the user clicks the floating browser pill (`#llm-pill`), extraction fires immediately in the background and submits a speculative request to the daemon.
- The daemon calculates a SHA-256 hash of the sanitized messages and stores the resulting capsule in memory.
- By the time the user selects their target model and clicks "Handoff", the response is already cached and returns in **<2ms**.

### 3.5 Automated Target Tab Prompt Injection
The extension eliminates manual copy-pasting:
1. It records `{ envelope, target, createdAt }` in `chrome.storage.local`.
2. It triggers `chrome.tabs.create({ url: targetUrl })`.
3. When the new tab loads, `content.js` inspects storage, polls for the platform-specific editor:
   - Claude: `div.ProseMirror[contenteditable="true"]`
   - Gemini: `.ql-editor[contenteditable="true"]` or `rich-textarea`
   - ChatGPT: `#prompt-textarea`
4. It inserts the text, dispatches DOM input events to activate the "Send" button, and displays a confirmation toast banner.

### 3.6 Zero-Quota Deterministic Fallback
If the user's Gemini API key exhausts its daily quota (`429 Rate Limit`), the system cascades through fallback models (`gemini-3.1-flash-lite` -> `gemini-3.5-flash-lite`). If all fail, it falls back to an **instant deterministic capsule assembler** that packages the extracted goal, last turns, error lines, and verbatim code blocks in 10ms with zero network dependencies.

---

## 4. Technical Stack & Dependencies

| Layer | Technology | Version | Rationale |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | v22+ | Modern native ESM support, built-in SQLite engine, fast I/O. |
| **Language** | TypeScript | v5.8+ | Strict typing, robust interface definitions, end-to-end type safety. |
| **AI SDK** | `@google/genai` | v2.29+ | Official Google GenAI SDK for the modern Interactions API (`client.interactions.create`). |
| **Testing** | Vitest | v3.0+ | Blazing fast ESM test runner, compatible with TypeScript and native mocks. |
| **Storage** | `node:sqlite` (`DatabaseSync`) | Built-in | Zero-dependency, file-backed transactional SQLite database. Eliminates native compilation issues (e.g. `node-gyp`). |
| **Extension** | Chrome Manifest V3 | MV3 | Industry-standard secure browser extension specification. |
| **Execution** | `tsx` | v4.19+ | Zero-build instant TypeScript script runner for CLI and daemon testing. |
| **Security** | `dotenv` | v16.4+ | Secure `.env` handling isolated from Git tracking. |

---

## 5. Directory & Module Breakdown

```text
llm-continuity-layer/
├── package.json                   # Workspaces, build scripts, dependencies
├── tsconfig.json                  # TypeScript compiler configuration (ESM, strict)
├── .env.example                   # Clean template for API keys & model routing
├── continuity.db                  # Local SQLite working memory store (generated)
├── AGENTS.md                      # Core specification & architectural rules
├── DECISIONS.md                   # Architectural Decision Records (ADR-0001 to ADR-0013)
├── src/
│   ├── config.ts                  # Configuration loader & model routing precedence
│   ├── cli.ts                     # Developer CLI (`list`, `capsule`, `show`, `models`, `serve`)
│   ├── core/
│   │   ├── schema.ts              # Canonical interfaces (Message, Conversation, Artifact, Capsule)
│   │   ├── linearize.ts           # ChatGPT message graph linearization
│   │   ├── artifacts.ts           # Backreference fence extractor & symbol deduplication
│   │   ├── classify.ts            # Heuristic & LLM multi-label domain classifier
│   │   ├── chunk_summarize.ts     # Parallel map-reduce chunk summarizer
│   │   ├── capsule.ts             # Tolerant section parser & capsule synthesis engine
│   │   ├── llm.ts                 # GeminiClient, ScriptedLLM, DryRunLLM, retry logic
│   │   ├── prompts.ts             # Injection defense & synthesis prompt templates
│   │   └── templates/             # Domain section schemas (coding, debugging, research, learning)
│   ├── ingest/
│   │   ├── index.ts               # Content-based format detector & multi-file loader
│   │   ├── unicode_scrubber.ts    # Private-use Unicode & leaked citation tag scrubber
│   │   ├── scraped_md.ts          # Markdown turn parser
│   │   ├── chatgpt_export.ts      # Multi-format export loader (.json, folder, .zip)
│   │   └── paste_parser.ts        # Fence-aware clipboard text parser
│   ├── deliver/
│   │   └── formatters/            # Target envelope builders (Claude XML, Gemini Markdown, ChatGPT)
│   ├── proxy/
│   │   ├── server.ts              # Local HTTP daemon & API proxy (:4141)
│   │   ├── failover.ts            # Cascading error handler & 429 failover
│   │   └── types.ts               # HTTP schemas (HandoffRequest, ChatCompletion)
│   ├── extension/
│   │   ├── manifest.json          # Chrome Manifest V3 declaration
│   │   ├── background.js          # Background service worker (tab manager)
│   │   ├── content.js             # Page-world script (Internal API + DOM extractor + Auto-filler)
│   │   ├── extractors.ts          # Pure extraction helper functions
│   │   └── styles.css             # Floating HUD design system & status badges
├── eval/
│   ├── run_eval.ts                # 100-point golden benchmark runner
│   └── cases/                     # Golden test cases (conversations + evaluation contracts)
└── tests/                         # 16 Vitest test suites (106 unit & integration tests)
```

---

## 6. Execution Flow & Edge Case Handling

### 6.1 End-to-End Primary Execution Trace
1. **User Action**: The user clicks the floating `⚡ Handoff Session` pill on `chatgpt.com`.
2. **Pre-Warming**: `content.js` calls `extractConversation()`, queries `/backend-api/conversation/<id>`, linearizes the turns, and dispatches a background request to `http://127.0.0.1:4141/api/handoff`.
3. **Daemon Ingestion**: `server.ts` receives turns, cleans Unicode artifacts with `scrubChatGPTUnicodeAndCitations()`, and checks the in-memory SHA-256 hash cache.
4. **Capsule Synthesis**:
   - `extractArtifacts()` indexes all code blocks, extracts declared symbols, and filters superseded drafts.
   - Large code blocks are replaced with placeholder tokens in the transcript.
   - Pinned errors and user pivots are detected and injected into the prompt.
   - `gemini-3.1-flash-lite` generates the structured sections (`Goal`, `Decisions`, `Ruled Out`, `Current State`, `Next Step`).
5. **Envelope Formatting**: The capsule is formatted for the target model (e.g. XML tags for Claude, dynamic backtick fences for Gemini) with the 3-Line Handshake Directive.
6. **Delivery & Auto-Fill**: The daemon saves the capsule to `continuity.db` and responds to the extension. The extension copies the envelope to clipboard, stores it in `chrome.storage.local`, opens `https://claude.ai/new`, and auto-types the text into Claude's prompt box.

### 6.2 Edge Case Matrix & Defenses

| Edge Case / Failure Mode | Root Cause | Implemented Defense |
| :--- | :--- | :--- |
| **Nested Code Fences** | Markdown files inside conversations contain ```. | Backreference regex (`^(`{3,})[\s\S]*?^\1$`) captures blocks intact; target formatters choose fence lengths `max_backticks + 1`. |
| **Speaker Marker in Code** | A Python script prints `"User: login failed"`. | `paste_parser.ts` ignores speaker markers while inside code fences. |
| **ChatGPT Tree Branching** | Regenerating a message creates sibling tree branches. | `linearize.ts` walks backward exclusively from `current_node` to root. |
| **Invisible Unicode Tags** | ChatGPT leaks `\ue200entity\ue202` PUA tags. | `unicode_scrubber.ts` resolves display names and strips PUA characters outside code fences only. |
| **Same First-Line Code Overwrite** | Two distinct files both start with `import requests`. | Symbol-aware AST matcher requires full symbol superset before allowing superseding. |
| **Prompt Injection via Chat Data** | Chat content says `"Ignore previous instructions"`. | System prompts explicitly mark all transcript content as passive reference data. |
| **Gemini Free-Tier Rate Limits** | User exceeds 20 requests/day on a model. | Automatic fallback cascade to lighter models + 10ms zero-quota deterministic fallback. |

---

## 7. Setup & Local Run Instructions

### 7.1 Prerequisites
- Node.js v22.0.0 or higher
- Google Gemini API Key ([Google AI Studio](https://aistudio.google.com/))
- Chromium-based browser (Chrome, Brave, Edge)

### 7.2 Installation & Setup
```bash
# Clone and enter directory
cd "C:\Users\HP\Desktop\New folder"

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env and enter your GEMINI_API_KEY
```

### 7.3 Running Tests
```bash
# Run all 16 Vitest suites (106 tests, 100% offline)
npm test

# Run the golden benchmark evaluation harness (Dry Run)
npx tsx eval/run_eval.ts --dry-run

# Run the golden benchmark evaluation harness (Live Gemini API)
npx tsx eval/run_eval.ts --live
```

### 7.4 Running the Local Continuity Daemon
```bash
npx tsx src/cli.ts serve
```
Output:
```text
Continuity Daemon & HTTP Proxy running on http://127.0.0.1:4141
Working Memory Store: continuity.db
Endpoints:
  POST http://127.0.0.1:4141/api/handoff         (Browser Extension 1-Click Handoff)
  GET  http://127.0.0.1:4141/api/health          (Daemon Health Check)
  POST http://127.0.0.1:4141/v1/chat/completions (OpenAI Compatible Proxy)
  POST http://127.0.0.1:4141/v1/messages         (Anthropic Compatible Proxy)
```

### 7.5 Loading the Chrome Extension
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the folder: `C:\Users\HP\Desktop\New folder\src\extension`.
5. Open any conversation on `chatgpt.com`, `claude.ai`, or `gemini.google.com`, click the floating **"⚡ Handoff Session"** button, and enjoy instant continuity!
