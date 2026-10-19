/**
 * Subscription billing rules (docs/content/guides/subscriptions.md), shared by the API (schedules,
 * previews) and the billing worker (services/worker/src/subscriptions.ts).
 *
 * Crypto can't be pulled from a wallet: each period LayerHop issues an invoice and emails the pay
 * link. Timeline of one period's invoice, from its due date (`issued + daysUntilDue`):
 * - due date passes unpaid → subscription `past_due` (`subscription.past_due`)
 * - `SUBSCRIPTION_REMINDER_DAYS` after the due date → reminder emails (day 1 and day 3)
 * - `SUBSCRIPTION_GRACE_DAYS` after the due date → canceled for non-payment, the invoice is voided
 * Paying the invoice at any point before that makes the subscription `active` again.
 */

export type SubscriptionInterval = "day" | "week" | "month" | "year";

export const SUBSCRIPTION_INTERVAL_VALUES: readonly SubscriptionInterval[] = ["day", "week", "month", "year"];
/** Days after issue an invoice is due, unless the subscription sets `daysUntilDue` (0–60). */
export const SUBSCRIPTION_DEFAULT_DAYS_UNTIL_DUE = 3;
export const SUBSCRIPTION_MAX_DAYS_UNTIL_DUE = 60;
/** Reminder emails, in days after the invoice's due date. */
export const SUBSCRIPTION_REMINDER_DAYS: readonly number[] = [1, 3];
/** Days after the due date an unpaid subscription is canceled. */
export const SUBSCRIPTION_GRACE_DAYS = 7;
/** Max `intervalCount` (e.g. every 12 months; a longer cycle should use `year`). */
export const SUBSCRIPTION_MAX_INTERVAL_COUNT = 365;

const DAY_MS = 86_400_000;

/**
 * `from + n × interval`, in UTC. Months and years keep the anchor's day of month, clamped to the
 * month's last day (Jan 31 + 1 month = Feb 28/29, + 2 months = Mar 31), so periods never drift.
 */
export function addInterval(from: Date, interval: SubscriptionInterval, n: number): Date {
  if (interval === "day") return new Date(from.getTime() + n * DAY_MS);
  if (interval === "week") return new Date(from.getTime() + n * 7 * DAY_MS);
  const months = interval === "month" ? n : n * 12;
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const d = new Date(from.getTime());
  d.setUTCFullYear(targetY, targetM, Math.min(from.getUTCDate(), lastDay));
  return d;
}

/** Start and end of period `index` (0-based) of a subscription anchored at `anchor`. */
export function subscriptionPeriod(anchor: Date, interval: SubscriptionInterval, intervalCount: number, index: number): { start: Date; end: Date } {
  return { start: addInterval(anchor, interval, index * intervalCount), end: addInterval(anchor, interval, (index + 1) * intervalCount) };
}

/** The columns of a `subscriptions` row the API and webhooks show (structural, so shared needs no db types). */
export interface SubscriptionFields {
  id: string; livemode: boolean; status: string; customerEmail: string; customerName: string | null; merchantName: string | null;
  description: string; memo: string | null; productId: string | null; amount: string;
  settleChainId: number; settleToken: string; settleSymbol: string; settleDecimals: number; recipient: string;
  interval: SubscriptionInterval; intervalCount: number; daysUntilDue: number;
  currentPeriodStart: Date | null; currentPeriodEnd: Date | null; nextInvoiceAt: Date | null;
  cancelAt: Date | null; canceledAt: Date | null; cancellationReason: string | null; pausedAt: Date | null;
  latestInvoiceId: string | null; metadata: unknown; createdAt: Date; updatedAt: Date;
}

/** The merchant's view of a subscription (API responses and `subscription.*` webhooks). */
export function publicSubscription(s: SubscriptionFields) {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const ended = s.status === "canceled";
  return {
    id: s.id, object: "subscription" as const, livemode: s.livemode, status: s.status,
    customerEmail: s.customerEmail, customerName: s.customerName, merchantName: s.merchantName,
    description: s.description, memo: s.memo, productId: s.productId, amount: s.amount,
    settlement: { chainId: s.settleChainId, token: s.settleToken, symbol: s.settleSymbol, decimals: s.settleDecimals },
    recipient: s.recipient, interval: s.interval, intervalCount: s.intervalCount, daysUntilDue: s.daysUntilDue,
    currentPeriodStart: iso(s.currentPeriodStart), currentPeriodEnd: iso(s.currentPeriodEnd),
    // Paused and canceled subscriptions issue nothing; `nextInvoiceAt` is otherwise when the next invoice goes out.
    nextInvoiceAt: s.status === "active" || s.status === "past_due" ? iso(s.nextInvoiceAt) : null,
    cancelAt: ended ? null : iso(s.cancelAt), cancelAtPeriodEnd: !ended && s.cancelAt !== null,
    canceledAt: iso(s.canceledAt), cancellationReason: s.cancellationReason, pausedAt: iso(s.pausedAt),
    latestInvoiceId: s.latestInvoiceId, metadata: (s.metadata as Record<string, string> | null) ?? null,
    createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
  };
}

/** "month" / "3 months" / "week"; for emails and the dashboard ("billed every month"). */
export function intervalLabel(interval: SubscriptionInterval, intervalCount: number): string {
  return intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;
}
