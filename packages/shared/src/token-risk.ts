/**
 * Token risk reports (`GET /v1/tokens/{chain}/{address}/risk`): the shape the API returns and the
 * app shows before a user buys or receives a token, plus the "fake major" check (a token that
 * calls itself USDC, ETH, SOL … at an address that isn't the real one), which needs no network.
 */
import { SOLANA_CHAIN_ID } from "./chains.js";
import { CANONICAL_TOKENS, EVM_NATIVE, SOL_NATIVE, TOKENS } from "./tokens.js";
import type { ChainId } from "./types.js";

/** `unknown`: no report (the source is down or doesn't cover the chain). Never blocks a swap. */
export type TokenRiskLevel = "ok" | "caution" | "danger" | "unknown";

export type TokenRiskCode =
  | "honeypot"
  | "cannot_sell"
  | "cannot_buy"
  | "buy_tax"
  | "sell_tax"
  | "transfer_fee"
  | "mintable"
  | "balance_changeable"
  | "blacklist"
  | "transfers_pausable"
  | "freezable"
  | "proxy"
  | "hidden_owner"
  | "ownership_reclaimable"
  | "not_open_source"
  | "transfer_hook"
  | "few_holders"
  | "fake_symbol"
  | "airdrop_scam"
  | "fake_token"
  | "tax_modifiable"
  | "selfdestruct"
  | "external_call"
  | "closable"
  | "no_trading_data";

export interface TokenRiskReason {
  code: TokenRiskCode;
  level: "caution" | "danger";
  /** One plain sentence for the user. */
  message: string;
  /** Tax / fee in percent (buy_tax, sell_tax, transfer_fee), holder count (few_holders). */
  value?: number;
}

export interface TokenRisk {
  chainId: ChainId;
  address: string;
  level: TokenRiskLevel;
  /** A major we list ourselves (curated, native or canonical): never checked upstream, always `ok`. */
  verified: boolean;
  /** Symbol reported by the source or our token list, when known. */
  symbol?: string;
  reasons: TokenRiskReason[];
  /** Where the verdict came from. */
  source: "list" | "goplus" | "none";
  /** ISO time the report was made (cached up to 10 minutes). */
  checkedAt: string;
}

/** Symbols scammers copy most. A token using one of them at another address is flagged. */
export const MAJOR_SYMBOLS: ReadonlySet<string> = new Set([
  "USDC", "USDT", "USDT0", "DAI", "USDE", "ETH", "WETH", "BTC", "WBTC", "CBBTC", "SOL", "WSOL", "BNB", "WBNB", "POL", "WPOL", "MATIC", "AVAX", "WAVAX",
]);

/**
 * Real addresses of majors that are neither curated (TOKENS) nor in CANONICAL_TOKENS, keyed by
 * upper-case symbol. Checked read-only on chain (symbol(), code) on 2026-10-27. Used only here, so
 * the token list's ranking is unchanged.
 */
const EXTRA_MAJORS: Readonly<Record<number, Readonly<Record<string, readonly string[]>>>> = {
  1: {
    WETH: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"], WBTC: ["0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"],
    DAI: ["0x6B175474E89094C44Da98b954EedeAC495271d0F"], CBBTC: ["0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"],
  },
  42161: { WETH: ["0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"], WBTC: ["0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"], DAI: ["0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"] },
  // BNB Chain: Binance-Peg ETH is called "ETH" there.
  56: { WBNB: ["0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"], ETH: ["0x2170Ed0880ac9A755fd29B2688956BD959F933F8"] },
  137: { WPOL: ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"] },
};

const same = (chainId: ChainId, a: string, b: string) => (chainId === SOLANA_CHAIN_ID ? a === b : a.toLowerCase() === b.toLowerCase());

/** Upper-case symbol without spaces; "USD₮0" (Tether's own spelling) reads as USDT0. */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/₮/g, "T").replace(/\s+/g, "");
}

/**
 * The real addresses for a major symbol on a chain that we know of (curated, canonical, the native
 * coin when the symbol is the chain's own, and EXTRA_MAJORS). Empty = we can't tell on this chain.
 */
