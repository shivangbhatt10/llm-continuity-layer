#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContinuityMcpServer } from "./server.js";

async function main() {
  const { server, store } = createContinuityMcpServer();
  const transport = new StdioServerTransport();

  const cleanup = () => {
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await server.connect(transport);
  console.error("[Continuity MCP] Server listening on stdio (llm-continuity-memory v1.0.0)");
}

main().catch((err) => {
  console.error("[Continuity MCP] Fatal server error:", err);
  process.exit(1);
});
