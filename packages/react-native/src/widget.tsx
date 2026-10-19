import { useCallback, useEffect, useRef, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  DEFAULT_BASE_URL,
  DEFAULT_HEIGHT,
  WIDGET_OPTION_KEYS,
  buildEmbedUrl,
  parseWidgetMessage,
  type WidgetCallbacks,
  type WidgetMessage,
  type WidgetOptions,
} from "@layerhop/widget";
import { assertStandardUrl, originOf } from "./bridge";
import { LayerHopWebView, type ExternalLinkProps, type PassThroughWebViewProps } from "./webview";

export interface LayerHopWidgetProps extends WidgetOptions, WidgetCallbacks, ExternalLinkProps {
  /** Origin (optionally with a path prefix) serving `/embed`. Default `https://layerhop.com`. */
  baseUrl?: string;
  /** Follow the widget's content height (`resize` events). Default `true`; set `false` to size it yourself with `style`. */
  autoResize?: boolean;
  /** Height before the first `resize` event (or always, without `autoResize`). Default 640. */
  height?: number;
  /** Style of the wrapping View (e.g. `{ flex: 1 }` with `autoResize={false}`). */
  style?: StyleProp<ViewStyle>;
  /** Extra react-native-webview props (e.g. `onLoadEnd`, `pullToRefreshEnabled`). */
  webViewProps?: PassThroughWebViewProps;
  testID?: string;
}

/** Call the typed callback for a widget message, then `onEvent` (same order as `mount()` on the web). */
export function dispatchWidgetMessage(message: WidgetMessage, callbacks: WidgetCallbacks): void {
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
      callbacks.onResize?.(message.payload);
      break;
    case "routes":
      callbacks.onRoutes?.(message.payload);
      break;
    case "walletConnected":
      callbacks.onWalletConnected?.(message.payload);
      break;
    case "walletDisconnected":
      callbacks.onWalletDisconnected?.(message.payload);
      break;
    case "amountChanged":
      callbacks.onAmountChanged?.(message.payload);
      break;
  }
  callbacks.onEvent?.(message);
}

/** The URL options among the props (everything that maps to an embed URL param). */
export function pickWidgetOptions(props: Partial<LayerHopWidgetProps>): WidgetOptions {
  const out: Record<string, unknown> = {};
  for (const k of WIDGET_OPTION_KEYS) if (props[k] !== undefined) out[k] = props[k];
  return out as WidgetOptions;
}

/** The embed URL a `<LayerHopWidget>` with these props loads. Throws `LayerHopWidgetError` on invalid options. */
export function widgetUrl(props: Partial<LayerHopWidgetProps>): string {
  assertStandardUrl();
  return buildEmbedUrl(pickWidgetOptions(props), props.baseUrl ?? DEFAULT_BASE_URL);
}

/**
 * The LayerHop swap widget in a WebView, with the options and typed callbacks of
 * `@layerhop/widget`. Invalid options throw during render (`LayerHopWidgetError`), like the web
 * component. Changing a URL option reloads the page; callbacks can change freely. Wallet deep links
 * open the wallet app (`onExternalLink` to intercept). The SDK never holds keys: the user's wallet signs.
 */
export function LayerHopWidget(props: LayerHopWidgetProps) {
  const { autoResize = true, height = DEFAULT_HEIGHT, style, webViewProps, onExternalLink, testID } = props;
  const uri = widgetUrl(props);
  const origin = originOf(uri);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => setContentHeight(null), [uri]);

  const onData = useCallback(
    (data: unknown) => {
      const message = parseWidgetMessage(data);
      if (!message) return;
      if (message.type === "resize" && autoResize) setContentHeight(Math.ceil(message.payload.height));
      dispatchWidgetMessage(message, propsRef.current);
    },
    [autoResize],
  );

  return (
    <View style={[{ width: "100%", height: autoResize ? (contentHeight ?? height) : height }, style]}>
      <LayerHopWebView
        testID={testID ?? "layerhop-widget"}
        uri={uri}
        origin={origin}
        onData={onData}
        onExternalLink={onExternalLink}
        webViewProps={webViewProps}
      />
    </View>
  );
}
