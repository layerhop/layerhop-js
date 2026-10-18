# @layerhop/sdk

[![npm](https://img.shields.io/npm/v/@layerhop/sdk?color=c3f06b&labelColor=090d15&cacheSeconds=3600)](https://www.npmjs.com/package/@layerhop/sdk) [![license](https://img.shields.io/npm/l/@layerhop/sdk?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/sdk)

Typed TypeScript client for the [LayerHop API](https://docs.layerhop.com): best-price cross-chain and
same-chain swaps across EVM chains and Solana through one non-custodial API.

- **Zero runtime dependencies.** Uses the global `fetch`; works in Node 18+, browsers, Deno, Bun and edge runtimes.
- **ESM + CommonJS** builds with bundled type definitions.
- **Never holds keys.** It fetches quotes and builds *unsigned* transactions; your wallet signs.

## Install

```bash
npm install @layerhop/sdk
# or: pnpm add @layerhop/sdk / yarn add @layerhop/sdk / bun add @layerhop/sdk
```

## Quickstart

Amounts are always **integer strings in base units** (100 USDC = `"100000000"`), never floats.

```ts
import { LayerHop, LayerHopApiError } from "@layerhop/sdk";

const lh = new LayerHop({ apiKey: process.env.LAYERHOP_API_KEY, integrator: "myapp" });

// 1. Quote every provider; `best` is the highest output for the user.
const { best } = await lh.quote({
  srcChain: "base", srcToken: "USDC", amount: "100000000",
  dstChain: "solana", dstToken: "SOL",
  sender: "0xYourEvmAddress", recipient: "YourSolanaAddress",
});

// 2. Build the unsigned transaction (EVM txs may include an `approval` to send first).
const tx = await lh.buildTx(best.quoteId);

// 3. Sign and send with your own wallet stack (viem, ethers, wallet adapter...), then report it.
//    const hash = await wallet.sendTransaction(tx);
//    await lh.reportSubmitted(best.quoteId, hash);

// 4. Track until filled / refunded / failed.
//    for await (const s of lh.watch(best.provider, hash)) console.log(s.state);
```

Errors are thrown as `LayerHopApiError` with a stable `code` (see the
[error catalog](https://docs.layerhop.com/errors)):

```ts
try {
  await lh.buildTx(quoteId);
} catch (e) {
  if (e instanceof LayerHopApiError && e.code === "QUOTE_EXPIRED") {
    // re-quote
  }
}
```

## API

| Method | Endpoint | What |
|---|---|---|
| `quote(params)` | `GET /v1/quote` | Every successful quote, best for the user first. |
| `buildTx(quoteId)` | `POST /v1/orders` | The unsigned transaction for a quote (`EvmTx` or `SvmTx`). |
| `submit(quoteId, signedTx)` | `POST /v1/orders/submit` | Solana txs with `submitViaApi`: send the signed tx through LayerHop. |
| `reportSubmitted(quoteId, txHash)` | `POST /v1/orders/{quoteId}/submitted` | Tell LayerHop the tx was broadcast. |
| `simulate(quoteId)` | `POST /v1/simulate` | Dry-run the tx (EVM `eth_call` + gas, Solana `simulateTransaction`). |
| `listOrders(params)` | `GET /v1/orders` | Orders from or to an address, newest first. |
| `status(provider, id)` | `GET /v1/orders/{provider}/{id}` | Order status. |
| `watch(provider, id, opts?)` | polls `status` | Async generator yielding each state change until final. |
| `serviceStatus()` | `GET /v1/status` | Platform status (status.layerhop.com): components, 90-day uptime, incidents. |
| `checkout.create / get / list / expire / quote / stream` | `/v1/checkout/sessions` | Checkout sessions ("pay with any token"). |
| `checkout.products.*` | `/v1/checkout/products` | Fixed-price products for payment buttons and `/buy/{id}` links. |
| `checkout.refunds.create(sessionId, params?)` / `.list(sessionId)` | `/v1/checkout/sessions/{id}/refunds` | Refund a paid session from your own wallet (build, sign, report). |
| `invoices.create / get / list / update / send / void` | `/v1/invoices` | Invoices emailed to a customer and paid through checkout (API key). |
| `invoices.publicView(id)` / `invoices.pay(id)` | `/v1/invoices/{id}/public`, `/pay` | The customer's side (public). |

### Invoices and refunds

```ts
const lh = new LayerHop({ apiKey: process.env.LAYERHOP_API_KEY });

// Bill a customer: emailed from billing@layerhop.com, paid at layerhop.com/invoice/{id}.
const invoice = await lh.invoices.create({
  customerEmail: "ap@client.example",
  lineItems: [{ description: "Design work", quantity: 2, unitAmount: "500000000" }], // 2 × 500 USDC
  settleChain: "base", settleToken: "USDC", recipient: "0xYourPayoutAddress",
  send: true,
});

// Refund a paid session from your wallet (non-custodial): build, sign, report.
const { refund, quote } = await lh.checkout.refunds.create("cs_...", { amount: "10000000", reason: "Partial refund" });
const tx = await lh.buildTx(quote.quoteId);            // sign and broadcast from quote.from
await lh.reportSubmitted(quote.quoteId, "0xTxHash");   // the refund completes when the order fills
```

Options for `new LayerHop(options)`: `baseUrl` (default `https://api.layerhop.com`), `apiKey`,
`channel`, `integrator`, `integratorFeeBps`, `fetch`.

The package also exports the chain and token registry (`CHAINS`, `getChain`, `TOKENS`, `findToken`,
`SOLANA_CHAIN_ID`, `EVM_NATIVE`, `SOL_NATIVE`) and all request/response types.

Full reference: <https://docs.layerhop.com/sdk>.

## Related packages

- [`@layerhop/react`](https://www.npmjs.com/package/@layerhop/react) — React hooks (`useQuote`, `useSwap`, ...).
- [`@layerhop/widget`](https://www.npmjs.com/package/@layerhop/widget) — embeddable swap widget.
- [`@layerhop/cli`](https://www.npmjs.com/package/@layerhop/cli) — command line.
- [`@layerhop/mcp`](https://www.npmjs.com/package/@layerhop/mcp) — MCP server for AI agents.

## License

MIT
