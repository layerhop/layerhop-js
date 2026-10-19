import { describe, expect, it } from "vitest";
import { addressVm, applyBps, CHAINS, DEFAULT_RPC_URLS, getChain, minAfterSlippage, POPULAR_CHAIN_IDS, rankQuotes, rpcUrl, SOLANA_CHAIN_ID, findToken, LayerHopError, paidWithLabel, gasOnArrivalApplies, requestedGasOnArrivalUsd, HYPERLIQUID_CHAIN_ID, isDestinationOnly } from "./index.js";
import type { ProviderQuote } from "./index.js";

const q = (provider: ProviderQuote["provider"], dstAmount: string, estimatedSeconds = 10) =>
  ({ provider, dstAmount, estimatedSeconds }) as ProviderQuote;

describe("shared", () => {
  it("resolves chains by id and slug", () => {
    expect(getChain(8453)?.slug).toBe("base");
    expect(getChain("solana")?.id).toBe(SOLANA_CHAIN_ID);
    expect(getChain(999999)).toBeUndefined();
  });
  it("finds tokens by symbol or address, case-insensitive", () => {
    expect(findToken(8453, "usdc")?.decimals).toBe(6);
    expect(findToken(56, "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d")?.decimals).toBe(18);
  });
  it("does bps math on big integers without floats", () => {
    expect(applyBps("1000000000000000000000", 30)).toBe("3000000000000000000");
    expect(minAfterSlippage("1000", 50)).toBe("995");
  });
  it("ranks by output then speed", () => {
    const r = rankQuotes([q("relay", "100", 5), q("debridge", "120", 30), q("mayan", "120", 10)]);
    expect(r.map((x) => x.provider)).toEqual(["mayan", "debridge", "relay"]);
  });
  it("ranks quotes that deliver gas on arrival first", () => {
    const withGas = { ...q("relay", "100"), gasOnArrival: { amount: "1", token: "0x0", symbol: "ETH", decimals: 18 } } as ProviderQuote;
    expect(rankQuotes([q("lifi", "120"), withGas]).map((x) => x.provider)).toEqual(["relay", "lifi"]);
  });
  it("gas on arrival applies only cross-chain to EVM with a non-native output", () => {
    const usdcArb = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
    expect(gasOnArrivalApplies({ srcChainId: 8453, dstChainId: 42161, dstToken: usdcArb })).toBe(true);
    expect(gasOnArrivalApplies({ srcChainId: 42161, dstChainId: 42161, dstToken: usdcArb })).toBe(false);
    expect(gasOnArrivalApplies({ srcChainId: 8453, dstChainId: 42161, dstToken: "0x0000000000000000000000000000000000000000" })).toBe(false);
    expect(gasOnArrivalApplies({ srcChainId: 8453, dstChainId: SOLANA_CHAIN_ID, dstToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" })).toBe(false);
    expect(gasOnArrivalApplies({ srcChainId: 8453, dstChainId: HYPERLIQUID_CHAIN_ID, dstToken: "0x0000000000000000000000000000000000000001" })).toBe(false);
    expect(requestedGasOnArrivalUsd({ srcChainId: 8453, dstChainId: 42161, dstToken: usdcArb, gasOnArrivalUsd: 2 })).toBe(2);
    expect(requestedGasOnArrivalUsd({ srcChainId: 8453, dstChainId: 42161, dstToken: usdcArb })).toBeUndefined();
  });
  it("lists Hyperliquid as a destination-only EVM-style chain", () => {
    const hl = getChain("hyperliquid");
    expect(hl?.id).toBe(HYPERLIQUID_CHAIN_ID);
    expect(hl?.vm).toBe("evm");
    expect(hl?.nativeDecimals).toBe(8);
    expect(isDestinationOnly(HYPERLIQUID_CHAIN_ID)).toBe(true);
    expect(isDestinationOnly(8453)).toBe(false);
  });
  it("penalizes slow routes: +0.08% output but 18 min slower loses", () => {
    const r = rankQuotes([q("lifi", "99750000", 1080), q("relay", "99667084", 1)]);
    expect(r[0]!.provider).toBe("relay");
    // ...but a big enough output advantage still wins
    expect(rankQuotes([q("lifi", "101000000", 1080), q("relay", "99667084", 1)])[0]!.provider).toBe("lifi");
  });
  it("serializes errors with docs url", () => {
    const e = new LayerHopError("NO_ROUTE", "none");
    expect(e.status).toBe(404);
    expect(e.toJSON("r1").error.docsUrl).toContain("/errors/NO_ROUTE");
  });
  it("static chain registry: unique ids/slugs, https logos and explorers, an RPC and a provider for every chain", () => {
    expect(CHAINS.slice(0, 7).map((c) => c.slug)).toEqual(["ethereum", "arbitrum", "base", "optimism", "bsc", "polygon", "solana"]);
    expect(new Set(CHAINS.map((c) => c.id)).size).toBe(CHAINS.length);
    expect(new Set(CHAINS.map((c) => c.slug)).size).toBe(CHAINS.length);
    for (const c of CHAINS) {
      expect(c.slug, c.slug).toMatch(/^[a-z0-9-]+$/);
      expect(c.logoURI, c.slug).toMatch(/^https:\/\//);
      expect(c.explorerTx, c.slug).toMatch(/^https:\/\/.+\/tx\/$/);
      expect(c.explorerAddress, c.slug).toMatch(/^https:\/\/.+\/(address|account)\/$/);
      expect(c.providers.length, c.slug).toBeGreaterThan(0);
      // Destination-only chains (Hyperliquid) have no EVM JSON-RPC: nothing is sent or read there.
      if (!c.destinationOnly) expect(DEFAULT_RPC_URLS[c.id], c.slug).toMatch(/^https:\/\//);
      expect(c.popular).toBe(POPULAR_CHAIN_IDS.includes(c.id));
    }
    expect(getChain("berachain")).toMatchObject({ id: 80094, nativeSymbol: "BERA" });
    expect(rpcUrl(80094, { RPC_URL_80094: "https://x" })).toBe("https://x");
  });
  it("detects address families", () => {
    expect(addressVm("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe("evm");
    expect(addressVm("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe("svm");
    expect(addressVm("0x123")).toBeUndefined();
  });
});

describe("emails", () => {
  it("subjects never contain line breaks or control characters (no header injection via merchant names)", async () => {
    const { invoiceEmail, receiptEmail, oneLine } = await import("./index.js");
    const merchant = "Acme\r\nBcc: victim@example.com\u0000";
    const inv = invoiceEmail({ merchant, number: "INV-1", lines: [], total: "1.00 USDC", settlement: "USDC on Base", url: "https://layerhop.com/invoice/x" });
    const rec = receiptEmail({ merchant, total: "1.00 USDC", settlement: "USDC on Base", paidAt: "now" });
    for (const s of [inv.subject, rec.subject]) expect(s).not.toMatch(/[\r\n\u0000]/);
    expect(inv.subject).toMatch(/^Invoice INV-1 from Acme Bcc: victim@example.com ?: 1.00 USDC$/); // one line, harmless text
    expect(inv.html).not.toContain("<script");
    expect(invoiceEmail({ merchant: "<script>x</script>", number: "1", lines: [], total: "1", settlement: "s", url: "u" }).html).toContain("&lt;script&gt;");
    expect(oneLine(" a   b ")).toBe("a b");
  });
});

describe("subscription periods", () => {
  it("adds intervals in UTC, keeping the anchor day and clamping to short months", async () => {
    const { addInterval, subscriptionPeriod, intervalLabel, invoiceReminderEmail } = await import("./index.js");
    const jan31 = new Date("2026-01-31T10:00:00Z");
    expect(addInterval(jan31, "month", 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval(jan31, "month", 2).toISOString()).toBe("2026-03-31T10:00:00.000Z");
    expect(addInterval(jan31, "month", 13).toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(addInterval(new Date("2028-02-29T00:00:00Z"), "year", 1).toISOString()).toBe("2029-02-28T00:00:00.000Z");
    expect(addInterval(jan31, "week", 2).toISOString()).toBe("2026-02-14T10:00:00.000Z");
    expect(addInterval(jan31, "day", 1).toISOString()).toBe("2026-02-01T10:00:00.000Z");
    const p = subscriptionPeriod(jan31, "month", 3, 1);
    expect([p.start.toISOString(), p.end.toISOString()]).toEqual(["2026-04-30T10:00:00.000Z", "2026-07-31T10:00:00.000Z"]);
    expect(intervalLabel("month", 1)).toBe("month");
    expect(intervalLabel("week", 2)).toBe("2 weeks");
    const r = invoiceReminderEmail({ merchant: "Acme\r\n", number: "INV-2", total: "9.00 USDC", dueDate: "2026-10-21", cancelsOn: "2026-10-28", url: "https://layerhop.com/invoice/x" });
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.text).toContain("2026-10-28");
  });
});

describe("paidWithLabel", () => {
  it("names native and known tokens with the amount, and shortens unknown addresses", () => {
    expect(paidWithLabel({ srcChainId: 42161, srcToken: "0x0000000000000000000000000000000000000000", srcAmount: "74647160000000000" })).toBe("0.07464716 ETH on Arbitrum");
    expect(paidWithLabel({ srcChainId: 137, srcToken: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", srcAmount: "5000000" })).toBe("5.00 USDC on Polygon");
    expect(paidWithLabel({ srcChainId: 8453, srcToken: "0x1234567890abcdef1234567890abcdef12345678", srcAmount: "1" })).toBe("0x1234…5678 on Base");
    expect(paidWithLabel({ srcChainId: null, srcToken: null, srcAmount: null })).toBeNull();
  });
});
