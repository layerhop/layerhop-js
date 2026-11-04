import { describe, expect, it } from "vitest";
import {
  COW_CHAINS, COW_NATIVE_BUY_TOKEN, COW_SETTLEMENT, cowAppData, cowAppDataHash, cowCancellationProblems, cowCancellationTypedData,
  cowDomainSeparator, cowOrderProblems, cowOrderState, cowOrderTypedData, cowOrderUid, type CowOrder, type CowOrderExpectation,
} from "./cow.js";
import { EVM_NATIVE } from "./tokens.js";

/** `domainSeparator()` read from GPv2Settlement on each chain, 2026-11-03 (eth_call, read-only). */
const ON_CHAIN_DOMAIN_SEPARATORS: Record<number, string> = {
  1: "0xc078f884a2676e1345748b1feace7b0abee5d00ecadb6e574dcdd109a63e8943",
  56: "0x0cbb18dfca28d2ceac8c72a17289168e03c1ad121338f5573e3b0c3255207fc7",
  100: "0x8f05589c4b810bc2f706854508d66d447cd971f8354a4bb0b3471ceb0a466bc7",
  137: "0x132e0e39721b0cb53216fc42764f69c300d4d21e0caf24e0713b1e3e11120dc2",
  8453: "0xd72ffa789b6fae41254d0b5a13e6e1e92ed947ec6a251edf1cf0b6c02c257b4b",
  9745: "0xe1f9c97768e45812440cd3317c07069178cc2f69971fb204c0211d8bfb1f8e76",
  42161: "0x69d78e7a7cafcaf924483f99f65e8f4e303a99a446db7ab319f9d40e940bced2",
  43114: "0x81fd4ff99b8f80b96c946c146cd5b79181aaf08ecb5808eeee1d047c1de267a5",
  57073: "0x5aced6090755c424bc1d6bbd39a2cdf57e6abfb4663598f4c3c821fb942d52e0",
  59144: "0xb219bb2b8733b80b7ebef0229e7f0c91436f9a0a5b9705fa519237ae0493addb",
};

const OWNER = "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A";
const FEE_TO = "0xAA857ee7176bfc34Dd8a792de13934ed9541eD36";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const NOW = 1_800_000_000;

function build(over: Partial<CowOrder> = {}, feeBps = 15) {
  const { appData, appDataHash } = cowAppData({ bps: feeBps, recipient: FEE_TO });
  const order: CowOrder = {
    sellToken: USDC_BASE, buyToken: WETH_BASE, receiver: OWNER, sellAmount: "100000000", buyAmount: "30000000000000000",
    validTo: NOW + 7 * 86_400, appData: appDataHash, feeAmount: "0", kind: "sell", partiallyFillable: false,
    sellTokenBalance: "erc20", buyTokenBalance: "erc20", ...over,
  };
  const expect_: CowOrderExpectation = {
    chainId: 8453, owner: OWNER, sellToken: USDC_BASE, buyToken: WETH_BASE, sellAmount: "100000000", buyAmount: "30000000000000000",
    feeBps, feeRecipient: FEE_TO, now: NOW, orderUid: cowOrderUid(8453, order, OWNER),
  };
  return { order, appData, typed: cowOrderTypedData(8453, order), expect: expect_ };
}

