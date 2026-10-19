import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from "react-native";
import {
  CHECKOUT_DEFAULT_HEIGHT,
  LayerHopCheckoutError,
  buildCheckoutUrl,
  checkoutOrigin,
  createProductSession,
  isCheckoutSessionId,
  parseCheckoutMessage,
  type CheckoutCallbacks,
  type CheckoutMessage,
} from "@layerhop/widget";
import { assertStandardUrl } from "./bridge";
import { LayerHopWebView, type ExternalLinkProps, type PassThroughWebViewProps } from "./webview";

export interface LayerHopCheckoutProps extends CheckoutCallbacks, ExternalLinkProps {
  /** An existing session (`cs_…`), created on your server with your API key. Recommended. */
  sessionId?: string;
  /** A product (`prod_…`): a new session is started for it on mount (public endpoint, no key). */
  productId?: string;
  /** With `productId`: your order id, echoed on the session and its webhooks. */
  reference?: string;
  /** With `productId`: up to 10 string values, echoed on the session and its webhooks. */
  metadata?: Record<string, string>;
  /** Where the checkout page lives. Default https://layerhop.com. */
  baseUrl?: string;
  /** The public API. Default https://api.layerhop.com. */
  apiUrl?: string;
  /**
   * `inline` (default): the page in your screen. `modal`: the page adds its own close button and
   * `onClose` fires when the payer closes it; render the component inside a React Native `<Modal>`.
   */
  mode?: "inline" | "modal";
  /** Follow the page's content height (default `true`). Set `false` and give `style` a size (e.g. `{ flex: 1 }`) to fill a screen. */
  autoResize?: boolean;
  /** Height before the first `resize` (or always, without `autoResize`). Default 600. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Shown while a product session is being created. Default: an ActivityIndicator. */
  renderLoading?: () => ReactNode;
  webViewProps?: PassThroughWebViewProps;
  /** Custom fetch for `productId` sessions (tests). */
  fetch?: typeof fetch;
  testID?: string;
}

/** Call the callback for a checkout message (same mapping as `openCheckout()` on the web). */
export function dispatchCheckoutMessage(message: CheckoutMessage, callbacks: CheckoutCallbacks, mode: "inline" | "modal" = "inline"): void {
  switch (message.type) {
    case "ready":
      return callbacks.onReady?.();
    case "status":
      return callbacks.onStatus?.(message.status);
    case "paid":
      return callbacks.onPaid?.(message.session);
    case "cancel":
      callbacks.onCancel?.();
      if (mode === "modal") callbacks.onClose?.();
      return;
    case "close":
      if (mode === "modal") callbacks.onClose?.();
      return;
    case "resize":
      return;
  }
}

function toCheckoutError(e: unknown): LayerHopCheckoutError {
  return e instanceof LayerHopCheckoutError ? e : new LayerHopCheckoutError((e as Error)?.message ?? String(e), "UNKNOWN");
}

/**
 * The hosted LayerHop checkout in a WebView, with the callbacks of `@layerhop/widget`'s checkout:
 * `onPaid` when the payment is verified on chain (fulfil on the `checkout.session.completed` webhook,
 * not only here), `onStatus`, `onCancel`, `onClose` (modal mode), `onError`. Changing the session,
 * product, reference, metadata or URLs starts over. With `productId`, every mount starts a new session.
 */
export function LayerHopCheckout(props: LayerHopCheckoutProps) {
  const { sessionId, productId, reference, metadata, baseUrl, apiUrl, mode = "inline", autoResize = true, height = CHECKOUT_DEFAULT_HEIGHT, style, renderLoading, webViewProps, onExternalLink, testID } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const metadataKey = metadata ? JSON.stringify(metadata) : "";
  const [resolved, setResolved] = useState<{ key: string; id: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const key = JSON.stringify([sessionId, productId, reference, metadataKey, apiUrl, baseUrl]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setContentHeight(null);
    const fail = (e: unknown) => {
      if (cancelled) return;
      setFailed(true);
      const err = toCheckoutError(e);
      const onError = propsRef.current.onError;
      if (onError) onError(err);
      else console.error("[LayerHop] checkout:", err);
    };
    try {
      assertStandardUrl();
      if (!!sessionId === !!productId) throw new LayerHopCheckoutError("Pass exactly one of sessionId or productId");
      checkoutOrigin(baseUrl);
      if (sessionId) {
        if (!isCheckoutSessionId(sessionId)) throw new LayerHopCheckoutError(`Invalid sessionId "${sessionId}": expected cs_…`);
        setResolved({ key, id: sessionId });
      } else {
        createProductSession(productId!, {
          reference,
          metadata: metadataKey ? (JSON.parse(metadataKey) as Record<string, string>) : undefined,
          apiUrl,
          fetch: propsRef.current.fetch,
        }).then((s) => {
          if (!cancelled) setResolved({ key, id: s.id });
        }, fail);
      }
    } catch (e) {
      fail(e);
    }
    return () => {
      cancelled = true;
    };
  }, [key]); // every input is in `key`

  const id = resolved?.key === key ? resolved.id : null;

  const onData = useCallback(
    (data: unknown) => {
      const message = parseCheckoutMessage(data);
      if (!message || message.sessionId !== id) return;
      if (message.type === "resize" && autoResize) setContentHeight(Math.ceil(message.height));
      dispatchCheckoutMessage(message, propsRef.current, mode);
    },
    [id, autoResize, mode],
  );

  const boxHeight = autoResize ? (contentHeight ?? height) : height;
  if (failed) return null;
  if (!id) {
    return (
      <View style={[{ width: "100%", height: boxHeight, alignItems: "center", justifyContent: "center" }, style]} accessibilityLabel="Loading checkout">
        {renderLoading ? renderLoading() : <ActivityIndicator />}
      </View>
    );
  }
  return (
    <View style={[{ width: "100%", height: boxHeight }, style]}>
      <LayerHopWebView
        testID={testID ?? "layerhop-checkout"}
        uri={buildCheckoutUrl(id, { baseUrl, mode })}
        origin={checkoutOrigin(baseUrl)}
        onData={onData}
        onExternalLink={onExternalLink}
        webViewProps={webViewProps}
      />
    </View>
  );
}
