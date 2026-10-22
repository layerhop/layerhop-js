/**
 * Price-competitiveness check (services/worker/src/price-check.ts, `GET /v1/admin/price-check`):
 * the route basket, what "direct" means per provider, and the comparison math.
 */
import { HYPERLIQUID_CHAIN_ID, SOLANA_CHAIN_ID } from "./chains.js";
import { EVM_NATIVE, SOL_NATIVE } from "./tokens.js";
import type { ProviderId } from "./types.js";

export interface BasketToken {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  /** Fixed USD price (stablecoins); otherwise looked up at run time. */
  usdPeg?: number;
}

export interface BasketRoute {
  id: string;
  label: string;
  src: BasketToken;
  dst: BasketToken;
}

const USDC_BASE: BasketToken = { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, usdPeg: 1 };
const USDC_ARB: BasketToken = { chainId: 42161, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6, usdPeg: 1 };
const USDC_SOL: BasketToken = { chainId: SOLANA_CHAIN_ID, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, usdPeg: 1 };
/** Hyperliquid perps USDC (destination only, Relay): LayerHop's native-coin address, 8 decimals. */
const USDC_HL: BasketToken = { chainId: HYPERLIQUID_CHAIN_ID, address: EVM_NATIVE, symbol: "USDC", decimals: 8, usdPeg: 1 };
const ETH_MAINNET: BasketToken = { chainId: 1, address: EVM_NATIVE, symbol: "ETH", decimals: 18 };
const ETH_BASE: BasketToken = { chainId: 8453, address: EVM_NATIVE, symbol: "ETH", decimals: 18 };
const SOL: BasketToken = { chainId: SOLANA_CHAIN_ID, address: SOL_NATIVE, symbol: "SOL", decimals: 9 };

/** The basket: popular routes, each checked at every size in PRICE_CHECK_SIZES_USD. */
export const PRICE_CHECK_BASKET: readonly BasketRoute[] = [
  { id: "usdc-base-arbitrum", label: "USDC Base → Arbitrum", src: USDC_BASE, dst: USDC_ARB },
  { id: "eth-ethereum-base", label: "ETH Ethereum → Base", src: ETH_MAINNET, dst: ETH_BASE },
  { id: "usdc-solana-base", label: "USDC Solana → Base", src: USDC_SOL, dst: USDC_BASE },
  { id: "sol-usdc-solana", label: "SOL → USDC on Solana", src: SOL, dst: USDC_SOL },
  { id: "usdc-arbitrum-hyperliquid", label: "USDC Arbitrum → Hyperliquid", src: USDC_ARB, dst: USDC_HL },
  { id: "eth-base-solana", label: "ETH Base → Solana (SOL)", src: ETH_BASE, dst: SOL },
];

export const PRICE_CHECK_SIZES_USD: readonly number[] = [50, 500, 5_000];

/** Unused placeholder wallets (the same ones the uptime monitor quotes with). Quotes only. */
export const PRICE_CHECK_EVM_ADDRESS = "0xd1667a3291f254bbd7feabac9c6f60752782586f";
export const PRICE_CHECK_SOL_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const PRICE_CHECK_SLIPPAGE_BPS = 50;

/**
 * What "direct" means per provider. The direct number is the provider's public API with no
 * integrator fee: protocol / solver fees inside the quote are included, but a fee the provider's own
 * website adds on top (an interface fee) is not visible to us, so the real site price can be equal
 * to or worse than the direct number.
 */
export const DIRECT_CAVEATS: Partial<Record<ProviderId, string>> = {
  relay: "Relay API without appFees. Relay's execution fees are included; relay.link may add its own app fee on top, which we can't see.",
  lifi: "LI.FI API without `fee`. Jumper (LI.FI's own UI) is a separate integrator and may add its own fee, which we can't see.",
  zerox: "0x API without swapFeeBps. 0x is API-only; its consumer UI (Matcha) may add its own fee on some pairs.",
  kyberswap: "KyberSwap aggregator API without feeAmount. The KyberSwap UI may add its own fee on some pairs.",
  jupiter: "Jupiter Ultra /order without a referral: this is the jup.ag price, including Jupiter's own platform fee where it charges one.",
  debridge: "DLN API without affiliateFeePercent. deBridge's protocol fee (fixed + bps) is included; any extra charged by the deBridge app is not.",
  mayan: "Mayan API without a referrer. Mayan's protocol fees are included; any fee added by Mayan's own UI is not.",
};

export function priceKey(t: Pick<BasketToken, "chainId" | "address">): string {
  return `${t.chainId}:${t.address.toLowerCase()}`;
}

/** Base-unit input for `sizeUsd` at `priceUsd` (6 significant decimals of the token, the rest zeros). */
export function amountForUsd(sizeUsd: number, priceUsd: number, decimals: number): string {
  if (!(priceUsd > 0) || !(sizeUsd > 0)) throw new Error("price and size must be > 0");
  const micro = BigInt(Math.round((sizeUsd / priceUsd) * 1e6));
  return decimals >= 6 ? (micro * 10n ** BigInt(decimals - 6)).toString() : (micro / 10n ** BigInt(6 - decimals)).toString();
}

/** USD value of a base-unit amount, or undefined without a price. */
export function usdValue(amount: string, decimals: number, priceUsd: number | undefined): number | undefined {
  if (priceUsd === undefined) return undefined;
  return Math.round((Number(amount) / 10 ** decimals) * priceUsd * 100) / 100;
}

/** (bestDirect − ours) / bestDirect in bps, two decimals. > 0: we deliver less. */
export function gapBps(ours: string, bestDirect: string): number {
  const d = BigInt(bestDirect);
  if (d === 0n) throw new Error("bestDirect is 0");
  // Hundredths of a bp, rounded half away from zero.
  const num = (d - BigInt(ours)) * 1_000_000n;
  const q = num / d;
  const r = num % d;
  const rounded = r * 2n >= d ? q + 1n : r * 2n <= -d ? q - 1n : q;
  return Number(rounded) / 100;
}

/** Fee (bps) at which our output would equal the best direct output, assuming the fee scales linearly. */
export function breakEvenFeeBps(appliedFeeBps: number, gap: number): number {
  return Math.round((appliedFeeBps - gap) * 100) / 100;
}
