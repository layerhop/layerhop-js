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
  // PublicNode answers receipts older than a few minutes on these with 403 "Archive requests require
  // a personal token" (checked 2026-10-22), so the worker could never confirm an order it checked late.
  42161: "https://arb1.arbitrum.io/rpc",
  8453: "https://mainnet.base.org",
  10: "https://mainnet.optimism.io",
  56: "https://bsc-dataseed.binance.org",
  137: "https://polygon.drpc.org",
  [SOLANA_CHAIN_ID]: "https://api.mainnet-beta.solana.com",
};

export function rpcUrl(chainId: ChainId, env: Record<string, string | undefined> = {}): string | undefined {
  return env[`RPC_URL_${chainId}`] ?? (chainId === SOLANA_CHAIN_ID ? env.SOLANA_RPC_URL : undefined) ?? DEFAULT_RPC_URLS[chainId];
}

/**
 * Second public endpoints that served old receipts (eth_chainId and a ~20k-block-old
 * eth_getTransactionReceipt checked 2026-10-22). Tried after the primary fails.
 */
export const FALLBACK_RPC_URLS: Readonly<Record<ChainId, string>> = {
  1: "https://eth.drpc.org", 10: "https://optimism.drpc.org", 56: "https://bsc-dataseed1.defibit.io",
  137: "https://polygon-rpc.com", 8453: "https://base.drpc.org", 42161: "https://arbitrum.drpc.org",
  43114: "https://avalanche.drpc.org", 80094: "https://berachain.drpc.org", 146: "https://sonic.drpc.org",
  999: "https://hyperliquid.drpc.org", 130: "https://unichain.drpc.org", 59144: "https://linea.drpc.org",
  100: "https://rpc.gnosischain.com", 534352: "https://scroll.drpc.org", 5000: "https://mantle.drpc.org",
  324: "https://zksync.drpc.org", 252: "https://fraxtal.drpc.org", 34443: "https://mode.drpc.org",
  1329: "https://sei.drpc.org", 57073: "https://ink.drpc.org",
};

/** The primary endpoint (env override or default), then the fallback, without duplicates. */
export function rpcUrls(chainId: ChainId, env: Record<string, string | undefined> = {}): string[] {
  return [...new Set([rpcUrl(chainId, env), FALLBACK_RPC_URLS[chainId]].filter((u): u is string => !!u))];
}
