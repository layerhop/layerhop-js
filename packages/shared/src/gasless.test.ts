import { describe, expect, it } from "vitest";
import { GASLESS_CHAIN_IDS, checkGaslessSignRequest, gaslessApplies, gaslessProblems, splitSignature, type GaslessExpectation } from "./gasless.js";
import { EVM_NATIVE, LayerHopError, PERMIT2_ADDRESS, SOLANA_CHAIN_ID, type GaslessSignable, type GaslessSignRequest } from "./index.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

describe("gaslessApplies", () => {
  const base = { srcChainId: 8453, dstChainId: 8453, srcToken: USDC_BASE, dstToken: WETH_BASE };

  it("is true for an ERC-20 sell, same chain, on a 0x Gasless chain", () => {
    expect(gaslessApplies(base)).toBe(true);
    expect(gaslessApplies({ ...base, dstToken: EVM_NATIVE })).toBe(true);
  });

  it("is false for native sells, cross-chain, Solana and chains 0x Gasless lacks", () => {
    expect(gaslessApplies({ ...base, srcToken: EVM_NATIVE })).toBe(false);
    expect(gaslessApplies({ ...base, srcToken: EVM_NATIVE.toUpperCase().replace("0X", "0x") })).toBe(false);
    expect(gaslessApplies({ ...base, dstChainId: 42161 })).toBe(false);
    expect(gaslessApplies({ ...base, srcChainId: SOLANA_CHAIN_ID, dstChainId: SOLANA_CHAIN_ID })).toBe(false);
    // Linea: 0x Swap yes, Gasless no (supported-chains table, 2026-10-25).
    expect(gaslessApplies({ ...base, srcChainId: 59144, dstChainId: 59144 })).toBe(false);
  });

  it("lists the 0x Gasless chains", () => {
    for (const id of [1, 10, 56, 137, 8453, 42161, 43114]) expect(GASLESS_CHAIN_IDS.has(id)).toBe(true);
    expect(GASLESS_CHAIN_IDS.has(59144)).toBe(false);
  });
});

describe("splitSignature", () => {
  const r = `0x${"a".repeat(64)}`;
  const s = `0x${"b".repeat(64)}`;

  it("splits a 65-byte signature into r, s, v", () => {
    expect(splitSignature(`${r}${"b".repeat(64)}1c`)).toEqual({ r, s, v: 28 });
    expect(splitSignature(`${r}${"b".repeat(64)}1b`)).toEqual({ r, s, v: 27 });
  });

  it("normalizes v = 0 / 1 to 27 / 28", () => {
    expect(splitSignature(`${r}${"b".repeat(64)}00`).v).toBe(27);
    expect(splitSignature(`${r}${"b".repeat(64)}01`).v).toBe(28);
  });

  it("rejects anything that is not a 65-byte hex signature or has a bad v", () => {
    expect(() => splitSignature("0x1234")).toThrow(/65-byte/);
    expect(() => splitSignature(`${r}${"b".repeat(64)}`)).toThrow(/65-byte/);
    expect(() => splitSignature(`${r}${"b".repeat(64)}1d`)).toThrow(/v/);
    expect(() => splitSignature(`${r}${"z".repeat(64)}1b`)).toThrow(/65-byte/);
  });
});

