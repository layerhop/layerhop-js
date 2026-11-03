import type { ChainInfo, OnlyRoute } from "./assets.js";
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
  /** Can be delivered to, not sent from (Hyperliquid). */
  destinationOnly?: boolean;
}

/** LayerHop internal id for Solana (EVM chains use their real chain id). */
export const SOLANA_CHAIN_ID = 7565164;

/**
 * Tron (D-048). Its EVM-style chain id (0x2b6653dc), the id Relay uses too. Tron is built but OFF:
 * the API lists and quotes it only with TRON_ENABLED=1. So TRON_CHAIN is not part of CHAINS (the
 * static registry marketing pages and pickers list and count). `getChain` does resolve it, so
 * lookups by id (VM, explorer links, decimals) work wherever a Tron order or tx shows up.
 */
export const TRON_CHAIN_ID = 728126428;

/** Tron's registry entry, served by GET /v1/chains when TRON_ENABLED=1. */
export const TRON_CHAIN: ChainInfo = {
  id: TRON_CHAIN_ID,
  slug: "tron",
  name: "Tron",
  vm: "tvm",
  nativeSymbol: "TRX",
  nativeDecimals: 6,
  logoURI: "https://assets.relay.link/icons/728126428/light.png",
  explorerTx: "https://tronscan.org/#/transaction/",
  explorerAddress: "https://tronscan.org/#/address/",
  providers: ["relay"],
  popular: false,
};

/** Chains that are built but stay off until their flag is set (Tron: TRON_ENABLED). */
export const FLAGGED_CHAINS: readonly ChainInfo[] = [TRON_CHAIN];

export function isTronChain(chainId: ChainId): boolean {
  return chainId === TRON_CHAIN_ID;
}

/**
 * Hyperliquid (HyperCore: the perps/spot exchange, not HyperEVM 999). Relay's id, used as ours.
 * Accounts are 0x addresses, so it is treated as an EVM-style chain; it is a destination only
 * (withdrawals need Hyperliquid-signed actions we don't build). Its "native" coin is the perps USDC
 * balance (8 decimals), canonical address EVM_NATIVE (0x000…000) inside LayerHop.
 */
export const HYPERLIQUID_CHAIN_ID = 1337;
/** Relay's address for Hyperliquid perps USDC (16 bytes, not an EVM address). */
export const HYPERLIQUID_PERPS_USDC = "0x00000000000000000000000000000000";

/** Chains users can deliver to but not send from. */
export const DESTINATION_ONLY_CHAIN_IDS: ReadonlySet<ChainId> = new Set([HYPERLIQUID_CHAIN_ID]);

export function isDestinationOnly(chainId: ChainId): boolean {
  return DESTINATION_ONLY_CHAIN_IDS.has(chainId);
}

export const BLAST_CHAIN_ID = 81457;

/**
 * Providers that serve only one fixed route into a chain (D-035). A chain whose providers are ALL
 * listed here for it is destination-only and carries `onlyRoute` (computed by the API's chain
 * registry, so it lifts automatically if an aggregator lists the chain again).
 */
export const PROVIDER_ROUTE_RESTRICTIONS: Partial<Record<ProviderId, Readonly<Record<ChainId, OnlyRoute>>>> = {
  "blast-native": {
    [BLAST_CHAIN_ID]: {
      srcChainId: 1,
      srcToken: "0x0000000000000000000000000000000000000000",
      dstToken: "0x0000000000000000000000000000000000000000",
    },
  },
};

/** The fixed route into `chainId` when every one of `providers` is restricted to it there. */
export function onlyRouteFor(chainId: ChainId, providers: readonly ProviderId[]): OnlyRoute | undefined {
  if (providers.length === 0) return undefined;
  let route: OnlyRoute | undefined;
  for (const p of providers) {
    const r = PROVIDER_ROUTE_RESTRICTIONS[p]?.[chainId];
    if (!r) return undefined;
    route ??= r;
  }
  return route;
}

/** Whether a source chain/token pair and destination token match a chain's `onlyRoute`. */
export function matchesOnlyRoute(route: OnlyRoute, srcChainId: ChainId, srcToken: string, dstToken: string): boolean {
  return route.srcChainId === srcChainId && route.srcToken.toLowerCase() === srcToken.toLowerCase() && route.dstToken.toLowerCase() === dstToken.toLowerCase();
}

/**
 * Static chain registry: every chain at least one of our providers listed when it was last
 * generated (`pnpm --filter @layerhop/api gen:chains`, see docs/ASSETS_SPEC.md). The API
 * refreshes this live every hour; this list is the offline fallback. The original seven chains
 * come first, in their historical order.
 */
export const CHAINS: readonly ChainInfo[] = CHAIN_DATA;

/** Chain ids shown first in pickers (docs/ASSETS_SPEC.md). */
export const POPULAR_CHAIN_IDS: readonly ChainId[] = [1, 8453, 42161, SOLANA_CHAIN_ID, 56, 10, 137, 43114, 80094, 999, 146];

const chainMatch = (idOrSlug: ChainId | string) => (c: ChainInfo) => c.id === Number(idOrSlug) || c.slug === String(idOrSlug).toLowerCase();

/** A public chain by id or slug. Clients parse user input with this, so flagged chains never resolve there. */
export function getChain(idOrSlug: ChainId | string): ChainInfo | undefined {
  return CHAINS.find(chainMatch(idOrSlug));
}

/**
 * CHAINS, then FLAGGED_CHAINS (Tron). Server code only: the API and worker gate flagged chains by their
 * flag (TRON_ENABLED) before they reach this.
 */
export function getAnyChain(idOrSlug: ChainId | string): ChainInfo | undefined {
  return getChain(idOrSlug) ?? FLAGGED_CHAINS.find(chainMatch(idOrSlug));
}

export function isSameChain(a: ChainId, b: ChainId): boolean {
  return a === b;
}
