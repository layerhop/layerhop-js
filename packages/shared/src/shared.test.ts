import { describe, expect, it } from "vitest";
import { applyBps, getChain, minAfterSlippage, rankQuotes, SOLANA_CHAIN_ID, findToken, LayerHopError } from "./index.js";
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
});
