import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { disconnect } from "wagmi/actions";
import { afterEach, describe, expect, it } from "vitest";
import { BatchPendingError, checkWalletCalls, PartialSendError, sendEvmTx, sendWalletCalls, wagmiDriver, type EvmDriver, type WalletCall } from "../src/actions.js";
import { connectFake, fakeConfig, fakeWallet, TOKEN, type FakeWalletOptions } from "./fakeWallet.js";

const transfer = (to: Address, amount: bigint): WalletCall => ({ to: TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), value: 0n });
const CALLS = [transfer("0x5555555555555555555555555555555555555555", 1n), transfer("0x6666666666666666666666666666666666666666", 2n), { to: "0x7777777777777777777777777777777777777777" as Address, data: "0x" as Hex, value: 3n }];

const configs: ReturnType<typeof fakeConfig>[] = [];
async function connected(opts: FakeWalletOptions = {}) {
  const w = fakeWallet(opts);
  const config = fakeConfig(w);
  configs.push(config);
  await connectFake(config);
  return { w, driver: wagmiDriver(config) };
}
afterEach(async () => {
  for (const c of configs.splice(0)) await disconnect(c).catch(() => undefined);
});

describe("sendWalletCalls (bulk payout transfers)", () => {
  it("EIP-5792 wallet: every transfer in ONE wallet_sendCalls; each call maps to the batch's transaction", async () => {
    const { w, driver } = await connected({ capabilities: { atomic: { status: "supported" } } });
    const r = await sendWalletCalls(driver, base.id, CALLS);
    expect(r.mode).toBe("batch");
    expect(w.of("wallet_sendCalls")).toHaveLength(1);
    expect(w.of("eth_sendTransaction")).toHaveLength(0);
    const sent = (w.of("wallet_sendCalls")[0]!.params as [{ calls: { to: string; value?: string }[] }])[0].calls;
    expect(sent.map((c) => c.to.toLowerCase())).toEqual(CALLS.map((c) => c.to.toLowerCase()));
    expect(new Set(r.hashes).size).toBe(1);
    expect(r.hashes).toHaveLength(3);
  });

  it("other wallets: one transaction per call, each confirmed before the next", async () => {
    const { w, driver } = await connected();
    const seen: number[] = [];
    const r = await sendWalletCalls(driver, base.id, CALLS, { onSent: (i) => seen.push(i) });
    expect(r.mode).toBe("sequential");
    expect(w.of("eth_sendTransaction")).toHaveLength(3);
    expect(new Set(r.hashes).size).toBe(3);
    expect(seen).toEqual([0, 1, 2]);
    // Receipt of call 1 is read before call 2 is sent.
    const m = w.methods().filter((x) => x === "eth_sendTransaction" || x === "eth_getTransactionReceipt");
    expect(m.slice(0, 3)).toEqual(["eth_sendTransaction", "eth_getTransactionReceipt", "eth_sendTransaction"]);
  });

  it("a stop part-way reports the transactions already sent; a rejection before any is a plain error", async () => {
    const { driver } = await connected({ sendTxError: { index: 1, code: 4001, message: "User rejected" } });
    const e = await sendWalletCalls(driver, base.id, CALLS).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PartialSendError);
    expect((e as PartialSendError).hashes).toHaveLength(1);
    const { driver: d2 } = await connected({ sendTxError: { index: 0, code: 4001, message: "User rejected" } });
    const e2 = await sendWalletCalls(d2, base.id, CALLS).catch((x: unknown) => x);
    expect(e2).not.toBeInstanceOf(PartialSendError);
  });

  it("falls back to sequential when the wallet refuses the batch as unsupported", async () => {
    const { w, driver } = await connected({ capabilities: { atomic: { status: "supported" } }, sendCallsError: { code: 5740, message: "Batch too large" } });
    const r = await sendWalletCalls(driver, base.id, CALLS);
    expect(r.mode).toBe("sequential");
    expect(w.of("eth_sendTransaction")).toHaveLength(3);
  });

  /** A wallet that batches; `status` decides what wallet_getCallsStatus does. */
  function stub(status: () => Promise<Awaited<ReturnType<EvmDriver["waitForCalls"]>>>) {
    const sent: string[] = [];
    const driver: EvmDriver = {
      getAccount: async () => ({ address: "0x00000000000000000000000000000000000000aa", chainId: base.id }),
      switchChain: async () => undefined,
      readAllowance: async () => 0n,
      getCapabilities: async () => ({ atomic: { status: "supported" } }),
      sendCalls: async () => (sent.push("sendCalls"), "0xbatch1"),
      waitForCalls: status,
      sendTransaction: async () => (sent.push("sendTransaction"), `0x${"a".repeat(64)}`),
      waitForReceipt: async () => true,
    };
    return { driver, sent };
  }

  it("never resends after wallet_sendCalls returned: an unsupported or timed-out status lookup is 'sent, status unknown'", async () => {
    for (const fail of [Object.assign(new Error("wallet_getCallsStatus not supported"), { code: 4200 }), new Error("Timed out")]) {
      const { driver, sent } = stub(async () => {
        throw fail;
      });
      const ids: string[] = [];
      const e = await sendWalletCalls(driver, base.id, CALLS, { onBatchSent: (id) => ids.push(id) }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BatchPendingError);
      expect((e as BatchPendingError).batchId).toBe("0xbatch1");
      expect(ids).toEqual(["0xbatch1"]);
      expect(sent).toEqual(["sendCalls"]);
      // The single-transaction path (sendEvmTx with an approval) behaves the same.
      const e2 = await sendEvmTx(driver, { vm: "evm", chainId: base.id, to: TOKEN, data: "0x", value: "0", approval: { token: TOKEN, spender: TOKEN, amount: "5" } } as never).catch((x: unknown) => x);
      expect(e2).toBeInstanceOf(BatchPendingError);
      expect(sent).toEqual(["sendCalls", "sendCalls"]);
    }
  });

  it("checkWalletCalls reports a batch sent earlier: landed, failed (safe to resend) or still unknown", async () => {
    expect(await checkWalletCalls(stub(async () => ({ status: "success", receipts: [{ transactionHash: `0x${"b".repeat(64)}` }] })).driver, base.id, "0xbatch1")).toEqual({ status: "success", hashes: [`0x${"b".repeat(64)}`] });
    expect((await checkWalletCalls(stub(async () => ({ status: "failure", receipts: [] })).driver, base.id, "0xbatch1")).status).toBe("failed");
    expect((await checkWalletCalls(stub(async () => ({ status: "pending" })).driver, base.id, "0xbatch1")).status).toBe("pending");
  });
});
