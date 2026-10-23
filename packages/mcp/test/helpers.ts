import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CHAINS, TOKENS } from "@layerhop/shared";
import { createLayerHopMcpServer } from "../src/server.js";

export const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
export const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const API = "https://api.test";

export interface Call {
  method: string;
  url: URL;
  body: unknown;
}

type Route = (call: Call) => { status?: number; body?: unknown; text?: string } | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const sampleQuote = (over: Record<string, unknown> = {}) => ({
  quoteId: "q_best",
  provider: "relay",
  dstAmount: "949742908",
  dstAmountMin: "944994194",
  estimatedSeconds: 95,
  fees: { ourFeeBps: 10, providerFeeUsd: 0.12, gasUsd: 0.001 },
  expiresAt: Math.floor(Date.now() / 1000) + 30,
  ...over,
});

/** A fetch mock for the LayerHop API. `routes` run first; built-in chains/tokens/quote defaults follow. */
export function mockApi(routes: Route[] = []) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method, url, body };
    calls.push(call);
    for (const r of routes) {
      const out = r(call);
      if (out) return out.text !== undefined ? new Response(out.text, { status: out.status ?? 200 }) : json(out.body, out.status);
    }
    const p = url.pathname;
    if (p === "/v1/chains") return json({ chains: CHAINS });
    if (p === "/v1/tokens") {
      const c = CHAINS.find((x) => String(x.id) === url.searchParams.get("chain") || x.slug === url.searchParams.get("chain"));
      return json({ tokens: TOKENS.filter((t) => t.chainId === c?.id) });
    }
    if (p === "/v1/quote") {
      const best = sampleQuote();
      return json({ best, quotes: [best, sampleQuote({ quoteId: "q_alt", provider: "lifi", dstAmount: "949657405", estimatedSeconds: 180 })], errors: [] });
    }
    return new Response("404 Not Found", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

export async function connect(fetchFn: typeof fetch, config: Record<string, string> = {}) {
  const server = createLayerHopMcpServer({ config: { apiUrl: API, appUrl: "https://layerhop.com", docsUrl: "https://docs.test", ...config }, fetch: fetchFn });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { client, server, call };
}

export const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;
export const data = <T = Record<string, any>>(r: CallToolResult): T => {
  if (r.isError) throw new Error(`tool error: ${text(r)}`);
  return JSON.parse(text(r)) as T;
};
