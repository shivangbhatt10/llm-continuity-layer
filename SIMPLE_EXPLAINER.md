# The Non-Technical Guide to LLM Continuity Layer
### How It Works, Why It Matters, and the Tech Behind It (Explained in Plain English)

---

## 1. What is this project in one simple sentence?

> **Think of this project like an automated "Briefing Folder" for AI chatbots.** 
> When you are in the middle of solving a hard problem with ChatGPT and you run out of messages or hit a rate limit, our tool takes all your work, packages it into a 1-page briefing, and hands it to Claude or Gemini so the new AI continues **instantly** without asking you to repeat yourself or re-trying ideas that already failed.

---

## 2. What problem does it solve? (The "Relay Race" Analogy)

Imagine you are working with an assistant (ChatGPT) to build an app or debug an error. You've had a 25-message conversation:
- You explained your requirements.
- You tried Idea A, but it crashed.
- You tried Idea B, but it was too slow.
- You are now on Idea C, and you've written 200 lines of code.

Suddenly, ChatGPT says: **"You've reached your hourly limit. Try again in 3 hours."** 🛑

### What happens if you try to switch to Claude or Gemini manually?
1. **If you copy-paste the whole 25-message chat**:
   Claude gets overwhelmed by 10 pages of text. It sees all the broken code from Idea A and Idea B, gets confused about what you are actually using, and might even suggest Idea A all over again!
2. **If you try to explain it yourself from scratch**:
   You have to spend 15 minutes typing: *"Okay, I'm building X, we already tried A and B, here is my code, don't use Redis..."* You lose your train of thought and waste time.
3. **If you use standard AI search (RAG / Vector Search)**:
   Normal search tools search for "similar words". If Turn 3 and Turn 20 both talk about `login.py`, search tools often mix up the old buggy version with the new working version, giving the new AI broken code!

### What our tool does instead:
Our tool acts like an expert chief of staff standing over your shoulder. In **less than 2 seconds**, it:
- Throws away all the chit-chat and greetings.
- Saves your latest working code in a "safe box" where no AI can accidentally change a single letter.
- Makes a clear list of **"What We Already Tried and Failed"** so the new AI never wastes your time suggesting dead ends.
- Tells the new AI: *"Here is where we left off. Confirm you understand in 3 lines, and execute the next step right now."*

---

## 3. The Technologies We Used: What Are They & Why Did We Pick Them?

If someone asks: *"What tech stack did you use and why?"*, here is how to explain every tool in plain English:

### A. TypeScript
- **What is it?** A version of JavaScript that has strict rules and checks your code for errors while you type.
- **Why did we use it?** When you handle complex conversation data (messages, code snippets, timestamps), normal JavaScript lets typos slip through until your program crashes while running. TypeScript catches bugs before you even run the code.
- **How it helps:** It ensures that every part of our app—from the browser button to the server—agrees on the exact shape of a "Message" and a "Capsule".

### B. Node.js
- **What is it?** An engine that lets us run JavaScript/TypeScript on your computer (outside of a web browser).
- **Why did we use it?** It is fast, lightweight, and can handle multiple web requests at the same time without freezing.
- **How it helps:** It powers our local helper background server (`http://127.0.0.1:4141`) that cleans the chat and talks to the AI.

### C. Chrome Extension (Manifest V3 / MV3)
- **What is it?** A small plugin that sits right inside Google Chrome, Brave, or Microsoft Edge.
- **Why Manifest V3?** "Manifest V3" is Google's newest, most secure standard for browser extensions. Older extensions (Manifest V2) are being phased out.
- **Why did we use it?** It allows us to put a floating **"⚡ Handoff Session"** button directly on the ChatGPT, Claude, and Gemini websites. Because it runs inside your real browser where you are already logged in, it never triggers "Verify you are human" robot check blocks (Cloudflare CAPTCHAs).
- **How it helps:** You never have to leave your browser or copy-paste text manually. You just click one button, and it does the entire handoff for you.

### D. SQLite (`continuity.db` via `node:sqlite`)
- **What is it?** A super-fast, lightweight database stored entirely in a single file on your hard drive.
- **Why did we use it?** Most databases (like Postgres or MongoDB) require you to install heavy software or run Docker. SQLite requires zero setup and lives right in your folder. Node.js v22 has SQLite built directly into its core!
- **How it helps:** Every time you do a handoff, it saves a versioned backup (`v1`, `v2`, `v3`) in `continuity.db`. If you ever want to check what you did yesterday or restore an older code version, it's safely saved on your computer.

### E. Google Gemini API (`gemini-3.1-flash-lite` via `@google/genai`)
- **What is it?** Google's fastest, state-of-the-art AI model accessed through Google's official software library.
- **Why this specific model?** `gemini-3.1-flash-lite` can read massive documents (up to 1,000,000 words!) and replies in about **1 to 2 seconds**. It is also extremely cost-efficient.
- **How it helps:** It reads the whole conversation transcript in one fast gulp and extracts the high-level goals and decisions into the briefing document.

