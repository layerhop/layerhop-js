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

/** Best for the user first: highest time-adjusted output, then fastest. Never rank by what pays us most. */
export function rankQuotes(quotes: ProviderQuote[]): ProviderQuote[] {
  return [...quotes].sort((a, b) => {
    const diff = effectiveOutput(b) - effectiveOutput(a);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return a.estimatedSeconds - b.estimatedSeconds;
  });
}
