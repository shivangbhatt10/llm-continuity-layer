# Model Context Protocol (MCP) Integration Guide: Continuity Memory

The **Continuity Memory MCP Server** connects AI developer harnesses, IDE agents, and terminal CLIs (**Claude Code**, **Antigravity IDE**, **Cursor**, **Windsurf**, and **OpenClaw**) directly to your local `continuity.db` working memory over standard JSON-RPC (`stdio`).

This allows your local coding agents to:
1. Instantly **resume browser sessions** (from ChatGPT, Claude.ai, or Gemini Web) with complete context, goal, constraints, ruled-out dead ends, and code artifacts.
2. **Save checkpoints** back into working memory so you can hop back to your browser with 1 click.

---

## 🛠️ Available MCP Tools

| Tool Name | Purpose | Parameters |
| :--- | :--- | :--- |
| **`get_latest_handoff`** | Retrieves the active conversation handoff envelope with the **3-Line Handshake Directive**. | `target_format`: `"claude"` \| `"gemini"` \| `"markdown"` \| `"raw"` (default: `"claude"`)<br>`conversation_id`: string (optional, defaults to latest session) |
| **`list_saved_sessions`** | Lists recent conversation sessions saved in working memory. | `limit`: number (optional, default: `10`) |
| **`search_sessions`** | Searches continuity memory by keyword across titles, goals, decisions, constraints, and next steps. | `query`: string (required) |
| **`save_checkpoint`** | Saves a new state capsule checkpoint from the harness back to `continuity.db`. | `title`: string<br>`goal`: string<br>`current_state`: string<br>`next_step`: string<br>`ruled_out`: string (optional)<br>`artifacts`: array (optional)<br>`source`: string (default: `"harness"`) |

---

## 🚀 Quick Setup by Tool

### 1. Claude Code (CLI)

Run this single command in your terminal:

```bash
claude mcp add continuity-memory npx -y tsx "C:\Users\HP\Desktop\New folder\src\mcp\index.ts"
```

*Or via global `ml` CLI:*

```bash
claude mcp add continuity-memory npx -y tsx "C:\Users\HP\Desktop\New folder\src\cli.ts" mcp
```

---

### 2. Google Antigravity IDE

Add the following block to your project `.agents/mcp_config.json` or global `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "continuity-memory": {
      "command": "npx",
      "args": ["-y", "tsx", "C:\\Users\\HP\\Desktop\\New folder\\src\\mcp\\index.ts"],
      "env": {
        "CONTINUITY_DB_PATH": "C:\\Users\\HP\\Desktop\\New folder\\continuity.db"
      }
    }
  }
}
```

---

### 3. OpenClaw

Add to your `openclaw/mcp.json` or `config.json`:

```json
{
  "mcpServers": {
    "continuity-memory": {
      "command": "node",
      "args": ["C:\\Users\\HP\\Desktop\\New folder\\dist\\mcp\\index.js"],
      "env": {
        "CONTINUITY_DB_PATH": "C:\\Users\\HP\\Desktop\\New folder\\continuity.db"
      }
    }
  }
}
```

---

### 4. Cursor / Windsurf

In Cursor or Windsurf settings (`Features > MCP Servers > Add New MCP Server`):
- **Name**: `continuity-memory`
- **Type**: `stdio`
- **Command**: `npx -y tsx "C:\Users\HP\Desktop\New folder\src\mcp\index.ts"`

---

## 💡 Example Prompts to Use in Your AI Harness

### A. Resume a Session Started in ChatGPT or Claude.ai
> *"Resume work from my last ChatGPT session on the Cloud Computing study plan."*  
> *(The agent calls `search_sessions` or `get_latest_handoff` and immediately outputs the 3-line confirmation: Goal, Current State, Next Step!)*

### B. List Available Continuity Sessions
> *"Show me what sessions are currently saved in my continuity memory."*  
> *(The agent invokes `list_saved_sessions` and presents an overview table).*

### C. Save a Checkpoint Before Switching Back to Browser
> *"Save our current refactoring progress to continuity memory so I can test it in ChatGPT."*  
> *(The agent executes `save_checkpoint` with the settled code artifacts and next steps).*

### D. Look Up What Was Ruled Out
> *"Check continuity memory to see what approaches we already tried and ruled out for Redis mutex timeouts."*  
> *(The agent fetches the session and confirms why 10000ms timeouts failed without repeating the dead end).*
