/**
 * x402 merchant middleware (D-066, docs guides/x402.md): charge USDC per HTTP request with Coinbase's
 * open x402 protocol, verified and settled by LayerHop's facilitator.
 *
 *   const pay = x402({ apiKey: process.env.LAYERHOP_API_KEY!, price: "10000", payTo: "0xYourWallet", network: "base" });
 *   app.get("/weather", pay.hono(), (c) => c.json({ temp: 21 }));          // Hono
 *   app.get("/weather", pay.express(), (req, res) => res.json({ temp: 21 })); // Express
 *   export default { fetch: pay.fetch(async (req) => Response.json({ temp: 21 })) }; // fetch handlers
 *
 * A request without a payment gets `402` with the requirements (v1 JSON body + v2 `PAYMENT-REQUIRED`
 * header). A request with `X-PAYMENT` (v1) or `PAYMENT-SIGNATURE` (v2) is verified by LayerHop; the
 * handler runs; then the payment is settled and the response carries `X-PAYMENT-RESPONSE` and
 * `PAYMENT-RESPONSE`. Express settles before calling the handler (its response can't be held back).
 *
 * `price` is what you net, in USDC base units (6 decimals). The payer pays LayerHop's checkout fee on
 * top; `payTo` in the requirements is your own fee-splitting deposit address, swept to `payTo` here.
 */
import { X402_HEADERS, decodeX402Header, encodeX402Header, normalizeX402Resource } from "@layerhop/shared";

export interface X402Options {
  /** Your LayerHop API key (lh_live_… to settle real payments). */
  apiKey: string;
  /** What you net per request, in USDC base units: "10000" = 0.01 USDC. */
  price: string | bigint;
  /** Your payout address on `network`. */
  payTo: string;
  /** "base" (default), "optimism", "arbitrum" or "polygon". */
  network?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  /** Resource key for the deposit address and the requirements; default: the request URL without its query. */
  resource?: string | ((req: Request) => string);
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface X402Requirements {
  payee: { id: string; depositAddress: string; network: string; feeBps: number };
  price: string;
  amount: string;
  fee: { bps: number; amount: string };
  accepts: Record<string, unknown>[];
  acceptsV1: Record<string, unknown>[];
  paymentRequired: Record<string, unknown>;
}

export interface X402SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
}

/** Outcome of checking a request: a 402 to send, or a verified payment to settle after the handler. */
export type X402Check =
  | { paid: false; response: Response }
  | { paid: true; payer: string; settle(): Promise<{ ok: boolean; headers: Record<string, string>; response?: Response; result: X402SettleResponse }> };

const REQUIREMENTS_TTL_MS = 10 * 60_000;

type HeaderSource = { get(name: string): string | null };

/** Minimal Hono context shape (no dependency on hono). */
export interface HonoLikeContext {
  req: { raw: Request };
  res: Response;
}
/** Minimal Express shapes (no dependency on express). */
export interface ExpressLikeRequest {
  protocol?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  get?(name: string): string | undefined;
}
export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

