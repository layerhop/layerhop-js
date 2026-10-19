/**
 * Framework-agnostic core of the LayerHop widget.
 *
 * The widget is an <iframe> of `${baseUrl}/embed?...`. The query params and the postMessage
 * events implemented here follow docs/URL_CONTRACT.md exactly; treat both as public API.
 */

import { FONT_IDS, PRESET_IDS, type FontId, type PresetId } from "./presets";

export const DEFAULT_BASE_URL = "https://layerhop.com";
export const DEFAULT_HEIGHT = 640;
export const DEFAULT_MAX_WIDTH = 480;
/** color-scheme for the iframe element; equals the embed document's root (see mount()). */
export const EMBED_COLOR_SCHEME = "normal";

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

/** `auto` follows the visitor's light/dark setting (prefers-color-scheme). */
export type WidgetTheme = "dark" | "light" | "auto";
export type WidgetPreset = PresetId;
export type WidgetFont = FontId;
export type WidgetDensity = "compact" | "comfortable";
export type WidgetShadow = "none" | "soft" | "strong";
/** A chain slug (`"base"`) or numeric chain id. */
export type ChainRef = string | number;

/** Everything that maps 1:1 to an embed URL param. All optional; omitted params use app defaults. */
export interface WidgetOptions {
  /** Source chain slug (e.g. `"base"`) or numeric chain id. */
  srcChain?: string | number;
  /** Source token symbol from the token list, or address/mint. */
  srcToken?: string;
  /** Destination chain slug or numeric chain id. */
  dstChain?: string | number;
  /** Destination token symbol, or address/mint. */
  dstToken?: string;
  /** Amount in **human units**, as a decimal string with `.` separator (e.g. `"100"`, `"0.5"`). */
  amount?: string;
  /** Prefilled (but editable) recipient address. */
  recipient?: string;
  /** Slippage tolerance in basis points (integer 0..10000). */
  slippageBps?: number;
  /** Color theme; the embed defaults to `dark` (or the preset's own default). */
  theme?: WidgetTheme;
  /** A coherent palette for dark and light. Explicit colors override it. */
  preset?: WidgetPreset;
  /** Accent color as hex (`"#22d3ee"`, `"22d3ee"`, `"#0af"`). The `#` is stripped. */
  accent?: string;
  /** Label color on accent buttons. Replaced automatically when it would be hard to read. */
  accentText?: string;
  /** Page background behind the card (default: transparent). */
  bg?: string;
  /** Card background. */
  surface?: string;
  /** Field and nested panel background. */
  surfaceAlt?: string;
  /** Main text. */
  text?: string;
  /** Secondary text. */
  textMuted?: string;
  /** Border color (URL param `border` with a hex value). */
  borderColor?: string;
  /** Links, success states and the secondary accent. */
  success?: string;
  warning?: string;
  danger?: string;
  /** Card corner radius in px (non-negative integer). */
  radius?: number;
  /** Field and button corner radius in px, 0..32. */
  radiusInner?: number;
  /** One of the supported fonts; Google-hosted ones load only when chosen. */
  font?: WidgetFont;
  /** Scales the card, 0.875..1.125. */
  fontScale?: number;
  density?: WidgetDensity;
  /** Max card width in px, 320..720. Also widens the iframe unless `maxWidth` is set. */
  width?: number;
  shadow?: WidgetShadow;
  /** Card outline: `false` removes it, `true` strengthens it (URL `border=0|1`). */
  border?: boolean;
  /**
   * Header text, up to 32 characters (URL param `title`). Named `headerTitle` because `title` is
   * the iframe's title attribute in `mount()`.
   */
  headerTitle?: string;
  /** Hide the header (title, wallet button, history and settings). */
  hideHeader?: boolean;
  /** https image URL shown next to the title. */
  logo?: string;
  /** Label of the main button once the swap is ready, up to 24 characters. */
  buttonLabel?: string;
  /** Only these chains on the pay side. */
  fromChains?: readonly ChainRef[];
  /** Only these chains on the receive side. */
  toChains?: readonly ChainRef[];
  /** Never offer these chains. */
  excludeChains?: readonly ChainRef[];
  /** Only these tokens on the pay side: `"chain:addressOrSymbol"` or a bare symbol. */
  fromTokens?: readonly string[];
  /** Only these tokens on the receive side. */
  toTokens?: readonly string[];
  /** The amount can't be edited. */
  lockAmount?: boolean;
  /** `recipient` can't be edited (requires `recipient`). */
  lockRecipient?: boolean;
  /** Show only the best route's summary. */
  hideRoutes?: boolean;
  /** Hide the slippage settings. */
  hideSettings?: boolean;
  /**
   * Start with "Get gas on arrival" on: cross-chain swaps to an EVM chain also deliver ~$2 of the
   * destination chain's native gas token. The user can still turn it off.
   */
  gasOnArrival?: boolean;
  /** Hide "Routed by LayerHop". Requires `integrator`; honoured once it's confirmed as a registered partner. */
  hidePoweredBy?: boolean;
  /** Show USD values (default `true`). */
  showUsd?: boolean;
  /** UI language. Only `"en"` today. */
  locale?: "en";
  /** Origin allowed to send `setParams` messages. `mount({ liveUpdates: true })` sets it for you. */
  allowParentOrigin?: string;
  /** Lock source chain + token. */
  lockSrc?: boolean;
  /** Lock destination chain + token. */
  lockDst?: boolean;
  /** Hide the history section. */
  hideHistory?: boolean;
  /**
   * Your partner id, `[a-z0-9-]{1,32}`. Attribution, and when the id is a registered LayerHop
   * partner the embed adds your partner fee on top of LayerHop's (D-020). Unknown ids are ignored.
   */
  integrator?: string;
}

