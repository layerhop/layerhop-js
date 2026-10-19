/**
 * Safety wording shared by every LayerHop agent integration (MCP server, Vercel AI SDK, LangChain,
 * OpenAI, ElizaOS, AgentKit, GOAT). Keep it in sync with packages/mcp/src/server.ts.
 */

export const NO_KEYS = "LayerHop tools hold no private keys and never sign or broadcast transactions.";

export const DEPOSIT_WARNING =
  "Tell the user: send ONLY srcToken on srcChain to the address (other tokens or chains may be lost for good), at least $1 worth; refundTo must be the user's own address on srcChain, never an exchange (CEX) deposit address. Needs a LayerHop API key; test keys (lh_test_) give a fake sandbox address that must never receive real funds.";

export const API_KEY_MISSING =
  "This tool needs a LayerHop API key. Pass apiKey (lh_test_... for test mode, lh_live_... for live) when you create the LayerHop tools, e.g. from the LAYERHOP_API_KEY environment variable. Create a key at https://dashboard.layerhop.com/keys.";

/** System-prompt text for agents that use the LayerHop tools. Tool names are the default (unprefixed) ones. */
export function agentInstructions(toolName: (base: string) => string = (n) => n): string {
  const t = toolName;
  return `LayerHop finds the best-priced route for cross-chain and same-chain token swaps (EVM chains and Solana) across many liquidity providers. ${NO_KEYS}

Amounts in tool inputs are HUMAN decimal strings in the token's own units ("100" = 100 USDC, "0.05" = 0.05 ETH), never base units. Outputs show human amounts; fields named *BaseUnits are integers in the token's smallest unit.

Safe workflow: ${t("list_chains")} / ${t("list_tokens")} if unsure -> ${t("get_quote")} -> show the user output, minimum received, every fee and the ETA -> get explicit confirmation -> prefer giving the user the swapLink (or ${t("get_swap_link")}) so they review and sign in their own wallet on layerhop.com. Only use ${t("build_transaction")} when the user (or the app hosting you) has its own signer; hand the unsigned transaction to that signer, never ask for or accept private keys or seed phrases.

Deposit addresses (${t("create_deposit_address")}, API key required) let a user swap or bridge by just sending a token to an address. When you show one, always tell the user: send ONLY that token on that chain (anything else may be lost), at least $1 worth, and refunds go to refundTo, which must be their own address, never an exchange deposit address. Test-key addresses are fake: never send real funds.`;
}

export const AGENT_INSTRUCTIONS = agentInstructions();
