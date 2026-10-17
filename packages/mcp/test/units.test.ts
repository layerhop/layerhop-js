import { describe, expect, it } from "vitest";
import { isEvmAddress, isSolanaAddress, isTxHash, isValidAddress } from "../src/address.js";
import { AmountError, displayAmount, fromBaseUnits, toBaseUnits } from "../src/amounts.js";
import { parseArgs } from "../src/args.js";
import { bpsToPercent, formatEta } from "../src/format.js";
import { buildSwapLink } from "../src/links.js";
import { EVM, SOL } from "./helpers.js";

describe("amount conversion", () => {
  it("converts human decimals to base units with BigInt math", () => {
    expect(toBaseUnits("100", 6)).toBe("100000000");
    expect(toBaseUnits("0.25", 6)).toBe("250000");
    expect(toBaseUnits(".5", 9)).toBe("500000000");
    expect(toBaseUnits("1.", 6)).toBe("1000000");
    expect(toBaseUnits("1.500000", 6)).toBe("1500000"); // trailing zeros beyond precision are fine
    expect(toBaseUnits("123456789.123456789123456789", 18)).toBe("123456789123456789123456789");
    expect(toBaseUnits(" 7 ", 0)).toBe("7");
    expect(toBaseUnits(0.1, 18)).toBe("100000000000000000"); // no float error
  });

  it("refuses zero, negatives, garbage and too many decimals", () => {
    for (const bad of ["0", "0.000", "-1", "1e6", "1,000", "abc", "", ".", "1.2.3", "0x10"]) {
      expect(() => toBaseUnits(bad, 6), bad).toThrow(AmountError);
    }
    expect(() => toBaseUnits("1.0000001", 6)).toThrow(/more than 6 decimal places/);
    expect(() => toBaseUnits(1e-7, 18)).toThrow(/exponent/);
    expect(() => toBaseUnits(Number.NaN, 18)).toThrow(AmountError);
  });

  it("converts base units back to trimmed human decimals", () => {
    expect(fromBaseUnits("949742908", 9)).toBe("0.949742908");
    expect(fromBaseUnits("100000000", 6)).toBe("100");
    expect(fromBaseUnits("1", 18)).toBe("0.000000000000000001");
    expect(fromBaseUnits(0n, 6)).toBe("0");
    expect(fromBaseUnits("42", 0)).toBe("42");
    expect(displayAmount("1234567891", 9, 4)).toBe("1.2345");
    expect(displayAmount("1", 18, 6)).toBe("<0.000001");
  });

  it("round-trips", () => {
    for (const [h, d] of [["1.5", 6], ["0.000001", 6], ["99999999999.999999999999999999", 18]] as const) {
      expect(fromBaseUnits(toBaseUnits(h, d), d)).toBe(h);
    }
  });
});

describe("address validation", () => {
  it("validates EVM and Solana addresses per VM", () => {
    expect(isEvmAddress(EVM)).toBe(true);
    expect(isEvmAddress(EVM.slice(0, -1))).toBe(false);
    expect(isSolanaAddress(SOL)).toBe(true);
    expect(isSolanaAddress("So11111111111111111111111111111111111111112")).toBe(true);
    expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true); // system program
    expect(isSolanaAddress(SOL.replace("W", "0"))).toBe(false); // 0 is not base58
    expect(isSolanaAddress("abc")).toBe(false);
    expect(isValidAddress("evm", SOL)).toBe(false);
    expect(isValidAddress("svm", EVM)).toBe(false);
  });

  it("recognizes tx hashes and signatures", () => {
    expect(isTxHash(`0x${"ab".repeat(32)}`)).toBe(true);
    expect(isTxHash("5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW")).toBe(true);
    expect(isTxHash("0x1234")).toBe(false);
    expect(isTxHash(SOL)).toBe(false);
  });
});

describe("deep links (docs/URL_CONTRACT.md)", () => {
  it("builds a /swap link with human amount and attribution", () => {
    const u = new URL(
      buildSwapLink({ fromChain: "base", fromToken: "USDC", toChain: "solana", toToken: "SOL", amount: "100", recipient: SOL, slippageBps: 30, integrator: "myapp" }),
    );
    expect(u.origin + u.pathname).toBe("https://layerhop.com/swap");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      srcChain: "base",
      srcToken: "USDC",
      dstChain: "solana",
      dstToken: "SOL",
      amount: "100",
      recipient: SOL,
      slippageBps: "30",
      integrator: "myapp",
      ref: "mcp",
    });
  });

  it("omits optional params, drops invalid integrators and honors a custom app URL", () => {
    const u = new URL(buildSwapLink({ fromChain: 8453, fromToken: "ETH", toChain: 1, toToken: "USDC", integrator: "Bad Id!" }, "https://staging.layerhop.com/"));
    expect(u.host).toBe("staging.layerhop.com");
    expect(u.searchParams.has("amount")).toBe(false);
    expect(u.searchParams.has("integrator")).toBe(false);
    expect(u.searchParams.get("srcChain")).toBe("8453");
  });
});

describe("formatting helpers", () => {
  it("formats ETA and bps", () => {
    expect(formatEta(1)).toBe("~1 s");
    expect(formatEta(95)).toBe("~2 min");
    expect(formatEta(3900)).toBe("~1 h 5 min");
    expect(formatEta(0)).toBe("a few seconds");
    expect(bpsToPercent(20)).toBe("0.2%");
    expect(bpsToPercent(5)).toBe("0.05%");
    expect(bpsToPercent(100)).toBe("1%");
    expect(bpsToPercent(0)).toBe("0%");
  });
});

describe("cli args", () => {
  it("parses transport flags", () => {
    expect(parseArgs([])).toMatchObject({ http: false });
    expect(parseArgs(["--http", "--port", "9000", "--host", "0.0.0.0"])).toMatchObject({ http: true, port: 9000, host: "0.0.0.0" });
    expect(parseArgs(["--http", "--port=0"])).toMatchObject({ http: true, port: 0 });
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--port", "x"])).toThrow(/Invalid port/);
  });
});
