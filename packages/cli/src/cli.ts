import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CHAINS, LayerHop, LayerHopApiError, TOKENS, findToken, getChain, type DepositAddress, type OrderStatus, type ProviderId, type QuoteResponse, type WebhookEventPayload, type WebhookEventType } from "@layerhop/sdk";
import { signWebhookPayload } from "@layerhop/shared";
import { formatSeconds, formatUnits, json, parseUnits, table } from "./format.js";
import { DEFAULT_FORK_CHAINS, anvilArgs, hasCommand, planForks, startProcess, type RunningProcess } from "./forks.js";
import { buildSwapLink } from "./link.js";
import { startMockServer, type MockServer } from "./mock-server.js";
import { TEMPLATE_NAMES, packageNameFrom, renderTemplate, type TemplateName } from "./templates.js";

export const VERSION = "0.7.0";
export const DEFAULT_API_URL = "https://api.layerhop.com";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
  fetch: typeof fetch;
  /** Starts a child process (devnet). Returns its exit code. */
  spawn?: (cmd: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  /** `layerhop dev`: resolves when the server should stop (default: Ctrl-C / SIGTERM). Gets the running server. */
  waitForExit?: (server: MockServer) => Promise<void>;
  /** `layerhop dev --fork`: is a command on PATH, and start one in the background. */
  hasCommand?: (cmd: string) => boolean;
  startProcess?: (cmd: string, args: string[]) => RunningProcess;
}

export const HELP = `layerhop ${VERSION} — LayerHop from your terminal

Usage: layerhop <command> [args] [options]

Commands:
  chains                                      List supported chains
  tokens <chain>                              List the built-in tokens of a chain
  quote <amount> <token> <chain> <toToken> <toChain> --sender <addr> --recipient <addr>
                                              Quote a swap. <amount> is in human units (100 = 100 USDC)
                                              unless --base-units is given
  status <provider> <txhash> [--watch]        Order status; --watch polls until filled/refunded/failed
  link <amount> <token> <chain> <toToken> <toChain>
                                              Print a layerhop.com/swap deep link (--embed for /embed)
  listen --forward-to <url>                   Forward your account's webhook events to a local URL, signed
                                              (uses the API key's mode: test or live)
  trigger <event-type>                        Send a sample test-mode event, e.g. order.filled (test key)
  deposit-address <create|list|get|refresh|disable|simulate>
                                              Deposit addresses (API key): users swap by sending tokens
    create <token> <chain> <toToken> <toChain> --recipient <addr> --refund-to <addr>
    list [--status active|disabled] [--label <l>]   get <id>   refresh <id>   disable <id>
    simulate <id> <amount>                    Record a fake deposit (test key only)
  init [node|next] <dir>                      Scaffold a minimal project using @layerhop/sdk
  dev                                         Local mock LayerHop API for offline development and CI
                                              (deterministic quotes/orders/status + signed webhooks)
  devnet                                      Run the real API with the mock provider (monorepo only)

Global options:
  --api-url <url>      API origin (env LAYERHOP_API_URL, default ${DEFAULT_API_URL})
  --api-key <key>      API key (env LAYERHOP_API_KEY)
  --json               Machine-readable output
  -h, --help           Show help
  -v, --version        Show version

Quote options:  --sender --recipient --slippage-bps <n> --integrator <id> --base-units
Link options:   --recipient --slippage-bps <n> --ref <ref> --integrator <id>
                --embed --theme dark|light --accent <hex> --radius <px> --lock-src --lock-dst --hide-history
Status options: --watch --interval <seconds>
Init options:   --force (write into a non-empty directory)
Deposit address options: --recipient --refund-to --amount <n> --one-time --base-units --label <l>
                --metadata k=v,k=v --integrator <id> (create); --status --label --limit --cursor (list);
                --base-units (simulate)
Dev options:    --port <n> (default 8787) --host <addr> --webhook-url <url> --secret <whsec_…>
                --fill-after <seconds> (default 5) --fork [--fork-chains base,arbitrum] (needs anvil)
Listen options: --forward-to <url> --events <type,type> --secret <whsec_…> (env LAYERHOP_WEBHOOK_SECRET;
                default: a new secret per session, printed at start)

LayerHop never holds keys: the CLI quotes and tracks; your wallet signs.`;