export function x402(opts: X402Options) {
  const base = (opts.baseUrl ?? "https://api.layerhop.com").replace(/\/$/, "");
  const f = opts.fetch ?? fetch;
  const price = String(opts.price);
  if (!/^\d+$/.test(price)) throw new Error("x402: price must be an integer string in USDC base units (\"10000\" = 0.01 USDC)");
  const cache = new Map<string, { at: number; p: Promise<X402Requirements> }>();

  async function api<T>(path: string, body: unknown): Promise<T> {
    const res = await f(`${base}/v1/x402/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": opts.apiKey }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (!res.ok) throw new Error(`LayerHop x402 ${path}: ${j.error?.code ?? res.status} ${j.error?.message ?? ""}`.trim());
    return j;
  }

  const resourceOf = (req: Request) => {
    if (typeof opts.resource === "function") return opts.resource(req);
    if (opts.resource) return opts.resource;
    return normalizeX402Resource(req.url);
  };

  /** Requirements for a resource (cached for 10 minutes; the deposit address never changes). */
  function requirements(resource: string): Promise<X402Requirements> {
    const hit = cache.get(resource);
    if (hit && Date.now() - hit.at < REQUIREMENTS_TTL_MS) return hit.p;
    const p = api<X402Requirements>("requirements", {
      network: opts.network ?? "base", amount: price, payTo: opts.payTo, resource,
      ...(opts.description ? { description: opts.description } : {}), ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
      ...(opts.maxTimeoutSeconds ? { maxTimeoutSeconds: opts.maxTimeoutSeconds } : {}),
    });
    cache.set(resource, { at: Date.now(), p });
    p.catch(() => cache.delete(resource));
    return p;
  }

  function paymentRequired(r: X402Requirements, error: string, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ x402Version: 1, error, accepts: r.acceptsV1 }), {
      status: 402,
      headers: { "content-type": "application/json", [X402_HEADERS.requiredV2]: encodeX402Header({ ...r.paymentRequired, error }), ...extraHeaders },
    });
  }

  /** Check one request (any framework): 402 to send, or a verified payment. */
  async function check(req: Request, headers: HeaderSource = req.headers): Promise<X402Check> {
    const r = await requirements(resourceOf(req));
    const v2 = headers.get(X402_HEADERS.paymentV2);
    const raw = v2 ?? headers.get(X402_HEADERS.paymentV1);
    if (!raw) return { paid: false, response: paymentRequired(r, v2 === null ? "X-PAYMENT or PAYMENT-SIGNATURE header is required" : "payment required") };
    const payload = decodeX402Header<{ x402Version?: number }>(raw);
    if (!payload) return { paid: false, response: paymentRequired(r, "invalid_payload") };
    const version = payload.x402Version === 2 ? 2 : 1;
    const body = { x402Version: version, paymentPayload: payload, paymentRequirements: version === 2 ? r.accepts[0] : r.acceptsV1[0] };
    const v = await api<{ isValid: boolean; invalidReason?: string; payer?: string }>("verify", body);
    if (!v.isValid) return { paid: false, response: paymentRequired(r, v.invalidReason ?? "invalid payment") };
    return {
      paid: true,
      payer: v.payer ?? "",
      async settle() {
        const result = await api<X402SettleResponse>("settle", body);
        const encoded = encodeX402Header(result);
        const h = { [X402_HEADERS.responseV1]: encoded, [X402_HEADERS.responseV2]: encoded };
        // `settlement_pending`: the transaction was sent and will most likely land; LayerHop finishes it.
        const ok = result.success || (result.errorReason === "settlement_pending" && !!result.transaction);
        return ok ? { ok, headers: h, result } : { ok, headers: h, result, response: paymentRequired(r, result.errorReason ?? "settlement failed", h) };
      },
    };
  }

  const withHeaders = (res: Response, h: Record<string, string>) => {
    const out = new Response(res.body, res);
    for (const [k, val] of Object.entries(h)) out.headers.set(k, val);
    return out;
  };

  return {
    requirements,
    check,
    /** Wrap a fetch handler (Cloudflare Workers, Bun, Deno, Next.js route handlers). */
    fetch(handler: (req: Request) => Response | Promise<Response>) {
      return async (req: Request): Promise<Response> => {
        const c = await check(req);
        if (!c.paid) return c.response;
        const res = await handler(req);
        if (res.status >= 400) return res; // nothing delivered: don't charge
        const s = await c.settle();
        return s.ok ? withHeaders(res, s.headers) : s.response!;
      };
    },
    /** Hono middleware. */
    hono() {
      return async (ctx: HonoLikeContext, next: () => Promise<void>): Promise<Response | void> => {
        const c = await check(ctx.req.raw);
        if (!c.paid) return c.response;
        await next();
        if (ctx.res.status >= 400) return;
        const s = await c.settle();
        ctx.res = s.ok ? withHeaders(ctx.res, s.headers) : s.response!;
      };
    },
    /** Express / Connect middleware: settles before the handler runs. */
    express() {
      return async (req: ExpressLikeRequest, res: ExpressLikeResponse, next: (err?: unknown) => void) => {
        try {
          const host = req.get?.("host") ?? (req.headers.host as string | undefined) ?? "localhost";
          const url = `${req.protocol ?? "https"}://${host}${req.originalUrl ?? req.url ?? "/"}`;
          const h = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") h.set(k, v);
          const c = await check(new Request(url, { headers: h }), h);
          const send = async (r: Response) => {
            res.status(r.status);
            r.headers.forEach((val, k) => res.setHeader(k, val));
            res.json(await r.json());
          };
          if (!c.paid) return await send(c.response);
          const s = await c.settle();
          if (!s.ok) return await send(s.response!);
          for (const [k, val] of Object.entries(s.headers)) res.setHeader(k, val);
          next();
        } catch (e) {
          next(e);
        }
      };
    },
  };
}
