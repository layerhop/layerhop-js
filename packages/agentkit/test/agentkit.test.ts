import type { Action, WalletProvider } from "@coinbase/agentkit";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { LayerHopActionProvider, layerhopActionProvider } from "../src/index.js";
import { API, BASE_USDC, EVM, fakeApi, ROUTER, sameChainQuoteArgs, SOL } from "../../ai/test/fake-api.js";

/**
 * Duck-typed fake wallet providers (plain objects, not WalletProvider subclasses, so AgentKit's
 * constructor analytics never run). They record what they are asked to send; no keys, no network.
 */
function fakeEvmWallet({ allowance = 0n, chainId = "8453" } = {}) {
  const sent: { to: string; data: string; value: bigint }[] = [];
  const waited: string[] = [];
  const w = {
    getAddress: () => EVM,
    getNetwork: () => ({ protocolFamily: "evm", networkId: "base-mainnet", chainId }),
    getName: () => "fake_evm",
    getBalance: async () => 0n,
    nativeTransfer: async () => "0x",
    sendTransaction: async (tx: { to: string; data: string; value: bigint }) => {
      sent.push(tx);
      return `0x${String(sent.length).repeat(64)}` as `0x${string}`;
    },
    waitForTransactionReceipt: async (h: string) => {
      waited.push(h);
      return { status: "success" };
    },
    readContract: async (p: { functionName: string }) => {
      expect(p.functionName).toBe("allowance");
      return allowance;
    },
  };
  return { wallet: w as unknown as WalletProvider, sent, waited };
}

const solanaQuoteArgs = { fromChain: "solana", fromToken: "SOL", amount: "1", toChain: "solana", toToken: "USDC", sender: SOL };
const serializedSvmTx = () => {
  const payer = Keypair.generate().publicKey;
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: [] }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
};

const opts = (api = fakeApi()) => ({ apiUrl: API, fetch: api.fetch, integrator: "agentkit-bot", integratorFeeBps: 30 });
const find = (actions: Action[], n: string) => actions.find((a) => a.name === n)!;

describe("AgentKit action provider", () => {
  it("exposes LayerHop actions with zod v3 schemas and supports EVM + Solana networks", () => {
    const p = layerhopActionProvider(opts());
    expect(p.name).toBe("layerhop");
    expect(p.supportsNetwork({ protocolFamily: "evm", chainId: "8453" })).toBe(true);
    expect(p.supportsNetwork({ protocolFamily: "svm" })).toBe(true);
    expect(p.supportsNetwork({ protocolFamily: "bitcoin" })).toBe(false);
    const actions = p.getActions(fakeEvmWallet().wallet);
    expect(actions.map((a) => a.name)).toEqual(expect.arrayContaining(["layerhop_get_quote", "layerhop_build_transaction", "layerhop_get_prices", "layerhop_execute_swap"]));
    expect(find(actions, "layerhop_get_quote").schema.safeParse(sameChainQuoteArgs).success).toBe(true);
    expect(find(actions, "layerhop_get_quote").description).toMatch(/hold no private keys/);
  });

  it("quotes with channel api, integrator and integratorFeeBps", async () => {
    const api = fakeApi();
    const actions = new LayerHopActionProvider(opts(api)).getActions(fakeEvmWallet().wallet);
    const out = JSON.parse(await find(actions, "layerhop_get_quote").invoke(sameChainQuoteArgs));
    expect(out.best.quoteId).toBe("q_best");
    const q = api.last("/v1/quote")!.url.searchParams;
    expect([q.get("channel"), q.get("integrator"), q.get("integratorFeeBps")]).toEqual(["api", "agentkit-bot", "30"]);
  });

  it("executes a confirmed EVM quote: approval, wait, swap, report", async () => {
    const api = fakeApi();
    const { wallet, sent, waited } = fakeEvmWallet();
    const actions = new LayerHopActionProvider(opts(api)).getActions(wallet);
    await find(actions, "layerhop_get_quote").invoke(sameChainQuoteArgs);
    const out = JSON.parse(await find(actions, "layerhop_execute_swap").invoke({ quoteId: "q_best", userConfirmed: true }));
    expect(sent.map((t) => t.to)).toEqual([BASE_USDC, ROUTER]);
    expect(sent[0]!.data.startsWith("0x095ea7b3")).toBe(true);
    expect(sent[1]).toEqual({ to: ROUTER, data: "0xdeadbeef", value: 0n });
    expect(waited).toEqual([out.approvalTxHash]);
    expect(out).toMatchObject({ quoteId: "q_best", txHash: `0x${"2".repeat(64)}`, reported: true });
    expect(api.last("/v1/orders/q_best/submitted")!.body).toEqual({ txHash: `0x${"2".repeat(64)}` });
  });

  it("never sends without explicit confirmation or for a quote made for another sender", async () => {
    const { wallet, sent } = fakeEvmWallet({ allowance: 10n ** 30n });
    const actions = new LayerHopActionProvider(opts()).getActions(wallet);
    const exec = find(actions, "layerhop_execute_swap");
    expect(await exec.invoke({ quoteId: "q_best" })).toMatch(/^Error: Invalid input .*userConfirmed/);
    await find(actions, "layerhop_get_quote").invoke({ ...sameChainQuoteArgs, sender: "0x000000000000000000000000000000000000dEaD" });
    expect(await exec.invoke({ quoteId: "q_best", userConfirmed: true })).toMatch(/was made for sender/);
    expect(sent).toHaveLength(0);
  });

  it("refuses test-mode placeholder transactions", async () => {
    const api = fakeApi([], { built: { vm: "evm", chainId: 8453, to: ROUTER, data: "0x", value: "0", sandbox: true } });
    const { wallet, sent } = fakeEvmWallet();
    const actions = new LayerHopActionProvider(opts(api)).getActions(wallet);
    await find(actions, "layerhop_get_quote").invoke(sameChainQuoteArgs);
    expect(await find(actions, "layerhop_execute_swap").invoke({ quoteId: "q_best", userConfirmed: true })).toMatch(/sandbox/);
    expect(sent).toHaveLength(0);
  });

  it("signs a Solana quote with the SVM wallet provider", async () => {
    const b64 = serializedSvmTx();
    const api = fakeApi([], { built: { vm: "svm", serializedTx: b64 } });
    const signed: unknown[] = [];
    const wallet = {
      getAddress: () => SOL,
      getNetwork: () => ({ protocolFamily: "svm", networkId: "solana-mainnet" }),
      signAndSendTransaction: async (tx: unknown) => {
        signed.push(tx);
        return "4".repeat(88);
      },
    } as unknown as WalletProvider;
    const actions = new LayerHopActionProvider(opts(api)).getActions(wallet);
    await find(actions, "layerhop_get_quote").invoke(solanaQuoteArgs);
    const out = JSON.parse(await find(actions, "layerhop_execute_swap").invoke({ quoteId: "q_best", userConfirmed: true }));
    expect(signed[0]).toBeInstanceOf(VersionedTransaction);
    expect(out).toMatchObject({ txHash: "4".repeat(88), reported: true });
  });

  it("can be quote-only", () => {
    const actions = new LayerHopActionProvider({ ...opts(), enableSwapExecution: false }).getActions(fakeEvmWallet().wallet);
    expect(actions.some((a) => a.name === "layerhop_execute_swap")).toBe(false);
  });
});
