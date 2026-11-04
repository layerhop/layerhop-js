import { describe, expect, it } from "vitest";
import {
  eip681TransferUri, pickTransferTag, solanaPayTransactionUri, solanaPayTransferUri, tagOf, taggedAmount, transferPaymentState, unitsToDecimal,
} from "./checkout-transfer.js";

describe("checkout transfer tags", () => {
  it("rounds the amount due up to the tagged sub-cent digits (6 decimals)", () => {
    expect(taggedAmount(10_000_000n, 1234, 6)).toBe(10_001_234n); // 10.001234
    expect(taggedAmount(10_001_234n, 1234, 6)).toBe(10_001_234n);
    expect(taggedAmount(10_001_500n, 1234, 6)).toBe(10_011_234n); // never below the amount due
    expect(taggedAmount(0n, 7, 6)).toBe(7n);
    expect(() => taggedAmount(1n, 0, 6)).toThrow();
    expect(() => taggedAmount(1n, 10_000, 6)).toThrow();
  });

  it("works on 18-decimal stablecoins (BNB Chain) with 1e-6 token steps", () => {
    const a = taggedAmount(5n * 10n ** 18n, 42, 18);
    expect(a).toBe(5n * 10n ** 18n + 42n * 10n ** 12n);
    expect(tagOf(a, 18)).toBe(42);
    expect(tagOf(a + 1n, 18)).toBeNull(); // off-step digits carry no tag
  });

  it("reads the tag back, also after a round exchange withdrawal fee", () => {
    const a = taggedAmount(25_000_000n, 9_876, 6);
    expect(tagOf(a, 6)).toBe(9_876);
    expect(tagOf(a - 1_000_000n, 6)).toBe(9_876); // 1 USDC fee deducted
    expect(tagOf(a + 50_000_000n, 6)).toBe(9_876); // overpaid by a round amount
    expect(tagOf(25_000_000n, 6)).toBeNull(); // round amount
  });

  it("tops up a short payment with the same tag", () => {
    const due = 25_000_000n;
    const first = taggedAmount(due, 5, 6) - 1_000_000n; // 24.000005 arrived
    const topUp = taggedAmount(due - first, 5, 6);
    expect(tagOf(topUp, 6)).toBe(5);
    expect(first + topUp).toBeGreaterThanOrEqual(due);
    expect(first + topUp - due).toBeLessThan(10_000n);
  });

  it("picks a free tag and reports when none is left", () => {
    expect(pickTransferTag([1, 2, 3], () => 0)).toBe(4);
    expect(pickTransferTag([], () => 0.99999)).toBe(9999);
    expect(pickTransferTag(Array.from({ length: 9999 }, (_, i) => i + 1))).toBeNull();
  });

  it("classifies under, exact and over payments", () => {
    expect(transferPaymentState(0n, 10n)).toBe("waiting");
    expect(transferPaymentState(9n, 10n)).toBe("partial");
    expect(transferPaymentState(10n, 10n)).toBe("paid");
    expect(transferPaymentState(11n, 10n)).toBe("overpaid");
  });
});

describe("payment request URIs", () => {
  it("builds an EIP-681 ERC-20 transfer", () => {
    expect(eip681TransferUri({ chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", recipient: "0x2222222222222222222222222222222222222222", amount: 10_001_234n }))
      .toBe("ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453/transfer?address=0x2222222222222222222222222222222222222222&uint256=10001234");
  });

  it("builds Solana Pay transfer and transaction requests", () => {
    expect(unitsToDecimal(1_500_000n, 6)).toBe("1.5");
    expect(unitsToDecimal(7n, 6)).toBe("0.000007");
    expect(unitsToDecimal(3_000_000n, 6)).toBe("3");
    expect(solanaPayTransferUri({ recipient: "Rcpt", amount: 1_500_000n, decimals: 6, mint: "Mint", reference: "Ref", label: "Acme & Co" }))
      .toBe("solana:Rcpt?amount=1.5&spl-token=Mint&reference=Ref&label=Acme%20%26%20Co");
    expect(solanaPayTransactionUri("https://api.layerhop.com/v1/checkout/sessions/cs_1/solana-pay")).toBe("solana:https://api.layerhop.com/v1/checkout/sessions/cs_1/solana-pay");
    expect(solanaPayTransactionUri("https://x.test/p?a=1")).toBe("solana:https%3A%2F%2Fx.test%2Fp%3Fa%3D1");
  });
});
