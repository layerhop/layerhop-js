import type { ChainInfo } from "./assets.js";
import { CHAIN_DATA } from "./chains.data.js";
import type { ChainId, ProviderId, Vm } from "./types.js";

export interface Chain {
  id: ChainId;
  slug: string;
  name: string;
  vm: Vm;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerTx: string; // `${explorerTx}${hash}`
  explorerAddress?: string; // `${explorerAddress}${address}`
  logoURI?: string;
  /** Providers that route from or to this chain (snapshot; the API serves the live list). */
  providers?: ProviderId[];
  popular?: boolean;
}

/** LayerHop internal id for Solana (EVM chains use their real chain id). */
export const SOLANA_CHAIN_ID = 7565164;

/**
 * Static chain registry: every chain at least one of our providers listed when it was last
 * generated (`pnpm --filter @layerhop/api gen:chains`, see docs/ASSETS_SPEC.md). The API
 * refreshes this live every 6 h; this list is the offline fallback. The original seven chains
 * come first, in their historical order.
 */
export const CHAINS: readonly ChainInfo[] = CHAIN_DATA;

/** Chain ids shown first in pickers (docs/ASSETS_SPEC.md). */
export const POPULAR_CHAIN_IDS: readonly ChainId[] = [1, 8453, 42161, SOLANA_CHAIN_ID, 56, 10, 137, 43114, 80094, 999, 146];

export function getChain(idOrSlug: ChainId | string): ChainInfo | undefined {
  return CHAINS.find((c) => c.id === Number(idOrSlug) || c.slug === String(idOrSlug).toLowerCase());
}

export function isSameChain(a: ChainId, b: ChainId): boolean {
  return a === b;
}
