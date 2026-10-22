/**
 * Paid developer plans (decision "Paid plans" in docs/DECISIONS.md, spec in docs/PLATFORM_SPEC.md).
 * Shared by the API (entitlements, billing), the worker (plan activation and lapse), the dashboard
 * and the /pricing page.
 *
 * Everything here is inert until the API runs with `PLANS_LIVE=1`: without it every account gets
 * today's limits, which the default Free plan mirrors. Prices and limits are placeholders the owner
 * sets through `PLANS_JSON`; nothing in code depends on the numbers.
 */

export interface PlanDefinition {
  /** Stable id stored on the account (`free`, `pro`, `scale`, …), [a-z0-9-]{1,32}. */
  id: string;
  /** Display name (configurable). */
  name: string;
  /** One line for the pricing page and the dashboard. */
  tagline: string;
  /** Monthly price in USDC as a decimal string ("49", "12.5"). "0" for the free plan. */
  priceUsdc: string;
  /** Requests per minute per API key (a key's own higher limit, set by an admin, still wins). */
  rateLimitRpm: number;
  /** Live-mode API requests per account per calendar month (UTC). null = no monthly quota. */
  monthlyRequests: number | null;
  /** Webhook endpoints per account. */
  webhookEndpoints: number;
  /** Highest partner fee (bps) the account's partner profile may charge. */
  maxPartnerFeeBps: number;
  /** Hide "Routed by LayerHop" in the widget and "Secured by LayerHop" on hosted checkout. */
  whiteLabel: boolean;
  /** Priority support (shown in the dashboard; support is handled by people, not code). */
  prioritySupport: boolean;
}

export const FREE_PLAN_ID = "free";
const PLAN_ID_RE = /^[a-z0-9-]{1,32}$/;

/**
 * Placeholder plans (owner decision pending). Free = today's limits exactly: 120 requests/minute per
 * key (the `api_keys.rate_limit_rpm` default), no monthly quota, 10 webhook endpoints
 * (`MAX_WEBHOOKS`), a 50 bps partner fee cap (`PARTNER_STARTER_MAX_FEE_BPS`), LayerHop branding.
 */
export const DEFAULT_PLANS: readonly PlanDefinition[] = [
  {
    id: "free", name: "Free", tagline: "Everything you need to ship a swap or checkout integration.",
    priceUsdc: "0", rateLimitRpm: 120, monthlyRequests: null, webhookEndpoints: 10, maxPartnerFeeBps: 50,
    whiteLabel: false, prioritySupport: false,
  },
  {
    id: "pro", name: "Pro", tagline: "Higher limits and your own brand on the widget and checkout.",
    priceUsdc: "49", rateLimitRpm: 600, monthlyRequests: 2_000_000, webhookEndpoints: 25, maxPartnerFeeBps: 100,
    whiteLabel: true, prioritySupport: false,
  },
  {
    id: "scale", name: "Scale", tagline: "For wallets and apps with real volume.",
    priceUsdc: "299", rateLimitRpm: 3_000, monthlyRequests: 20_000_000, webhookEndpoints: 100, maxPartnerFeeBps: 150,
    whiteLabel: true, prioritySupport: true,
  },
];

/**
 * Days a paid plan stays on after its period ends unpaid. Default 10 = the subscription's 3 days
 * until the renewal invoice is due + the 7-day grace before it is canceled for non-payment
 * (packages/shared/src/subscriptions.ts), so the plan drops to Free when the subscription would be canceled.
 */
export const DEFAULT_PLAN_GRACE_DAYS = 10;

const isInt = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const PRICE_RE = /^\d{1,7}(\.\d{1,6})?$/;

/**
 * `PLANS_JSON`: an array of plans, in display order. Each entry needs an `id`; any field left out
 * comes from the default plan with the same id (so `[{"id":"free"},{"id":"pro","priceUsdc":"59"}]`
 * only changes the Pro price). A `free` plan with price "0" is required. Throws on invalid input.
 */