// ---------------------------------------------------------------------------------------------
// Events (embed -> parent)
// ---------------------------------------------------------------------------------------------

export interface ReadyEvent {
  version: string;
}
export interface QuoteEvent {
  provider: string;
  srcChain: string | number;
  dstChain: string | number;
  amount: string;
  dstAmount: string;
}
export interface SubmittedEvent {
  provider: string;
  srcChainId: number;
  srcTxHash: string;
}
export type OrderState = "pending" | "filled" | "refunded" | "failed";
export interface StatusEvent {
  provider: string;
  srcTxHash: string;
  state: OrderState;
}
export interface ErrorEvent {
  code: string;
  message: string;
}
export interface ResizeEvent {
  /** Content height in px. */
  height: number;
}
export interface RoutesEvent {
  /** Routes that answered. */
  count: number;
  /** Provider of the best route. */
  provider: string;
}
export interface WalletEvent {
  vm: "evm" | "svm";
  address: string;
}
export interface AmountChangedEvent {
  /** Human units; `""` when cleared. */
  amount: string;
  srcChain: string;
  /** Token address/mint. */
  srcToken: string;
}

/** Map of event `type` -> payload, as sent by the embed. */
export interface WidgetEventMap {
  ready: ReadyEvent;
  quote: QuoteEvent;
  submitted: SubmittedEvent;
  status: StatusEvent;
  error: ErrorEvent;
  resize: ResizeEvent;
  routes: RoutesEvent;
  walletConnected: WalletEvent;
  walletDisconnected: WalletEvent;
  amountChanged: AmountChangedEvent;
}
export type WidgetEventType = keyof WidgetEventMap;
export const WIDGET_EVENT_TYPES: readonly WidgetEventType[] = [
  "ready",
  "quote",
  "submitted",
  "status",
  "error",
  "resize",
  "routes",
  "walletConnected",
  "walletDisconnected",
  "amountChanged",
];

/** The raw message envelope posted by the embed. */
export type WidgetMessage = {
  [K in WidgetEventType]: { source: "layerhop"; type: K; payload: WidgetEventMap[K] };
}[WidgetEventType];

export interface WidgetCallbacks {
  onReady?: (payload: ReadyEvent) => void;
  onQuote?: (payload: QuoteEvent) => void;
  onSubmitted?: (payload: SubmittedEvent) => void;
  onStatus?: (payload: StatusEvent) => void;
  onError?: (payload: ErrorEvent) => void;
  onResize?: (payload: ResizeEvent) => void;
  onRoutes?: (payload: RoutesEvent) => void;
  onWalletConnected?: (payload: WalletEvent) => void;
  onWalletDisconnected?: (payload: WalletEvent) => void;
  /** Debounced by the embed (about 400 ms). */
  onAmountChanged?: (payload: AmountChangedEvent) => void;
  /** Called for every valid event, after the typed callback. */
  onEvent?: (message: WidgetMessage) => void;
}

