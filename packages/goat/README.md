# @layerhop/goat

[GOAT SDK](https://github.com/goat-sdk/goat) plugin for [LayerHop](https://layerhop.com): best-price cross-chain and same-chain swap quotes across EVM chains and Solana, unsigned transactions, simulation, tracking, token lookup, prices, deposit addresses and checkout.

**LayerHop never sees keys.** Swaps are signed by the GOAT wallet client you configure (your own signer); `layerhop_execute_swap` only hands it the transactions for a quote the user explicitly confirmed.

```bash
npm install @layerhop/goat @goat-sdk/core
```

```ts
import { openai } from "@ai-sdk/openai";
import { getOnChainTools } from "@goat-sdk/adapter-vercel-ai";
import { viem } from "@goat-sdk/wallet-viem";
import { generateText } from "ai";
import { layerhop } from "@layerhop/goat";

const tools = await getOnChainTools({
  wallet: viem(walletClient), // your viem WalletClient: it signs, LayerHop never sees the key
  plugins: [layerhop({ integrator: "myapp", integratorFeeBps: 25 })], // partner fee on every swap
});

const { text } = await generateText({
  model: openai("gpt-5"),
  tools,
  maxSteps: 6,
  prompt: "Quote 50 USDC on Base to ETH on Arbitrum for my wallet, and wait for my confirmation.",
});
```

Tools: `layerhop_list_chains`, `layerhop_list_tokens`, `layerhop_get_prices`, `layerhop_get_quote`, `layerhop_build_transaction`, `layerhop_simulate_transaction`, `layerhop_report_submitted`, `layerhop_get_order_status`, `layerhop_get_swap_link`, `layerhop_create_deposit_address`, `layerhop_get_deposit_address`, `layerhop_create_checkout_session`, plus `layerhop_execute_swap` on EVM wallet clients.

`layerhop_execute_swap { quoteId, userConfirmed: true }` refuses unless the quote was made with sender = the wallet's address, has not expired and the wallet is on the quote's chain. It sends the ERC-20 approval only when the allowance is short, then the swap, then reports the hash for tracking. Test-mode placeholder transactions are never sent. Pass `enableSwapExecution: false` for a quote-only agent; Solana wallets get the unsigned transaction to sign.

Tested with `@goat-sdk/core` 0.5.0.

Guide: https://docs.layerhop.com/guides/agent-frameworks

MIT licensed.
