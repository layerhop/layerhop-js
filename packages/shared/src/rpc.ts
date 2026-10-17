import { SOLANA_CHAIN_ID } from "./chains.js";
import type { ChainId } from "./types.js";

/** Default public JSON-RPC endpoints (override per chain with env RPC_URL_<chainId>, e.g. RPC_URL_8453). */
export const DEFAULT_RPC_URLS: Readonly<Record<ChainId, string>> = {
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
