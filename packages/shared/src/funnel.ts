/**
 * First-party swap funnel events: layerhop.com's own swap app, and the swap widget (/embed) only
 * while it is framed by one of layerhop.com's own landing pages (apps/web/src/lib/embedFunnel.ts);
 * never the widget on other sites.
 * Shared by the web client (apps/web/src/lib/funnel.ts) and the API (`POST /v1/events`), which
 * stores them in `funnel_events`. Anonymous by construction: an allowlist of event names and of
 * small scalar props, never addresses, amounts, transaction hashes or IPs.
 */

/** The main funnel, in order. `GET /v1/admin/funnel` reports step-to-step conversion over these. */
export const FUNNEL_STEPS = [
  "page_view",
  "quote_shown",
  "wallet_connect_clicked",
  "wallet_connected",
  "review_opened",
  "swap_clicked",
  "tx_sign_requested",
  "tx_signed",
  "order_submitted",
  "order_filled",
] as const;

/** Side events: counted per day, not part of the ordered funnel. */
/** `hl_referral_clicked`: a click on our Hyperliquid referral link (only shown on our own pages, D-031). */
export const FUNNEL_SIDE_EVENTS = ["amount_entered", "route_changed", "quote_error", "tx_rejected", "swap_error", "order_failed", "hl_referral_clicked", "cta_clicked"] as const;

export const FUNNEL_EVENTS = [...FUNNEL_STEPS, ...FUNNEL_SIDE_EVENTS] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const EVENT_SET = new Set<string>(FUNNEL_EVENTS);
export const isFunnelEvent = (v: unknown): v is FunnelEvent => typeof v === "string" && EVENT_SET.has(v);

/** Coarse USD size of the swap; the only amount information ever recorded. */
export const USD_BUCKETS = ["<10", "10-100", "100-1k", "1k-10k", "10k+"] as const;
export type UsdBucket = (typeof USD_BUCKETS)[number];

/** Coarse minimum of a route reported with AMOUNT_TOO_SMALL (funnel `min_usd_bucket`). */
export const MIN_USD_BUCKETS = ["<5", "5-10", "10-25", "25-50", "50+"] as const;
export type MinUsdBucket = (typeof MIN_USD_BUCKETS)[number];

export function minUsdBucket(usd: number | undefined): MinUsdBucket | undefined {
  if (usd === undefined || !Number.isFinite(usd) || usd < 0) return undefined;
  if (usd < 5) return "<5";
  if (usd < 10) return "5-10";
  if (usd < 25) return "10-25";
  if (usd < 50) return "25-50";
  return "50+";
}

export function usdBucket(usd: number | undefined): UsdBucket | undefined {
  if (usd === undefined || !Number.isFinite(usd) || usd < 0) return undefined;
  if (usd < 10) return "<10";
  if (usd < 100) return "10-100";
  if (usd < 1_000) return "100-1k";
  if (usd < 10_000) return "1k-10k";
  return "10k+";
}

/**
 * Landing page a session entered through (the `entry` prop): `hl-hub` (/hyperliquid),
 * `bridge:<slug>` (/bridge/<slug>), `pay-hub` (/payments) or `pay:<slug>` (/payments/<slug>).
 * A bounded pattern, so arbitrary strings can't be stored.
 */
export const FUNNEL_ENTRY_RE = /^(?:hl-hub|pay-hub|(?:bridge|pay):[a-z0-9][a-z0-9-]{0,47})$/;
export const isFunnelEntry = (v: unknown): v is string => typeof v === "string" && FUNNEL_ENTRY_RE.test(v);

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const oneOf = (values: readonly string[]) => (v: unknown) => typeof v === "string" && values.includes(v);
const matches = (re: RegExp) => (v: unknown) => typeof v === "string" && re.test(v);
const int = (min: number, max: number) => (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const bool = (v: unknown) => typeof v === "boolean";

/**
 * Allowed props and their validators. Anything else is dropped, as is any value that fails its
 * validator (chain slugs are lowercase and at most 32 chars, so an address can never pass).
 */
export const FUNNEL_PROPS = {
  /** Page of a `page_view`: the swap app, or one of our landing pages (with `entry`). */
  page: oneOf(["swap", "landing"]),
  /** Landing page the event came from: its own `page_view`, and every event of the widget it frames. */
  entry: isFunnelEntry,
  src_chain: matches(SLUG),
  dst_chain: matches(SLUG),
  same_chain: bool,
  provider: matches(SLUG),
  /** Routes that answered a quote. */
  routes: int(0, 50),
  /** Stable error code (`quote_error`, `swap_error`, `order_failed`). */
  error_code: matches(/^[A-Z][A-Z0-9_]{0,47}$/),
  vm: oneOf(["evm", "svm"]),
  /** Where a wallet connect was started. */
  source: oneOf(["cta", "recipient", "header"]),
  /** Which signature a `tx_sign_requested` asks for. */
  step: oneOf(["approve", "swap"]),
  usd_bucket: oneOf(USD_BUCKETS),
  /** Coarse route minimum on an `AMOUNT_TOO_SMALL` quote_error (D-036). */
  min_usd_bucket: oneOf(MIN_USD_BUCKETS),
  /** The page was opened from a prefilled swap link. */
  from_link: bool,
  /** Fee channel of the page (`web`, or `bot` for Telegram deep links). */
  channel: oneOf(["web", "bot"]),
  /** Where an `hl_referral_clicked` link was: the success card after a deposit, or a landing page CTA. */
  placement: oneOf(["success", "landing"]),
  /** Which call to action a `cta_clicked` was (merchant landing pages): dashboard sign-up or docs. */
  cta: oneOf(["signup", "docs"]),
} as const satisfies Record<string, (v: unknown) => boolean>;

export type FunnelPropName = keyof typeof FUNNEL_PROPS;
export type FunnelProps = Partial<Record<FunnelPropName, string | number | boolean>>;

/** Keeps only allowlisted props with valid values. */
export function sanitizeFunnelProps(props: unknown): FunnelProps {
  const out: FunnelProps = {};
  if (!props || typeof props !== "object" || Array.isArray(props)) return out;
  for (const [k, v] of Object.entries(props)) {
    if (!Object.hasOwn(FUNNEL_PROPS, k)) continue;
    if (FUNNEL_PROPS[k as FunnelPropName](v)) out[k as FunnelPropName] = v as string | number | boolean;
  }
  return out;
}

/** Events per `POST /v1/events` batch. */
export const FUNNEL_MAX_BATCH = 25;
/** Largest `POST /v1/events` body, in bytes. */
export const FUNNEL_MAX_BODY_BYTES = 16 * 1024;
/** Client session ids: 16 to 64 chars of [A-Za-z0-9_-]. Re-hashed per UTC day by the API. */
export const FUNNEL_SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;