export function majorAddresses(chainId: ChainId, symbol: string, nativeSymbol?: string): string[] {
  const sym = normalizeSymbol(symbol);
  const out = new Set<string>();
  for (const t of TOKENS) if (t.chainId === chainId && normalizeSymbol(t.symbol) === sym) out.add(t.address);
  const canon = CANONICAL_TOKENS[chainId]?.[sym];
  if (canon) out.add(canon);
  for (const a of EXTRA_MAJORS[chainId]?.[sym] ?? []) out.add(a);
  if (nativeSymbol && normalizeSymbol(nativeSymbol) === sym) out.add(chainId === SOLANA_CHAIN_ID ? SOL_NATIVE : EVM_NATIVE);
  if (chainId === SOLANA_CHAIN_ID && (sym === "SOL" || sym === "WSOL")) out.add(SOL_NATIVE);
  return [...out];
}

/** True for a major we list ourselves: curated, canonical, EXTRA_MAJORS or the native coin. */
export function isListedMajor(chainId: ChainId, address: string): boolean {
  if (chainId === SOLANA_CHAIN_ID ? address === SOL_NATIVE : address.toLowerCase() === EVM_NATIVE) return true;
  if (TOKENS.some((t) => t.chainId === chainId && same(chainId, t.address, address))) return true;
  if (Object.values(CANONICAL_TOKENS[chainId] ?? {}).some((a) => same(chainId, a, address))) return true;
  return Object.values(EXTRA_MAJORS[chainId] ?? {}).some((list) => list.some((a) => same(chainId, a, address)));
}

/** The token contracts of the majors we list on a chain (curated, canonical, EXTRA_MAJORS; no native coin). */
export function listedMajorTokens(chainId: ChainId): { address: string; symbol: string; decimals?: number }[] {
  const out = new Map<string, { address: string; symbol: string; decimals?: number }>();
  const add = (t: { address: string; symbol: string; decimals?: number }) => {
    const k = chainId === SOLANA_CHAIN_ID ? t.address : t.address.toLowerCase();
    if (!out.has(k) && k !== EVM_NATIVE) out.set(k, t);
  };
  for (const t of TOKENS) if (t.chainId === chainId) add({ address: t.address, symbol: t.symbol, decimals: t.decimals });
  for (const [symbol, address] of Object.entries(CANONICAL_TOKENS[chainId] ?? {})) add({ address, symbol });
  for (const [symbol, list] of Object.entries(EXTRA_MAJORS[chainId] ?? {})) for (const address of list) add({ address, symbol });
  return [...out.values()];
}

export interface FakeMajor {
  /** The major it pretends to be (normalized). */
  symbol: string;
  /** The real address(es) on this chain. */
  realAddresses: string[];
}

/**
 * A token whose symbol is a major's (USDC, ETH, SOL …) but whose address is not one we know as that
 * major on this chain. `nativeSymbol`: the chain's native coin (an ERC-20 called "ETH" on an ETH
 * chain is always fake). Returns undefined when it is the real one or we can't tell.
 */
export function fakeMajor(chainId: ChainId, address: string, symbol: string | undefined, nativeSymbol?: string): FakeMajor | undefined {
  if (!symbol) return undefined;
  const sym = normalizeSymbol(symbol);
  if (!MAJOR_SYMBOLS.has(sym)) return undefined;
  const real = majorAddresses(chainId, sym, nativeSymbol);
  if (real.length === 0) return undefined;
  if (real.some((a) => same(chainId, a, address))) return undefined;
  return { symbol: sym, realAddresses: real };
}

/** danger > caution > ok; no reasons and no source = unknown. */
export function riskLevelOf(reasons: readonly TokenRiskReason[], sourced: boolean): TokenRiskLevel {
  if (reasons.some((r) => r.level === "danger")) return "danger";
  if (reasons.some((r) => r.level === "caution")) return "caution";
  return sourced ? "ok" : "unknown";
}
