/**
 * @layerhop/ai: framework-agnostic LayerHop tools for AI agents (quote, unsigned tx, simulate, track,
 * deposit addresses, checkout, tokens, prices). Adapters: @layerhop/ai/vercel, /langchain, /openai,
 * /openai-agents. The tools hold no keys and never sign: build_transaction returns UNSIGNED
 * transactions for the host's own wallet/signer.
 */
export {
  createLayerHopTools,
  errorMessage,
  VERSION,
  type LayerHopTool,
  type LayerHopToolset,
  type LayerHopToolsOptions,
  type ToolAnnotations,
  type ToolResult,
} from "./tools.js";
export { TOOL_NAMES, zodV4Schemas, zodV3Schemas, type ToolName, type ToolSchemas, type ZodV3Schemas } from "./schemas.js";
export { toJsonSchema, type JsonObjectSchema } from "./json-schema.js";
export { PROVIDERS } from "./providers.js";
export { executeEvmSwap, executeSvmSwap, describeQuoteForConfirmation, type EvmSigner, type SvmSigner, type ExecuteSwapResult } from "./execute.js";
export * from "./core/index.js";
