import { describe, expect, it } from "vitest";
import { connect, data, EVM, mockApi, SOL, text, type Call } from "./helpers.js";

const TEST_KEY = `lh_test_${"a".repeat(32)}`;
const LIVE_KEY = `lh_live_${"b".repeat(32)}`;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FAKE = "0x1234567890abcdef1234567890abcdef12345678";

const sampleDa = (over: Record<string, unknown> = {}) => ({
  id: "da_test1",
  object: "deposit_address",
  livemode: false,
  status: "active",
  provider: "sandbox",
  address: FAKE,
  chainId: 8453,
  token: BASE_USDC,
  dstChainId: 42161,
  dstToken: ARB_USDC,
  recipient: EVM,
  refundTo: EVM,
  reusable: true,
  amount: null,
  fees: { ourFeeBps: 10, integratorFeeBps: 0, integrator: null },
  label: "user-1",
  metadata: null,
  depositCount: 0,
  lastDepositAt: null,
  createdAt: "2026-10-19T10:00:00.000Z",
  ...over,
});

const sampleOrder = (over: Record<string, unknown> = {}) => ({
  quoteId: "dep_abc",
  status: "submitted",
  statusDetail: null,
  provider: "sandbox",
  channel: "api",
  srcChainId: 8453,
  srcToken: BASE_USDC,
  dstChainId: 42161,
  dstToken: ARB_USDC,
  sender: FAKE,
  recipient: EVM,
  amount: "25000000",
  dstAmount: "24950000",
  ourFeeBps: 10,
  partnerFeeBps: 0,
  srcTxHash: null,
  dstTxHash: null,
  depositAddressId: "da_test1",
  createdAt: "2026-10-19T10:01:00.000Z",
  updatedAt: "2026-10-19T10:01:00.000Z",
  ...over,
});

/** Routes for /v1/deposit-addresses*, recording each call. */
function depositApi(da = sampleDa()) {
  return mockApi([
    (c: Call) => {
      const p = c.url.pathname;
      if (p === "/v1/deposit-addresses" && c.method === "POST") {
        return { status: 201, body: { ...da, ...(c.body as object), chainId: 8453, token: BASE_USDC, dstChainId: 42161, dstToken: ARB_USDC, estimate: { amount: "100000000", dstAmount: "99780000", dstAmountMin: "99280000", estimatedSeconds: 20 } } };
      }
      if (p === "/v1/deposit-addresses" && c.method === "GET") return { body: { depositAddresses: [da, sampleDa({ id: "da_2", status: "disabled" })], nextCursor: "cur_2" } };
      if (p === `/v1/deposit-addresses/${da.id}` && c.method === "GET") return { body: { ...da, deposits: [sampleOrder({ status: "filled" })] } };
      if (p === `/v1/deposit-addresses/${da.id}/refresh`) return { status: 202, body: da };
      if (p === `/v1/deposit-addresses/${da.id}/disable`) return { body: { ...da, status: "disabled" } };
      if (p === `/v1/deposit-addresses/${da.id}/simulate`) return { status: 201, body: { order: sampleOrder({ amount: (c.body as { amount: string }).amount }) } };
      return undefined;
    },
  ]);
}

const createArgs = { fromChain: "base", fromToken: "USDC", toChain: "arbitrum", toToken: "USDC", recipient: EVM, refundTo: EVM, label: "user-1" };