export function parsePlans(json: string | undefined): PlanDefinition[] {
  if (!json || !json.trim()) return DEFAULT_PLANS.map((p) => ({ ...p }));
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("PLANS_JSON is not valid JSON");
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("PLANS_JSON must be a non-empty array of plans");
  const seen = new Set<string>();
  const out = raw.map((entry, i): PlanDefinition => {
    const fail = (msg: string): never => {
      throw new Error(`PLANS_JSON[${i}]: ${msg}`);
    };
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) fail("must be an object");
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !PLAN_ID_RE.test(e.id)) fail("id must match [a-z0-9-]{1,32}");
    const id = e.id as string;
    if (seen.has(id)) fail(`duplicate id "${id}"`);
    seen.add(id);
    const base = DEFAULT_PLANS.find((p) => p.id === id);
    const pick = <K extends keyof PlanDefinition>(k: K): unknown => (e[k] !== undefined ? e[k] : base?.[k]);
    const p = {
      id,
      name: pick("name"), tagline: pick("tagline") ?? "", priceUsdc: pick("priceUsdc"), rateLimitRpm: pick("rateLimitRpm"),
      monthlyRequests: pick("monthlyRequests") ?? null, webhookEndpoints: pick("webhookEndpoints"), maxPartnerFeeBps: pick("maxPartnerFeeBps"),
      whiteLabel: pick("whiteLabel") ?? false, prioritySupport: pick("prioritySupport") ?? false,
    };
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 32) fail("name is required (max 32 chars)");
    if (typeof p.tagline !== "string" || p.tagline.length > 200) fail("tagline must be a string (max 200 chars)");
    if (typeof p.priceUsdc !== "string" || !PRICE_RE.test(p.priceUsdc)) fail('priceUsdc must be a decimal string like "49" or "12.50"');
    if (!isInt(p.rateLimitRpm, 1, 100_000)) fail("rateLimitRpm must be an integer 1..100000");
    if (p.monthlyRequests !== null && !isInt(p.monthlyRequests, 1, 1e12)) fail("monthlyRequests must be a positive integer or null");
    if (!isInt(p.webhookEndpoints, 0, 1_000)) fail("webhookEndpoints must be an integer 0..1000");
    if (!isInt(p.maxPartnerFeeBps, 0, 10_000)) fail("maxPartnerFeeBps must be an integer 0..10000");
    if (typeof p.whiteLabel !== "boolean") fail("whiteLabel must be a boolean");
    if (typeof p.prioritySupport !== "boolean") fail("prioritySupport must be a boolean");
    return p as PlanDefinition;
  });
  const free = out.find((p) => p.id === FREE_PLAN_ID);
  if (!free) throw new Error('PLANS_JSON needs a plan with id "free"');
  if (Number(free.priceUsdc) !== 0) throw new Error('PLANS_JSON: the "free" plan must have priceUsdc "0"');
  for (const p of out) if (p.id !== FREE_PLAN_ID && Number(p.priceUsdc) <= 0) throw new Error(`PLANS_JSON: plan "${p.id}" needs a price above 0`);
  return out;
}

/** "12.5" with 6 decimals → "12500000". The input is validated by `parsePlans`. */
export function priceToBaseUnits(price: string, decimals: number): string {
  const [whole = "0", frac = ""] = price.split(".");
  if (frac.length > decimals) throw new Error(`price ${price} has more than ${decimals} decimals`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}

/** The stored plan columns of an account (structural, so shared needs no db types). */
export interface AccountPlanFields {
  plan: string;
  planPeriodEnd: Date | null;
  planExpiresAt: Date | null;
}

/**
 * The plan an account is entitled to right now: its stored paid plan until `planExpiresAt` (period
 * end + grace, or the period end after a cancel), else Free. A plan id missing from the config
 * (removed by the owner) also reads as Free.
 */
export function effectivePlan(plans: readonly PlanDefinition[], a: AccountPlanFields | undefined, now: number): PlanDefinition {
  const free = plans.find((p) => p.id === FREE_PLAN_ID) ?? DEFAULT_PLANS[0]!;
  if (!a || a.plan === FREE_PLAN_ID || !a.planExpiresAt || a.planExpiresAt.getTime() <= now) return free;
  return plans.find((p) => p.id === a.plan) ?? free;
}

/** Start of the calendar month (UTC) containing `now`, and the start of the next one (quota window). */
export function quotaWindow(now: number): { start: Date; end: Date } {
  const d = new Date(now);
  return { start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) };
}
