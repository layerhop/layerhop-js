import { describe, expect, it } from "vitest";
import { SOLANA_CHAIN_ID } from "./chains.js";
import { EVM_NATIVE, SOL_NATIVE } from "./tokens.js";
import { fakeMajor, isListedMajor, listedMajorTokens, majorAddresses, normalizeSymbol, riskLevelOf } from "./token-risk.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FAKE = "0x1111111111111111111111111111111111111111";

describe("normalizeSymbol", () => {
  it("upper-cases, drops spaces and reads Tether's ₮ as T", () => {
    expect(normalizeSymbol(" usdc ")).toBe("USDC");
    expect(normalizeSymbol("USD₮0")).toBe("USDT0");
    expect(normalizeSymbol("W ETH")).toBe("WETH");
  });
});

describe("majorAddresses", () => {
  it("joins curated, canonical, extra majors and the native coin", () => {
    expect(majorAddresses(8453, "usdc")).toEqual([BASE_USDC]);
    expect(majorAddresses(8453, "WETH")).toEqual(["0x4200000000000000000000000000000000000006"]);
    expect(majorAddresses(1, "WETH")).toEqual(["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]);
    expect(majorAddresses(8453, "ETH", "ETH")).toEqual([EVM_NATIVE]);
    expect(majorAddresses(SOLANA_CHAIN_ID, "SOL")).toEqual([SOL_NATIVE]);
  });

  it("is empty when we don't know the major on that chain", () => {
    expect(majorAddresses(8453, "WBTC")).toEqual([]);
    expect(majorAddresses(4663, "USDC")).toEqual([]);
  });
});

describe("isListedMajor", () => {
  it("is true for natives, curated, canonical and extra majors (case-insensitive on EVM)", () => {
    expect(isListedMajor(8453, EVM_NATIVE)).toBe(true);
    expect(isListedMajor(8453, BASE_USDC.toLowerCase())).toBe(true);
    expect(isListedMajor(10, "0x4200000000000000000000000000000000000006")).toBe(true);
    expect(isListedMajor(56, "0x2170Ed0880ac9A755fd29B2688956BD959F933F8")).toBe(true);
    expect(isListedMajor(SOLANA_CHAIN_ID, SOL_NATIVE)).toBe(true);
  });

  it("is false for anything else, and Solana mints are case-sensitive", () => {
    expect(isListedMajor(8453, FAKE)).toBe(false);
    expect(isListedMajor(SOLANA_CHAIN_ID, SOL_NATIVE.toLowerCase())).toBe(false);
  });
});

describe("listedMajorTokens", () => {
  it("lists curated, canonical and extra majors once each, without the native coin", () => {
    const eth = listedMajorTokens(1);
    expect(eth.map((t) => t.symbol).sort()).toEqual(["CBBTC", "DAI", "USDC", "USDT", "WBTC", "WETH"]);
    expect(eth.find((t) => t.symbol === "USDC")?.decimals).toBe(6);
    expect(listedMajorTokens(8453).some((t) => t.address === EVM_NATIVE)).toBe(false);
    expect(listedMajorTokens(10).filter((t) => t.address.toLowerCase() === "0x4200000000000000000000000000000000000006")).toHaveLength(1);
  });
});

describe("fakeMajor", () => {
  it("flags a token using a major's symbol at another address", () => {
    expect(fakeMajor(8453, FAKE, "USDC")).toEqual({ symbol: "USDC", realAddresses: [BASE_USDC] });
    expect(fakeMajor(SOLANA_CHAIN_ID, "FakeMint1111111111111111111111111111111111", "usdc")?.realAddresses).toEqual(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
  });

  it("flags an ERC-20 called like the chain's native coin", () => {
    expect(fakeMajor(8453, FAKE, "ETH", "ETH")).toEqual({ symbol: "ETH", realAddresses: [EVM_NATIVE] });
    expect(fakeMajor(SOLANA_CHAIN_ID, "FakeMint1111111111111111111111111111111111", "SOL", "SOL")?.symbol).toBe("SOL");
  });

  it("passes the real token, other symbols, and majors we can't place on that chain", () => {
    expect(fakeMajor(8453, BASE_USDC.toLowerCase(), "USDC")).toBeUndefined();
    expect(fakeMajor(8453, EVM_NATIVE, "ETH", "ETH")).toBeUndefined();
    expect(fakeMajor(8453, FAKE, "BRETT")).toBeUndefined();
    expect(fakeMajor(4663, FAKE, "USDC")).toBeUndefined();
    expect(fakeMajor(8453, FAKE, undefined)).toBeUndefined();
    // Binance-Peg ETH is the ETH on BNB Chain.
    expect(fakeMajor(56, "0x2170ed0880ac9a755fd29b2688956bd959f933f8", "ETH", "BNB")).toBeUndefined();
  });
});

describe("riskLevelOf", () => {
  const r = (level: "caution" | "danger") => ({ code: "mintable" as const, level, message: "" });
  it("takes the worst reason; nothing found is ok only with a source", () => {
    expect(riskLevelOf([r("caution"), r("danger")], true)).toBe("danger");
    expect(riskLevelOf([r("caution")], false)).toBe("caution");
    expect(riskLevelOf([], true)).toBe("ok");
    expect(riskLevelOf([], false)).toBe("unknown");
  });
});
