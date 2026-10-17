import { SOLANA_CHAIN_ID } from "./chains.js";
import type { ChainId } from "./types.js";

/** Canonical address for a chain's native coin inside LayerHop. Providers map it to their own sentinel. */
export const EVM_NATIVE = "0x0000000000000000000000000000000000000000";
export const SOL_NATIVE = "So11111111111111111111111111111111111111112"; // wrapped SOL mint; providers treat it as SOL

export interface Token {
  chainId: ChainId;
  address: string;
  symbol: string;
  decimals: number;
}

const evmNative = (chainId: ChainId, symbol = "ETH"): Token => ({ chainId, address: EVM_NATIVE, symbol, decimals: 18 });

export const TOKENS: readonly Token[] = [
  evmNative(1), evmNative(42161), evmNative(8453), evmNative(10), evmNative(56, "BNB"), evmNative(137, "POL"),
  { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
  { chainId: 1, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
  { chainId: 42161, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6 },
  { chainId: 42161, address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", decimals: 6 },
  { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
  { chainId: 10, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 },
  { chainId: 56, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", decimals: 18 },
  { chainId: 56, address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", decimals: 18 },
  { chainId: 137, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", decimals: 6 },
  { chainId: SOLANA_CHAIN_ID, address: SOL_NATIVE, symbol: "SOL", decimals: 9 },
  { chainId: SOLANA_CHAIN_ID, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
  { chainId: SOLANA_CHAIN_ID, address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6 },
];

export function tokensForChain(chainId: ChainId): Token[] {
  return TOKENS.filter((t) => t.chainId === chainId);
}

/** Resolve a symbol ("USDC") or address to a known token on a chain. Unknown addresses pass through as undefined. */
export function findToken(chainId: ChainId, symbolOrAddress: string): Token | undefined {
  const q = symbolOrAddress.toLowerCase();
  return TOKENS.find((t) => t.chainId === chainId && (t.symbol.toLowerCase() === q || t.address.toLowerCase() === q));
}

export function isNative(chainId: ChainId, address: string): boolean {
  return chainId === SOLANA_CHAIN_ID ? address === SOL_NATIVE : address.toLowerCase() === EVM_NATIVE;
}