const OPTIONS = {
  "api-url": { type: "string" },
  "api-key": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  sender: { type: "string" },
  recipient: { type: "string" },
  "slippage-bps": { type: "string" },
  integrator: { type: "string" },
  "base-units": { type: "boolean" },
  watch: { type: "boolean", short: "w" },
  interval: { type: "string" },
  ref: { type: "string" },
  embed: { type: "boolean" },
  theme: { type: "string" },
  accent: { type: "string" },
  radius: { type: "string" },
  "lock-src": { type: "boolean" },
  "lock-dst": { type: "boolean" },
  "hide-history": { type: "boolean" },
  force: { type: "boolean" },
  "forward-to": { type: "string" },
  events: { type: "string" },
  secret: { type: "string" },
  "max-events": { type: "string" },
  "refund-to": { type: "string" },
  amount: { type: "string" },
  "one-time": { type: "boolean" },
  label: { type: "string" },
  metadata: { type: "string" },
  status: { type: "string" },
  limit: { type: "string" },
  cursor: { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  "webhook-url": { type: "string" },
  "fill-after": { type: "string" },
  fork: { type: "boolean" },
  "fork-chains": { type: "string" },
} as const;

export type ParsedArgs = ReturnType<typeof parse>;

export class UsageError extends Error {}

export function parse(argv: string[]) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    const [command, ...args] = positionals;
    return { command, args, opts: values };
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
}

function int(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new UsageError(`--${name} must be a non-negative integer`);
  return Number(v);
}

function need(args: string[], n: number, usage: string): string[] {
  if (args.length < n) throw new UsageError(`Usage: layerhop ${usage}`);
  return args;
}

function client(opts: ParsedArgs["opts"], io: Io): LayerHop {
  return new LayerHop({
    baseUrl: opts["api-url"] ?? io.env.LAYERHOP_API_URL ?? DEFAULT_API_URL,
    apiKey: opts["api-key"] ?? io.env.LAYERHOP_API_KEY,
    integrator: opts.integrator,
    fetch: io.fetch,
  });
}

function apiUrl(opts: ParsedArgs["opts"], io: Io): string {
  return (opts["api-url"] ?? io.env.LAYERHOP_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
}

/** GET a /v1 route the SDK has no method for; same error shape as the SDK. */
async function apiGet<T>(path: string, opts: ParsedArgs["opts"], io: Io): Promise<T> {
  const headers: Record<string, string> = {};
  const key = opts["api-key"] ?? io.env.LAYERHOP_API_KEY;
  if (key) headers["x-api-key"] = key;
  const res = await io.fetch(`${apiUrl(opts, io)}/v1${path}`, { headers });
  const body = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; requestId?: string } };
  if (!res.ok) throw new LayerHopApiError(body.error?.code ?? "INTERNAL", body.error?.message ?? res.statusText, res.status, body.error?.requestId);
  return body as T;
}

type Chain = (typeof CHAINS)[number];
type Token = (typeof TOKENS)[number];

export function resolveChain(v: string): Chain {
  const c = getChain(v);
  if (!c) throw new UsageError(`Unknown chain "${v}". Known: ${CHAINS.map((x) => x.slug).join(", ")}`);
  return c;
}

/** The token's decimals from the built-in list, or undefined for unknown addresses. */
export function tokenDecimals(chain: Chain, token: string): number | undefined {
  return findToken(chain.id, token)?.decimals;
}

export function quoteRows(r: QuoteResponse, dstDecimals: number | undefined, dstSymbol: string): string[][] {
  return r.quotes.map((q, i) => {
    const fee = q.fees.ourFeeBps + (q.fees.integratorFeeBps ?? 0);
    const amt = (v: string) => (dstDecimals === undefined ? v : `${formatUnits(v, dstDecimals)} ${dstSymbol}`);
    return [
      i === 0 ? "*" : "",
      q.provider,
      amt(q.dstAmount),
      amt(q.dstAmountMin),
      formatSeconds(q.estimatedSeconds),
      `${fee} bps`,
      q.fees.gasUsd !== undefined ? `$${q.fees.gasUsd.toFixed(2)}` : "-",
      q.quoteId,
    ];
  });
}

async function cmdChains(p: ParsedArgs, io: Io): Promise<number> {
  let chains: readonly Chain[];
  try {
    chains = (await apiGet<{ chains: Chain[] }>("/chains", p.opts, io)).chains;
  } catch (e) {
    if (e instanceof LayerHopApiError) throw e;
    io.err(`warning: API unreachable (${(e as Error).message}); showing the built-in list`);
    chains = CHAINS;
  }
  if (p.opts.json) io.out(json(chains));
  else io.out(table(["ID", "SLUG", "NAME", "VM", "NATIVE"], chains.map((c) => [String(c.id), c.slug, c.name, c.vm, c.nativeSymbol])));
  return 0;
}

