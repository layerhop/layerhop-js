import { z as z4 } from "zod/v4";
import { z as z3 } from "zod/v3";
import { PROVIDERS } from "./providers.js";

/**
 * Input schemas for every LayerHop tool. Written once against the zod API both majors share, then
 * instantiated with zod v4 (Vercel AI SDK, LangChain, OpenAI) and zod v3 (AgentKit, GOAT, which
 * still convert schemas with zod-to-json-schema). Descriptions match the MCP server.
 */

type Z = typeof z4;

function build(z: Z, ref: (base: string) => string) {
  const amount = z
    .union([z.string(), z.number()])
    .describe(
      'Amount to send in HUMAN units of fromToken as a decimal string, e.g. "100" for 100 USDC or "0.05" for 0.05 ETH. NOT base units/wei/lamports. Must be greater than 0.',
    );
  const chain = (what: string) =>
    z.union([z.string(), z.number()]).describe(`${what} chain: slug ("base", "solana", "ethereum", "arbitrum"...) or numeric chain id (Solana is 7565164). See ${ref("list_chains")}.`);
  const token = (what: string) =>
    z
      .string()
      .min(1)
      .describe(`${what} token: symbol from ${ref("list_tokens")} ("USDC", "ETH", "SOL") or the token contract address / SPL mint. Use "native" for the chain's gas coin.`);
  const decimals = (what: string) =>
    z
      .number()
      .int()
      .min(0)
      .max(36)
      .optional()
      .describe(`Only needed when ${what} is an address that is not in ${ref("list_tokens")}: the token's decimals (e.g. 6 for USDC, 18 for most ERC-20s).`);
  const slippage = z.number().int().min(1).max(5000).optional().describe("Max slippage in basis points (1 bp = 0.01%). Default 50 (= 0.5%).");
  const quoteId = z
    .string()
    .regex(/^q_/, "quoteId starts with q_")
    .describe(`quoteId from ${ref("get_quote")} (starts with "q_"). Quotes expire after a short time (see expiresAt).`);
  const depositId = z.string().regex(/^da_/, "deposit address ids start with da_").describe('Deposit address id (starts with "da_").');

  return {
    list_chains: z.object({}),
    list_tokens: z.object({
      chain: chain("The"),
      query: z.string().min(1).max(64).optional().describe('Optional search by symbol, name or address ("usdc", "bonk"). Without it: LayerHop\'s built-in tokens for the chain.'),
      limit: z.number().int().min(1).max(50).optional().describe("Max search results (default 20). Only with query."),
    }),
    get_prices: z.object({
      tokens: z
        .array(
          z.object({
            chain: chain("The token's"),
            token: token("The"),
          }),
        )
        .min(1)
        .max(25)
        .describe("Tokens to price (1-25)."),
    }),
    get_quote: z.object({
      fromChain: chain("Source"),
      fromToken: token("Token to send (source)"),
      amount,
      toChain: chain("Destination"),
      toToken: token("Token to receive (destination)"),
      sender: z
        .string()
        .min(1)
        .describe("Wallet address that sends the funds on the source chain (0x... for EVM, base58 for Solana). Only used to build the quote; no access is needed."),
      recipient: z
        .string()
        .optional()
        .describe("Address that receives funds on the destination chain. Defaults to sender when both chains use the same VM; REQUIRED for EVM <-> Solana."),
      slippageBps: slippage,
      fromTokenDecimals: decimals("fromToken"),
      toTokenDecimals: decimals("toToken"),
    }),
    build_transaction: z.object({ quoteId }),
    simulate_transaction: z.object({ quoteId }),
    report_submitted: z.object({
      quoteId,
      txHash: z.string().min(1).describe("Source-chain transaction hash (EVM 0x...) or Solana signature (base58)."),
    }),
    get_order_status: z.object({
      provider: z.enum(PROVIDERS).describe(`The provider of the quote that was executed (the \`provider\` field from ${ref("get_quote")} / ${ref("build_transaction")}).`),
      txHash: z.string().min(1).describe("Source-chain transaction hash (EVM) or signature (Solana)."),
    }),
    get_swap_link: z.object({
      fromChain: chain("Source"),
      fromToken: token("Token to send (source)"),
      toChain: chain("Destination"),
      toToken: token("Token to receive (destination)"),
      amount: amount.optional(),
      recipient: z.string().optional().describe("Optional destination address to prefill (the user can still edit it)."),
      slippageBps: slippage,
    }),
    create_deposit_address: z.object({
      fromChain: chain("Source (deposit)"),
      fromToken: token("The ONLY token the user may send to the address (source)"),
      toChain: chain("Destination"),
      toToken: token("Token to deliver (destination)"),
      recipient: z.string().min(1).describe("Address that receives toToken on toChain."),
      refundTo: z
        .string()
        .min(1)
        .describe("The user's OWN address on fromChain for refunds. NEVER an exchange (CEX) deposit address: refunds never go back to an exchange."),
      reusable: z.boolean().optional().describe("true (default): reusable for this route with any amount. false: one-time address for exactly `amount`."),
      amount: amount
        .optional()
        .describe('HUMAN units of fromToken ("25" = 25 USDC). Required when reusable is false (the exact amount to send); otherwise only sizes the estimate. Minimum worth $1.'),
      fromTokenDecimals: decimals("fromToken"),
      label: z.string().min(1).max(64).optional().describe("Your reference for this address (1-64 chars)."),
    }),
    get_deposit_address: z.object({ id: depositId }),
    create_checkout_session: z.object({
      amount: z
        .union([z.string(), z.number()])
        .describe('Amount due in HUMAN units of the settlement token, e.g. "49" for 49 USDC. NOT base units.'),
      settleChain: chain("Settlement").describe("Chain the merchant is paid on: ethereum, arbitrum, base, optimism, bsc, polygon or solana."),
      settleToken: z.string().min(1).describe('"USDC" or "USDT" (or its address) on settleChain: what the merchant receives.'),
      recipient: z.string().min(1).describe("The merchant's payout address on settleChain."),
      description: z.string().min(1).max(200).optional().describe("Shown to the payer."),
      merchantName: z.string().min(1).max(80).optional().describe("Shown to the payer."),
      reference: z.string().min(1).max(128).optional().describe("Your own order id; never shown to the payer."),
      successUrl: z.string().url().optional().describe("Where the payer goes after paying."),
      cancelUrl: z.string().url().optional().describe("Where the payer goes on cancel."),
      expiresInMinutes: z.number().int().min(5).max(10080).optional().describe("5-10080, default 60."),
    }),
  };
}

export type ToolSchemas = ReturnType<typeof build>;
export type ToolName = keyof ToolSchemas;
export const TOOL_NAMES = Object.keys(build(z4, (n) => n)) as ToolName[];

/** zod v4 schemas (Vercel AI SDK, LangChain, OpenAI). `ref` maps tool names used in descriptions. */
export function zodV4Schemas(ref: (base: string) => string = (n) => n): ToolSchemas {
  return build(z4, ref);
}

/** The same schemas built with zod v3 (`zod/v3`), for toolkits that still expect v3 (AgentKit, GOAT). */
export type ZodV3Schemas = { [K in ToolName]: z3.ZodObject<z3.ZodRawShape> };
export function zodV3Schemas(ref: (base: string) => string = (n) => n): ZodV3Schemas {
  return build(z3 as unknown as Z, ref) as unknown as ZodV3Schemas;
}
