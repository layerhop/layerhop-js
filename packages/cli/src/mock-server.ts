/**
 * `layerhop dev`: a self-contained mock of the LayerHop API for offline development and CI.
 *
 * It speaks the same routes and JSON shapes as https://api.layerhop.com for the core flow
 * (chains, tokens, prices, quote → build → report → status, simulate, order list, sample webhooks),
 * so the SDKs and the CLI work against it unchanged with LAYERHOP_API_URL=http://localhost:8787.
 *
 * Everything is deterministic: fixed mock prices, sequential ids, and the same test outcomes as test
 * mode (`lh_test_` keys): an `amount` ending in 4001 refunds, 4002 fails and 4004 returns NO_ROUTE;
 * anything else fills `fillAfterMs` after it is reported. Built transactions are placeholders that move
 * no funds (`tx.sandbox: true`, EVM `to` = 0x…dEaD, Solana: an unsignable memo with a zero blockhash).
 * Never broadcast them. When `webhookUrl` is set, order events are POSTed there, signed exactly like
 * real deliveries (LayerHop-Signature, HMAC-SHA256 with `webhookSecret`).
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  CHAINS, DEFAULT_FEE_BPS, EVM_NATIVE, LayerHopError, SOL_NATIVE, SOLANA_CHAIN_ID, TOKENS, applyBps, findToken, getChain,
  minAfterSlippage, sandboxOutcome, signWebhookPayload,
  type BuiltTx, type ErrorCode, type FeeChannel, type OrderState,
} from "@layerhop/shared";

export const MOCK_EVM_TO = "0x000000000000000000000000000000000000dEaD";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const QUOTE_TTL_S = 60;

/** Fixed USD prices by symbol (anything else is $1), so quotes are reproducible. */
export const MOCK_PRICES: Record<string, number> = {
  USDC: 1, USDT: 1, DAI: 1, USDE: 1, ETH: 3000, WETH: 3000, SOL: 150, BNB: 600, POL: 0.5, AVAX: 30, BTC: 60000, WBTC: 60000, CBBTC: 60000,
};

export interface MockServerOptions {
  port?: number;
  host?: string;
  /** POST order events here, signed with `webhookSecret`. */
  webhookUrl?: string;
  webhookSecret?: string;
  /** Delay between reporting a tx and the final state (default 5 s). */
  fillAfterMs?: number;
  /** Extra fields for `GET /v1/health` (e.g. the Anvil forks that are running). */
  health?: Record<string, unknown>;
  /** Called for every request and webhook delivery. */
  log?: (line: string) => void;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface MockServer {
  url: string;
  port: number;
  close: () => Promise<void>;
  /** Resolves when every webhook delivery started so far has finished (tests, CI). */
  idle: () => Promise<void>;
}

interface MockToken {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}

interface MockQuote {
  quoteId: string;
  provider: "mock";
  srcChainId: number;
  srcToken: MockToken;
  dstChainId: number;
  dstToken: MockToken;
  amount: string;
  dstAmount: string;
  dstAmountMin: string;
  sender: string;
  recipient: string;
  channel: FeeChannel;
  ourFeeBps: number;
  estimatedSeconds: number;
  expiresAt: number;
}

interface MockOrder {
  quote: MockQuote;
  srcTxHash: string;
  submittedAt: number;
  createdAt: number;
  finalNotified: boolean;
}

class HttpError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
  }
}

const isEvmAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const isSolAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
/** A deterministic, well-formed Solana signature (64 bytes, base58). */
const solSig = (seed: string) => b58encode(Buffer.from(hex(`${seed}:0`) + hex(`${seed}:1`), "hex"));
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58encode(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const hexStr = n === 0n ? "" : n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, "0");
  const body = Buffer.from(hexStr, "hex");
  const zeros = s.match(/^1*/)![0].length;
  return Uint8Array.from([...new Uint8Array(zeros), ...body]);
}

const compactU16 = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if (v === 0) return [...out, b];
    out.push(b | 0x80);
  }
};

