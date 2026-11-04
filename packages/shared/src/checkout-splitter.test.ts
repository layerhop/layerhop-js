import { describe, expect, it } from "vitest";
import {
  CHECKOUT_FORWARDER_INIT_CODE_HASH, checkoutGrossAmount, checkoutPredictCalldata, checkoutSessionRef, checkoutSplitterFee,
  checkoutSplitterSalt, checkoutSweepCalldata, parseCheckoutSplitterAddresses, predictCheckoutDepositAddress, transferDueAmount,
} from "./checkout-splitter.js";

describe("checkout splitter (D-065)", () => {
  it("derives the same deposit address as the contract (vector pinned in contracts/evm tests)", () => {
    const ref = checkoutSessionRef("cs_test_123");
    expect(ref).toBe("0x58570b0f4fd5c4be7b9e4adde762b3ef314c8b64cc04d31b243a20d5ed9e3c82");
    expect(CHECKOUT_FORWARDER_INIT_CODE_HASH).toBe("0xe099df8fdd34b186b69756d07a712a4d762e36fe191916742ab8bf9f0df8fe5f");
    expect(predictCheckoutDepositAddress("0x1111111111111111111111111111111111111111", "0x000000000000000000000000000000000000bEEF", 25, ref))
      .toBe("0x09feaec2eb3f31cba7b69c91713cd707b724fc11");
  });

  it("validates inputs like the contract", () => {
    const ref = checkoutSessionRef("cs_1");
    expect(() => checkoutSplitterSalt("0x0000000000000000000000000000000000000000", 25, ref)).toThrow(/non-zero/);
    expect(() => checkoutSplitterSalt("0x2222222222222222222222222222222222222222", 101, ref)).toThrow(/feeBps/);
    expect(() => checkoutSplitterSalt("0x2222222222222222222222222222222222222222", 25, "0x12")).toThrow(/sessionRef/);
    expect(() => predictCheckoutDepositAddress("nope", "0x2222222222222222222222222222222222222222", 25, ref)).toThrow(/factory/);
  });

  it("grosses up so the merchant nets at least the amount due, by at most one unit more", () => {
    for (const bps of [0, 1, 25, 99, 100]) {
      for (const due of [1n, 7n, 399n, 10_000n, 50_000_000n, 123_456_789_012n, 10n ** 30n + 7n]) {
        const gross = checkoutGrossAmount(due, bps);
        const net = gross - checkoutSplitterFee(gross, bps);
        expect(net >= due).toBe(true);
        expect(net <= due + 1n).toBe(true);
        // and it's the smallest such gross
        if (gross > due) expect(gross - 1n - checkoutSplitterFee(gross - 1n, bps) < due).toBe(true);
      }
    }
    expect(checkoutGrossAmount(50_000_000n, 25)).toBe(50_125_313n);
  });

  it("encodes sweep and predict calls", () => {
    const ref = checkoutSessionRef("cs_test_123");
    const d = checkoutSweepCalldata("0x000000000000000000000000000000000000bEEF", 25, ref, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(d.slice(0, 10)).toBe("0x482e1ea8");
    expect(d).toHaveLength(2 + 8 + 64 * 4);
    expect(d).toContain("000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(checkoutPredictCalldata("0x000000000000000000000000000000000000bEEF", 25, ref).slice(0, 10)).toBe("0x223026f9");
  });

  it("parses CHECKOUT_SPLITTER_ADDRESSES", () => {
    expect(parseCheckoutSplitterAddresses(undefined)).toEqual({});
    expect(parseCheckoutSplitterAddresses(" ")).toEqual({});
    expect(parseCheckoutSplitterAddresses('{"8453":"0x58f67DD598eb33593F1c2d7A074f3ef9eF753995"}')).toEqual({ 8453: "0x58f67dd598eb33593f1c2d7a074f3ef9ef753995" });
    expect(() => parseCheckoutSplitterAddresses("[]")).toThrow();
    expect(() => parseCheckoutSplitterAddresses('{"x":"0x58f67DD598eb33593F1c2d7A074f3ef9eF753995"}')).toThrow(/chain id/);
    expect(() => parseCheckoutSplitterAddresses('{"8453":"nope"}')).toThrow(/0x address/);
    expect(() => parseCheckoutSplitterAddresses('{"324":"0x58f67DD598eb33593F1c2d7A074f3ef9eF753995"}')).toThrow(/zkSync/);
    expect(() => parseCheckoutSplitterAddresses('{"1":"0x58f67DD598eb33593F1c2d7A074f3ef9eF753995"}')).toThrow(/Ethereum mainnet/);
  });

  it("asks a deposit address for the gross and everything else for the amount due", () => {
    expect(transferDueAmount("100", { kind: "evm_splitter", gross: "101" })).toBe(101n);
    expect(transferDueAmount("100", { kind: "evm_transfer" })).toBe(100n);
  });
});
