import { TOKENS, type Token } from "./tokens.js";
import type { ChainId } from "./types.js";

/**
 * Checkout ("pay with any token"): what a merchant can be paid in. Stablecoins only, so delivery can
 * be verified from token transfers on the settlement chain.
 */
export const SETTLEMENT_SYMBOLS = ["USDC", "USDT"] as const;

export const SETTLEMENT_TOKENS: readonly Token[] = TOKENS.filter((t) => (SETTLEMENT_SYMBOLS as readonly string[]).includes(t.symbol));

/** The settlement token for a chain + symbol or address, or undefined when it cannot settle checkouts. */
export function findSettlementToken(chainId: ChainId, symbolOrAddress: string): Token | undefined {
  const v = symbolOrAddress.trim();
  return SETTLEMENT_TOKENS.find((t) => t.chainId === chainId && (t.symbol === v.toUpperCase() || t.address.toLowerCase() === v.toLowerCase()));
}

export const CHECKOUT_MIN_MINUTES = 5;
export const CHECKOUT_MAX_MINUTES = 7 * 24 * 60;
export const CHECKOUT_DEFAULT_MINUTES = 60;