/** A legacy Solana tx (one memo instruction, fee payer = sender, all-zero blockhash): signable, never lands. */
export function placeholderSolanaTx(sender: string, memo: string): string {
  let payer: Uint8Array;
  try {
    payer = b58decode(sender);
    if (payer.length !== 32) throw new Error("bad length");
  } catch {
    payer = new Uint8Array(32);
  }
  const data = new TextEncoder().encode(memo);
  const message = [
    1, 0, 1, ...compactU16(2), ...payer, ...b58decode(MEMO_PROGRAM), ...new Uint8Array(32),
    ...compactU16(1), 1, ...compactU16(0), ...compactU16(data.length), ...data,
  ];
  return Buffer.from(Uint8Array.from([...compactU16(1), ...new Uint8Array(64), ...message])).toString("base64");
}

function resolveChain(v: string | null, name: string): number {
  if (!v) throw new HttpError("INVALID_PARAMS", `${name} is required`);
  const c = getChain(v);
  if (!c) throw new HttpError("UNSUPPORTED_CHAIN", `Unknown chain "${v}"`);
  return c.id;
}

function resolveToken(chainId: number, v: string | null, name: string): MockToken {
  if (!v) throw new HttpError("INVALID_PARAMS", `${name} is required`);
  const known = findToken(chainId, v);
  if (known) return { ...known };
  const chain = getChain(chainId)!;
  if (v.toUpperCase() === chain.nativeSymbol.toUpperCase()) {
    return { chainId, address: chainId === SOLANA_CHAIN_ID ? SOL_NATIVE : EVM_NATIVE, symbol: chain.nativeSymbol, decimals: chain.nativeDecimals };
  }
  if (chain.vm === "evm" ? isEvmAddress(v) : isSolAddress(v)) return { chainId, address: v, symbol: "TOKEN", decimals: chain.vm === "evm" ? 18 : 6 };
  throw new HttpError("UNSUPPORTED_TOKEN", `Unknown token "${v}" on ${chain.slug}`);
}

const priceOf = (t: MockToken) => MOCK_PRICES[t.symbol.toUpperCase()] ?? 1;

/** amount of A → B at the mock prices, exact integer math. */
export function mockConvert(amount: bigint, a: MockToken, b: MockToken): bigint {
  const pa = BigInt(Math.round(priceOf(a) * 1e6));
  const pb = BigInt(Math.max(1, Math.round(priceOf(b) * 1e6)));
  // Scale before dividing so no precision is lost.
  const up = b.decimals > a.decimals ? 10n ** BigInt(b.decimals - a.decimals) : 1n;
  const down = a.decimals > b.decimals ? 10n ** BigInt(a.decimals - b.decimals) : 1n;
  return (amount * pa * up) / (pb * down);
}

