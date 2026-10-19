/**
 * Wallet deep links.
 *
 * Inside the WebView, "connect" and "sign" hand off to a wallet app through a custom scheme
 * (`wc:`, `metamask://`, `phantom://`, …) or a universal link (`https://metamask.app.link/…`).
 * WebViews can't follow those, so the components open them with `Linking` and keep the WebView on
 * the LayerHop page. When the user comes back from the wallet (by switching apps, or through your
 * app's own URL scheme), `useWalletReturn` tells you so you can refresh UI.
 */

import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";

export type NavigationDecision = "load" | "external" | "block";

/** Schemes a WebView renders itself. */
const WEB_SCHEMES = /^(?:https?|about|data|blob):/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * What to do with a navigation request from the LayerHop page:
 * - `load`: the LayerHop page itself, any sub-frame (wallet SDK iframes), `about:blank`, data/blob URLs.
 * - `external`: wallet deep links and universal links, explorers, any other top-level page or app
 *   link: open it with `Linking` instead of navigating away from the widget.
 * - `block`: `javascript:` URLs and anything that isn't a URL.
 */
export function navigationDecision(url: string, pageOrigin: string | null, isTopFrame: boolean | undefined = true): NavigationDecision {
  const u = url.trim();
  if (!SCHEME_RE.test(u) || /^javascript:/i.test(u)) return "block";
  if (!WEB_SCHEMES.test(u)) return "external";
  if (!/^https?:/i.test(u)) return "load";
  if (isTopFrame === false) return "load";
  const m = /^(https?):\/\/([^/?#]*)/i.exec(u);
  if (!m) return "block";
  const scheme = m[1]!.toLowerCase();
  const host = m[2]!.toLowerCase().replace(scheme === "https" ? /:443$/ : /:80$/, "");
  return pageOrigin && `${scheme}://${host}` === pageOrigin ? "load" : "external";
}

/** Wallet hand-offs so far; each `useWalletReturn` reports a foreground return once per hand-off. */
let handoffs = 0;

/**
 * Open a wallet deep link (or any external URL) with `Linking.openURL`. Resolves `false` when no app
 * can handle it (e.g. the wallet isn't installed). Marks the app as waiting for the user to come
 * back, which `useWalletReturn` reports.
 */
export async function openWalletLink(url: string): Promise<boolean> {
  if (navigationDecision(url, null) === "block") return false;
  handoffs++;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    handoffs--;
    return false;
  }
}

/** True when `url` is a wallet hand-off (custom scheme, not http/https). */
export function isWalletDeepLink(url: string): boolean {
  return navigationDecision(url, null) === "external" && !/^https?:/i.test(url.trim());
}

/**
 * Your app's return URL for wallets that support a redirect: `createReturnUrl("myapp", "swap")`
 * → `myapp://swap`. The scheme is the one registered for your app (`expo.scheme` in app.json, or the
 * iOS URL types / Android intent filter of a bare app).
 */
export function createReturnUrl(scheme: string, path = "", params: Record<string, string> = {}): string {
  const s = scheme.replace(/:\/*$/, "");
  if (!/^[a-z][a-z0-9+.-]*$/i.test(s) || /^(?:https?|javascript|data|file)$/i.test(s)) {
    throw new Error(`Invalid app scheme "${scheme}": expected something like "myapp"`);
  }
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${s.toLowerCase()}://${path.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
}

export interface WalletReturnEvent {
  /** `url`: your app was opened through `scheme`. `foreground`: the app became active after a wallet hand-off. */
  reason: "url" | "foreground";
  /** The URL that opened the app (reason `url`). */
  url?: string;
}

export interface WalletReturnOptions {
  /** Only report URLs with this scheme (e.g. `"myapp"`). Without it, only `foreground` returns are reported. */
  scheme?: string;
}

/**
 * Call `onReturn` when the user comes back from a wallet app: the app returns to the foreground
 * after `openWalletLink` (or one of the components) handed off to a wallet, or your app is opened
 * through `scheme` (a wallet redirect to `createReturnUrl(scheme, …)`).
 */
export function useWalletReturn(onReturn: (event: WalletReturnEvent) => void, options: WalletReturnOptions = {}): void {
  const handler = useRef(onReturn);
  handler.current = onReturn;
  const scheme = options.scheme?.replace(/:\/*$/, "").toLowerCase();

  useEffect(() => {
    const emit = (e: WalletReturnEvent) => handler.current(e);
    let seen = handoffs;
    const matches = (url: string | null | undefined): url is string => !!scheme && !!url && url.toLowerCase().startsWith(`${scheme}:`);
    const urlSub = Linking.addEventListener("url", ({ url }) => {
      if (!matches(url)) return;
      seen = handoffs;
      emit({ reason: "url", url });
    });
    const appSub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || handoffs <= seen) return;
      seen = handoffs;
      emit({ reason: "foreground" });
    });
    return () => {
      urlSub.remove();
      appSub.remove();
    };
  }, [scheme]);
}

