# @layerhop/react-native

[![npm](https://img.shields.io/npm/v/@layerhop/react-native?color=c3f06b&labelColor=090d15&cacheSeconds=3600)](https://www.npmjs.com/package/@layerhop/react-native) [![license](https://img.shields.io/npm/l/@layerhop/react-native?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/sdks/react-native)

LayerHop for **React Native and Expo**: the cross-chain swap widget and the checkout as native
components, with the same options and typed callbacks as
[`@layerhop/widget`](https://www.npmjs.com/package/@layerhop/widget), plus wallet deep-link helpers.

> **Never holds keys.** The components load the hosted LayerHop pages in a
> [`react-native-webview`](https://github.com/react-native-webview/react-native-webview). The user
> connects their own wallet app (WalletConnect / deep links) and signs there.

For your own swap UI in React Native, [`@layerhop/sdk`](https://www.npmjs.com/package/@layerhop/sdk) and
[`@layerhop/react`](https://www.npmjs.com/package/@layerhop/react) work as-is (see
[Using the SDK in React Native](#using-the-sdk-and-hooks-in-react-native)).

## Install

```bash
# Expo
npx expo install @layerhop/react-native react-native-webview

# bare React Native
npm install @layerhop/react-native react-native-webview && npx pod-install
```

Peers: `react >= 18`, `react-native >= 0.72`, `react-native-webview >= 13`.

The embed URLs are built and validated with the standard `URL` API. **Expo SDK 50+** ships one. In a
bare app on an older React Native, add [`react-native-url-polyfill`](https://www.npmjs.com/package/react-native-url-polyfill)
and `import "react-native-url-polyfill/auto";` at the top of your entry file (the components throw a
`LayerHopWidgetError` saying so when it's missing).

## Swap widget

```tsx
import { LayerHopWidget } from "@layerhop/react-native";

export function SwapScreen() {
  return (
    <LayerHopWidget
      srcChain="base"
      dstChain="solana"
      dstToken="SOL"
      theme="dark"
      preset="midnight"
      integrator="myapp"            // your partner id: earns your partner fee
      gasOnArrival
      onQuote={(q) => console.log("best route", q.provider, q.dstAmount)}
      onSubmitted={(e) => console.log("tx sent", e.srcTxHash)}
      onStatus={(e) => e.state === "filled" && console.log("delivered")}
      onError={(e) => console.warn(e.code, e.message)}
    />
  );
}
```

Every option of `@layerhop/widget` works (`srcChain`, `srcToken`, `amount`, `recipient`, `theme`,
`preset`, colors, `fromChains`/`toChains`, `lockAmount`, `hideRoutes`, `gasOnArrival`, `integrator`…,
see the [widget reference](https://docs.layerhop.com/widget-reference)), and so does every callback
(`onReady`, `onQuote`, `onRoutes`, `onSubmitted`, `onStatus`, `onError`, `onResize`,
`onWalletConnected`, `onWalletDisconnected`, `onAmountChanged`, `onEvent`). Invalid options throw a
`LayerHopWidgetError` during render.

React Native props:

| Prop | Default | |
|---|---|---|
| `baseUrl` | `https://layerhop.com` | Where `/embed` is served. |
| `autoResize` | `true` | Follow the page height. Set `false` and give `style` a size (e.g. `{ flex: 1 }`) for a full-screen widget. |
| `height` | `640` | Height before the first `resize` (or always, without `autoResize`). |
| `style` | | Style of the wrapping `View`. |
| `onExternalLink` | | Called before a wallet link or external page opens; return `false` to handle it yourself. |
| `webViewProps` | | Extra `react-native-webview` props (`onLoadEnd`, `pullToRefreshEnabled`, …). |

Changing a URL option reloads the page; callbacks can change freely.

## Checkout

Create the session on your server with your API key (`lh.checkout.create(...)` in `@layerhop/sdk`),
send its id to the app, and render:

```tsx
import { LayerHopCheckout } from "@layerhop/react-native";

<LayerHopCheckout
  sessionId={sessionId}
  onPaid={(session) => navigation.navigate("Thanks", { id: session.id })}
  onStatus={(status) => console.log(status)}  // open → processing → paid
  onError={(err) => Alert.alert("Payment unavailable", err.message)}
/>;
```

Fulfil orders on the `checkout.session.completed` **webhook**, not only on `onPaid`.

- `productId="prod_…"` (with optional `reference` and `metadata`) starts a session on mount through the
  public endpoint instead (no key; products restricted to allowed web origins answer `FORBIDDEN`).
- `mode="modal"`: the page adds a close button; render the component inside a React Native `<Modal>`
  and close it in `onClose` (also called after `onCancel`).
- `autoResize`, `height`, `style`, `renderLoading`, `onExternalLink` and `webViewProps` work as above.

## Wallet deep links

Inside the WebView, connecting or signing hands off to a wallet app through a custom scheme (`wc:`,
`metamask://`, `phantom://`…) or a universal link (`https://metamask.app.link/…`). The components open
those with `Linking` and keep the WebView on the LayerHop page; explorer links and any other page
outside LayerHop open in the system browser. Sub-frames (wallet SDK iframes) load normally.

```tsx
import { createReturnUrl, openWalletLink, useWalletReturn } from "@layerhop/react-native";

// Fires when the user comes back from the wallet app (app returns to the foreground after a
// hand-off), or when your app is opened through its scheme (a wallet redirect).
useWalletReturn((e) => console.log("back from wallet", e.reason, e.url), { scheme: "myapp" });

createReturnUrl("myapp", "swap", { order: "q_1" }); // "myapp://swap?order=q_1"
await openWalletLink("metamask://wc?uri=…");        // false when no app handles it
```

The scheme is your app's (`expo.scheme` in `app.json`, or the URL types / intent filters of a bare
app). iOS: to call `Linking.canOpenURL` for wallet schemes yourself, list them under
`LSApplicationQueriesSchemes`; the components don't need it.

## Expo example

The core of a minimal Expo app (the LayerHop monorepo keeps a runnable copy in `examples/expo-swap`):

```tsx
// App.tsx
import { SafeAreaView, StatusBar } from "react-native";
import { LayerHopWidget, useWalletReturn } from "@layerhop/react-native";

export default function App() {
  useWalletReturn(() => console.log("welcome back"), { scheme: "layerhop-expo-swap" });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#090d15" }}>
      <StatusBar barStyle="light-content" />
      <LayerHopWidget
        srcChain="base" srcToken="USDC" dstChain="solana" dstToken="SOL"
        theme="dark" autoResize={false} style={{ flex: 1 }}
        onSubmitted={(e) => console.log("submitted", e.srcTxHash)}
      />
    </SafeAreaView>
  );
}
```

```bash
npx create-expo-app my-swap && cd my-swap
npx expo install @layerhop/react-native react-native-webview
npx expo start
```

## Using the SDK and hooks in React Native

`@layerhop/sdk` (and `@layerhop/react` on top of it) use only `fetch`, `URLSearchParams` and
`AbortController`, which React Native provides. Live order streams (`streamOrder`, `checkout.stream`,
`useOrderStream`) use Server-Sent Events: React Native's `fetch` can't stream a response body, so in
React Native the SDK (0.6+) reads the stream with `XMLHttpRequest` progress events instead
(automatically; force it with `new LayerHop({ streaming: "xhr" })`). With Expo's streaming fetch,
pass `new LayerHop({ fetch })` from `expo/fetch` to use it. Webhook verification needs Web Crypto and
belongs on your server, not in the app.

## How it works

The hosted pages post `{ source: "layerhop", type, payload }` (widget) and
`{ source: "layerhop-checkout", … }` (checkout) to `window.parent`. Before the page loads, the
component injects a small script that gives the page a `window.parent` forwarding exactly those
envelopes to React Native (`window.ReactNativeWebView.postMessage`). Messages are accepted only from
the page's own origin and are validated with the same parsers as `@layerhop/widget`. Live
`setParams` updates (web `liveUpdates`) aren't used: changing an option reloads the page.

## License

[MIT](LICENSE)
