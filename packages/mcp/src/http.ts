import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LayerHopClient } from "./client.js";
import { configFromEnv, VERSION, type McpConfig } from "./config.js";
import { buildServer, QuoteCache } from "./server.js";

export interface HttpServerOptions {
  port?: number;
  host?: string;
  /** Endpoint path, default /mcp. */
  path?: string;
  config?: Partial<McpConfig>;
  fetch?: typeof fetch;
}

export interface RunningHttpServer {
  server: Server;
  /** e.g. http://127.0.0.1:8090/mcp */
  url: string;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY = 1024 * 1024;
const INTEGRATOR_RE = /^[a-z0-9-]{1,32}$/;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id, x-layerhop-api-key, x-layerhop-integrator",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS, "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  send(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    throw Object.assign(new Error("Parse error: invalid JSON"), { status: 400, rpc: -32700 });
  }
}

/**
 * Streamable HTTP MCP server in stateless mode: every POST /mcp gets a fresh McpServer + transport
 * (no sessions, so it scales horizontally behind a load balancer). Caches (chains, tokens, quote
 * context) are shared across requests in this process.
 *
 * Optional per-request headers: `x-layerhop-api-key` (or `Authorization: Bearer lh_live_…`) and
 * `x-layerhop-integrator` override the server's env defaults for that request.
 */
export async function startHttpServer(opts: HttpServerOptions = {}): Promise<RunningHttpServer> {
  const config: McpConfig = { ...configFromEnv(), ...(opts.config ?? {}) } as McpConfig;
  const path = opts.path ?? "/mcp";
  const userAgent = `layerhop-mcp/${VERSION} (http)`;
  const sharedClient = new LayerHopClient({ apiUrl: config.apiUrl, apiKey: config.apiKey, integrator: config.integrator, fetch: opts.fetch, userAgent });
  const quoteCache = new QuoteCache();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (url.pathname === "/healthz" || url.pathname === "/health") {
      send(res, 200, { ok: true, name: "layerhop-mcp", version: VERSION });
      return;
    }
    if (url.pathname === "/" && req.method === "GET") {
      send(res, 200, { name: "layerhop-mcp", version: VERSION, mcp: path, docs: `${config.docsUrl}/guides/ai-agents` });
      return;
    }
    if (url.pathname !== path) {
      send(res, 404, { error: { code: "NOT_FOUND", message: `Not found. The MCP endpoint is ${path}.` } });
      return;
    }
    if (req.method !== "POST") {
      // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
      res.setHeader("allow", "POST, OPTIONS");
      rpcError(res, 405, -32000, "Method not allowed. This server is stateless; send JSON-RPC requests with POST.");
      return;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      const err = e as Error & { status?: number; rpc?: number };
      rpcError(res, err.status ?? 400, err.rpc ?? -32600, err.message);
      return;
    }

    const headerKey = header(req, "x-layerhop-api-key") ?? bearer(header(req, "authorization"));
    const headerIntegrator = header(req, "x-layerhop-integrator");
    const integrator = headerIntegrator && INTEGRATOR_RE.test(headerIntegrator) ? headerIntegrator : config.integrator;
    const client =
      headerKey || integrator !== config.integrator
        ? new LayerHopClient({ apiUrl: config.apiUrl, apiKey: headerKey ?? config.apiKey, integrator, fetch: opts.fetch, userAgent })
        : sharedClient;

    const mcp = buildServer({ config: { ...config, integrator }, client, quoteCache });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) rpcError(res, 500, -32603, e instanceof Error ? e.message : "Internal error");
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((e) => {
      if (!res.headersSent) rpcError(res, 500, -32603, e instanceof Error ? e.message : "Internal error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 8090, opts.host ?? "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const hostForUrl = addr.family === "IPv6" ? `[${addr.address}]` : addr.address;
  return {
    server,
    port: addr.port,
    url: `http://${hostForUrl === "0.0.0.0" ? "127.0.0.1" : hostForUrl}:${addr.port}${path}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

function bearer(v: string | undefined): string | undefined {
  const m = v ? /^Bearer\s+(lh_[A-Za-z0-9_]+)$/i.exec(v) : null;
  return m?.[1];
}
