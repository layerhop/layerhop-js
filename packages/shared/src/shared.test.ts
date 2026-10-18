import { describe, expect, it } from "vitest";
import { addressVm, applyBps, CHAINS, DEFAULT_RPC_URLS, getChain, minAfterSlippage, POPULAR_CHAIN_IDS, rankQuotes, rpcUrl, SOLANA_CHAIN_ID, findToken, LayerHopError } from "./index.js";
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
      expect(DEFAULT_RPC_URLS[c.id], c.slug).toMatch(/^https:\/\//);
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
