import { SOLANA_CHAIN_ID, TRON_CHAIN_ID } from "./chains.js";
import type { TronApiConfig } from "./types.js";
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
  // Tron (D-048): TronGrid's Ethereum-compatible JSON-RPC (eth_getTransactionByHash / eth_getTransactionReceipt
  // / eth_call with 0x-hex accounts and 0x-prefixed tx hashes; eth_chainId 0x2b6653dc, checked 2026-10-27).
  [TRON_CHAIN_ID]: "https://api.trongrid.io/jsonrpc",
};

export function rpcUrl(chainId: ChainId, env: Record<string, string | undefined> = {}): string | undefined {
  return env[`RPC_URL_${chainId}`] ?? (chainId === SOLANA_CHAIN_ID ? env.SOLANA_RPC_URL : undefined) ?? DEFAULT_RPC_URLS[chainId];
}

/**
 * Endpoints for eth_getLogs scans (checkout transfers and deposit addresses) where the default RPC
 * can't serve them: bsc-dataseed answers "limit exceeded" to any log query and mainnet.base.org
 * rate-limits them (429); PublicNode serves a 9,000-block range on both (checked 2026-11-04). Only for
 * logs: PublicNode answers a receipt it hasn't seen with an error ("Archive requests require a personal
 * token"), not null, so it can't be a default for tx tracking. Override with env LOGS_RPC_URL_<chainId>.
 */
export const LOGS_RPC_URLS: Readonly<Record<ChainId, string>> = {
  56: "https://bsc-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
};

export function logsRpcUrl(chainId: ChainId, env: Record<string, string | undefined> = {}): string | undefined {
  return env[`LOGS_RPC_URL_${chainId}`] ?? LOGS_RPC_URLS[chainId] ?? rpcUrl(chainId, env);
}

/**
 * Second public endpoints that served old receipts (eth_chainId and a ~20k-block-old
 * eth_getTransactionReceipt checked 2026-10-22). Tried after the primary fails. Base: Tenderly's public
 * gateway (bursts, null for an unseen receipt, old receipts, CORS and 1,000-block log ranges, checked
 * 2026-11-04; drpc and the others fail the log range, PublicNode errors on an unseen receipt).
 */
export const FALLBACK_RPC_URLS: Readonly<Record<ChainId, string>> = {
  1: "https://eth.drpc.org", 10: "https://optimism.drpc.org", 56: "https://bsc-dataseed1.defibit.io",
  137: "https://polygon-rpc.com", 8453: "https://base.gateway.tenderly.co", 42161: "https://arbitrum.drpc.org",
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

/**
 * Tron full-node HTTP API (D-048: building and simulating txs, `wallet/*`): TronGrid by default,
 * override with TRON_API_URL. Receipts and tx lookups use the JSON-RPC endpoint in DEFAULT_RPC_URLS.
 * TRONGRID_API_KEY, when set, is sent as `TRON-PRO-API-KEY` (higher rate limits; public works keyless).
 */
export const DEFAULT_TRON_API_URL = "https://api.trongrid.io";

export function tronApiConfig(env: Record<string, string | undefined> = {}): TronApiConfig {
  const url = (env.TRON_API_URL || DEFAULT_TRON_API_URL).replace(/\/+$/, "");
  return env.TRONGRID_API_KEY ? { url, apiKey: env.TRONGRID_API_KEY } : { url };
}
