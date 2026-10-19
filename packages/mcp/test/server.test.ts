import { describe, expect, it } from "vitest";
import { API, connect, data, EVM, mockApi, SOL, text } from "./helpers.js";

const quoteArgs = { fromChain: "base", fromToken: "USDC", amount: "100", toChain: "solana", toToken: "SOL", sender: EVM, recipient: SOL };

describe("tool listing", () => {
  it("exposes the documented tools with safety language", async () => {
    const { client } = await connect(mockApi().fetch);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "build_transaction",
        "create_deposit_address",
        "disable_deposit_address",
        "get_deposit_address",
        "get_order_status",
        "get_quote",
        "get_swap_link",
        "list_chains",
        "list_deposit_addresses",
        "list_orders",
        "list_tokens",
        "refresh_deposit_address",
        "report_submitted",
        "simulate_deposit",
        "simulate_transaction",
      ].sort(),
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.build_transaction!.description).toMatch(/never signs/);
    expect(byName.get_quote!.description).toMatch(/holds no private keys/);
    expect(JSON.stringify(byName.get_quote!.inputSchema)).toMatch(/HUMAN units/);
    expect(byName.list_chains!.annotations?.readOnlyHint).toBe(true);
  });
});

describe("get_quote", () => {
  it("converts the human amount to base units and formats the response", async () => {
    const api = mockApi();
    const { call } = await connect(api.fetch, { integrator: "myapp" });
    const r = data(await call("get_quote", quoteArgs));

    const q = api.calls.find((c) => c.url.pathname === "/v1/quote")!.url.searchParams;
    expect(q.get("amount")).toBe("100000000");
    expect(q.get("srcChain")).toBe("8453");
    expect(q.get("srcToken")).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(q.get("dstChain")).toBe("7565164");
    expect(q.get("channel")).toBe("api");
    expect(q.get("integrator")).toBe("myapp");
    expect(q.get("slippageBps")).toBe("50");

    expect(r.best.quoteId).toBe("q_best");
    expect(r.best.youReceive).toMatchObject({ amount: "0.949742908", minimumAfterSlippage: "0.944994194", token: "SOL", amountBaseUnits: "949742908" });
    expect(r.best.fees.layerhop).toEqual({ bps: 20, percent: "0.2%", amount: "0.2 USDC" });
    expect(r.best.fees.providerUsd).toBe(0.12);
    expect(r.best.estimatedTime).toBe("~2 min");
    expect(r.best.expiresInSeconds).toBeGreaterThan(0);
    expect(r.alternatives).toHaveLength(1);
    expect(r.alternatives[0].provider).toBe("lifi");
    expect(r.summary).toMatch(/send 100 USDC on Base, receive ~0.949742908 SOL on Solana/);
    const link = new URL(r.swapLink);
    expect(link.pathname).toBe("/swap");
    expect(link.searchParams.get("amount")).toBe("100");
    expect(link.searchParams.get("integrator")).toBe("myapp");
  });

  it("shows partner fees when the quote carries them", async () => {
    const best = { quoteId: "q_p", provider: "relay", dstAmount: "1", dstAmountMin: "1", estimatedSeconds: 5, expiresAt: 9e9, fees: { ourFeeBps: 20, integratorFeeBps: 30, integrator: "myapp" } };
    const api = mockApi([(c) => (c.url.pathname === "/v1/quote" ? { body: { best, quotes: [best], errors: [] } } : undefined)]);
    const { call } = await connect(api.fetch);
    const r = data(await call("get_quote", { ...quoteArgs, amount: "1000" }));
    expect(r.best.fees.partner).toEqual({ id: "myapp", bps: 30, percent: "0.3%", amount: "3 USDC" });
  });

  it("defaults recipient to sender on same-VM routes", async () => {
    const api = mockApi();
    const { call } = await connect(api.fetch);
    data(await call("get_quote", { fromChain: "base", fromToken: "ETH", amount: "0.5", toChain: "arbitrum", toToken: "USDC", sender: EVM }));
    const q = api.calls.find((c) => c.url.pathname === "/v1/quote")!.url.searchParams;
    expect(q.get("recipient")).toBe(EVM);
    expect(q.get("amount")).toBe("500000000000000000");
  });

  it.each([
    [{ amount: "0" }, /greater than 0/],
    [{ amount: "-5" }, /Invalid amount/],
    [{ amount: "1.1234567" }, /more than 6 decimal places/],
    [{ sender: SOL }, /sender .* not valid on Base/],
    [{ recipient: EVM }, /recipient .* not valid on Solana/],
    [{ recipient: undefined }, /recipient is required/],
    [{ fromChain: "dogechain" }, /Unknown chain "dogechain"/],
    [{ fromToken: "PEPE" }, /Unknown token "PEPE" on Base/],
    [{ fromToken: "0x1111111111111111111111111111111111111111" }, /decimals are unknown/],
    [{ slippageBps: 0 }, /slippageBps|Input validation/i],
  ])("rejects bad input %j without calling /v1/quote", async (over, msg) => {
    const api = mockApi();
    const { call } = await connect(api.fetch);
    const r = await call("get_quote", { ...quoteArgs, ...over });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(msg);
    expect(api.calls.some((c) => c.url.pathname === "/v1/quote")).toBe(false);
  });

  it("accepts unknown token addresses when decimals are given", async () => {
    const api = mockApi();
    const { call } = await connect(api.fetch);
    data(await call("get_quote", { ...quoteArgs, fromToken: "0x1111111111111111111111111111111111111111", fromTokenDecimals: 18, amount: "2" }));
    const q = api.calls.find((c) => c.url.pathname === "/v1/quote")!.url.searchParams;
    expect(q.get("amount")).toBe("2000000000000000000");
  });

  it("surfaces API errors with code and docs link", async () => {
    const api = mockApi([(c) => (c.url.pathname === "/v1/quote" ? { status: 422, body: { error: { code: "NO_ROUTE", message: "No provider can route this", requestId: "r1" } } } : undefined)]);
    const { call } = await connect(api.fetch);
    const r = await call("get_quote", quoteArgs);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/NO_ROUTE .*No provider can route this.*r1.*docs.layerhop.com\/errors\/NO_ROUTE/);
  });
});

