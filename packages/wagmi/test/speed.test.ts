// In-memory drivers only: nothing is signed and no network is touched.
import { describe, expect, it, vi } from "vitest";
import type { EvmTx } from "@layerhop/sdk";
import { readFeeSnapshot, sendEvmTx, speedFees, speedSupported, type EvmDriver, type FeeSnapshot } from "../src/actions.js";

const gwei = (n: number) => BigInt(Math.round(n * 1e9));
const snap: FeeSnapshot = {
  baseFeePerGas: gwei(10),
  rewards: { p75: [gwei(1), gwei(2), gwei(1.5)], p95: [gwei(3), gwei(4), gwei(5)] },
  suggestedTip: gwei(1),
  gasPrice: gwei(11),
};

describe("speedFees", () => {
  it("normal leaves fees to the wallet", () => expect(speedFees(snap, "normal")).toBeUndefined());
  it("fast: median 75th-percentile tip, 2x base fee + tip", () => {
    expect(speedFees(snap, "fast")).toEqual({ maxPriorityFeePerGas: gwei(1.5), maxFeePerGas: gwei(20) + gwei(1.5) });
  });
  it("instant: median 95th-percentile tip, 3x base fee + tip", () => {
    expect(speedFees(snap, "instant")).toEqual({ maxPriorityFeePerGas: gwei(4), maxFeePerGas: gwei(30) + gwei(4) });
  });
  it("never below the node's suggestion", () => {
    expect(speedFees({ ...snap, suggestedTip: gwei(2) }, "fast")).toMatchObject({ maxPriorityFeePerGas: gwei(2) });
  });
  it("caps the tip: fast max(5x suggestion, 2x base fee), instant max(10x suggestion, 4x base fee)", () => {
    const wild = { ...snap, rewards: { p75: [gwei(500)], p95: [gwei(900)] } };
    expect(speedFees(wild, "fast")).toMatchObject({ maxPriorityFeePerGas: gwei(20) });
    expect(speedFees(wild, "instant")).toMatchObject({ maxPriorityFeePerGas: gwei(40) });
    expect(speedFees({ ...wild, suggestedTip: gwei(10) }, "fast")).toMatchObject({ maxPriorityFeePerGas: gwei(50) });
    expect(speedFees({ ...wild, suggestedTip: gwei(10) }, "instant")).toMatchObject({ maxPriorityFeePerGas: gwei(100) });
  });
  it("legacy chains get a higher gasPrice", () => {
    expect(speedFees({ gasPrice: gwei(1) }, "fast")).toEqual({ gasPrice: gwei(1.2) });
    expect(speedFees({ gasPrice: gwei(1), baseFeePerGas: 0n }, "instant")).toEqual({ gasPrice: gwei(1.5) });
  });
  it("nothing usable: wallet decides", () => {
    expect(speedFees({}, "fast")).toBeUndefined();
    expect(speedFees({ baseFeePerGas: gwei(1), suggestedTip: 0n, rewards: { p75: [0n], p95: [0n] } }, "fast")).toBeUndefined();
  });
  it("chains that ignore the priority fee get no speed", () => {
    expect(speedSupported(42161)).toBe(false);
    expect(speedSupported(1)).toBe(true);
    expect(speedSupported(8453)).toBe(true);
  });
});

describe("readFeeSnapshot", () => {
  it("parses eth_feeHistory, eth_maxPriorityFeePerGas and eth_gasPrice", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "eth_feeHistory") return { baseFeePerGas: ["0x1", "0x2", "0x3b9aca00"], reward: [["0x10", "0x20"], ["0x30", "0x40"]] };
      if (method === "eth_maxPriorityFeePerGas") return "0x5";
      return "0x6";
    });
    expect(await readFeeSnapshot(request)).toEqual({ baseFeePerGas: 1_000_000_000n, rewards: { p75: [16n, 48n], p95: [32n, 64n] }, suggestedTip: 5n, gasPrice: 6n });
    expect(request.mock.calls[0]).toEqual(["eth_feeHistory", ["0xa", "latest", [75, 95]]]);
  });
  it("keeps going when a method fails (legacy chain without feeHistory)", async () => {
    const r = await readFeeSnapshot(async (m) => {
      if (m === "eth_gasPrice") return "0x64";
      throw new Error("method not found");
    });
    expect(r).toEqual({ baseFeePerGas: undefined, rewards: undefined, suggestedTip: undefined, gasPrice: 100n });
  });
});

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const tx = (over: Partial<EvmTx> = {}): EvmTx =>
  ({ vm: "evm", chainId: 1, to: "0x3333333333333333333333333333333333333333", data: "0x1234", value: "0", ...over }) as EvmTx;

