# @layerhop/agentkit

[Coinbase AgentKit](https://github.com/coinbase/agentkit) action provider for [LayerHop](https://layerhop.com): best-price cross-chain and same-chain swaps across EVM chains and Solana, plus quotes, simulation, tracking, token lookup, prices, deposit addresses and checkout.

**LayerHop never sees keys.** In AgentKit's model the wallet provider you configure signs with your own wallet (CDP, Privy, viem, ...). `layerhop_execute_swap` hands it the unsigned transactions for a quote the user explicitly confirmed.

```bash
npm install @layerhop/agentkit @coinbase/agentkit
```

```ts
import { AgentKit, CdpEvmWalletProvider } from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { layerhopActionProvider } from "@layerhop/agentkit";

const walletProvider = await CdpEvmWalletProvider.configureWithWallet({ networkId: "base-mainnet" });
const agentkit = await AgentKit.from({
  walletProvider,
  actionProviders: [
    layerhopActionProvider({
      integrator: "myapp",       // your partner id: your agent's swaps earn your partner fee
      integratorFeeBps: 25,      // optional override (honored with your partner API key)
      apiKey: process.env.LAYERHOP_API_KEY, // optional; for deposit addresses and checkout
    }),
  ],
});
const tools = await getLangChainTools(agentkit);
```

Actions: `layerhop_list_chains`, `layerhop_list_tokens`, `layerhop_get_prices`, `layerhop_get_quote`, `layerhop_build_transaction`, `layerhop_simulate_transaction`, `layerhop_report_submitted`, `layerhop_get_order_status`, `layerhop_get_swap_link`, `layerhop_create_deposit_address`, `layerhop_get_deposit_address`, `layerhop_create_checkout_session` and `layerhop_execute_swap`.

`layerhop_execute_swap { quoteId, userConfirmed: true }` refuses unless the quote came from `layerhop_get_quote` with sender = the wallet's address, has not expired, and the wallet is on the quote's chain. On EVM it sends the ERC-20 approval only when the allowance is short (from the built transaction's `approval`), waits for it, sends the swap with `walletProvider.sendTransaction`, then reports the hash for tracking. Solana wallet providers sign the serialized transaction (needs `@solana/web3.js`, already a dependency of AgentKit). Test-mode (`lh_test_`) placeholder transactions are never sent. Use `layerhopActionProvider({ enableSwapExecution: false })` for a quote-only agent.

Tested with `@coinbase/agentkit` 0.10.4.

Guide: https://docs.layerhop.com/guides/agent-frameworks

MIT licensed.
