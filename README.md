# LayerHop JavaScript SDKs

TypeScript/JavaScript packages for [LayerHop](https://layerhop.com): best-price cross-chain and
same-chain swaps across EVM chains and Solana through one non-custodial API. Nothing here holds keys
or signs; you get quotes and *unsigned* transactions that your users' wallets sign.

Docs: <https://docs.layerhop.com>

## Packages

| Package | Description |
|---|---|
| [`@layerhop/sdk`](packages/sdk) | LayerHop SDK — best-price cross-chain and same-chain swaps |
| [`@layerhop/react`](packages/react) | React hooks for LayerHop cross-chain swaps: quotes, transactions, order tracking and a wallet-agnostic useSwap state machine |
| [`@layerhop/widget`](packages/widget) | Embed the LayerHop cross-chain swap widget in any site: React component, framework-agnostic mount() and a drop-in <script> tag |
| [`@layerhop/cli`](packages/cli) | LayerHop command line: quotes, order status, deep links, project scaffolding and a local mock devnet |
| [`@layerhop/mcp`](packages/mcp) | LayerHop MCP server: let AI agents (Claude, ChatGPT, Cursor, ...) quote and prepare cross-chain swaps. Holds no keys and never signs. |

`packages/shared` is an internal, private package (chain registry, tokens, error codes, types). It is
inlined into each published package at build time, so you never install it.

## Quickstarts

**SDK** (`npm install @layerhop/sdk`)

```ts
import { LayerHop } from "@layerhop/sdk";

const lh = new LayerHop({ integrator: "myapp" });
const { best } = await lh.quote({
  srcChain: "base", srcToken: "USDC", amount: "100000000", // 100 USDC, base units
  dstChain: "solana", dstToken: "SOL",
  sender: "0xYourEvmAddress", recipient: "YourSolanaAddress",
});
const tx = await lh.buildTx(best.quoteId); // unsigned; sign with your wallet
```

**Checkout: pay with any token** (`@layerhop/sdk` 0.2+)

```ts
const session = await lh.checkout.create({
  amount: "49000000", settleChain: "base", settleToken: "USDC", // 49 USDC on Base
  recipient: "0xYourPayoutAddress", successUrl: "https://shop.example.com/thanks",
});
// Send the customer to session.url; fulfil on the checkout.session.completed webhook.
```

**Test mode**: use an `lh_test_…` key from the dashboard and every call is served by the sandbox
(live-priced quotes, placeholder transactions, orders fill in ~10 s). See
<https://docs.layerhop.com/guides/test-mode>. Try every endpoint in the
[API playground](https://docs.layerhop.com/playground).

**React** (`npm install @layerhop/react @layerhop/sdk @tanstack/react-query`)

```tsx
import { LayerHopProvider, useQuote } from "@layerhop/react";

<LayerHopProvider options={{ integrator: "myapp" }}>
  <App />
</LayerHopProvider>;
```

**Widget** (`npm install @layerhop/widget`)

```ts
import { mount } from "@layerhop/widget";

mount("#swap", { srcChain: "base", dstChain: "solana", dstToken: "SOL" });
```

**CLI**

```bash
npx @layerhop/cli quote 100 USDC base SOL solana --sender 0x... --recipient 9WzD...
```

**MCP server for AI agents** (`npx -y @layerhop/mcp`), see [packages/mcp](packages/mcp).

Each package's README has the full guide.

## Development

```bash
corepack enable
pnpm install
pnpm typecheck && pnpm test && pnpm build
```

## Source of truth

This repository is exported from the LayerHop monorepo. PRs are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
