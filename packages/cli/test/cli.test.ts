import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVNET_ENV, findMonorepoRoot, parse, run, type Io } from "../src/cli.js";
import { formatSeconds, formatUnits, parseUnits, table } from "../src/format.js";
import { buildSwapLink } from "../src/link.js";
import { packageNameFrom, renderTemplate, TEMPLATE_NAMES } from "../src/templates.js";

const SENDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function io(handler: (url: string, init?: RequestInit) => [number, unknown] = () => [500, {}], over: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const urls: string[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    const [status, body] = handler(String(url), init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  const value: Io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {}, cwd: tmpdir(), fetch, sleep: async () => {}, ...over };
  return { io: value, out, err, urls, text: () => out.join("\n") };
}

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("format", () => {
  it("converts base units both ways exactly", () => {
    expect(parseUnits("100", 6)).toBe("100000000");
    expect(parseUnits("0.5", 9)).toBe("500000000");
    expect(parseUnits("1.", 6)).toBe("1000000");
    expect(parseUnits(".25", 2)).toBe("25");
    expect(parseUnits("0", 6)).toBe("0");
    expect(() => parseUnits("1.1234567", 6)).toThrow(/decimals/);
    expect(() => parseUnits("1e6", 6)).toThrow(/Invalid/);
    expect(() => parseUnits("-1", 6)).toThrow(/Invalid/);
    expect(formatUnits("949141256", 9)).toBe("0.949141256");
    expect(formatUnits("100000000", 6)).toBe("100");
    expect(formatUnits("1500000", 6)).toBe("1.5");
    expect(formatUnits("123456789012345678901234567890", 18)).toBe("123456789012.34567890123456789");
    expect(formatUnits("7", 0)).toBe("7");
  });

  it("pads table columns", () => {
    expect(table(["A", "BB"], [["xxx", "y"]])).toBe("A    BB\n---  --\nxxx  y");
    expect(formatSeconds(8)).toBe("8s");
    expect(formatSeconds(125)).toBe("2m 5s");
    expect(formatSeconds(120)).toBe("2m");
  });
});

describe("parse", () => {
  it("splits command, positionals and options", () => {
    const p = parse(["quote", "100", "USDC", "base", "SOL", "solana", "--sender", "a", "--recipient=b", "--json"]);
    expect(p.command).toBe("quote");
    expect(p.args).toEqual(["100", "USDC", "base", "SOL", "solana"]);
    expect(p.opts).toMatchObject({ sender: "a", recipient: "b", json: true });
  });

  it("rejects unknown options with exit code 2", async () => {
    const t = io();
    expect(await run(["chains", "--nope"], t.io)).toBe(2);
    expect(t.err[0]).toMatch(/nope/);
  });

  it("prints help and version", async () => {
    const t = io();
    expect(await run(["--help"], t.io)).toBe(0);
    expect(t.text()).toMatch(/Usage: layerhop/);
    const v = io();
    expect(await run(["-v"], v.io)).toBe(0);
    expect(v.text()).toBe("0.7.0");
    expect(await run([], io().io)).toBe(1);
    expect(await run(["bogus"], io().io)).toBe(2);
  });
});

describe("chains / tokens", () => {
  it("lists chains from the API as a table or JSON, honoring LAYERHOP_API_URL and key", async () => {
    const chains = [{ id: 8453, slug: "base", name: "Base", vm: "evm", nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "x" }];
    let key: string | undefined;
    const t = io((_u, init) => {
      key = (init?.headers as Record<string, string>)["x-api-key"];
      return [200, { chains }];
    }, { env: { LAYERHOP_API_URL: "http://local:8787/", LAYERHOP_API_KEY: "k" } });
    expect(await run(["chains"], t.io)).toBe(0);
    expect(t.urls[0]).toBe("http://local:8787/v1/chains");
    expect(key).toBe("k");
    expect(t.text()).toMatch(/^ID\s+SLUG\s+NAME/);
    expect(t.text()).toMatch(/8453\s+base\s+Base\s+evm\s+ETH/);
    const j = io(() => [200, { chains }]);
    await run(["chains", "--json"], j.io);
    expect(JSON.parse(j.text())).toEqual(chains);
  });

  it("falls back to the built-in token list when the API is unreachable", async () => {
    const t = io(undefined, { fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect(await run(["tokens", "base"], t.io)).toBe(0);
    expect(t.err[0]).toMatch(/built-in/);
    expect(t.text()).toMatch(/USDC\s+6\s+0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/);
  });

  it("reports API errors with code and docs link", async () => {
    const t = io(() => [400, { error: { code: "UNSUPPORTED_CHAIN", message: "Unsupported chain: foo", requestId: "r1" } }]);
    expect(await run(["tokens", "foo"], t.io)).toBe(1);
    expect(t.err.join("\n")).toMatch(/UNSUPPORTED_CHAIN.*r1[\s\S]*errors\/UNSUPPORTED_CHAIN/);
  });
});

describe("quote", () => {
  const resp = {
    best: { quoteId: "q_a", provider: "lifi", dstAmount: "949141256", dstAmountMin: "944395549", estimatedSeconds: 3, fees: { ourFeeBps: 20, gasUsd: 0.031 }, expiresAt: Math.floor(Date.now() / 1000) + 30 },
    quotes: [] as unknown[],
    errors: [{ provider: "relay", code: "PROVIDER_TIMEOUT", message: "Timed out" }],
  };
  resp.quotes = [resp.best, { ...resp.best, quoteId: "q_b", provider: "relay", dstAmount: "900000000", estimatedSeconds: 90, fees: { ourFeeBps: 20 } }];

  it("converts human amounts to base units and prints a ranked table", async () => {
    const t = io(() => [200, resp]);
    const code = await run(["quote", "100", "USDC", "base", "SOL", "solana", "--sender", SENDER, "--recipient", RECIPIENT], t.io);
    expect(code).toBe(0);
    const u = new URL(t.urls[0]!);
    expect(u.origin + u.pathname).toBe("https://api.layerhop.com/v1/quote");
    expect(u.searchParams.get("amount")).toBe("100000000");
    expect(u.searchParams.get("srcChain")).toBe("base");
    expect(u.searchParams.get("dstChain")).toBe("solana");
    expect(u.searchParams.get("channel")).toBe("api");
    expect(t.text()).toMatch(/\*\s+lifi\s+0\.949141256 SOL\s+0\.944395549 SOL\s+3s\s+20 bps\s+\$0\.03\s+q_a/);
    expect(t.text()).toMatch(/relay\s+0\.9 SOL.*1m 30s/);
    expect(t.err.join()).toMatch(/relay: PROVIDER_TIMEOUT/);
  });

  it("supports --base-units, --slippage-bps, --integrator and --json", async () => {
    const t = io(() => [200, resp]);
    await run(["quote", "5", "0xdeadbeef", "base", "SOL", "solana", "--sender", "a", "--recipient", "b", "--base-units", "--slippage-bps", "75", "--integrator", "myapp", "--json"], t.io);
    const u = new URL(t.urls[0]!);
    expect(u.searchParams.get("amount")).toBe("5");
    expect(u.searchParams.get("slippageBps")).toBe("75");
    expect(u.searchParams.get("integrator")).toBe("myapp");
    expect(JSON.parse(t.text()).best.quoteId).toBe("q_a");
  });

  it("validates input before calling the API", async () => {
    const cases = [
      ["quote", "100", "USDC", "base", "SOL", "solana", "--sender", "a"],
      ["quote", "100", "USDC", "base", "SOL"],
      ["quote", "100", "USDC", "atlantis", "SOL", "solana", "--sender", "a", "--recipient", "b"],
      ["quote", "1", "0xunknown", "base", "SOL", "solana", "--sender", "a", "--recipient", "b"],
      ["quote", "0", "USDC", "base", "SOL", "solana", "--sender", "a", "--recipient", "b"],
      ["quote", "1.0000001", "USDC", "base", "SOL", "solana", "--sender", "a", "--recipient", "b"],
    ];
    for (const argv of cases) {
      const t = io(() => [200, resp]);
      expect(await run(argv, t.io), argv.join(" ")).toBe(2);
      expect(t.urls).toHaveLength(0);
    }
  });
});

describe("status", () => {
  it("prints one status", async () => {
    const t = io(() => [200, { provider: "relay", id: "0xh", state: "pending", srcTxHash: "0xh" }]);
    expect(await run(["status", "relay", "0xh"], t.io)).toBe(0);
    expect(t.urls[0]).toBe("https://api.layerhop.com/v1/orders/relay/0xh");
    expect(t.text()).toBe("PENDING  src 0xh");
  });

  it("--watch polls until final and prints each change", async () => {
    const states = ["pending", "pending", "filled"];
    const t = io((u) => [200, { provider: "relay", id: "0xh", state: states.shift(), dstTxHash: states.length ? undefined : "sig" }]);
    expect(await run(["status", "relay", "0xh", "--watch", "--interval", "1"], t.io)).toBe(0);
    expect(t.urls).toHaveLength(3);
    expect(t.out).toHaveLength(2);
    expect(t.out[1]).toMatch(/FILLED\s+dst sig/);
  });

  it("exits 1 when the order was refunded", async () => {
    const t = io(() => [200, { provider: "debridge", id: "x", state: "refunded" }]);
    expect(await run(["status", "debridge", "x", "-w", "--json"], t.io)).toBe(1);
    expect(JSON.parse(t.out[0]!).state).toBe("refunded");
  });
});

describe("link", () => {
  it("builds swap deep links per URL_CONTRACT", () => {
    expect(buildSwapLink({ srcChain: "base", srcToken: "USDC", dstChain: "solana", dstToken: "SOL", amount: "100" })).toBe(
      "https://layerhop.com/swap?srcChain=base&srcToken=USDC&dstChain=solana&dstToken=SOL&amount=100",
    );
    expect(
      buildSwapLink({ srcChain: "base", srcToken: "USDC", dstChain: "solana", dstToken: "SOL", amount: "0.5", recipient: RECIPIENT, slippageBps: 50, ref: "x", integrator: "myapp" }),
    ).toBe(`https://layerhop.com/swap?srcChain=base&srcToken=USDC&dstChain=solana&dstToken=SOL&amount=0.5&recipient=${RECIPIENT}&slippageBps=50&ref=x&integrator=myapp`);
    expect(() => buildSwapLink({ srcChain: "a", srcToken: "b", dstChain: "c", dstToken: "d", amount: "1,5" })).toThrow(/human units/);
    expect(() => buildSwapLink({ srcChain: "a", srcToken: "b", dstChain: "c", dstToken: "d", integrator: "My App" })).toThrow(/integrator/);
  });

  it("builds embed links with theme options", () => {
    expect(
      buildSwapLink({ srcChain: "base", srcToken: "USDC", dstChain: "solana", dstToken: "SOL" }, { embed: { theme: "light", accent: "#22d3ee", radius: 16, lockSrc: true, hideHistory: true } }),
    ).toBe("https://layerhop.com/embed?srcChain=base&srcToken=USDC&dstChain=solana&dstToken=SOL&theme=light&accent=22d3ee&radius=16&lockSrc=1&hideHistory=1");
  });

  it("prints the link from the command line without calling the API", async () => {
    const t = io();
    expect(await run(["link", "100", "USDC", "base", "SOL", "solana", "--ref", "x"], t.io)).toBe(0);
    expect(t.text()).toBe("https://layerhop.com/swap?srcChain=base&srcToken=USDC&dstChain=solana&dstToken=SOL&amount=100&ref=x");
    expect(t.urls).toHaveLength(0);
    const e = io();
    await run(["link", "1", "USDC", "base", "SOL", "solana", "--embed", "--theme", "dark", "--lock-dst", "--json"], e.io);
    expect(JSON.parse(e.text()).url).toBe("https://layerhop.com/embed?srcChain=base&srcToken=USDC&dstChain=solana&dstToken=SOL&amount=1&theme=dark&lockDst=1");
    expect(await run(["link", "1", "USDC", "base", "SOL", "solana", "--theme", "pink"], io().io)).toBe(2);
  });
});

describe("init", () => {
  const mk = () => {
    const d = mkdtempSync(join(tmpdir(), "layerhop-init-"));
    tmp.push(d);
    return d;
  };

  it("renders every template with the project name and valid JSON", () => {
    for (const name of TEMPLATE_NAMES) {
      const files = renderTemplate(name, "my-app");
      expect(JSON.parse(files["package.json"]!).name).toBe("my-app");
      expect(JSON.parse(files["package.json"]!).dependencies["@layerhop/sdk"]).toBeTruthy();
      expect(Object.values(files).join("\n")).not.toContain("{{name}}");
      expect(files["README.md"]).toMatch(/never\s+holds keys/);
    }
    expect(Object.keys(renderTemplate("next", "x"))).toEqual(expect.arrayContaining(["app/page.tsx", "app/api/quote/route.ts", "app/layout.tsx"]));
    expect(packageNameFrom("./My Cool App/")).toBe("my-cool-app");
  });

  it("scaffolds node (default) and next projects into a temp dir", async () => {
    const cwd = mk();
    const t = io(undefined, { cwd });
    expect(await run(["init", "hello"], t.io)).toBe(0);
    expect(readFileSync(join(cwd, "hello", "index.mjs"), "utf8")).toContain('from "@layerhop/sdk"');
    expect(JSON.parse(readFileSync(join(cwd, "hello", "package.json"), "utf8")).name).toBe("hello");
    expect(await run(["init", "next", "web"], t.io)).toBe(0);
    expect(existsSync(join(cwd, "web", "app", "api", "quote", "route.ts"))).toBe(true);
  });

  it("refuses non-empty directories unless --force", async () => {
    const cwd = mk();
    writeFileSync(join(cwd, "keep.txt"), "x");
    const t = io(undefined, { cwd });
    expect(await run(["init", "node", "."], t.io)).toBe(2);
    expect(t.err[0]).toMatch(/not empty/);
    expect(await run(["init", "node", ".", "--force"], t.io)).toBe(0);
    expect(existsSync(join(cwd, "index.mjs"))).toBe(true);
    expect(await run(["init"], t.io)).toBe(2);
  });
});

describe("devnet", () => {
  it("starts the API with the mock provider inside the monorepo", async () => {
    // A minimal fake monorepo, so the test also passes in the standalone layerhop-js export.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "layerhop-mono-")));
    tmp.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    mkdirSync(join(root, "services", "api"), { recursive: true });
    writeFileSync(join(root, "services", "api", "package.json"), "{}");
    const nested = join(root, "packages", "cli");
    mkdirSync(nested, { recursive: true });
    expect(findMonorepoRoot(nested)).toBe(root);

    const spawn = vi.fn(async () => 0);
    const t = io(undefined, { cwd: nested, spawn });
    expect(await run(["devnet"], t.io)).toBe(0);
    const [cmd, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string> }];
    expect(cmd).toBe("pnpm");
    expect(args).toEqual(["--filter", "@layerhop/api", "dev"]);
    expect(opts.cwd).toBe(root);
    expect(opts.env).toMatchObject(DEVNET_ENV);
  });

  it("explains itself outside the monorepo", async () => {
    const spawn = vi.fn(async () => 0);
    const t = io(undefined, { cwd: mkdtempSync(join(tmpdir(), "layerhop-nodev-")), spawn });
    tmp.push(t.io.cwd);
    expect(await run(["devnet"], t.io)).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(t.text()).toMatch(/LAYERHOP_ENABLE_MOCK=1 PROVIDERS=mock/);
  });
});

describe("listen + trigger", () => {
  const TEST_KEY = `lh_test_${"a".repeat(32)}`;
  const ev = { id: "evt_1", type: "order.filled", livemode: false, sample: true, createdAt: "2026-10-18T10:00:00.000Z", data: { order: { status: "filled" } } };

  it("forwards streamed events to --forward-to, signed with the session secret", async () => {
    const { verifyWebhookSignature } = await import("@layerhop/shared");
    const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/webhooks/stream")) {
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(TEST_KEY);
        const frames = `event: ready\ndata: {}\n\nevent: event\ndata: ${JSON.stringify({ ...ev, type: "order.submitted", id: "evt_0" })}\n\nevent: event\ndata: ${JSON.stringify(ev)}\n\n`;
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frames)); c.close(); } }));
      }
      posts.push({ url: u, headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const t = io(undefined, { fetch, env: { LAYERHOP_API_KEY: TEST_KEY, LAYERHOP_WEBHOOK_SECRET: "whsec_dev" } });
    const code = await run(["listen", "--forward-to", "http://localhost:3000/hooks", "--events", "order.filled", "--max-events", "1"], t.io);
    expect(code).toBe(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("http://localhost:3000/hooks");
    expect(posts[0]!.headers["LayerHop-Event"]).toBe("order.filled");
    expect(await verifyWebhookSignature("whsec_dev", posts[0]!.headers["LayerHop-Signature"], posts[0]!.body)).toBe(true);
    expect(JSON.parse(posts[0]!.body)).toEqual(ev);
    expect(t.text()).toMatch(/--> order\.filled \[evt_1\]\s+<-- 200/);
  });

  it("validates its arguments", async () => {
    expect(await run(["listen", "--forward-to", "http://x"], io().io)).toBe(2); // no key
    const keyed = io(undefined, { env: { LAYERHOP_API_KEY: TEST_KEY } });
    expect(await run(["listen"], keyed.io)).toBe(2);
    expect(await run(["listen", "--forward-to", "nope"], keyed.io)).toBe(2);
    expect(await run(["listen", "--forward-to", "http://x", "--events", "order.bogus"], keyed.io)).toBe(2);
  });

  it("trigger posts the type with a test key and refuses live keys", async () => {
    const t = io((url, init) => {
      expect(url).toMatch(/\/v1\/webhooks\/trigger$/);
      expect(JSON.parse(String(init?.body))).toEqual({ type: "checkout.session.completed" });
      return [202, { eventId: "evt_9", deliveries: 2, payload: {} }];
    }, { env: { LAYERHOP_API_KEY: TEST_KEY } });
    expect(await run(["trigger", "checkout.session.completed"], t.io)).toBe(0);
    expect(t.text()).toMatch(/Triggered checkout\.session\.completed \[evt_9\]: queued for 2 test endpoints/);
    expect(await run(["trigger", "order.filled"], io(undefined, { env: { LAYERHOP_API_KEY: `lh_live_${"b".repeat(32)}` } }).io)).toBe(2);
    expect(await run(["trigger", "nope"], io(undefined, { env: { LAYERHOP_API_KEY: TEST_KEY } }).io)).toBe(2);
  });
});

