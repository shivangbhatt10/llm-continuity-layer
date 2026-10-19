import http from "node:http";
import crypto from "node:crypto";
import type { Socket } from "node:net";
import type { Capsule, Conversation, LLMClient, Role } from "../core/schema.js";
import { synthesizeCapsule } from "../core/capsule.js";
import { formatCapsule } from "../deliver/formatters/index.js";
import { SQLiteStore, type ConversationStore } from "../store/db.js";
import { GeminiClient, ScriptedLLM } from "../core/llm.js";
import { scrubChatGPTUnicodeAndCitations } from "../ingest/unicode_scrubber.js";
import config from "../config.js";
import type {
  HandoffRequest,
  HandoffResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ServerOptions,
} from "./types.js";
import { executeWithFailover } from "./failover.js";

export interface ContinuityServerInstance {
  server: http.Server;
  store: ConversationStore;
  cache: Map<string, Capsule>;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Parses incoming JSON request stream.
 */
async function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        // 20MB limit
        reject(new Error("Payload Too Large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(body) as T);
      } catch (err) {
        reject(new Error("Invalid JSON payload: " + (err as Error).message));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Helper to write JSON responses.
 */
function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  });
  res.end(json);
}

/**
 * Creates and initializes the local Continuity Daemon & HTTP Proxy.
 */
