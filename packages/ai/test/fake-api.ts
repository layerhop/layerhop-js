/**
 * A fake LayerHop API (fetch mock) shared by the agent-framework packages' tests. No network, no
 * wallets: every request is recorded and answered from fixtures.
 */
import { CHAINS, TOKENS } from "@layerhop/shared";

export const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
export const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const API = "https://api.test";
export const TEST_KEY = `lh_test_${"a".repeat(32)}`;
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const ROUTER = "0x1111111111111111111111111111111111111111";
export const SPENDER = "0x2222222222222222222222222222222222222222";
export const TX_HASH = `0x${"ab".repeat(32)}`;

export interface Call {
  method: string;
  url: URL;
  body: any;
  headers: Record<string, string>;
}

type Route = (call: Call) => { status?: number; body?: unknown; text?: string } | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const sampleQuote = (over: Record<string, unknown> = {}) => ({
  quoteId: "q_best",
  provider: "relay",
  dstAmount: "949742908",
  dstAmountMin: "944994194",
  estimatedSeconds: 95,
  fees: { ourFeeBps: 20, providerFeeUsd: 0.12, gasUsd: 0.001 },
  expiresAt: Math.floor(Date.now() / 1000) + 30,
  ...over,
});

export const evmBuilt = (over: Record<string, unknown> = {}) => ({
  vm: "evm",
  chainId: 8453,
  to: ROUTER,
  data: "0xdeadbeef",
  value: "0",
  approval: { token: BASE_USDC, spender: SPENDER, amount: "100000000" },
  ...over,
});

export const sampleDa = (over: Record<string, unknown> = {}) => ({
  id: "da_test1",
  object: "deposit_address",
  livemode: false,
  status: "active",
  provider: "sandbox",
  address: "0x1234567890abcdef1234567890abcdef12345678",
  chainId: 8453,
  token: BASE_USDC,
  dstChainId: 42161,
  dstToken: ARB_USDC,
  recipient: EVM,
  refundTo: EVM,
  reusable: true,
  amount: null,
  fees: { ourFeeBps: 20, integratorFeeBps: 0, integrator: null },
  label: null,
  metadata: null,
  depositCount: 0,
  lastDepositAt: null,
  createdAt: "2026-10-19T10:00:00.000Z",
  ...over,
});

export const sampleCheckout = (over: Record<string, unknown> = {}) => ({
  id: "cs_test1",
  object: "checkout.session",
  livemode: false,
  status: "open",
  statusDetail: null,
  amount: "49000000",
  settlement: { chainId: 8453, token: BASE_USDC, symbol: "USDC", decimals: 6 },
  recipient: EVM,
  merchantName: null,
  description: null,
  url: "https://pay.layerhop.com/c/cs_test1",
  successUrl: null,
  cancelUrl: null,
  expiresAt: "2026-10-19T11:00:00.000Z",
  payment: null,
  createdAt: "2026-10-19T10:00:00.000Z",
  updatedAt: "2026-10-19T10:00:00.000Z",
  ...over,
});

/** fetch mock for the LayerHop API. `routes` run first; fixtures for every endpoint the tools use follow. */
export function fakeApi(routes: Route[] = [], opts: { built?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = { method, url, body, headers };
    calls.push(call);
    for (const r of routes) {
      const out = r(call);
      if (out) return out.text !== undefined ? new Response(out.text, { status: out.status ?? 200 }) : json(out.body, out.status);
    }
    const p = url.pathname;
    if (p === "/v1/chains") return json({ chains: CHAINS });
    if (p === "/v1/tokens") {
      const c = CHAINS.find((x) => String(x.id) === url.searchParams.get("chain") || x.slug === url.searchParams.get("chain"));
      const q = url.searchParams.get("q")?.toLowerCase();
      const list = TOKENS.filter((t) => t.chainId === c?.id && (!q || t.symbol.toLowerCase().includes(q))).map((t) => ({ ...t, name: t.symbol, verified: true, priceUsd: 1 }));
      return json({ tokens: list, nextCursor: null });
    }
    if (p === "/v1/prices") {
      const ids = (url.searchParams.get("ids") ?? "").split(",");
      return json({ prices: Object.fromEntries(ids.filter((i) => i.startsWith("8453:")).map((i) => [i, 1.0001])) });
    }
    if (p === "/v1/quote") {
      const best = sampleQuote();
      return json({ best, quotes: [best, sampleQuote({ quoteId: "q_alt", provider: "lifi", dstAmount: "949657405", estimatedSeconds: 180 })], errors: [] });
    }
    if (p === "/v1/orders" && method === "POST") return json({ quoteId: body.quoteId, provider: "relay", tx: opts.built ?? evmBuilt() });
    if (p === "/v1/orders/submit" && method === "POST") return json({ txHash: "5".repeat(88) });
    if (/^\/v1\/orders\/q_[^/]+\/submitted$/.test(p)) return json({ quoteId: p.split("/")[3], status: "submitted" });
    if (/^\/v1\/orders\/relay\//.test(p)) return json({ state: "filled", srcTxHash: TX_HASH, dstTxHash: TX_HASH });
    if (p === "/v1/simulate") return json({ ok: true, vm: "evm", gasEstimate: "210000", needsApproval: true });
    if (p === "/v1/checkout/sessions" && method === "POST") return json(sampleCheckout({ amount: body.amount }));
    if (p === "/v1/deposit-addresses" && method === "POST") {
      return json({ ...sampleDa(), estimate: { amount: "25000000", dstAmount: "24950000", dstAmountMin: "24800000", estimatedSeconds: 30 } });
    }
    if (/^\/v1\/deposit-addresses\/da_/.test(p)) return json({ ...sampleDa(), deposits: [] });
    return new Response("404 Not Found", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, last: (path: string) => [...calls].reverse().find((c) => c.url.pathname === path) };
}

export const quoteArgs = { fromChain: "base", fromToken: "USDC", amount: "100", toChain: "solana", toToken: "SOL", sender: EVM, recipient: SOL };
export const sameChainQuoteArgs = { fromChain: "base", fromToken: "USDC", amount: "100", toChain: "base", toToken: "ETH", sender: EVM };