export async function startMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  const now = opts.now ?? Date.now;
  const fillAfterMs = opts.fillAfterMs ?? 5000;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const log = opts.log ?? (() => {});
  const quotes = new Map<string, MockQuote>();
  const orders = new Map<string, MockOrder>(); // by quoteId
  const timers = new Set<NodeJS.Timeout>();
  const deliveries = new Set<Promise<void>>();
  let seq = 0;
  let eventSeq = 0;

  const state = (o: MockOrder): OrderState => {
    if (now() - o.submittedAt < fillAfterMs) return "pending";
    const outcome = sandboxOutcome(o.quote.amount);
    return outcome === "refunded" ? "refunded" : outcome === "failed" ? "failed" : "filled";
  };
  const dstTxHash = (o: MockOrder) => (state(o) === "filled" ? (o.quote.dstChainId === SOLANA_CHAIN_ID ? solSig(`dst:${o.quote.quoteId}`) : `0x${hex(`dst:${o.quote.quoteId}`)}`) : null);
  const summary = (o: MockOrder) => {
    const s = state(o);
    const q = o.quote;
    return {
      quoteId: q.quoteId, status: s === "pending" ? "submitted" : s, statusDetail: null, provider: q.provider, channel: q.channel,
      srcChainId: q.srcChainId, srcToken: q.srcToken.address, dstChainId: q.dstChainId, dstToken: q.dstToken.address,
      sender: q.sender, recipient: q.recipient, amount: q.amount, dstAmount: q.dstAmount, ourFeeBps: q.ourFeeBps, partnerFeeBps: 0,
      srcTxHash: o.srcTxHash, dstTxHash: dstTxHash(o), livemode: false,
      createdAt: new Date(o.createdAt).toISOString(), updatedAt: new Date(s === "pending" ? o.submittedAt : o.submittedAt + fillAfterMs).toISOString(),
    };
  };

  const sendEvent = (type: string, data: Record<string, unknown>, sample = false) => {
    const payload = { id: `evt_mock_${++eventSeq}`, type, livemode: false, ...(sample ? { sample: true } : {}), createdAt: new Date(now()).toISOString(), data };
    if (!opts.webhookUrl) return { payload, deliveries: 0 };
    const url = opts.webhookUrl;
    const secret = opts.webhookSecret ?? "";
    const p = (async () => {
      const body = JSON.stringify(payload);
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json", "user-agent": "layerhop-mock",
            "LayerHop-Event": type, "LayerHop-Delivery": `dlv_mock_${eventSeq}`, "LayerHop-Signature": await signWebhookPayload(secret, body),
          },
          body,
        });
        log(`webhook ${type} [${payload.id}] -> ${url} ${res.status}`);
      } catch (e) {
        log(`webhook ${type} [${payload.id}] -> ${url} failed: ${(e as Error).message}`);
      }
    })();
    deliveries.add(p);
    void p.finally(() => deliveries.delete(p));
    return { payload, deliveries: 1 };
  };

  const quoteView = (q: MockQuote) => ({
    quoteId: q.quoteId, provider: q.provider, dstAmount: q.dstAmount, dstAmountMin: q.dstAmountMin, estimatedSeconds: q.estimatedSeconds,
    fees: { ourFeeBps: q.ourFeeBps, gasUsd: 0.01 }, expiresAt: q.expiresAt,
  });

  const getQuoteFor = (quoteId: unknown): MockQuote => {
    if (typeof quoteId !== "string" || !quoteId) throw new HttpError("INVALID_PARAMS", "quoteId is required");
    const q = quotes.get(quoteId);
    if (!q) throw new HttpError("QUOTE_NOT_FOUND", `Unknown quote ${quoteId}`);
    return q;
  };

  const buildTx = (q: MockQuote): BuiltTx => {
    if (getChain(q.srcChainId)!.vm === "svm") return { vm: "svm", serializedTx: placeholderSolanaTx(q.sender, `layerhop mock ${q.quoteId}`), sandbox: true };
    const native = q.srcToken.address.toLowerCase() === EVM_NATIVE;
    return {
      vm: "evm", chainId: q.srcChainId, to: MOCK_EVM_TO, data: `0x${Buffer.from(`layerhop mock ${q.quoteId}`).toString("hex")}`, value: native ? q.amount : "0",
      ...(native ? {} : { approval: { token: q.srcToken.address, spender: MOCK_EVM_TO, amount: q.amount } }),
      sandbox: true,
    };
  };

  const record = (q: MockQuote, txHash: string) => {
    const existing = orders.get(q.quoteId);
    if (existing) {
      if (existing.srcTxHash !== txHash) throw new HttpError("CONFLICT", `Quote ${q.quoteId} was already reported with another tx`);
      return existing;
    }
    const o: MockOrder = { quote: q, srcTxHash: txHash, submittedAt: now(), createdAt: now(), finalNotified: false };
    orders.set(q.quoteId, o);
    sendEvent("order.submitted", { order: summary(o) });
    const t = setTimeout(() => {
      timers.delete(t);
      o.finalNotified = true;
      sendEvent(`order.${state(o) === "pending" ? "filled" : state(o)}`, { order: summary(o) });
    }, fillAfterMs);
    t.unref?.();
    timers.add(t);
    return o;
  };

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 256 * 1024) throw new HttpError("INVALID_PARAMS", "Request body too large");
      chunks.push(c as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return {};
    try {
      const v = JSON.parse(text) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      return v as Record<string, unknown>;
    } catch {
      throw new HttpError("INVALID_PARAMS", "Body must be a JSON object");
    }
  }

  async function route(req: IncomingMessage, url: URL): Promise<[number, unknown]> {
    const m = req.method ?? "GET";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const q = url.searchParams;

    if (m === "GET" && path === "/v1/health") return [200, { ok: true, providers: ["mock"], mock: true, ...opts.health }];
    if (m === "GET" && path === "/v1/status") {
      const at = new Date(now()).toISOString();
      return [200, { status: "operational", updatedAt: at, components: [{ id: "api", name: "API (local mock)", group: "Core", status: "operational", latencyMs: 0, uptime90d: 100, days: [] }], incidents: [] }];
    }
    if (m === "GET" && path === "/v1/chains") return [200, { chains: CHAINS }];
    if (m === "GET" && path === "/v1/tokens") {
      const chainId = resolveChain(q.get("chain"), "chain");
      const needle = q.get("q")?.toLowerCase();
      const tokens = TOKENS.filter((t) => t.chainId === chainId && (!needle || t.symbol.toLowerCase().includes(needle) || t.address.toLowerCase() === needle))
        .map((t) => ({ ...t, name: t.symbol, verified: true, popular: true, priceUsd: priceOf(t) }));
      return [200, { tokens, nextCursor: null }];
    }
    if (m === "GET" && path === "/v1/prices") {
      const prices: Record<string, number> = {};
      for (const id of (q.get("ids") ?? "").split(",").filter(Boolean)) {
        const [chain, address] = id.split(":");
        const t = chain && address ? findToken(Number(chain), address) : undefined;
        if (t) prices[id] = priceOf(t);
      }
      return [200, { prices }];
    }
    if (m === "GET" && path === "/v1/quote") {
      const srcChainId = resolveChain(q.get("srcChain"), "srcChain");
      const dstChainId = resolveChain(q.get("dstChain"), "dstChain");
      const srcToken = resolveToken(srcChainId, q.get("srcToken"), "srcToken");
      const dstToken = resolveToken(dstChainId, q.get("dstToken"), "dstToken");
      const amount = q.get("amount") ?? "";
      if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new HttpError("INVALID_PARAMS", "amount must be a positive integer string in base units");
      const sender = q.get("sender");
      const recipient = q.get("recipient");
      if (!sender || !recipient) throw new HttpError("INVALID_PARAMS", "sender and recipient are required");
      const slippageBps = Number(q.get("slippageBps") ?? 50);
      if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) throw new HttpError("INVALID_PARAMS", "slippageBps must be an integer 0–5000");
      const channel = (q.get("channel") ?? "api") as FeeChannel;
      if (!(channel in DEFAULT_FEE_BPS)) throw new HttpError("INVALID_PARAMS", `Unknown channel "${channel}"`);
      if (sandboxOutcome(amount) === "no_route") throw new HttpError("NO_ROUTE", "No provider returned a quote (mock: amounts ending in 4004 have no route)");
      const ourFeeBps = DEFAULT_FEE_BPS[channel];
      const afterFee = BigInt(amount) - BigInt(applyBps(amount, ourFeeBps));
      const dstAmount = mockConvert(afterFee, srcToken, dstToken).toString();
      const quote: MockQuote = {
        quoteId: `q_mock_${++seq}`, provider: "mock", srcChainId, srcToken, dstChainId, dstToken, amount, dstAmount,
        dstAmountMin: minAfterSlippage(dstAmount, slippageBps), sender, recipient, channel, ourFeeBps,
        estimatedSeconds: Math.round(fillAfterMs / 1000), expiresAt: Math.floor(now() / 1000) + QUOTE_TTL_S,
      };
      quotes.set(quote.quoteId, quote);
      return [200, { best: quoteView(quote), quotes: [quoteView(quote)], errors: [], livemode: false }];
    }
    if (m === "GET" && path === "/v1/orders") {
      const address = q.get("address")?.toLowerCase();
      if (!address) throw new HttpError("INVALID_PARAMS", "address is required");
      const status = q.get("status");
      const list = [...orders.values()].reverse().map(summary)
        .filter((o) => (o.sender.toLowerCase() === address || o.recipient.toLowerCase() === address) && (!status || o.status === status));
      return [200, { orders: list.slice(0, Number(q.get("limit") ?? 50)), nextCursor: null }];
    }
    if (m === "POST" && path === "/v1/orders") {
      const quote = getQuoteFor((await readJson(req)).quoteId);
      if (quote.expiresAt * 1000 < now()) throw new HttpError("QUOTE_EXPIRED", `Quote ${quote.quoteId} expired; get a new quote`);
      return [200, { quoteId: quote.quoteId, provider: quote.provider, tx: buildTx(quote) }];
    }
    if (m === "POST" && path === "/v1/simulate") {
      const quote = getQuoteFor((await readJson(req)).quoteId);
      const tx = buildTx(quote);
      const ok = sandboxOutcome(quote.amount) !== "failed";
      return [200, {
        quoteId: quote.quoteId, provider: quote.provider, ok, vm: tx.vm, simulated: "tx",
        ...(tx.vm === "evm" ? { gasEstimate: "21000", needsApproval: false } : { computeUnits: 5000 }),
        ...(ok ? {} : { error: { code: "SIMULATION_FAILED", message: "Mock simulation fails for amounts ending in 4002" } }),
        tx,
      }];
    }
    if (m === "POST" && path === "/v1/orders/submit") {
      const body = await readJson(req);
      const quote = getQuoteFor(body.quoteId);
      if (typeof body.signedTransaction !== "string" || !body.signedTransaction) throw new HttpError("INVALID_PARAMS", "signedTransaction is required");
      const txHash = solSig(`src:${quote.quoteId}`);
      record(quote, txHash);
      return [200, { quoteId: quote.quoteId, txHash }];
    }
    let mm = /^\/v1\/orders\/([^/]+)\/submitted$/.exec(path);
    if (m === "POST" && mm) {
      const quote = getQuoteFor(decodeURIComponent(mm[1]!));
      const txHash = (await readJson(req)).txHash;
      if (typeof txHash !== "string" || !(/^0x[0-9a-fA-F]{64}$/.test(txHash) || /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(txHash))) {
        throw new HttpError("INVALID_PARAMS", "txHash must be a 0x-prefixed 32-byte hash or a Solana signature");
      }
      record(quote, txHash);
      return [200, { quoteId: quote.quoteId, status: "submitted" }];
    }
    mm = /^\/v1\/orders\/([^/]+)\/([^/]+)$/.exec(path);
    if (m === "GET" && mm) {
      const [provider, id] = [decodeURIComponent(mm[1]!), decodeURIComponent(mm[2]!)];
      const o = orders.get(id) ?? [...orders.values()].find((x) => x.srcTxHash.toLowerCase() === id.toLowerCase());
      if (!o) return [200, { provider, id, state: "unknown" }];
      const dst = dstTxHash(o);
      return [200, { provider: o.quote.provider, id, state: state(o), srcTxHash: o.srcTxHash, ...(dst ? { dstTxHash: dst } : {}) }];
    }
    if (m === "POST" && path === "/v1/webhooks/trigger") {
      const type = (await readJson(req)).type;
      if (typeof type !== "string" || !type) throw new HttpError("INVALID_PARAMS", "type is required");
      const sample = {
        quoteId: "q_mock_sample", status: type.startsWith("order.") ? type.slice(6) : "filled", statusDetail: null, provider: "mock", channel: "api",
        srcChainId: 8453, srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", dstChainId: SOLANA_CHAIN_ID, dstToken: SOL_NATIVE,
        sender: "0x1111111111111111111111111111111111111111", recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        amount: "100000000", dstAmount: "665333333", ourFeeBps: 20, partnerFeeBps: 0, srcTxHash: `0x${hex("sample-src")}`, dstTxHash: null, livemode: false,
        createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(),
      };
      const r = sendEvent(type, type.startsWith("order.") ? { order: sample } : {}, true);
      return [200, { eventId: r.payload.id, deliveries: r.deliveries, payload: r.payload }];
    }
    if (m === "POST" && path === "/_mock/reset") {
      quotes.clear();
      orders.clear();
      seq = 0;
      eventSeq = 0;
      return [200, { ok: true }];
    }
    throw new HttpError("NOT_FOUND", `The local mock API has no route for ${m} ${path}. It covers chains, tokens, prices, quote, orders, simulate, status and webhooks/trigger; use an lh_test_ key against https://api.layerhop.com for everything else.`);
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, x-api-key");
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-expose-headers", "x-request-id");
    res.setHeader("x-request-id", requestId);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    let status: number;
    let body: unknown;
    try {
      [status, body] = await route(req, url);
    } catch (e) {
      const err = e instanceof HttpError ? new LayerHopError(e.code, e.message) : new LayerHopError("INTERNAL", (e as Error).message);
      status = err.status;
      body = err.toJSON(requestId);
    }
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
    log(`${req.method} ${url.pathname}${url.search} ${status}`);
  };

  const server: Server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 8787, opts.host ?? "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const host = opts.host && opts.host !== "0.0.0.0" ? opts.host : "127.0.0.1";
  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
    port,
    idle: async () => {
      while (deliveries.size) await Promise.all([...deliveries]);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
