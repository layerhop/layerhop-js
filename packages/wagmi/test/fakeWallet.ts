// A fake EIP-1193 wallet + chain for tests. It never signs anything and never touches a network:
// every request is answered from memory and recorded, so tests can assert what the wallet was asked.
import { createConfig, createConnector } from "wagmi";
import { connect } from "wagmi/actions";
import { custom, encodeAbiParameters, numberToHex, type Address, type Hex } from "viem";
import { base } from "viem/chains";

export const ACCOUNT: Address = "0x1111111111111111111111111111111111111111";
export const TOKEN: Address = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const SPENDER: Address = "0x2222222222222222222222222222222222222222";
export const ROUTER: Address = "0x3333333333333333333333333333333333333333";
export const FEE_RECIPIENT: Address = "0x4444444444444444444444444444444444444444";

export interface FakeWalletOptions {
  /** `wallet_getCapabilities` answer for Base; `null` = method not supported. */
  capabilities?: Record<string, unknown> | null;
  /** Throw this from `wallet_sendCalls`. */
  sendCallsError?: { code: number; message: string };
  /** Throw this from `eth_sendTransaction` call number N (0-based). */
  sendTxError?: { index: number; code: number; message: string };
  allowance?: bigint;
  chainId?: number;
  receiptStatus?: "0x1" | "0x0";
}

export interface Req {
  method: string;
  params?: unknown;
}

const hashOf = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;

export function fakeWallet(opts: FakeWalletOptions = {}) {
  const requests: Req[] = [];
  let chainId = opts.chainId ?? base.id;
  let sent = 0;
  const batches = new Map<string, Hex>();

  const receipt = (hash: Hex) => ({
    blockHash: hashOf(999), blockNumber: "0x10", contractAddress: null, cumulativeGasUsed: "0x1", effectiveGasPrice: "0x1",
    from: ACCOUNT, gasUsed: "0x1", logs: [], logsBloom: `0x${"0".repeat(512)}`, status: opts.receiptStatus ?? "0x1",
    to: ROUTER, transactionHash: hash, transactionIndex: "0x0", type: "0x2",
  });

  async function request({ method, params }: Req): Promise<unknown> {
    requests.push({ method, params });
    switch (method) {
      case "eth_chainId":
        return numberToHex(chainId);
      case "eth_accounts":
      case "eth_requestAccounts":
        return [ACCOUNT];
      case "wallet_switchEthereumChain":
        chainId = Number((params as [{ chainId: Hex }])[0].chainId);
        return null;
      case "eth_call":
        return encodeAbiParameters([{ type: "uint256" }], [opts.allowance ?? 0n]);
      case "eth_blockNumber":
        return "0x20";
      case "wallet_getCapabilities":
        if (opts.capabilities === null || opts.capabilities === undefined) throw Object.assign(new Error("Method not found"), { code: -32601 });
        return { [numberToHex(chainId)]: opts.capabilities };
      case "wallet_sendCalls": {
        if (opts.sendCallsError) throw Object.assign(new Error(opts.sendCallsError.message), { code: opts.sendCallsError.code });
        const id = `0xbatch${batches.size}`;
        batches.set(id, hashOf(0xb000 + batches.size));
        return { id };
      }
      case "wallet_getCallsStatus": {
        const id = (params as [string])[0];
        const hash = batches.get(id)!;
        return { version: "2.0.0", id, chainId: numberToHex(chainId), atomic: true, status: 200, receipts: [receipt(hash)] };
      }
      case "eth_sendTransaction": {
        const n = sent++;
        if (opts.sendTxError?.index === n) throw Object.assign(new Error(opts.sendTxError.message), { code: opts.sendTxError.code });
        return hashOf(0xa000 + n);
      }
      case "eth_getTransactionReceipt":
        return receipt((params as [Hex])[0]);
      case "eth_getTransactionByHash":
        return null;
      case "eth_estimateGas":
        return "0x5208";
      default:
        throw Object.assign(new Error(`fake wallet: unexpected ${method}`), { code: -32601 });
    }
  }

  const provider = { request: (a: Req) => request(a), on: () => undefined, removeListener: () => undefined };
  const methods = () => requests.map((r) => r.method);
  const of = (method: string) => requests.filter((r) => r.method === method);
  return { request, provider, requests, methods, of };
}

export type FakeWallet = ReturnType<typeof fakeWallet>;

/** A wagmi connector over the fake wallet. */
export function fakeConnector(w: FakeWallet) {
  return createConnector((config) => ({
    id: "fake",
    name: "Fake Wallet",
    type: "fake",
    async connect() {
      const chainId = Number(await w.request({ method: "eth_chainId" }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { accounts: [ACCOUNT], chainId } as any;
    },
    async disconnect() {},
    async getAccounts() {
      return [ACCOUNT];
    },
    async getChainId() {
      return Number(await w.request({ method: "eth_chainId" }));
    },
    async getProvider() {
      return w.provider;
    },
    async isAuthorized() {
      return true;
    },
    async switchChain({ chainId }) {
      await w.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] });
      config.emitter.emit("change", { chainId });
      return config.chains.find((c) => c.id === chainId)!;
    },
    onAccountsChanged() {},
    onChainChanged(chain) {
      config.emitter.emit("change", { chainId: Number(chain) });
    },
    onDisconnect() {},
  }));
}

/** wagmi config whose chain reads also go to the fake wallet (no network). */
export function fakeConfig(w: FakeWallet) {
  return createConfig({
    chains: [base],
    connectors: [fakeConnector(w)],
    transports: { [base.id]: custom({ request: w.request }) },
    pollingInterval: 5,
    batch: { multicall: false },
  });
}

/** Connects the fake connector (its loose test typing does not satisfy the generics of wagmi connect). */
export async function connectFake(config: ReturnType<typeof fakeConfig>) {
  await connect(config, { connector: config.connectors[0]! } as never);
}
