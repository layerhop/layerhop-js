import { defineChain, erc20Abi, type Address, type Chain, type Client, type WalletClient } from "viem";
import {
  getAddresses as viemGetAddresses,
  getCapabilities as viemGetCapabilities,
  getChainId as viemGetChainId,
  readContract as viemReadContract,
  sendCalls as viemSendCalls,
  sendTransaction as viemSendTransaction,
  switchChain as viemSwitchChain,
  waitForCallsStatus as viemWaitForCallsStatus,
  waitForTransactionReceipt as viemWaitForTransactionReceipt,
} from "viem/actions";
import type { Config, Connector } from "wagmi";
import {
  getAccount,
  getCapabilities,
  readContract,
  sendCalls,
  sendTransaction,
  switchChain,
  waitForCallsStatus,
  waitForTransactionReceipt,
} from "wagmi/actions";
import type { EvmDriver } from "./core.js";

/** How long to wait for an EIP-5792 batch to land before giving up. */
export const CALLS_TIMEOUT_MS = 180_000;

export interface WagmiDriverOptions {
  /** Use this connector instead of the active one. */
  connector?: Connector;
}

/** An `EvmDriver` on a wagmi `Config` (the account and chain of its active connection). */
export function wagmiDriver(config: Config, opts: WagmiDriverOptions = {}): EvmDriver {
  const connector = opts.connector;
  return {
    getAccount: async () => {
      const a = getAccount(config);
      return { address: a.address, chainId: a.chainId };
    },
    switchChain: async (chainId) => {
      await switchChain(config, { chainId, connector });
    },
    readAllowance: ({ chainId, token, owner, spender }) =>
      readContract(config, { chainId, address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
    getCapabilities: ({ chainId, account }) => getCapabilities(config, { account, chainId, connector }),
    sendCalls: async ({ chainId, account, calls }) => (await sendCalls(config, { chainId, account, calls, forceAtomic: true, connector })).id,
    waitForCalls: ({ id }) => waitForCallsStatus(config, { id, timeout: CALLS_TIMEOUT_MS, connector }),
    sendTransaction: ({ chainId, account, call }) =>
      sendTransaction(config, { chainId, account, to: call.to, data: call.data, value: call.value, connector }),
    waitForReceipt: async ({ chainId, hash }) => (await waitForTransactionReceipt(config, { chainId, hash })).status === "success",
  };
}

export interface WalletClientDriverOptions {
  /**
   * Client for reads (allowance, receipts). Default: the wallet client itself (reads go through the
   * wallet's provider, which follows its current chain). Pass a function to pick one per chain.
   */
  publicClient?: Client | ((chainId: number) => Client);
  /** Chain definitions to use when the wallet switches to a chain other than `walletClient.chain`. */
  chains?: readonly Chain[];
}

/**
 * An `EvmDriver` on a viem `WalletClient`: embedded wallets (Privy, Dynamic, thirdweb, Coinbase
 * Smart Wallet SDK) and any EIP-1193 provider wrapped with `createWalletClient({ transport: custom(provider) })`.
 */
export function walletClientDriver(walletClient: WalletClient, opts: WalletClientDriverOptions = {}): EvmDriver {
  const reader = (chainId: number): Client =>
    typeof opts.publicClient === "function" ? opts.publicClient(chainId) : (opts.publicClient ?? walletClient);
  const chainFor = (chainId: number): Chain =>
    opts.chains?.find((c) => c.id === chainId) ??
    (walletClient.chain?.id === chainId
      ? walletClient.chain
      : defineChain({ id: chainId, name: `Chain ${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } }));
  const accountFor = (address: Address) => walletClient.account ?? address;
  return {
    getAccount: async () => {
      const address = walletClient.account?.address ?? (await viemGetAddresses(walletClient))[0];
      return { address, chainId: await viemGetChainId(walletClient) };
    },
    switchChain: async (chainId) => {
      await viemSwitchChain(walletClient, { id: chainId });
    },
    readAllowance: ({ chainId, token, owner, spender }) =>
      viemReadContract(reader(chainId), { address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
    getCapabilities: ({ chainId, account }) => viemGetCapabilities(walletClient, { account, chainId }),
    sendCalls: async ({ chainId, account, calls }) =>
      (await viemSendCalls(walletClient, { account: accountFor(account), chain: chainFor(chainId), calls, forceAtomic: true })).id,
    waitForCalls: ({ id }) => viemWaitForCallsStatus(walletClient, { id, timeout: CALLS_TIMEOUT_MS }),
    sendTransaction: ({ chainId, account, call }) =>
      viemSendTransaction(walletClient, { account: accountFor(account), chain: chainFor(chainId), to: call.to, data: call.data, value: call.value }),
    waitForReceipt: async ({ chainId, hash }) => (await viemWaitForTransactionReceipt(reader(chainId), { hash })).status === "success",
  };
}
