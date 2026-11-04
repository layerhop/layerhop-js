import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_BPS } from "./fees.js";
import { parseFeeTiers, riskierTier, tieredFeeBps, tokenFeeTier, tradeFeeTier } from "./fee-tiers.js";
import { HYPERLIQUID_CHAIN_ID, HYPERLIQUID_PERPS_USDC, SOLANA_CHAIN_ID, TRON_CHAIN_ID } from "./chains.js";
import { EVM_NATIVE, SOL_NATIVE, TRON_USDT, TRX_NATIVE } from "./tokens.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETH_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ETH_WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const BASE_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MEME = "0x1234567890abcdef1234567890abcdef12345678";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

describe("tokenFeeTier", () => {
  it("stablecoins from the curated lists (any address case)", () => {
    expect(tokenFeeTier(8453, BASE_USDC)).toBe("stable");
    expect(tokenFeeTier(8453, BASE_USDC.toLowerCase())).toBe("stable");
    expect(tokenFeeTier(1, ETH_USDT)).toBe("stable");
    expect(tokenFeeTier(1, "0x6B175474E89094C44Da98b954EedeAC495271d0F")).toBe("stable"); // DAI
    expect(tokenFeeTier(8217, "0xE2053BCf56D2030d2470Fb454574237cF9ee3D4B")).toBe("stable"); // Kaia USDC.e
    expect(tokenFeeTier(9745, "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb")).toBe("stable"); // Plasma USDT0
    expect(tokenFeeTier(SOLANA_CHAIN_ID, SOL_USDC)).toBe("stable");
    expect(tokenFeeTier(TRON_CHAIN_ID, TRON_USDT)).toBe("stable");
  });

  it("Hyperliquid perps USDC is a stablecoin", () => {
    expect(tokenFeeTier(HYPERLIQUID_CHAIN_ID, EVM_NATIVE)).toBe("stable");
    expect(tokenFeeTier(HYPERLIQUID_CHAIN_ID, HYPERLIQUID_PERPS_USDC)).toBe("stable");
  });

  it("native coins, wrapped natives and BTC / ETH variants are majors", () => {
    expect(tokenFeeTier(1, EVM_NATIVE)).toBe("major");
    expect(tokenFeeTier(80094, EVM_NATIVE)).toBe("major"); // BERA
    expect(tokenFeeTier(SOLANA_CHAIN_ID, SOL_NATIVE)).toBe("major");
    expect(tokenFeeTier(TRON_CHAIN_ID, TRX_NATIVE)).toBe("major");
    expect(tokenFeeTier(1, ETH_WETH)).toBe("major");
    expect(tokenFeeTier(1, ETH_WBTC)).toBe("major");
    expect(tokenFeeTier(8453, BASE_CBBTC)).toBe("major");
    expect(tokenFeeTier(56, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")).toBe("major"); // WBNB
  });

  it("anything unlisted is longtail, including a listed address on the wrong chain", () => {
    expect(tokenFeeTier(1, MEME)).toBe("longtail");
    expect(tokenFeeTier(SOLANA_CHAIN_ID, BONK)).toBe("longtail");
    expect(tokenFeeTier(SOLANA_CHAIN_ID, SOL_USDC.toLowerCase())).toBe("longtail"); // Solana mints are case-sensitive
    expect(tokenFeeTier(42161, BASE_USDC)).toBe("longtail");
    expect(tokenFeeTier(999_999, EVM_NATIVE)).toBe("major"); // native on an unknown EVM chain
    expect(tokenFeeTier(999_999, MEME)).toBe("longtail");
  });
});

describe("tradeFeeTier", () => {
  it("stable only when both sides are stablecoins (incl. same-asset bridging)", () => {
    expect(tradeFeeTier(8453, BASE_USDC, 42161, ARB_USDC)).toBe("stable");
    expect(tradeFeeTier(8453, BASE_USDC, SOLANA_CHAIN_ID, SOL_USDC)).toBe("stable");
    expect(tradeFeeTier(1, ETH_USDT, 8453, BASE_USDC)).toBe("stable");
  });

  it("the riskier side wins", () => {
    expect(tradeFeeTier(8453, BASE_USDC, 1, EVM_NATIVE)).toBe("major");
    expect(tradeFeeTier(1, EVM_NATIVE, SOLANA_CHAIN_ID, SOL_NATIVE)).toBe("major");
    expect(tradeFeeTier(8453, BASE_USDC, 1, MEME)).toBe("longtail");
    expect(tradeFeeTier(SOLANA_CHAIN_ID, BONK, SOLANA_CHAIN_ID, SOL_NATIVE)).toBe("longtail");
  });

  it("riskierTier is symmetric", () => {
    expect(riskierTier("stable", "major")).toBe("major");
    expect(riskierTier("major", "stable")).toBe("major");
    expect(riskierTier("longtail", "stable")).toBe("longtail");
    expect(riskierTier("stable", "stable")).toBe("stable");
  });
});

describe("tieredFeeBps", () => {
  it("without tiers, every class pays the channel fee", () => {
    for (const ch of ["web", "widget", "api", "bot"] as const) {
      for (const t of ["stable", "major", "longtail"] as const) expect(tieredFeeBps(DEFAULT_FEE_BPS, undefined, ch, t)).toBe(DEFAULT_FEE_BPS[ch]);
    }
  });

  it("uses the tier entry, else the channel fee", () => {
    const tiers = { web: { stable: 5, longtail: 30 } };
    expect(tieredFeeBps(DEFAULT_FEE_BPS, tiers, "web", "stable")).toBe(5);
    expect(tieredFeeBps(DEFAULT_FEE_BPS, tiers, "web", "major")).toBe(DEFAULT_FEE_BPS.web);
    expect(tieredFeeBps(DEFAULT_FEE_BPS, tiers, "web", "longtail")).toBe(30);
    expect(tieredFeeBps(DEFAULT_FEE_BPS, tiers, "bot", "longtail")).toBe(DEFAULT_FEE_BPS.bot);
    expect(tieredFeeBps(DEFAULT_FEE_BPS, { web: { stable: 0 } }, "web", "stable")).toBe(0);
  });
});

describe("parseFeeTiers", () => {
  it("unset or blank is off", () => {
    expect(parseFeeTiers(undefined)).toBeUndefined();
    expect(parseFeeTiers("")).toBeUndefined();
    expect(parseFeeTiers("  ")).toBeUndefined();
  });

  it("parses a valid table", () => {
    expect(parseFeeTiers('{"web":{"stable":5,"major":15,"longtail":30},"api":{}}')).toEqual({ web: { stable: 5, major: 15, longtail: 30 }, api: {} });
  });

  it("rejects bad input", () => {
    expect(() => parseFeeTiers("{")).toThrow(/not valid JSON/);
    expect(() => parseFeeTiers("[]")).toThrow(/object keyed by channel/);
    expect(() => parseFeeTiers('{"discord":{}}')).toThrow(/unknown channel/);
    expect(() => parseFeeTiers('{"web":5}')).toThrow(/object keyed by class/);
    expect(() => parseFeeTiers('{"web":{"meme":5}}')).toThrow(/unknown class/);
    expect(() => parseFeeTiers('{"web":{"stable":1.5}}')).toThrow(/integer/);
    expect(() => parseFeeTiers('{"web":{"stable":-1}}')).toThrow(/integer/);
    expect(() => parseFeeTiers('{"web":{"longtail":200}}', 150)).toThrow(/0\.\.150/);
  });
});
