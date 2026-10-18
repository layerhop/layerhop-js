/**
 * Embedded checkout: accept LayerHop checkout payments on your own site, without a redirect.
 *
 * The checkout is an <iframe> of `${baseUrl}/pay/{sessionId}?embed=1|modal&origin=<your origin>`.
 * It reports to your page with postMessage envelopes
 * `{ source: "layerhop-checkout", version: 1, type, sessionId, ... }` (types `ready`, `resize`,
 * `status`, `paid`, `cancel`, `close`). Treat the URL and the messages as public API.
 */

import { DEFAULT_BASE_URL } from "./core";

export const DEFAULT_API_URL = "https://api.layerhop.com";
export const CHECKOUT_MESSAGE_SOURCE = "layerhop-checkout";
export const CHECKOUT_MESSAGE_VERSION = 1;
/** Initial height of the iframe until its first `resize` message. */
export const CHECKOUT_DEFAULT_HEIGHT = 600;
export const CHECKOUT_DEFAULT_MAX_WIDTH = 480;
/** color-scheme for the iframe element; equals the checkout document's root (no opaque canvas). */
const FRAME_COLOR_SCHEME = "normal";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type CheckoutStatus = "open" | "processing" | "paid" | "expired" | "needs_review";

export interface CheckoutSession {
  id: string;
  object: "checkout.session";
  livemode: boolean;
  status: CheckoutStatus;
  statusDetail: string | null;
  /** Amount due, in base units of the settlement token. */
  amount: string;
  settlement: { chainId: number; token: string; symbol: string; decimals: number };
  recipient: string;
  merchantName: string | null;
  description: string | null;
  /** The hosted checkout page. */
  url: string;
  productId?: string | null;
  successUrl: string | null;
  cancelUrl: string | null;
  expiresAt: string;
  payment: {
    quoteId: string;
    payer: string | null;
    srcChainId: number | null;
    srcToken: string | null;
    srcAmount: string | null;
    srcTxHash: string | null;
    dstTxHash: string | null;
    paidAt: string | null;
  } | null;
  /** Present on sessions you just created (createProductSession), not in `paid` messages. */
  reference?: string | null;
  metadata?: Record<string, string> | null;
  createdAt?: string;
  updatedAt?: string;
}

/** What a payment button may read about a product (`GET /v1/checkout/products/{id}`). */
export interface CheckoutProduct {
  id: string;
  object: "checkout.product";
  livemode: boolean;
  active: boolean;
  name: string;
  description: string | null;
  merchantName: string | null;
  amount: string;
  settlement: { chainId: number; token: string; symbol: string; decimals: number };
  /** The `/buy/{id}` link. */
  url: string;
}

export interface CheckoutMessagePayloads {
  ready: Record<never, never>;
  resize: { height: number };
  status: { status: CheckoutStatus };
  paid: { session: CheckoutSession };
  cancel: Record<never, never>;
  close: Record<never, never>;
}
export type CheckoutMessageType = keyof CheckoutMessagePayloads;
export type CheckoutMessage<T extends CheckoutMessageType = CheckoutMessageType> = {
  [K in T]: { source: typeof CHECKOUT_MESSAGE_SOURCE; version: number; type: K; sessionId: string } & CheckoutMessagePayloads[K];
}[T];

export interface CheckoutCallbacks {
  /** The checkout page loaded in the iframe. */
  onReady?: () => void;
  /** The session is paid (delivery verified on chain). Fulfil on the webhook, not only here. */
  onPaid?: (session: CheckoutSession) => void;
  /** The payer pressed "Cancel payment" (or "Back" on an expired session). The modal closes. */
  onCancel?: () => void;
  /** The modal closed, for any reason (close button, Escape, backdrop, cancel, `handle.close()`). */
  onClose?: () => void;
  /** Every session status change: open → processing → paid (or expired / needs_review). */
  onStatus?: (status: CheckoutStatus) => void;
  /** The session couldn't be started (createProductSession failed) or the options were invalid. */
  onError?: (error: LayerHopCheckoutError) => void;
}

export interface CheckoutOptions extends CheckoutCallbacks {
  /** An existing session (`cs_…`), e.g. created on your server with your API key. */
  sessionId?: string;
  /** A product (`prod_…`): a new session is started for it in the browser. */
  productId?: string;
  /** With `productId`: your order id, echoed on the session and its webhooks. */
  reference?: string;
  /** With `productId`: up to 10 string values, echoed on the session and its webhooks. */
  metadata?: Record<string, string>;
  /** Where the checkout page lives. Default https://layerhop.com. */
  baseUrl?: string;
  /** The public API. Default https://api.layerhop.com. */
  apiUrl?: string;
  /** iframe title (accessible name). Default "LayerHop checkout". */
  title?: string;
}

