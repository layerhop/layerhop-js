# @layerhop/ai

LayerHop tools for AI agents: best-price cross-chain and same-chain swap quotes (EVM chains and Solana), **unsigned** transactions, simulation, order tracking, token lookup, prices, deposit addresses and checkout. One framework-agnostic tool core with adapters for the **Vercel AI SDK**, **LangChain JS**, **OpenAI function calling** and the **OpenAI Agents SDK**.

**The tools hold no private keys and never sign or broadcast.** `build_transaction` returns unsigned transactions (plus `transactionRequests`, the ordered approval/swap list) for your own signer or the user's wallet.

```bash
npm install @layerhop/ai
# plus the framework you use: ai | @langchain/core | @openai/agents (optional peers)
```

```ts
import { generateText, stepCountIs } from "ai";
import { createVercelTools, AGENT_INSTRUCTIONS } from "@layerhop/ai/vercel";

const tools = createVercelTools({
  integrator: "myapp",          // your partner id: every quote earns your partner fee
  integratorFeeBps: 25,         // optional override (honored with your partner API key)
  apiKey: process.env.LAYERHOP_API_KEY, // optional; needed for deposit addresses and checkout
});

const { text } = await generateText({
  model: "openai/gpt-5",
  system: AGENT_INSTRUCTIONS,
  tools,
  stopWhen: stepCountIs(5),
  prompt: "Quote 100 USDC on Base to SOL. Sender 0xd8dA...6045, recipient 9WzD...AWWM.",
});
```

Other adapters:

```ts
import { createLangChainTools } from "@layerhop/ai/langchain";        // DynamicStructuredTool[]
import { createOpenAITools } from "@layerhop/ai/openai";              // { chatCompletionsTools, responsesTools, handleToolCall }
import { createOpenAIAgentsTools } from "@layerhop/ai/openai-agents"; // FunctionTool[] for @openai/agents
import { createLayerHopTools } from "@layerhop/ai";                   // plain { name, description, schema, execute, run }
```

Tools: `list_chains`, `list_tokens`, `get_prices`, `get_quote`, `build_transaction`, `simulate_transaction`, `report_submitted`, `get_order_status`, `get_swap_link`, `create_deposit_address`, `get_deposit_address`, `create_checkout_session`. Amounts in tool inputs are human decimals (`"100"` = 100 USDC). Quotes use the `api` fee channel.

Tested with `ai` 7.0.127, `@langchain/core` 1.2.12 and `@openai/agents` 0.18.0. ElizaOS, Coinbase AgentKit and GOAT have their own packages: `@layerhop/plugin-elizaos`, `@layerhop/agentkit`, `@layerhop/goat`.

Guide: https://docs.layerhop.com/guides/agent-frameworks

MIT licensed.
