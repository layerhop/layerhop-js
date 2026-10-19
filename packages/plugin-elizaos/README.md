# @layerhop/plugin-elizaos

[ElizaOS](https://elizaos.ai) plugin for [LayerHop](https://layerhop.com): best-price cross-chain and same-chain swap quotes across EVM chains and Solana, unsigned transactions, order tracking, prices, deposit addresses and checkout links.

**Holds no keys and never auto-signs.** Without a signing service the agent hands out the swap link or the unsigned transaction. With one, it signs only after the user explicitly replies "confirm" to a prepared swap.

```bash
npm install @layerhop/plugin-elizaos
```

```ts
import { type Character } from "@elizaos/core";
import { createLayerHopPlugin } from "@layerhop/plugin-elizaos";

export const character: Character = {
  name: "Hopper",
  bio: ["Finds the cheapest route to move tokens between chains."],
  plugins: ["@elizaos/plugin-openai"],
  settings: {
    secrets: { LAYERHOP_API_KEY: process.env.LAYERHOP_API_KEY ?? "" }, // optional: deposit addresses, checkout
    LAYERHOP_INTEGRATOR: "myapp",        // your partner id: swaps earn your partner fee
    LAYERHOP_INTEGRATOR_FEE_BPS: "25",   // optional override (honored with your partner API key)
    LAYERHOP_SIGNER_SERVICE: "wallet",   // optional: a service implementing LayerHopSignerService
  },
};
export const plugins = [createLayerHopPlugin()]; // or "@layerhop/plugin-elizaos" in character.plugins
```

Actions: `LAYERHOP_GET_QUOTE`, `LAYERHOP_PREPARE_SWAP`, `LAYERHOP_CONFIRM_SWAP`, `LAYERHOP_CANCEL_SWAP`, `LAYERHOP_ORDER_STATUS`, `LAYERHOP_GET_PRICES`, `LAYERHOP_CREATE_DEPOSIT_ADDRESS`, `LAYERHOP_CREATE_CHECKOUT`. Provider: `LAYERHOP` (safety rules, signing status, the pending swap). Parameters are extracted from the conversation with the runtime's `OBJECT_SMALL` model, or passed as `options.layerhop` / `message.content.layerhop`.

Signing flow: `LAYERHOP_PREPARE_SWAP` builds the unsigned transaction and stores it for that user and room. `LAYERHOP_CONFIRM_SWAP` only validates on an explicit confirmation ("confirm", "yes, confirm", ...) from the same user, is single-use and expires after 5 minutes. It then passes the transactions to your `LayerHopSignerService` (`getAddress`, `sendTransaction` for EVM, `signAndSendSolanaTransaction` / `signSolanaTransaction` for Solana): your wallet signs, LayerHop never sees a key. Test-mode placeholder transactions are never sent.

Tested with `@elizaos/core` 1.7.2.

Guide: https://docs.layerhop.com/guides/agent-frameworks

MIT licensed.
