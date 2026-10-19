import { useCallback, useRef } from "react";
import { WebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { BRIDGE_SCRIPT, originOf, parseBridgeData } from "./bridge";
import { navigationDecision, openWalletLink } from "./links";

/** WebView props you may pass through; the bridge, source and navigation handling are ours. */
export type PassThroughWebViewProps = Omit<
  WebViewProps,
  | "source"
  | "onMessage"
  | "originWhitelist"
  | "injectedJavaScript"
  | "injectedJavaScriptBeforeContentLoaded"
  | "injectedJavaScriptBeforeContentLoadedForMainFrameOnly"
  | "onShouldStartLoadWithRequest"
  | "onOpenWindow"
>;

export interface ExternalLinkProps {
  /**
   * Called before a wallet deep link, universal link or other external page is opened with
   * `Linking`. Return `false` to handle it yourself (nothing is opened).
   */
  onExternalLink?: (url: string) => boolean | void;
}

interface Props extends ExternalLinkProps {
  uri: string;
  /** Messages are accepted only from pages on this origin. */
  origin: string | null;
  /** Parsed JSON of each bridged message from `origin`. */
  onData: (data: unknown) => void;
  webViewProps?: PassThroughWebViewProps;
  testID?: string;
}

/** The WebView both components render: bridge injected, origin-checked messages, external links out. */
export function LayerHopWebView({ uri, origin, onData, onExternalLink, webViewProps, testID }: Props) {
  const externalRef = useRef(onExternalLink);
  externalRef.current = onExternalLink;

  const openExternal = useCallback((url: string) => {
    if (externalRef.current?.(url) === false) return;
    void openWalletLink(url);
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (!origin || originOf(event.nativeEvent.url) !== origin) return;
      const data = parseBridgeData(event.nativeEvent.data);
      if (data !== null) onData(data);
    },
    [origin, onData],
  );

  return (
    <WebView
      testID={testID}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      setSupportMultipleWindows
      {...webViewProps}
      style={[{ flex: 1, backgroundColor: "transparent" }, webViewProps?.style]}
      source={{ uri }}
      // Every navigation goes through onShouldStartLoadWithRequest (no automatic Linking).
      originWhitelist={["*"]}
      injectedJavaScriptBeforeContentLoaded={BRIDGE_SCRIPT}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      // Again after load, for WebViews that run the early script late; the script is idempotent.
      injectedJavaScript={BRIDGE_SCRIPT}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => {
        const decision = navigationDecision(req.url, origin, req.isTopFrame);
        if (decision === "external") openExternal(req.url);
        return decision === "load";
      }}
      onOpenWindow={(e) => {
        const url = e.nativeEvent.targetUrl;
        if (navigationDecision(url, null) !== "block") openExternal(url);
      }}
    />
  );
}