describe("deposit address tools", () => {
  it("warn about srcToken only, CEX refundTo and the $1 minimum", async () => {
    const { client } = await connect(mockApi().fetch);
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "create_deposit_address")!;
    expect(create.description).toMatch(/send ONLY srcToken on srcChain/);
    expect(create.description).toMatch(/never an exchange \(CEX\) deposit address/);
    expect(create.description).toMatch(/at least \$1/);
    expect(JSON.stringify(create.inputSchema)).toMatch(/NEVER an exchange/);
    expect(tools.find((t) => t.name === "disable_deposit_address")!.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "simulate_deposit")!.description).toMatch(/TEST MODE ONLY/);
  });

  it.each([
    ["create_deposit_address", createArgs],
    ["list_deposit_addresses", {}],
    ["get_deposit_address", { id: "da_test1" }],
    ["refresh_deposit_address", { id: "da_test1" }],
    ["disable_deposit_address", { id: "da_test1" }],
    ["simulate_deposit", { id: "da_test1", amount: "25" }],
  ])("%s without an API key explains how to add one and calls nothing", async (name, args) => {
    const api = depositApi();
    const { call } = await connect(api.fetch);
    const r = await call(name, args);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/need a LayerHop API key.*LAYERHOP_API_KEY.*x-layerhop-api-key/s);
    expect(api.calls.filter((c) => c.url.pathname.startsWith("/v1/deposit-addresses"))).toHaveLength(0);
  });

  it("create resolves chains and tokens, converts the human amount and relays the rules", async () => {
    const api = depositApi();
    const { call } = await connect(api.fetch, { apiKey: TEST_KEY });
    const r = data(await call("create_deposit_address", { ...createArgs, reusable: false, amount: "25", metadata: { user: "1" } }));
    const post = api.calls.find((c) => c.url.pathname === "/v1/deposit-addresses" && c.method === "POST")!;
    expect(post.body).toMatchObject({ srcChain: 8453, srcToken: BASE_USDC, dstChain: 42161, dstToken: ARB_USDC, recipient: EVM, refundTo: EVM, reusable: false, amount: "25000000", label: "user-1", metadata: { user: "1" } });
    expect(r.depositAddress).toMatchObject({ id: "da_test1", mode: "test", address: FAKE, send: { token: "USDC", chain: "Base" }, deliver: { token: "USDC", chain: "Arbitrum" } });
    expect(r.depositAddress.fees.layerhop).toEqual({ bps: 10, percent: "0.1%" });
    expect(r.estimate).toMatchObject({ ifYouSend: "100 USDC", youReceive: "99.78 USDC", minimumReceived: "99.28 USDC" });
    expect(r.summary).toMatch(/^TEST MODE/);
    const rules = r.tellTheUser.join("\n");
    expect(rules).toMatch(/NEVER send real funds/);
    expect(rules).toMatch(/Send ONLY USDC on Base/);
    expect(rules).toMatch(/at least \$1/);
    expect(rules).toMatch(/never an exchange \(CEX\) deposit address/);
    expect(rules).toMatch(/One-time address: send exactly 25 USDC/);
  });

  it.each([
    [{ refundTo: SOL }, /refundTo .* not valid on Base/],
    [{ recipient: SOL }, /recipient .* not valid on Arbitrum/],
    [{ reusable: false }, /amount is required for a one-time address/],
    [{ amount: "0" }, /greater than 0/],
    [{ fromChain: "dogechain" }, /Unknown chain "dogechain"/],
    [{ fromToken: "0x1111111111111111111111111111111111111111", amount: "5" }, /decimals are unknown/],
  ])("create rejects bad input %j before calling the API", async (over, msg) => {
    const api = depositApi();
    const { call } = await connect(api.fetch, { apiKey: TEST_KEY });
    const r = await call("create_deposit_address", { ...createArgs, ...over });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(msg);
    expect(api.calls.filter((c) => c.url.pathname.startsWith("/v1/deposit-addresses"))).toHaveLength(0);
  });

  it("create passes unlisted token addresses through when no amount is given", async () => {
    const api = depositApi();
    const { call } = await connect(api.fetch, { apiKey: TEST_KEY });
    data(await call("create_deposit_address", { ...createArgs, toToken: "0x1111111111111111111111111111111111111111" }));
    const post = api.calls.find((c) => c.url.pathname === "/v1/deposit-addresses" && c.method === "POST")!;
    expect((post.body as { dstToken: string }).dstToken).toBe("0x1111111111111111111111111111111111111111");
  });

  it("list, get (with deposits), refresh and disable", async () => {
    const api = depositApi();
    const { call } = await connect(api.fetch, { apiKey: LIVE_KEY });

    const list = data(await call("list_deposit_addresses", { status: "active", label: "user-1", limit: 10 }));
    const q = api.calls.find((c) => c.url.pathname === "/v1/deposit-addresses" && c.method === "GET")!.url.searchParams;
    expect(q.get("status")).toBe("active");
    expect(q.get("label")).toBe("user-1");
    expect(q.get("limit")).toBe("10");
    expect(list.count).toBe(2);
    expect(list.nextCursor).toBe("cur_2");
    expect(list.depositAddresses[1].status).toBe("disabled");

    const got = data(await call("get_deposit_address", { id: "da_test1" }));
    expect(got.deposits).toEqual([
      expect.objectContaining({ quoteId: "dep_abc", status: "filled", deposited: "25 USDC", delivered: "24.95 USDC", amountBaseUnits: "25000000" }),
    ]);
    expect(got.tellTheUser.join("\n")).toMatch(/Send ONLY USDC on Base/);

    const refreshed = data(await call("refresh_deposit_address", { id: "da_test1" }));
    expect(refreshed.summary).toMatch(/Checking .* for deposits now/);
    expect(api.calls.some((c) => c.method === "POST" && c.url.pathname === "/v1/deposit-addresses/da_test1/refresh")).toBe(true);

    const disabled = data(await call("disable_deposit_address", { id: "da_test1" }));
    expect(disabled.depositAddress.status).toBe("disabled");
    expect(disabled.summary).toMatch(/stop sending funds/);
  });

  it("validates the id shape", async () => {
    const { call } = await connect(depositApi().fetch, { apiKey: TEST_KEY });
    const r = await call("get_deposit_address", { id: "q_nope" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/da_/);
  });

  it("surfaces API errors with code and docs link", async () => {
    const api = mockApi([(c) => (c.url.pathname.startsWith("/v1/deposit-addresses") ? { status: 403, body: { error: { code: "FORBIDDEN", message: "Deposit addresses are not enabled for live mode yet" } } } : undefined)]);
    const { call } = await connect(api.fetch, { apiKey: LIVE_KEY });
    const r = await call("create_deposit_address", createArgs);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/FORBIDDEN \(HTTP 403\).*not enabled for live mode.*errors\/FORBIDDEN/);
  });

  it("simulate_deposit converts human amounts, predicts the outcome and refuses live keys", async () => {
    const api = depositApi();
    const { call } = await connect(api.fetch, { apiKey: TEST_KEY });
    const r = data(await call("simulate_deposit", { id: "da_test1", amount: "25" }));
    const sim = api.calls.find((c) => c.url.pathname === "/v1/deposit-addresses/da_test1/simulate")!;
    expect(sim.body).toEqual({ amount: "25000000" });
    expect(r.order).toMatchObject({ quoteId: "dep_abc", deposited: "25 USDC" });
    expect(r.summary).toMatch(/settle it as filled/);

    const refund = data(await call("simulate_deposit", { id: "da_test1", amountBaseUnits: "25004001" }));
    expect(refund.summary).toMatch(/settle it as refunded/);

    const both = await call("simulate_deposit", { id: "da_test1", amount: "1", amountBaseUnits: "1" });
    expect(text(both)).toMatch(/exactly one of amount/);

    const live = await connect(depositApi().fetch, { apiKey: LIVE_KEY });
    const lr = await live.call("simulate_deposit", { id: "da_test1", amount: "25" });
    expect(lr.isError).toBe(true);
    expect(text(lr)).toMatch(/only works with a test key/);
  });

  it("simulate_deposit refuses live-mode addresses", async () => {
    const { call } = await connect(depositApi(sampleDa({ livemode: true, provider: "relay" })).fetch, { apiKey: TEST_KEY });
    const r = await call("simulate_deposit", { id: "da_test1", amount: "25" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/only works on test-mode deposit addresses/);
  });
});