describe("checkGaslessSignRequest", () => {
  const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const WETH = "0x4200000000000000000000000000000000000006";
  const USER = "0x5AD89031aAfFe2F82dF3b98Fa4181E08B5dCFF9C";
  const SETTLER = "0x7f6cee965959295cc64d0e6c00d99d6532d8e86b";
  const STRANGER = "0x9999999999999999999999999999999999999999";
  const NOW = 1_793_000_000;
  const MAX = (2n ** 256n - 1n).toString();

  const permit = (o: { domain?: Record<string, unknown>; message?: Record<string, unknown> } = {}): GaslessSignable => ({
    type: "permit",
    eip712: {
      types: { Permit: [] },
      domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC, ...o.domain },
      message: { owner: USER.toLowerCase(), spender: PERMIT2_ADDRESS.toLowerCase(), value: MAX, nonce: "0", deadline: String(NOW + 3600), ...o.message },
      primaryType: "Permit",
    },
  });
  const trade = (o: { domain?: Record<string, unknown>; message?: Record<string, unknown>; witness?: Record<string, unknown>; permitted?: Record<string, unknown>; primaryType?: string } = {}): GaslessSignable => ({
    type: "settler_metatransaction",
    eip712: {
      types: { PermitWitnessTransferFrom: [] },
      domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS.toLowerCase(), ...o.domain },
      message: {
        permitted: { token: USDC, amount: "1000000000", ...o.permitted },
        spender: SETTLER,
        nonce: "1",
        deadline: String(NOW + 60),
        slippageAndActions: { recipient: USER.toLowerCase(), buyToken: WETH, minAmountOut: "382080000000000000", actions: ["0x1234"], ...o.witness },
        ...o.message,
      },
      primaryType: o.primaryType ?? "PermitWitnessTransferFrom",
    },
  });
  const signReq = (o: Partial<GaslessSignRequest> = {}): GaslessSignRequest => ({ chainId: 8453, approval: permit(), trade: trade(), ...o });
  const expect_: GaslessExpectation = {
    chainId: 8453, srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", srcAmount: "1000000000", sender: USER,
    dstToken: WETH, minAmountOut: "382080000000000000", spender: SETTLER, now: NOW,
  };
  const problems = (r: GaslessSignRequest, e: Partial<GaslessExpectation> = {}) => gaslessProblems(r, { ...expect_, ...e });

  it("accepts the 0x shape (EIP-2612 permit to Permit2 + Permit2 witness trade)", () => {
    expect(problems(signReq())).toEqual([]);
    expect(problems(signReq({ approval: undefined }))).toEqual([]);
    expect(() => checkGaslessSignRequest(signReq(), expect_)).not.toThrow();
  });

  it("throws PROVIDER_ERROR (or the given code) listing the problems", () => {
    const bad = signReq({ trade: trade({ message: { spender: STRANGER } }) });
    expect(() => checkGaslessSignRequest(bad, expect_)).toThrow(LayerHopError);
    try {
      checkGaslessSignRequest(bad, expect_, "FORBIDDEN");
    } catch (e) {
      expect((e as LayerHopError).code).toBe("FORBIDDEN");
      expect((e as LayerHopError).message).toMatch(/spender/);
    }
  });

  describe("trade", () => {
    it("rejects another chain (request, domain)", () => {
      expect(problems(signReq({ chainId: 1 }))).not.toEqual([]);
      expect(problems(signReq({ trade: trade({ domain: { chainId: 1 } }) }))).not.toEqual([]);
    });
    it("rejects a verifying contract other than canonical Permit2", () => {
      expect(problems(signReq({ trade: trade({ domain: { verifyingContract: STRANGER } }) }))).not.toEqual([]);
    });
    it("rejects another primary type", () => {
      expect(problems(signReq({ trade: trade({ primaryType: "PermitTransferFrom" }) }))).not.toEqual([]);
    });
    it("rejects another token or a larger amount", () => {
      expect(problems(signReq({ trade: trade({ permitted: { token: WETH } }) }))).not.toEqual([]);
      expect(problems(signReq({ trade: trade({ permitted: { amount: "1000000001" } }) }))).not.toEqual([]);
      expect(problems(signReq({ trade: trade({ permitted: { amount: "999999999" } }) }))).toEqual([]);
      expect(problems(signReq({ trade: trade({ permitted: { amount: "lots" } }) }))).not.toEqual([]);
    });
    it("rejects a spender that is not the quote's settler, zero, Permit2, the token or the user", () => {
      expect(problems(signReq({ trade: trade({ message: { spender: STRANGER } }) }))).not.toEqual([]);
      for (const s of ["0x0000000000000000000000000000000000000000", PERMIT2_ADDRESS, USDC, USER]) {
        expect(problems(signReq({ trade: trade({ message: { spender: s } }) }), { spender: undefined })).not.toEqual([]);
      }
      expect(problems(signReq(), { spender: undefined })).toEqual([]);
    });
    it("rejects a witness recipient other than the requested recipient (default: sender)", () => {
      expect(problems(signReq({ trade: trade({ witness: { recipient: STRANGER } }) }))).not.toEqual([]);
      expect(problems(signReq({ trade: trade({ witness: { recipient: STRANGER } }) }), { recipient: STRANGER })).toEqual([]);
      expect(problems(signReq({ trade: trade({ message: { slippageAndActions: undefined } }) }))).not.toEqual([]);
    });
    it("rejects another buy token or a lower minimum out", () => {
      expect(problems(signReq({ trade: trade({ witness: { buyToken: STRANGER } }) }))).not.toEqual([]);
      expect(problems(signReq({ trade: trade({ witness: { minAmountOut: "1" } }) }))).not.toEqual([]);
    });
    it("treats 0x's 0xEeee… and our zero address as the same native buy token", () => {
      const r = signReq({ trade: trade({ witness: { buyToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" } }) });
      expect(problems(r, { dstToken: EVM_NATIVE })).toEqual([]);
    });
    it("rejects an expired deadline or one more than 10 minutes out", () => {
      expect(problems(signReq({ trade: trade({ message: { deadline: String(NOW - 1) } }) }))).not.toEqual([]);
      expect(problems(signReq({ trade: trade({ message: { deadline: String(NOW + 601) } }) }))).not.toEqual([]);
      expect(problems(signReq({ trade: trade({ message: { deadline: String(NOW + 600) } }) }))).toEqual([]);
    });
  });

  describe("approval", () => {
    it("rejects a permit for another token contract or chain", () => {
      expect(problems(signReq({ approval: permit({ domain: { verifyingContract: STRANGER } }) }))).not.toEqual([]);
      expect(problems(signReq({ approval: permit({ domain: { chainId: 1 } }) }))).not.toEqual([]);
    });
    it("rejects a permit whose spender is not Permit2", () => {
      expect(problems(signReq({ approval: permit({ message: { spender: STRANGER } }) }))).not.toEqual([]);
      expect(problems(signReq({ approval: permit({ message: { spender: SETTLER } }) }))).not.toEqual([]);
    });
    it("rejects a permit owned by someone else", () => {
      expect(problems(signReq({ approval: permit({ message: { owner: STRANGER } }) }))).not.toEqual([]);
    });
    it("allows value <= srcAmount or MaxUint256 (to Permit2 only), nothing in between", () => {
      expect(problems(signReq({ approval: permit({ message: { value: "1000000000" } }) }))).toEqual([]);
      expect(problems(signReq({ approval: permit({ message: { value: "1000000001" } }) }))).not.toEqual([]);
      expect(problems(signReq({ approval: permit({ message: { value: (2n ** 255n).toString() } }) }))).not.toEqual([]);
    });
    it("checks erc7597Permit like permit", () => {
      expect(problems(signReq({ approval: { ...permit(), type: "erc7597Permit" } }))).toEqual([]);
      expect(problems(signReq({ approval: { ...permit({ message: { spender: STRANGER } }), type: "erc7597Permit" } }))).not.toEqual([]);
    });
    it("checks daiPermit holder and spender", () => {
      const dai = (m: Record<string, unknown> = {}): GaslessSignable => ({
        type: "daiPermit",
        eip712: { types: {}, domain: { name: "Dai", version: "1", chainId: 8453, verifyingContract: USDC }, message: { holder: USER, spender: PERMIT2_ADDRESS, nonce: "0", expiry: String(NOW + 3600), allowed: true, ...m }, primaryType: "Permit" },
      });
      expect(problems(signReq({ approval: dai() }))).toEqual([]);
      expect(problems(signReq({ approval: dai({ spender: STRANGER }) }))).not.toEqual([]);
      expect(problems(signReq({ approval: dai({ holder: STRANGER }) }))).not.toEqual([]);
    });
    it("decodes executeMetaTransaction::approve calldata", () => {
      const word = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
      const meta = (spender: string, amount: bigint, from = USER, salt = true): GaslessSignable => ({
        type: "executeMetaTransaction::approve",
        eip712: {
          types: {},
          domain: salt ? { name: "USDC", version: "1", verifyingContract: USDC, salt: `0x${word((8453).toString(16))}` } : { name: "USDC", version: "1", verifyingContract: USDC, chainId: 8453 },
          message: { nonce: "0", from, functionSignature: `0x095ea7b3${word(spender)}${word(amount.toString(16))}` },
          primaryType: "MetaTransaction",
        },
      });
      expect(problems(signReq({ approval: meta(PERMIT2_ADDRESS, 2n ** 256n - 1n) }))).toEqual([]);
      expect(problems(signReq({ approval: meta(PERMIT2_ADDRESS, 1000n, USER, false) }))).toEqual([]);
      expect(problems(signReq({ approval: meta(STRANGER, 1000n) }))).not.toEqual([]);
      expect(problems(signReq({ approval: meta(PERMIT2_ADDRESS, 1000n, STRANGER) }))).not.toEqual([]);
      const transfer = meta(PERMIT2_ADDRESS, 1000n);
      (transfer.eip712.message as Record<string, unknown>).functionSignature = `0xa9059cbb${word(STRANGER)}${word("3e8")}`;
      expect(problems(signReq({ approval: transfer }))).not.toEqual([]);
    });
    it("rejects unknown approval types", () => {
      expect(problems(signReq({ approval: { ...permit(), type: "setApprovalForAll" } }))).not.toEqual([]);
    });
  });
});
