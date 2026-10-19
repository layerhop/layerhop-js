import { getChain, HYPERLIQUID_CHAIN_ID, SOLANA_CHAIN_ID } from "./chains.js";
import { isNative } from "./tokens.js";
import type { QuoteRequest } from "./types.js";

/** Gas on arrival defaults to $2 of the destination chain's native token (Relay's default too). */
export const DEFAULT_GAS_ON_ARRIVAL_USD = 2;
export const MIN_GAS_ON_ARRIVAL_USD = 0.5;
export const MAX_GAS_ON_ARRIVAL_USD = 20;

/**
 * Whether gas on arrival can apply to a route: cross-chain, to an EVM chain (not Solana, and not
 * Hyperliquid where trading needs no gas), with an output that isn't already the native token.
 */
export function gasOnArrivalApplies(r: Pick<QuoteRequest, "srcChainId" | "dstChainId" | "dstToken">): boolean {
  if (r.srcChainId === r.dstChainId) return false;
  if (r.dstChainId === SOLANA_CHAIN_ID || r.dstChainId === HYPERLIQUID_CHAIN_ID) return false;
  const vm = getChain(r.dstChainId)?.vm;
  if (vm !== undefined && vm !== "evm") return false;
  return !isNative(r.dstChainId, r.dstToken);
}

/** The gas-on-arrival USD amount actually in effect for a request, or undefined (off / not applicable). */
export function requestedGasOnArrivalUsd(
  r: Pick<QuoteRequest, "srcChainId" | "dstChainId" | "dstToken" | "gasOnArrivalUsd">,
): number | undefined {
  const usd = r.gasOnArrivalUsd;
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return undefined;
  return gasOnArrivalApplies(r) ? usd : undefined;
}
