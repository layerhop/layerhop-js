import type { ChainId, ProviderId, Vm } from "./types.js";
import type { ChainRouteHealth } from "./route-health.js";

/**
 * Asset registry contract (docs/ASSETS_SPEC.md): what `GET /v1/chains`, `/v1/tokens`,
 * `/v1/tokens/lookup`, `/v1/prices` and `/v1/balances` return.
 */

/** A chain as served by `GET /v1/chains`. */
export interface ChainInfo {
  /** EVM chain id; Solana = 7565164 (LayerHop internal id). */
  id: ChainId;
  /** Unique lowercase short name ("base", "berachain", "solana"). */
  slug: string;
  name: string;
  vm: Vm;
  nativeSymbol: string;
  nativeDecimals: number;
  /** https URL of the chain logo (provider CDN). */
  logoURI: string;
  /** Explorer prefix: `${explorerTx}${hash}`. */
  explorerTx: string;
  /** Explorer prefix: `${explorerAddress}${address}`. */
  explorerAddress: string;
  /** Providers that can route from or to this chain (any direction). */
  providers: ProviderId[];
  /** Shown first in pickers. */
  popular: boolean;
  /**
   * Can be delivered to but not sent from (Hyperliquid; Blast while its only provider is the canonical
   * bridge). Hide it from source pickers.
   */
  destinationOnly?: boolean;
  /**
   * Set when every provider of this chain serves one fixed route into it (Blast: ETH on Ethereum →
   * ETH on Blast via the canonical bridge, D-035). Quotes into the chain from anything else fail with
   * UNSUPPORTED_CHAIN; apps should offer to switch the source instead.
   */
  onlyRoute?: OnlyRoute;
  /**
   * Result of the periodic route probes (D-036). Absent until the chain has been checked (or when the
   * API runs without route health). `status: "unavailable"` chains stay listed so developers can see
   * why; LayerHop's own apps hide them from pickers.
   */
  routeHealth?: ChainRouteHealth;
}

/** The single route into a route-restricted chain. */
export interface OnlyRoute {
  srcChainId: ChainId;
  /** Source token address (EVM native = 0x000…000). */
  srcToken: string;
  /** Destination token address on this chain. */
  dstToken: string;
}

/** A token as served by `GET /v1/tokens` and `/v1/tokens/lookup`. */
export interface TokenInfo {
  chainId: ChainId;
  /** EVM: checksummed, native = 0x000…000. Solana: mint, native SOL = So111…112. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  priceUsd?: number;
  /** On a provider list or our curated list. Tokens read on-chain only are `false`. */
  verified: boolean;
  /** Stables, wrapped native and majors on that chain. */
  popular?: boolean;
}

/** A non-zero wallet balance (`GET /v1/balances`). */
export interface Balance extends TokenInfo {
  /** Base units, integer string, > 0. */
  amount: string;
  valueUsd?: number;
}

export interface TokensResponse {
  tokens: TokenInfo[];
  nextCursor: string | null;
}

export interface PricesResponse {
  /** Key: `chainId:address` exactly as requested. Value: USD price. Unknown ids are omitted. */
  prices: Record<string, number>;
}

export interface BalancesResponse {
  address: string;
  vm: Vm;
  balances: Balance[];
  totalUsd: number;
  errors: { chainId: ChainId; message: string }[];
}

/** Address family of a wallet / token address, or undefined if it is neither. */
export function addressVm(address: string): Vm | undefined {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "evm";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "svm";
  return undefined;
}
