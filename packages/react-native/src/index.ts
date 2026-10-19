export { LayerHopWidget, dispatchWidgetMessage, pickWidgetOptions, widgetUrl, type LayerHopWidgetProps } from "./widget";
export { LayerHopCheckout, dispatchCheckoutMessage, type LayerHopCheckoutProps } from "./checkout";
export type { ExternalLinkProps, PassThroughWebViewProps } from "./webview";
export { BRIDGE_SCRIPT, assertStandardUrl, hasStandardUrl, originOf, parseBridgeData } from "./bridge";
export {
  createReturnUrl,
  isWalletDeepLink,
  navigationDecision,
  openWalletLink,
  useWalletReturn,
  type NavigationDecision,
  type WalletReturnEvent,
  type WalletReturnOptions,
} from "./links";

// The platform-neutral parts of @layerhop/widget: options, events, URL builders and validation.
export {
  LayerHopCheckoutError,
  LayerHopWidgetError,
  buildCheckoutUrl,
  buildEmbedUrl,
  createProductSession,
  getProduct,
  isCheckoutProductId,
  isCheckoutSessionId,
  parseCheckoutMessage,
  parseWidgetMessage,
  WIDGET_EVENT_TYPES,
  WIDGET_OPTION_KEYS,
  WIDGET_PRESET_IDS,
  type CheckoutCallbacks,
  type CheckoutMessage,
  type CheckoutProduct,
  type CheckoutSession,
  type CheckoutStatus,
  type WidgetCallbacks,
  type WidgetEventMap,
  type WidgetEventType,
  type WidgetMessage,
  type WidgetOptions,
  type WidgetPreset,
  type WidgetTheme,
} from "@layerhop/widget";
