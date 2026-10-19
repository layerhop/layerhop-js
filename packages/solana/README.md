# @layerhop/solana

[![npm](https://img.shields.io/npm/v/@layerhop/solana?color=c3f06b&labelColor=090d15&cacheSeconds=3600)](https://www.npmjs.com/package/@layerhop/solana) [![license](https://img.shields.io/npm/l/@layerhop/solana?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/guides/wallets)

Execute [LayerHop](https://layerhop.com) quotes with a Solana wallet. It decodes the base64 `SvmTx`, has the wallet
sign it (and send it, when the route allows), submits it through `POST /v1/orders/submit` when the route requires that,
and reports the signature to LayerHop.

> **Never holds keys.** Every transaction is confirmed by the user in their wallet.

## Install

```bash
npm install @layerhop/solana @layerhop/sdk @solana/web3.js
# peer: @solana/web3.js ^1.98.4
```

## Usage

```ts
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { executeSolanaQuote, fromWalletAdapter, LayerHop } from "@layerhop/solana";

const lh = new LayerHop({ integrator: "myapp" });
const wallet = useWallet();
const { connection } = useConnection();

const { best } = await lh.quote({
  srcChain: "solana", srcToken: "SOL", amount: "100000000", dstChain: "base", dstToken: "USDC",
  sender: wallet.publicKey!.toBase58(), recipient: "0xYourEvmAddress",
});
const sent = await executeSolanaQuote(fromWalletAdapter(wallet), { quote: best, client: lh, connection });
await sent.wait(); // true once confirmed
```

## Signers

| Wallet stack | Signer |
|---|---|
| `@solana/wallet-adapter` (`useWallet()` or an adapter) | `fromWalletAdapter(wallet)` |
| Wallet Standard (`getWallets()`) | `fromWalletStandard(wallet, account, "solana:mainnet")` |
| Reown AppKit `walletProvider`, Phantom, Dynamic `getSigner()`, other injected/embedded providers | `fromInjectedProvider(provider)` |
| Anything else | implement `SolanaSigner` (`signTransaction`, optional `signAndSendTransaction`) |

## Send modes

`sendSvmTx` / `executeSolanaQuote` pick the mode from the transaction:

- **`api`** (`submitViaApi: true`, e.g. Jupiter): the wallet only signs, then the signed bytes go to `POST /v1/orders/submit`.
- **`cosigned`** (the provider already signed, e.g. Mayan): the wallet only signs (signing and sending could rewrite the transaction and
  void the provider's signature), then your `connection` broadcasts the exact bytes.
- **`wallet`**: the wallet signs and sends. Sign-only wallets are broadcast through your `connection`.

Test-mode (`sandbox`) transactions never reach the wallet. `executeSolanaQuote` reports a placeholder signature instead.

Other exports: `decodeSvmTx`, `solanaSendMode`, `confirmSignature`, `base64ToBytes`, `bytesToBase64`, `bytesToBase58`.

Guide (Privy, Dynamic, Reown and more): <https://docs.layerhop.com/guides/wallets>. Example: [`example/swap.ts`](example/swap.ts).

## License

MIT
