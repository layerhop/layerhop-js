import { describe, expect, it } from "vitest";
import { COW_NATIVE_BUY_TOKEN, COW_VAULT_RELAYER, EVM_NATIVE, cowAppData, cowCancellationTypedData, cowOrderTypedData, cowOrderUid, type CowOrder } from "@layerhop/shared";
import { connect, data, EVM, mockApi, SOL, text } from "./helpers.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const quoteArgs = { fromChain: "base", fromToken: "USDC", amount: "100", toChain: "solana", toToken: "SOL", sender: EVM, recipient: SOL };

const order = (over: Record<string, unknown> = {}) => ({
  id: "lo_1", object: "limit_order", livemode: true, status: "built", statusDetail: null, provider: "jupiter", chainId: 7565164, wallet: SOL, srcToken: SOL_USDC, dstToken: WSOL,
  amount: "50000000", dstAmount: "500000000", expiresAt: null, fees: { ourFeeBps: 10, integratorFeeBps: 0, integrator: null }, providerOrderId: "p", filledAmount: "0",
  filledDstAmount: "0", fillCount: 0, openTxHash: null, cancelTxHash: null, channel: "api", metadata: null, createdAt: "t", updatedAt: "t", ...over,
});

describe("quote errors", () => {
  it("lists NO_ROUTE suggestions in human units and drops malformed ones", async () => {
    const leg = { srcChain: 8453, srcToken: BASE_USDC, amount: "100000000", dstChain: 1, dstToken: ETH_USDC, dstAmount: "99500000" };
    const api = mockApi([
      (c) =>
        c.url.pathname === "/v1/quote"
          ? { status: 422, body: { error: { code: "NO_ROUTE", message: "No route", details: { suggestions: [{ ...leg, kind: "dst_token", message: "Receive USDC on Ethereum instead" }, { kind: "src_token" }] } } } }
          : undefined,
    ]);
    const { call } = await connect(api.fetch);
    const r = await call("get_quote", quoteArgs);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^LayerHop API error NO_ROUTE \(HTTP 422\): No route/);
    expect(text(r)).toContain("1. Receive USDC on Ethereum instead [dst_token]: 100 USDC on Base -> ~99.5 USDC on Ethereum");
    expect(text(r)).not.toContain("2.");
  });
});

describe("gasless", () => {
  it("sends gasless and explains that the typed data can't be signed here", async () => {
    const typed = { types: {}, domain: {}, message: {}, primaryType: "Trade" };
    const api = mockApi([
      (c) => (c.url.pathname === "/v1/orders" ? { body: { quoteId: "q_best", provider: "zerox", gasless: { chainId: 8453, approval: { type: "permit", eip712: typed }, trade: { type: "settler_metatransaction", eip712: typed } } } } : undefined),
    ]);
    const { call } = await connect(api.fetch);
    await call("get_quote", { fromChain: "base", fromToken: "USDC", amount: "100", toChain: "base", toToken: "ETH", sender: EVM, gasless: true });
    expect(api.calls.find((c) => c.url.pathname === "/v1/quote")!.url.searchParams.get("gasless")).toBe("true");
    const r = data(await call("build_transaction", { quoteId: "q_best" }));
    expect(r.gasless).toBe(true);
    expect(r.signing.notice).toMatch(/The LayerHop MCP server holds no keys and cannot sign typed data/);
    expect(r.signing.steps[0]).toMatch(/approval/);
  });
});

describe("token lookup and risk", () => {
  it("looks a token up without a chain and reports its risk", async () => {
    const api = mockApi([
      (c) => (c.url.pathname === "/v1/tokens/lookup" ? { body: { token: { chainId: 8453, address: BASE_USDC, symbol: "USDC", name: "USD Coin", decimals: 6, verified: true } } } : undefined),
      (c) =>
        c.url.pathname.endsWith("/risk")
          ? { body: { risk: { chainId: 8453, address: BASE_USDC, level: "ok", verified: true, symbol: "USDC", reasons: [], source: "list", checkedAt: "2026-10-27T09:00:00.000Z" } } }
          : undefined,
    ]);
    const { call } = await connect(api.fetch);
    const l = data(await call("lookup_token", { address: BASE_USDC }));
    expect(l.token).toMatchObject({ symbol: "USDC", chain: "Base" });
    expect(api.calls.find((c) => c.url.pathname === "/v1/tokens/lookup")!.url.searchParams.has("chain")).toBe(false);
    const r = data(await call("get_token_risk", { chain: "base", token: "USDC" }));
    expect(r).toMatchObject({ level: "ok", chain: "Base", source: "list" });
    expect(api.calls.some((c) => c.url.pathname === `/v1/tokens/8453/${BASE_USDC}/risk`)).toBe(true);
  });
});

