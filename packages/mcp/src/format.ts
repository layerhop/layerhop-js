// Moved to @layerhop/ai/core (shared with the agent-framework integrations); re-exported here with
// the MCP server's wording.
import { formatBuiltTx as coreFormatBuiltTx } from "@layerhop/ai/core";

export {
  formatEta,
  bpsToPercent,
  formatQuote,
  formatQuoteResponse,
  depositRules,
  formatDepositAddress,
  formatDepositOrder,
  formatDepositEstimate,
  type TokenInfo,
  type QuoteContext,
  type TokenLookup,
  type DepositAddressLike,
  type DepositOrderLike,
} from "@layerhop/ai/core";

export function formatBuiltTx(...args: Parameters<typeof coreFormatBuiltTx>): ReturnType<typeof coreFormatBuiltTx> {
  const [tx, provider, quoteId, ctx, chainName, apiUrl, opts] = args;
  return coreFormatBuiltTx(tx, provider, quoteId, ctx, chainName, apiUrl, { holder: "The LayerHop MCP server", ...opts });
}
