import { describe, expect, it } from "vitest";
import { LayerHop, LayerHopApiError } from "./index.js";

const quote = (seq: number, dst: string) =>
  `event: quote\ndata: ${JSON.stringify({ seq, best: { quoteId: `q_${seq}`, provider: "relay", dstAmount: dst }, quotes: [], errors: [] })}\n\n`;
const sse = (text: string) => (async () => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
const params = { srcChain: "base", srcToken: "USDC", amount: "1000000", dstChain: "solana", dstToken: "USDC", sender: "0x1", recipient: "So1" };

describe("quotes.stream (GET /v1/quote/stream)", () => {
  it("sends the quote params and intervalMs, yields quote events and ends on `end`", async () => {
    let url = "";
    const body = `event: ready\ndata: {"intervalMs":5000}\n\n${quote(1, "100")}: ping\n\n${quote(2, "99")}event: end\ndata: {"reason":"expired"}\n\n${quote(3, "1")}`;
    const fetchFn = (async (u: string) => {
      url = u;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fetchFn, apiKey: "lh_test_k" });
    const seen: string[] = [];
    for await (const u of lh.quotes.stream(params, { intervalMs: 5000 })) seen.push(`${u.seq}:${u.best.dstAmount}`);
    expect(seen).toEqual(["1:100", "2:99"]);
    const u = new URL(url);
    expect(u.pathname).toBe("/v1/quote/stream");
    expect(u.searchParams.get("amount")).toBe("1000000");
    expect(u.searchParams.get("intervalMs")).toBe("5000");
  });

  it("throws LayerHopApiError on an `error` event", async () => {
    const err = `event: error\ndata: ${JSON.stringify({ status: 429, error: { code: "RATE_LIMITED", message: "slow down", requestId: "r1" } })}\n\n`;
    const lh = new LayerHop({ baseUrl: "http://x", fetch: sse(quote(1, "100") + err) });
    const it = lh.quotes.stream(params);
    expect((await it.next()).value?.seq).toBe(1);
    const e = await it.next().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LayerHopApiError);
    expect(e).toMatchObject({ code: "RATE_LIMITED", status: 429, requestId: "r1" });
  });

  it("an error before the stream opens is thrown as from GET /v1/quote", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { code: "ADDRESS_SANCTIONED", message: "listed" } }), { status: 451 })) as unknown as typeof fetch;
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fetchFn });
    await expect(lh.quotes.stream(params).next()).rejects.toMatchObject({ code: "ADDRESS_SANCTIONED", status: 451 });
  });
});

describe("screen", () => {
  it("posts the addresses", async () => {
    let sent: unknown;
    const fetchFn = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ results: [], list: null, enforced: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fetchFn });
    expect(await lh.screen(["0xabc"])).toEqual({ results: [], list: null, enforced: false });
    expect(sent).toEqual({ addresses: ["0xabc"] });
  });
});
