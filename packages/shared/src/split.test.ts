import { describe, expect, it } from "vitest";
import {
  checkShares, cleanSplitText, editTokenFromHash, equalShares, paidThreshold, shareStatus, splitUrl, weightedShares, SPLIT_MAX_PARTICIPANTS,
} from "./split.js";
import { cleanOrderNote, isOrderPurpose } from "./order-tags.js";

const sum = (xs: bigint[]) => xs.reduce((a, x) => a + x, 0n);

describe("equalShares", () => {
  it("splits evenly when it divides", () => {
    expect(equalShares(90_000_000n, 3)).toEqual([30_000_000n, 30_000_000n, 30_000_000n]);
  });

  it("hands the remainder out one base unit at a time to the first shares", () => {
    const s = equalShares(100_000_000n, 3);
    expect(s).toEqual([33_333_334n, 33_333_333n, 33_333_333n]);
    expect(sum(s)).toBe(100_000_000n);
    expect(equalShares(5n, 4)).toEqual([2n, 1n, 1n, 1n]);
  });

  it("keeps 18-decimal totals exact (no floats)", () => {
    const total = 1_000_000_000_000_000_001n;
    const s = equalShares(total, 7);
    expect(sum(s)).toBe(total);
    expect(s[0]! - s[6]!).toBeLessThanOrEqual(1n);
  });

  it("rejects a bad count", () => {
    expect(() => equalShares(10n, 0)).toThrow();
    expect(() => equalShares(10n, 1.5)).toThrow();
  });
});

describe("checkShares", () => {
  it("accepts shares that add up to the total", () => {
    expect(checkShares(100n, [60n, 40n])).toEqual({ ok: true, shares: [60n, 40n] });
  });

  it("rejects a sum mismatch, zero shares and bad counts", () => {
    expect(checkShares(100n, [60n, 39n])).toMatchObject({ ok: false, reason: "sum_mismatch" });
    expect(checkShares(100n, [100n, 0n])).toMatchObject({ ok: false, reason: "zero_share" });
    expect(checkShares(100n, [100n])).toMatchObject({ ok: false, reason: "count" });
    expect(checkShares(1000n, Array.from({ length: SPLIT_MAX_PARTICIPANTS + 1 }, () => 1n))).toMatchObject({ ok: false, reason: "count" });
  });
});

describe("weightedShares", () => {
  it("is proportional and adds up exactly", () => {
    expect(weightedShares(100n, [2, 3])).toEqual([40n, 60n]);
    const s = weightedShares(100n, [1, 1, 1]);
    expect(s).toEqual([34n, 33n, 33n]);
    expect(sum(weightedShares(1_000_003n, [3, 5, 7, 11]))).toBe(1_000_003n);
  });

  it("gives leftover units to the largest remainders", () => {
    // 10 × 1/6 = 1.67, 10 × 2/6 = 3.33, 10 × 3/6 = 5 → 1, 3, 5 + one unit to the first (remainder 4/6).
    expect(weightedShares(10n, [1, 2, 3])).toEqual([2n, 3n, 5n]);
  });
});

describe("paid status", () => {
  it("counts a share as paid within 0.5%", () => {
    expect(paidThreshold(10_000_000n)).toBe(9_950_000n);
    expect(shareStatus(10_000_000n, 0n)).toBe("unpaid");
    expect(shareStatus(10_000_000n, 5_000_000n)).toBe("partial");
    expect(shareStatus(10_000_000n, 9_949_999n)).toBe("partial");
    expect(shareStatus(10_000_000n, 9_950_000n)).toBe("paid");
    expect(shareStatus(10_000_000n, 12_000_000n)).toBe("paid");
  });
});

describe("links and text", () => {
  it("puts the edit secret in the fragment only", () => {
    expect(splitUrl("https://layerhop.com/", "spl_abc")).toBe("https://layerhop.com/split/spl_abc");
    expect(splitUrl("https://layerhop.com", "spl_abc", "s3cr3t-token_value")).toBe("https://layerhop.com/split/spl_abc#k=s3cr3t-token_value");
    expect(editTokenFromHash("#k=s3cr3t-token_value")).toBe("s3cr3t-token_value");
    expect(editTokenFromHash("#x=1&k=abcdefghijklmnop")).toBe("abcdefghijklmnop");
    expect(editTokenFromHash("#k=short")).toBeUndefined();
    expect(editTokenFromHash("")).toBeUndefined();
  });

  it("cleans labels and notes to plain text", () => {
    expect(cleanSplitText("  Bob\n\t (rent) ", 40)).toBe("Bob (rent)");
    expect(cleanSplitText("x".repeat(100), 40)).toHaveLength(40);
    expect(cleanOrderNote("  thanks\u0000 for the stream  ")).toBe("thanks for the stream");
    expect(cleanOrderNote("   ")).toBeUndefined();
    expect(cleanOrderNote(42)).toBeUndefined();
    expect(isOrderPurpose("tip")).toBe(true);
    expect(isOrderPurpose("refund")).toBe(false);
  });
});
