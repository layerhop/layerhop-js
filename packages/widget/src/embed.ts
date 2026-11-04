/**
 * Entry for the drop-in <script> build (dist/embed.js, IIFE, global `window.LayerHop`).
 * Auto-mounts every `[data-layerhop-widget]` element once the DOM is ready.
 */
import { autoInit } from "./auto-init";

export { mount, buildEmbedUrl, DEFAULT_BASE_URL, LayerHopWidgetError } from "./core";
export { PRESETS, PRESET_IDS } from "./presets";
export { autoInit, getWidget } from "./auto-init";

type CheckoutGlobal = { open: (...a: unknown[]) => unknown; mount: (...a: unknown[]) => unknown; close: () => void };
const checkoutGlobal = (): CheckoutGlobal => {
  const g = (typeof window !== "undefined" ? (window as unknown as { LayerHopCheckout?: CheckoutGlobal }).LayerHopCheckout : undefined);
  if (!g) throw new Error("LayerHop.checkout needs https://layerhop.com/checkout.js on the page");
  return g;
};

/**
 * `LayerHop.checkout.{open, mount, close}` when this script and checkout.js are both on the page
 * (checkout.js alone defines `LayerHop.checkout` itself). Delegates to `window.LayerHopCheckout`.
 */
export const checkout = {
  open: (...a: unknown[]) => checkoutGlobal().open(...a),
  mount: (...a: unknown[]) => checkoutGlobal().mount(...a),
  close: () => checkoutGlobal().close(),
};

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => autoInit(), { once: true });
  } else {
    autoInit();
  }
}