describe("limit orders", () => {
  it("creates an unsigned order in base units, relays a signed tx, and cancels", async () => {
    const api = mockApi([
      (c) => (c.url.pathname === "/v1/limit-orders" && c.method === "POST" ? { body: { ...order(), tx: { vm: "svm", serializedTx: "dW5zaWduZWQ=", submitViaApi: true } } } : undefined),
      (c) => (c.url.pathname === "/v1/limit-orders/lo_1/submit" ? { body: { limitOrder: order({ status: "open" }), txHash: "sig1" } } : undefined),
      (c) => (c.url.pathname === "/v1/limit-orders/lo_1/cancel" ? { body: { limitOrder: order({ status: "open" }), tx: { vm: "svm", serializedTx: "Y2FuY2Vs", submitViaApi: true } } } : undefined),
    ]);
    const { call } = await connect(api.fetch);
    const c = data(await call("create_limit_order", { wallet: SOL, sellToken: "USDC", sellAmount: "50", buyToken: "SOL", minReceive: "0.5" }));
    const body = api.calls.find((x) => x.url.pathname === "/v1/limit-orders")!.body;
    expect(body).toMatchObject({ wallet: SOL, srcToken: SOL_USDC, dstToken: WSOL, amount: "50000000", dstAmount: "500000000" });
    expect(c.unsignedTransaction).toMatchObject({ vm: "svm", serializedTx: "dW5zaWduZWQ=", submitViaApi: true });
    expect(c.limitOrder).toMatchObject({ sell: "50 USDC", forAtLeast: "0.5 SOL" });
    expect(c.signing.steps[1]).toMatch(/submit_limit_order/);
    const s = data(await call("submit_limit_order", { id: "lo_1", signedTransaction: "c2lnbmVk" }));
    expect(s).toMatchObject({ txHash: "sig1" });
    expect(api.calls.find((x) => x.url.pathname === "/v1/limit-orders/lo_1/submit")!.body).toEqual({ signedTransaction: "c2lnbmVk" });
    const k = data(await call("cancel_limit_order", { id: "lo_1" }));
    expect(k.unsignedTransaction.serializedTx).toBe("Y2FuY2Vs");
  });

  it("EVM (CoW): returns checked typed data + approval, relays the signature, refuses tampered typed data", async () => {
    const FEE_TO = "0xAA857ee7176bfc34Dd8a792de13934ed9541eD36";
    const { appData, appDataHash } = cowAppData({ bps: 20, recipient: FEE_TO });
    const message: CowOrder = {
      sellToken: BASE_USDC, buyToken: COW_NATIVE_BUY_TOKEN, receiver: EVM.toLowerCase(), sellAmount: "50000000", buyAmount: "20000000000000000",
      validTo: Math.floor(Date.now() / 1000) + 86_400, appData: appDataHash, feeAmount: "0", kind: "sell", partiallyFillable: false, sellTokenBalance: "erc20", buyTokenBalance: "erc20",
    };
    const uid = cowOrderUid(8453, message, EVM);
    const evmOrder = order({ provider: "cow", chainId: 8453, wallet: EVM.toLowerCase(), srcToken: BASE_USDC, dstToken: EVM_NATIVE, amount: "50000000", dstAmount: "20000000000000000", fees: { ourFeeBps: 20, integratorFeeBps: 0, integrator: null }, providerOrderId: uid });
    let typedData = cowOrderTypedData(8453, message);
    const api = mockApi([
      (c) => (c.url.pathname === "/v1/limit-orders" && c.method === "POST" ? { body: { ...evmOrder, tx: null, typedData, appData, approval: { token: BASE_USDC, spender: COW_VAULT_RELAYER, amount: "50000000" } } } : undefined),
      (c) => (c.url.pathname === "/v1/limit-orders/lo_1/submit" ? { body: { limitOrder: { ...evmOrder, status: "open" }, txHash: null } } : undefined),
      (c) => (c.url.pathname === "/v1/limit-orders/lo_1/cancel" ? { body: { limitOrder: { ...evmOrder, status: "open" }, tx: null, typedData: cowCancellationTypedData(8453, [uid]) } } : undefined),
    ]);
    const { call } = await connect(api.fetch);
    const args = { chain: "base", wallet: EVM, sellToken: "USDC", sellAmount: "50", buyToken: "ETH", minReceive: "0.02" };
    const c = data(await call("create_limit_order", args));
    expect(api.calls.find((x) => x.url.pathname === "/v1/limit-orders")!.body).toMatchObject({ chain: "8453", wallet: EVM, srcToken: BASE_USDC, amount: "50000000", dstAmount: "20000000000000000" });
    expect(c).toMatchObject({ approval: { spender: COW_VAULT_RELAYER }, typedData: { primaryType: "Order" } });
    expect(c.signing.steps.at(-1)).toMatch(/submit_limit_order.*signature/);
    const sig = `0x${"1".repeat(130)}`;
    data(await call("submit_limit_order", { id: "lo_1", signature: sig }));
    expect(api.calls.find((x) => x.url.pathname === "/v1/limit-orders/lo_1/submit")!.body).toEqual({ signature: sig });
    expect((await call("submit_limit_order", { id: "lo_1" })).isError).toBe(true);
    const k = data(await call("cancel_limit_order", { id: "lo_1" }));
    expect(k.typedData.primaryType).toBe("OrderCancellations");
    // a receiver that is not the wallet is refused before anyone signs
    typedData = cowOrderTypedData(8453, { ...message, receiver: FEE_TO });
    const bad = await call("create_limit_order", args);
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/receiver is not your wallet/);
  });

  it("needs a wallet or an API key to list", async () => {
    const { call } = await connect(mockApi().fetch);
    const r = await call("list_limit_orders", {});
    expect(r.isError).toBe(true);
  });
});
