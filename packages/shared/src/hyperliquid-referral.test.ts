import { describe, expect, it } from "vitest";
import { HL_REFERRAL_CODE_RE, hyperliquidReferralLink, parseHyperliquidReferralCode } from "./hyperliquid-referral.js";

describe("Hyperliquid referral code", () => {
  it("is off when unset, blank or malformed", () => {
    for (const raw of [undefined, null, "", "   ", "has space", "a-b", "a_b", "x/../y", "<script>", "ÄBC", "A".repeat(21)]) {
      expect(parseHyperliquidReferralCode(raw), String(raw)).toBeUndefined();
    }
  });

  it("accepts 1-20 letters and digits, trimmed, case kept", () => {
    expect(parseHyperliquidReferralCode(" LAYERHOP ")).toBe("LAYERHOP");
    expect(parseHyperliquidReferralCode("LayerHop2026")).toBe("LayerHop2026");
    expect(parseHyperliquidReferralCode("A".repeat(20))).toBe("A".repeat(20));
    expect(HL_REFERRAL_CODE_RE.test("A")).toBe(true);
  });

  it("builds the join link and refuses invalid codes", () => {
    expect(hyperliquidReferralLink("LAYERHOP")).toBe("https://app.hyperliquid.xyz/join/LAYERHOP");
    expect(() => hyperliquidReferralLink("bad code")).toThrow();
  });
});
