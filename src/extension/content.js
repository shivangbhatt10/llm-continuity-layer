// Cross-Provider LLM Continuity Layer Content Script

(function () {
  if (document.getElementById("llm-continuity-container")) return;

  // 1. Platform Detection
  function getPlatform() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes("chatgpt.com") || host.includes("openai.com")) return "chatgpt";
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("gemini.google.com")) return "gemini";
    return "unknown";
  }

  // 2. HTML to Clean Text with Fenced Code Blocks
  function cleanText(html) {
    let text = html;
    text = text.replace(
      /<pre[^>]*><code(?: class="[^"]*language-([a-zA-Z0-9#+_-]+)[^"]*")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      (_, lang, code) => {
        const langTag = lang || "";
        const cleanCode = code
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

  // 3. Resilient Surface Extractor
  function extractConversation() {
    const platform = getPlatform();
    let title = document.title || "Active Session";
    title = title
      .replace(/\s*-\s*ChatGPT$/i, "")
      .replace(/\s*\|\s*Claude$/i, "")
      .replace(/\s*-\s*Gemini$/i, "")
      .trim();

    const turns = [];

    if (platform === "chatgpt") {
      // 1. Modern ChatGPT uses <article> elements for conversation turns
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

      // 2. Direct attribute fallback
      if (turns.length === 0) {
        const nodes = document.querySelectorAll("[data-message-author-role]");
        nodes.forEach((el) => {
          const role = el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
          const content = cleanText(el.innerHTML);
          if (content) turns.push({ role, content });
        });
      }
    } else if (platform === "claude") {
      const all = Array.from(
        document.querySelectorAll(
          '[data-testid="user-message"], .font-user-message, .font-claude-message, [data-is-streaming], div.prose, [data-testid="chat-message"]'
        )
      );
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

    // 3. Universal Fallback: Parse visible speaker markers from body text
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

    return { platform, title, turns };
  }

  // 4. Inject Floating Widget HUD
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
        </div>
      </div>

      <button class="llm-action-btn" id="llm-handoff-btn">
        <span>🚀</span>
        <span>Handoff & Copy State</span>
      </button>

      <div class="llm-status-text" id="llm-status">Ready for 1-click handoff</div>
    </div>
  `;

  document.body.appendChild(container);

  // 5. Interactive UI Bindings
  const pill = document.getElementById("llm-pill");
  const card = document.getElementById("llm-card");
  const closeBtn = document.getElementById("llm-close");
  const handoffBtn = document.getElementById("llm-handoff-btn");
  const statusEl = document.getElementById("llm-status");
  const targetBtns = document.querySelectorAll(".llm-target-btn");

  let selectedTarget = "claude";

  pill.addEventListener("click", () => {
    pill.style.display = "none";
    card.classList.add("open");
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

  handoffBtn.addEventListener("click", async () => {
    try {
      handoffBtn.disabled = true;
      statusEl.className = "llm-status-text";
      statusEl.textContent = "Extracting session turns...";

      const session = extractConversation();
      if (!session.turns || session.turns.length === 0) {
        statusEl.className = "llm-status-text error";
        statusEl.textContent = "No conversation turns detected on this page.";
        handoffBtn.disabled = false;
        return;
      }

      statusEl.textContent = `Compacting ${session.turns.length} turns via local daemon...`;

      // Dispatch to local continuity daemon
      const response = await fetch("http://127.0.0.1:4141/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: session.title,
          source: session.platform,
          target: selectedTarget,
          messages: session.turns,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status} from daemon`);
      }

      const data = await response.json();

      // Copy handoff envelope to clipboard
      await navigator.clipboard.writeText(data.envelope);

      statusEl.className = "llm-status-text success";
      statusEl.textContent = "✓ Copied 3-line handshake! Opening tab...";

      // Destination URL
      const targetUrl =
        selectedTarget === "claude"
          ? "https://claude.ai/new"
          : selectedTarget === "gemini"
          ? "https://gemini.google.com/app"
          : "https://chatgpt.com";

      // Request background service worker to open new target tab
      chrome.runtime.sendMessage({ action: "open_target_tab", url: targetUrl });

      setTimeout(() => {
        statusEl.className = "llm-status-text";
        statusEl.textContent = "Ready for 1-click handoff";
        handoffBtn.disabled = false;
        card.classList.remove("open");
        pill.style.display = "flex";
      }, 3500);
    } catch (err) {
      statusEl.className = "llm-status-text error";
      statusEl.textContent =
        err.message.includes("Failed to fetch") || err.message.includes("NetworkError")
          ? "Daemon offline! Run 'npx tsx src/cli.ts serve' in terminal."
          : `Error: ${err.message}`;
      handoffBtn.disabled = false;
    }
  });
})();
