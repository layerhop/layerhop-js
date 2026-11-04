import type { ProviderQuote } from "./types.js";

/** Output penalty per minute of ETA beyond the first minute (1 bp/min), capped at 50 bps. */
export const ETA_PENALTY_BPS_PER_MIN = 1;
export const ETA_PENALTY_MAX_BPS = 50;

/**
 * Output adjusted for waiting time, so a route 0.1% better but 18 minutes slower doesn't win.
 * Never involves what a route pays us.
 */
export function effectiveOutput(q: ProviderQuote): bigint {
  const slowMinutes = Math.max(0, Math.ceil((q.estimatedSeconds - 60) / 60));
  const penaltyBps = Math.min(ETA_PENALTY_MAX_BPS, slowMinutes * ETA_PENALTY_BPS_PER_MIN);
  return (BigInt(q.dstAmount) * BigInt(10_000 - penaltyBps)) / 10_000n;
}

/**
 * Exact-output quotes (receive exact amount: checkout, destination calls) wait on a payer who is
 * watching the page, so slowness costs more: 10 bps of input per minute beyond the first, capped at
 * 150 bps. Base → Arbitrum USDC for $1.50 (2026-11-04): an 18-minute LI.FI route 1.4 cents (0.9%)
 * cheaper than Relay's 1-second route no longer wins.
 */
export const EXACT_OUT_ETA_PENALTY_BPS_PER_MIN = 10;
export const EXACT_OUT_ETA_PENALTY_MAX_BPS = 150;

/** Input adjusted for waiting time, for exact-output quotes. Never involves what a route pays us. */
export function effectiveInput(q: ProviderQuote & { srcAmount: string }): bigint {
  const slowMinutes = Math.max(0, Math.ceil((q.estimatedSeconds - 60) / 60));
  const penaltyBps = Math.min(EXACT_OUT_ETA_PENALTY_MAX_BPS, slowMinutes * EXACT_OUT_ETA_PENALTY_BPS_PER_MIN);
  return (BigInt(q.srcAmount) * BigInt(10_000 + penaltyBps)) / 10_000n;
}

/**
 * Best for the user first: highest time-adjusted output, then fastest. Never rank by what pays us most.
 * Quotes that deliver requested gas on arrival come first: their output is lower by the gas they
 * add, so comparing them with routes that ignored the request would always punish them.
 */
export function rankQuotes(quotes: ProviderQuote[]): ProviderQuote[] {
  return [...quotes].sort((a, b) => {
    const gas = Number(!a.gasOnArrival) - Number(!b.gasOnArrival);
    if (gas !== 0) return gas;
    // Exact-output quotes (receive exact amount, destination calls) deliver the same amount: the
    // cheaper time-adjusted input wins, then the faster.
    if (a.srcAmount !== undefined && b.srcAmount !== undefined) {
      const d = effectiveInput(a as ProviderQuote & { srcAmount: string }) - effectiveInput(b as ProviderQuote & { srcAmount: string });
      if (d !== 0n) return d < 0n ? -1 : 1;
      return a.estimatedSeconds - b.estimatedSeconds;
    }
    const diff = effectiveOutput(b) - effectiveOutput(a);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return a.estimatedSeconds - b.estimatedSeconds;
  });
}
