import { describe, expect, it } from "vitest";
import { gasStationIssues, usdToWei, type GasStationChain } from "./gas-station.js";

const chain = (chainId: number, o: Partial<GasStationChain> = {}): GasStationChain => ({ chainId, name: `C${chainId}`, symbol: "ETH", decimals: 18, inbound: true, outbound: true, minUsd: 0.5, maxUsd: 50, ...o });
const table = new Map([chain(1), chain(10), chain(42161), chain(999, { outbound: false })].map((c) => [c.chainId, c]));

describe("gasStationIssues", () => {
  it("accepts a valid request", () => {
    expect(gasStationIssues(8453, [{ chainId: 10, usd: 2 }, { chainId: 42161, usd: 2 }], table)).toEqual([]);
  });

  it("flags each problem", () => {
    const codes = (d: { chainId: number; usd: number }[]) => gasStationIssues(10, d, table).map((i) => i.code);
    expect(codes([])).toEqual(["count"]);
    expect(codes([{ chainId: 10, usd: 2 }])).toEqual(["same_chain"]);
    expect(codes([{ chainId: 999, usd: 2 }])).toEqual(["unsupported"]);
    expect(codes([{ chainId: 1, usd: 51 }])).toEqual(["amount"]);
    expect(codes([{ chainId: 1, usd: 2 }, { chainId: 1, usd: 2 }])).toEqual(["duplicate"]);
    expect(codes([{ chainId: 1, usd: 2 }, { chainId: 42161, usd: 3 }])).toEqual(["uneven"]);
  });
});

describe("usdToWei", () => {
  it("rounds up to a millionth of the token", () => {
    expect(usdToWei(6, 2319.4, 18)).toBe(2_587_000_000_000_000n); // 0.00258687… ETH → 0.002587
    expect(usdToWei(2, 1, 18)).toBe(2_000_000_000_000_000_000n);
    expect(usdToWei(0, 1, 18)).toBe(0n);
  });
});
