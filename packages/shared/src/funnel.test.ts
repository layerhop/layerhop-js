import { describe, expect, it } from "vitest";
import { FUNNEL_EVENTS, FUNNEL_STEPS, isFunnelEntry, isFunnelEvent, sanitizeFunnelProps, usdBucket } from "./funnel.js";

describe("funnel allowlists", () => {
  it("knows its events, steps first", () => {
    expect(FUNNEL_EVENTS.slice(0, FUNNEL_STEPS.length)).toEqual([...FUNNEL_STEPS]);
    expect(new Set(FUNNEL_EVENTS).size).toBe(FUNNEL_EVENTS.length);
    expect(isFunnelEvent("page_view")).toBe(true);
    expect(isFunnelEvent("toString")).toBe(false);
    expect(isFunnelEvent(1)).toBe(false);
  });

  it("keeps only allowlisted props with valid values", () => {
    expect(sanitizeFunnelProps({
      src_chain: "base", dst_chain: "7565164", same_chain: false, routes: 2, vm: "svm", step: "approve", error_code: "USER_REJECTED",
      provider: "0x1111111111111111111111111111111111111111", // too long and not a slug
      recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      routes_extra: 1, page: "home", usd_bucket: "huge", channel: "widget",
    })).toEqual({ src_chain: "base", dst_chain: "7565164", same_chain: false, routes: 2, vm: "svm", step: "approve", error_code: "USER_REJECTED" });
    expect(sanitizeFunnelProps({ routes: 1.5 })).toEqual({});
    expect(sanitizeFunnelProps(null)).toEqual({});
    expect(sanitizeFunnelProps(["page"])).toEqual({});
    expect(sanitizeFunnelProps({ __proto__: { page: "swap" } })).toEqual({});
  });

  it("accepts only bounded landing-page entries", () => {
    for (const ok of ["hl-hub", "bridge:base-to-hyperliquid", "bridge:usdc-to-hyperliquid", "pay-hub", "pay:accept-usdc-payments"]) expect(isFunnelEntry(ok), ok).toBe(true);
    for (const bad of ["", "hub", "HL-HUB", "bridge:", "bridge:Base", "bridge:-x", "bridge:a b", `bridge:${"a".repeat(49)}`, "bridge:x\n", "https://evil.example", 1, null, "pay:", "pay-hub:x", "PAY:x", `pay:${"a".repeat(49)}`, "payments:x", "pay:x/y"]) {
      expect(isFunnelEntry(bad), String(bad)).toBe(false);
    }
    expect(sanitizeFunnelProps({ page: "landing", entry: "bridge:base-to-hyperliquid" })).toEqual({ page: "landing", entry: "bridge:base-to-hyperliquid" });
    expect(sanitizeFunnelProps({ page: "landing", entry: "0x1111111111111111111111111111111111111111" })).toEqual({ page: "landing" });
  });

  it("allows the Hyperliquid referral click with its placement, entry and page", () => {
    expect(isFunnelEvent("hl_referral_clicked")).toBe(true);
    expect(sanitizeFunnelProps({ placement: "success", entry: "hl-hub", page: "landing" })).toEqual({ placement: "success", entry: "hl-hub", page: "landing" });
    expect(sanitizeFunnelProps({ placement: "landing", page: "swap" })).toEqual({ placement: "landing", page: "swap" });
    expect(sanitizeFunnelProps({ placement: "https://app.hyperliquid.xyz/join/X", code: "X" })).toEqual({});
  });

  it("allows the merchant-page cta_clicked event with a bounded cta prop", () => {
    expect(isFunnelEvent("cta_clicked")).toBe(true);
    expect(FUNNEL_STEPS).not.toContain("cta_clicked");
    expect(sanitizeFunnelProps({ cta: "signup", entry: "pay:crypto-donations" })).toEqual({ cta: "signup", entry: "pay:crypto-donations" });
    expect(sanitizeFunnelProps({ cta: "https://evil.example" })).toEqual({});
  });

  it("buckets USD amounts coarsely", () => {
    expect([undefined, NaN, -1, 0, 9.99, 10, 999, 1000, 25_000].map(usdBucket)).toEqual([undefined, undefined, undefined, "<10", "<10", "10-100", "100-1k", "1k-10k", "10k+"]);
  });
});
