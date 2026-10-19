import type { EvmTx } from "@layerhop/sdk";
import { createWalletClient, custom, decodeFunctionData, erc20Abi, type Hex } from "viem";
import { base } from "viem/chains";
import { disconnect } from "wagmi/actions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evmCalls,
  executeQuote,
  executeQuoteWithWalletClient,
  getAtomicBatchSupport,
  isBatchUnsupportedError,
  LayerHopWalletError,
  supportsAtomicBatch,
} from "../src/actions.js";
import { ACCOUNT, FEE_RECIPIENT, connectFake, fakeConfig, fakeWallet, ROUTER, SPENDER, TOKEN, type FakeWalletOptions } from "./fakeWallet.js";

const FEE_DATA = "0xa9059cbb0000000000000000000000004444444444444444444444444444444444444444000000000000000000000000000000000000000000000000000000000007a120" as Hex;

const tx = (over: Partial<EvmTx> = {}): EvmTx => ({
  vm: "evm",
  chainId: base.id,
  to: ROUTER,
  data: "0xdeadbeef",
  value: "0",
  approval: { token: TOKEN, spender: SPENDER, amount: "100000000" },
  extraTxs: [{ to: TOKEN, data: FEE_DATA, value: "0" }],
  ...over,
});

function client(built: EvmTx = tx()) {
  return {
    buildTx: vi.fn(async () => built),
    reportSubmitted: vi.fn(async () => ({ status: "submitted" })),
  };
}

const configs: ReturnType<typeof fakeConfig>[] = [];
async function connected(opts: FakeWalletOptions = {}) {
  const w = fakeWallet(opts);
  const config = fakeConfig(w);
  configs.push(config);
  await connectFake(config);
  return { w, config };
}

afterEach(async () => {
  for (const c of configs.splice(0)) await disconnect(c).catch(() => undefined);
});

const decodeApprove = (data: Hex) => decodeFunctionData({ abi: erc20Abi, data });

describe("helpers", () => {
  it("evmCalls orders approval, main call, then extraTxs; approval only when needed", () => {
    const calls = evmCalls(tx(), true);
    expect(calls.map((c) => c.to)).toEqual([TOKEN, ROUTER, TOKEN]);
    expect(decodeApprove(calls[0]!.data)).toEqual({ functionName: "approve", args: [SPENDER, 100000000n] });
    expect(evmCalls(tx(), false).map((c) => c.to)).toEqual([ROUTER, TOKEN]);
  });

  it("supportsAtomicBatch reads EIP-5792 v2 `atomic` and the earlier `atomicBatch` draft", () => {
    expect(supportsAtomicBatch({ atomic: { status: "supported" } })).toBe(true);
    expect(supportsAtomicBatch({ atomic: { status: "ready" } })).toBe(true);
    expect(supportsAtomicBatch({ atomic: { status: "unsupported" } })).toBe(false);
    expect(supportsAtomicBatch({ atomicBatch: { supported: true } })).toBe(true);
    expect(supportsAtomicBatch({ paymasterService: { supported: true } })).toBe(false);
    expect(supportsAtomicBatch(undefined)).toBe(false);
  });

  it("isBatchUnsupportedError: falls back on unsupported, never on a user rejection", () => {
    expect(isBatchUnsupportedError({ code: 5760 })).toBe(true);
    expect(isBatchUnsupportedError({ code: -32601 })).toBe(true);
    expect(isBatchUnsupportedError({ name: "X", cause: { code: 4200 } })).toBe(true);
    expect(isBatchUnsupportedError({ code: 4001 })).toBe(false);
    expect(isBatchUnsupportedError({ code: -32603, cause: { code: 4001 } })).toBe(false);
    expect(isBatchUnsupportedError(new Error("boom"))).toBe(false);
  });
});

