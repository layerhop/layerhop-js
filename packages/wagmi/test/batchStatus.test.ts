import { encodeFunctionData, erc20Abi, type Address } from "viem";
import { base } from "viem/chains";
import { disconnect } from "wagmi/actions";
import { afterEach, describe, expect, it } from "vitest";
import { atomicBatchStatus, getAtomicBatchStatus, sendWalletCalls, wagmiDriver, type WalletCall } from "../src/actions.js";
import { connectFake, fakeConfig, fakeWallet, TOKEN, type FakeWalletOptions } from "./fakeWallet.js";

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

const call = (to: Address, amount: bigint): WalletCall => ({ to: TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), value: 0n });

describe("atomic batch status (EIP-5792 / EIP-7702)", () => {
  it("reads supported, ready (7702 upgrade on first use) and none", () => {
    expect(atomicBatchStatus({ atomic: { status: "supported" } })).toBe("supported");
    expect(atomicBatchStatus({ atomic: { status: "ready" } })).toBe("ready");
    expect(atomicBatchStatus({ atomicBatch: { supported: true } })).toBe("supported");
    expect(atomicBatchStatus({ atomic: { status: "unsupported" } })).toBe("none");
    // A paymaster alone never counts: we don't use sponsored gas.
    expect(atomicBatchStatus({ paymasterService: { supported: true } })).toBe("none");
    expect(atomicBatchStatus(null)).toBe("none");
  });

  it("asks the connected wallet; none when it has no wallet_getCapabilities", async () => {
    const { config } = await connected({ capabilities: { atomic: { status: "ready" } } });
    expect(await getAtomicBatchStatus(config, base.id)).toBe("ready");
    const { config: plain } = await connected({ capabilities: null });
    expect(await getAtomicBatchStatus(plain, base.id)).toBe("none");
  });

  it("a 7702-ready wallet gets one wallet_sendCalls with no paymaster or other capability", async () => {
    const { w, config } = await connected({ capabilities: { atomic: { status: "ready" }, paymasterService: { supported: true } } });
    const r = await sendWalletCalls(wagmiDriver(config), base.id, [call("0x5555555555555555555555555555555555555555", 1n), call("0x6666666666666666666666666666666666666666", 2n)]);
    expect(r.mode).toBe("batch");
    const [req] = w.of("wallet_sendCalls")[0]!.params as [{ atomicRequired?: boolean; capabilities?: Record<string, unknown> }];
    expect(req.atomicRequired).toBe(true);
    expect(req.capabilities?.paymasterService).toBeUndefined();
    expect(Object.keys(req.capabilities ?? {})).toEqual([]);
  });
});
