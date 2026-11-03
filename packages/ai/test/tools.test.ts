import { describe, expect, it } from "vitest";
import { createLayerHopTools, encodeApprove, TOOL_NAMES, toJsonSchema, toTransactionRequests, zodV3Schemas, API_KEY_MISSING } from "../src/index.js";
import { API, BASE_USDC, EVM, fakeApi, quoteArgs, ROUTER, SOL, SPENDER, TEST_KEY, TX_HASH } from "./fake-api.js";

const make = (api = fakeApi(), over: Parameters<typeof createLayerHopTools>[0] = {}) =>
  createLayerHopTools({ apiUrl: API, fetch: api.fetch, integrator: "myagent", integratorFeeBps: 25, ...over });

describe("tool definitions", () => {
  it("exposes every tool with schema, safety text and annotations", () => {
    const set = make();
    expect(set.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "list_chains",
        "list_tokens",
        "get_prices",
        "get_quote",
        "build_transaction",
        "simulate_transaction",
        "report_submitted",
        "get_order_status",
        "get_swap_link",
        "create_deposit_address",
        "get_deposit_address",
        "create_checkout_session",
      ]),
    );
    expect(set.byName.get_quote!.description).toMatch(/hold no private keys and never sign/);
    expect(set.byName.build_transaction!.description).toMatch(/UNSIGNED/);
    expect(set.byName.list_chains!.annotations.readOnlyHint).toBe(true);
    expect(set.byName.create_deposit_address!.description).toMatch(/never an exchange/);
    expect(JSON.stringify(toJsonSchema(set.byName.get_quote!))).toMatch(/HUMAN units/);
  });

  it("filters and renames tools, and the descriptions follow the new names", () => {
    const set = make(fakeApi(), { tools: ["get_quote", "build_transaction"], toolName: (n) => `layerhop_${n}` });
    expect(set.tools.map((t) => t.name)).toEqual(["layerhop_get_quote", "layerhop_build_transaction"]);
    expect(set.byName.build_transaction!.description).toContain("layerhop_get_quote");
  });

  it("rejects a bad integrator id", () => {
    expect(() => createLayerHopTools({ integrator: "Not Valid!" })).toThrow(/integrator/);
  });

  it("builds the same schemas with zod v3 for AgentKit / GOAT", () => {
    const v3 = zodV3Schemas();
    expect(v3.get_quote.safeParse(quoteArgs).success).toBe(true);
    expect(v3.build_transaction.safeParse({ quoteId: "nope" }).success).toBe(false);
  });
});

describe("get_quote", () => {
  it("converts human amounts, sends channel api + integrator + integratorFeeBps, and formats fees", async () => {
    const api = fakeApi();
    const r = await make(api).byName.get_quote!.run(quoteArgs);
    expect(r.ok).toBe(true);
    const q = api.last("/v1/quote")!.url.searchParams;
    expect(q.get("amount")).toBe("100000000");
    expect(q.get("srcToken")).toBe(BASE_USDC);
    expect(q.get("dstChain")).toBe("7565164");
    expect(q.get("channel")).toBe("api");
    expect(q.get("integrator")).toBe("myagent");
    expect(q.get("integratorFeeBps")).toBe("25");
    const d = (r as { data: any }).data;
    expect(d.best.youReceive).toMatchObject({ amount: "0.949742908", token: "SOL" });
    expect(d.best.fees.layerhop).toEqual({ bps: 10, percent: "0.1%", amount: "0.1 USDC" });
    expect(d.swapLink).toContain("integrator=myagent");
  });

  it("asks for the recipient on EVM -> Solana and validates addresses", async () => {
    const set = make();
    const r = await set.byName.get_quote!.run({ ...quoteArgs, recipient: undefined });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/recipient is required/) });
    const bad = await set.byName.get_quote!.run({ ...quoteArgs, sender: "0x123" });
    expect(bad.ok).toBe(false);
  });

  it("maps schema errors to a readable message", async () => {
    const r = await make().byName.get_quote!.run({ fromChain: "base" });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/^Invalid input for get_quote: /);
  });

  it("formats API errors with the code and docs link", async () => {
    const api = fakeApi([(c) => (c.url.pathname === "/v1/quote" ? { status: 422, body: { error: { code: "NO_ROUTE", message: "No route", requestId: "req_1" } } } : undefined)]);
    const r = await make(api).byName.get_quote!.run(quoteArgs);
    expect((r as { error: string }).error).toBe("LayerHop API error NO_ROUTE (HTTP 422): No route [requestId req_1]. See https://docs.layerhop.com/errors/NO_ROUTE");
  });
});

