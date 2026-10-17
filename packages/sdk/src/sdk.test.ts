import { describe, expect, it } from "vitest";
import { LayerHop, LayerHopApiError } from "./index.js";

function fakeFetch(handler: (url: string, init?: RequestInit) => [number, unknown]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const [status, body] = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("sdk", () => {
  it("sends quote params, channel and api key", async () => {
    let seen: { url: string; key?: string } = { url: "" };
    const lh = new LayerHop({
      baseUrl: "http://x", apiKey: "k1", channel: "widget",
      fetch: fakeFetch((url, init) => {
        seen = { url, key: (init?.headers as Record<string, string>)["x-api-key"] };
        return [200, { best: { quoteId: "q1" }, quotes: [], errors: [] }];
      }),
    });
    const r = await lh.quote({ srcChain: "base", srcToken: "USDC", amount: "1", dstChain: "solana", dstToken: "SOL", sender: "a", recipient: "b" });
    expect(r.best.quoteId).toBe("q1");
    expect(seen.url).toContain("http://x/v1/quote?");
    expect(seen.url).toContain("channel=widget");
    expect(seen.key).toBe("k1");
  });

  it("sends integrator and integratorFeeBps only when set; exposes the fee split", async () => {
    const urls: string[] = [];
    const fees = { ourFeeBps: 20, integratorFeeBps: 50, integrator: "myapp" };
    const f = fakeFetch((url) => {
      urls.push(url);
      return [200, { best: { quoteId: "q1", fees }, quotes: [], errors: [] }];
    });
    const params = { srcChain: "base", srcToken: "USDC", amount: "1", dstChain: "solana", dstToken: "SOL", sender: "a", recipient: "b" };
    const r = await new LayerHop({ baseUrl: "http://x", integrator: "myapp", integratorFeeBps: 50, fetch: f }).quote(params);
    const sp = new URL(urls[0]!).searchParams;
    expect(sp.get("integrator")).toBe("myapp");
    expect(sp.get("integratorFeeBps")).toBe("50");
    expect(r.best.fees.integratorFeeBps).toBe(50);
    expect(r.best.fees.integrator).toBe("myapp");
    await new LayerHop({ baseUrl: "http://x", fetch: f }).quote(params);
    expect(new URL(urls[1]!).searchParams.has("integrator")).toBe(false);
    expect(new URL(urls[1]!).searchParams.has("integratorFeeBps")).toBe(false);
  });

  it("throws typed errors", async () => {
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch(() => [410, { error: { code: "QUOTE_EXPIRED", message: "old", requestId: "r" } }]) });
    await expect(lh.buildTx("q")).rejects.toMatchObject({ code: "QUOTE_EXPIRED", status: 410 });
    await expect(lh.buildTx("q")).rejects.toBeInstanceOf(LayerHopApiError);
  });

  it("watch stops at a final state", async () => {
    const states = ["pending", "pending", "filled"];
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch(() => [200, { provider: "mock", id: "1", state: states.shift() }]) });
    const seen: string[] = [];
    for await (const s of lh.watch("mock", "1", { intervalMs: 1 })) seen.push(s.state);
    expect(seen).toEqual(["pending", "filled"]);
  });

  it("reportSubmitted posts the tx hash to /orders/{quoteId}/submitted", async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "k", fetch: fakeFetch((url, init) => {
      seen.push({ url, method: init?.method, body: String(init?.body) });
      return [200, { quoteId: "q_1", status: "submitted" }];
    }) });
    expect(await lh.reportSubmitted("q_1", "0xabc")).toEqual({ quoteId: "q_1", status: "submitted" });
    expect(seen[0]).toEqual({ url: "http://x/v1/orders/q_1/submitted", method: "POST", body: JSON.stringify({ txHash: "0xabc" }) });
  });

  it("simulate posts the quoteId and returns the typed result", async () => {
    let body = "";
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url, init) => {
      expect(url).toBe("http://x/v1/simulate");
      body = String(init?.body);
      return [200, { quoteId: "q_1", provider: "relay", ok: true, vm: "evm", gasEstimate: "21000", needsApproval: false, simulated: "tx", tx: { vm: "evm" } }];
    }) });
    const r = await lh.simulate("q_1");
    expect(body).toBe(JSON.stringify({ quoteId: "q_1" }));
    expect(r.ok).toBe(true);
    expect(r.gasEstimate).toBe("21000");
  });

  it("listOrders builds the query and passes the cursor", async () => {
    const urls: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url) => {
      urls.push(url);
      return [200, { orders: [], nextCursor: null }];
    }) });
    await lh.listOrders({ address: "0xAbC" });
    await lh.listOrders({ address: "0xAbC", status: "filled", cursor: "c1", limit: 10 });
    expect(urls[0]).toBe("http://x/v1/orders?address=0xAbC");
    const sp = new URL(urls[1]!).searchParams;
    expect(Object.fromEntries(sp)).toEqual({ address: "0xAbC", status: "filled", cursor: "c1", limit: "10" });
    await expect(new LayerHop({ baseUrl: "http://x", fetch: fakeFetch(() => [404, { error: { code: "NOT_FOUND", message: "x" } }]) }).listOrders({ address: "a" }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