export interface MountOptions extends WidgetOptions, WidgetCallbacks {
  /** Origin (optionally with a path prefix) serving `/embed`. Default `https://layerhop.com`. */
  baseUrl?: string;
  /** Resize the iframe height on `resize` events. Default `true`. */
  autoResize?: boolean;
  /** Initial iframe height in px before the first `resize` event. Default 640. */
  height?: number;
  /** CSS max-width of the iframe. Default 480 px (or `width` + 16 when `width` is set). */
  maxWidth?: number | string;
  /**
   * Let `update()` change the amount, tokens, theme and colors in place (no reload) through
   * `setParams` messages. Sets `allowParentOrigin` to this page's origin. Default `false`.
   */
  liveUpdates?: boolean;
  /** iframe `title` attribute. Default `"LayerHop swap"`. */
  title?: string;
}

/** Options accepted by `update()`: URL options and callbacks; `baseUrl` is fixed at mount time. */
export type UpdateOptions = WidgetOptions & WidgetCallbacks;

export interface WidgetHandle {
  readonly iframe: HTMLIFrameElement;
  /**
   * Merge new options. The iframe reloads only if the resulting URL changes, except with
   * `liveUpdates`: then amount, token, theme and color changes are applied in place.
   */
  update(options: UpdateOptions): void;
  /** Remove the message listener and the iframe. Idempotent. */
  destroy(): void;
}

export class LayerHopWidgetError extends Error {
  override name = "LayerHopWidgetError";
}

// ---------------------------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------------------------

const HEX_RE = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Theme colors other than the legacy `accent` take 3 or 6 hex digits. */
const COLOR_RE = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const CHAIN_RE = /^(?:[a-z0-9][a-z0-9-]{0,31}|\d{1,12})$/;
const TOKEN_REF_RE = /^[A-Za-z0-9.+_$-]{1,64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

/** Color option → URL param (`borderColor` shares the `border` param with the outline flag). */
export const COLOR_OPTIONS = {
  accentText: "accentText",
  bg: "bg",
  surface: "surface",
  surfaceAlt: "surfaceAlt",
  text: "text",
  textMuted: "textMuted",
  borderColor: "border",
  success: "success",
  warning: "warning",
  danger: "danger",
} as const satisfies Partial<Record<keyof WidgetOptions, string>>;
export type ColorOption = keyof typeof COLOR_OPTIONS;

export const MAX_TITLE_LENGTH = 32;
export const MAX_BUTTON_LABEL_LENGTH = 24;

/** Validate a theme color (3 or 6 hex digits, optional `#`); returns lowercase hex without `#`. */
export function normalizeColor(name: string, value: string): string {
  const hex = value.trim().replace(/^#/, "");
  if (!COLOR_RE.test(hex)) throw new LayerHopWidgetError(`Invalid ${name} "${value}": expected a hex color like #0f172a`);
  return hex.toLowerCase();
}

function fail(message: string): never {
  throw new LayerHopWidgetError(message);
}

function intIn(name: string, v: number, min: number, max: number): string {
  if (!Number.isInteger(v) || v < min || v > max) fail(`Invalid ${name} ${v}: expected an integer ${min}..${max}`);
  return String(v);
}

function oneOf<T extends string>(name: string, v: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(v)) fail(`Invalid ${name} "${v}": expected one of ${allowed.join(", ")}`);
  return v as T;
}

function plainText(name: string, v: string, max: number): string {
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || CONTROL_RE.test(v) || [...t].length > max) fail(`Invalid ${name}: plain text of 1..${max} characters`);
  return t;
}

function httpsUrl(name: string, v: string): string {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    fail(`Invalid ${name} "${v}": expected an https URL`);
  }
  if (u.protocol !== "https:" || u.username || u.password) fail(`Invalid ${name} "${v}": expected an https URL without credentials`);
  return u.href;
}

/** `https://app.example.com` (or http://localhost:port); no path, query or wildcard. */
export function normalizeOrigin(v: string): string {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    fail(`Invalid allowParentOrigin "${v}": expected an origin like https://app.example.com`);
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && local)) || v.trim().replace(/\/$/, "") !== u.origin) {
    fail(`Invalid allowParentOrigin "${v}": expected an origin like https://app.example.com`);
  }
  return u.origin;
}