async function cmdTokens(p: ParsedArgs, io: Io): Promise<number> {
  const [chain] = need(p.args, 1, "tokens <chain>");
  let tokens: readonly Token[];
  try {
    tokens = (await apiGet<{ tokens: Token[] }>(`/tokens?chain=${encodeURIComponent(chain!)}`, p.opts, io)).tokens;
  } catch (e) {
    if (e instanceof LayerHopApiError) throw e;
    io.err(`warning: API unreachable (${(e as Error).message}); showing the built-in list`);
    const c = resolveChain(chain!);
    tokens = TOKENS.filter((t) => t.chainId === c.id);
  }
  if (p.opts.json) io.out(json(tokens));
  else io.out(table(["SYMBOL", "DECIMALS", "ADDRESS"], tokens.map((t) => [t.symbol, String(t.decimals), t.address])));
  return 0;
}

async function cmdQuote(p: ParsedArgs, io: Io): Promise<number> {
  const [amount, token, chain, toToken, toChain] = need(p.args, 5, "quote <amount> <token> <chain> <toToken> <toChain> --sender <addr> --recipient <addr>") as [string, string, string, string, string];
  const { sender, recipient } = p.opts;
  if (!sender || !recipient) throw new UsageError("quote needs --sender and --recipient");
  const src = resolveChain(chain);
  const dst = resolveChain(toChain);
  let base: string;
  if (p.opts["base-units"]) {
    if (!/^\d+$/.test(amount)) throw new UsageError("--base-units amount must be an integer string");
    base = amount;
  } else {
    const d = tokenDecimals(src, token);
    if (d === undefined) throw new UsageError(`"${token}" is not in the ${src.slug} token list; pass the amount in base units with --base-units`);
    try {
      base = parseUnits(amount, d);
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
  }
  if (base === "0") throw new UsageError("amount must be greater than 0");
  const r = await client(p.opts, io).quote({
    srcChain: src.slug, srcToken: token, amount: base, dstChain: dst.slug, dstToken: toToken, sender, recipient,
    slippageBps: int(p.opts["slippage-bps"], "slippage-bps"),
  });
  if (p.opts.json) {
    io.out(json(r));
    return 0;
  }
  const dstTok = findToken(dst.id, toToken);
  io.out(`${amount}${p.opts["base-units"] ? " (base units)" : ""} ${token} on ${src.name} -> ${toToken} on ${dst.name}\n`);
  io.out(table(["", "PROVIDER", "YOU GET", "MIN", "ETA", "FEE", "GAS", "QUOTE ID"], quoteRows(r, dstTok?.decimals, dstTok?.symbol ?? toToken)));
  for (const e of r.errors) io.err(`  ${e.provider}: ${e.code} ${e.message}`);
  const secs = r.best.expiresAt - Math.floor(Date.now() / 1000);
  io.out(`\n* best. Quotes expire in ${Math.max(0, secs)}s — build with POST /v1/orders { quoteId }.`);
  return 0;
}

const FINAL = new Set<OrderStatus["state"]>(["filled", "refunded", "failed"]);

function statusLine(s: OrderStatus): string {
  return [s.state.toUpperCase(), s.srcTxHash ? `src ${s.srcTxHash}` : "", s.dstTxHash ? `dst ${s.dstTxHash}` : ""].filter(Boolean).join("  ");
}

async function cmdStatus(p: ParsedArgs, io: Io): Promise<number> {
  const [provider, id] = need(p.args, 2, "status <provider> <txhash> [--watch]") as [ProviderId, string];
  const lh = client(p.opts, io);
  if (!p.opts.watch) {
    const s = await lh.status(provider, id);
    io.out(p.opts.json ? json(s) : statusLine(s));
    return s.state === "failed" ? 1 : 0;
  }
  const intervalMs = (int(p.opts.interval, "interval") ?? 3) * 1000;
  const sleep = io.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: OrderStatus | undefined;
  for (;;) {
    const s = await lh.status(provider, id);
    if (s.state !== last?.state) io.out(p.opts.json ? JSON.stringify(s) : `${new Date().toISOString()}  ${statusLine(s)}`);
    last = s;
    if (FINAL.has(s.state)) break;
    await sleep(intervalMs);
  }
  return last.state === "filled" ? 0 : 1;
}

function cmdLink(p: ParsedArgs, io: Io): number {
  const [amount, token, chain, toToken, toChain] = need(p.args, 5, "link <amount> <token> <chain> <toToken> <toChain>") as [string, string, string, string, string];
  const o = p.opts;
  const theme = o.theme;
  if (theme !== undefined && theme !== "dark" && theme !== "light") throw new UsageError("--theme must be dark or light");
  let url: string;
  try {
    url = buildSwapLink(
      { srcChain: chain, srcToken: token, dstChain: toChain, dstToken: toToken, amount, recipient: o.recipient, slippageBps: int(o["slippage-bps"], "slippage-bps"), ref: o.ref, integrator: o.integrator },
      { embed: o.embed ? { theme, accent: o.accent, radius: int(o.radius, "radius"), lockSrc: o["lock-src"], lockDst: o["lock-dst"], hideHistory: o["hide-history"] } : false },
    );
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError((e as Error).message);
  }
  io.out(o.json ? json({ url }) : url);
  return 0;
}

async function cmdInit(p: ParsedArgs, io: Io): Promise<number> {
  let [a, b] = p.args;
  let template: TemplateName = "node";
  if (a && (TEMPLATE_NAMES as readonly string[]).includes(a)) {
    template = a as TemplateName;
    a = b;
  }
  if (!a) throw new UsageError("Usage: layerhop init [node|next] <dir>");
  const dir = resolve(io.cwd, a);
  if (existsSync(dir) && (await readdir(dir)).length > 0 && !p.opts.force) {
    throw new UsageError(`${dir} is not empty (use --force to write into it)`);
  }
  const files = renderTemplate(template, packageNameFrom(a));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (p.opts.json) io.out(json({ template, dir, files: Object.keys(files) }));
  else {
    io.out(`Created a ${template} project in ${dir}:`);
    for (const f of Object.keys(files)) io.out(`  ${f}`);
    io.out(`\nNext:\n  cd ${a}\n  npm install\n  ${template === "next" ? "npm run dev" : "npm start"}`);
  }
  return 0;
}

/** Walks up from `start` to the LayerHop monorepo root (has services/api and pnpm-workspace.yaml). */
export function findMonorepoRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "services", "api", "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

export const DEVNET_ENV = { LAYERHOP_ENABLE_MOCK: "1", PROVIDERS: "mock" } as const;

async function cmdDevnet(p: ParsedArgs, io: Io): Promise<number> {
  const root = findMonorepoRoot(io.cwd);
  if (!root) {
    io.out(`layerhop devnet runs the real LayerHop API locally with the deterministic "mock" provider.
It needs a checkout of the LayerHop monorepo. Outside it, use the built-in mock API instead:

  npx @layerhop/cli dev         # http://localhost:8787, no checkout needed

To run the real API:

  git clone <layerhop repo> && cd layerhop && pnpm install
  npx layerhop devnet           # or: LAYERHOP_ENABLE_MOCK=1 PROVIDERS=mock pnpm --filter @layerhop/api dev

Then point the SDK or CLI at it: LAYERHOP_API_URL=http://localhost:8787
Mock transactions are dummies — never broadcast them.`);
    return 1;
  }
  const port = io.env.PORT ?? "8787";
  io.err(`Starting the local API from ${root} with ${Object.entries(DEVNET_ENV).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  io.err(`Use it with: LAYERHOP_API_URL=http://localhost:${port} layerhop quote 100 USDC base SOL solana --sender ... --recipient ...`);
  const run = io.spawn ?? defaultSpawn;
  return run("pnpm", ["--filter", "@layerhop/api", "dev"], { cwd: root, env: { ...io.env, ...DEVNET_ENV } });
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

/**
 * `layerhop dev`: the built-in mock API (src/mock-server.ts), optionally with Anvil forks. Runs until
 * Ctrl-C. Works anywhere Node 20 runs: no monorepo, database or provider keys.
 */
async function cmdDev(p: ParsedArgs, io: Io): Promise<number> {
  const port = int(p.opts.port ?? io.env.LAYERHOP_DEV_PORT ?? "8787", "port")!;
  const fillAfter = int(p.opts["fill-after"], "fill-after");
  const webhookUrl = p.opts["webhook-url"];
  if (webhookUrl) {
    try {
      new URL(webhookUrl);
    } catch {
      throw new UsageError("--webhook-url must be a URL, e.g. http://localhost:3000/webhooks");
    }
  }
  const secret = webhookUrl ? (p.opts.secret ?? io.env.LAYERHOP_WEBHOOK_SECRET ?? randomSecret()) : undefined;

  const procs: RunningProcess[] = [];
  const forks: { chain: string; chainId: number; rpcUrl: string }[] = [];
  if (p.opts.fork || p.opts["fork-chains"]) {
    const chains = (p.opts["fork-chains"] ?? DEFAULT_FORK_CHAINS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    let plan;
    try {
      plan = planForks(chains, io.env);
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    if (!(io.hasCommand ?? hasCommand)("anvil")) {
      io.err("--fork needs Anvil (Foundry): curl -L https://foundry.paradigm.xyz | bash && foundryup");
      io.err("Starting the mock API without forks.");
    } else {
      const start = io.startProcess ?? startProcess;
      for (const f of plan) {
        procs.push(start("anvil", anvilArgs(f)));
        forks.push({ chain: f.slug, chainId: f.chainId, rpcUrl: f.rpcUrl });
        io.err(`Anvil fork of ${f.slug} (chain id ${f.chainId}) on ${f.rpcUrl}`);
      }
    }
  }

  let server: MockServer;
  try {
    server = await startMockServer({
      port, host: p.opts.host, webhookUrl, webhookSecret: secret, fillAfterMs: fillAfter === undefined ? undefined : fillAfter * 1000,
      health: forks.length ? { forks } : undefined, fetch: io.fetch,
      log: p.opts.json ? undefined : (line) => io.err(`${new Date().toISOString().slice(11, 19)}  ${line}`),
    });
  } catch (e) {
    for (const pr of procs) pr.kill();
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") throw new UsageError(`Port ${port} is in use. Pick another with --port`);
    throw e;
  }
  if (p.opts.json) io.out(json({ url: server.url, webhookUrl: webhookUrl ?? null, webhookSecret: secret ?? null, forks }));
  else {
    io.out(`LayerHop mock API on ${server.url}`);
    io.out(`  export LAYERHOP_API_URL=${server.url}`);
    if (webhookUrl) io.out(`  webhooks -> ${webhookUrl} signed with ${secret}${p.opts.secret || io.env.LAYERHOP_WEBHOOK_SECRET ? " (yours)" : " (set LAYERHOP_WEBHOOK_SECRET to keep one)"}`);
    io.out("  Amounts ending in 4001 refund, 4002 fail, 4004 have no route; anything else fills.");
    io.out("  Transactions are placeholders that move no funds. Never broadcast them. Ctrl-C to stop.");
  }
  try {
    await (io.waitForExit ?? waitForSignal)(server);
  } finally {
    await server.close();
    for (const pr of procs) pr.kill();
  }
  return 0;
}

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }): Promise<number> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, stdio: "inherit" });
    child.on("error", rej);
    child.on("exit", (code) => res(code ?? 0));
  });
}