describe("build_transaction", () => {
  it("returns the unsigned EVM tx with approval and signing steps; never signs", async () => {
    const tx = {
      vm: "evm",
      chainId: 8453,
      to: "0x0000000000000000000000000000000000000abc",
      data: "0xdeadbeef",
      value: "0",
      approval: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", spender: "0x0000000000000000000000000000000000000abc", amount: "100000000" },
    };
    const api = mockApi([(c) => (c.url.pathname === "/v1/orders" && c.method === "POST" ? { body: { quoteId: c.body && (c.body as any).quoteId, provider: "relay", tx } } : undefined)]);
    const { call } = await connect(api.fetch);
    data(await call("get_quote", quoteArgs)); // remembers context for q_best
    const r = data(await call("build_transaction", { quoteId: "q_best" }));
    expect(api.calls.find((c) => c.url.pathname === "/v1/orders")!.body).toEqual({ quoteId: "q_best" });
    expect(r.unsignedTransaction).toMatchObject({ vm: "evm", chainId: 8453, chain: "Base", to: tx.to, data: "0xdeadbeef", value: "0" });
    expect(r.unsignedTransaction.approval.amountHuman).toBe("100 USDC");
    expect(r.signing.notice).toMatch(/UNSIGNED.*never signs/);
    expect(r.signing.steps[0]).toMatch(/approval/);
    expect(r.signing.steps.at(-1)).toMatch(/report_submitted/);
    expect(r.swap).toMatch(/100 USDC on Base -> SOL on Solana/);
  });

  it("returns base64 Solana txs and explains submitViaApi", async () => {
    const api = mockApi([(c) => (c.url.pathname === "/v1/orders" ? { body: { quoteId: "q_x", provider: "jupiter", tx: { vm: "svm", serializedTx: "AQID", submitViaApi: true } } } : undefined)]);
    const { call } = await connect(api.fetch);
    const r = data(await call("build_transaction", { quoteId: "q_x" }));
    expect(r.unsignedTransaction).toEqual({ vm: "svm", chain: "Solana", serializedTx: "AQID", encoding: "base64", submitViaApi: true });
    expect(r.signing.steps.join(" ")).toContain(`${API}/v1/orders/submit`);
  });

  it("validates quoteId shape", async () => {
    const { call } = await connect(mockApi().fetch);
    const r = await call("build_transaction", { quoteId: "nope" });
    expect(r.isError).toBe(true);
  });
});

