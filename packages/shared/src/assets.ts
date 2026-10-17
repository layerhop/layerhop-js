import type { ChainId, ProviderId, Vm } from "./types.js";

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