function driver(opts: { batch?: boolean; allowance?: bigint; readFees?: boolean } = {}) {
  const sendTransaction = vi.fn(async (_p: Parameters<EvmDriver["sendTransaction"]>[0]) => `0x${"ab".repeat(32)}` as const);
  const sendCalls = vi.fn(async () => "batch1");
  const d: EvmDriver = {
    getAccount: async () => ({ address: ACCOUNT, chainId: 1 }),
    switchChain: async () => undefined,
    readAllowance: async () => opts.allowance ?? 0n,
    getCapabilities: async () => (opts.batch ? { atomic: { status: "supported" } } : undefined),
    sendCalls,
    waitForCalls: async () => ({ status: "success", receipts: [{ transactionHash: `0x${"cd".repeat(32)}`, status: "success" }] }),
    sendTransaction,
    waitForReceipt: async () => true,
    ...(opts.readFees === false ? {} : { readFees: vi.fn(async () => snap) }),
  };
  return { d, sendTransaction, sendCalls };
}

describe("sendEvmTx with speed", () => {
  it("suggests the fees with the transaction", async () => {
    const { d, sendTransaction } = driver();
    const sent = await sendEvmTx(d, tx(), { speed: "fast" });
    expect(sendTransaction.mock.calls[0]![0].fees).toEqual({ maxPriorityFeePerGas: gwei(1.5), maxFeePerGas: gwei(21.5) });
    expect(sent.fees).toEqual({ maxPriorityFeePerGas: gwei(1.5), maxFeePerGas: gwei(21.5) });
  });
  it("normal sends no fee fields (as before)", async () => {
    const { d, sendTransaction } = driver();
    const sent = await sendEvmTx(d, tx());
    expect(sendTransaction.mock.calls[0]![0].fees).toBeUndefined();
    expect(sent.fees).toBeUndefined();
    expect(d.readFees).not.toHaveBeenCalled();
  });
  it("approval and swap go one by one with fees instead of a fee-less batch", async () => {
    const { d, sendTransaction, sendCalls } = driver({ batch: true });
    const approval = { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender: "0x2222222222222222222222222222222222222222", amount: "100" };
    const sent = await sendEvmTx(d, tx({ approval } as Partial<EvmTx>), { speed: "instant" });
    expect(sendCalls).not.toHaveBeenCalled();
    expect(sent.mode).toBe("sequential");
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    for (const c of sendTransaction.mock.calls) expect(c[0].fees).toMatchObject({ maxPriorityFeePerGas: gwei(4) });
  });
  it("still batches at normal speed", async () => {
    const { d, sendCalls } = driver({ batch: true });
    const approval = { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender: "0x2222222222222222222222222222222222222222", amount: "100" };
    expect((await sendEvmTx(d, tx({ approval } as Partial<EvmTx>))).mode).toBe("batch");
    expect(sendCalls).toHaveBeenCalledOnce();
  });
  it("does nothing on Arbitrum or without fee reads", async () => {
    const a = driver();
    a.d.getAccount = async () => ({ address: ACCOUNT, chainId: 42161 });
    await sendEvmTx(a.d, tx({ chainId: 42161 }), { speed: "instant" });
    expect(a.sendTransaction.mock.calls[0]![0].fees).toBeUndefined();
    const b = driver({ readFees: false });
    await sendEvmTx(b.d, tx(), { speed: "fast" });
    expect(b.sendTransaction.mock.calls[0]![0].fees).toBeUndefined();
  });
  it("a failed fee read leaves the fees to the wallet", async () => {
    const { d, sendTransaction } = driver();
    d.readFees = async () => { throw new Error("rpc down"); };
    await sendEvmTx(d, tx(), { speed: "fast" });
    expect(sendTransaction.mock.calls[0]![0].fees).toBeUndefined();
  });
});
