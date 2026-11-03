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

  it("sends referrer only when set (GET and POST quotes)", async () => {
    const seen: { url: string; body?: string }[] = [];
    const f = fakeFetch((url, init) => {
      seen.push({ url, body: init?.body as string | undefined });
      return [200, { best: { quoteId: "q1" }, quotes: [], errors: [] }];
    });
    const lh = new LayerHop({ baseUrl: "http://x", fetch: f });
    const params = { srcChain: "base", srcToken: "USDC", amount: "1", dstChain: "solana", dstToken: "SOL", sender: "a", recipient: "b" };
    await lh.quote({ ...params, referrer: "0xref" });
    await lh.quote(params);
    expect(new URL(seen[0]!.url).searchParams.get("referrer")).toBe("0xref");
    expect(new URL(seen[1]!.url).searchParams.has("referrer")).toBe(false);
    const { amount: _a, ...rest } = params;
    await lh.quote({ ...rest, dstAmount: "5", action: { type: "aave-v3-supply" }, referrer: "So1" });
    expect(JSON.parse(seen[2]!.body!).referrer).toBe("So1");
    await lh.quote({ ...params, copyOf: "q_card" });
    expect(new URL(seen[3]!.url).searchParams.get("copyOf")).toBe("q_card");
    expect(new URL(seen[1]!.url).searchParams.has("copyOf")).toBe(false);
  });

  it("sends gasOnArrival (true → flag, number → USD) and exposes quote.gasOnArrival", async () => {
    const urls: string[] = [];
    const gas = { amount: "832291636081249", token: "0x0000000000000000000000000000000000000000", symbol: "ETH", decimals: 18, usd: 2 };
    const f = fakeFetch((url) => {
      urls.push(url);
      return [200, { best: { quoteId: "q1", gasOnArrival: gas }, quotes: [], errors: [] }];
    });
    const lh = new LayerHop({ baseUrl: "http://x", fetch: f });
    const params = { srcChain: "base", srcToken: "USDC", amount: "20000000", dstChain: "arbitrum", dstToken: "USDC", sender: "a", recipient: "a" };
    const r = await lh.quote({ ...params, gasOnArrival: true });
    expect(new URL(urls[0]!).searchParams.get("gasOnArrival")).toBe("true");
    expect(r.best.gasOnArrival).toEqual(gas);
    await lh.quote({ ...params, gasOnArrival: 5 });
    expect(new URL(urls[1]!).searchParams.get("gasOnArrivalUsd")).toBe("5");
    expect(new URL(urls[1]!).searchParams.has("gasOnArrival")).toBe(false);
    await lh.quote(params);
    expect(new URL(urls[2]!).searchParams.has("gasOnArrival")).toBe(false);
  });

  it("sends destination calls as POST /quote with dstAmount and exposes srcAmount + calls", async () => {
    const seen: { url: string; method?: string; body?: Record<string, unknown> }[] = [];
    const plan = { items: [{ to: "0xt", data: "0x01", value: "0" }], executor: "0xe", executed: true, simulation: { ok: true, gasUsed: "1" } };
    const f = fakeFetch((url, init) => {
      seen.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return [200, { best: { quoteId: "q1", srcAmount: "10083608", calls: plan }, quotes: [], errors: [] }];
    });
    const lh = new LayerHop({ baseUrl: "http://x", integrator: "myapp", fetch: f });
    const base = { srcChain: "base", srcToken: "USDC", dstChain: "arbitrum", dstToken: "USDC", dstAmount: "10000000", sender: "0xs", recipient: "0xr" };
    const r = await lh.quote({ ...base, action: { type: "aave-v3-supply" } });
    expect(seen[0]).toMatchObject({ url: "http://x/v1/quote", method: "POST", body: { ...base, action: { type: "aave-v3-supply" }, integrator: "myapp", slippageBps: 50, channel: "api" } });
    expect(seen[0]!.body).not.toHaveProperty("amount");
    expect(r.best.srcAmount).toBe("10083608");
    expect(r.best.calls).toEqual(plan);
    await lh.quote({ ...base, calls: [{ to: "0xt", data: "0x01" }] });
    expect(seen[1]!.body!.calls).toEqual([{ to: "0xt", data: "0x01" }]);
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

  it("checkout.products: create, get, list, update and the public startSession", async () => {
    const seen: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "k", fetch: fakeFetch((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      return [200, { id: "prod_1", products: [] }];
    }) });
    await lh.checkout.products.create({ name: "Pro", amount: "49000000", settleChain: "base", settleToken: "USDC", recipient: "0x2" });
    await lh.checkout.products.get("prod_1");
    await lh.checkout.products.list({ active: true });
    await lh.checkout.products.update("prod_1", { active: false });
    await lh.checkout.products.startSession("prod_1", { reference: "o_1" });
    expect(seen).toEqual([
      'POST http://x/v1/checkout/products {"name":"Pro","amount":"49000000","settleChain":"base","settleToken":"USDC","recipient":"0x2"}',
      "GET http://x/v1/checkout/products/prod_1 ",
      "GET http://x/v1/checkout/products?active=true ",
      'PATCH http://x/v1/checkout/products/prod_1 {"active":false}',
      'POST http://x/v1/checkout/products/prod_1/sessions {"reference":"o_1"}',
    ]);
  });

  it("invoices: create, get, list, update, send, void, publicView and pay hit the invoice routes", async () => {
    const seen: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "k", fetch: fakeFetch((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      if (url.endsWith("/pay")) return [201, { sessionId: "cs_1", url: "https://layerhop.com/pay/cs_1" }];
      return [200, { id: "inv_1", object: "invoice", status: "open", number: "INV-0001", invoices: [], nextCursor: null }];
    }) });
    const inv = await lh.invoices.create({
      lineItems: [{ description: "Design work", quantity: 2, unitAmount: "500000000" }],
      settleChain: "base", settleToken: "USDC", recipient: "0x2", customerEmail: "ap@client.example", send: true,
    });
    expect(inv.number).toBe("INV-0001");
    await lh.invoices.get("inv_1");
    await lh.invoices.list({ status: "open", limit: 10 });
    await lh.invoices.list();
    await lh.invoices.update("inv_1", { memo: null, dueAt: "2026-11-01" });
    await lh.invoices.send("inv_1");
    await lh.invoices.void("inv/1");
    await lh.invoices.publicView("inv_1");
    const pay = await lh.invoices.pay("inv_1");
    expect(pay).toEqual({ sessionId: "cs_1", url: "https://layerhop.com/pay/cs_1" });
    expect(seen).toEqual([
      'POST http://x/v1/invoices {"lineItems":[{"description":"Design work","quantity":2,"unitAmount":"500000000"}],"settleChain":"base","settleToken":"USDC","recipient":"0x2","customerEmail":"ap@client.example","send":true}',
      "GET http://x/v1/invoices/inv_1 ",
      "GET http://x/v1/invoices?status=open&limit=10 ",
      "GET http://x/v1/invoices ",
      'PATCH http://x/v1/invoices/inv_1 {"memo":null,"dueAt":"2026-11-01"}',
      "POST http://x/v1/invoices/inv_1/send {}",
      "POST http://x/v1/invoices/inv%2F1/void {}",
      "GET http://x/v1/invoices/inv_1/public ",
      "POST http://x/v1/invoices/inv_1/pay {}",
    ]);
  });

  it("subscriptions: create, get, list, update, cancel, pause, resume and invoices hit the subscription routes", async () => {
    const seen: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "k", fetch: fakeFetch((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      if (url.endsWith("/invoices")) return [200, { invoices: [{ id: "inv_1", subscriptionId: "sub_1" }] }];
      return [200, { id: "sub_1", object: "subscription", status: "active", subscriptions: [], nextCursor: null }];
    }) });
    const sub = await lh.subscriptions.create({
      customerEmail: "ada@example.com", interval: "month", amount: "49000000", settleChain: "base", settleToken: "USDC", recipient: "0x2", description: "Pro plan",
    });
    expect(sub.status).toBe("active");
    await lh.subscriptions.get("sub_1");
    await lh.subscriptions.list({ status: "past_due", limit: 5 });
    await lh.subscriptions.list();
    await lh.subscriptions.update("sub_1", { amount: "59000000", cancelAtPeriodEnd: false });
    await lh.subscriptions.cancel("sub_1", { atPeriodEnd: true });
    await lh.subscriptions.cancel("sub/1");
    await lh.subscriptions.pause("sub_1");
    await lh.subscriptions.resume("sub_1");
    const invoices = await lh.subscriptions.invoices("sub_1");
    expect(invoices[0]!.subscriptionId).toBe("sub_1");
    expect(seen).toEqual([
      'POST http://x/v1/subscriptions {"customerEmail":"ada@example.com","interval":"month","amount":"49000000","settleChain":"base","settleToken":"USDC","recipient":"0x2","description":"Pro plan"}',
      "GET http://x/v1/subscriptions/sub_1 ",
      "GET http://x/v1/subscriptions?status=past_due&limit=5 ",
      "GET http://x/v1/subscriptions ",
      'PATCH http://x/v1/subscriptions/sub_1 {"amount":"59000000","cancelAtPeriodEnd":false}',
      'POST http://x/v1/subscriptions/sub_1/cancel {"atPeriodEnd":true}',
      "POST http://x/v1/subscriptions/sub%2F1/cancel {}",
      "POST http://x/v1/subscriptions/sub_1/pause {}",
      "POST http://x/v1/subscriptions/sub_1/resume {}",
      "GET http://x/v1/subscriptions/sub_1/invoices ",
    ]);
  });

  it("recurringOrders: create, submit, list and cancel hit the recurring-order routes", async () => {
    const seen: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      if (url.endsWith("/recurring-orders") && init?.method === "POST") return [201, { object: "recurring_order_build", requestId: "r1", tx: { vm: "svm", serializedTx: "AQ==", submitViaApi: true } }];
      if (url.endsWith("/submit")) return [200, { txHash: "sig1", order: "O1" }];
      if (url.endsWith("/cancel")) return [200, { requestId: "r2", tx: { vm: "svm", serializedTx: "Ag==", submitViaApi: true } }];
      return [200, { recurringOrders: [], page: 1, totalPages: 0 }];
    }) });
    expect((await lh.recurringOrders.create({ wallet: "W1", dstToken: "BONK", amount: "350000000", orders: 7, intervalSeconds: 86400 })).requestId).toBe("r1");
    expect(await lh.recurringOrders.submit("r1", "c2ln")).toEqual({ txHash: "sig1", order: "O1" });
    await lh.recurringOrders.list({ wallet: "W1", status: "history", page: 2 });
    expect((await lh.recurringOrders.cancel("O/1", "W1")).requestId).toBe("r2");
    expect(seen).toEqual([
      'POST http://x/v1/recurring-orders {"wallet":"W1","dstToken":"BONK","amount":"350000000","orders":7,"intervalSeconds":86400}',
      'POST http://x/v1/recurring-orders/submit {"requestId":"r1","signedTransaction":"c2ln"}',
      "GET http://x/v1/recurring-orders?wallet=W1&status=history&page=2 ",
      'POST http://x/v1/recurring-orders/O%2F1/cancel {"wallet":"W1"}',
    ]);
  });

  it("limitOrders: create, submit, get, list, cancel and simulate hit the limit-order routes", async () => {
    const seen: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", channel: "web", fetch: fakeFetch((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      if (url.endsWith("/limit-orders") && init?.method === "POST") {
        return [201, { id: "lo_1", object: "limit_order", status: "built", fees: { ourFeeBps: 30, integratorFeeBps: 0, integrator: null }, tx: { vm: "svm", serializedTx: "AQ==", submitViaApi: true } }];
      }
      if (url.endsWith("/submit")) return [200, { limitOrder: { id: "lo_1", status: "open" }, txHash: "sig1" }];
      if (url.endsWith("/cancel")) return [200, { limitOrder: { id: "lo_1", status: "open" }, tx: { vm: "svm", serializedTx: "Ag==", submitViaApi: true } }];
      if (url.includes("lo_missing")) return [404, { error: { code: "NOT_FOUND", message: "Limit order not found" } }];
      return [200, { id: "lo_1", object: "limit_order", status: "open", fills: [], limitOrders: [], nextCursor: null }];
    }) });
    const lo = await lh.limitOrders.create({ wallet: "W1", srcToken: "SOL", dstToken: "USDC", amount: "1000000000", dstAmount: "250000000", expiresAt: 1792540800 });
    expect(lo.tx).toMatchObject({ vm: "svm", submitViaApi: true });
    expect((await lh.limitOrders.submit("lo_1", "c2ln")).txHash).toBe("sig1");
    await lh.limitOrders.get("lo_1");
    await lh.limitOrders.list({ wallet: "W1", status: "open", limit: 5 });
    await lh.limitOrders.list();
    expect((await lh.limitOrders.cancel("lo_1")).tx?.serializedTx).toBe("Ag==");
    await lh.limitOrders.simulate("lo/1", "partial_fill");
    await expect(lh.limitOrders.get("lo_missing")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(seen).toEqual([
      'POST http://x/v1/limit-orders {"channel":"web","wallet":"W1","srcToken":"SOL","dstToken":"USDC","amount":"1000000000","dstAmount":"250000000","expiresAt":1792540800}',
      'POST http://x/v1/limit-orders/lo_1/submit {"signedTransaction":"c2ln"}',
      "GET http://x/v1/limit-orders/lo_1 ",
      "GET http://x/v1/limit-orders?wallet=W1&status=open&limit=5 ",
      "GET http://x/v1/limit-orders ",
      "POST http://x/v1/limit-orders/lo_1/cancel {}",
      'POST http://x/v1/limit-orders/lo%2F1/simulate {"outcome":"partial_fill"}',
      "GET http://x/v1/limit-orders/lo_missing ",
    ]);
    // partner options flow into create; chain is sent as a string
    const bodies: string[] = [];
    const partner = new LayerHop({ baseUrl: "http://x", apiKey: "k", integrator: "myapp", integratorFeeBps: 15, fetch: fakeFetch((_u, init) => {
      bodies.push(String(init?.body));
      return [201, { id: "lo_2" }];
    }) });
    await partner.limitOrders.create({ wallet: "W", srcToken: "USDC", dstToken: "SOL", amount: "10", dstAmount: "1", chain: 7565164 });
    expect(JSON.parse(bodies[0]!)).toEqual({ channel: "api", integrator: "myapp", integratorFeeBps: 15, wallet: "W", srcToken: "USDC", dstToken: "SOL", amount: "10", dstAmount: "1", chain: "7565164" });
  });

  it("depositAddresses: create, get, list, refresh, disable and simulate hit the deposit-address routes", async () => {
    const seen: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "lh_test_k", fetch: fakeFetch((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      if (url.includes("da_off")) return [409, { error: { code: "CONFLICT", message: "This deposit address is disabled" } }];
      if (url.endsWith("/simulate")) return [201, { order: { quoteId: "dep_1", status: "submitted", depositAddressId: "da_1", livemode: false } }];
      if (url.endsWith("/deposit-addresses") && init?.method === "POST") {
        return [201, { id: "da_1", object: "deposit_address", address: "0xabc", reusable: true, estimate: { amount: "100000000", dstAmount: "99780000", dstAmountMin: "99280000", estimatedSeconds: 12 } }];
      }
      return [200, { id: "da_1", object: "deposit_address", status: "active", deposits: [], depositAddresses: [], nextCursor: null }];
    }) });
    const da = await lh.depositAddresses.create({
      srcChain: "base", srcToken: "USDC", dstChain: "arbitrum", dstToken: "USDC",
      recipient: "0x2", refundTo: "0x3", label: "user-1", integratorFeeBps: 25,
    });
    expect(da.address).toBe("0xabc");
    expect(da.estimate.dstAmount).toBe("99780000");
    await lh.depositAddresses.get("da_1");
    await lh.depositAddresses.list({ status: "active", label: "user-1", limit: 10 });
    await lh.depositAddresses.list();
    await lh.depositAddresses.refresh("da_1");
    await lh.depositAddresses.disable("da/1");
    const order = await lh.depositAddresses.simulate("da_1", { amount: "25000000" });
    expect(order).toMatchObject({ quoteId: "dep_1", depositAddressId: "da_1" });
    await expect(lh.depositAddresses.refresh("da_off")).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    // Client-level partner options apply to create unless overridden.
    const bodies: string[] = [];
    const partner = new LayerHop({ baseUrl: "http://x", apiKey: "k", integrator: "myapp", integratorFeeBps: 30, fetch: fakeFetch((_u, init) => {
      bodies.push(String(init?.body));
      return [201, { id: "da_2" }];
    }) });
    await partner.depositAddresses.create({ srcChain: 8453, srcToken: "USDC", dstChain: "solana", dstToken: "SOL", recipient: "So1", refundTo: "0x3" });
    await partner.depositAddresses.create({ srcChain: 8453, srcToken: "USDC", dstChain: "solana", dstToken: "SOL", recipient: "So1", refundTo: "0x3", integratorFeeBps: 0 });
    expect(bodies.map((b) => JSON.parse(b))).toEqual([
      { integrator: "myapp", integratorFeeBps: 30, srcChain: 8453, srcToken: "USDC", dstChain: "solana", dstToken: "SOL", recipient: "So1", refundTo: "0x3" },
      { integrator: "myapp", integratorFeeBps: 0, srcChain: 8453, srcToken: "USDC", dstChain: "solana", dstToken: "SOL", recipient: "So1", refundTo: "0x3" },
    ]);
    expect(seen.slice(0, 7)).toEqual([
      'POST http://x/v1/deposit-addresses {"integratorFeeBps":25,"srcChain":"base","srcToken":"USDC","dstChain":"arbitrum","dstToken":"USDC","recipient":"0x2","refundTo":"0x3","label":"user-1"}',
      "GET http://x/v1/deposit-addresses/da_1 ",
      "GET http://x/v1/deposit-addresses?status=active&label=user-1&limit=10 ",
      "GET http://x/v1/deposit-addresses ",
      "POST http://x/v1/deposit-addresses/da_1/refresh {}",
      "POST http://x/v1/deposit-addresses/da%2F1/disable {}",
      'POST http://x/v1/deposit-addresses/da_1/simulate {"amount":"25000000"}',
    ]);
  });

  it("checkout.refunds: create posts the options, list unwraps refunds; conflicts are typed", async () => {
    const seen: string[] = [];
    const refund = { id: "re_1", object: "refund", sessionId: "cs_1", status: "pending", amount: "1000000", quoteId: "q_r" };
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "k", fetch: fakeFetch((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      if (url.includes("cs_done")) return [409, { error: { code: "CONFLICT", message: "Nothing left to refund on this session" } }];
      if (init?.method === "POST") return [201, { refund, quote: { quoteId: "q_r", from: "0x2" }, next: "build, sign, report" }];
      return [200, { refunds: [refund] }];
    }) });
    const r = await lh.checkout.refunds.create("cs_1", { amount: "1000000", reason: "Customer request", to: "settlement" });
    expect(r.refund.quoteId).toBe("q_r");
    expect(r.quote.from).toBe("0x2");
    await lh.checkout.refunds.create("cs_1");
    expect(await lh.checkout.refunds.list("cs_1")).toEqual([refund]);
    await expect(lh.checkout.refunds.create("cs_done")).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(seen.slice(0, 3)).toEqual([
      'POST http://x/v1/checkout/sessions/cs_1/refunds {"amount":"1000000","reason":"Customer request","to":"settlement"}',
      "POST http://x/v1/checkout/sessions/cs_1/refunds {}",
      "GET http://x/v1/checkout/sessions/cs_1/refunds ",
    ]);
  });

  it("serviceStatus() reads /v1/status; status() the provider order status", async () => {
    const urls: string[] = [];
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url) => {
      urls.push(url);
      if (url.endsWith("/v1/status")) return [200, { status: "operational", updatedAt: "2026-10-18T10:00:00.000Z", components: [{ id: "api", name: "API", group: "Core", status: "operational", latencyMs: 41, uptime90d: 99.98, days: [] }], incidents: [], url: "https://layerhop.com/status" }];
      return [200, { provider: "mock", id: "1", state: "filled" }];
    }) });
    const s = await lh.serviceStatus();
    expect(s.status).toBe("operational");
    expect(s.components[0]!.uptime90d).toBe(99.98);
    const o = await lh.status("mock", "1");
    expect(o.state).toBe("filled");
    expect(urls).toEqual(["http://x/v1/status", "http://x/v1/orders/mock/1"]);
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

  it("gasless: quote param, typed data from /orders, signatures to /orders/gasless, status", async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    const typed = { types: { Permit: [] }, domain: {}, message: {}, primaryType: "Permit" };
    const gasless = { chainId: 8453, approval: { type: "permit", eip712: typed }, trade: { type: "settler_metatransaction", eip712: typed }, gasFee: { amount: "42000", token: "0xusdc" } };
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url, init) => {
      seen.push({ url, method: init?.method, body: init?.body ? String(init.body) : undefined });
      if (url.includes("/v1/quote?")) return [200, { best: { quoteId: "q_1", gasless: { approval: true, gasFee: gasless.gasFee } }, quotes: [], errors: [] }];
      if (url.endsWith("/v1/orders")) return [200, { quoteId: "q_1", provider: "zerox", gasless }];
      if (url.endsWith("/v1/orders/gasless")) return [200, { quoteId: "q_1", provider: "zerox", orderId: "0xtrade", state: "pending" }];
      return [200, { quoteId: "q_1", provider: "zerox", orderId: "0xtrade", state: "filled", srcTxHash: "0xtx" }];
    }) });
    const q = await lh.quote({ srcChain: "base", srcToken: "USDC", amount: "1", dstChain: "base", dstToken: "ETH", sender: "a", recipient: "a", gasless: true });
    expect(new URL(seen[0]!.url).searchParams.get("gasless")).toBe("true");
    expect(q.best.gasless?.approval).toBe(true);
    expect(await lh.buildGasless("q_1")).toEqual(gasless);
    const sub = await lh.submitGasless("q_1", { trade: "0xsig", approval: "0xsig2" });
    expect(sub.orderId).toBe("0xtrade");
    expect(seen[2]).toEqual({ url: "http://x/v1/orders/gasless", method: "POST", body: JSON.stringify({ quoteId: "q_1", signatures: { trade: "0xsig", approval: "0xsig2" } }) });
    expect((await lh.gaslessStatus("q_1")).srcTxHash).toBe("0xtx");
    expect(seen[3]!.url).toBe("http://x/v1/orders/gasless/q_1");
  });

  it("buildGasless refuses a quote that is not gasless", async () => {
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch(() => [200, { quoteId: "q_1", provider: "relay", tx: { vm: "evm" } }]) });
    await expect(lh.buildGasless("q_1")).rejects.toThrow(/not gasless/);
  });

  it("buildTx refuses a gasless quote and returns Tron txs as built", async () => {
    const gaslessLh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch(() => [200, { quoteId: "q_1", provider: "zerox", gasless: { chainId: 8453, trade: {} } }]) });
    await expect(gaslessLh.buildTx("q_1")).rejects.toThrow(/gasless; use buildGasless/);
    const call = { to: "TXYZ", data: "0x01", value: "0", feeLimit: "150000000" };
    const tron = { vm: "tvm", chainId: 728126428, from: "TABC", call, unsigned: { txID: "a".repeat(64), raw_data_hex: "0a", raw_data: { expiration: 1 } }, approval: { token: "TUSDT", spender: "TXYZ", amount: "5", call } };
    const tronLh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch(() => [200, { quoteId: "q_2", provider: "relay", tx: tron }]) });
    const tx = await tronLh.buildTx("q_2");
    expect(tx.vm).toBe("tvm");
    if (tx.vm === "tvm") expect(tx.unsigned?.txID).toHaveLength(64);
  });

  it("getTokenRisk reads the risk report", async () => {
    const urls: string[] = [];
    const risk = { chainId: 8453, address: "0x1111111111111111111111111111111111111111", level: "danger", verified: false, symbol: "USDC", reasons: [{ code: "fake_symbol", level: "danger", message: "x" }], source: "goplus", checkedAt: "2026-10-27T09:00:00.000Z" };
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url) => {
      urls.push(url);
      return [200, { risk }];
    }) });
    expect(await lh.getTokenRisk("base", risk.address)).toEqual(risk);
    expect(urls[0]).toBe(`http://x/v1/tokens/base/${risk.address}/risk`);
  });

  it("splits, tip jars and payouts hit their routes; updateSplit sends the edit secret", async () => {
    const seen: { url: string; method?: string; body?: string; edit?: string }[] = [];
    const split = { id: "spl_1", url: "u", status: "open", note: null, recipient: "0x1", recipientName: null, chainId: 8453, chain: "base", token: { address: "0xusdc", symbol: "USDC", decimals: 6 }, total: "100", collected: "0", paidCount: 0, shares: [], createdAt: "t", updatedAt: "t" };
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch((url, init) => {
      seen.push({ url, method: init?.method, body: init?.body ? String(init.body) : undefined, edit: (init?.headers as Record<string, string>)["x-edit-token"] });
      if (url.endsWith("/v1/splits")) return [201, { ...split, editToken: "sec", editUrl: "u#k=sec" }];
      if (url.includes("/v1/splits/")) return [200, split];
      if (url.includes("/v1/tip-jars/")) return [200, { address: "0x1", tippers: 2, tips: 3, messages: [] }];
      if (url.endsWith("/v1/payouts/plan")) return [200, { rows: [], transfers: [], routes: [], valid: 0, invalid: 0 }];
      return [200, { vm: "evm", chainId: 8453, token: { chainId: 8453, address: "0xusdc", symbol: "USDC", decimals: 6 }, calls: [] }];
    }) });
    const created = await lh.createSplit({ recipient: "alice.eth", chain: "base", token: "USDC", total: "100", participants: 2, note: "Dinner" });
    expect(created.editToken).toBe("sec");
    expect(seen[0]).toMatchObject({ url: "http://x/v1/splits", method: "POST", body: JSON.stringify({ recipient: "alice.eth", chain: "base", token: "USDC", total: "100", participants: 2, note: "Dinner" }) });
    expect((await lh.getSplit("spl_1")).id).toBe("spl_1");
    expect(seen[1]).toMatchObject({ url: "http://x/v1/splits/spl_1", method: undefined });
    await lh.updateSplit("spl_1", "sec", { note: null, status: "closed" });
    expect(seen[2]).toMatchObject({ url: "http://x/v1/splits/spl_1", method: "PATCH", body: JSON.stringify({ note: null, status: "closed" }), edit: "sec" });
    expect((await lh.getTipJar("0x1")).tippers).toBe(2);
    expect(seen[3]!.url).toBe("http://x/v1/tip-jars/0x1");
    await lh.planPayouts({ srcChain: "base", srcToken: "USDC", sender: "0xa", csv: "alice.eth,25,USDC,base" });
    expect(seen[4]).toMatchObject({ url: "http://x/v1/payouts/plan", method: "POST", body: JSON.stringify({ srcChain: "base", srcToken: "USDC", sender: "0xa", csv: "alice.eth,25,USDC,base" }) });
    const batch = await lh.buildPayoutTransfers({ chain: "base", token: "USDC", sender: "0xa", transfers: [{ recipient: "0xb", amount: "25000000" }] });
    expect(batch.vm).toBe("evm");
    expect(seen[5]).toMatchObject({ url: "http://x/v1/payouts/transfers", method: "POST" });
  });

  it("NO_ROUTE details carry suggestions (parseRouteSuggestions drops malformed ones)", async () => {
    const good = { kind: "dst_token", message: "Receive USDC instead", srcChain: 8453, srcToken: "0xa", amount: "100", dstChain: 1, dstToken: "0xusdc", dstAmount: "99" };
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fakeFetch(() => [400, { error: { code: "NO_ROUTE", message: "no route", details: { errors: [], suggestions: [good, { kind: "via_hub", message: "x", srcChain: 1, srcToken: "a", amount: "1", dstChain: 2, dstToken: "b" }] } } }]) });
    const err = await lh.quote({ srcChain: "base", srcToken: "USDC", amount: "100", dstChain: "ethereum", dstToken: "PEPE", sender: "a", recipient: "a" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LayerHopApiError);
    const { parseRouteSuggestions } = await import("./index.js");
    expect(parseRouteSuggestions((err as LayerHopApiError).details)).toEqual([good]);
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
    expect(urls[0]!.searchParams.get("chain")).toBe("base");
    expect(await lh.prices(["8453:0xa", { chainId: 7565164, address: "So1" }])).toEqual({ "8453:0xa": 1 });
    expect(urls[1]!.searchParams.get("ids")).toBe("8453:0xa,7565164:So1");
    expect(await lh.prices([])).toEqual({});
    expect(urls).toHaveLength(2);
    // Chain-less: the API finds the chain.
    await lh.lookupToken("0xb");
    await lh.lookupToken(undefined, "0xc");
    expect(urls.slice(2).map((u) => [u.searchParams.has("chain"), u.searchParams.get("address")])).toEqual([[false, "0xb"], [false, "0xc"]]);
  });

  it("balances() sends chains only when given", async () => {
    const { lh, urls } = capture({ address: "0xabc", vm: "evm", balances: [], totalUsd: 0, errors: [] });
    await lh.balances("0xabc");
    expect(urls[0]!.searchParams.has("chains")).toBe(false);
    await lh.balances("0xabc", ["base", 80094]);
    expect(urls[1]!.searchParams.get("chains")).toBe("base,80094");
    expect(urls[1]!.searchParams.has("tokens")).toBe(false);
    expect(urls[1]!.searchParams.has("fresh")).toBe(false);
  });

  it("balances() sends requested tokens and fresh", async () => {
    const { lh, urls } = capture({ address: "0xabc", vm: "evm", balances: [], totalUsd: 0, errors: [] });
    await lh.balances("0xabc", undefined, { tokens: ["80094:0x59a6", { chainId: 8453, address: "0xa" }], fresh: true });
    expect(urls[0]!.searchParams.has("chains")).toBe(false);
    expect(urls[0]!.searchParams.get("tokens")).toBe("80094:0x59a6,8453:0xa");
    expect(urls[0]!.searchParams.get("fresh")).toBe("1");
  });
});

