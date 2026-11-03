import { SOLANA_CHAIN_ID, TRON_CHAIN_ID } from "./chains.js";
import type { ChainId } from "./types.js";

/** Canonical address for a chain's native coin inside LayerHop. Providers map it to their own sentinel. */
export const EVM_NATIVE = "0x0000000000000000000000000000000000000000";
export const SOL_NATIVE = "So11111111111111111111111111111111111111112"; // wrapped SOL mint; providers treat it as SOL
/** Native TRX: the T-address of the zero account (0x41 + 20 zero bytes), as Relay spells it too. */
export const TRX_NATIVE = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
/** Tether USDT (TRC-20) on Tron. */
export const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

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
  // Kaia: Stargate's USDC.e, the only Kaia stablecoin with a route (LI.FI via Stargate, both ways; checked
  // 2026-10-26). LI.FI's token list flags it, so it is listed here. Tether's own USDT on Kaia
  // (0xd077…4fDb) has no route yet and is left out.
  { chainId: 8217, address: "0xE2053BCf56D2030d2470Fb454574237cF9ee3D4B", symbol: "USDC.e", decimals: 6 },
  { chainId: SOLANA_CHAIN_ID, address: SOL_NATIVE, symbol: "SOL", decimals: 9 },
  { chainId: SOLANA_CHAIN_ID, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
  { chainId: SOLANA_CHAIN_ID, address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6 },
];

/**
 * Curated tokens of chains behind a flag (FLAGGED_CHAINS: Tron, D-048). Kept out of TOKENS, which
 * settlement options, deposit-address pickers and public counts are built from; `findToken` and
 * `tokensForChain` still resolve them.
 */
export const FLAGGED_TOKENS: readonly Token[] = [
  { chainId: TRON_CHAIN_ID, address: TRX_NATIVE, symbol: "TRX", decimals: 6 },
  { chainId: TRON_CHAIN_ID, address: TRON_USDT, symbol: "USDT", decimals: 6 },
];

/**
 * The canonical token for a popular symbol on chains that have no curated entry for it, used to pick
 * one token when several verified tokens share a symbol (native Circle USDC over bridged look-alikes,
 * the main WETH over wrapped copies). Keys are upper-case symbols. Checked on-chain (symbol, decimals)
 * and against the LI.FI list on 2026-10-22.
 */
export const CANONICAL_TOKENS: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  // Optimism
  10: {
    WETH: "0x4200000000000000000000000000000000000006", WBTC: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
  // Polygon
  137: {
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
  },
  // Sonic
  146: { USDC: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", WETH: "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b" },
  // HyperEVM: Circle's native USDC (6 decimals)
  999: { USDC: "0xb88339CB7199b77E23DB6E890353E22632Ba630f" },
  // Base
  8453: {
    WETH: "0x4200000000000000000000000000000000000006", USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  },
  // Plasma
  9745: { USDT0: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb" },
  // Avalanche: Circle's native USDC (not bridged USDC.e) and native USDt
  43114: { USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", USDT: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" },
};

/** The canonical address for `symbol` on a chain (see CANONICAL_TOKENS), if listed. */
export function canonicalTokenAddress(chainId: ChainId, symbol: string): string | undefined {
  return CANONICAL_TOKENS[chainId]?.[symbol.trim().toUpperCase()];
}

export function tokensForChain(chainId: ChainId): Token[] {
  return [...TOKENS, ...FLAGGED_TOKENS].filter((t) => t.chainId === chainId);
}

/** Resolve a symbol ("USDC") or address to a known token on a chain. Unknown addresses pass through as undefined. */
export function findToken(chainId: ChainId, symbolOrAddress: string): Token | undefined {
  const q = symbolOrAddress.toLowerCase();
  const match = (t: Token) => t.chainId === chainId && (t.symbol.toLowerCase() === q || t.address.toLowerCase() === q);
  return TOKENS.find(match) ?? FLAGGED_TOKENS.find(match);
}

/** Address of the chain's native coin inside LayerHop (EVM_NATIVE, SOL_NATIVE or TRX_NATIVE). */
export function nativeAddress(chainId: ChainId): string {
  return chainId === SOLANA_CHAIN_ID ? SOL_NATIVE : chainId === TRON_CHAIN_ID ? TRX_NATIVE : EVM_NATIVE;
}

export function isNative(chainId: ChainId, address: string): boolean {
  if (chainId === SOLANA_CHAIN_ID) return address === SOL_NATIVE;
  if (chainId === TRON_CHAIN_ID) return address === TRX_NATIVE;
  return address.toLowerCase() === EVM_NATIVE;
}
