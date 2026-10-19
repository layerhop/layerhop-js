/**
 * @layerhop/ai/core: the framework-free core shared by the LayerHop MCP server and the agent
 * framework integrations. No zod, no framework imports, no keys, no signing.
 */
export { toBaseUnits, fromBaseUnits, displayAmount, AmountError } from "./amounts.js";
export { isEvmAddress, isSolanaAddress, isValidAddress, isTxHash, vmOfAddress, assertAddress, describeVm, base58Decode, type Vm } from "./address.js";
export { buildSwapLink, DEFAULT_APP_URL, type SwapLinkParams } from "./links.js";
export {
  formatEta,
  bpsToPercent,
  formatQuote,
  formatQuoteResponse,
  formatBuiltTx,
  depositRules,
  formatDepositAddress,
  formatDepositOrder,
  formatDepositEstimate,
  type FormatOptions,
  type TokenInfo,
  type QuoteContext,
  type TokenLookup,
  type DepositAddressLike,
  type DepositOrderLike,
} from "./format.js";
export { LayerHopClient, EndpointUnavailableError, type ClientOptions, type SimulateResult, type ListOrdersParams } from "./client.js";
export { UserInputError, QuoteCache, createResolvers, type Resolvers } from "./resolve.js";
export {
  toTransactionRequests,
  encodeApprove,
  encodeAllowance,
  isSandboxTx,
  SandboxTxError,
  ERC20_ABI,
  type Hex,
  type TxRequest,
  type EvmTxRequest,
  type SvmTxRequest,
} from "./txs.js";
export { NO_KEYS, DEPOSIT_WARNING, API_KEY_MISSING, AGENT_INSTRUCTIONS, agentInstructions } from "./safety.js";