export async function createContinuityServer(
  options: ServerOptions = {}
): Promise<ContinuityServerInstance> {
  const store = options.store || new SQLiteStore(options.dbPath || "continuity.db");
  const llm: LLMClient =
    options.llm ||
    (config.isOffline
      ? new ScriptedLLM()
      : new GeminiClient());

  const activeSockets = new Set<Socket>();
  // In-memory SHA-256 Turn-Hash Cache (Milestone M12 God-Speed)
  const capsuleCache = new Map<string, Capsule>();

  const server = http.createServer(async (req, res) => {
    // 1. CORS Preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = url.pathname;

    try {
      // 2. Health check
      if (req.method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, {
          status: "ok",
          version: "1.0.0",
          cheap_model: config.cheapModel,
          strong_model: config.strongModel,
          is_offline: config.isOffline,
          has_api_key: !config.isOffline,
          cache_size: capsuleCache.size,
        });
        return;
      }

      // 3. Browser Extension Handoff Endpoint: POST /api/handoff
      if (req.method === "POST" && pathname === "/api/handoff") {
        const payload = await parseJsonBody<HandoffRequest>(req);

        if (!payload.messages || !Array.isArray(payload.messages) || payload.messages.length === 0) {
          sendJson(res, 400, { error: "Missing required 'messages' array in payload." });
          return;
        }

        const target = payload.target || "claude";

        // Compute SHA-256 cache key across raw turns + custom nextStepNote
        const cacheHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(payload.messages) + "::" + (payload.nextStepNote || ""))
          .digest("hex");

        // God-Speed Cache Hit (< 2ms)
        if (capsuleCache.has(cacheHash)) {
          const cachedCapsule = capsuleCache.get(cacheHash)!;
          const envelope = formatCapsule(cachedCapsule, target);

          const response: HandoffResponse = {
            success: true,
            conversation_id: cachedCapsule.conversation_id,
            title: cachedCapsule.title,
            types: cachedCapsule.types,
            target,
            envelope,
            next_step: cachedCapsule.next_step,
            artifact_count: cachedCapsule.artifacts.length,
            created_at: cachedCapsule.created_at,
            cached: true,
          };

          sendJson(res, 200, response);
          return;
        }

        const title = payload.title || payload.messages[0]?.content.slice(0, 60).replace(/\n/g, " ") || "Browser Handoff";
        const convId = `ext-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        // M12: Scrub incoming extension messages (U+E200 entity/cite cleaner and fileL.. scrubber)
        const scrubbedMessages = payload.messages.map((m, idx) => ({
          role: m.role as Role,
          content: scrubChatGPTUnicodeAndCitations(m.content).text,
          id: m.id || `m-${idx}`,
          ts: m.ts || Date.now(),
        }));

        const conv: Conversation = {
          id: convId,
          source: payload.source || "extension",
          title,
          messages: scrubbedMessages,
          created_at: Date.now(),
          meta: { client: "chrome-extension" },
        };

        // Synthesize capsule with zero-latency classification (fastMode)
        const capsule = await synthesizeCapsule(conv, llm, {
          fastMode: true,
          customNextStep: payload.nextStepNote,
        });

        // Persist to SQLite Working Memory
        store.saveCapsule(capsule);
        // Save in-memory cache
        capsuleCache.set(cacheHash, capsule);

        // Format for selected target provider
        const envelope = formatCapsule(capsule, target);

        const response: HandoffResponse = {
          success: true,
          conversation_id: capsule.conversation_id,
          title: capsule.title,
          types: capsule.types,
          target,
          envelope,
          next_step: capsule.next_step,
          artifact_count: capsule.artifacts.length,
          created_at: capsule.created_at,
          cached: false,
        };

        sendJson(res, 200, response);
        return;
      }

      // 4. OpenAI-compatible Proxy: POST /v1/chat/completions
      if (req.method === "POST" && pathname === "/v1/chat/completions") {
        const payload = await parseJsonBody<ChatCompletionRequest>(req);
        const messages = payload.messages || [];

        let systemPrompt = "You are a helpful and precise software engineering assistant.";
        const chatTurns: string[] = [];

        for (const m of messages) {
          if (m.role === "system") {
            systemPrompt += "\n" + m.content;
          } else {
            chatTurns.push(`${m.role.toUpperCase()}: ${m.content}`);
          }
        }

        const prompt = chatTurns.join("\n\n");

        // Primary execution with failover resilience
        const failoverExecution = await executeWithFailover([
          async () => llm.complete(systemPrompt, prompt),
          async () => {
            // Secondary fallback if primary fails
            const fallbackClient = new GeminiClient({ model: config.cheapModel });
            return fallbackClient.complete(systemPrompt, prompt);
          },
        ]);

        const completionResponse: ChatCompletionResponse = {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: payload.model || config.strongModel,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: failoverExecution.result,
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: Math.ceil(prompt.length / 4),
            completion_tokens: Math.ceil(failoverExecution.result.length / 4),
            total_tokens: Math.ceil((prompt.length + failoverExecution.result.length) / 4),
          },
        };

        sendJson(res, 200, completionResponse);
        return;
      }

      // 5. Anthropic-compatible Proxy: POST /v1/messages
      if (req.method === "POST" && pathname === "/v1/messages") {
        const payload = await parseJsonBody<any>(req);
        const systemPrompt = payload.system || "You are a helpful assistant.";
        const messages = payload.messages || [];
        const prompt = messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

        const failoverExecution = await executeWithFailover([
          async () => llm.complete(systemPrompt, prompt),
        ]);

        sendJson(res, 200, {
          id: `msg-${Date.now()}`,
          type: "message",
          role: "assistant",
          model: payload.model || "claude-3-5-sonnet",
          content: [{ type: "text", text: failoverExecution.result }],
          stop_reason: "end_turn",
        });
        return;
      }

      // 404 for unknown endpoints
      sendJson(res, 404, { error: `Not Found: ${req.method} ${pathname}` });
    } catch (err) {
      console.error("[Continuity Server Error]", err);
      sendJson(res, 500, { error: (err as Error).message || "Internal Server Error" });
    }
  });

  // Track socket connections for clean teardown
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });

  return {
    server,
    store,
    cache: capsuleCache,
    listen(port = options.port ?? 4141): Promise<number> {
      return new Promise((resolve, reject) => {
        server.listen(port, options.host || "127.0.0.1", () => {
          const addr = server.address();
          if (typeof addr === "object" && addr) {
            resolve(addr.port);
          } else {
            resolve(port);
          }
        });
        server.on("error", reject);
      });
    },
    async close(): Promise<void> {
      for (const socket of activeSockets) {
        socket.destroy();
      }
      activeSockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      store.close();
    },
  };
}
