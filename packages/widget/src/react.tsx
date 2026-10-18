import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { mountCheckout, openCheckout, type CheckoutHandle, type CheckoutOptions, type MountCheckoutOptions } from "./checkout";
import { WIDGET_OPTION_KEYS, buildEmbedUrl, mount, type MountOptions, type WidgetHandle, type WidgetOptions } from "./core";

export type * from "./core";
export type * from "./checkout";

export interface LayerHopWidgetProps extends MountOptions {
  /** Class name for the wrapping <div>. */
  className?: string;
  /** Inline style for the wrapping <div>. */
  style?: CSSProperties;
}

/**
 * React wrapper around `mount()`. URL options trigger an iframe reload only when the resulting
 * URL changes (with `liveUpdates`, amount/token/theme/color changes apply in place); callbacks can
 * change freely without reloading. Changing `baseUrl`, `autoResize`, `height`, `maxWidth`, `title`
 * or `liveUpdates` remounts the iframe.
 */
export function LayerHopWidget(props: LayerHopWidgetProps) {
  const {
    className,
    style,
    baseUrl,
    autoResize,
    height,
    maxWidth,
    title,
    liveUpdates,
    onReady: _onReady,
    onQuote: _onQuote,
    onSubmitted: _onSubmitted,
    onStatus: _onStatus,
    onError: _onError,
    onResize: _onResize,
    onRoutes: _onRoutes,
    onWalletConnected: _onWalletConnected,
    onWalletDisconnected: _onWalletDisconnected,
    onAmountChanged: _onAmountChanged,
    onEvent: _onEvent,
    ...urlOptions
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<WidgetHandle | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const urlOptionsRef = useRef<WidgetOptions>(urlOptions);
  urlOptionsRef.current = urlOptions;

  // Stable key for URL options; also validates them during render (throws on invalid props).
  const src = buildEmbedUrl(urlOptions, baseUrl);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handle = mount(el, {
      ...urlOptionsRef.current,
      baseUrl,
      autoResize,
      height,
      maxWidth,
      title,
      liveUpdates,
      onReady: (p) => propsRef.current.onReady?.(p),
      onQuote: (p) => propsRef.current.onQuote?.(p),
      onSubmitted: (p) => propsRef.current.onSubmitted?.(p),
      onStatus: (p) => propsRef.current.onStatus?.(p),
      onError: (p) => propsRef.current.onError?.(p),
      onResize: (p) => propsRef.current.onResize?.(p),
      onRoutes: (p) => propsRef.current.onRoutes?.(p),
      onWalletConnected: (p) => propsRef.current.onWalletConnected?.(p),
      onWalletDisconnected: (p) => propsRef.current.onWalletDisconnected?.(p),
      onAmountChanged: (p) => propsRef.current.onAmountChanged?.(p),
      onEvent: (m) => propsRef.current.onEvent?.(m),
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [baseUrl, autoResize, height, maxWidth, title, liveUpdates]);

  useEffect(() => {
    // Replace (not merge) URL options so removed props are cleared too.
    const cleared = Object.fromEntries(WIDGET_OPTION_KEYS.map((k) => [k, undefined])) as WidgetOptions;
    handleRef.current?.update({ ...cleared, ...urlOptionsRef.current });
  }, [src]);

  return <div ref={containerRef} className={className} style={style} data-layerhop-widget-root="" />;
}


// ---------------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------------

export interface LayerHopCheckoutProps extends MountCheckoutOptions {
  /** Class name for the wrapping <div>. */
  className?: string;
  /** Inline style for the wrapping <div>. */
  style?: CSSProperties;
}

/**
 * The checkout inline (an auto-resizing iframe). Pass `sessionId` (created on your server) or
 * `productId` (a session is started in the browser on mount). Callbacks can change freely; changing
 * the session, product, reference, metadata, URLs or sizing props starts over with a new iframe.
 * Note: with `productId`, every mount starts a new session (React StrictMode mounts twice in dev).
 */
export function LayerHopCheckout(props: LayerHopCheckoutProps) {
  const { className, style, sessionId, productId, reference, metadata, baseUrl, apiUrl, title, autoResize, height, maxWidth } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const metadataKey = metadata ? JSON.stringify(metadata) : "";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handle = mountCheckout(el, {
      sessionId,
      productId,
      reference,
      metadata: metadataKey ? (JSON.parse(metadataKey) as Record<string, string>) : undefined,
      baseUrl,
      apiUrl,
      title,
      autoResize,
      height,
      maxWidth,
      onReady: () => propsRef.current.onReady?.(),
      onPaid: (s) => propsRef.current.onPaid?.(s),
      onCancel: () => propsRef.current.onCancel?.(),
      onClose: () => propsRef.current.onClose?.(),
      onStatus: (s) => propsRef.current.onStatus?.(s),
      onError: (e) => (propsRef.current.onError ? propsRef.current.onError(e) : console.error("[LayerHop] checkout:", e)),
    });
    return () => handle.close();
  }, [sessionId, productId, reference, metadataKey, baseUrl, apiUrl, title, autoResize, height, maxWidth]);

  return <div ref={containerRef} className={className} style={style} data-layerhop-checkout-root="" />;
}

/**
 * Open the checkout modal from your own button: `const checkout = useLayerHopCheckout({ onPaid });
 * checkout.open({ productId: "prod_…" })`. Options passed to `open` override the hook's defaults.
 * The modal closes when the component unmounts.
 */
export function useLayerHopCheckout(defaults: CheckoutOptions = {}): {
  open: (opts?: CheckoutOptions) => CheckoutHandle;
  close: () => void;
} {
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const handleRef = useRef<CheckoutHandle | null>(null);

  const close = useCallback(() => {
    handleRef.current?.close();
    handleRef.current = null;
  }, []);

  const open = useCallback((opts: CheckoutOptions = {}) => {
    const merged: CheckoutOptions = { ...defaultsRef.current, ...opts };
    // Only one of sessionId / productId: the one given to open() wins over the hook's default.
    if (opts.sessionId) delete merged.productId;
    if (opts.productId) delete merged.sessionId;
    const handle = openCheckout({
      ...merged,
      onClose: () => {
        if (handleRef.current === handle) handleRef.current = null;
        merged.onClose?.();
      },
    });
    handleRef.current = handle;
    return handle;
  }, []);

  useEffect(() => close, [close]);
  return { open, close };
}