describe("executeQuote (wagmi)", () => {
  it("EIP-5792 wallet: approve + swap + fee transfer in ONE wallet_sendCalls, then reports the mined hash", async () => {
    const { w, config } = await connected({ capabilities: { atomic: { status: "supported" } }, allowance: 0n });
    const c = client();
    const steps: string[] = [];
    const approval = vi.fn();
    const r = await executeQuote(config, { quote: { quoteId: "q_1" }, client: c, onStep: (s) => steps.push(s), onApproval: approval });

    expect(r.mode).toBe("batch");
    expect(w.of("eth_sendTransaction")).toHaveLength(0);
    const [send] = w.of("wallet_sendCalls");
    const p = (send!.params as [{ calls: { to: string; data: Hex; value?: Hex }[]; atomicRequired: boolean; from: string; chainId: Hex }])[0];
    expect(p.atomicRequired).toBe(true);
    expect(p.chainId).toBe("0x2105");
    expect(p.calls.map((x) => x.to.toLowerCase())).toEqual([TOKEN, ROUTER, TOKEN]);
    expect(decodeApprove(p.calls[0]!.data).args).toEqual([SPENDER, 100000000n]);
    expect(p.calls[2]!.data).toBe(FEE_DATA);
    expect(r.hash).toBe(`0x${(0xb000).toString(16).padStart(64, "0")}`);
    expect(r.batchId).toBe("0xbatch0");
    expect(approval).toHaveBeenCalledWith({ batched: true });
    expect(steps).toEqual(["building", "signing", "reporting"]);
    expect(c.reportSubmitted).toHaveBeenCalledWith("q_1", r.hash);
    expect(r.reported).toBe(true);
    expect(await r.wait()).toBe(true);
  });

  it("batches swap + fee without an approval when the allowance is already enough", async () => {
    const { w, config } = await connected({ capabilities: { atomic: { status: "ready" } }, allowance: 10n ** 18n });
    const r = await executeQuote(config, { quote: { quoteId: "q_1" }, client: client() });
    expect(r.mode).toBe("batch");
    const p = (w.of("wallet_sendCalls")[0]!.params as [{ calls: { to: string }[] }])[0];
    expect(p.calls.map((x) => x.to.toLowerCase())).toEqual([ROUTER, TOKEN]);
  });

  it("non-5792 wallet: sequential approve (waits for it), swap, then the fee transfer", async () => {
    const { w, config } = await connected({ capabilities: null, allowance: 0n });
    const steps: string[] = [];
    const approval = vi.fn();
    const r = await executeQuote(config, { quote: { quoteId: "q_1" }, client: client(), onStep: (s) => steps.push(s), onApproval: approval });
    expect(r.mode).toBe("sequential");
    expect(w.of("wallet_sendCalls")).toHaveLength(0);
    const sends = w.of("eth_sendTransaction").map((x) => (x.params as [{ to: string; data: Hex }])[0]);
    expect(sends.map((s) => s.to.toLowerCase())).toEqual([TOKEN, ROUTER, TOKEN]);
    expect(decodeApprove(sends[0]!.data).functionName).toBe("approve");
    // The approval is confirmed before the swap is requested.
    const m = w.methods();
    expect(m.indexOf("eth_getTransactionReceipt")).toBeLessThan(m.lastIndexOf("eth_sendTransaction"));
    expect(r.approvalHash).toBe(`0x${(0xa000).toString(16).padStart(64, "0")}`);
    expect(r.hash).toBe(`0x${(0xa001).toString(16).padStart(64, "0")}`);
    expect(r.extraTxHashes).toHaveLength(1);
    expect(approval).toHaveBeenCalledWith({ batched: false });
    expect(steps).toEqual(["building", "approving", "signing", "reporting"]);
    expect(await r.wait()).toBe(true);
  });

  it("falls back to sequential when the wallet refuses the batch as unsupported", async () => {
    const { w, config } = await connected({
      capabilities: { atomic: { status: "supported" } }, allowance: 10n ** 18n, sendCallsError: { code: 5760, message: "atomicity not supported" },
    });
    const fallback = vi.fn();
    const r = await executeQuote(config, { quote: { quoteId: "q_1" }, client: client(), onBatchFallback: fallback });
    expect(r.mode).toBe("sequential");
    expect(fallback).toHaveBeenCalledOnce();
    expect(w.of("eth_sendTransaction")).toHaveLength(2);
  });

  it("a rejected batch is a rejection: no sequential retry, no report", async () => {
    const { w, config } = await connected({ capabilities: { atomic: { status: "supported" } }, sendCallsError: { code: 4001, message: "User rejected" } });
    const c = client();
    await expect(executeQuote(config, { quote: { quoteId: "q_1" }, client: c })).rejects.toThrow();
    expect(w.of("eth_sendTransaction")).toHaveLength(0);
    expect(c.reportSubmitted).not.toHaveBeenCalled();
  });

  it("batch: never sends sequentially; batch: require throws on a non-5792 wallet", async () => {
    const a = await connected({ capabilities: { atomic: { status: "supported" } }, allowance: 10n ** 18n });
    expect((await executeQuote(a.config, { quote: { quoteId: "q" }, client: client(), batch: "never" })).mode).toBe("sequential");
    expect(a.w.of("wallet_getCapabilities")).toHaveLength(0);
    const b = await connected({ capabilities: null });
    await expect(executeQuote(b.config, { quote: { quoteId: "q" }, client: client(), batch: "require" })).rejects.toBeInstanceOf(LayerHopWalletError);
  });

  it("a single call (native swap, no extras) is a plain transaction", async () => {
    const { w, config } = await connected({ capabilities: { atomic: { status: "supported" } } });
    const r = await executeQuote(config, { quote: { quoteId: "q" }, client: client(tx({ approval: undefined, extraTxs: undefined, value: "1000" })) });
    expect(r.mode).toBe("sequential");
    expect(w.of("wallet_sendCalls")).toHaveLength(0);
    expect((w.of("eth_sendTransaction")[0]!.params as [{ value: Hex }])[0].value).toBe("0x3e8");
  });

  it("a failed fee transfer never fails the payment", async () => {
    const { config } = await connected({ capabilities: null, allowance: 10n ** 18n, sendTxError: { index: 1, code: 4001, message: "User rejected" } });
    const onExtra = vi.fn();
    const r = await executeQuote(config, { quote: { quoteId: "q" }, client: client(), onExtraTxError: onExtra });
    expect(r.mode).toBe("sequential");
    expect(r.extraTxHashes).toEqual([]);
    expect(onExtra).toHaveBeenCalledOnce();
  });

  it("switches the wallet to the transaction's chain first", async () => {
    const { w, config } = await connected({ capabilities: null, chainId: 1, allowance: 10n ** 18n });
    // The wagmi config only knows Base; the connector still reports chain 1 at connect.
    const steps: string[] = [];
    await executeQuote(config, { quote: { quoteId: "q" }, client: client(), onStep: (s) => steps.push(s) });
    expect(steps[1]).toBe("switching");
    expect(w.of("wallet_switchEthereumChain")).toHaveLength(1);
  });

  it("test-mode (sandbox) txs never reach the wallet: a placeholder hash is reported", async () => {
    const { w, config } = await connected({ capabilities: { atomic: { status: "supported" } } });
    const c = client(tx({ sandbox: true }));
    const r = await executeQuote(config, { quote: { quoteId: "q_test_1" }, client: c });
    expect(r.mode).toBe("sandbox");
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(w.methods().filter((m) => m.startsWith("wallet_") || m === "eth_sendTransaction")).toEqual([]);
    expect(c.reportSubmitted).toHaveBeenCalledWith("q_test_1", r.hash);
  });

  it("refuses Solana transactions and reports failures to report as reported: false", async () => {
    const { config } = await connected({ capabilities: null, allowance: 10n ** 18n });
    const sol = { buildTx: vi.fn(async () => ({ vm: "svm" as const, serializedTx: "AQ==" })) };
    await expect(executeQuote(config, { quote: { quoteId: "q" }, client: sol })).rejects.toThrow(/@layerhop\/solana/);
    const c = { ...client(), reportSubmitted: vi.fn(async () => { throw new Error("down"); }) };
    expect((await executeQuote(config, { quote: { quoteId: "q" }, client: c })).reported).toBe(false);
  });

  it("getAtomicBatchSupport reflects wallet_getCapabilities", async () => {
    expect(await getAtomicBatchSupport((await connected({ capabilities: { atomic: { status: "supported" } } })).config, base.id)).toBe(true);
    expect(await getAtomicBatchSupport((await connected({ capabilities: null })).config, base.id)).toBe(false);
  });
});