describe("webhooks", () => {
  it("verifyWebhookSignature and constructWebhookEvent accept a valid signature and reject tampering", async () => {
    const { signWebhookPayload } = await import("@layerhop/shared");
    const { verifyWebhookSignature, constructWebhookEvent, WebhookSignatureError, WEBHOOK_SIGNATURE_HEADER } = await import("./index.js");
    const secret = "whsec_test";
    const body = JSON.stringify({ id: "evt_1", type: "order.filled", createdAt: "2026-10-19T10:00:00.000Z", data: { order: { quoteId: "q_1" } } });
    const header = await signWebhookPayload(secret, body);
    expect(WEBHOOK_SIGNATURE_HEADER).toBe("LayerHop-Signature");
    expect(await verifyWebhookSignature(secret, header, body)).toBe(true);
    expect(await verifyWebhookSignature(secret, header, body.replace("q_1", "q_2"))).toBe(false);
    expect(await verifyWebhookSignature("other", header, body)).toBe(false);
    const evt = await constructWebhookEvent(secret, header, body);
    expect(evt.type).toBe("order.filled");
    await expect(constructWebhookEvent(secret, undefined, body)).rejects.toBeInstanceOf(WebhookSignatureError);
    const old = await signWebhookPayload(secret, body, Math.floor(Date.now() / 1000) - 3600);
    await expect(constructWebhookEvent(secret, old, body)).rejects.toThrow("Invalid LayerHop webhook signature");
  });
});
