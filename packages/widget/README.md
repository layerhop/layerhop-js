# @layerhop/widget

Embed the LayerHop cross-chain swap card in any site. The widget is an `<iframe>` of
`https://layerhop.com/embed`, configured through URL params. It reports back to your page through
`postMessage` events. Both the params and the events follow [`docs/URL_CONTRACT.md`](../../docs/URL_CONTRACT.md).

There are three ways to use it:

- the framework-agnostic `mount()`
- the React component `<LayerHopWidget />`
- a drop-in `<script>` tag

## Install

```bash
npm install @layerhop/widget
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
<script src="https://unpkg.com/@layerhop/widget@0.1.0/dist/embed.js"></script>
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
  `data-accent`, `data-radius`, `data-lock-src`, `data-lock-dst`, `data-hide-history`,
  `data-integrator`, `data-base-url`, `data-height`, `data-max-width` and `data-auto-resize`.
- Flags are on when the attribute is empty, `1`, `true` or `yes`.
- Events are re-dispatched on the element as bubbling `layerhop:<type>` CustomEvents, with the
  payload in `event.detail`.
- For elements you add later, call `window.LayerHop.autoInit()`. It skips elements that are
  already mounted.
- `window.LayerHop` exposes `mount`, `buildEmbedUrl`, `autoInit`, `getWidget`,
  `LayerHopWidgetError` and `DEFAULT_BASE_URL`.

## Options

| Option | Type | URL param | Notes |
|---|---|---|---|
| `srcChain` / `dstChain` | `string \| number` | same | chain slug (`base`) or id |
| `srcToken` / `dstToken` | `string` | same | symbol, address or mint |
| `amount` | `string` | `amount` | **human units**, e.g. `"100"` or `"0.5"` |
| `recipient` | `string` | `recipient` | prefilled, but the user can edit it |
| `slippageBps` | `number` | `slippageBps` | integer from 0 to 10000 |
| `theme` | `"dark" \| "light"` | `theme` | default is `dark`; also sets the iframe's `color-scheme` |
| `accent` | `string` | `accent` | hex color; `#` is stripped, and it is validated as 3, 4, 6 or 8 hex digits |
| `radius` | `number` | `radius` | card corner radius in px |
| `lockSrc` / `lockDst` | `boolean` | `=1` | locks chain and token |
| `hideHistory` | `boolean` | `=1` | |
| `integrator` | `string` | `integrator` | must match `[a-z0-9-]{1,32}`. Your partner id: registered partners earn their partner fee on every swap ([guide](https://docs.layerhop.com/guides/partner-fees)) |
| `baseUrl` | `string` | — | default `https://layerhop.com`; `/embed` is appended. For local dev, use `http://localhost:3000` |
| `autoResize` | `boolean` | — | default `true`; follows `resize` events |
| `height` | `number` | — | initial height, default 640 px |
| `maxWidth` | `number \| string` | — | default 480 px; the width is always `100%` |
| `title` | `string` | — | the iframe title, default `"LayerHop swap"` |

Invalid values throw a `LayerHopWidgetError` when you call `buildEmbedUrl`, `mount` or `update`.
This makes integration bugs show up early. The embed page itself silently ignores bad params.

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
| `onEvent` | any | the full `{ source, type, payload }` message |

All payload types are exported: `ReadyEvent`, `QuoteEvent`, `SubmittedEvent`, `StatusEvent`,
`ErrorEvent`, `ResizeEvent`, `WidgetEventMap` and `WidgetMessage`. Payloads never contain secrets.

## Development

```bash
pnpm --filter @layerhop/widget typecheck
pnpm --filter @layerhop/widget test
pnpm --filter @layerhop/widget build    # dist/: ESM + CJS + .d.ts, and dist/embed.js (IIFE)
```

To run the demo, start `apps/web` on `:3000` and build this package. Then serve `packages/widget`
(for example with `npx serve packages/widget`) and open `/example/`.

License: `UNLICENSED` until DECISIONS D-007 is resolved.
