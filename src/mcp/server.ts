import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SQLiteStore } from "../store/db.js";
import { formatCapsule, type TargetProvider } from "../deliver/formatters/index.js";
import { heuristicClassify } from "../core/classify.js";
import type { Artifact, Capsule, Message } from "../core/schema.js";

export interface McpServerOptions {
  dbPath?: string;
  store?: SQLiteStore;
}

export interface ContinuityMcpInstance {
  server: McpServer;
  store: SQLiteStore;
  close: () => void;
}

/**
 * Creates and initializes the Model Context Protocol (MCP) server
 * bound to the local Continuity Working Memory SQLite database.
 */
export function createContinuityMcpServer(
  options: McpServerOptions = {}
): ContinuityMcpInstance {
  const dbPath = options.dbPath || process.env.CONTINUITY_DB_PATH || "continuity.db";
  const store = options.store || new SQLiteStore(dbPath);

  const server = new McpServer({
    name: "llm-continuity-memory",
    version: "1.0.0",
  });

  // 1. Tool: get_latest_handoff
  server.tool(
    "get_latest_handoff",
    "Retrieves the active conversation handoff capsule from working memory, including Goal, Active Constraints, Ruled Out dead ends, latest code artifacts, and the immediate Next Step.",
    {
      target_format: z
        .enum(["claude", "gemini", "markdown", "raw"])
        .optional()
        .describe("Target delivery format: 'claude' (XML-hybrid with 3-line handshake), 'gemini' (dynamic backtick fences), 'markdown', or 'raw' (JSON). Defaults to 'claude'."),
      conversation_id: z
        .string()
        .optional()
        .describe("Optional conversation ID to retrieve. If omitted, returns the latest updated session in memory."),
    },
    async ({ target_format = "claude", conversation_id }) => {
      const capsule = conversation_id
        ? store.getLatestCapsule(conversation_id)
        : store.getLatestOverallCapsule();

      if (!capsule) {
        return {
          content: [
            {
              type: "text",
              text: conversation_id
                ? `No continuity capsule found for conversation ID: "${conversation_id}".`
                : "No continuity sessions found in working memory.",
            },
          ],
        };
      }

      if (target_format === "raw") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(capsule, null, 2),
            },
          ],
        };
      }

      const envelope = formatCapsule(capsule, target_format as TargetProvider);
      return {
        content: [
          {
            type: "text",
            text: envelope,
          },
        ],
      };
    }
  );

  // 2. Tool: list_saved_sessions
  server.tool(
    "list_saved_sessions",
    "Lists all conversation sessions saved in the local continuity memory layer.",
    {
      limit: z
        .number()
        .optional()
        .describe("Maximum number of sessions to return (default: 10)."),
    },
    async ({ limit = 10 }) => {
      const sessions = store.listSessions(limit);

      if (sessions.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No continuity sessions found in working memory.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(sessions, null, 2),
          },
        ],
      };
    }
  );

  // 3. Tool: search_sessions
  server.tool(
    "search_sessions",
    "Searches saved continuity sessions by keyword across title, goal, decisions, and constraints.",
    {
      query: z
        .string()
        .describe("Search term or phrase to query across titles, goals, decisions, constraints, and next steps."),
    },
    async ({ query }) => {
      const results = store.searchSessions(query);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No continuity sessions matched query: "${query}".`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // 4. Tool: save_checkpoint
  server.tool(
    "save_checkpoint",
    "Saves a new state capsule checkpoint into continuity memory from the AI harness so the user can continue in the browser (ChatGPT/Claude/Gemini) or another tool.",
    {
      title: z.string().describe("Descriptive title for this session or checkpoint."),
      goal: z.string().describe("The primary objective, problem, or task being worked on."),
      current_state: z.string().describe("The current progress, what is working, or status."),
      next_step: z.string().describe("The immediate next action or instruction to execute."),
      ruled_out: z
        .string()
        .optional()
        .describe("Approaches tested that failed or are ruled out, with reasons why."),
      artifacts: z
        .array(
          z.object({
            lang: z.string().describe("Language identifier (e.g. typescript, python, bash, json)"),
            code: z.string().describe("Verbatim source code or configuration snippet"),
            label: z.string().optional().describe("File path or label (e.g. src/auth.ts)"),
          })
        )
        .optional()
        .describe("Active code or configuration artifacts produced during this turn."),
      source: z
        .string()
        .optional()
        .describe("Source harness or agent name (default: 'harness')."),
      conversation_id: z
        .string()
        .optional()
        .describe("Optional existing conversation ID to append a new version to. If omitted, generates a new ID."),
    },
    async ({
      title,
      goal,
      current_state,
      next_step,
      ruled_out,
      artifacts,
      source = "harness",
      conversation_id,
    }) => {
      const convId =
        conversation_id || `harness-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const sections: Record<string, string> = {
        Goal: goal,
        "Current State": current_state,
        "Next Step": next_step,
      };

      if (ruled_out) {
        sections["Ruled Out (with why)"] = ruled_out;
      }

      const parsedArtifacts: Artifact[] = (artifacts || []).map((art, idx) => ({
        lang: art.lang,
        code: art.code,
        label: art.label || null,
        message_index: idx,
        role: "assistant" as const,
      }));

      const recent_turns: Message[] = [
        { role: "user", content: `Goal: ${goal}` },
        { role: "assistant", content: `Current State: ${current_state}\nNext Step: ${next_step}` },
      ];

      const types = heuristicClassify(`${title} ${goal} ${current_state}`);

      const capsule: Capsule = {
        conversation_id: convId,
        title,
        source,
        types,
        sections,
        next_step,
        recent_turns,
        artifacts: parsedArtifacts,
        created_at: Date.now(),
        meta: {
          client: "mcp-harness",
          saved_via: "mcp-tool",
        },
      };

      const saved = store.saveCapsule(capsule);

      return {
        content: [
          {
            type: "text",
            text: `✓ Saved checkpoint v${saved.version} for session "${saved.title}" (Conversation ID: ${saved.conversation_id}).\nNext Step: ${saved.next_step}`,
          },
        ],
      };
    }
  );

  return {
    server,
    store,
    close: () => store.close(),
  };
}
