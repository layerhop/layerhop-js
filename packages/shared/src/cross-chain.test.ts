import { describe, expect, it } from "vitest";
import { SOLANA_CHAIN_ID } from "./chains.js";
import { crossChainGroup, crossChainVariants, crossChainVariantsOf } from "./cross-chain.js";

describe("cross-chain variants", () => {
  it("groups WETH with ETH and skips bridged USDC.e", () => {
    expect(crossChainGroup("weth")).toBe("ETH");
    expect(crossChainGroup("USDC.e")).toBeUndefined();
    expect(crossChainVariantsOf("USDC").some((v) => v.symbol === "USDC.e")).toBe(false);
  });

  it("lists one variant per chain", () => {
    const eth = crossChainVariantsOf("ETH");
    expect(new Set(eth.map((v) => v.chainId)).size).toBe(eth.length);
    expect(eth.map((v) => v.chainId)).toEqual(expect.arrayContaining([1, 42161, 8453, 10]));
  });

  it("finds a listed token's group and its other chains", () => {
    const r = crossChainVariants(SOLANA_CHAIN_ID, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(r?.group).toBe("USDC");
    expect(r?.variants.map((v) => v.chainId)).toEqual(expect.arrayContaining([1, 8453, SOLANA_CHAIN_ID]));
    // EVM addresses match case-insensitively; Solana mints don't.
    expect(crossChainVariants(8453, "0x4200000000000000000000000000000000000006")?.group).toBe("ETH");
    expect(crossChainVariants(SOLANA_CHAIN_ID, "epjfwdd5aufqssqem2qn1xzybapc8g4wegGkZwyTDt1v")).toBeUndefined();
  });

  it("is undefined for unlisted or single-chain tokens", () => {
    expect(crossChainVariants(8453, "0x1111111111111111111111111111111111111111")).toBeUndefined();
    expect(crossChainVariants(SOLANA_CHAIN_ID, "So11111111111111111111111111111111111111112")).toBeUndefined();
  });
});