describe("executeQuoteWithWalletClient (viem)", () => {
  it("batches through a viem WalletClient (embedded wallets)", async () => {
    const w = fakeWallet({ capabilities: { atomic: { status: "supported" } }, allowance: 0n });
    const walletClient = createWalletClient({ account: ACCOUNT, chain: base, transport: custom(w.provider), pollingInterval: 5 });
    const c = client();
    const r = await executeQuoteWithWalletClient(walletClient, { quote: { quoteId: "q_1" }, client: c });
    expect(r.mode).toBe("batch");
    const p = (w.of("wallet_sendCalls")[0]!.params as [{ calls: { to: string }[]; from: string }])[0];
    expect(p.from.toLowerCase()).toBe(ACCOUNT);
    expect(p.calls).toHaveLength(3);
    expect(c.reportSubmitted).toHaveBeenCalledWith("q_1", r.hash);
  });

  it("sequential through a viem WalletClient without wallet_getCapabilities", async () => {
    const w = fakeWallet({ capabilities: null, allowance: 0n });
    const walletClient = createWalletClient({ account: ACCOUNT, chain: base, transport: custom(w.provider), pollingInterval: 5 });
    const r = await executeQuoteWithWalletClient(walletClient, { quote: { quoteId: "q_1" }, client: client() });
    expect(r.mode).toBe("sequential");
    expect(w.of("eth_sendTransaction").map((x) => (x.params as [{ to: string }])[0].to.toLowerCase())).toEqual([TOKEN, ROUTER, TOKEN]);
    expect(FEE_RECIPIENT).toBeTruthy();
  });
});
