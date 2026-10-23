import { LayerHop, LayerHopApiError } from "@layerhop/sdk";
import { verifyWebhookSignature } from "@layerhop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run, type Io } from "../src/cli.js";
import { anvilArgs, planForks } from "../src/forks.js";
import { MOCK_EVM_TO, placeholderSolanaTx, startMockServer, type MockServer } from "../src/mock-server.js";

const SENDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SECRET = `whsec_${"s".repeat(32)}`;
const realFetch = globalThis.fetch.bind(globalThis);

const servers: MockServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

function hooks() {
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  // Webhook deliveries go through this fake; API calls from the SDK use the real fetch.
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { posts, fetch };
}

async function boot(over: Parameters<typeof startMockServer>[0] = {}) {
  const s = await startMockServer({ port: 0, fillAfterMs: 40, ...over });
  servers.push(s);
  return { s, lh: new LayerHop({ baseUrl: s.url, apiKey: `lh_test_${"a".repeat(32)}`, fetch: realFetch }) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mock API (layerhop dev)", () => {
  it("runs quote → build → report → status with the SDK, and signs webhooks", async () => {
    const h = hooks();
    const { s, lh } = await boot({ webhookUrl: "http://localhost:3999/hooks", webhookSecret: SECRET, fetch: h.fetch });
    expect((await lh.chains()).some((c) => c.slug === "solana")).toBe(true);
    expect((await lh.tokens("base")).tokens.map((t) => t.symbol)).toContain("USDC");

    const q = await lh.quote({ srcChain: "base", srcToken: "USDC", amount: "100000000", dstChain: "solana", dstToken: "SOL", sender: SENDER, recipient: SOL_RECIPIENT });
    expect(q.best.provider).toBe("mock");
    // 100 USDC − 10 bps = 99.9 USD at $150/SOL = 0.666 SOL (9 decimals)
    expect(q.best.dstAmount).toBe("666000000");
    expect(q.best.fees.ourFeeBps).toBe(10);
    expect(q.livemode).toBe(false);

    const tx = await lh.buildTx(q.best.quoteId);
    expect(tx).toMatchObject({ vm: "evm", chainId: 8453, to: MOCK_EVM_TO, value: "0", sandbox: true, approval: { amount: "100000000" } });
    const sim = await lh.simulate(q.best.quoteId);
    expect(sim.ok).toBe(true);

    const hash = `0x${"ab".repeat(32)}`;
    expect(await lh.reportSubmitted(q.best.quoteId, hash)).toEqual({ quoteId: q.best.quoteId, status: "submitted" });
    expect((await lh.status("mock", hash)).state).toBe("pending");
    await wait(80);
    const done = await lh.status("mock", hash);
    expect(done.state).toBe("filled");
    expect(done.dstTxHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
    expect((await lh.listOrders({ address: SENDER })).orders[0]).toMatchObject({ quoteId: q.best.quoteId, status: "filled", livemode: false });

    await s.idle();
    expect(h.posts.map((p) => JSON.parse(p.body).type)).toEqual(["order.submitted", "order.filled"]);
    for (const p of h.posts) {
      expect(p.url).toBe("http://localhost:3999/hooks");
      expect(await verifyWebhookSignature(SECRET, p.headers["LayerHop-Signature"], p.body)).toBe(true);
    }
  });

  it("uses the test-mode magic amounts", async () => {
    const { lh } = await boot();
    const base = { srcChain: "base", srcToken: "USDC", dstChain: "arbitrum", dstToken: "USDC", sender: SENDER, recipient: SENDER };
    await expect(lh.quote({ ...base, amount: "1004004" })).rejects.toMatchObject({ code: "NO_ROUTE", status: 404 });
    const r = await lh.quote({ ...base, amount: "1004001" });
    await lh.reportSubmitted(r.best.quoteId, `0x${"01".repeat(32)}`);
    const f = await lh.quote({ ...base, amount: "1004002" });
    expect((await lh.simulate(f.best.quoteId)).ok).toBe(false);
    await lh.reportSubmitted(f.best.quoteId, `0x${"02".repeat(32)}`);
    await wait(80);
    expect((await lh.status("mock", `0x${"01".repeat(32)}`)).state).toBe("refunded");
    expect((await lh.status("mock", `0x${"02".repeat(32)}`)).state).toBe("failed");
  });

  it("returns real error shapes and CORS headers", async () => {
    const { s, lh } = await boot();
    const err = await lh.buildTx("q_nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LayerHopApiError);
    expect(err).toMatchObject({ code: "QUOTE_NOT_FOUND", status: 404 });
    await expect(lh.quote({ srcChain: "nowhere", srcToken: "USDC", amount: "1", dstChain: "base", dstToken: "USDC", sender: SENDER, recipient: SENDER })).rejects.toMatchObject({ code: "UNSUPPORTED_CHAIN" });
    const pre = await realFetch(`${s.url}/v1/quote`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    const missing = await realFetch(`${s.url}/v1/invoices`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("builds Solana placeholders that can never land", async () => {
    const { lh } = await boot();
    const q = await lh.quote({ srcChain: "solana", srcToken: "USDC", amount: "5000000", dstChain: "base", dstToken: "USDC", sender: SOL_RECIPIENT, recipient: SENDER });
    const tx = await lh.buildTx(q.best.quoteId);
    expect(tx).toMatchObject({ vm: "svm", sandbox: true });
    const bytes = Buffer.from(placeholderSolanaTx(SOL_RECIPIENT, "x"), "base64");
    expect(bytes[0]).toBe(1); // one (empty) signature
  });

  it("sends sample events for webhooks/trigger", async () => {
    const h = hooks();
    const { s, lh } = await boot({ webhookUrl: "http://localhost:3999/hooks", webhookSecret: SECRET, fetch: h.fetch });
    const r = await lh.webhooks.trigger("order.refunded");
    expect(r.deliveries).toBe(1);
    await s.idle();
    expect(JSON.parse(h.posts[0]!.body)).toMatchObject({ type: "order.refunded", sample: true, data: { order: { status: "refunded" } } });
  });
});

describe("layerhop dev command", () => {
  function io(over: Partial<Io> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const value: Io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {}, cwd: process.cwd(), fetch: realFetch, ...over };
    return { io: value, out, err };
  }

  it("serves until told to stop, and prints the URL to export", async () => {
    let health: unknown;
    const t = io({
      waitForExit: async (server) => {
        health = await (await realFetch(`${server.url}/v1/health`)).json();
      },
    });
    expect(await run(["dev", "--port", "0", "--json"], t.io)).toBe(0);
    const line = JSON.parse(t.out[0]!) as { url: string; webhookSecret: string | null; forks: unknown[] };
    expect(line.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(line.webhookSecret).toBeNull();
    expect(health).toMatchObject({ ok: true, mock: true, providers: ["mock"] });
  });

  it("starts Anvil forks when anvil is installed, and explains when it is not", async () => {
    const started: string[][] = [];
    const kill = vi.fn();
    const t = io({
      hasCommand: () => true,
      startProcess: (_cmd, args) => {
        started.push(args);
        return { kill, exited: Promise.resolve(0) };
      },
      waitForExit: async () => {},
    });
    expect(await run(["dev", "--port", "0", "--fork", "--webhook-url", "http://localhost:4000/h"], t.io)).toBe(0);
    expect(started.map((a) => a[a.indexOf("--chain-id") + 1])).toEqual(["8453", "42161"]);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(t.out.join("\n")).toMatch(/whsec_/);

    const none = io({ hasCommand: () => false, waitForExit: async () => {} });
    expect(await run(["dev", "--port", "0", "--fork"], none.io)).toBe(0);
    expect(none.err.join("\n")).toMatch(/foundryup/);
  });

  it("plans forks per chain with env RPC overrides and rejects non-EVM chains", () => {
    const plan = planForks(["base", "ethereum"], { LAYERHOP_FORK_RPC_BASE: "https://my-rpc.example/base" });
    expect(plan).toMatchObject([{ slug: "base", chainId: 8453, port: 8545, forkUrl: "https://my-rpc.example/base" }, { slug: "ethereum", chainId: 1, port: 8546 }]);
    expect(anvilArgs(plan[0]!)).toEqual(["--fork-url", "https://my-rpc.example/base", "--port", "8545", "--chain-id", "8453", "--silent"]);
    expect(() => planForks(["solana"], {})).toThrow(/EVM/);
    expect(() => planForks(["atlantis"], {})).toThrow(/Unknown chain/);
  });

  it("rejects a bad --webhook-url", async () => {
    const t = io({ waitForExit: async () => {} });
    expect(await run(["dev", "--webhook-url", "nope"], t.io)).toBe(2);
  });
});
