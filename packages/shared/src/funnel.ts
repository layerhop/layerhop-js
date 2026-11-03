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
/** `page_leave`: the page was hidden or unloaded, with the last funnel step reached and `t_ms` since load. */
export const FUNNEL_SIDE_EVENTS = ["amount_entered", "route_changed", "quote_error", "tx_rejected", "swap_error", "order_failed", "hl_referral_clicked", "cta_clicked", "page_leave"] as const;

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

/**
 * Our own surfaces that link into the swap app. Internal swap links carry `via=<surface>`; the swap
 * page reads it into `entry_source` (`internal:<surface>`) and strips it from the address bar, so a
 * copied URL counts as an external link.
 */
export const SWAP_VIA = [
  "home", "developers", "chain", "hl", "route", "retry", "copy", "card", "token", "launch", "assistant", "routine",
] as const;
export type SwapVia = (typeof SWAP_VIA)[number];
const VIA_SET = new Set<string>(SWAP_VIA);
export const isSwapVia = (v: unknown): v is SwapVia => typeof v === "string" && VIA_SET.has(v);

/** How a `page_view` was reached: one of our links, a link with swap params but no marker (shared / external), or neither. */
export const ENTRY_SOURCES = [...SWAP_VIA.map((v) => `internal:${v}` as const), "external_link", "direct"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const DEVICES = ["mobile", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

/** In-app browser of a social app or wallet (`none`: a regular browser; `wallet_other`: an unknown wallet's). */
export const IN_APP_BROWSERS = [
  "none", "x", "telegram", "instagram", "facebook", "discord", "linkedin", "tiktok", "snapchat", "line", "wechat", "reddit", "farcaster",
  "phantom", "metamask", "coinbase", "trust", "okx", "bitget", "binance", "rainbow", "tokenpocket", "solflare", "backpack", "wallet_other",
] as const;
export type InAppBrowser = (typeof IN_APP_BROWSERS)[number];

/** document.referrer's host only (lowercase DNS name, at most 64 chars); never a path or query. */
const REFERRER_HOST = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/** Longest stored wallet name. */
export const WALLET_NAME_MAX = 32;
const WALLET_NAME = /^[A-Za-z0-9][A-Za-z0-9 .()_+-]{0,31}$/;

/**
 * What kind of failure a `swap_error` / `tx_rejected` was (D-052), so errors that used to be
 * `UNKNOWN` can be told apart: wallet-side (rejected, gas, nonce, wrong chain, a simulation
 * revert, a Solana blockhash expiry or program error, Tron energy), our API / the provider, or a timeout.
 */
export const ERROR_CLASSES = [
  "user_rejected", "insufficient_funds", "nonce", "chain_mismatch", "chain_unsupported", "sim_revert",
  "svm_blockhash", "svm_sim_failed", "tron_energy", "wallet", "api", "provider", "timeout", "network", "unknown",
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

/** Longest `error_reason`. */
export const ERROR_REASON_MAX = 80;
const REASON_CHARS = /^[A-Za-z0-9 .,:;'"()[\]_/!?=<>*+#%&-]+$/;
/** Base58 runs of address / signature length (Solana, Tron). */
const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{25,}/;
const LONG_HEX = /(?:0x)?[0-9a-f]{9,}/i;
const LONG_NUMBER = /\d{7,}/;

/**
 * A wallet / provider error message cut down to something safe to store (D-052): first line,
 * no URLs or emails, hex of 9+ chars (addresses, hashes, calldata) → `[hex]`, base58 runs of 25+
 * chars (Solana / Tron addresses, signatures) → `[addr]`, numbers of 7+ digits (amounts, nonces,
 * balances) → `[n]`, other characters dropped, at most ERROR_REASON_MAX chars. Short program error
 * codes (`custom program error: 0x1771`) and revert reasons survive. Undefined when nothing is left.
 */
export function sanitizeErrorReason(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.split(/\r?\n/).find((l) => l.trim()) ?? "";
  s = s
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\S+@\S+\.\S+/g, "[email]")
    .replace(/(?:0x)?[0-9a-f]{9,}/gi, "[hex]")
    .replace(/[1-9A-HJ-NP-Za-km-z]{25,}/g, "[addr]")
    .replace(/\d[\d,._]*\d|\d/g, (m) => (m.replace(/\D/g, "").length > 6 ? "[n]" : m))
    .replace(/[^A-Za-z0-9 .,:;'"()[\]_/!?=<>*+#%&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > ERROR_REASON_MAX) s = s.slice(0, ERROR_REASON_MAX).trim();
  return s && isSafeErrorReason(s) ? s : undefined;
}

/** The API's check of `error_reason`: what sanitizeErrorReason can produce, and nothing address-, hash- or amount-shaped. */
export function isSafeErrorReason(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= ERROR_REASON_MAX && REASON_CHARS.test(v)
    && !BASE58_RUN.test(v) && !LONG_HEX.test(v) && !LONG_NUMBER.test(v);
}

/** The API's check of `wallet`: a short connector name, nothing address-shaped. */
export function isFunnelWalletName(v: unknown): v is string {
  return typeof v === "string" && WALLET_NAME.test(v) && !v.endsWith(" ") && !BASE58_RUN.test(v) && !LONG_HEX.test(v) && !LONG_NUMBER.test(v);
}

/** A wallet / connector name cut down to what `wallet` accepts (at most 32 chars), or undefined. */
export function funnelWalletName(name: string | undefined): string | undefined {
  const s = (name ?? "").replace(/[^A-Za-z0-9 .()_+-]/g, "").replace(/\s+/g, " ").trim().slice(0, WALLET_NAME_MAX).trim();
  return isFunnelWalletName(s) ? s : undefined;
}

/** A token symbol for `src_token` / `dst_token` (letters, digits and `.+_$-`, at most 16), or undefined. */
export function funnelTokenSymbol(symbol: string | undefined): string | undefined {
  const s = (symbol ?? "").replace(/[^A-Za-z0-9.+_$-]/g, "").slice(0, 16);
  return TOKEN_SYMBOL.test(s) ? s : undefined;
}
const TOKEN_SYMBOL = /^[A-Za-z0-9.+_$-]{1,16}$/;
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
  vm: oneOf(["evm", "svm", "tvm"]),
  /** Where a wallet connect was started. */
  source: oneOf(["cta", "recipient", "header"]),
  /** Which signature a `tx_sign_requested` asks for; on `swap_error` / `tx_rejected`, the last one asked for. */
  step: oneOf(["approve", "swap"]),
  /** Kind of failure of a `swap_error` / `tx_rejected` (D-052). */
  error_class: oneOf(ERROR_CLASSES),
  /** Sanitized failure message of a `swap_error` (D-052): no addresses, hashes or long numbers. */
  error_reason: isSafeErrorReason,
  /** Token symbols of a `quote_error` (D-052). */
  src_token: matches(TOKEN_SYMBOL),
  dst_token: matches(TOKEN_SYMBOL),
  /** The token is on a provider list or our curated list (false: read on chain only). */
  src_token_listed: bool,
  dst_token_listed: bool,
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
  /** How the page was reached (`page_view`): `internal:<surface>`, `external_link` or `direct`. */
  entry_source: oneOf(ENTRY_SOURCES),
  /** Host of document.referrer (`page_view`), never the full URL. */
  referrer_host: matches(REFERRER_HOST),
  device: oneOf(DEVICES),
  in_app_browser: oneOf(IN_APP_BROWSERS),
  /** An injected EVM / Solana wallet was present when the page loaded (`page_view`). */
  wallet_detected_evm: bool,
  wallet_detected_svm: bool,
  /** Connector / wallet name on `wallet_connected` and the tx events. */
  wallet: isFunnelWalletName,
  /** Furthest FUNNEL_STEPS step reached before a `page_leave`. */
  last_step: oneOf(FUNNEL_STEPS),
  /** Client milliseconds since the page loaded (every event), so durations are measurable. At most 7 days. */
  t_ms: int(0, 7 * 86_400_000),
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