describe("platform endpoints (orders/submitted, simulate, list) with graceful fallback", () => {
  it("simulate_transaction calls /v1/simulate and summarizes", async () => {
    const api = mockApi([(c) => (c.url.pathname === "/v1/simulate" ? { body: { ok: true, vm: "evm", gasEstimate: "210000", needsApproval: true, tx: {} } } : undefined)]);
    const { call } = await connect(api.fetch);
    const r = data(await call("simulate_transaction", { quoteId: "q_best" }));
    expect(api.calls.find((c) => c.url.pathname === "/v1/simulate")!.body).toEqual({ quoteId: "q_best" });
    expect(r).toMatchObject({ ok: true, gasEstimate: "210000", needsApproval: true });
    expect(r.tx).toBeUndefined();
    expect(r.summary).toMatch(/approval is still needed/);
  });

  it("simulate_transaction falls back when the endpoint is missing", async () => {
    const { call } = await connect(mockApi().fetch);
    const r = data(await call("simulate_transaction", { quoteId: "q_best" }));
    expect(r).toMatchObject({ ok: null, available: false });
  });

  it("report_submitted posts the hash and validates it", async () => {
    const hash = `0x${"ab".repeat(32)}`;
    const api = mockApi([(c) => (c.url.pathname === "/v1/orders/q_best/submitted" ? { body: { quoteId: "q_best", status: "submitted" } } : undefined)]);
    const { call } = await connect(api.fetch);
    const r = data(await call("report_submitted", { quoteId: "q_best", txHash: hash }));
    expect(r).toMatchObject({ quoteId: "q_best", status: "submitted" });
    expect(api.calls.find((c) => c.url.pathname.endsWith("/submitted"))!.body).toEqual({ txHash: hash });
    const bad = await call("report_submitted", { quoteId: "q_best", txHash: "0x12" });
    expect(bad.isError).toBe(true);
  });

  it("list_orders queries by address and humanizes known amounts", async () => {
    const order = { quoteId: "q_1", provider: "relay", status: "filled", srcChainId: 8453, srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000", dstChainId: 7565164, dstToken: "So11111111111111111111111111111111111111112", dstAmount: "949742908" };
    const api = mockApi([(c) => (c.url.pathname === "/v1/orders" && c.method === "GET" ? { body: { orders: [order], nextCursor: "c2" } } : undefined)]);
    const { call } = await connect(api.fetch);
    const r = data(await call("list_orders", { address: EVM, status: "filled", limit: 5 }));
    const q = api.calls.find((c) => c.url.pathname === "/v1/orders")!.url.searchParams;
    expect(Object.fromEntries(q)).toEqual({ address: EVM, status: "filled", limit: "5" });
    expect(r.orders[0]).toMatchObject({ amountHuman: "100 USDC", dstAmountHuman: "0.949742908 SOL", srcChain: "Base", dstChain: "Solana" });
    expect(r.nextCursor).toBe("c2");
    expect((await call("list_orders", { address: "not-an-address" })).isError).toBe(true);
  });

  it("get_order_status calls the provider status endpoint", async () => {
    const api = mockApi([(c) => (c.url.pathname.startsWith("/v1/orders/relay/") ? { body: { provider: "relay", id: "0xabc", state: "filled", dstTxHash: SOL } } : undefined)]);
    const { call } = await connect(api.fetch);
    const r = data(await call("get_order_status", { provider: "relay", txHash: "0xabc" }));
    expect(r).toMatchObject({ state: "filled", meaning: expect.stringMatching(/delivered/) });
    expect((await call("get_order_status", { provider: "nope", txHash: "0xabc" })).isError).toBe(true);
  });
});

describe("list tools, swap link, resources, prompt", () => {
  it("list_chains / list_tokens", async () => {
    const { call } = await connect(mockApi().fetch);
    const chains = data(await call("list_chains"));
    expect(chains.chains.find((c: any) => c.slug === "solana")).toMatchObject({ id: 7565164, vm: "svm" });
    const tokens = data(await call("list_tokens", { chain: "solana" }));
    expect(tokens.tokens.map((t: any) => t.symbol)).toEqual(["SOL", "USDC", "USDT"]);
  });

  it("falls back to the built-in registry when the API is down", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const { call } = await connect(down);
    expect(data(await call("list_chains")).chains.length).toBeGreaterThan(3);
  });

  it("get_swap_link validates and builds the deep link", async () => {
    const { call } = await connect(mockApi().fetch);
    const r = data(await call("get_swap_link", { fromChain: "base", fromToken: "USDC", toChain: "solana", toToken: "SOL", amount: "100", recipient: SOL }));
    expect(r.url).toBe(`https://layerhop.com/swap?srcChain=base&srcToken=USDC&dstChain=solana&dstToken=SOL&amount=100&recipient=${SOL}&ref=mcp`);
    expect((await call("get_swap_link", { fromChain: "base", fromToken: "USDC", toChain: "solana", toToken: "SOL", amount: "0" })).isError).toBe(true);
    expect((await call("get_swap_link", { fromChain: "base", fromToken: "USDC", toChain: "solana", toToken: "SOL", recipient: EVM })).isError).toBe(true);
  });

  it("serves resources and the swap_assistant prompt", async () => {
    const api = mockApi([(c) => (c.url.href === "https://docs.test/llms.txt" ? { text: "# LayerHop Docs\n" } : undefined)]);
    const { client } = await connect(api.fetch);
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("layerhop://chains");
    expect(uris).toContain("layerhop://tokens/solana");
    expect(uris).toContain("https://docs.test/llms.txt");
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("layerhop://tokens/{chain}");

    const tok = await client.readResource({ uri: "layerhop://tokens/base" });
    expect(JSON.parse((tok.contents[0] as { text: string }).text).tokens.some((t: any) => t.symbol === "USDC")).toBe(true);
    const llms = await client.readResource({ uri: "https://docs.test/llms.txt" });
    expect((llms.contents[0] as { text: string }).text).toBe("# LayerHop Docs\n");

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["swap_assistant"]);
    const p = await client.getPrompt({ name: "swap_assistant", arguments: { request: "100 USDC Base to SOL" } });
    const t = (p.messages[0]!.content as { text: string }).text;
    expect(t).toMatch(/Never ask for.*private keys/);
    expect(t).toMatch(/swapLink/);
    expect(t).toContain("100 USDC Base to SOL");
  });
});
