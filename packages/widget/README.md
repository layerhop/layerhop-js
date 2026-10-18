# @layerhop/widget

[![npm](https://img.shields.io/npm/v/@layerhop/widget?color=c3f06b&labelColor=090d15)](https://www.npmjs.com/package/@layerhop/widget) [![license](https://img.shields.io/npm/l/@layerhop/widget?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/widget-reference)

Embed the LayerHop cross-chain swap card in any site. The widget is an `<iframe>` of
`https://layerhop.com/embed`, configured through URL params. It reports back to your page through
`postMessage` events. Both the params and the events follow the [widget reference](https://docs.layerhop.com/widget-reference).

Design it visually first at [layerhop.com/developers/widget](https://layerhop.com/developers/widget):
the builder previews the real widget and generates the code for each option below.

There are three ways to use it:

- the framework-agnostic `mount()`
- the React component `<LayerHopWidget />`
- a drop-in `<script>` tag

## Install

> The npm package is publishing soon. Until then, use it from the LayerHop monorepo (`packages/widget`) or embed the iframe directly: `https://layerhop.com/embed`.

```bash
npm install @layerhop/widget   # once published
# React is an optional peer dependency (>=18), needed only for @layerhop/widget/react
```

## React

```tsx
import { LayerHopWidget } from "@layerhop/widget/react";

export function Deposit() {
  return (
    <LayerHopWidget
      srcChain="arbitrum"
      srcToken="USDC"
      dstChain="base"
      dstToken="USDC"
      lockDst
      theme="dark"
      accent="#22d3ee"
      integrator="myapp"
      onQuote={(q) => console.log("quote", q.dstAmount)}
      onStatus={(s) => s.state === "filled" && console.log("done", s.srcTxHash)}
      className="my-widget"
    />
  );
}
```

- When a URL prop changes, the iframe reloads, but only if the resulting URL actually changes.
- Callback props can change freely without reloading the iframe.
- Changing `baseUrl`, `autoResize`, `height`, `maxWidth` or `title` remounts the iframe.

## Vanilla JS / any framework

```ts
import { mount } from "@layerhop/widget";

const widget = mount("#swap", {
  srcChain: "base",
  dstChain: "solana",
  dstToken: "SOL",
  amount: "100",
  onReady: ({ version }) => console.log("embed", version),
  onSubmitted: ({ srcTxHash }) => console.log("tx", srcTxHash),
  onError: ({ code, message }) => console.warn(code, message),
});

widget.update({ amount: "250", theme: "light" }); // merges options; reloads only if the URL changes
// With mount(..., { liveUpdates: true }) amount, token, theme and color changes apply in place.
widget.destroy(); // removes the iframe and the message listener
```

You can also build an embed URL yourself, for example to use in your own `<iframe>`:

```ts
import { buildEmbedUrl } from "@layerhop/widget";
buildEmbedUrl({ srcChain: "base", lockSrc: true }); // https://layerhop.com/embed?srcChain=base&lockSrc=1
```

## Script tag (no build step)

```html
<div data-layerhop-widget data-src-chain="base" data-dst-chain="solana" data-theme="dark"></div>
<!-- once @layerhop/widget is published to npm -->
<script src="https://unpkg.com/@layerhop/widget@0.2.0/dist/embed.js"></script>
<script>
  document.querySelector("[data-layerhop-widget]")
    .addEventListener("layerhop:quote", (e) => console.log(e.detail));

  // or programmatically:
  const w = window.LayerHop.mount("#other", { srcChain: "base", onQuote: console.log });
</script>
```

**How auto-init works**

- `embed.js` mounts every `[data-layerhop-widget]` element once the DOM is ready.
- Each option is a kebab-case data attribute: `data-src-chain`, `data-src-token`, `data-dst-chain`,
  `data-dst-token`, `data-amount`, `data-recipient`, `data-slippage-bps`, `data-theme`,
  `data-preset`, `data-accent`, `data-accent-text`, `data-bg`, `data-surface`, `data-surface-alt`,
  `data-text`, `data-text-muted`, `data-border-color`, `data-success`, `data-warning`,
  `data-danger`, `data-radius`, `data-radius-inner`, `data-font`, `data-font-scale`,
  `data-density`, `data-width`, `data-shadow`, `data-border`, `data-header-title`, `data-hide-header`,
  `data-logo`, `data-button-label`, `data-show-usd`, `data-from-chains`, `data-to-chains`,
  `data-exclude-chains`, `data-from-tokens`, `data-to-tokens`, `data-lock-src`, `data-lock-dst`,
  `data-lock-amount`, `data-lock-recipient`, `data-hide-routes`, `data-hide-settings`,
  `data-hide-history`, `data-hide-powered-by`, `data-locale`, `data-allow-parent-origin`,
  `data-integrator`, `data-base-url`, `data-height`, `data-max-width`, `data-auto-resize` and
  `data-live-updates`. Lists are comma-separated.
- Flags are on when the attribute is empty, `1`, `true` or `yes`, and off for `0`.
- Events are re-dispatched on the element as bubbling `layerhop:<type>` CustomEvents, with the
  payload in `event.detail`.
- For elements you add later, call `window.LayerHop.autoInit()`. It skips elements that are
  already mounted.
- `window.LayerHop` exposes `mount`, `buildEmbedUrl`, `autoInit`, `getWidget`,
  `LayerHopWidgetError`, `DEFAULT_BASE_URL`, `PRESETS` and `PRESET_IDS`.

## Options

Every option maps to one embed URL param of the same name, except `borderColor` (the `border`
param with a hex value) and `headerTitle` (the `title` param). See the [widget reference](https://docs.layerhop.com/widget-reference).

**Swap**

| Option | Type | Notes |
|---|---|---|
| `srcChain` / `dstChain` | `string \| number` | chain slug (`base`) or id |
| `srcToken` / `dstToken` | `string` | symbol, address or mint |
| `amount` | `string` | **human units**, e.g. `"100"` or `"0.5"` |
| `recipient` | `string` | prefilled, but editable unless `lockRecipient` |
| `slippageBps` | `number` | integer from 0 to 10000 |
| `integrator` | `string` | must match `[a-z0-9-]{1,32}`. Your partner id: registered partners earn their partner fee on every swap ([guide](https://docs.layerhop.com/guides/partner-fees)) |

**Theme**

| Option | Type | Notes |
|---|---|---|
| `theme` | `"dark" \| "light" \| "auto"` | default `dark` (or the preset's own default); `auto` follows the visitor's setting |
| `preset` | `"midnight" \| "paper" \| "lime" \| "ocean" \| "mono"` | a full dark + light palette; explicit colors override it |
| `accent` | `string` | hex; 3, 4, 6 or 8 digits accepted (the embed uses 3 or 6) |
| `accentText`, `bg`, `surface`, `surfaceAlt`, `text`, `textMuted`, `borderColor`, `success`, `warning`, `danger` | `string` | hex, 3 or 6 digits, `#` optional. Unreadable `accentText` is replaced automatically |
| `radius` | `number` | card corner radius in px (the embed caps it at 40) |
| `radiusInner` | `number` | fields and buttons, 0–32 px |
| `font` | `"inter" \| "system" \| "space-grotesk" \| "ibm-plex-sans" \| "dm-sans" \| "manrope"` | the last three load from Google Fonts only when chosen |
| `fontScale` | `number` | 0.875–1.125 |
| `density` | `"compact" \| "comfortable"` | |
| `width` | `number` | max card width, 320–720 px; also widens the iframe (`width + 16`) unless `maxWidth` is set |
| `shadow` | `"none" \| "soft" \| "strong"` | |
| `border` | `boolean` | `false` removes the card outline, `true` strengthens it. Can't be combined with `borderColor` |

**Content and behaviour**

| Option | Type | Notes |
|---|---|---|
| `headerTitle` | `string` | header text, up to 32 characters (URL param `title`; `title` stays the iframe title) |
| `logo` | `string` | `https` image URL shown next to the title |
| `buttonLabel` | `string` | main button label once ready, up to 24 characters |
| `hideHeader` | `boolean` | hides title, wallet button, history and settings |
| `showUsd` | `boolean` | default `true` |
| `fromChains` / `toChains` / `excludeChains` | `(string \| number)[]` | chain allow-lists / deny-list |
| `fromTokens` / `toTokens` | `string[]` | `"chain:addressOrSymbol"` entries, or bare symbols |
| `lockSrc` / `lockDst` | `boolean` | locks that side's chain and token |
| `lockAmount` | `boolean` | |
| `lockRecipient` | `boolean` | requires `recipient` |
| `hideRoutes` / `hideSettings` / `hideHistory` | `boolean` | |
| `hidePoweredBy` | `boolean` | requires `integrator`; the embed honours it once your id is confirmed as a registered partner |
| `locale` | `"en"` | |
| `allowParentOrigin` | `string` | origin allowed to send `setParams`; `liveUpdates` sets it for you |

**Mount only**

| Option | Type | Notes |
|---|---|---|
| `baseUrl` | `string` | default `https://layerhop.com`; `/embed` is appended. For local dev, use `http://localhost:3000` |
| `autoResize` | `boolean` | default `true`; follows `resize` events |
| `height` | `number` | initial height, default 640 px |
| `maxWidth` | `number \| string` | default 480 px (or `width + 16`); the width is always `100%` |
| `title` | `string` | the iframe title, default `"LayerHop swap"` |
| `liveUpdates` | `boolean` | `update()` sends amount, token, theme and color changes to the running widget instead of reloading it |

Invalid values throw a `LayerHopWidgetError` when you call `buildEmbedUrl`, `mount` or `update`.
This makes integration bugs show up early. The embed page itself silently ignores bad params.

The iframe always gets `color-scheme: normal`, which matches the embed page. A different value
(for example inherited from a page with `color-scheme: dark`) makes browsers paint an opaque box
behind the transparent widget.

### Presets

```ts
import { PRESETS, PRESET_IDS } from "@layerhop/widget"; // also exported as WIDGET_PRESETS
PRESETS.ocean.dark.accent; // "38bdf8"
```

Each preset has `label`, `description`, `defaultTheme` and full `dark` / `light` palettes (hex
without `#`), handy for matching the rest of your page to the widget.

## Recipes

**Deposit into your dApp.** Any token on any chain in, USDC on Base out, always to your contract:

```tsx
<LayerHopWidget
  dstChain="base"
  dstToken="USDC"
  lockDst
  recipient="0xYourDepositContract"
  lockRecipient
  headerTitle="Deposit to Acme"
  buttonLabel="Deposit"
  integrator="acme"
  onStatus={(s) => s.state === "filled" && refreshBalance()}
/>
```

**Single-chain swap.** Solana only, best route only:

```ts
mount("#swap", {
  fromChains: ["solana"],
  toChains: ["solana"],
  srcChain: "solana",
  srcToken: "USDC",
  dstChain: "solana",
  dstToken: "SOL",
  hideRoutes: true,
});
```

**Branded theme.** A preset as the base, your accent, font and logo, following light/dark:

```html
<div
  data-layerhop-widget
  data-preset="midnight"
  data-theme="auto"
  data-accent="ff5c8a"
  data-accent-text="ffffff"
  data-font="manrope"
  data-radius="20"
  data-radius-inner="12"
  data-logo="https://acme.xyz/logo.svg"
  data-header-title="Acme Swap"
></div>
```

**Drive it from your page.** With `liveUpdates`, `update()` changes the running widget in place:

```ts
const w = mount("#swap", { liveUpdates: true, dstChain: "base", dstToken: "USDC" });
priceInput.addEventListener("input", () => w.update({ amount: priceInput.value }));
```

## Events

The embed posts `{ source: "layerhop", type, payload }` to the parent window.

The widget accepts a message only if all of these are true:

- it comes from **its own** iframe's window
- its origin is the `baseUrl` origin
- it has `source === "layerhop"`

| Callback | `type` | Payload |
|---|---|---|
| `onReady` | `ready` | `{ version }` |
| `onQuote` | `quote` | `{ provider, srcChain, dstChain, amount, dstAmount }` |
| `onSubmitted` | `submitted` | `{ provider, srcChainId, srcTxHash }` |
| `onStatus` | `status` | `{ provider, srcTxHash, state }` where state is `pending`, `filled`, `refunded` or `failed` |
| `onError` | `error` | `{ code, message }` |
| `onResize` | `resize` | `{ height }` in px; the iframe is resized automatically unless `autoResize: false` |
| `onRoutes` | `routes` | `{ count, provider }`: routes that answered and the best one's provider |
| `onWalletConnected` | `walletConnected` | `{ vm, address }` with `vm` `"evm"` or `"svm"` |
| `onWalletDisconnected` | `walletDisconnected` | `{ vm, address }` |
| `onAmountChanged` | `amountChanged` | `{ amount, srcChain, srcToken }`, debounced, user edits only |
| `onEvent` | any | the full `{ source, type, payload }` message |

All payload types are exported: `ReadyEvent`, `QuoteEvent`, `SubmittedEvent`, `StatusEvent`,
`ErrorEvent`, `ResizeEvent`, `RoutesEvent`, `WalletEvent`, `AmountChangedEvent`, `WidgetEventMap`
and `WidgetMessage`. Payloads never contain secrets. The new events need embed protocol 1.1
(`ready.version` ≥ `1.1.0`).

## Development

```bash
pnpm --filter @layerhop/widget typecheck
pnpm --filter @layerhop/widget test
pnpm --filter @layerhop/widget build    # dist/: ESM + CJS + .d.ts, and dist/embed.js (IIFE)
```

To run the demo, start `apps/web` on `:3000` and build this package. Then serve `packages/widget`
(for example with `npx serve packages/widget`) and open `/example/`.

License: `UNLICENSED` until DECISIONS D-007 is resolved.
