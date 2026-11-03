import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { GaslessSignRequest } from "@layerhop/sdk";
import { signGasless, type GaslessExpectationForSigner, type GaslessSigner } from "../src/gasless.js";
import gaslessQuote from "./fixtures/gasless-quote-usdc-weth-base.json";

const req: GaslessSignRequest = {
  chainId: 8453,
  approval: { type: "permit", eip712: gaslessQuote.approval.eip712 },
  trade: { type: "settler_metatransaction", eip712: gaslessQuote.trade.eip712 },
  gasFee: { amount: "42000", token: gaslessQuote.sellToken },
};

/** What the user asked for; the fixture's trade deadline is 1793000060, so "now" is a minute before. */
const expect_: GaslessExpectationForSigner = {
  chainId: 8453,
  srcToken: gaslessQuote.sellToken,
  srcAmount: gaslessQuote.sellAmount,
  dstToken: gaslessQuote.buyToken,
  minAmountOut: gaslessQuote.minBuyAmount,
  now: 1_793_000_000,
};

function fakeSigner(chainId = 1, connected = true) {
  const address = connected ? ("0x5AD89031aAfFe2F82dF3b98Fa4181E08B5dCFF9C" as const) : undefined;
  const log: string[] = [];
  let chain = chainId;
  const signer: GaslessSigner = {
    getAccount: async () => ({ address, chainId: chain }),
    switchChain: async (id) => {
      log.push(`switch:${id}`);
      chain = id;
    },
    signTypedData: async (t) => {
      log.push(`sign:${t.primaryType}`);
      return `0x${"ab".repeat(65)}` as Hex;
    },
  };
  return { signer, log };
}

describe("signGasless", () => {
  it("switches to the order's chain, then signs the approval and the trade, in order", async () => {
    const { signer, log } = fakeSigner(1);
    const steps: string[] = [];
    const sigs = await signGasless(signer, req, { expect: expect_, onStep: (s) => steps.push(s) });
    expect(log).toEqual(["switch:8453", "sign:Permit", "sign:PermitWitnessTransferFrom"]);
    expect(steps).toEqual(["switching", "approving", "signing"]);
    expect(sigs).toEqual({ approval: `0x${"ab".repeat(65)}`, trade: `0x${"ab".repeat(65)}` });
  });

  it("signs only the trade when there is no approval and the chain already matches", async () => {
    const { signer, log } = fakeSigner(8453);
    const sigs = await signGasless(signer, { ...req, approval: undefined }, { expect: expect_ });
    expect(log).toEqual(["sign:PermitWitnessTransferFrom"]);
    expect(sigs.approval).toBeUndefined();
  });

  it("needs a connected wallet", async () => {
    const { signer } = fakeSigner(8453, false);
    await expect(signGasless(signer, req, { expect: expect_ })).rejects.toThrow(/connect/i);
  });

  it("produces signatures that recover to the wallet for 0x's typed data (string uints, EIP712Domain in types)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer: GaslessSigner = {
      getAccount: async () => ({ address: account.address, chainId: 8453 }),
      switchChain: async () => undefined,
      signTypedData: (t) => account.signTypedData(t as Parameters<typeof account.signTypedData>[0]),
    };
    const owned = structuredClone(req);
    (owned.approval!.eip712.message as Record<string, unknown>).owner = account.address;
    (owned.trade.eip712.message.slippageAndActions as Record<string, unknown>).recipient = account.address;
    const sigs = await signGasless(signer, owned, { expect: expect_ });
    for (const [sig, t] of [[sigs.approval!, owned.approval!.eip712], [sigs.trade, owned.trade.eip712]] as const) {
      expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
      const who = await recoverTypedDataAddress({ ...(t as Parameters<typeof recoverTypedDataAddress>[0]), signature: sig as Hex });
      expect(who).toBe(account.address);
    }
  });

  it("refuses to sign tampered typed data, before asking the wallet anything", async () => {
    const STRANGER = "0x9999999999999999999999999999999999999999";
    const cases: ((r: GaslessSignRequest) => void)[] = [
      (r) => { (r.trade.eip712.message as Record<string, unknown>).spender = "0x0000000000000000000000000000000000000000"; },
      (r) => { (r.trade.eip712.message.slippageAndActions as Record<string, unknown>).recipient = STRANGER; },
      (r) => { (r.trade.eip712.message.permitted as Record<string, unknown>).amount = "1000000001"; },
      (r) => { r.trade.eip712.domain.verifyingContract = STRANGER; },
      (r) => { (r.approval!.eip712.message as Record<string, unknown>).spender = STRANGER; },
      (r) => { r.approval!.eip712.domain.verifyingContract = STRANGER; },
      (r) => { r.chainId = 1; },
    ];
    for (const mutate of cases) {
      const bad = structuredClone(req);
      mutate(bad);
      const { signer, log } = fakeSigner(8453);
      const err = await signGasless(signer, bad, { expect: expect_ }).catch((e: unknown) => e);
      expect((err as { code?: string }).code).toBe("GASLESS_UNSAFE");
      expect(log).toEqual([]);
    }
  });

  it("checks the approval owner against the connected wallet", async () => {
    const { signer, log } = fakeSigner(8453);
    // The fixture's owner is 0x5AD8…; a different connected wallet must not sign it.
    const other: GaslessSigner = { ...signer, getAccount: async () => ({ address: "0x1111111111111111111111111111111111111111", chainId: 8453 }) };
    await expect(signGasless(other, req, { expect: expect_ })).rejects.toMatchObject({ code: "GASLESS_UNSAFE" });
    expect(log).toEqual([]);
  });
});
