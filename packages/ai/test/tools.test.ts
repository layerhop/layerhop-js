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
    expect(d.best.fees.layerhop).toEqual({ bps: 20, percent: "0.2%", amount: "0.2 USDC" });
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
