/**
 * "Cheaper on another chain" alerts: the same canonical token on several chains. A token's variants
 * are every listed token (TOKENS, CANONICAL_TOKENS) in its group: a chain's native ETH and its
 * canonical WETH count as one asset ("ETH"); USDC is Circle's USDC only (bridged USDC.e is not the
 * same asset and is left out).
 */
import { CANONICAL_TOKENS, TOKENS } from "./tokens.js";
import { SOLANA_CHAIN_ID } from "./chains.js";
import type { ChainId } from "./types.js";

export interface ChainVariant {
  chainId: ChainId;
  address: string;
  symbol: string;
}

/** Symbols that are one asset across chains, keyed by the group name. */
const GROUP_OF: Readonly<Record<string, string>> = { ETH: "ETH", WETH: "ETH", USDC: "USDC", USDT: "USDT", DAI: "DAI", WBTC: "WBTC", CBBTC: "CBBTC" };

/** The cross-chain group of a symbol ("WETH" → "ETH"), or undefined when it isn't one. */
export function crossChainGroup(symbol: string): string | undefined {
  return GROUP_OF[symbol.trim().toUpperCase()];
}

let all: ChainVariant[] | undefined;
function variants(): ChainVariant[] {
  if (all) return all;
  // TOKENS leaves out chains behind a flag (Tron), so they are never suggested.
  const out: ChainVariant[] = TOKENS.map((t) => ({ chainId: t.chainId, address: t.address, symbol: t.symbol }));
  for (const [id, bySymbol] of Object.entries(CANONICAL_TOKENS)) {
    for (const [symbol, address] of Object.entries(bySymbol)) out.push({ chainId: Number(id), address, symbol });
  }
  all = out;
  return out;
}

const same = (chainId: ChainId, a: string, b: string) => (chainId === SOLANA_CHAIN_ID ? a === b : a.toLowerCase() === b.toLowerCase());

/** Every variant of a group, one per chain (the curated token wins over a canonical one). */
export function crossChainVariantsOf(group: string): ChainVariant[] {
  const g = group.trim().toUpperCase();
  const byChain = new Map<ChainId, ChainVariant>();
  for (const v of variants()) {
    if (crossChainGroup(v.symbol) !== g || byChain.has(v.chainId)) continue;
    byChain.set(v.chainId, v);
  }
  return [...byChain.values()];
}

/**
 * The listed token at `address` on `chainId`, with its group and the variants on other chains. Undefined
 * when the token isn't listed, isn't in a group, or its group exists on one chain only.
 */
export function crossChainVariants(chainId: ChainId, address: string): { group: string; self: ChainVariant; variants: ChainVariant[] } | undefined {
  const self = variants().find((v) => v.chainId === chainId && same(chainId, v.address, address));
  const group = self ? crossChainGroup(self.symbol) : undefined;
  if (!self || !group) return undefined;
  const list = crossChainVariantsOf(group);
  if (list.length < 2) return undefined;
  return { group, self, variants: list };
}
