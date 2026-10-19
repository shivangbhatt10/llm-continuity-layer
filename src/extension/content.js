// Cross-Provider LLM Continuity Layer Content Script (M12 God-Speed Engine)

(function () {
  // 1. Check for Pending Handoff Auto-Fill on Page Load
  checkPendingHandoffAutoFill();

  if (document.getElementById("llm-continuity-container")) return;

  // 2. Platform Detection
  function getPlatform() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes("chatgpt.com") || host.includes("openai.com")) return "chatgpt";
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("gemini.google.com")) return "gemini";
    return "unknown";
  }

  // 3. HTML to Clean Text with Fenced Code Blocks
  function cleanText(html) {
    let text = html;

    // Strip buttons, sr-only elements, and copy header bars before extracting
    text = text.replace(/<button[\s\S]*?<\/button>/gi, "");
    text = text.replace(/<(?:div|span|h[1-6])[^>]*class="[^"]*sr-only[^"]*"[\s\S]*?<\/(?:div|span|h[1-6])>/gi, "");
    text = text.replace(/(?:Copy code|Copy|Copied!)/gi, "");

    // Convert code blocks
    text = text.replace(
      /<pre[^>]*><code(?: class="[^"]*language-([a-zA-Z0-9#+_-]+)[^"]*")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      (_, lang, code) => {
        const langTag = lang || "";
        const cleanCode = code
          .replace(/<button[\s\S]*?<\/button>/gi, "")
          .replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();
        return `\n\`\`\`${langTag}\n${cleanCode}\n\`\`\`\n`;
      }
    );
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<\/p>/gi, "\n\n");
    text = text.replace(/<[^>]+>/g, "");
    text = text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  // 4. Internal API Extraction (<200ms) for ChatGPT
  async function tryExtractChatGPTApi() {
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    if (!match) return null;
    const conversationId = match[1];

    try {
      const sessionRes = await fetch("/api/auth/session", { credentials: "same-origin" });
      if (!sessionRes.ok) return null;
      const session = await sessionRes.json();
      const token = session.accessToken;
      if (!token) return null;

      const convRes = await fetch(`/backend-api/conversation/${conversationId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "same-origin",
      });
      if (!convRes.ok) return null;
      const convData = await convRes.json();
      if (!convData.mapping || !convData.current_node) return null;

      const mapping = convData.mapping;
      const pathNodes = [];
      let curr = convData.current_node;
      while (curr && mapping[curr]) {
        pathNodes.push(mapping[curr]);
        curr = mapping[curr].parent;
      }
      pathNodes.reverse();

      const turns = [];
      for (const node of pathNodes) {
        const msg = node.message;
        if (!msg || !msg.author) continue;
        if (msg.metadata?.is_visually_hidden_from_conversation === true) continue;
        if (msg.recipient && msg.recipient !== "all") continue;

        const role = msg.author.role;
        if (role !== "user" && role !== "assistant") continue;

        let text = "";
        if (msg.content?.parts) {
          text = msg.content.parts
            .filter((p) => typeof p === "string")
            .join("\n")
            .trim();
        } else if (typeof msg.content?.text === "string") {
          text = msg.content.text.trim();
        }

        if (!text) continue;

        // Merge consecutive assistant turns
        if (role === "assistant" && turns.length > 0 && turns[turns.length - 1].role === "assistant") {
          turns[turns.length - 1].content += "\n\n" + text;
        } else {
          turns.push({ role, content: text });
        }
      }

      if (turns.length > 0) {
        return {
          platform: "chatgpt",
          title: convData.title || document.title || "Active ChatGPT Session",
          turns,
          extractedVia: "api",
        };
      }
    } catch (err) {
      console.warn("[Continuity] ChatGPT direct API extraction failed, using DOM fallback:", err);
    }
    return null;
  }

  // 5. Internal API Extraction (<200ms) for Claude
  async function tryExtractClaudeApi() {
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
    if (!match) return null;
    const convUuid = match[1];

    try {
      const orgsRes = await fetch("/api/organizations", { credentials: "same-origin" });
      if (!orgsRes.ok) return null;
      const orgs = await orgsRes.json();
      const orgId = orgs[0]?.uuid;
      if (!orgId) return null;

      const convRes = await fetch(
        `/api/organizations/${orgId}/chat_conversations/${convUuid}?tree=True&rendering_mode=messages`,
        { credentials: "same-origin" }
      );
      if (!convRes.ok) return null;
      const convData = await convRes.json();
      const messages = convData.chat_messages;
      if (!Array.isArray(messages) || messages.length === 0) return null;

      const turns = [];
      for (const msg of messages) {
        const role = msg.sender === "human" ? "user" : "assistant";
        let text = "";
        if (msg.text) {
          text = msg.text.trim();
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .map((c) => (c.type === "text" ? c.text : c.type === "tool_result" ? c.content : ""))
            .join("\n")
            .trim();
        }

        if (!text) continue;

        if (role === "assistant" && turns.length > 0 && turns[turns.length - 1].role === "assistant") {
          turns[turns.length - 1].content += "\n\n" + text;
        } else {
          turns.push({ role, content: text });
        }
      }

      if (turns.length > 0) {
        return {
          platform: "claude",
          title: convData.name || document.title || "Active Claude Session",
          turns,
          extractedVia: "api",
        };
      }
    } catch (err) {
      console.warn("[Continuity] Claude direct API extraction failed, using DOM fallback:", err);
    }
    return null;
  }

  // 6. Resilient Surface Extractor (API + DOM Multi-Tier)
  async function extractConversation() {
    const platform = getPlatform();

    // Fast-path: Direct Internal API
    if (platform === "chatgpt") {
      const apiResult = await tryExtractChatGPTApi();
      if (apiResult && apiResult.turns.length > 0) return apiResult;
    } else if (platform === "claude") {
      const apiResult = await tryExtractClaudeApi();
      if (apiResult && apiResult.turns.length > 0) return apiResult;
    }

    // Clean DOM Fallback
    let title = document.title || "Active Session";
    title = title
      .replace(/\s*-\s*ChatGPT$/i, "")
      .replace(/\s*\|\s*Claude$/i, "")
      .replace(/\s*-\s*Gemini$/i, "")
      .trim();

    const turns = [];

    if (platform === "chatgpt") {
      const articles = document.querySelectorAll("article, [data-testid^='conversation-turn']");
      if (articles.length > 0) {
        articles.forEach((art, idx) => {
          let role = null;
          const authorAttr =
            art.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role") ||
            art.getAttribute("data-message-author-role");

          if (authorAttr === "user" || authorAttr === "assistant") {
            role = authorAttr;
          } else {
            const textHeader = art.querySelector("h5, h6, .sr-only")?.textContent || "";
            if (/you said/i.test(textHeader)) {
              role = "user";
            } else if (/chatgpt said|assistant said/i.test(textHeader)) {
              role = "assistant";
            } else if (art.querySelector(".markdown")) {
              role = "assistant";
            } else if (art.querySelector(".whitespace-pre-wrap")) {
              role = "user";
            } else {
              role = idx % 2 === 0 ? "user" : "assistant";
            }
          }

          const clone = art.cloneNode(true);
          clone.querySelectorAll(".sr-only, h5, h6").forEach((el) => {
            if (/said/i.test(el.textContent || "")) el.remove();
          });

          const targetContainer =
            role === "assistant" && clone.querySelector(".markdown")
              ? clone.querySelector(".markdown")
              : role === "user" && clone.querySelector(".whitespace-pre-wrap")
              ? clone.querySelector(".whitespace-pre-wrap")
              : clone;

          const content = cleanText(targetContainer.innerHTML);
          if (content) turns.push({ role, content });
        });
      }

      if (turns.length === 0) {
        const nodes = document.querySelectorAll("[data-message-author-role]");
        nodes.forEach((el) => {
          const role = el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
          const content = cleanText(el.innerHTML);
          if (content) turns.push({ role, content });
        });
      }
    } else if (platform === "claude") {
      const rawAll = Array.from(
        document.querySelectorAll(
          '[data-testid="user-message"], .font-user-message, .font-claude-message, [data-is-streaming], div.prose, [data-testid="chat-message"]'
        )
      );
      // Filter out nested duplicates
      const all = rawAll.filter((el) => !rawAll.some((other) => other !== el && other.contains(el)));
      all.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

      all.forEach((el) => {
        const isUser = el.matches('[data-testid="user-message"], .font-user-message');
        const isAssistant = el.matches('.font-claude-message, [data-is-streaming], div.prose');
        const role = isUser ? "user" : isAssistant ? "assistant" : null;
        if (role) {
          const content = cleanText(el.innerHTML);
          if (content) turns.push({ role, content });
        }
      });
    } else if (platform === "gemini") {
      const allTurns = Array.from(
        document.querySelectorAll(
          ".user-query-container, .model-response-text, user-query, model-response, [data-test-id='user-query'], [data-test-id='model-response']"
        )
      );
      allTurns.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      allTurns.forEach((el) => {
        const isUser = el.className.includes("user-query") || el.tagName.toLowerCase() === "user-query";
        const content = cleanText(el.innerHTML);
        if (content) turns.push({ role: isUser ? "user" : "assistant", content });
      });
    }

    // Universal Fallback: Parse visible speaker markers from body text
    if (turns.length === 0 && document.body) {
      const fullText = document.body.innerText || document.body.textContent || "";
      const lines = fullText.split("\n");
      let currentRole = null;
      let currentLines = [];
      const speakerRegex = /^(You said|ChatGPT said|User|Human|Claude|Assistant|Gemini):\s*(.*)$/i;

      for (const line of lines) {
        const match = line.trim().match(speakerRegex);
        if (match) {
          if (currentRole && currentLines.length > 0) {
            turns.push({ role: currentRole, content: currentLines.join("\n").trim() });
            currentLines = [];
          }
          const speaker = match[1].toLowerCase();
          currentRole = speaker === "you said" || speaker === "user" || speaker === "human" ? "user" : "assistant";
          if (match[2]) currentLines.push(match[2]);
        } else if (currentRole) {
          currentLines.push(line);
        }
      }
      if (currentRole && currentLines.length > 0) {
        turns.push({ role: currentRole, content: currentLines.join("\n").trim() });
      }
    }

    return { platform, title, turns, extractedVia: "dom" };
  }

  // 7. Inject Floating Widget HUD
  const container = document.createElement("div");
  container.id = "llm-continuity-container";

  container.innerHTML = `
    <div class="llm-continuity-pill" id="llm-pill">
      <div class="llm-continuity-icon">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </div>
      <span class="llm-continuity-pill-text">Handoff Session</span>
    </div>

    <div class="llm-continuity-card" id="llm-card">
      <div class="llm-card-header">
        <div class="llm-card-title">
          <span>⚡</span>
          <span>Continuity Layer</span>
        </div>
        <button class="llm-close-btn" id="llm-close">&times;</button>
      </div>

      <div class="llm-field-group">
        <label class="llm-field-label">Target LLM</label>
        <div class="llm-target-options">
          <button class="llm-target-btn active" data-target="claude">Claude</button>
          <button class="llm-target-btn" data-target="gemini">Gemini</button>
          <button class="llm-target-btn" data-target="chatgpt">ChatGPT</button>
        </div>
      </div>

      <div class="llm-field-group">
        <label class="llm-field-label">Custom Next Step (Optional)</label>
        <input type="text" class="llm-input-note" id="llm-note-input" placeholder="e.g. Focus on fixing test X first..." />
      </div>

      <button class="llm-action-btn" id="llm-handoff-btn">
        <span>🚀</span>
        <span>Handoff & Open Tab</span>
      </button>

      <div class="llm-status-text" id="llm-status">Ready for 1-click handoff</div>
    </div>
  `;

  document.body.appendChild(container);

  // 8. Interactive UI & Speculative Pre-Warming
  const pill = document.getElementById("llm-pill");
  const card = document.getElementById("llm-card");
  const closeBtn = document.getElementById("llm-close");
  const handoffBtn = document.getElementById("llm-handoff-btn");
  const statusEl = document.getElementById("llm-status");
  const noteInput = document.getElementById("llm-note-input");
  const targetBtns = document.querySelectorAll(".llm-target-btn");

  let selectedTarget = "claude";
  let prewarmedPromise = null;
  let prewarmedTarget = null;
  let cachedSession = null;

  // Speculative Pre-Warming on Pill Click
  pill.addEventListener("click", async () => {
    pill.style.display = "none";
    card.classList.add("open");

    try {
      const startTime = performance.now();
      statusEl.className = "llm-status-text";
      statusEl.textContent = "Extracting session turns...";

      cachedSession = await extractConversation();
      const elapsed = Math.round(performance.now() - startTime);

      if (cachedSession && cachedSession.turns.length > 0) {
        statusEl.textContent = `⚡ Extracted ${cachedSession.turns.length} turns in ${elapsed}ms (${cachedSession.extractedVia === "api" ? "Direct API" : "DOM"})`;
        prewarmedTarget = selectedTarget;

        // Warm server SHA-256 cache in the background
        prewarmedPromise = fetch("http://127.0.0.1:4141/api/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: cachedSession.title,
            source: cachedSession.platform,
            target: selectedTarget,
            messages: cachedSession.turns,
            nextStepNote: noteInput ? noteInput.value : undefined,
          }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
      } else {
        statusEl.textContent = "Ready for 1-click handoff";
      }
    } catch (err) {
      statusEl.textContent = "Ready for 1-click handoff";
    }
  });

  closeBtn.addEventListener("click", () => {
    card.classList.remove("open");
    pill.style.display = "flex";
  });

  targetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      targetBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedTarget = btn.getAttribute("data-target");
    });
  });

  // Handoff Execution (<50ms when pre-warmed)
  handoffBtn.addEventListener("click", async () => {
    try {
      handoffBtn.disabled = true;
      statusEl.className = "llm-status-text";

      const session = cachedSession || (await extractConversation());
      if (!session.turns || session.turns.length === 0) {
        statusEl.className = "llm-status-text error";
        statusEl.textContent = "No conversation turns detected on this page.";
        handoffBtn.disabled = false;
        return;
      }

      const note = noteInput ? noteInput.value.trim() : "";
      let data = null;

      // Check if pre-warmed promise is valid and matches selected target
      if (prewarmedPromise && prewarmedTarget === selectedTarget && !note) {
        statusEl.textContent = "Applying pre-warmed state (<50ms)...";
        data = await prewarmedPromise;
      }

      if (!data) {
        statusEl.textContent = `Compacting ${session.turns.length} turns via local daemon...`;
        const response = await fetch("http://127.0.0.1:4141/api/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: session.title,
            source: session.platform,
            target: selectedTarget,
            messages: session.turns,
            nextStepNote: note || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status} from daemon`);
        }

        data = await response.json();
      }

      // Store in chrome.storage.local for Target Tab Auto-Fill
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({
          pending_handoff: {
            envelope: data.envelope,
            target: selectedTarget,
            createdAt: Date.now(),
          },
        });
      }

      // Also copy handoff envelope to clipboard
      await navigator.clipboard.writeText(data.envelope);

      statusEl.className = "llm-status-text success";
      statusEl.textContent = data.cached ? "✓ Copied state (<2ms cache)! Opening tab..." : "✓ State ready! Opening tab...";

      const targetUrl =
        selectedTarget === "claude"
          ? "https://claude.ai/new"
          : selectedTarget === "gemini"
          ? "https://gemini.google.com/app"
          : "https://chatgpt.com/";

      // Request background service worker to open new target tab
      chrome.runtime.sendMessage({ action: "open_target_tab", url: targetUrl });

      setTimeout(() => {
        statusEl.className = "llm-status-text";
        statusEl.textContent = "Ready for 1-click handoff";
        handoffBtn.disabled = false;
        card.classList.remove("open");
        pill.style.display = "flex";
        cachedSession = null;
        prewarmedPromise = null;
      }, 3000);
    } catch (err) {
      statusEl.className = "llm-status-text error";
      statusEl.textContent =
        err.message.includes("Failed to fetch") || err.message.includes("NetworkError")
          ? "Daemon offline! Run 'npx tsx src/cli.ts serve' in terminal."
          : `Error: ${err.message}`;
      handoffBtn.disabled = false;
    }
  });

  // 9. Floating Toast Notification
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "llm-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // 10. Auto-Fill Target Tab Prompt Box
  async function checkPendingHandoffAutoFill() {
    if (!chrome.storage || !chrome.storage.local) return;

    try {
      const data = await chrome.storage.local.get("pending_handoff");
      if (!data || !data.pending_handoff) return;

      const { envelope, target, createdAt } = data.pending_handoff;
      if (Date.now() - createdAt > 45000) {
        await chrome.storage.local.remove("pending_handoff");
        return;
      }

      const currentPlatform = getPlatform();
      if (
        (target === "claude" && currentPlatform === "claude") ||
        (target === "gemini" && currentPlatform === "gemini") ||
        (target === "chatgpt" && currentPlatform === "chatgpt")
      ) {
        await chrome.storage.local.remove("pending_handoff");
        attemptAutoFill(envelope);
      }
    } catch (e) {
      // Storage access error handling
    }
  }

  function attemptAutoFill(envelope) {
    const startTime = Date.now();
    const maxWait = 8000;

    const interval = setInterval(() => {
      let editor = null;

      // Claude
      editor = document.querySelector('div.ProseMirror[contenteditable="true"]');
      // Gemini
      if (!editor) {
        editor =
          document.querySelector('.ql-editor[contenteditable="true"]') ||
          document.querySelector('rich-textarea [contenteditable="true"]') ||
          document.querySelector('textarea.textarea');
      }
      // ChatGPT
      if (!editor) {
        editor =
          document.querySelector('#prompt-textarea') ||
          document.querySelector('div[contenteditable="true"]#prompt-textarea');
      }

      if (editor) {
        clearInterval(interval);
        if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
          editor.value = envelope;
          editor.dispatchEvent(new Event("input", { bubbles: true }));
          editor.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          editor.focus();
          document.execCommand("insertText", false, envelope);
          if (!editor.textContent || editor.textContent.trim().length === 0) {
            editor.innerText = envelope;
          }
          editor.dispatchEvent(new Event("input", { bubbles: true }));
        }
        showToast("✓ Handoff Auto-Filled! Press Enter to continue.");
      } else if (Date.now() - startTime > maxWait) {
        clearInterval(interval);
      }
    }, 400);
  }
})();
