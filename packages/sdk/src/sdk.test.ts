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

  it("checkout: create, get, list, expire and quote hit the session routes", async () => {
    const seen: { url: string; method?: string; body?: string; key?: string }[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "lh_test_k", fetch: fakeFetch((url, init) => {
      seen.push({ url, method: init?.method, body: init?.body ? String(init.body) : undefined, key: (init?.headers as Record<string, string>)["x-api-key"] });
      return [200, { id: "cs_test_1", sessions: [], best: { quoteId: "q_test_1" } }];
    }) });
    await lh.checkout.create({ amount: "49000000", settleChain: "base", settleToken: "USDC", recipient: "0x2" });
    await lh.checkout.get("cs_test_1");
    await lh.checkout.list({ status: "paid", limit: 5 });
    await lh.checkout.list();
    await lh.checkout.expire("cs_test_1");
    await lh.checkout.quote("cs_test_1", { srcChain: "arbitrum", srcToken: "ETH", sender: "0x1" });
    expect(seen.map((x) => `${x.method ?? "GET"} ${x.url}`)).toEqual([
      "POST http://x/v1/checkout/sessions",
      "GET http://x/v1/checkout/sessions/cs_test_1",
      "GET http://x/v1/checkout/sessions?status=paid&limit=5",
      "GET http://x/v1/checkout/sessions",
      "POST http://x/v1/checkout/sessions/cs_test_1/expire",
      "POST http://x/v1/checkout/sessions/cs_test_1/quote",
    ]);
    expect(JSON.parse(seen[0]!.body!)).toEqual({ amount: "49000000", settleChain: "base", settleToken: "USDC", recipient: "0x2" });
    expect(JSON.parse(seen[5]!.body!)).toEqual({ srcChain: "arbitrum", srcToken: "ETH", sender: "0x1" });
    expect(seen.every((x) => x.key === "lh_test_k")).toBe(true);
  });

  it("streamOrder parses SSE frames split across chunks and stops at the end of the stream", async () => {
    const frames = [
      "event: ready\ndata: {\"retryMs\":3000}\n\n: ping\n\nevent: order\ndata: {\"quoteId\":\"q_1\",\"status\":\"built\"}\n\neve",
      "nt: order\r\ndata: {\"quoteId\":\"q_1\",\"status\":\"filled\"}\r\n\r\n",
    ];
    let url = "";
    let accept = "";
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "k", fetch: (async (u: string, init?: RequestInit) => {
      url = u;
      accept = (init?.headers as Record<string, string>).accept!;
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch });
    const seen: string[] = [];
    for await (const o of lh.streamOrder("q_1")) seen.push(o.status);
    expect(seen).toEqual(["built", "filled"]);
    expect(url).toBe("http://x/v1/orders/q_1/events");
    expect(accept).toBe("text/event-stream");
  });

  it("stream errors surface as LayerHopApiError; webhooks.trigger posts the type", async () => {
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "lh_live_k", fetch: fakeFetch((url, init) =>
      url.endsWith("/webhooks/trigger")
        ? [403, { error: { code: "FORBIDDEN", message: "test keys only", requestId: "r1" } }]
        : [404, { error: { code: "NOT_FOUND", message: "Checkout session not found" } }]) });
    await expect(lh.checkout.stream("cs_x").next()).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(lh.webhooks.trigger("order.filled")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
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

describe("sdk assets", () => {
  const capture = (body: unknown) => {
    const urls: URL[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url) => (urls.push(new URL(url)), [200, body])) });
    return { lh, urls };
  };

  it("chains() unwraps the registry", async () => {
    const { lh, urls } = capture({ chains: [{ id: 80094, slug: "berachain" }] });
    expect((await lh.chains())[0]!.slug).toBe("berachain");
    expect(urls[0]!.pathname).toBe("/v1/chains");
  });

  it("tokens() sends chain, q, limit, cursor (a bare chain is shorthand)", async () => {
    const { lh, urls } = capture({ tokens: [{ symbol: "HONEY" }], nextCursor: "50" });
    const r = await lh.tokens({ chain: "berachain", q: "HONEY", limit: 50, cursor: "0x" });
    expect(r.nextCursor).toBe("50");
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ chain: "berachain", q: "HONEY", limit: "50", cursor: "0x" });
    await lh.tokens(8453);
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({ chain: "8453" });
  });

  it("lookupToken() and prices() build the right queries", async () => {
    const { lh, urls } = capture({ token: { symbol: "WETH" }, prices: { "8453:0xa": 1 } });
    expect((await lh.lookupToken("base", "0xa")).symbol).toBe("WETH");
    expect(urls[0]!.pathname).toBe("/v1/tokens/lookup");
    expect(urls[0]!.searchParams.get("address")).toBe("0xa");
    expect(await lh.prices(["8453:0xa", { chainId: 7565164, address: "So1" }])).toEqual({ "8453:0xa": 1 });
    expect(urls[1]!.searchParams.get("ids")).toBe("8453:0xa,7565164:So1");
    expect(await lh.prices([])).toEqual({});
    expect(urls).toHaveLength(2);
  });

  it("balances() sends chains only when given", async () => {
    const { lh, urls } = capture({ address: "0xabc", vm: "evm", balances: [], totalUsd: 0, errors: [] });
    await lh.balances("0xabc");
    expect(urls[0]!.searchParams.has("chains")).toBe(false);
    await lh.balances("0xabc", ["base", 80094]);
    expect(urls[1]!.searchParams.get("chains")).toBe("base,80094");
  });
});
