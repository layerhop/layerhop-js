/**
 * Fee tiers by token class (D-058, built OFF): a trade is `stable`, `major` or `longtail`, and the API
 * may charge a different LayerHop fee per channel and class (`FEE_TIERS_JSON`). Unset = every trade
 * pays the channel fee, as before. Pure: no network, only the token lists we curate.
 */
import { HYPERLIQUID_CHAIN_ID, HYPERLIQUID_PERPS_USDC, SOLANA_CHAIN_ID, TRON_CHAIN_ID } from "./chains.js";
import { FLAGGED_TOKENS, isNative } from "./tokens.js";
import { listedMajorTokens, normalizeSymbol } from "./token-risk.js";
import type { ChainId, FeeChannel } from "./types.js";

/** Ordered from least to most risky. */
export const FEE_TIERS = ["stable", "major", "longtail"] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

/** `FEE_TIERS_JSON`: LayerHop fee in bps per channel and class. Missing entries use the channel fee. */
export type FeeTierTable = Partial<Record<FeeChannel, Partial<Record<FeeTier, number>>>>;

const FEE_CHANNELS: readonly FeeChannel[] = ["web", "widget", "api", "bot"];

/** Symbols of the listed tokens that count as stablecoins (normalized, see normalizeSymbol). */
export const STABLE_SYMBOLS: ReadonlySet<string> = new Set(["USDC", "USDC.E", "USDT", "USDT0", "DAI", "USDE"]);

const sameAddress = (chainId: ChainId, a: string, b: string) =>
  chainId === SOLANA_CHAIN_ID || chainId === TRON_CHAIN_ID ? a === b : a.toLowerCase() === b.toLowerCase();

/**
 * Class of one token. `major`: the chain's native coin, or a listed major (curated TOKENS,
 * CANONICAL_TOKENS, the verified extra majors of the token-risk check: wrapped natives, ETH / BTC
 * variants …). `stable`: a listed token whose symbol is a stablecoin (USDC, USDT, DAI …), or
 * Hyperliquid perps USDC.
 * Everything else (unlisted, new, memecoins) is `longtail`.
 */
export function tokenFeeTier(chainId: ChainId, address: string): FeeTier {
  // Hyperliquid's "native" coin (EVM_NATIVE inside LayerHop, Relay's 16-byte id) is perps USDC.
  if (chainId === HYPERLIQUID_CHAIN_ID && (isNative(chainId, address) || address.toLowerCase() === HYPERLIQUID_PERPS_USDC)) return "stable";
  if (isNative(chainId, address)) return "major";
  const listed = [...listedMajorTokens(chainId), ...FLAGGED_TOKENS.filter((t) => t.chainId === chainId)]
    .find((t) => sameAddress(chainId, t.address, address));
  if (!listed) return "longtail";
  return STABLE_SYMBOLS.has(normalizeSymbol(listed.symbol)) ? "stable" : "major";
}

/** The riskier of two classes (stable < major < longtail). */
export function riskierTier(a: FeeTier, b: FeeTier): FeeTier {
  return FEE_TIERS.indexOf(a) >= FEE_TIERS.indexOf(b) ? a : b;
}

/** A trade's class: the riskier side, so `stable` only when both sides are stablecoins. */
export function tradeFeeTier(srcChainId: ChainId, srcToken: string, dstChainId: ChainId, dstToken: string): FeeTier {
  return riskierTier(tokenFeeTier(srcChainId, srcToken), tokenFeeTier(dstChainId, dstToken));
}

/** LayerHop's fee for a channel and class: the tier entry when set, else the channel fee. */
export function tieredFeeBps(channelFees: Record<FeeChannel, number>, tiers: FeeTierTable | undefined, channel: FeeChannel, tier: FeeTier): number {
  return tiers?.[channel]?.[tier] ?? channelFees[channel];
}

/**
 * Parse + validate `FEE_TIERS_JSON`. Unset or blank → undefined (tiers off). Throws (fail fast at
 * startup) on unknown channels or classes, or a bps value that is not an integer 0..maxBps.
 */
export function parseFeeTiers(json: string | undefined, maxBps = 10_000): FeeTierTable | undefined {
  if (json === undefined || !json.trim()) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("FEE_TIERS_JSON is not valid JSON");
  }
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObject(raw)) throw new Error("FEE_TIERS_JSON must be an object keyed by channel (web, widget, api, bot)");
  const out: FeeTierTable = {};
  for (const [channel, classes] of Object.entries(raw)) {
    if (!FEE_CHANNELS.includes(channel as FeeChannel)) throw new Error(`FEE_TIERS_JSON: unknown channel "${channel}" (web, widget, api, bot)`);
    if (!isObject(classes)) throw new Error(`FEE_TIERS_JSON["${channel}"] must be an object keyed by class (stable, major, longtail)`);
    const row: Partial<Record<FeeTier, number>> = {};
    for (const [tier, bps] of Object.entries(classes)) {
      if (!FEE_TIERS.includes(tier as FeeTier)) throw new Error(`FEE_TIERS_JSON["${channel}"]: unknown class "${tier}" (stable, major, longtail)`);
      if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > maxBps) {
        throw new Error(`FEE_TIERS_JSON["${channel}"]["${tier}"] must be an integer 0..${maxBps}`);
      }
      row[tier as FeeTier] = bps;
    }
    out[channel as FeeChannel] = row;
  }
  return out;
}
