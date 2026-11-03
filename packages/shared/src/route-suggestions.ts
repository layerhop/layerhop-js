/**
 * No-route suggestions (D-053). When `/v1/quote` ends in `NO_ROUTE` (live mode, no destination
 * calls), the API tries a few cheap alternatives and returns the ones that quoted in
 * `error.details.suggestions`, so apps can offer them as one click instead of a dead end:
 * - `dst_token`: same payment, a different token on the destination chain (its stablecoin or native coin);
 * - `src_token`: the same destination token, paid with the source chain's stablecoin or native coin
 *   (the same USD value);
 * - `via_hub`: two signed steps through a hub chain (Arbitrum, Base or Ethereum): source → hub USDC,
 *   then hub USDC → the destination token. Both legs quoted.
 *
 * Every amount is base units of that leg's source token. `dstAmount` is an estimate from the check
 * quote (scaled when the answer came from the 30-minute cache); apps quote again before signing.
 */

export type RouteSuggestionKind = "dst_token" | "src_token" | "via_hub";

/** One quotable leg: the same fields a `/v1/quote` request takes (chain ids, token addresses, base units). */
export interface RouteLeg {
  srcChain: number;
  srcToken: string;
  amount: string;
  dstChain: number;
  dstToken: string;
  /** Estimated output of this leg, base units of `dstToken`. */
  dstAmount?: string;
}

export interface RouteSuggestion extends RouteLeg {
  kind: RouteSuggestionKind;
  /** Short human text, e.g. "Receive USDC on Ethereum instead". */
  message: string;
  /** The token that changed (the new source or destination token, or the hub token), for labels. */
  symbol?: string;
  /** `via_hub` only: the two legs in order. The top-level fields describe the whole trip. */
  steps?: [RouteLeg, RouteLeg];
  /** `via_hub` only: the chain and token between the two steps. */
  hub?: { chainId: number; token: string; symbol: string; decimals: number };
}

/** At most this many suggestions per answer. */
export const MAX_ROUTE_SUGGESTIONS = 4;

const DIGITS = /^\d{1,78}$/;
const isLeg = (x: unknown): x is RouteLeg => {
  if (!x || typeof x !== "object") return false;
  const l = x as Record<string, unknown>;
  return (
    Number.isInteger(l.srcChain) && Number.isInteger(l.dstChain) && typeof l.srcToken === "string" && typeof l.dstToken === "string" &&
    typeof l.amount === "string" && DIGITS.test(l.amount) && l.amount !== "0" &&
    (l.dstAmount === undefined || (typeof l.dstAmount === "string" && DIGITS.test(l.dstAmount)))
  );
};

/**
 * `details.suggestions` of an error, validated (apps must not trust the shape blindly). Invalid
 * entries are dropped; anything that isn't an array gives [].
 */
export function parseRouteSuggestions(details: unknown): RouteSuggestion[] {
  const raw = (details as { suggestions?: unknown } | null | undefined)?.suggestions;
  if (!Array.isArray(raw)) return [];
  const out: RouteSuggestion[] = [];
  for (const s of raw) {
    if (!isLeg(s)) continue;
    const r = s as unknown as Record<string, unknown>;
    if (r.kind !== "dst_token" && r.kind !== "src_token" && r.kind !== "via_hub") continue;
    if (typeof r.message !== "string") continue;
    if (r.kind === "via_hub") {
      const steps = r.steps;
      const hub = r.hub as Record<string, unknown> | undefined;
      if (!Array.isArray(steps) || steps.length !== 2 || !steps.every(isLeg)) continue;
      if (!hub || !Number.isInteger(hub.chainId) || typeof hub.token !== "string" || typeof hub.symbol !== "string" || !Number.isInteger(hub.decimals)) continue;
    }
    out.push(s as RouteSuggestion);
    if (out.length >= MAX_ROUTE_SUGGESTIONS) break;
  }
  return out;
}