describe("build / simulate / report / status", () => {
  it("returns the unsigned tx with ordered transaction requests (approval first); never signs", async () => {
    const api = fakeApi();
    const set = make(api);
    await set.byName.get_quote!.run(quoteArgs);
    const r = await set.byName.build_transaction!.run({ quoteId: "q_best" });
    expect(r.ok).toBe(true);
    const d = (r as { data: any }).data;
    expect(d.unsignedTransaction).toMatchObject({ vm: "evm", chainId: 8453, to: ROUTER });
    expect(d.signing.notice).toMatch(/UNSIGNED.*LayerHop holds no keys and never signs/);
    expect(d.transactionRequests.map((x: any) => x.kind)).toEqual(["approval", "swap"]);
    expect(d.transactionRequests[0]).toMatchObject({ to: BASE_USDC, value: "0", data: encodeApprove(SPENDER, "100000000") });
    expect(d.swap).toMatch(/100 USDC on Base -> SOL on Solana/);
    // Only read calls and the order build: nothing is ever sent for signing or broadcast.
    expect(api.calls.some((c) => c.url.pathname === "/v1/orders/submit")).toBe(false);
  });

  it("simulates, reports and tracks", async () => {
    const set = make();
    const sim = (await set.byName.simulate_transaction!.run({ quoteId: "q_best" })) as { data: any };
    expect(sim.data.summary).toMatch(/Simulation succeeded, estimated gas 210000. An ERC-20 approval is still needed/);
    const rep = (await set.byName.report_submitted!.run({ quoteId: "q_best", txHash: TX_HASH })) as { data: any };
    expect(rep.data).toMatchObject({ quoteId: "q_best", status: "submitted" });
    const bad = await set.byName.report_submitted!.run({ quoteId: "q_best", txHash: "nope" });
    expect(bad.ok).toBe(false);
    const st = (await set.byName.get_order_status!.run({ provider: "relay", txHash: TX_HASH })) as { data: any };
    expect(st.data).toMatchObject({ state: "filled", meaning: expect.stringMatching(/delivered/) });
  });
});

describe("tokens, prices, links", () => {
  it("lists built-in tokens, searches, and prices tokens", async () => {
    const api = fakeApi();
    const set = make(api);
    const list = (await set.byName.list_tokens!.run({ chain: "base" })) as { data: any };
    expect(list.data.tokens.some((t: any) => t.symbol === "USDC")).toBe(true);
    const search = (await set.byName.list_tokens!.run({ chain: 8453, query: "usd" })) as { data: any };
    expect(api.last("/v1/tokens")!.url.searchParams.get("q")).toBe("usd");
    expect(search.data.tokens[0]).toHaveProperty("verified");
    const prices = (await set.byName.get_prices!.run({ tokens: [{ chain: "base", token: "USDC" }, { chain: "solana", token: "SOL" }] })) as { data: any };
    expect(prices.data.prices[0]).toMatchObject({ symbol: "USDC", priceUsd: 1.0001 });
    expect(prices.data.prices[1].priceUsd).toBeNull();
  });

  it("makes a swap link with the integrator", async () => {
    const r = (await make().byName.get_swap_link!.run({ fromChain: "base", fromToken: "USDC", toChain: "solana", toToken: "SOL", amount: "5", recipient: SOL })) as { data: any };
    expect(r.data.url).toMatch(/^https:\/\/layerhop\.com\/swap\?/);
    expect(r.data.url).toContain("integrator=myagent");
  });
});

