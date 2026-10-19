# @layerhop/wagmi

[![npm](https://img.shields.io/npm/v/@layerhop/wagmi?color=c3f06b&labelColor=090d15&cacheSeconds=3600)](https://www.npmjs.com/package/@layerhop/wagmi) [![license](https://img.shields.io/npm/l/@layerhop/wagmi?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/guides/wallets)

Execute [LayerHop](https://layerhop.com) quotes with the user's wallet through [wagmi](https://wagmi.sh) or a
[viem](https://viem.sh) `WalletClient`. It handles the ERC-20 approval (checking the allowance first), the swap,
and any `extraTxs`, then reports the hash to LayerHop.

When the wallet supports **EIP-5792** atomic batching (`wallet_getCapabilities`), the approval, swap and fee transfer go
in **one** `wallet_sendCalls` confirmation. Other wallets get sequential transactions.

> **Never holds keys.** Every transaction is confirmed by the user in their wallet.

## Install

```bash
npm install @layerhop/wagmi @layerhop/sdk wagmi viem @tanstack/react-query
# peers: wagmi ^2.19.5, viem ^2.57.7; react >= 18 and @tanstack/react-query >= 5.62.11 for the hooks
```

## React

```tsx
import { LayerHopProvider, useExecuteQuote, useLayerHopQuote, useOrderStatus } from "@layerhop/wagmi";
import { useAccount } from "wagmi";

// <WagmiProvider config={config}><QueryClientProvider client={qc}><LayerHopProvider options={{ integrator: "myapp" }}>…
function Swap() {
  const { address } = useAccount();
  const quote = useLayerHopQuote(address && {
    srcChain: "base", srcToken: "USDC", amount: "25000000", // integer string, base units
    dstChain: "solana", dstToken: "SOL", sender: address, recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  });
  const exec = useExecuteQuote();
  const best = quote.data?.best;
  const order = useOrderStatus(best?.provider, exec.hash);
  return <button disabled={!best || exec.isPending} onClick={() => best && exec.execute({ quote: best })}>{exec.status}</button>;
}
```

`useExecuteQuote()` → `{ execute, reset, status, hash, mode, approval, result, error, isPending }`.
`status`: `idle → building → (switching) → (approving) → signing → reporting → submitted | error`.
`mode`: `batch` (one EIP-5792 confirmation), `sequential` or `sandbox` (test-mode placeholder, nothing sent).
`useLayerHopQuote` is `useQuote` from [`@layerhop/react`](https://www.npmjs.com/package/@layerhop/react).

## Actions (no React): `@layerhop/wagmi/actions`

```ts
import { executeQuote, executeQuoteWithWalletClient } from "@layerhop/wagmi/actions";
import { LayerHop } from "@layerhop/sdk";

const lh = new LayerHop({ apiKey: process.env.LAYERHOP_API_KEY });
const { best } = await lh.quote(params);

const sent = await executeQuote(wagmiConfig, { quote: best, client: lh });
// or, with a viem WalletClient (Privy, Dynamic, thirdweb, any EIP-1193 provider):
// const sent = await executeQuoteWithWalletClient(walletClient, { quote: best, client: lh });

sent.hash;   // the mined tx hash in batch mode, the main tx hash in sequential mode
sent.mode;   // "batch" | "sequential" | "sandbox"
await sent.wait(); // true once confirmed
```

Options: `batch` (`"auto"` default, `"never"`, `"require"`), `tx` (an already built tx), `report` (default true),
`onStep`, `onApproval({ batched })`, `onBatchFallback`, `onExtraTxError`.

## How batching works

1. The wallet switches to the transaction's chain if needed.
2. The allowance is read. An exact-amount `approve` is added only when the allowance is short.
3. If there is more than one call and `wallet_getCapabilities` reports `atomic.status` `supported`/`ready` (or the older
   `atomicBatch.supported`), all calls go in one `wallet_sendCalls` with `atomicRequired: true`. The hash comes from
   `wallet_getCallsStatus` once the batch lands.
4. Otherwise, or when the wallet rejects the batch as unsupported (4200, 5700, 5710, 5740, 5750, 5760, -32601), the calls
   go sequentially: approve (and wait), main call, then each extra call. A failed extra call never fails the send.
   A user rejection (4001) is never retried.

Lower-level building blocks: `sendEvmTx(driver, tx)`, `wagmiDriver(config)`, `walletClientDriver(walletClient)`,
`evmCalls`, `supportsAtomicBatch`, `getAtomicBatchSupport(config, chainId)`.

Guide with Privy, Dynamic, thirdweb, Coinbase Smart Wallet and Reown snippets: <https://docs.layerhop.com/guides/wallets>.
Example: [`example/Swap.tsx`](example/Swap.tsx).

## License

MIT