export interface MountCheckoutOptions extends CheckoutOptions {
  /** Follow the checkout's height (default true). */
  autoResize?: boolean;
  /** Initial (or, without autoResize, fixed) height. Default 600. */
  height?: number | string;
  /** Default 480. */
  maxWidth?: number | string;
}

export interface CheckoutHandle {
  /** Resolves with the session id (at once for `sessionId`, after the session is created for `productId`). */
  readonly sessionId: Promise<string>;
  /** The iframe, once it exists. */
  readonly iframe: HTMLIFrameElement | null;
  /** Close the modal / remove the inline checkout. Idempotent. */
  close(): void;
}

export class LayerHopCheckoutError extends Error {
  override name = "LayerHopCheckoutError";
  constructor(message: string, readonly code: string = "INVALID_OPTIONS", readonly status?: number) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// URLs and validation
// ---------------------------------------------------------------------------------------------

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{6,80}$/;
const PRODUCT_ID_RE = /^prod_[A-Za-z0-9_]{4,96}$/;

export const isCheckoutSessionId = (id: unknown): id is string => typeof id === "string" && SESSION_ID_RE.test(id);
export const isCheckoutProductId = (id: unknown): id is string => typeof id === "string" && PRODUCT_ID_RE.test(id);

function httpBase(name: string, value: string): URL {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new LayerHopCheckoutError(`Invalid ${name} "${value}"`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new LayerHopCheckoutError(`Invalid ${name} "${value}": must be http(s)`);
  u.pathname = u.pathname.replace(/\/+$/, "");
  u.search = "";
  u.hash = "";
  return u;
}

/** The origin the checkout iframe posts from (messages from anywhere else are ignored). */
export function checkoutOrigin(baseUrl: string = DEFAULT_BASE_URL): string {
  return httpBase("baseUrl", baseUrl).origin;
}

export interface CheckoutUrlOptions {
  baseUrl?: string;
  /** `inline` (default) or `modal` (adds a close button and Escape handling inside the frame). */
  mode?: "inline" | "modal";
  /** Your page's origin, used as the frame's postMessage targetOrigin. */
  origin?: string;
}

/** `https://layerhop.com/pay/cs_…?embed=1&origin=https%3A%2F%2Fshop.example.com` */
export function buildCheckoutUrl(sessionId: string, opts: CheckoutUrlOptions = {}): string {
  if (!isCheckoutSessionId(sessionId)) throw new LayerHopCheckoutError(`Invalid sessionId "${sessionId}": expected cs_…`);
  const u = httpBase("baseUrl", opts.baseUrl ?? DEFAULT_BASE_URL);
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/pay/${encodeURIComponent(sessionId)}`;
  u.searchParams.set("embed", opts.mode === "modal" ? "modal" : "1");
  const origin = opts.origin && /^https?:\/\/[^/]+$/.test(opts.origin) ? opts.origin : undefined;
  if (origin) u.searchParams.set("origin", origin);
  return u.toString();
}

/** The no-JS fallback link for a product: `https://layerhop.com/buy/prod_…?reference=…`. */
export function buildBuyUrl(productId: string, opts: { baseUrl?: string; reference?: string; metadata?: Record<string, string> } = {}): string {
  if (!isCheckoutProductId(productId)) throw new LayerHopCheckoutError(`Invalid productId "${productId}": expected prod_…`);
  const u = httpBase("baseUrl", opts.baseUrl ?? DEFAULT_BASE_URL);
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/buy/${encodeURIComponent(productId)}`;
  if (opts.reference) u.searchParams.set("reference", opts.reference);
  for (const [k, v] of Object.entries(opts.metadata ?? {})) u.searchParams.set(`metadata[${k}]`, v);
  return u.toString();
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STATUSES: readonly CheckoutStatus[] = ["open", "processing", "paid", "expired", "needs_review"];

/** Validate a postMessage payload from the checkout frame; null when it isn't one. */
export function parseCheckoutMessage(data: unknown): CheckoutMessage | null {
  if (!isRecord(data) || data.source !== CHECKOUT_MESSAGE_SOURCE || typeof data.version !== "number" || data.version < 1) return null;
  if (!isCheckoutSessionId(data.sessionId)) return null;
  const base = { source: CHECKOUT_MESSAGE_SOURCE, version: data.version, sessionId: data.sessionId } as const;
  switch (data.type) {
    case "ready":
    case "cancel":
    case "close":
      return { ...base, type: data.type } as CheckoutMessage<"ready" | "cancel" | "close">;
    case "resize":
      return typeof data.height === "number" && Number.isFinite(data.height) && data.height > 0 && data.height < 20_000 ? { ...base, type: "resize", height: data.height } : null;
    case "status":
      return STATUSES.includes(data.status as CheckoutStatus) ? { ...base, type: "status", status: data.status as CheckoutStatus } : null;
    case "paid":
      return isRecord(data.session) && data.session.id === data.sessionId ? { ...base, type: "paid", session: data.session as unknown as CheckoutSession } : null;
    default:
      return null;
  }
}

/**
 * A message event really comes from this checkout frame: sent by `iframe`'s window, from the
 * checkout origin, with a valid envelope (and, when known, for this session).
 */
export function acceptCheckoutMessage(event: Pick<MessageEvent, "source" | "origin" | "data">, iframe: HTMLIFrameElement | null, expectedOrigin: string, sessionId?: string): CheckoutMessage | null {
  if (!iframe || event.source === null || event.source !== iframe.contentWindow) return null;
  if (event.origin !== expectedOrigin) return null;
  const msg = parseCheckoutMessage(event.data);
  if (!msg || (sessionId && msg.sessionId !== sessionId)) return null;
  return msg;
}

// ---------------------------------------------------------------------------------------------
// Public API calls
// ---------------------------------------------------------------------------------------------

export interface ProductSessionOptions {
  reference?: string;
  metadata?: Record<string, string>;
  apiUrl?: string;
  /** Custom fetch (tests, SSR). */
  fetch?: typeof fetch;
}

async function call<T>(url: string, init: RequestInit, fetchFn: typeof fetch | undefined): Promise<T> {
  const f = fetchFn ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
  if (!f) throw new LayerHopCheckoutError("fetch is not available", "NETWORK_ERROR");
  let res: Response;
  try {
    res = await f(url, { ...init, credentials: "omit" });
  } catch (e) {
    throw new LayerHopCheckoutError(`Couldn't reach LayerHop: ${(e as Error)?.message ?? e}`, "NETWORK_ERROR");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = isRecord(body) && isRecord(body.error) ? body.error : {};
    const code = typeof err.code === "string" ? err.code : `HTTP_${res.status}`;
    const message = typeof err.message === "string" ? err.message : `LayerHop answered ${res.status}`;
    throw new LayerHopCheckoutError(message, code, res.status);
  }
  return body as T;
}

const apiBase = (apiUrl?: string) => httpBase("apiUrl", apiUrl ?? DEFAULT_API_URL).toString().replace(/\/$/, "");

/** `GET /v1/checkout/products/{id}`: name and price for a button. */
export function getProduct(productId: string, opts: { apiUrl?: string; fetch?: typeof fetch } = {}): Promise<CheckoutProduct> {
  if (!isCheckoutProductId(productId)) return Promise.reject(new LayerHopCheckoutError(`Invalid productId "${productId}": expected prod_…`));
  return call<CheckoutProduct>(`${apiBase(opts.apiUrl)}/v1/checkout/products/${encodeURIComponent(productId)}`, { method: "GET" }, opts.fetch);
}

/**
 * `POST /v1/checkout/products/{id}/sessions`: start a checkout session for a product, from the
 * browser (no API key). Rejects with LayerHopCheckoutError (`NOT_FOUND`, `CONFLICT` when the
 * product is inactive, `FORBIDDEN` when this site isn't one of its allowed origins, ...).
 */
export async function createProductSession(productId: string, opts: ProductSessionOptions = {}): Promise<CheckoutSession> {
  if (!isCheckoutProductId(productId)) throw new LayerHopCheckoutError(`Invalid productId "${productId}": expected prod_…`);
  const body: { reference?: string; metadata?: Record<string, string> } = {};
  if (opts.reference !== undefined && opts.reference !== "") body.reference = String(opts.reference);
  if (opts.metadata && Object.keys(opts.metadata).length) {
    body.metadata = Object.fromEntries(Object.entries(opts.metadata).map(([k, v]) => [k, String(v)]));
  }
  const session = await call<CheckoutSession>(
    `${apiBase(opts.apiUrl)}/v1/checkout/products/${encodeURIComponent(productId)}/sessions`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    opts.fetch,
  );
  if (!isRecord(session) || !isCheckoutSessionId(session.id)) throw new LayerHopCheckoutError("LayerHop returned no session", "BAD_RESPONSE");
  return session;
}

// ---------------------------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------------------------

function toError(e: unknown): LayerHopCheckoutError {
  return e instanceof LayerHopCheckoutError ? e : new LayerHopCheckoutError((e as Error)?.message ?? String(e), "UNKNOWN");
}

/** Validate options and resolve the session id (creating a session for a product). */
function resolveSession(opts: CheckoutOptions): Promise<string> {
  try {
    if (!!opts.sessionId === !!opts.productId) throw new LayerHopCheckoutError("Pass exactly one of sessionId or productId");
    checkoutOrigin(opts.baseUrl);
    if (opts.sessionId) {
      if (!isCheckoutSessionId(opts.sessionId)) throw new LayerHopCheckoutError(`Invalid sessionId "${opts.sessionId}": expected cs_…`);
      return Promise.resolve(opts.sessionId);
    }
    return createProductSession(opts.productId!, { reference: opts.reference, metadata: opts.metadata, apiUrl: opts.apiUrl }).then((s) => s.id);
  } catch (e) {
    return Promise.reject(toError(e));
  }
}

function pageOrigin(): string | undefined {
  const o = typeof location !== "undefined" ? location.origin : undefined;
  return o && /^https?:\/\//.test(o) ? o : undefined;
}

function px(v: number | string): string {
  return typeof v === "number" ? `${v}px` : v;
}

function createFrame(src: string, title: string | undefined): HTMLIFrameElement {
  const f = document.createElement("iframe");
  f.title = title ?? "LayerHop checkout";
  // Wallet extensions and WalletConnect run inside the frame; clipboard for copy buttons.
  f.setAttribute("allow", "clipboard-write");
  f.setAttribute("frameborder", "0");
  f.style.display = "block";
  f.style.width = "100%";
  f.style.border = "0";
  f.style.background = "transparent";
  // Must match the checkout document's root color-scheme, or browsers paint an opaque canvas.
  f.style.colorScheme = FRAME_COLOR_SCHEME;
  f.src = src;
  return f;
}

/** Route checkout messages from `frame()` to callbacks. Returns the remover. */
function listen(getFrame: () => HTMLIFrameElement | null, expectedOrigin: string, getSessionId: () => string | undefined, on: (msg: CheckoutMessage) => void): () => void {
  const handler = (event: MessageEvent) => {
    const msg = acceptCheckoutMessage(event, getFrame(), expectedOrigin, getSessionId());
    if (msg) on(msg);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

function reportError(opts: CheckoutCallbacks, err: LayerHopCheckoutError): void {
  if (opts.onError) opts.onError(err);
  else console.error("[LayerHop] checkout:", err);
}

// ---------------------------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------------------------

function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target !== "string") return target;
  const el = document.querySelector<HTMLElement>(target);
  if (!el) throw new LayerHopCheckoutError(`Element "${target}" not found`);
  return el;
}

/** Render the checkout inline in `target` (an element or a selector). The iframe follows its content height. */
export function mountCheckout(target: HTMLElement | string, opts: MountCheckoutOptions): CheckoutHandle {
  const container = resolveTarget(target);
  const autoResize = opts.autoResize ?? true;
  let iframe: HTMLIFrameElement | null = null;
  let sid: string | undefined;
  let closed = false;
  let unlisten = () => {};

  const sessionId = resolveSession(opts);
  sessionId.catch(() => undefined); // surfaced through onError; callers may still await it
  container.setAttribute("aria-busy", "true");
  sessionId.then(
    (id) => {
      container.removeAttribute("aria-busy");
      if (closed) return;
      sid = id;
      const origin = checkoutOrigin(opts.baseUrl);
      iframe = createFrame(buildCheckoutUrl(id, { baseUrl: opts.baseUrl, mode: "inline", origin: pageOrigin() }), opts.title);
      iframe.style.maxWidth = px(opts.maxWidth ?? CHECKOUT_DEFAULT_MAX_WIDTH);
      iframe.style.height = px(opts.height ?? CHECKOUT_DEFAULT_HEIGHT);
      iframe.style.marginInline = "auto";
      unlisten = listen(() => iframe, origin, () => sid, (msg) => {
        switch (msg.type) {
          case "ready": return opts.onReady?.();
          case "resize": if (autoResize && iframe) iframe.style.height = `${Math.ceil(msg.height)}px`; return;
          case "status": return opts.onStatus?.(msg.status);
          case "paid": return opts.onPaid?.(msg.session);
          case "cancel": return opts.onCancel?.();
          case "close": return; // inline frames have no close button
        }
      });
      container.appendChild(iframe);
    },
    (e) => {
      container.removeAttribute("aria-busy");
      if (!closed) reportError(opts, toError(e));
    },
  );

  return {
    sessionId,
    get iframe() {
      return iframe;
    },
    close() {
      if (closed) return;
      closed = true;
      unlisten();
      iframe?.remove();
      iframe = null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------------------------

const STYLE_ID = "layerhop-checkout-style";
const CSS = `
.lhco-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.lhco-backdrop{position:absolute;inset:0;background:rgba(4,7,13,.72);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:lhco-fade .18s ease-out}
.lhco-dialog{position:relative;display:flex;flex-direction:column;width:100%;max-width:480px;min-height:260px;max-height:100%;border-radius:24px;overflow:hidden;background:#090d15;box-shadow:0 30px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.08);animation:lhco-pop .22s cubic-bezier(.2,.9,.3,1.05);outline:none}
.lhco-dialog iframe{flex:0 1 auto;min-height:0;height:${CHECKOUT_DEFAULT_HEIGHT}px;max-height:calc(100vh - 48px);max-height:calc(100dvh - 48px)}
.lhco-sentinel{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.lhco-status{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;background:#090d15;color:#9eadc2;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
.lhco-status[hidden]{display:none}
.lhco-status strong{color:#ebf1f9;font-size:16px;font-weight:600}
.lhco-spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(158,173,194,.25);border-top-color:#c3f06b;animation:lhco-rot .8s linear infinite}
.lhco-x{position:absolute;top:12px;right:12px;display:grid;place-items:center;width:40px;height:40px;border:0;border-radius:12px;background:transparent;color:#9eadc2;cursor:pointer}
.lhco-x:hover{background:#19212f;color:#ebf1f9}
.lhco-x:focus-visible,.lhco-btn:focus-visible{outline:2px solid #c3f06b;outline-offset:2px}
.lhco-btn{min-height:44px;padding:0 20px;border:0;border-radius:14px;background:#19212f;color:#ebf1f9;font:600 14px system-ui,-apple-system,sans-serif;cursor:pointer}
@media (max-width:560px){
.lhco-overlay{padding:12px 0 0;align-items:flex-end}
.lhco-dialog{max-width:none;height:100%;border-radius:20px 20px 0 0;animation-name:lhco-up}
.lhco-dialog iframe{flex:1 1 auto;height:auto!important;max-height:none}
}
@keyframes lhco-fade{from{opacity:0}}
@keyframes lhco-pop{from{opacity:0;transform:translateY(8px) scale(.98)}}
@keyframes lhco-up{from{transform:translateY(100%)}}
@keyframes lhco-rot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.lhco-backdrop,.lhco-dialog{animation:none}.lhco-spin{animation-duration:2s}}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const X_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let current: CheckoutHandle | null = null;

/**
 * Open the checkout in a modal overlay (a bottom sheet on phones). Accessible: aria-modal dialog,
 * focus kept inside, Escape and the backdrop close it, page scroll locked, focus restored on close.
 */
export function openCheckout(opts: CheckoutOptions): CheckoutHandle {
  current?.close();
  ensureStyle();
  const doc = document;
  const previouslyFocused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

  const overlay = doc.createElement("div");
  overlay.className = "lhco-overlay";
  overlay.setAttribute("data-layerhop-checkout", "");
  const backdrop = doc.createElement("div");
  backdrop.className = "lhco-backdrop";
  const dialog = doc.createElement("div");
  dialog.className = "lhco-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", opts.title ?? "LayerHop checkout");
  dialog.tabIndex = -1;
  const sentinel = () => {
    const s = doc.createElement("span");
    s.className = "lhco-sentinel";
    s.tabIndex = 0;
    return s;
  };
  const start = sentinel();
  const end = sentinel();
  const status = doc.createElement("div");
  status.className = "lhco-status";
  status.setAttribute("role", "status");
  status.innerHTML = `<span class="lhco-spin" aria-hidden="true"></span><span>Loading checkout…</span>`;
  const x = doc.createElement("button");
  x.type = "button";
  x.className = "lhco-x";
  x.setAttribute("aria-label", "Close checkout");
  x.innerHTML = X_ICON;
  status.appendChild(x);
  dialog.append(start, status, end);
  overlay.append(backdrop, dialog);

  // ---- page lock: scroll, inert siblings -------------------------------------------------------
  const html = doc.documentElement;
  const body = doc.body;
  const scrollbar = window.innerWidth - html.clientWidth;
  const saved = { overflow: html.style.overflow, paddingRight: body.style.paddingRight };
  html.style.overflow = "hidden";
  if (scrollbar > 0) body.style.paddingRight = `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + scrollbar}px`;
  const madeInert: Element[] = [];
  for (const el of Array.from(body.children)) {
    if (el === overlay || el.hasAttribute("inert") || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    el.setAttribute("inert", "");
    madeInert.push(el);
  }
  body.appendChild(overlay);

  let iframe: HTMLIFrameElement | null = null;
  let sid: string | undefined;
  let closed = false;
  let unlisten = () => {};

  const focusInside = () => {
    if (iframe && status.hidden) iframe.focus();
    else (status.querySelector<HTMLElement>(".lhco-btn") ?? x).focus();
  };
  start.addEventListener("focus", focusInside);
  end.addEventListener("focus", focusInside);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handle.close();
    } else if (e.key === "Tab" && !overlay.contains(doc.activeElement)) {
      e.preventDefault();
      focusInside();
    }
  };
  doc.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("click", () => handle.close());
  x.addEventListener("click", () => handle.close());

  const showError = (err: LayerHopCheckoutError) => {
    status.hidden = false;
    status.setAttribute("role", "alert");
    status.innerHTML = "";
    const title = doc.createElement("strong");
    title.textContent = err.code === "CONFLICT" ? "Not available right now" : err.code === "FORBIDDEN" ? "Can't pay from this site" : "Can't start the payment";
    const text = doc.createElement("span");
    text.textContent = err.code === "INVALID_OPTIONS" ? err.message : `${err.message}. Nothing was charged.`;
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "lhco-btn";
    btn.textContent = "Close";
    btn.addEventListener("click", () => handle.close());
    status.append(title, text, btn, x);
    btn.focus();
  };

  const handle: CheckoutHandle = {
    sessionId: resolveSession(opts),
    get iframe() {
      return iframe;
    },
    close() {
      if (closed) return;
      closed = true;
      if (current === handle) current = null;
      unlisten();
      doc.removeEventListener("keydown", onKey, true);
      overlay.remove();
      for (const el of madeInert) el.removeAttribute("inert");
      html.style.overflow = saved.overflow;
      body.style.paddingRight = saved.paddingRight;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      opts.onClose?.();
    },
  };
  current = handle;
  handle.sessionId.catch(() => undefined);
  x.focus();

  handle.sessionId.then(
    (id) => {
      if (closed) return;
      sid = id;
      const origin = checkoutOrigin(opts.baseUrl);
      iframe = createFrame(buildCheckoutUrl(id, { baseUrl: opts.baseUrl, mode: "modal", origin: pageOrigin() }), opts.title);
      const reveal = () => {
        if (closed || status.hidden) return;
        const hadFocus = overlay.contains(doc.activeElement);
        status.hidden = true;
        if (hadFocus) iframe?.focus();
      };
      // `load` reveals too, so a frame that can't message us (wrong baseUrl) is never stuck behind the spinner.
      iframe.addEventListener("load", () => setTimeout(reveal, 400));
      unlisten = listen(() => iframe, origin, () => sid, (msg) => {
        switch (msg.type) {
          case "ready":
            reveal();
            return opts.onReady?.();
          case "resize":
            if (iframe) iframe.style.height = `${Math.ceil(msg.height)}px`;
            return;
          case "status":
            return opts.onStatus?.(msg.status);
          case "paid":
            return opts.onPaid?.(msg.session);
          case "cancel":
            opts.onCancel?.();
            return handle.close();
          case "close":
            return handle.close();
        }
      });
      dialog.insertBefore(iframe, status);
    },
    (e) => {
      if (closed) return;
      const err = toError(e);
      showError(err);
      reportError(opts, err);
    },
  );
  return handle;
}

/** Close the open checkout modal, if any. */
export function closeCheckout(): void {
  current?.close();
}