const EVENT_TYPES: readonly WebhookEventType[] = [
  "order.submitted", "order.filled", "order.refunded", "order.failed",
  "checkout.session.processing", "checkout.session.completed", "checkout.session.payment_failed", "checkout.session.expired",
  "subscription.created", "subscription.renewed", "subscription.past_due", "subscription.canceled",
];

function requireKey(opts: ParsedArgs["opts"], io: Io, what: string): string {
  const key = opts["api-key"] ?? io.env.LAYERHOP_API_KEY;
  if (!key) throw new UsageError(`${what} needs an API key: --api-key or LAYERHOP_API_KEY (create one at https://dashboard.layerhop.com/keys)`);
  return key;
}

function randomSecret(): string {
  const abc = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return `whsec_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => abc[b % 62]).join("")}`;
}

/**
 * `layerhop listen`: stream the account's webhook events and POST each one to --forward-to, signed
 * exactly like a real delivery (LayerHop-Signature with the session secret). Reconnects with backoff;
 * runs until interrupted (or --max-events, for scripts and tests).
 */
async function cmdListen(p: ParsedArgs, io: Io): Promise<number> {
  const key = requireKey(p.opts, io, "listen");
  const target = p.opts["forward-to"];
  if (!target) throw new UsageError("Usage: layerhop listen --forward-to http://localhost:3000/webhooks");
  try {
    new URL(target);
  } catch {
    throw new UsageError("--forward-to must be a URL, e.g. http://localhost:3000/webhooks");
  }
  const only = p.opts.events?.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = only?.filter((t) => !(EVENT_TYPES as readonly string[]).includes(t));
  if (bad?.length) throw new UsageError(`Unknown event type ${bad.join(", ")}. One of: ${EVENT_TYPES.join(", ")}`);
  const max = int(p.opts["max-events"], "max-events");
  const secret = p.opts.secret ?? io.env.LAYERHOP_WEBHOOK_SECRET ?? randomSecret();
  const mode = key.startsWith("lh_test_") ? "test" : "live";
  const sleep = io.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  io.err(`Ready. Forwarding ${mode}-mode events${only ? ` (${only.join(", ")})` : ""} to ${target}`);
  io.err(`Webhook signing secret for this session: ${secret}${p.opts.secret || io.env.LAYERHOP_WEBHOOK_SECRET ? " (yours)" : " (set LAYERHOP_WEBHOOK_SECRET to keep one)"}`);
  if (mode === "test") io.err("Tip: run `layerhop trigger order.filled` in another terminal to send a sample event.");
  const lh = client(p.opts, io);
  let forwarded = 0;
  let attempt = 0;
  const forward = async (ev: WebhookEventPayload) => {
    const body = JSON.stringify(ev);
    const started = Date.now();
    let status = "error";
    try {
      const res = await io.fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json", "user-agent": `layerhop-cli/${VERSION}`,
          "LayerHop-Event": ev.type, "LayerHop-Delivery": `cli_${ev.id}`, "LayerHop-Signature": await signWebhookPayload(secret, body),
        },
        body,
      });
      status = String(res.status);
    } catch (e) {
      status = `error: ${(e as Error).message}`;
    }
    const line = { event: ev.type, id: ev.id, status, ms: Date.now() - started };
    if (p.opts.json) io.out(json(line));
    else io.out(`${new Date().toISOString().slice(11, 19)}  --> ${ev.type} [${ev.id}]  <-- ${status} (${line.ms} ms)`);
  };
  for (;;) {
    try {
      for await (const ev of lh.webhooks.stream()) {
        attempt = 0;
        if (only && !only.includes(ev.type)) continue;
        await forward(ev);
        if (max !== undefined && ++forwarded >= max) return 0;
      }
    } catch (e) {
      if (e instanceof LayerHopApiError && e.status < 500 && e.status !== 429) throw e;
      io.err(`stream interrupted (${(e as Error).message}); reconnecting…`);
    }
    await sleep(Math.min(30_000, 1000 * 2 ** attempt++));
  }
}