describe("deposit-address", () => {
  const TEST_KEY = `lh_test_${"a".repeat(32)}`;
  const LIVE_KEY = `lh_live_${"b".repeat(32)}`;
  const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const da = {
    id: "da_1", object: "deposit_address", livemode: false, status: "active", provider: "sandbox",
    address: "0x1234567890abcdef1234567890abcdef12345678", chainId: 8453, token: BASE_USDC, dstChainId: 42161, dstToken: ARB_USDC,
    recipient: SENDER, refundTo: SENDER, reusable: true, amount: null, fees: { ourFeeBps: 20, integratorFeeBps: 0, integrator: null },
    label: "user-1", metadata: null, depositCount: 1, lastDepositAt: null, createdAt: "2026-10-19T10:00:00.000Z",
  };
  const order = {
    quoteId: "dep_1", status: "filled", provider: "sandbox", srcChainId: 8453, srcToken: BASE_USDC, dstChainId: 42161, dstToken: ARB_USDC,
    amount: "25000000", dstAmount: "24950000", srcTxHash: "0xabc", dstTxHash: null, createdAt: "2026-10-19T10:01:00.000Z",
  };
  const bodies: { url: string; method: string; body: unknown }[] = [];
  const api = (key = TEST_KEY) =>
    io((url, init) => {
      const method = init?.method ?? "GET";
      bodies.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(key);
      const path = new URL(url).pathname;
      if (path === "/v1/deposit-addresses" && method === "POST") return [201, { ...da, estimate: { amount: "100000000", dstAmount: "99780000", dstAmountMin: "99280000", estimatedSeconds: 20 } }];
      if (path === "/v1/deposit-addresses") return [200, { depositAddresses: [da], nextCursor: "cur_2" }];
      if (path === "/v1/deposit-addresses/da_1") return [200, { ...da, deposits: [order] }];
      if (path === "/v1/deposit-addresses/da_1/refresh") return [202, da];
      if (path === "/v1/deposit-addresses/da_1/disable") return [200, { ...da, status: "disabled" }];
      if (path === "/v1/deposit-addresses/da_1/simulate") return [201, { order: { ...order, status: "submitted", amount: (JSON.parse(String(init!.body)) as { amount: string }).amount } }];
      return [404, { error: { code: "NOT_FOUND", message: "nope" } }];
    }, { env: { LAYERHOP_API_KEY: key } });
  afterEach(() => void bodies.splice(0));

  it("create converts the amount, sends the route and prints the address with the rules", async () => {
    const t = api();
    const code = await run(["deposit-address", "create", "USDC", "base", "USDC", "arbitrum", "--recipient", SENDER, "--refund-to", SENDER, "--amount", "25", "--one-time", "--label", "user-1", "--metadata", "user=1,plan=pro"], t.io);
    expect(code).toBe(0);
    expect(bodies[0]!.body).toMatchObject({ srcChain: "base", srcToken: "USDC", dstChain: "arbitrum", dstToken: "USDC", recipient: SENDER, refundTo: SENDER, reusable: false, amount: "25000000", label: "user-1", metadata: { user: "1", plan: "pro" } });
    const out = t.text();
    expect(out).toMatch(/address\s+0x1234567890abcdef1234567890abcdef12345678/);
    expect(out).toMatch(/send\s+USDC on base/);
    expect(out).toMatch(/Estimate: 100 USDC -> ~99.78 USDC \(min 99.28 USDC\)/);
    expect(out).toMatch(/TEST MODE/);
    expect(out).toMatch(/Send ONLY USDC on Base/);
    expect(out).toMatch(/at least \$1/);
    expect(out).toMatch(/never an exchange \(CEX\) deposit address/);
  });

  it("create --json prints the API response", async () => {
    const t = api();
    expect(await run(["deposit-address", "create", "USDC", "base", "USDC", "arbitrum", "--recipient", SENDER, "--refund-to", SENDER, "--json"], t.io)).toBe(0);
    expect(JSON.parse(t.text())).toMatchObject({ id: "da_1", estimate: { amount: "100000000" } });
    expect(bodies[0]!.body).not.toHaveProperty("amount");
  });

  it("list, get, refresh, disable", async () => {
    let t = api();
    expect(await run(["deposit-address", "list", "--status", "active", "--label", "user-1", "--limit", "5"], t.io)).toBe(0);
    const q = new URL(bodies[0]!.url).searchParams;
    expect([q.get("status"), q.get("label"), q.get("limit")]).toEqual(["active", "user-1", "5"]);
    expect(t.text()).toMatch(/da_1\s+active\s+test\s+0x1234\S+\s+USDC@base -> USDC@arbitrum\s+1\s+user-1/);
    expect(t.text()).toMatch(/--cursor cur_2/);

    t = api();
    expect(await run(["deposit-address", "get", "da_1"], t.io)).toBe(0);
    expect(t.text()).toMatch(/dep_1\s+filled\s+25 USDC\s+24.95 USDC\s+0xabc/);

    t = api();
    expect(await run(["deposit-addresses", "refresh", "da_1"], t.io)).toBe(0);
    expect(t.text()).toMatch(/Checking .* for deposits now/);
    expect(bodies.at(-1)).toMatchObject({ method: "POST" });

    t = api();
    expect(await run(["deposit-address", "disable", "da_1", "--json"], t.io)).toBe(0);
    expect(JSON.parse(t.text()).status).toBe("disabled");
  });

  it("simulate converts human amounts with a test key and refuses live keys", async () => {
    let t = api();
    expect(await run(["deposit-address", "simulate", "da_1", "25.004001"], t.io)).toBe(0);
    expect(bodies.at(-1)!.body).toEqual({ amount: "25004001" });
    expect(t.text()).toMatch(/Recorded test deposit dep_1 .*settles it as refunded/);

    t = api();
    expect(await run(["deposit-address", "simulate", "da_1", "25000000", "--base-units"], t.io)).toBe(0);
    expect(bodies.at(-1)!.body).toEqual({ amount: "25000000" });

    expect(await run(["deposit-address", "simulate", "da_1", "25"], api(LIVE_KEY).io)).toBe(2);
  });

  it("validates arguments and needs an API key", async () => {
    const noKey = io();
    expect(await run(["deposit-address", "list"], noKey.io)).toBe(2);
    expect(noKey.err.join("\n")).toMatch(/needs an API key/);
    expect(noKey.urls).toHaveLength(0);
    expect(await run(["deposit-address"], api().io)).toBe(2);
    expect(await run(["deposit-address", "bogus"], api().io)).toBe(2);
    expect(await run(["deposit-address", "create", "USDC", "base", "USDC", "arbitrum", "--recipient", SENDER], api().io)).toBe(2);
    expect(await run(["deposit-address", "create", "USDC", "base", "USDC", "arbitrum", "--recipient", SENDER, "--refund-to", SENDER, "--one-time"], api().io)).toBe(2);
    expect(await run(["deposit-address", "create", "USDC", "base", "USDC", "arbitrum", "--recipient", SENDER, "--refund-to", SENDER, "--metadata", "oops"], api().io)).toBe(2);
    expect(await run(["deposit-address", "get", "q_1"], api().io)).toBe(2);
    expect(await run(["deposit-address", "list", "--status", "weird"], api().io)).toBe(2);
    expect(bodies).toHaveLength(0);
  });

  it("surfaces API errors with exit code 1", async () => {
    const t = io(() => [403, { error: { code: "FORBIDDEN", message: "Deposit addresses are not enabled for live mode yet" } }], { env: { LAYERHOP_API_KEY: LIVE_KEY } });
    expect(await run(["deposit-address", "create", "USDC", "base", "USDC", "arbitrum", "--recipient", SENDER, "--refund-to", SENDER], t.io)).toBe(1);
    expect(t.err.join("\n")).toMatch(/FORBIDDEN: Deposit addresses are not enabled/);
  });
});