describe("API-key tools", () => {
  it("explain how to add a key when none is configured", async () => {
    const r = await make().byName.create_checkout_session!.run({ amount: "49", settleChain: "base", settleToken: "USDC", recipient: EVM });
    expect(r).toEqual({ ok: false, error: API_KEY_MISSING });
  });

  it("creates a checkout session in base units with the key header", async () => {
    const api = fakeApi();
    const r = (await make(api, { apiKey: TEST_KEY }).byName.create_checkout_session!.run({ amount: "49", settleChain: "base", settleToken: "USDC", recipient: EVM })) as {
      data: any;
    };
    const call = api.last("/v1/checkout/sessions")!;
    expect(call.body).toMatchObject({ amount: "49000000", settleChain: 8453, settleToken: BASE_USDC, recipient: EVM });
    expect(call.headers["x-api-key"]).toBe(TEST_KEY);
    expect(r.data).toMatchObject({ url: "https://pay.layerhop.com/c/cs_test1", amount: "49 USDC", mode: "test" });
  });

  it("creates a deposit address and relays the safety rules", async () => {
    const api = fakeApi();
    const r = (await make(api, { apiKey: TEST_KEY }).byName.create_deposit_address!.run({
      fromChain: "base",
      fromToken: "USDC",
      toChain: "arbitrum",
      toToken: "USDC",
      recipient: EVM,
      refundTo: EVM,
      amount: "25",
    })) as { data: any };
    expect(api.last("/v1/deposit-addresses")!.body).toMatchObject({ srcChain: 8453, dstChain: 42161, amount: "25000000" });
    expect(r.data.summary).toMatch(/^TEST MODE/);
    expect(r.data.tellTheUser.join(" ")).toMatch(/Send ONLY USDC on Base/);
  });
});

describe("transaction requests", () => {
  it("encodes approve calldata", () => {
    expect(encodeApprove(SPENDER, 1n)).toBe(`0x095ea7b3${"0".repeat(24)}${"22".repeat(20)}${"0".repeat(63)}1`);
  });

  it("handles Solana and extra calls", () => {
    expect(toTransactionRequests({ vm: "svm", serializedTx: "AQID", submitViaApi: true })).toEqual([
      expect.objectContaining({ vm: "svm", serializedTx: "AQID", submitViaApi: true }),
    ]);
    const evm = toTransactionRequests({ vm: "evm", chainId: 1, to: ROUTER, data: "0x", value: "1", extraTxs: [{ to: SPENDER, data: "0x01", value: "0" }] });
    expect(evm.map((x) => x.kind)).toEqual(["swap", "extra"]);
  });
});

