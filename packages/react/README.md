# @layerhop/react

[![npm](https://img.shields.io/npm/v/@layerhop/react?color=c3f06b&labelColor=090d15&cacheSeconds=3600)](https://www.npmjs.com/package/@layerhop/react) [![license](https://img.shields.io/npm/l/@layerhop/react?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/sdks/react)

React hooks for LayerHop cross-chain and same-chain swaps, built on
[`@layerhop/sdk`](https://www.npmjs.com/package/@layerhop/sdk) and [TanStack Query](https://tanstack.com/query) v5.

> **Never holds keys.** The hooks fetch quotes and build *unsigned* transactions. Signing is done by
> a `sign(tx)` callback you provide (wagmi/viem, ethers, Solana wallet adapter…), so the package
> works with any wallet stack.

## Install

```bash
npm install @layerhop/react @layerhop/sdk @tanstack/react-query
# peers: react >= 18, @tanstack/react-query >= 5
```

## Setup

```tsx
import { LayerHopProvider } from "@layerhop/react";

export function App() {
  return (
    <LayerHopProvider options={{ integrator: "myapp" }}>
      <Swap />
    </LayerHopProvider>
  );
}
```

`LayerHopProvider` takes either `client` (a `new LayerHop({...})` instance) or `options` (passed to
`new LayerHop`). It reuses a `<QueryClientProvider>` above it, accepts one via `queryClient`, or
creates its own.

## Quickstart: quote → build → sign → report → track

Amounts are **integer strings in base units** (100 USDC = `"100000000"`), never floats.

```tsx
import { useQuote, useSwap } from "@layerhop/react";
import { useAccount, useSendTransaction } from "wagmi";

function Swap() {
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const params = {
    srcChain: "base", srcToken: "USDC", amount: "100000000",
    dstChain: "solana", dstToken: "SOL",
    sender: address, recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  };
  // Refetches shortly before the best quote's expiresAt, so the quote on screen stays buildable.
  const quote = useQuote(params);

  const swap = useSwap({
    // Your wallet signs. Send tx.approval first when present (EVM), then return the tx hash.
    sign: async (tx) => {
      if (tx.vm !== "evm") throw new Error("connect a Solana wallet for this route");
      return sendTransactionAsync({ to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value) });
    },
  });

  return (
    <div>
      <p>Best: {quote.data?.best.provider} → {quote.data?.best.dstAmount} lamports</p>
      <button disabled={!quote.data || swap.isBusy} onClick={() => swap.start({ quote: quote.data!.best })}>Swap</button>
      <p>{swap.phase} {swap.status?.state} {swap.error?.message}</p>
    </div>
  );
}
```

`useSwap` runs `idle → quoting → building → awaiting-signature → submitted → tracking → done | error`:

1. `start(params)` quotes (or `start({ quote })` reuses one), then builds the tx.
2. It calls your `sign(tx, { quote })`. Return the broadcast tx hash (`string` or `{ txHash }`).
   For Solana txs with `submitViaApi: true`, return `{ signedTransaction }` (base64) instead.
   The hook then sends it through `POST /v1/orders/submit`.
3. If the SDK has `reportSubmitted`, it reports the hash (`POST /v1/orders/{quoteId}/submitted`).
   This is best effort: a failed report never fails the swap.
4. It polls the order status until `filled` (→ `done`), or `refunded` / `failed`. Those two end in
   `error`, with a `SwapError` whose `code` is `ORDER_REFUNDED` or `ORDER_FAILED`. Same-chain
   providers (Jupiter, 0x, KyberSwap) report `unknown`, which counts as done.

`reset()` returns to `idle` and abandons any run still in flight.

## Hooks

| Hook | Returns |
|---|---|
| `useChains()` | query of supported chains (API `chains()` when the client has it, else the SDK's built-in list) |
| `useTokens(chain)` | query of the built-in tokens of one chain; idle while `chain` is empty |
| `useQuote(params, { enabled, refetchInterval: "auto" \| ms \| false, refreshMarginSeconds })` | query of `QuoteResponse`; idle until params are complete and `amount > 0`; 4xx errors are not retried |
| `useBuildTx()` | mutation: `mutate(quoteId)` → `BuiltTx` |
| `useOrderStatus(provider, id, { intervalMs, enabled })` | query of `OrderStatus`; polls until final; adds `isFinal` |
| `useSwap({ sign, pollIntervalMs, trackTimeoutMs, onPhase })` | `{ phase, quote, tx, txHash, status, error, start, reset, isBusy }` |
| `useLayerHop()` | the client from the provider |

Query keys are exported as `layerhopKeys`, so you can invalidate them yourself. API errors are
`LayerHopApiError`s with a stable `code` (see [error codes](https://docs.layerhop.com/errors)).

## License

MIT
