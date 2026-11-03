/**
 * What an order was for, set by the client on the quote (`purpose`) and stored on the order:
 * attribution only (counters, split status, analytics). No fee, price or route depends on it.
 *
 * - `tip`: a tip jar payment (the jar's "Supported by N tippers" counter counts these).
 * - `split`: one participant paying their share of a split (`splitId` + `splitShare` are set too).
 * - `payout`: one routed row of a bulk payout.
 * - `gather`: one leg of "Gather everything" (consolidating a wallet's balances).
 */
export const ORDER_PURPOSES = ["tip", "split", "payout", "gather", "rebalance", "fund"] as const;
export type OrderPurpose = (typeof ORDER_PURPOSES)[number];

/** Longest message a payer can attach to a tip or a split payment (plain text). */
export const ORDER_NOTE_MAX = 140;

export const isOrderPurpose = (v: unknown): v is OrderPurpose => typeof v === "string" && (ORDER_PURPOSES as readonly string[]).includes(v);

/** A payer's message: plain text, control characters out, whitespace collapsed, capped; undefined when empty. */
export function cleanOrderNote(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, ORDER_NOTE_MAX);
  return s || undefined;
}