function chainList(name: string, list: readonly ChainRef[]): string {
  const out = list.map((c) => String(c).trim().toLowerCase());
  if (!out.length || out.some((c) => !CHAIN_RE.test(c))) fail(`Invalid ${name}: expected chain slugs or ids like ["base", 42161]`);
  return out.join(",");
}

function tokenList(name: string, list: readonly string[]): string {
  const out = list.map((t) => t.trim());
  const ok = (t: string) => {
    const i = t.indexOf(":");
    return i === -1 ? TOKEN_REF_RE.test(t) : CHAIN_RE.test(t.slice(0, i).toLowerCase()) && TOKEN_REF_RE.test(t.slice(i + 1));
  };
  if (!out.length || out.some((t) => !ok(t))) fail(`Invalid ${name}: expected entries like "base:USDC" or "solana:<mint>"`);
  return out.join(",");
}
const INTEGRATOR_RE = /^[a-z0-9-]{1,32}$/;
const AMOUNT_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Validate and normalize an accent color; returns hex without `#`. Throws on invalid input. */
export function normalizeAccent(accent: string): string {
  const hex = accent.trim().replace(/^#/, "");
  if (!HEX_RE.test(hex)) {
    throw new LayerHopWidgetError(`Invalid accent "${accent}": expected a hex color like #22d3ee`);
  }
  return hex.toLowerCase();
}

export function isValidIntegrator(value: string): boolean {
  return INTEGRATOR_RE.test(value);
}

/** Resolve the embed page URL for a base URL (`https://x.com` or `https://x.com/prefix`). */
export function resolveEmbedEndpoint(baseUrl: string = DEFAULT_BASE_URL): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LayerHopWidgetError(`Invalid baseUrl "${baseUrl}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LayerHopWidgetError(`Invalid baseUrl "${baseUrl}": must be http(s)`);
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/embed") ? path : `${path}/embed`;
  url.search = "";
  url.hash = "";
  return url;
}

function nonEmpty(value: string | number | undefined): value is string | number {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/**
 * Build the embed URL for the given options. Throws `LayerHopWidgetError` on invalid values
 * (bad colors, integrator, amount, slippage, radius, lists, …), so integration bugs surface early.
 */
export function buildEmbedUrl(options: WidgetOptions = {}, baseUrl: string = DEFAULT_BASE_URL): string {
  const url = resolveEmbedEndpoint(baseUrl);
  const p = url.searchParams;

  if (nonEmpty(options.srcChain)) p.set("srcChain", String(options.srcChain).trim());
  if (nonEmpty(options.srcToken)) p.set("srcToken", options.srcToken.trim());
  if (nonEmpty(options.dstChain)) p.set("dstChain", String(options.dstChain).trim());
  if (nonEmpty(options.dstToken)) p.set("dstToken", options.dstToken.trim());

  if (nonEmpty(options.amount)) {
    const amount = String(options.amount).trim();
    if (!AMOUNT_RE.test(amount)) {
      throw new LayerHopWidgetError(
        `Invalid amount "${options.amount}": expected a human-unit decimal string like "100" or "0.5"`,
      );
    }
    p.set("amount", amount);
  }

  if (nonEmpty(options.recipient)) p.set("recipient", options.recipient.trim());

  if (options.slippageBps !== undefined) {
    const s = options.slippageBps;
    if (!Number.isInteger(s) || s < 0 || s > 10_000) {
      throw new LayerHopWidgetError(`Invalid slippageBps ${s}: expected an integer 0..10000`);
    }
    p.set("slippageBps", String(s));
  }

  if (options.preset !== undefined) p.set("preset", oneOf("preset", options.preset, PRESET_IDS));

  if (options.theme !== undefined) {
    if (options.theme !== "dark" && options.theme !== "light" && options.theme !== "auto") {
      throw new LayerHopWidgetError(`Invalid theme "${String(options.theme)}": expected "dark", "light" or "auto"`);
    }
    p.set("theme", options.theme);
  }

  if (nonEmpty(options.accent)) p.set("accent", normalizeAccent(options.accent));
  for (const [opt, param] of Object.entries(COLOR_OPTIONS) as [ColorOption, string][]) {
    const v = options[opt];
    if (nonEmpty(v)) p.set(param, normalizeColor(opt, v));
  }

  if (options.radius !== undefined) {
    const r = options.radius;
    if (!Number.isInteger(r) || r < 0) {
      throw new LayerHopWidgetError(`Invalid radius ${r}: expected a non-negative integer (px)`);
    }
    p.set("radius", String(r));
  }
  if (options.radiusInner !== undefined) p.set("radiusInner", intIn("radiusInner", options.radiusInner, 0, 32));
  if (options.font !== undefined) p.set("font", oneOf("font", options.font, FONT_IDS));
  if (options.fontScale !== undefined) {
    const f = options.fontScale;
    if (typeof f !== "number" || !Number.isFinite(f) || f < 0.875 || f > 1.125) fail(`Invalid fontScale ${f}: expected 0.875..1.125`);
    if (f !== 1) p.set("fontScale", String(Math.round(f * 10_000) / 10_000));
  }
  if (options.density !== undefined) p.set("density", oneOf("density", options.density, ["compact", "comfortable"] as const));
  if (options.width !== undefined) p.set("width", intIn("width", options.width, 320, 720));
  if (options.shadow !== undefined) p.set("shadow", oneOf("shadow", options.shadow, ["none", "soft", "strong"] as const));
  if (options.border !== undefined) {
    // `border` is one URL param: a border color already claimed it.
    if (nonEmpty(options.borderColor)) fail("Use either border (outline on/off) or borderColor, not both");
    p.set("border", options.border ? "1" : "0");
  }

  if (nonEmpty(options.headerTitle)) p.set("title", plainText("headerTitle", options.headerTitle, MAX_TITLE_LENGTH));
  if (options.hideHeader) p.set("hideHeader", "1");
  if (nonEmpty(options.logo)) p.set("logo", httpsUrl("logo", options.logo));
  if (nonEmpty(options.buttonLabel)) p.set("buttonLabel", plainText("buttonLabel", options.buttonLabel, MAX_BUTTON_LABEL_LENGTH));
  if (options.showUsd === false) p.set("showUsd", "0");

  if (options.fromChains !== undefined) p.set("fromChains", chainList("fromChains", options.fromChains));
  if (options.toChains !== undefined) p.set("toChains", chainList("toChains", options.toChains));
  if (options.excludeChains !== undefined) p.set("excludeChains", chainList("excludeChains", options.excludeChains));
  if (options.fromTokens !== undefined) p.set("fromTokens", tokenList("fromTokens", options.fromTokens));
  if (options.toTokens !== undefined) p.set("toTokens", tokenList("toTokens", options.toTokens));

  if (options.lockSrc) p.set("lockSrc", "1");
  if (options.lockDst) p.set("lockDst", "1");
  if (options.lockAmount) p.set("lockAmount", "1");
  if (options.lockRecipient) {
    if (!nonEmpty(options.recipient)) fail("lockRecipient needs a recipient");
    p.set("lockRecipient", "1");
  }
  if (options.hideRoutes) p.set("hideRoutes", "1");
  if (options.hideSettings) p.set("hideSettings", "1");
  if (options.gasOnArrival) p.set("gasOnArrival", "1");
  if (options.hideHistory) p.set("hideHistory", "1");
  if (options.hidePoweredBy) {
    if (!nonEmpty(options.integrator)) fail("hidePoweredBy needs your partner id in integrator");
    p.set("hidePoweredBy", "1");
  }
  if (options.locale !== undefined) p.set("locale", oneOf("locale", options.locale, ["en"] as const));
  if (nonEmpty(options.allowParentOrigin)) p.set("allowParentOrigin", normalizeOrigin(options.allowParentOrigin));

  if (options.integrator !== undefined) {
    if (!isValidIntegrator(options.integrator)) {
      throw new LayerHopWidgetError(
        `Invalid integrator "${options.integrator}": expected [a-z0-9-]{1,32}`,
      );
    }
    p.set("integrator", options.integrator);
  }

  return url.toString();
}

// ---------------------------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns the message if `data` is a well-formed LayerHop envelope, otherwise `null`. */
export function parseWidgetMessage(data: unknown): WidgetMessage | null {
  if (!isRecord(data) || data.source !== "layerhop") return null;
  const { type, payload } = data;
  if (typeof type !== "string" || !(WIDGET_EVENT_TYPES as readonly string[]).includes(type)) return null;
  if (!isRecord(payload)) return null;
  if (type === "resize") {
    const h = payload.height;
    if (typeof h !== "number" || !Number.isFinite(h) || h < 0) return null;
  }
  return { source: "layerhop", type, payload } as unknown as WidgetMessage;
}

// ---------------------------------------------------------------------------------------------
// Parent -> embed messages (setParams)
// ---------------------------------------------------------------------------------------------

/** `source` of messages sent to the embed. */
export const PARENT_MESSAGE_SOURCE = "layerhop-host";

/** URL params the embed accepts at runtime through `setParams`. */
export const LIVE_PARAMS = [
  "amount", "srcChain", "srcToken", "dstChain", "dstToken", "theme",
  "accent", "accentText", "bg", "surface", "surfaceAlt", "text", "textMuted", "success", "warning", "danger",
] as const;

/**
 * The `setParams` payload that turns embed URL `fromUrl` into `toUrl`, or `null` when a reload is
 * needed: a non-live param changed, a param was removed (only `amount` can be cleared), or a lock
 * would make the embed ignore the change.
 */
export function liveParamsPatch(fromUrl: string, toUrl: string, options: WidgetOptions = {}): Record<string, string> | null {
  const a = new URL(fromUrl).searchParams;
  const b = new URL(toUrl).searchParams;
  const live = new Set<string>(LIVE_PARAMS);
  if (options.lockSrc) ["srcChain", "srcToken"].forEach((k) => live.delete(k));
  if (options.lockDst || options.lockRecipient) ["dstChain", "dstToken"].forEach((k) => live.delete(k));
  if (options.lockAmount) live.delete("amount");
  const patch: Record<string, string> = {};
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const before = a.get(k);
    const after = b.get(k);
    if (before === after) continue;
    if (!live.has(k)) return null;
    if (after === null) {
      if (k !== "amount") return null;
      patch.amount = "";
    } else patch[k] = after;
  }
  return Object.keys(patch).length ? patch : null;
}

// ---------------------------------------------------------------------------------------------
// mount()
// ---------------------------------------------------------------------------------------------

const URL_OPTION_KEYS = [
  "srcChain",
  "srcToken",
  "dstChain",
  "dstToken",
  "amount",
  "recipient",
  "slippageBps",
  "theme",
  "accent",
  "radius",
  "lockSrc",
  "lockDst",
  "hideHistory",
  "integrator",
  "preset",
  "accentText",
  "bg",
  "surface",
  "surfaceAlt",
  "text",
  "textMuted",
  "borderColor",
  "success",
  "warning",
  "danger",
  "radiusInner",
  "font",
  "fontScale",
  "density",
  "width",
  "shadow",
  "border",
  "headerTitle",
  "hideHeader",
  "logo",
  "buttonLabel",
  "fromChains",
  "toChains",
  "excludeChains",
  "fromTokens",
  "toTokens",
  "lockAmount",
  "lockRecipient",
  "hideRoutes",
  "hideSettings",
  "hidePoweredBy",
  "gasOnArrival",
  "showUsd",
  "locale",
  "allowParentOrigin",
] as const satisfies readonly (keyof WidgetOptions)[];

/** Every URL option name (handy for clearing options in wrappers). */
export const WIDGET_OPTION_KEYS: readonly (keyof WidgetOptions)[] = URL_OPTION_KEYS;

const CALLBACK_KEYS = [
  "onReady",
  "onQuote",
  "onSubmitted",
  "onStatus",
  "onError",
  "onResize",
  "onRoutes",
  "onWalletConnected",
  "onWalletDisconnected",
  "onAmountChanged",
  "onEvent",
] as const satisfies readonly (keyof WidgetCallbacks)[];

function pickUrlOptions(o: Partial<MountOptions>): WidgetOptions {
  const out: Record<string, unknown> = {};
  for (const k of URL_OPTION_KEYS) if (k in o) out[k] = o[k];
  return out as WidgetOptions;
}

function pickCallbacks(o: Partial<MountOptions>): WidgetCallbacks {
  const out: Record<string, unknown> = {};
  for (const k of CALLBACK_KEYS) if (k in o) out[k] = o[k];
  return out as WidgetCallbacks;
}

function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target !== "string") return target;
  const el = document.querySelector<HTMLElement>(target);
  if (!el) throw new LayerHopWidgetError(`mount target "${target}" not found`);
  return el;
}

function px(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Create the widget iframe inside `target` and wire up the postMessage events.
 * Messages are accepted only when they come from this iframe's window, from the `baseUrl`
 * origin, and carry `source: "layerhop"`.
 */
export function mount(target: HTMLElement | string, options: MountOptions = {}): WidgetHandle {
  const container = resolveTarget(target);
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const expectedOrigin = resolveEmbedEndpoint(baseUrl).origin;
  const autoResize = options.autoResize ?? true;
  const liveUpdates = options.liveUpdates === true && typeof window !== "undefined";

  let urlOptions = pickUrlOptions(options);
  if (liveUpdates) urlOptions.allowParentOrigin = window.location.origin;
  let callbacks = pickCallbacks(options);
  let src = buildEmbedUrl(urlOptions, baseUrl);

  const iframe = document.createElement("iframe");
  iframe.title = options.title ?? "LayerHop swap";
  iframe.setAttribute("allow", "clipboard-write");
  iframe.setAttribute("frameborder", "0");
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.maxWidth = px(options.maxWidth ?? (urlOptions.width ? urlOptions.width + 16 : DEFAULT_MAX_WIDTH));
  iframe.style.height = px(options.height ?? DEFAULT_HEIGHT);
  iframe.style.border = "0";
  iframe.style.background = "transparent";
  // Must match the embed's root color-scheme (`normal`). If the iframe's used color-scheme differs
  // (e.g. "dark", or inherited from a dark host page), browsers paint an opaque canvas behind the
  // transparent embed: a white box around the card. The embed themes itself from its URL.
  iframe.style.colorScheme = EMBED_COLOR_SCHEME;
  iframe.src = src;
  container.appendChild(iframe);

  let destroyed = false;
  let ready = false;

  const onMessage = (event: MessageEvent): void => {
    if (destroyed) return;
    if (event.source === null || event.source !== iframe.contentWindow) return;
    if (event.origin !== expectedOrigin) return;
    const message = parseWidgetMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case "ready":
        ready = true;
        callbacks.onReady?.(message.payload);
        break;
      case "quote":
        callbacks.onQuote?.(message.payload);
        break;
      case "submitted":
        callbacks.onSubmitted?.(message.payload);
        break;
      case "status":
        callbacks.onStatus?.(message.payload);
        break;
      case "error":
        callbacks.onError?.(message.payload);
        break;
      case "resize":
        if (autoResize) iframe.style.height = `${Math.ceil(message.payload.height)}px`;
        callbacks.onResize?.(message.payload);
        break;
      case "routes":
        callbacks.onRoutes?.(message.payload);
        break;
      case "walletConnected":
        callbacks.onWalletConnected?.(message.payload);
        break;
      case "walletDisconnected":
        callbacks.onWalletDisconnected?.(message.payload);
        break;
      case "amountChanged":
        callbacks.onAmountChanged?.(message.payload);
        break;
    }
    callbacks.onEvent?.(message);
  };

  window.addEventListener("message", onMessage);

  return {
    iframe,
    update(next: UpdateOptions): void {
      if (destroyed) return;
      const merged: WidgetOptions = { ...urlOptions, ...pickUrlOptions(next) };
      if (liveUpdates) merged.allowParentOrigin = window.location.origin;
      callbacks = { ...callbacks, ...pickCallbacks(next) };
      const nextSrc = buildEmbedUrl(merged, baseUrl);
      urlOptions = merged;
      if (nextSrc === src) return;
      const patch = liveUpdates && ready && iframe.contentWindow ? liveParamsPatch(src, nextSrc, urlOptions) : null;
      src = nextSrc;
      if (patch) {
        iframe.contentWindow!.postMessage({ source: PARENT_MESSAGE_SOURCE, type: "setParams", payload: patch }, expectedOrigin);
      } else {
        ready = false;
        iframe.src = nextSrc;
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("message", onMessage);
      iframe.remove();
    },
  };
}
