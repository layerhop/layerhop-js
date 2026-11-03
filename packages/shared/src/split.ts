/**
 * Split the bill (`layerhop.com/split/<id>`): one person (the creator) is owed a total in one token on
 * one chain; N participants each pay their share from any chain and token. Shares are integer base
 * units of the receive token (never floats) and always add up to the total exactly.
 *
 * A share counts as paid once filled LayerHop orders tagged with the split and that share delivered at
 * least `SPLIT_PAID_TOLERANCE_BPS` short of it to the creator (a cross-chain route's output varies a
 * little with slippage; the payer page sizes the payment to cover the share in full).
 */

export const SPLIT_MIN_PARTICIPANTS = 2;
export const SPLIT_MAX_PARTICIPANTS = 50;
export const SPLIT_NOTE_MAX = 140;
export const SPLIT_LABEL_MAX = 40;
/** A share is paid when the delivered amount is at most this short of it (0.5%). */
export const SPLIT_PAID_TOLERANCE_BPS = 50n;
/** `spl_` + 26 lowercase base32 characters (packages/db newId). */
export const SPLIT_ID_RE = /^spl_[0-9a-z]{26}$/;
export const SPLIT_STATUSES = ["open", "closed"] as const;
export type SplitStatus = (typeof SPLIT_STATUSES)[number];

/**
 * `total` split into `n` equal shares; the remainder (fewer than `n` base units) goes one unit each to
 * the first shares, so the shares differ by at most one unit and add up to `total`.
 */
export function equalShares(total: bigint, n: number): bigint[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("n must be a positive integer");
  if (total < 0n) throw new RangeError("total must be >= 0");
  const count = BigInt(n);
  const base = total / count;
  const rest = total % count;
  return Array.from({ length: n }, (_, i) => base + (BigInt(i) < rest ? 1n : 0n));
}

export type SharesCheck =
  | { ok: true; shares: bigint[] }
  | { ok: false; reason: "count" | "zero_share" | "sum_mismatch"; message: string };

/**
 * Validate custom shares (base units) against the total: between SPLIT_MIN_PARTICIPANTS and
 * SPLIT_MAX_PARTICIPANTS of them, each above zero, adding up to `total` exactly.
 */
export function checkShares(total: bigint, shares: readonly bigint[]): SharesCheck {
  if (shares.length < SPLIT_MIN_PARTICIPANTS || shares.length > SPLIT_MAX_PARTICIPANTS) {
    return { ok: false, reason: "count", message: `A split has ${SPLIT_MIN_PARTICIPANTS} to ${SPLIT_MAX_PARTICIPANTS} participants` };
  }
  if (shares.some((s) => s <= 0n)) return { ok: false, reason: "zero_share", message: "Every share must be above zero" };
  const sum = shares.reduce((a, s) => a + s, 0n);
  if (sum !== total) return { ok: false, reason: "sum_mismatch", message: `The shares add up to ${sum}, not the total ${total} (base units)` };
  return { ok: true, shares: [...shares] };
}

/**
 * Shares from weights (e.g. 2 nights vs 3 nights): proportional, rounded down, then the leftover units
 * go one each to the shares with the largest remainders (ties: the earlier share). Exact in BigInt.
 */
export function weightedShares(total: bigint, weights: readonly number[]): bigint[] {
  if (weights.length === 0 || !weights.every((w) => Number.isInteger(w) && w > 0)) throw new RangeError("weights must be positive integers");
  const sum = BigInt(weights.reduce((a, w) => a + w, 0));
  const parts = weights.map((w) => ({ q: (total * BigInt(w)) / sum, r: (total * BigInt(w)) % sum }));
  let left = total - parts.reduce((a, p) => a + p.q, 0n);
  const order = parts.map((p, i) => ({ i, r: p.r })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = parts.map((p) => p.q);
  for (const o of order) {
    if (left <= 0n) break;
    out[o.i]! += 1n;
    left -= 1n;
  }
  return out;
}

/** The smallest delivered amount that counts as paying `share`. */
export function paidThreshold(share: bigint): bigint {
  return share - (share * SPLIT_PAID_TOLERANCE_BPS) / 10_000n;
}

export type ShareStatus = "unpaid" | "partial" | "paid";

export function shareStatus(share: bigint, received: bigint): ShareStatus {
  if (received <= 0n) return "unpaid";
  return received >= paidThreshold(share) ? "paid" : "partial";
}

/** A participant label: plain text, control characters out, whitespace collapsed, capped. */
export function cleanSplitText(v: string | null | undefined, max: number): string {
  return (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** `https://layerhop.com/split/<id>`; the edit link adds the secret in the fragment (never sent to a server). */
export function splitUrl(siteUrl: string, id: string, editToken?: string): string {
  return `${siteUrl.replace(/\/$/, "")}/split/${id}${editToken ? `#k=${encodeURIComponent(editToken)}` : ""}`;
}

/** The edit secret from a split page's URL fragment (`#k=…`), or undefined. */
export function editTokenFromHash(hash: string): string | undefined {
  const m = /(?:^#|&)k=([A-Za-z0-9_-]{16,128})(?:&|$)/.exec(hash);
  return m?.[1];
}