async function cmdTrigger(p: ParsedArgs, io: Io): Promise<number> {
  const [type] = need(p.args, 1, `trigger <event-type>  (${EVENT_TYPES.join(", ")})`) as [string];
  if (!(EVENT_TYPES as readonly string[]).includes(type)) throw new UsageError(`Unknown event type "${type}". One of: ${EVENT_TYPES.join(", ")}`);
  const key = requireKey(p.opts, io, "trigger");
  if (!key.startsWith("lh_test_")) throw new UsageError("trigger only works with a test key (lh_test_…), so samples never reach live endpoints");
  const r = await client(p.opts, io).webhooks.trigger(type as WebhookEventType);
  if (p.opts.json) io.out(json(r));
  else io.out(`Triggered ${type} [${r.eventId}]: queued for ${r.deliveries} test endpoint${r.deliveries === 1 ? "" : "s"} and any running \`layerhop listen\`.`);
  return 0;
}

// ---------- deposit addresses ----------

const DA_USAGE = "deposit-address <create|list|get|refresh|disable|simulate> ...";

function chainLabel(id: number): string {
  return getChain(id)?.slug ?? String(id);
}

/** "25 USDC" for listed tokens, else "<base> (base units)". */
function tokenAmount(chainId: number, token: string, base: string | null): string {
  if (base === null) return "-";
  const t = findToken(chainId, token);
  return t ? `${formatUnits(base, t.decimals)} ${t.symbol}` : `${base} (base units)`;
}

