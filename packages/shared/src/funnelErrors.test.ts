import { describe, expect, it } from "vitest";
import { ERROR_CLASSES, ERROR_REASON_MAX, funnelTokenSymbol, isSafeErrorReason, sanitizeErrorReason, sanitizeFunnelProps } from "./funnel.js";

describe("error props (D-052)", () => {
  it("sanitizes wallet and provider messages", () => {
    expect(sanitizeErrorReason("execution reverted: Too little received")).toBe("execution reverted: Too little received");
    expect(sanitizeErrorReason("Simulation failed: Instruction 2: custom program error: 0x1771")).toBe("Simulation failed: Instruction 2: custom program error: 0x1771");
    const evm = sanitizeErrorReason("insufficient funds for gas * price + value: address 0xAbC0000000000000000000000000000000000001 have 123456789 want 99")!;
    expect(evm).not.toMatch(/0xAbC|123456789/);
    expect(evm).toContain("[hex]");
    expect(evm.length).toBeLessThanOrEqual(ERROR_REASON_MAX);
    const sol = sanitizeErrorReason("Signature 5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW has expired: block height exceeded")!;
    expect(sol).toBe("Signature [addr] has expired: block height exceeded");
    expect(sanitizeErrorReason("nonce too low: next nonce 1234567, tx nonce 12")).toBe("nonce too low: next nonce [n], tx nonce 12");
    expect(sanitizeErrorReason("see https://example.com/x?a=0xdead and mail me@x.io")).toBe("see [url] and mail [email]");
    expect(sanitizeErrorReason("first line\nsecond line 0xdeadbeefdeadbeef")).toBe("first line");
    expect(sanitizeErrorReason("too long ".repeat(20))!.length).toBeLessThanOrEqual(ERROR_REASON_MAX);
    expect(sanitizeErrorReason("x".repeat(200))).toBe("[addr]"); // a base58-shaped run
    expect(sanitizeErrorReason("💥")).toBeUndefined();
    expect(sanitizeErrorReason(42)).toBeUndefined();
  });

  it("the API keeps only safe reasons, known classes and plain symbols", () => {
    expect(isSafeErrorReason("nonce too low")).toBe(true);
    expect(isSafeErrorReason("to 0xAbC0000000000000000000000000000000000001")).toBe(false);
    expect(isSafeErrorReason("sig 5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb")).toBe(false);
    expect(isSafeErrorReason("amount 12345678")).toBe(false);
    expect(isSafeErrorReason("x".repeat(ERROR_REASON_MAX + 1))).toBe(false);
    expect(sanitizeFunnelProps({
      error_class: "sim_revert", error_reason: "execution reverted", src_token: "USDC.e", dst_token: "WETH", src_token_listed: true, dst_token_listed: false, vm: "tvm",
    })).toEqual({ error_class: "sim_revert", error_reason: "execution reverted", src_token: "USDC.e", dst_token: "WETH", src_token_listed: true, dst_token_listed: false, vm: "tvm" });
    expect(sanitizeFunnelProps({
      error_class: "bogus", error_reason: "to 0xAbC0000000000000000000000000000000000001", src_token: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", src_token_listed: "yes",
    })).toEqual({});
    expect(funnelTokenSymbol("USD₮0")).toBe("USD0");
    expect(funnelTokenSymbol("   ")).toBeUndefined();
    expect(funnelTokenSymbol("A".repeat(30))).toBe("A".repeat(16));
    expect(ERROR_CLASSES).toContain("unknown");
  });
});
