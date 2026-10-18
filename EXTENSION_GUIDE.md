# Cross-Provider LLM Continuity Layer — Chrome Extension Guide

The **LLM Continuity Layer** browser extension provides instantaneous 1-click session continuity and handoff between **ChatGPT**, **Claude**, and **Gemini**.

It captures active conversation turns directly from the page DOM, dispatches them to your local continuity daemon (`http://127.0.0.1:4141/api/handoff`), copies the synthesized state capsule (with the **3-Line Handshake Directive**) to your clipboard, and automatically opens the target model's tab for you to paste.

---

## 🚀 Quick Setup (2 Minutes)

### Step 1: Start the Local Continuity Daemon

The extension requires your local continuity daemon running on your computer to access your `.env` Gemini API key and versioned SQLite working memory.

In your terminal, run:

```bash
npx tsx src/cli.ts serve
```

You should see:
```text
Continuity Daemon & HTTP Proxy running on http://127.0.0.1:4141
Working Memory Store: continuity.db
Endpoints:
  POST http://127.0.0.1:4141/api/handoff         (Browser Extension 1-Click Handoff)
  GET  http://127.0.0.1:4141/api/health          (Daemon Health Check)
  POST http://127.0.0.1:4141/v1/chat/completions (OpenAI Compatible Proxy)
  POST http://127.0.0.1:4141/v1/messages         (Anthropic Compatible Proxy)
```

---

### Step 2: Load the Extension in Your Browser (Chrome / Brave / Edge)

1. Open your browser and navigate to:
   - **Chrome**: `chrome://extensions/`
   - **Brave**: `brave://extensions/`
   - **Edge**: `edge://extensions/`
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. Click the **Load unpacked** button in the top-left.
4. Select the directory:
   ```text
   C:\Users\HP\Desktop\New folder\src\extension
   ```
5. You will see **"LLM Continuity & Memory Layer Handoff"** appear in your extension list!

---

### Step 3: Test a Real Handoff Live!

1. Open an existing or new conversation on [ChatGPT](https://chatgpt.com) or [Claude](https://claude.ai).
2. Look at the bottom-right of your browser window. You will see the floating **"⚡ Handoff Session"** pill widget.
3. Click the widget:
   - Select your target destination (**Claude** or **Gemini**).
   - Click **"🚀 Handoff & Copy State"**.
4. The widget will:
   - Automatically extract the conversation history and code blocks from the DOM.
   - Send turns to your local daemon (`http://127.0.0.1:4141/api/handoff`).
   - Run classification, deduplication (Gotcha #18), and capsule synthesis.
   - Save the versioned capsule to your local SQLite database (`continuity.db`).
   - Copy the formatted handoff envelope (with the **3-Line Handshake**) to your clipboard.
   - Open a fresh tab for the target provider (e.g. `https://claude.ai/new` or `https://gemini.google.com/app`).
5. In the target tab, simply press **Ctrl+V** (`Cmd+V`) and hit **Enter**!

The target model will immediately confirm the 3-line state handshake:
```text
Goal: <Goal of your session>
Current State: <What is working right now>
Next Step: <The precise next task to execute>
```
...and resume your work without restarting or asking what you were doing!

---

## 🛠️ Architecture & Security
- **Zero API Keys in Browser**: Your Gemini API key never touches the browser extension memory. All LLM calls and SQLite storage happen locally on `127.0.0.1`.
- **CORS Preflight**: The daemon automatically answers `OPTIONS` preflight requests from `chrome-extension://*`.
- **Symbol-Aware Deduplication**: If your chat has multiple versions of code files, the 96-block rule ensures only settled, valid code is included in the handoff.
