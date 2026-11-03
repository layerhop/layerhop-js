import { describe, expect, it } from "vitest";
import { buildPayLink, formatReceivePreference, parsePayLinkParams, parsePayTarget, parseReceivePreferences, preferenceChain } from "./pay-link.js";

describe("parseReceivePreferences", () => {
  it("parses chain:token entries in order, case-insensitive chains, keeping token case", () => {
    expect(parseReceivePreferences("base:USDC")).toEqual([{ chain: "base", token: "USDC" }]);
    expect(parseReceivePreferences(" Base:ETH , 42161:0xaf88d065e77c8cC2239327C5EDb3A432268e5831,solana:USDC ")).toEqual([
      { chain: "base", token: "ETH" },
      { chain: "42161", token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
      { chain: "solana", token: "USDC" },
    ]);
    expect(parseReceivePreferences("arbitrum:USDC.e")).toEqual([{ chain: "arbitrum", token: "USDC.e" }]);
  });
  it("skips invalid entries and ignores empty or oversized values", () => {
    expect(parseReceivePreferences("nonsense, base:, :USDC, base:US DC, base:<script>, optimism:USDC")).toEqual([{ chain: "optimism", token: "USDC" }]);
    expect(parseReceivePreferences("")).toEqual([]);
    expect(parseReceivePreferences(null)).toEqual([]);
    expect(parseReceivePreferences(`base:USDC,${"x".repeat(300)}`)).toEqual([]);
  });
  it("round-trips through formatReceivePreference", () => {
    expect(formatReceivePreference({ chain: "Base", token: "USDC" })).toBe("base:USDC");
    expect(parseReceivePreferences(formatReceivePreference({ chain: "solana", token: "USDC" }))).toEqual([{ chain: "solana", token: "USDC" }]);
  });
  it("preferenceChain resolves slugs and ids from the registry", () => {
    expect(preferenceChain({ chain: "base", token: "USDC" })).toEqual({ id: 8453, slug: "base", vm: "evm" });
    expect(preferenceChain({ chain: "8453", token: "USDC" })?.slug).toBe("base");
    expect(preferenceChain({ chain: "solana", token: "USDC" })?.vm).toBe("svm");
    expect(preferenceChain({ chain: "nochain", token: "USDC" })).toBeUndefined();
  });
});

describe("parsePayTarget", () => {
  it("addresses, ENS names and .sol names", () => {
    expect(parsePayTarget("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toEqual({ kind: "address", vm: "evm", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" });
    expect(parsePayTarget("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9")).toEqual({ kind: "address", vm: "svm", address: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9" });
    expect(parsePayTarget("Vitalik.ETH")).toEqual({ kind: "ens", name: "vitalik.eth" });
    expect(parsePayTarget("@nick.eth")).toEqual({ kind: "ens", name: "nick.eth" });
    expect(parsePayTarget("pay.alice.eth")).toEqual({ kind: "ens", name: "pay.alice.eth" });
    expect(parsePayTarget("bonfida.sol")).toEqual({ kind: "sns", name: "bonfida.sol" });
    expect(parsePayTarget("%40alice.eth")).toEqual({ kind: "ens", name: "alice.eth" });
  });
  it("rejects what can't be a recipient", () => {
    for (const bad of ["", "alice", "0x123", "sub.alice.sol", "a b.eth", "alice..eth", "%E0%A4%A", "../etc", `${"a".repeat(300)}.eth`]) {
      expect(parsePayTarget(bad), bad).toBeUndefined();
    }
  });
});

describe("pay link params", () => {
  const from = (q: string) => {
    const u = new URLSearchParams(q);
    return parsePayLinkParams((k) => u.get(k));
  };
  it("keeps valid values and drops the rest", () => {
    expect(from("amount=25&chain=Base&token=USDC&note=Dinner%20%F0%9F%8D%95")).toEqual({ amount: "25", chain: "base", token: "USDC", note: "Dinner 🍕" });
    expect(from("amount=-1&chain=ba%20se&token=%3Cb%3E")).toEqual({});
    expect(from("amount=0")).toEqual({});
    expect(from("amount=0.5")).toEqual({ amount: "0.5" });
  });
  it("caps the note and strips control characters", () => {
    const n = from(`note=${encodeURIComponent(`a\u0000b\n\nc ${"x".repeat(200)}`)}`).note!;
    expect(n.startsWith("a b c ")).toBe(true);
    expect(n.length).toBe(140);
  });
  it("buildPayLink", () => {
    expect(buildPayLink("https://layerhop.com/", "alice.eth")).toBe("https://layerhop.com/to/alice.eth");
    expect(buildPayLink("https://layerhop.com", "alice.eth", { amount: "25", note: "rent & more" })).toBe("https://layerhop.com/to/alice.eth?amount=25&note=rent+%26+more");
  });
});