function tokenLabel(chainId: number, token: string): string {
  return findToken(chainId, token)?.symbol ?? token;
}

function routeLabel(da: DepositAddress): string {
  return `${tokenLabel(da.chainId, da.token)}@${chainLabel(da.chainId)} -> ${tokenLabel(da.dstChainId, da.dstToken)}@${chainLabel(da.dstChainId)}`;
}

/** The rules to show next to an address (same wording as the docs). */
export function depositRules(da: DepositAddress): string[] {
  const sym = tokenLabel(da.chainId, da.token);
  const chain = getChain(da.chainId)?.name ?? String(da.chainId);
  const rules = [
    `Send ONLY ${sym} on ${chain} to this address. Other tokens, or ${sym} on another chain, may be lost for good.`,
    "Send at least $1 worth; smaller deposits may never be picked up.",
    `Refunds go to ${da.refundTo}: an address the user controls, never an exchange (CEX) deposit address.`,
  ];
  if (!da.reusable && da.amount) rules.push(`One-time address: send exactly ${tokenAmount(da.chainId, da.token, da.amount)}, once.`);
  if (!da.livemode) rules.unshift("TEST MODE: fake sandbox address. Never send real funds; use `layerhop deposit-address simulate`.");
  if (da.status === "disabled") rules.unshift("DISABLED: stop showing this address; deposits to it are no longer tracked.");
  return rules;
}

