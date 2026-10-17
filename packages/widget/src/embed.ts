/**
 * Entry for the drop-in <script> build (dist/embed.js, IIFE, global `window.LayerHop`).
 * Auto-mounts every `[data-layerhop-widget]` element once the DOM is ready.
 */
import { autoInit } from "./auto-init";

export { mount, buildEmbedUrl, DEFAULT_BASE_URL, LayerHopWidgetError } from "./core";
export { PRESETS, PRESET_IDS } from "./presets";
export { autoInit, getWidget } from "./auto-init";

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => autoInit(), { once: true });
  } else {
    autoInit();
  }
}
