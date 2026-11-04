// The fake wallet answers from memory: nothing is signed and no network is touched.
import type { EvmTx } from "@layerhop/sdk";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import { disconnect } from "wagmi/actions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeQuote, executeQuoteWithWalletClient } from "../src/actions.js";
import { ACCOUNT, connectFake, fakeConfig, fakeWallet, ROUTER, SPENDER, TOKEN, type FakeWallet, type FakeWalletOptions } from "./fakeWallet.js";

const tx = (): EvmTx => ({
  vm: "evm", chainId: base.id, to: ROUTER, data: "0xdeadbeef", value: "0",
  approval: { token: TOKEN, spender: SPENDER, amount: "100000000" },
  extraTxs: [{ to: TOKEN, data: "0x", value: "0" }],
});
const client = () => ({ buildTx: vi.fn(async () => tx()), reportSubmitted: vi.fn(async () => ({ status: "submitted" })) });

const configs: ReturnType<typeof fakeConfig>[] = [];
async function connected(opts: FakeWalletOptions) {
  const w = fakeWallet(opts);
  const config = fakeConfig(w);
  configs.push(config);
  await connectFake(config);
  return { w, config };
}
afterEach(async () => {
  for (const c of configs.splice(0)) await disconnect(c).catch(() => undefined);
});

const sentFees = (w: FakeWallet) =>
  w.of("eth_sendTransaction").map((x) => {
    const p = (x.params as [{ maxFeePerGas?: string; maxPriorityFeePerGas?: string; gasPrice?: string }])[0];
    return { maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas, gasPrice: p.gasPrice };
  });

describe("speed through the real drivers", () => {
  it("wagmi: fast sends every transaction with the fee fields, one by one even when the wallet batches", async () => {
    const { w, config } = await connected({ capabilities: { atomic: { status: "supported" } }, allowance: 0n });
    const r = await executeQuote(config, { quote: { quoteId: "q_1" }, client: client(), speed: "fast" });
    expect(r.mode).toBe("sequential");
    expect(w.of("wallet_sendCalls")).toHaveLength(0);
    // Base fee 10 gwei, tip 2 gwei (the fake history's 75th percentile), max fee 2 x 10 + 2 = 22 gwei.
    expect(sentFees(w)).toEqual(Array(3).fill({ maxFeePerGas: "0x51f4d5c00", maxPriorityFeePerGas: "0x77359400", gasPrice: undefined }));
  });

  it("viem WalletClient: instant", async () => {
    const w = fakeWallet({ capabilities: null, allowance: 10n ** 12n });
    const walletClient = createWalletClient({ account: ACCOUNT, chain: base, transport: custom(w.provider), pollingInterval: 5 });
    await executeQuoteWithWalletClient(walletClient, { quote: { quoteId: "q_1" }, client: client(), speed: "instant" });
    // Tip 4 gwei (95th percentile), max fee 3 x 10 + 4 = 34 gwei.
    expect(sentFees(w)[0]).toEqual({ maxFeePerGas: "0x7ea8ed400", maxPriorityFeePerGas: "0xee6b2800", gasPrice: undefined });
  });

  it("normal: no fee fields and no fee reads", async () => {
    const { w, config } = await connected({ capabilities: null, allowance: 10n ** 12n });
    await executeQuote(config, { quote: { quoteId: "q_1" }, client: client() });
    expect(sentFees(w)[0]).toEqual({ maxFeePerGas: undefined, maxPriorityFeePerGas: undefined, gasPrice: undefined });
    expect(w.of("eth_feeHistory")).toHaveLength(0);
  });
});