### F. Vitest
- **What is it?** A modern, lightning-fast testing tool for JavaScript and TypeScript.
- **Why did we use it?** Instead of testing our code by manually clicking in the browser 50 times every day, Vitest lets us write automated robot tests that verify our whole project in **less than 2 seconds**.
- **How it helps:** We have **106 automated tests**. Every time we make a change, Vitest runs all 106 tests to guarantee that we didn't accidentally break anything.

---

## 4. What Were Those 106 Tests, and Why Were They Necessary?

In software engineering, bugs usually happen because of weird edge cases in real-world data. We created 16 test files covering **106 automated tests** that protect against real things that went wrong when testing real ChatGPT and Claude chats:

| The Test Name / Feature | The Real-World Bug It Solves (In Plain English) |
| :--- | :--- |
| **1. The "Edited Message" Test (`linearize.test.ts`)** | In ChatGPT, if you edit a message or click "Regenerate", ChatGPT creates alternate "branches" in the background. If you read the chat naively, you'll see messages from deleted timelines! Our test proves that we only follow the active branch you actually kept. |
| **2. The "Invisible Junk" Test (`scraped_md.test.ts`)** | ChatGPT hides invisible Unicode tags (`\ue200entity...`) and broken file tags (`fileL8-L28`) in copied text. If an AI reads these, it gets confused. Our test proves we scrub all invisible junk while leaving your code untouched. |
| **3. The "Accidental Code Deletion" Test (`artifacts.test.ts`)** | If you have two different Python files that both start with `import os`, naive tools think they are the same file and delete one! Our test proves our tool reads the actual function names (`def login()`, `def signup()`) so it never accidentally deletes a file. |
| **4. The "Fake Speaker in Code" Test (`paste_parser.test.ts`)** | If you write a Python script that prints `"User: Invalid Password"`, a naive reader thinks a new person started talking and splits your code in half! Our test proves code inside backticks is protected. |
| **5. The "Nested Backticks" Test (`formatters.test.ts`)** | If your code contains Markdown triple backticks (` ``` `), wrapping it in normal backticks breaks the formatting. Our test proves we dynamically use 4 or 5 backticks (` ```` ```` `) so code never breaks. |
| **6. The "Rate Limit Auto-Fallback" Test (`proxy.test.ts`)** | If Google's free tier runs out of quota on one model, our server automatically cascades to a backup model, and if all fails, creates a safe emergency briefing offline in 10 milliseconds. |

---

## 5. Step-by-Step: What Happens When You Click the Button?

Here is the journey that happens in the **~1.5 seconds** between your click and the new tab opening:

```
[ Your Browser Tab ]
        │
        ▼
1. YOU CLICK "⚡ Handoff Session"
   The extension reads the chat directly from the website's internal data in 0.1 seconds.
        │
        ▼
2. WE LOCK YOUR CODE IN A SAFE
   Our code scanner pulls out every snippet of Python, JS, or Go code and locks it safely away.
   The AI is not allowed to rewrite your code!
        │
        ▼
3. WE HIGHLIGHT YOUR CORRECTIONS
   Lines where you said "No", "Don't do that", or "It failed" are marked with bright warning tags.
        │
        ▼
4. GEMINI WRITES THE 1-PAGE BRIEFING
   Gemini 3.1 Flash Lite reads the cleaned text and writes a structured briefing:
   - What is the Goal?
   - What was Ruled Out?
   - What is broken right now?
   - What is the exact Next Step?
        │
        ▼
5. WE ASSEMBLE THE BRIEFING ENVELOPE
   We combine the 1-page summary + your verbatim code + the last 2 messages word-for-word.
   We add the "3-Line Handshake Rule" telling the new AI to confirm and start working immediately.
        │
        ▼
6. THE NEW TAB OPENS & TYPES FOR YOU!
   Claude, Gemini, or ChatGPT opens in a new tab.
   The extension finds the chat box, automatically types the briefing in, and shows a green toast:
   "✓ Handoff Auto-Filled! Just press Enter."
```

---

## 6. How to Explain This Project in an Interview or Conversation (The 60-Second Pitch)

If anyone asks you: *"Tell me about this project you built"*, here is the perfect response:

> *"I built a Cross-Provider LLM Continuity Layer. The problem it solves is that software engineers constantly switch between ChatGPT, Claude, and Gemini—either because they hit rate limits or want a second opinion—but migrating an active session manually is terrible. Copy-pasting logs overwhelms the new model, and standard RAG retrieval mixes up old buggy code drafts with new ones.*
> 
> *To fix this, I engineered a high-speed TypeScript system and Chrome Extension (Manifest V3) that captures in-flight conversations in under 200 milliseconds. It deterministically extracts code blocks and deduplicates them using AST symbol analysis so working code is never corrupted by an LLM.*
> 
> *It then uses Gemini Flash to compile a structured handoff capsule—capturing goals, active constraints, and explicitly ruled-out dead ends—and formats it with a 3-Line Handshake protocol that auto-populates the prompt in the new AI tab. The entire pipeline runs in under 2 seconds, backed by a 106-test Vitest suite and a local SQLite working memory store."*
