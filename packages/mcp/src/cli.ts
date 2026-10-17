#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./config.js";
import { startHttpServer } from "./http.js";
import { createLayerHopMcpServer } from "./server.js";
import { parseArgs } from "./args.js";

const HELP = `layerhop-mcp ${VERSION} — LayerHop MCP server (holds no keys, never signs)

Usage:
  layerhop-mcp                         stdio transport (for Claude Desktop, Claude Code, Cursor, ...)
  layerhop-mcp --http [--port 8090] [--host 127.0.0.1]
                                       Streamable HTTP transport at /mcp (+ GET /healthz)

Environment:
  LAYERHOP_API_URL      default https://api.layerhop.com
  LAYERHOP_API_KEY      optional API key (lh_live_...)
  LAYERHOP_INTEGRATOR   optional partner id for partner fees
  LAYERHOP_APP_URL      deep-link base, default https://layerhop.com
  PORT / HOST           defaults for --port / --host in HTTP mode
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.http) {
    const s = await startHttpServer({ port: args.port, host: args.host });
    // stdout is fine in HTTP mode; stdio mode must keep stdout for JSON-RPC only.
    console.log(`layerhop-mcp ${VERSION} listening on ${s.url} (health: /healthz)`);
    const stop = () => void s.close().finally(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }
  const server = createLayerHopMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`layerhop-mcp ${VERSION} running on stdio`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