describe("CoW orders", () => {
  it("computes each chain's GPv2 domain separator exactly as the contract reports it", () => {
    for (const id of Object.keys(COW_CHAINS).map(Number)) expect(cowDomainSeparator(id)).toBe(ON_CHAIN_DOMAIN_SEPARATORS[id]);
  });

  it("writes canonical appData with our partner fee, and none without a fee", () => {
    const a = cowAppData({ bps: 15, recipient: FEE_TO });
    expect(a.appData).toBe(`{"appCode":"LayerHop","metadata":{"orderClass":{"orderClass":"limit"},"partnerFee":{"recipient":"${FEE_TO.toLowerCase()}","volumeBps":15}},"version":"1.6.0"}`);
    expect(a.appDataHash).toBe(cowAppDataHash(a.appData));
    expect(cowAppData({ bps: 0 }).appData).not.toContain("partnerFee");
    expect(() => cowAppData({ bps: 101, recipient: FEE_TO })).toThrow();
    expect(() => cowAppData({ bps: 10 })).toThrow();
  });

  it("builds a UID of digest ‖ owner ‖ validTo", () => {
    const { order } = build();
    const uid = cowOrderUid(8453, order, OWNER);
    expect(uid).toMatch(/^0x[0-9a-f]{112}$/);
    expect(uid.slice(66, 106)).toBe(OWNER.slice(2).toLowerCase());
    expect(parseInt(uid.slice(106), 16)).toBe(order.validTo);
  });

  it("accepts exactly the requested order", () => {
    const { typed, appData, expect: e } = build();
    expect(cowOrderProblems(typed, appData, e)).toEqual([]);
  });

  it("refuses a changed receiver, token, amount, fee, appData, domain, extra field or far validTo", () => {
    const base = build();
    const cases: [string, (t: ReturnType<typeof build>) => void][] = [
      ["receiver", (t) => { t.typed.message.receiver = FEE_TO; }],
      ["buyToken", (t) => { t.typed.message.buyToken = USDC_BASE; }],
      ["sellAmount", (t) => { t.typed.message.sellAmount = "100000001"; }],
      ["buyAmount", (t) => { t.typed.message.buyAmount = "1"; }],
      ["feeAmount", (t) => { t.typed.message.feeAmount = "5"; }],
      ["partiallyFillable", (t) => { t.typed.message.partiallyFillable = true; }],
      ["balances", (t) => { t.typed.message.sellTokenBalance = "external"; }],
      ["validTo", (t) => { t.typed.message.validTo = NOW + 2 * 365 * 86_400; }],
      ["validTo past", (t) => { t.typed.message.validTo = NOW - 1; }],
      ["extra field", (t) => { t.typed.message.hook = "0x"; }],
      ["domain", (t) => { t.typed.domain.verifyingContract = OWNER; }],
      ["chain", (t) => { t.typed.domain.chainId = 1; }],
      ["primaryType", (t) => { t.typed.primaryType = "Permit"; }],
      ["types", (t) => { t.typed.types.Order = [...t.typed.types.Order!.slice(0, 11)]; }],
      ["appData other recipient", (t) => { t.appData = cowAppData({ bps: 15, recipient: OWNER }).appData; t.typed.message.appData = cowAppDataHash(t.appData); }],
      ["appData other bps", (t) => { t.appData = cowAppData({ bps: 5, recipient: FEE_TO }).appData; t.typed.message.appData = cowAppDataHash(t.appData); }],
      ["appData hash", (t) => { t.typed.message.appData = `0x${"1".repeat(64)}`; }],
      ["uid", (t) => { t.expect.orderUid = `0x${"2".repeat(112)}`; }],
    ];
    for (const [name, mutate] of cases) {
      const t = structuredClone(base);
      mutate(t);
      expect(cowOrderProblems(t.typed, t.appData, t.expect).length, name).toBeGreaterThan(0);
    }
  });

  it("maps a native buy to CoW's placeholder and refuses a native sell", () => {
    const t = build({ buyToken: COW_NATIVE_BUY_TOKEN });
    expect(cowOrderProblems(t.typed, t.appData, { ...t.expect, buyToken: EVM_NATIVE, orderUid: cowOrderUid(8453, t.order, OWNER) })).toEqual([]);
    expect(cowOrderProblems(t.typed, t.appData, { ...t.expect, sellToken: EVM_NATIVE }).join()).toMatch(/native coin cannot be sold/);
  });

  it("checks cancellations cover exactly this order on this chain", () => {
    const uid = `0x${"ab".repeat(56)}`;
    const t = cowCancellationTypedData(8453, [uid]);
    expect(t.domain.verifyingContract).toBe(COW_SETTLEMENT);
    expect(cowCancellationProblems(t, 8453, uid)).toEqual([]);
    expect(cowCancellationProblems(t, 1, uid).length).toBeGreaterThan(0);
    expect(cowCancellationProblems(cowCancellationTypedData(8453, [uid, uid]), 8453, uid).length).toBeGreaterThan(0);
  });

  it("maps order statuses", () => {
    expect(["open", "presignaturePending", "fulfilled", "cancelled", "expired"].map(cowOrderState)).toEqual(["open", "open", "filled", "cancelled", "expired"]);
  });
});
