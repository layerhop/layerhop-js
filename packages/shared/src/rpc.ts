import { SOLANA_CHAIN_ID } from "./chains.js";
import { RPC_DATA } from "./chains.data.js";
import type { ChainId } from "./types.js";

/**
 * Default public JSON-RPC endpoints (override per chain with env RPC_URL_<chainId>, e.g. RPC_URL_8453).
 * The original chains use PublicNode; the rest are public RPCs published by the chains / our
 * providers that answered `eth_chainId` correctly when the registry was generated (chains.data.ts).
 */
export const DEFAULT_RPC_URLS: Readonly<Record<ChainId, string>> = {
  ...RPC_DATA,
  1: "https://ethereum-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  [SOLANA_CHAIN_ID]: "https://api.mainnet-beta.solana.com",
};

export function rpcUrl(chainId: ChainId, env: Record<string, string | undefined> = {}): string | undefined {
  return env[`RPC_URL_${chainId}`] ?? (chainId === SOLANA_CHAIN_ID ? env.SOLANA_RPC_URL : undefined) ?? DEFAULT_RPC_URLS[chainId];
}