function printDepositAddress(io: Io, da: DepositAddress): void {
  const rows: [string, string][] = [
    ["id", da.id],
    ["status", `${da.status} (${da.livemode ? "live" : "test"}, ${da.provider})`],
    ["address", da.address],
    ["send", `${tokenLabel(da.chainId, da.token)} on ${chainLabel(da.chainId)} (${da.token})`],
    ["deliver", `${tokenLabel(da.dstChainId, da.dstToken)} on ${chainLabel(da.dstChainId)} to ${da.recipient}`],
    ["refund to", da.refundTo],
    ["type", da.reusable ? "reusable, any amount" : `one-time, exactly ${tokenAmount(da.chainId, da.token, da.amount)}`],
    ["fees", `${da.fees.ourFeeBps + da.fees.integratorFeeBps} bps${da.fees.integrator ? ` (incl. ${da.fees.integratorFeeBps} bps for ${da.fees.integrator})` : ""}`],
    ["deposits", `${da.depositCount}${da.lastDepositAt ? `, last ${da.lastDepositAt}` : ""}`],
  ];
  if (da.label) rows.push(["label", da.label]);
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) io.out(`${k.padEnd(w)}  ${v}`);
}

function parseMetadata(v: string | undefined): Record<string, string> | undefined {
  if (v === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const pair of v.split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = pair.indexOf("=");
    if (i <= 0) throw new UsageError(`--metadata takes key=value pairs separated by commas, got "${pair}"`);
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  if (Object.keys(out).length > 20) throw new UsageError("--metadata takes at most 20 keys");
  return out;
}

/** Human amount -> base units with the built-in token list, or as-is with --base-units. */
function amountToBase(amount: string, chainId: number, token: string, baseUnits: boolean | undefined, where: string): string {
  let base: string;
  if (baseUnits) {
    if (!/^\d+$/.test(amount)) throw new UsageError("--base-units amount must be an integer string");
    base = amount;
  } else {
    const t = findToken(chainId, token);
    if (!t) throw new UsageError(`"${token}" is not in the ${where} token list; pass the amount in base units with --base-units`);
    try {
      base = parseUnits(amount, t.decimals);
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
  }
  if (/^0+$/.test(base)) throw new UsageError("amount must be greater than 0");
  return base;
}

function daId(args: string[], sub: string): string {
  const [id] = need(args, 1, `deposit-address ${sub} <id>`);
  if (!id!.startsWith("da_")) throw new UsageError(`"${id}" is not a deposit address id (they start with da_)`);
  return id!;
}

async function cmdDepositAddress(p: ParsedArgs, io: Io): Promise<number> {
  const [sub, ...args] = need(p.args, 1, DA_USAGE) as [string, ...string[]];
  if (!["create", "list", "get", "refresh", "disable", "simulate"].includes(sub)) throw new UsageError(`Unknown subcommand "${sub}". Usage: layerhop ${DA_USAGE}`);
  const key = requireKey(p.opts, io, "deposit-address");
  const lh = client(p.opts, io);
  const o = p.opts;

  if (sub === "create") {
    const [token, chain, toToken, toChain] = need(args, 4, "deposit-address create <token> <chain> <toToken> <toChain> --recipient <addr> --refund-to <addr>") as [string, string, string, string];
    if (!o.recipient || !o["refund-to"]) throw new UsageError("deposit-address create needs --recipient and --refund-to (your user's own address on the source chain, never an exchange deposit address)");
    const src = resolveChain(chain);
    const dst = resolveChain(toChain);
    if (o["one-time"] && o.amount === undefined) throw new UsageError("--one-time needs --amount (the exact amount to send)");
    const amount = o.amount === undefined ? undefined : amountToBase(o.amount, src.id, token, o["base-units"], src.slug);
    const metadata = parseMetadata(o.metadata);
    const da = await lh.depositAddresses.create({
      srcChain: src.slug, srcToken: token, dstChain: dst.slug, dstToken: toToken, recipient: o.recipient, refundTo: o["refund-to"],
      ...(o["one-time"] ? { reusable: false } : {}),
      ...(amount ? { amount } : {}),
      ...(o.label ? { label: o.label } : {}),
      ...(metadata ? { metadata } : {}),
    });
    if (o.json) {
      io.out(json(da));
      return 0;
    }
    printDepositAddress(io, da);
    const e = da.estimate;
    io.out(`\nEstimate: ${tokenAmount(da.chainId, da.token, e.amount)} -> ~${tokenAmount(da.dstChainId, da.dstToken, e.dstAmount)} (min ${tokenAmount(da.dstChainId, da.dstToken, e.dstAmountMin)}) in ~${formatSeconds(e.estimatedSeconds)}. Each deposit is priced when it arrives.`);
    io.out("\nTell your user:");
    for (const r of depositRules(da)) io.out(`  - ${r}`);
    return 0;
  }

  if (sub === "list") {
    const status = o.status;
    if (status !== undefined && status !== "active" && status !== "disabled") throw new UsageError("--status must be active or disabled");
    const r = await lh.depositAddresses.list({ status, label: o.label, cursor: o.cursor, limit: int(o.limit, "limit") });
    if (o.json) {
      io.out(json(r));
      return 0;
    }
    if (!r.depositAddresses.length) io.out("No deposit addresses.");
    else {
      io.out(
        table(
          ["ID", "STATUS", "MODE", "ADDRESS", "ROUTE", "DEPOSITS", "LABEL"],
          r.depositAddresses.map((d) => [d.id, d.status, d.livemode ? "live" : "test", d.address, routeLabel(d), String(d.depositCount), d.label ?? ""]),
        ),
      );
    }
    if (r.nextCursor) io.out(`\nMore: --cursor ${r.nextCursor}`);
    return 0;
  }

  if (sub === "get") {
    const da = await lh.depositAddresses.get(daId(args, "get"));
    if (o.json) {
      io.out(json(da));
      return 0;
    }
    printDepositAddress(io, da);
    io.out("");
    if (!da.deposits.length) io.out("No deposits yet. If your user just sent funds, run `layerhop deposit-address refresh " + da.id + "`.");
    else {
      io.out(
        table(
          ["ORDER", "STATUS", "DEPOSITED", "DELIVERED", "SRC TX", "CREATED"],
          da.deposits.map((d) => [d.quoteId, d.status, tokenAmount(d.srcChainId, d.srcToken, d.amount), tokenAmount(d.dstChainId, d.dstToken, d.dstAmount), d.srcTxHash ?? "-", d.createdAt]),
        ),
      );
    }
    io.out("\nTell your user:");
    for (const r of depositRules(da)) io.out(`  - ${r}`);
    return 0;
  }

  if (sub === "refresh") {
    const da = await lh.depositAddresses.refresh(daId(args, "refresh"));
    io.out(o.json ? json(da) : `Checking ${da.address} (${da.id}) for deposits now. Run \`layerhop deposit-address get ${da.id}\` in ~15-30s.`);
    return 0;
  }

  if (sub === "disable") {
    const da = await lh.depositAddresses.disable(daId(args, "disable"));
    io.out(o.json ? json(da) : `Disabled ${da.address} (${da.id}). Stop showing it to your user: deposits sent to it are no longer tracked.`);
    return 0;
  }

  // simulate
  const id = daId(args, "simulate");
  const [, amount] = need(args, 2, "deposit-address simulate <id> <amount> [--base-units]") as [string, string];
  if (!key.startsWith("lh_test_")) throw new UsageError("deposit-address simulate only works with a test key (lh_test_…); live deposits are real");
  let base: string;
  if (o["base-units"]) base = amountToBase(amount, 0, "", true, "");
  else {
    const da = await lh.depositAddresses.get(id);
    base = amountToBase(amount, da.chainId, da.token, false, chainLabel(da.chainId));
  }
  const order = await lh.depositAddresses.simulate(id, { amount: base });
  if (o.json) io.out(json(order));
  else {
    const outcome = base.endsWith("4001") ? "refunded" : base.endsWith("4002") ? "failed" : "filled";
    io.out(`Recorded test deposit ${order.quoteId} (${tokenAmount(order.srcChainId, order.srcToken, order.amount)}, ${order.status}). The sandbox settles it as ${outcome}.`);
  }
  return 0;
}

/** Runs the CLI. Returns the process exit code; never calls process.exit. */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const p = parse(argv);
    if (p.opts.version) {
      io.out(VERSION);
      return 0;
    }
    if (p.opts.help || !p.command || p.command === "help") {
      io.out(HELP);
      return p.command || p.opts.help ? 0 : 1;
    }
    switch (p.command) {
      case "chains": return await cmdChains(p, io);
      case "tokens": return await cmdTokens(p, io);
      case "quote": return await cmdQuote(p, io);
      case "status": return await cmdStatus(p, io);
      case "link": return cmdLink(p, io);
      case "init": return await cmdInit(p, io);
      case "dev": return await cmdDev(p, io);
      case "devnet": return await cmdDevnet(p, io);
      case "listen": return await cmdListen(p, io);
      case "trigger": return await cmdTrigger(p, io);
      case "deposit-address": case "deposit-addresses": return await cmdDepositAddress(p, io);
      default: throw new UsageError(`Unknown command "${p.command}". Run layerhop --help.`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`error: ${e.message}`);
      return 2;
    }
    if (e instanceof LayerHopApiError) {
      io.err(`error: ${e.code}: ${e.message}${e.requestId ? ` (requestId ${e.requestId})` : ""}`);
      io.err(`  https://docs.layerhop.com/errors/${e.code}`);
      return 1;
    }
    io.err(`error: ${(e as Error).message}`);
    return 1;
  }
}
