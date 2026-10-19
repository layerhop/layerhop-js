/**
 * The WebView <-> React Native bridge.
 *
 * The hosted widget (`/embed`) and checkout (`/pay/{id}?embed=…`) post their events to
 * `window.parent`, and only when they are framed (`window.parent !== window`). A WebView loads them
 * as the top document, so before any page script runs we install a `window.parent` whose
 * `postMessage` forwards the envelope to React Native (`window.ReactNativeWebView.postMessage`).
 * The pages then behave exactly as they do inside an iframe, and the same postMessage protocol
 * (docs/URL_CONTRACT.md) reaches the app. Nothing else on the page is touched.
 */

import { LayerHopWidgetError } from "@layerhop/widget";

/** Injected with `injectedJavaScriptBeforeContentLoaded` (main frame only). */
export const BRIDGE_SCRIPT = `(function () {
  if (window.__layerhopNativeBridge) return;
  window.__layerhopNativeBridge = true;
  var host = {
    postMessage: function (message) {
      try {
        if (!message || (message.source !== "layerhop" && message.source !== "layerhop-checkout")) return;
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      } catch (e) {}
    }
  };
  try {
    Object.defineProperty(window, "parent", { configurable: true, get: function () { return host; } });
  } catch (e) {
    try { window.parent = host; } catch (e2) {}
  }
})();
true;`;

/**
 * `scheme://host[:port]` of an http(s) URL (lowercase, default port dropped), or null. Plain string
 * parsing, so it works without a URL implementation.
 */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = /^(https?):\/\/([^/?#]*)/i.exec(url.trim());
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const authority = m[2]!.toLowerCase();
  if (!authority || authority.includes("@")) return null;
  const host = authority.replace(scheme === "https" ? /:443$/ : /:80$/, "");
  return `${scheme}://${host}`;
}

/** Parse the string a WebView `onMessage` delivers; null unless it is JSON. */
export function parseBridgeData(data: unknown): unknown {
  if (typeof data !== "string" || data.length > 1_000_000) return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

let urlSupport: boolean | undefined;

/** True when the runtime's `URL` follows the WHATWG standard (setters and `searchParams`). */
export function hasStandardUrl(): boolean {
  if (urlSupport !== undefined) return urlSupport;
  try {
    const u = new URL("https://a.example/x?b=1");
    u.pathname = "/y";
    u.searchParams.set("c", "2");
    urlSupport = u.toString() === "https://a.example/y?b=1&c=2";
  } catch {
    urlSupport = false;
  }
  return urlSupport;
}

/**
 * The embed URLs are built (and validated) by `@layerhop/widget`, which needs a standard `URL`.
 * Expo SDK 50+ ships one; older bare React Native apps add `react-native-url-polyfill`.
 */
export function assertStandardUrl(): void {
  if (hasStandardUrl()) return;
  throw new LayerHopWidgetError(
    '@layerhop/react-native needs a standard URL implementation. Expo SDK 50+ includes one; in a bare React Native app install react-native-url-polyfill and add `import "react-native-url-polyfill/auto";` at the top of your entry file.',
  );
}

/** Test hook: forget the cached URL check. */
export function resetUrlSupportCache(): void {
  urlSupport = undefined;
}
