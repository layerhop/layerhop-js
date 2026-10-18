/**
 * Entry for the drop-in checkout script (dist/checkout.js, IIFE, global `window.LayerHopCheckout`),
 * served at https://layerhop.com/checkout.js:
 *
 *   <script src="https://layerhop.com/checkout.js" async></script>
 *   <button data-layerhop-product="prod_…">Pay with crypto</button>
 *
 * Wires up every payment button once the DOM is ready (checkout-auto-init.ts). Defaults for
 * `baseUrl` / `apiUrl` come from `data-layerhop-base-url` / `data-layerhop-api-url` on the script tag,
 * or from `window.LayerHopCheckoutConfig = { baseUrl, apiUrl }` set before the script loads.
 */
import { autoInitCheckout, type CheckoutDefaults } from "./checkout-auto-init";
import {
  createProductSession as createSession,
  mountCheckout,
  openCheckout,
  type CheckoutOptions,
  type MountCheckoutOptions,
  type ProductSessionOptions,
} from "./checkout";

declare const __WIDGET_VERSION__: string;
export const version: string = typeof __WIDGET_VERSION__ === "string" ? __WIDGET_VERSION__ : "dev";

function scriptDefaults(): CheckoutDefaults {
  const out: CheckoutDefaults = {};
  const global = (typeof window !== "undefined" ? (window as { LayerHopCheckoutConfig?: CheckoutDefaults }).LayerHopCheckoutConfig : undefined) ?? {};
  if (typeof global.baseUrl === "string") out.baseUrl = global.baseUrl;
  if (typeof global.apiUrl === "string") out.apiUrl = global.apiUrl;
  const script = typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null) : null;
  const base = script?.getAttribute("data-layerhop-base-url");
  const api = script?.getAttribute("data-layerhop-api-url");
  if (base) out.baseUrl = base;
  if (api) out.apiUrl = api;
  return out;
}

/** Captured while the script runs (document.currentScript is only set then). */
const defaults = scriptDefaults();

/** `LayerHopCheckout.open({ sessionId | productId, onPaid, ... })`: the checkout in a modal. */
export function open(opts: CheckoutOptions) {
  return openCheckout({ ...defaults, ...opts });
}

/** `LayerHopCheckout.mount("#pay", { ... })`: the checkout inline, auto-resizing. */
export function mount(target: HTMLElement | string, opts: MountCheckoutOptions) {
  return mountCheckout(target, { ...defaults, ...opts });
}

/** `LayerHopCheckout.createProductSession("prod_…", { reference })`: start a session yourself. */
export function createProductSession(productId: string, opts: ProductSessionOptions = {}) {
  return createSession(productId, { apiUrl: defaults.apiUrl, ...opts });
}

/** Re-scan the page (or `root`) for payment buttons added later. */
export function autoInit(root: ParentNode = document) {
  return autoInitCheckout(root, defaults);
}

export { closeCheckout as close, buildCheckoutUrl, buildBuyUrl, getProduct, LayerHopCheckoutError } from "./checkout";

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => autoInit(), { once: true });
  else autoInit();
}
