import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CHAINS } from "@layerhop/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpServer, type RunningHttpServer } from "../src/http.js";
import { mockApi } from "./helpers.js";

const textOf = (r: CallToolResult) => (r.content[0] as { text: string }).text;

describe("Streamable HTTP transport", () => {
  let srv: RunningHttpServer;
  const api = mockApi();

  beforeAll(async () => {
    srv = await startHttpServer({ port: 0, host: "127.0.0.1", fetch: api.fetch, config: { apiUrl: "https://api.test" } });
  });
  afterAll(async () => {
    await srv.close();
  });

  it("lists tools and calls list_chains via the SDK client", async () => {
    const client = new Client({ name: "http-test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(srv.url)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("get_quote");
    const r = (await client.callTool({ name: "list_chains", arguments: {} })) as CallToolResult;
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(textOf(r)).chains.map((c: { slug: string }) => c.slug)).toContain("solana");
    expect(api.calls.some((c) => c.url.href === "https://api.test/v1/chains")).toBe(true);
    await client.close();
  });

  it("forwards a per-request API key header to the LayerHop API", async () => {
    const seen: (string | null)[] = [];
    const keyed = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("x-api-key"));
      return api.fetch(input, init);
    }) as typeof fetch;
    const s2 = await startHttpServer({ port: 0, fetch: keyed, config: { apiUrl: "https://api.test" } });
    const client = new Client({ name: "k", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(s2.url), { requestInit: { headers: { "x-layerhop-api-key": "lh_live_abc" } } }));
    await client.callTool({ name: "list_chains", arguments: {} });
    expect(seen).toContain("lh_live_abc");
    await client.close();
    await s2.close();
  });

  it("serves /healthz, CORS preflight, and rejects GET /mcp (stateless)", async () => {
    const base = srv.url.replace(/\/mcp$/, "");
    const h = await fetch(`${base}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ ok: true, name: "layerhop-mcp" });

    const pre = await fetch(srv.url, { method: "OPTIONS", headers: { origin: "https://claude.ai", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-headers")).toMatch(/mcp-protocol-version/);

    const get = await fetch(srv.url, { headers: { accept: "text/event-stream" } });
    expect(get.status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const bad = await fetch(srv.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{" });
    expect(bad.status).toBe(400);
  });
});

describe("stdio transport", () => {
  let mock: Server;
  let apiUrl: string;

  beforeAll(async () => {
    // A tiny stand-in for api.layerhop.com, since the child process can't use a mocked fetch.
    mock = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/v1/chains")) res.end(JSON.stringify({ chains: CHAINS }));
      else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    apiUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => mock.close(() => r())));

  it("runs the CLI over stdio and answers list_chains", async () => {
    const pkg = fileURLToPath(new URL("..", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/cli.ts"],
      cwd: pkg,
      env: { ...(process.env as Record<string, string>), LAYERHOP_API_URL: apiUrl },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "0" });
    await client.connect(transport);
    expect(client.getServerVersion()).toMatchObject({ name: "layerhop" });
    expect(client.getInstructions()).toMatch(/never signs/);
    const r = (await client.callTool({ name: "list_chains", arguments: {} })) as CallToolResult;
    expect(JSON.parse(textOf(r)).chains).toHaveLength(CHAINS.length);
    await client.close();
  });
});
