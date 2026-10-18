/**
 * No-code payment buttons for checkout.js:
 *
 *   <button data-layerhop-product="prod_…">Pay with crypto</button>     → modal on click
 *   <button data-layerhop-session="cs_…"></button>                      → modal on click
 *   <div data-layerhop-product="prod_…" data-layerhop-mode="inline">    → inline checkout
 *
 * Optional: `data-layerhop-reference`, `data-layerhop-metadata='{"plan":"pro"}'` or
 * `data-layerhop-metadata-<key>="value"`, `data-layerhop-base-url`, `data-layerhop-api-url`.
 * Events bubble from the element as DOM CustomEvents: `layerhop:ready`, `layerhop:status`,
 * `layerhop:paid`, `layerhop:cancel`, `layerhop:close`, `layerhop:error` (data in `event.detail`).
 */
import {
  LayerHopCheckoutError,
  mountCheckout,
  openCheckout,
  type CheckoutCallbacks,
  type CheckoutHandle,
  type CheckoutOptions,
} from "./checkout";

export const CHECKOUT_SELECTOR = "[data-layerhop-product],[data-layerhop-session]";
export const DEFAULT_BUTTON_LABEL = "Pay with crypto";
const MOUNTED = "data-layerhop-mounted";
const META_PREFIX = "data-layerhop-metadata-";

export interface CheckoutDefaults {
  baseUrl?: string;
  apiUrl?: string;
}

export interface ElementCheckout {
  mode: "modal" | "inline";
  options: CheckoutOptions;
}

/** Read checkout options from an element's `data-layerhop-*` attributes. Throws on invalid metadata JSON. */
export function checkoutOptionsFromElement(el: Element, defaults: CheckoutDefaults = {}): ElementCheckout {
  const attr = (name: string) => {
    const v = el.getAttribute(`data-layerhop-${name}`);
    return v === null || v.trim() === "" ? undefined : v.trim();
  };
  const options: CheckoutOptions = {};
  const product = attr("product");
  const session = attr("session");
  if (product) options.productId = product;
  else if (session) options.sessionId = session;
  const reference = attr("reference");
  if (reference) options.reference = reference;

  const metadata: Record<string, string> = {};
  const json = attr("metadata");
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new LayerHopCheckoutError(`Invalid data-layerhop-metadata: expected a JSON object like {"plan":"pro"}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new LayerHopCheckoutError(`Invalid data-layerhop-metadata: expected a JSON object like {"plan":"pro"}`);
    }
    for (const [k, v] of Object.entries(parsed)) metadata[k] = String(v);
  }
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith(META_PREFIX) && a.name.length > META_PREFIX.length) metadata[a.name.slice(META_PREFIX.length)] = a.value;
  }
  if (Object.keys(metadata).length) options.metadata = metadata;

  const baseUrl = attr("base-url") ?? defaults.baseUrl;
  const apiUrl = attr("api-url") ?? defaults.apiUrl;
  if (baseUrl) options.baseUrl = baseUrl;
  if (apiUrl) options.apiUrl = apiUrl;
  const title = attr("title");
  if (title) options.title = title;
  return { mode: attr("mode")?.toLowerCase() === "inline" ? "inline" : "modal", options };
}

/**
 * Callbacks that re-dispatch every checkout event on `el` as a bubbling `layerhop:<type>` CustomEvent
 * (`detail.sessionId` once known). `attach(handle)` picks the session id up from the handle.
 */
export function elementCallbacks(el: Element): CheckoutCallbacks & { attach(h: CheckoutHandle): CheckoutHandle } {
  let sessionId: string | undefined;
  const fire = (type: string, detail: Record<string, unknown> = {}) => {
    el.dispatchEvent(new CustomEvent(`layerhop:${type}`, { bubbles: true, detail: { sessionId, ...detail } }));
  };
  return {
    attach(h) {
      h.sessionId.then((id) => (sessionId = id), () => undefined);
      return h;
    },
    onReady: () => fire("ready"),
    onStatus: (status) => fire("status", { status }),
    onPaid: (session) => fire("paid", { session, sessionId: session.id }),
    onCancel: () => fire("cancel"),
    onClose: () => fire("close"),
    onError: (error) => {
      console.error("[LayerHop] checkout:", error);
      fire("error", { error, code: error.code, message: error.message });
    },
  };
}

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

/** An empty `<button data-layerhop-product>` gets the default label. */
function labelButton(el: Element): void {
  if (el.tagName === "BUTTON" && !el.children.length && !(el.textContent ?? "").trim()) el.textContent = DEFAULT_BUTTON_LABEL;
}

/** Open the modal for a payment button element (what a click on it does). */
export function openFromElement(el: Element, defaults: CheckoutDefaults = {}): CheckoutHandle | null {
  let parsed: ElementCheckout;
  try {
    parsed = checkoutOptionsFromElement(el, defaults);
  } catch (e) {
    elementCallbacks(el).onError!(e as LayerHopCheckoutError);
    return null;
  }
  const cb = elementCallbacks(el);
  return cb.attach(openCheckout({ ...parsed.options, ...cb }));
}

let clickDefaults: CheckoutDefaults = {};
let clickInstalled = false;

function onDocumentClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const el = (e.target as Element | null)?.closest?.(CHECKOUT_SELECTOR);
  if (!el || el.hasAttribute(MOUNTED) || isDisabled(el)) return;
  if (el.getAttribute("data-layerhop-mode")?.trim().toLowerCase() === "inline") return;
  // Links (e.g. a /buy/{id} fallback href) and submit buttons do nothing else.
  e.preventDefault();
  openFromElement(el, clickDefaults);
}

/**
 * Wire up payment buttons under `root`: label empty buttons, mount `data-layerhop-mode="inline"`
 * elements, and (once per page) listen for clicks on any matching element, including ones added later.
 * Returns the handles of the inline checkouts mounted by this call.
 */
export function autoInitCheckout(root: ParentNode = document, defaults: CheckoutDefaults = {}): CheckoutHandle[] {
  clickDefaults = { ...clickDefaults, ...defaults };
  if (!clickInstalled && typeof document !== "undefined") {
    document.addEventListener("click", onDocumentClick);
    clickInstalled = true;
  }
  const mounted: CheckoutHandle[] = [];
  root.querySelectorAll(CHECKOUT_SELECTOR).forEach((el) => {
    labelButton(el);
    if (el.hasAttribute(MOUNTED) || el.getAttribute("data-layerhop-mode")?.trim().toLowerCase() !== "inline") return;
    try {
      const { options } = checkoutOptionsFromElement(el, clickDefaults);
      const cb = elementCallbacks(el);
      mounted.push(cb.attach(mountCheckout(el as HTMLElement, { ...options, ...cb })));
      el.setAttribute(MOUNTED, "");
    } catch (e) {
      elementCallbacks(el).onError!(e as LayerHopCheckoutError);
    }
  });
  return mounted;
}

/** Test helper: forget the document click listener. */
export function resetCheckoutAutoInit(): void {
  if (clickInstalled) document.removeEventListener("click", onDocumentClick);
  clickInstalled = false;
  clickDefaults = {};
}