describe("quote help, gasless, token lookup / risk, limit orders", () => {
  const ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const noRoute = (details: Record<string, unknown>, code = "NO_ROUTE") =>
    fakeApi([(c) => (c.url.pathname === "/v1/quote" ? { status: 422, body: { error: { code, message: "No route", details } } } : undefined)]);

  it("lists NO_ROUTE suggestions in human units (via_hub as two steps), dropping malformed ones", async () => {
    const leg = { srcChain: 8453, srcToken: BASE_USDC, amount: "100000000", dstChain: 1, dstToken: ETH_USDC, dstAmount: "99500000" };
    const api = noRoute({
      suggestions: [
        { ...leg, kind: "dst_token", message: "Receive USDC on Ethereum instead", symbol: "USDC" },
        { ...leg, kind: "via_hub", message: "Go through Base USDC", hub: { chainId: 8453, token: BASE_USDC, symbol: "USDC", decimals: 6 }, steps: [leg, { ...leg, srcChain: 1, srcToken: ETH_USDC }] },
        { kind: "via_hub", message: "broken", srcChain: 1 },
      ],
    });
    const r = (await make(api).byName.get_quote!.run(quoteArgs)) as { ok: false; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^LayerHop API error NO_ROUTE/);
    expect(r.error).toContain("1. Receive USDC on Ethereum instead [dst_token]: 100 USDC on Base -> ~99.5 USDC on Ethereum");
    expect(r.error).toMatch(/2\. Go through Base USDC \[via_hub: TWO separate swaps.*step 1: .*step 2: /);
    expect(r.error).not.toContain("broken");
  });

  it("states the route minimum on AMOUNT_TOO_SMALL", async () => {
    const api = noRoute({ minAmount: "25000000", minAmountUsd: 25, minAmountApprox: true }, "AMOUNT_TOO_SMALL");
    const r = (await make(api).byName.get_quote!.run(quoteArgs)) as { error: string };
    expect(r.error).toContain("The smallest amount that quotes on this route is at most 25 USDC (about $25.00)");
  });

  it("sends gasless and returns the typed data with a clear can't-sign notice instead of a tx", async () => {
    const typed = { types: {}, domain: {}, message: {}, primaryType: "Trade" };
    const api = fakeApi([
      (c) =>
        c.url.pathname === "/v1/orders"
          ? { body: { quoteId: "q_best", provider: "zerox", gasless: { chainId: 8453, trade: { type: "settler_metatransaction", eip712: typed }, gasFee: { amount: "42000", token: BASE_USDC } } } }
          : undefined,
    ]);
    const set = make(api);
    await set.byName.get_quote!.run({ fromChain: "base", fromToken: "USDC", amount: "100", toChain: "base", toToken: "ETH", sender: EVM, gasless: true });
    expect(api.last("/v1/quote")!.url.searchParams.get("gasless")).toBe("true");
    const r = (await set.byName.build_transaction!.run({ quoteId: "q_best" })) as { data: any };
    expect(r.data.gasless).toBe(true);
    expect(r.data.networkFeeTakenFromInput).toBe("0.042 USDC");
    expect(r.data.signing.notice).toMatch(/cannot sign typed data for the user/);
    expect(r.data.unsignedTransaction).toBeUndefined();
  });

  it("looks up a token without a chain and checks its risk", async () => {
    const risk = { chainId: 8453, address: BASE_USDC, level: "danger", verified: false, symbol: "USDC", reasons: [{ code: "sell_tax", level: "danger", value: 25, message: "25% is taken on every sell." }], source: "goplus", checkedAt: "2026-10-27T09:00:00.000Z" };
    const api = fakeApi([
      (c) => (c.url.pathname === "/v1/tokens/lookup" ? { body: { token: { chainId: 8453, address: BASE_USDC, symbol: "USDC", name: "USD Coin", decimals: 6, verified: false } } } : undefined),
      (c) => (c.url.pathname.endsWith("/risk") ? { body: { risk } } : undefined),
    ]);
    const set = make(api);
    const l = (await set.byName.lookup_token!.run({ address: BASE_USDC })) as { data: any };
    expect(api.last("/v1/tokens/lookup")!.url.searchParams.has("chain")).toBe(false);
    expect(l.data.token).toMatchObject({ symbol: "USDC", chain: "Base" });
    expect(l.data.note).toMatch(/verified false/);
    const k = (await set.byName.get_token_risk!.run({ chain: "base", token: "USDC" })) as { data: any };
    expect(api.last(`/v1/tokens/8453/${BASE_USDC}/risk`)).toBeDefined();
    expect(k.data).toMatchObject({ level: "danger", chain: "Base" });
    expect(k.data.tellTheUser).toMatch(/explicit confirmation/);
  });

  it("lists and gets limit orders with human amounts", async () => {
    const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const WSOL = "So11111111111111111111111111111111111111112";
    const order = {
      id: "lo_1", object: "limit_order", livemode: true, status: "open", statusDetail: null, provider: "jupiter", chainId: 7565164, wallet: SOL, srcToken: SOL_USDC, dstToken: WSOL,
      amount: "50000000", dstAmount: "500000000", expiresAt: null, fees: { ourFeeBps: 10, integratorFeeBps: 0, integrator: null }, providerOrderId: "p", filledAmount: "0", filledDstAmount: "0",
      fillCount: 0, openTxHash: null, cancelTxHash: null, channel: "api", metadata: null, createdAt: "t", updatedAt: "t",
    };
    const api = fakeApi([
      (c) => (c.url.pathname === "/v1/limit-orders" ? { body: { limitOrders: [order], nextCursor: null } } : undefined),
      (c) => (c.url.pathname === "/v1/limit-orders/lo_1" ? { body: { ...order, fills: [] } } : undefined),
    ]);
    const set = make(api);
    const l = (await set.byName.list_limit_orders!.run({ wallet: SOL })) as { data: any };
    expect(api.last("/v1/limit-orders")!.url.searchParams.get("wallet")).toBe(SOL);
    expect(l.data.limitOrders[0]).toMatchObject({ id: "lo_1", sell: "50 USDC", forAtLeast: "0.5 SOL" });
    const g = (await set.byName.get_limit_order!.run({ id: "lo_1" })) as { data: any };
    expect(g.data.limitOrder.status).toBe("open");
    const noKey = await set.byName.list_limit_orders!.run({});
    expect(noKey.ok).toBe(false);
  });
});
