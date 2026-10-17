/**
 * Framework-agnostic core of the LayerHop widget.
 *
 * The widget is an <iframe> of `${baseUrl}/embed?...`. The query params and the postMessage
 * events implemented here follow docs/URL_CONTRACT.md exactly; treat both as public API.
 */

export const DEFAULT_BASE_URL = "https://layerhop.com";
export const DEFAULT_HEIGHT = 640;
export const DEFAULT_MAX_WIDTH = 480;

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

export type WidgetTheme = "dark" | "light";

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
  /** Color theme; the embed defaults to `dark`. */
  theme?: WidgetTheme;
  /** Accent color as hex (`"#22d3ee"`, `"22d3ee"`, `"#0af"`). The `#` is stripped. */
  accent?: string;
  /** Card corner radius in px (non-negative integer). */
  radius?: number;
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

/** Map of event `type` -> payload, as sent by the embed. */
export interface WidgetEventMap {
  ready: ReadyEvent;
  quote: QuoteEvent;
  submitted: SubmittedEvent;
  status: StatusEvent;
  error: ErrorEvent;
  resize: ResizeEvent;
}
export type WidgetEventType = keyof WidgetEventMap;
export const WIDGET_EVENT_TYPES: readonly WidgetEventType[] = [
  "ready",
  "quote",
  "submitted",
  "status",
  "error",
  "resize",
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
  /** CSS max-width of the iframe. Default 480 (px). */
  maxWidth?: number | string;
  /** iframe `title` attribute. Default `"LayerHop swap"`. */
  title?: string;
}

/** Options accepted by `update()`: URL options and callbacks; `baseUrl` is fixed at mount time. */
export type UpdateOptions = WidgetOptions & WidgetCallbacks;

export interface WidgetHandle {
  readonly iframe: HTMLIFrameElement;
  /** Merge new options. The iframe reloads only if the resulting URL changes. */
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
 * (bad accent, integrator, amount, slippage or radius), so integration bugs surface early.
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

  if (options.theme !== undefined) {
    if (options.theme !== "dark" && options.theme !== "light") {
      throw new LayerHopWidgetError(`Invalid theme "${String(options.theme)}": expected "dark" or "light"`);
    }
    p.set("theme", options.theme);
  }

  if (nonEmpty(options.accent)) p.set("accent", normalizeAccent(options.accent));

  if (options.radius !== undefined) {
    const r = options.radius;
    if (!Number.isInteger(r) || r < 0) {
      throw new LayerHopWidgetError(`Invalid radius ${r}: expected a non-negative integer (px)`);
    }
    p.set("radius", String(r));
  }

  if (options.lockSrc) p.set("lockSrc", "1");
  if (options.lockDst) p.set("lockDst", "1");
  if (options.hideHistory) p.set("hideHistory", "1");

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
] as const satisfies readonly (keyof WidgetOptions)[];

const CALLBACK_KEYS = [
  "onReady",
  "onQuote",
  "onSubmitted",
  "onStatus",
  "onError",
  "onResize",
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

  let urlOptions = pickUrlOptions(options);
  let callbacks = pickCallbacks(options);
  let src = buildEmbedUrl(urlOptions, baseUrl);

  const iframe = document.createElement("iframe");
  iframe.title = options.title ?? "LayerHop swap";
  iframe.setAttribute("allow", "clipboard-write");
  iframe.setAttribute("frameborder", "0");
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.maxWidth = px(options.maxWidth ?? DEFAULT_MAX_WIDTH);
  iframe.style.height = px(options.height ?? DEFAULT_HEIGHT);
  iframe.style.border = "0";
  iframe.style.background = "transparent";
  iframe.style.colorScheme = urlOptions.theme ?? "dark";
  iframe.src = src;
  container.appendChild(iframe);

  let destroyed = false;

  const onMessage = (event: MessageEvent): void => {
    if (destroyed) return;
    if (event.source === null || event.source !== iframe.contentWindow) return;
    if (event.origin !== expectedOrigin) return;
    const message = parseWidgetMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case "ready":
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
    }
    callbacks.onEvent?.(message);
  };

  window.addEventListener("message", onMessage);

  return {
    iframe,
    update(next: UpdateOptions): void {
      if (destroyed) return;
      urlOptions = { ...urlOptions, ...pickUrlOptions(next) };
      callbacks = { ...callbacks, ...pickCallbacks(next) };
      const nextSrc = buildEmbedUrl(urlOptions, baseUrl);
      iframe.style.colorScheme = urlOptions.theme ?? "dark";
      if (nextSrc !== src) {
        src = nextSrc;
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
