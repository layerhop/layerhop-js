import { describe, expect, it } from "vitest";
import { decodeX402Header, encodeX402Header, x402 } from "./index.js";

const REQS = {
  payee: { id: "x4p_1", depositAddress: "0xdep", network: "eip155:8453", feeBps: 25 },
  price: "10000", amount: "10026", fee: { bps: 25, amount: "25" },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10026", asset: "0xusdc", payTo: "0xdep", maxTimeoutSeconds: 60 }],
  acceptsV1: [{ scheme: "exact", network: "base", maxAmountRequired: "10026", asset: "0xusdc", payTo: "0xdep", resource: "https://shop.test/weather" }],
  paymentRequired: { x402Version: 2, resource: { url: "https://shop.test/weather" }, accepts: [] },
};

function api(o: { valid?: boolean; settle?: Record<string, unknown> } = {}) {
  const calls: { path: string; body: Record<string, unknown>; key: string | null }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.test/v1/x402/", "");
    calls.push({ path, body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("x-api-key") });
    const out = path === "requirements" ? REQS
      : path === "verify" ? (o.valid === false ? { isValid: false, invalidReason: "insufficient_funds" } : { isValid: true, payer: "0xpayer" })
      : (o.settle ?? { success: true, transaction: "0xtx", network: "eip155:8453", payer: "0xpayer" });
    return Response.json(out);
  }) as typeof fetch;
  return Object.assign(f, { calls });
}

const pay = (f: typeof fetch) => x402({ apiKey: "lh_live_x", price: "10000", payTo: "0xmerchant", baseUrl: "https://api.test", fetch: f });
const v2Header = encodeX402Header({ x402Version: 2, accepted: REQS.accepts[0], payload: { signature: "0xs", authorization: {} } });

describe("x402 middleware (D-066)", () => {
  it("answers 402 with v1 body and v2 PAYMENT-REQUIRED header, requirements cached per resource", async () => {
    const f = api();
    const handler = pay(f).fetch(() => Response.json({ temp: 21 }));
    const res = await handler(new Request("https://shop.test/weather?city=x"));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ x402Version: 1, accepts: REQS.acceptsV1 });
    expect(decodeX402Header(res.headers.get("payment-required"))).toMatchObject({ x402Version: 2 });
    await handler(new Request("https://shop.test/weather?city=y"));
    expect(f.calls.filter((c) => c.path === "requirements")).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ key: "lh_live_x", body: { network: "base", amount: "10000", payTo: "0xmerchant", resource: "https://shop.test/weather" } });
  });

  it("verifies, runs the handler, settles and adds the payment response headers", async () => {
    const f = api();
    const res = await pay(f).fetch(() => Response.json({ temp: 21 }))(new Request("https://shop.test/weather", { headers: { "PAYMENT-SIGNATURE": v2Header } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ temp: 21 });
    expect(decodeX402Header(res.headers.get("payment-response"))).toMatchObject({ success: true, transaction: "0xtx" });
    expect(res.headers.get("x-payment-response")).toBe(res.headers.get("payment-response"));
    const verify = f.calls.find((c) => c.path === "verify")!;
    expect(verify.body).toMatchObject({ x402Version: 2, paymentRequirements: REQS.accepts[0] });
    expect(f.calls.map((c) => c.path)).toEqual(["requirements", "verify", "settle"]);
  });

  it("uses v1 requirements for an X-PAYMENT header, refuses invalid payments and never charges a failed handler", async () => {
    const f = api();
    const v1 = encodeX402Header({ x402Version: 1, scheme: "exact", network: "base", payload: {} });
    const failing = await pay(f).fetch(() => new Response("boom", { status: 500 }))(new Request("https://shop.test/weather", { headers: { "X-PAYMENT": v1 } }));
    expect(failing.status).toBe(500);
    expect(f.calls.find((c) => c.path === "verify")!.body).toMatchObject({ x402Version: 1, paymentRequirements: REQS.acceptsV1[0] });
    expect(f.calls.some((c) => c.path === "settle")).toBe(false);
    const bad = await pay(api({ valid: false })).fetch(() => Response.json({}))(new Request("https://shop.test/weather", { headers: { "X-PAYMENT": v1 } }));
    expect(bad.status).toBe(402);
    expect((await bad.json()).error).toBe("insufficient_funds");
  });

  it("turns a failed settlement into a 402 (Hono) and settles before the handler (Express)", async () => {
    const f = api({ settle: { success: false, errorReason: "invalid_transaction_state", transaction: "", network: "eip155:8453" } });
    const ctx = { req: { raw: new Request("https://shop.test/weather", { headers: { "PAYMENT-SIGNATURE": v2Header } }) }, res: new Response("ok") };
    await pay(f).hono()(ctx, async () => { ctx.res = Response.json({ temp: 21 }); });
    expect(ctx.res.status).toBe(402);

    const g = api();
    const headers: Record<string, string> = {};
    let nexted = false;
    const res = { status: () => res, setHeader: (k: string, v: string) => { headers[k] = v; }, json: () => undefined };
    await pay(g).express()({ protocol: "https", originalUrl: "/weather", headers: { host: "shop.test", "payment-signature": v2Header } }, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(headers["payment-response"]).toBeDefined();
  });
});
