import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Chain, ProviderId } from "@layerhop/shared";
import { z } from "zod";
import { assertAddress, isTxHash, isValidAddress, vmOfAddress } from "./address.js";
import { AmountError, fromBaseUnits, toBaseUnits } from "./amounts.js";
import { LayerHopApiError } from "@layerhop/sdk";
import { EndpointUnavailableError, LayerHopClient } from "./client.js";
import { configFromEnv, VERSION, type McpConfig } from "./config.js";
import {
  depositRules,
  formatBuiltTx,
  formatDepositAddress,
  formatDepositEstimate,
  formatDepositOrder,
  formatQuoteResponse,
  type DepositAddressLike,
  type QuoteContext,
  type TokenInfo,
  type TokenLookup,
} from "./format.js";
import { buildSwapLink } from "./links.js";

export const PROVIDERS = ["jupiter", "relay", "debridge", "mayan", "zerox", "kyberswap", "odos", "lifi", "mock"] as const satisfies readonly ProviderId[];
export const ORDER_STATUSES = ["built", "submitted", "pending", "filled", "refunded", "failed", "expired"] as const;

const NO_KEYS =
  "The LayerHop MCP server holds no private keys and never signs or broadcasts transactions.";

export const SERVER_INSTRUCTIONS = `LayerHop finds the best-priced route for cross-chain and same-chain token swaps (EVM chains and Solana) across many liquidity providers. ${NO_KEYS}

Amounts in tool inputs are HUMAN decimal strings in the token's own units ("100" = 100 USDC, "0.05" = 0.05 ETH), never base units. Outputs show human amounts; fields named *BaseUnits are integers in the token's smallest unit.

Safe workflow: list_chains / list_tokens if unsure -> get_quote -> show the user output, minimum received, every fee and the ETA -> get explicit confirmation -> prefer giving the user the swapLink (or get_swap_link) so they review and sign in their own wallet on layerhop.com. Only use build_transaction when the user has their own signer and asks for raw transaction data; never ask for or accept private keys or seed phrases.

Deposit addresses (create_deposit_address and friends, API key required) let a user swap or bridge by just sending a token to an address. When you show one, always tell the user: send ONLY that token on that chain (anything else may be lost), at least $1 worth, and refunds go to refundTo, which must be their own address, never an exchange deposit address. Test-key addresses are fake: never send real funds; use simulate_deposit.`;

const DEPOSIT_WARNING =
  "Tell the user: send ONLY srcToken on srcChain to the address (other tokens or chains may be lost for good), at least $1 worth; refundTo must be the user's own address on srcChain, never an exchange (CEX) deposit address. Needs a LayerHop API key; test keys (lh_test_) give a fake sandbox address that must never receive real funds.";

export const DEPOSIT_KEY_MISSING =
  "Deposit addresses need a LayerHop API key. Local server: set LAYERHOP_API_KEY (lh_test_... for test mode, lh_live_... for live). Hosted server (mcp.layerhop.com): send the x-layerhop-api-key header (or Authorization: Bearer lh_...). Create a key at https://dashboard.layerhop.com/keys.";

export interface CreateServerOptions {
  config?: Partial<McpConfig>;
  /** Injected fetch (tests, custom agents). */
  fetch?: typeof fetch;
}

/** Internal: lets the HTTP transport reuse one client (and its caches) across per-request servers. */
export interface InternalServerOptions extends CreateServerOptions {
  client?: LayerHopClient;
  quoteCache?: QuoteCache;
}

/** quoteId -> request context, so build/simulate can show human amounts. In-memory, bounded. */
export class QuoteCache {
  private readonly map = new Map<string, QuoteContext>();
  constructor(private readonly max = 2000) {}
  set(ctx: QuoteContext): void {
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(ctx.quoteId, ctx);
  }
  get(quoteId: string): QuoteContext | undefined {
    return this.map.get(quoteId);
  }
}

class UserInputError extends Error {}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof LayerHopApiError) {
      return fail(
        `LayerHop API error ${e.code} (HTTP ${e.status}): ${e.message}${e.requestId ? ` [requestId ${e.requestId}]` : ""}. See https://docs.layerhop.com/errors/${e.code}`,
      );
    }
    if (e instanceof EndpointUnavailableError) return fail(e.message);
    if (e instanceof AmountError || e instanceof UserInputError) return fail(e.message);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const amountSchema = z
  .union([z.string(), z.number()])
  .describe(
    'Amount to send in HUMAN units of fromToken as a decimal string, e.g. "100" for 100 USDC or "0.05" for 0.05 ETH. NOT base units/wei/lamports. Must be greater than 0.',
  );
const chainSchema = (what: string) =>
  z.union([z.string(), z.number()]).describe(`${what} chain: slug ("base", "solana", "ethereum", "arbitrum"...) or numeric chain id (Solana is 7565164). See list_chains.`);
const tokenSchema = (what: string) =>
  z
    .string()
    .min(1)
    .describe(`${what} token: symbol from list_tokens ("USDC", "ETH", "SOL") or the token contract address / SPL mint. Use "native" for the chain's gas coin.`);
const decimalsSchema = (what: string) =>
  z
    .number()
    .int()
    .min(0)
    .max(36)
    .optional()
    .describe(`Only needed when ${what} is an address that is not in list_tokens: the token's decimals (e.g. 6 for USDC, 18 for most ERC-20s).`);
const slippageSchema = z
  .number()
  .int()
  .min(1)
  .max(5000)
  .optional()
  .describe("Max slippage in basis points (1 bp = 0.01%). Default 50 (= 0.5%).");
const quoteIdSchema = z.string().regex(/^q_/, "quoteId starts with q_").describe('quoteId from get_quote (starts with "q_"). Quotes expire after a short time (see expiresAt).');

/** Create the LayerHop MCP server (tools, resources, prompt). Connect it to any MCP transport. */
export function createLayerHopMcpServer(opts: CreateServerOptions = {}): McpServer {
  return buildServer(opts);
}

export function buildServer(opts: InternalServerOptions): McpServer {
  const config: McpConfig = { ...configFromEnv(), ...stripUndefined(opts.config ?? {}) };
  const client =
    opts.client ??
    new LayerHopClient({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      integrator: config.integrator,
      fetch: opts.fetch,
      userAgent: `layerhop-mcp/${VERSION}`,
    });
  const quotes = opts.quoteCache ?? new QuoteCache();

  const server = new McpServer({ name: "layerhop", version: VERSION, title: "LayerHop" }, { instructions: SERVER_INSTRUCTIONS });

  // ---------- helpers ----------
  const resolveChain = async (input: string | number): Promise<Chain> => {
    const c = await client.chain(input);
    if (!c) {
      const all = await client.chains();
      throw new UserInputError(`Unknown chain "${input}". Supported: ${all.map((x) => `${x.slug} (${x.id})`).join(", ")}.`);
    }
    return c;
  };
  const resolveToken = async (chain: Chain, input: string, decimals?: number): Promise<TokenInfo> => {
    const q = input.trim();
    const tokens = await client.tokens(chain.id);
    if (q.toLowerCase() === "native") {
      const n = tokens.find((t) => t.symbol === chain.nativeSymbol);
      if (n) return { symbol: n.symbol, address: n.address, decimals: n.decimals };
    }
    const known = tokens.find((t) => t.symbol.toLowerCase() === q.toLowerCase() || t.address.toLowerCase() === q.toLowerCase());
    if (known) return { symbol: known.symbol, address: known.address, decimals: decimals ?? known.decimals };
    if (isValidAddress(chain.vm, q)) {
      if (decimals === undefined) {
        throw new UserInputError(
          `Token ${q} is not in LayerHop's token list for ${chain.name}, so its decimals are unknown. Pass its decimals (fromTokenDecimals / toTokenDecimals) to convert the human amount.`,
        );
      }
      return { symbol: q, address: q, decimals };
    }
    throw new UserInputError(
      `Unknown token "${input}" on ${chain.name}. Known: ${tokens.map((t) => t.symbol).join(", ") || "none"}. You can also pass a token ${chain.vm === "evm" ? "contract address" : "mint address"}.`,
    );
  };
  const chainNameById = (all: Chain[]) => (id: number) => all.find((c) => c.id === id)?.name ?? `chain ${id}`;

  // ---------- tools ----------
  server.registerTool(
    "list_chains",
    {
      title: "List supported chains",
      description:
        "List every blockchain LayerHop can swap from or to: slug, numeric chain id, name, VM type (evm or svm = Solana) and native coin. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      run(async () => {
        const chains = await client.chains();
        return {
          chains: chains.map((c) => ({ slug: c.slug, id: c.id, name: c.name, vm: c.vm, nativeSymbol: c.nativeSymbol, nativeDecimals: c.nativeDecimals })),
          note: "Use the slug or id as fromChain/toChain. vm 'evm' takes 0x addresses, 'svm' (Solana) takes base58 addresses.",
        };
      }),
  );

  server.registerTool(
    "list_tokens",
    {
      title: "List tokens on a chain",
      description:
        "List LayerHop's built-in tokens on one chain (symbol, contract address or mint, decimals). Symbols can be used directly in get_quote; other tokens can be quoted by address. Read-only.",
      inputSchema: { chain: chainSchema("The") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ chain }) =>
      run(async () => {
        const c = await resolveChain(chain);
        const tokens = await client.tokens(c.id);
        return { chain: c.slug, chainId: c.id, tokens: tokens.map((t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals })) };
      }),
  );

  server.registerTool(
    "get_quote",
    {
      title: "Get swap/bridge quotes",
      description: `Get the best price to swap or bridge tokens, within one chain or across chains (EVM <-> Solana). Asks every liquidity provider and returns the best quote plus alternatives with human-readable amounts, minimum received after slippage, fees (LayerHop fee, partner fee, provider fee, gas) and ETA. Returns a quoteId (valid until expiresAt) and a layerhop.com swapLink a human can open to review and sign. Read-only: ${NO_KEYS} Always show the user the fees and output and get confirmation before proceeding.`,
      inputSchema: {
        fromChain: chainSchema("Source"),
        fromToken: tokenSchema("Token to send (source)"),
        amount: amountSchema,
        toChain: chainSchema("Destination"),
        toToken: tokenSchema("Token to receive (destination)"),
        sender: z.string().min(1).describe("Wallet address that sends the funds on the source chain (0x... for EVM, base58 for Solana). Only used to build the quote; no access is needed."),
        recipient: z
          .string()
          .optional()
          .describe("Address that receives funds on the destination chain. Defaults to sender when both chains use the same VM; REQUIRED for EVM <-> Solana."),
        slippageBps: slippageSchema,
        fromTokenDecimals: decimalsSchema("fromToken"),
        toTokenDecimals: decimalsSchema("toToken"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        const [src, dst] = await Promise.all([resolveChain(a.fromChain), resolveChain(a.toChain)]);
        const [srcToken, dstToken] = await Promise.all([
          resolveToken(src, a.fromToken, a.fromTokenDecimals),
          resolveToken(dst, a.toToken, a.toTokenDecimals),
        ]);
        assertAddress(src.vm, a.sender.trim(), "sender", src.name);
        const sender = a.sender.trim();
        let recipient = a.recipient?.trim();
        if (!recipient) {
          if (src.vm !== dst.vm) {
            throw new UserInputError(
              `recipient is required: ${dst.name} uses a different address format than ${src.name}. Ask the user for their ${dst.name} address.`,
            );
          }
          recipient = sender;
        }
        assertAddress(dst.vm, recipient, "recipient", dst.name);
        const amountBaseUnits = toBaseUnits(a.amount, srcToken.decimals);
        const amount = fromBaseUnits(amountBaseUnits, srcToken.decimals);
        const slippageBps = a.slippageBps ?? 50;

        const r = await client.quote({
          srcChain: src.id,
          srcToken: srcToken.address,
          amount: amountBaseUnits,
          dstChain: dst.id,
          dstToken: dstToken.address,
          sender,
          recipient,
          slippageBps,
        });
        const base = { srcChain: src, dstChain: dst, srcToken, dstToken, amount, amountBaseUnits, sender, recipient, slippageBps };
        for (const q of r.quotes.length ? r.quotes : [r.best]) {
          quotes.set({ ...base, quoteId: q.quoteId, provider: q.provider, expiresAt: q.expiresAt });
        }
        const link = buildSwapLink(
          {
            fromChain: src.slug,
            fromToken: srcToken.symbol === srcToken.address ? srcToken.address : srcToken.symbol,
            toChain: dst.slug,
            toToken: dstToken.symbol === dstToken.address ? dstToken.address : dstToken.symbol,
            amount,
            recipient: a.recipient?.trim() || undefined,
            slippageBps: a.slippageBps,
            integrator: config.integrator,
          },
          config.appUrl,
        );
        return formatQuoteResponse(r, base, link);
      }),
  );

  server.registerTool(
    "build_transaction",
    {
      title: "Build the unsigned transaction for a quote",
      description: `Turn a quoteId from get_quote into the UNSIGNED transaction the user's own wallet must sign: EVM {chainId, to, data, value in wei, optional ERC-20 approval to send first} or Solana {serializedTx base64}. Includes plain-language signing steps. ${NO_KEYS} Only use this when the user has their own signer and explicitly wants raw transaction data, after they confirmed the quote; otherwise give them the swap link.`,
      inputSchema: { quoteId: quoteIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ quoteId }) =>
      run(async () => {
        const [built, chains] = await Promise.all([client.buildOrder(quoteId), client.chains()]);
        return formatBuiltTx(built.tx, built.provider, quoteId, quotes.get(quoteId), chainNameById(chains), config.apiUrl);
      }),
  );

  server.registerTool(
    "simulate_transaction",
    {
      title: "Dry-run a quote's transaction",
      description: `Build the transaction for a quoteId and dry-run it on-chain (EVM eth_call + gas estimate from the sender; Solana simulateTransaction) without sending anything or recording an order. Reports whether it would succeed, gas / compute units, whether an ERC-20 approval is still needed, and the error if it would fail. Read-only: ${NO_KEYS}`,
      inputSchema: { quoteId: quoteIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ quoteId }) =>
      run(async () => {
        try {
          const r = await client.simulate(quoteId);
          const { tx: _tx, ...rest } = r;
          return {
            ...rest,
            summary: r.ok
              ? `Simulation succeeded${r.gasEstimate !== undefined ? `, estimated gas ${r.gasEstimate}` : ""}${r.computeUnits !== undefined ? `, ${r.computeUnits} compute units` : ""}${r.needsApproval ? ". An ERC-20 approval is still needed before the swap (only the approval was simulated)." : "."}`
              : `Simulation failed: ${r.error?.code ?? "UNKNOWN"} ${r.error?.message ?? ""}`.trim(),
          };
        } catch (e) {
          if (e instanceof EndpointUnavailableError) {
            return {
              ok: null,
              available: false,
              summary: "Simulation is not available on this LayerHop API yet. Call build_transaction and let the user's wallet simulate it, or use the swap link (the LayerHop app simulates before signing).",
            };
          }
          throw e;
        }
      }),
  );

  server.registerTool(
    "report_submitted",
    {
      title: "Report a broadcast transaction",
      description:
        "Tell LayerHop that the user's wallet broadcast the transaction for a quoteId, so the order is tracked (status, webhooks). Call this once after broadcasting, with the EVM tx hash (0x + 64 hex) or Solana signature. Idempotent. Does not sign or send anything.",
      inputSchema: {
        quoteId: quoteIdSchema,
        txHash: z.string().min(1).describe("Source-chain transaction hash (EVM 0x...) or Solana signature (base58)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ quoteId, txHash }) =>
      run(async () => {
        if (!isTxHash(txHash.trim())) throw new UserInputError(`"${txHash}" is not a valid EVM tx hash (0x + 64 hex) or Solana signature.`);
        try {
          const r = await client.reportSubmitted(quoteId, txHash.trim());
          const provider = quotes.get(quoteId)?.provider;
          return { ...r, next: provider ? `Track it with get_order_status { provider: "${provider}", txHash: "${txHash.trim()}" }.` : "Track it with get_order_status." };
        } catch (e) {
          if (e instanceof EndpointUnavailableError) {
            return { quoteId, reported: false, summary: "This LayerHop API does not accept submission reports yet; tracking still works with get_order_status." };
          }
          throw e;
        }
      }),
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get swap/bridge order status",
      description:
        "Check the status of a swap or bridge after the source transaction was sent: pending, filled (funds delivered), refunded, failed, or unknown (some same-chain providers; check the tx on an explorer). Read-only.",
      inputSchema: {
        provider: z.enum(PROVIDERS).describe("The provider of the quote that was executed (the `provider` field from get_quote / build_transaction)."),
        txHash: z.string().min(1).describe("Source-chain transaction hash (EVM) or signature (Solana)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ provider, txHash }) =>
      run(async () => {
        const s = await client.status(provider, txHash.trim());
        const chains = await client.chains();
        const explorer = (h?: string) => {
          if (!h) return undefined;
          const c = h.startsWith("0x") ? undefined : chains.find((x) => x.vm === "svm");
          return c ? `${c.explorerTx}${h}` : undefined;
        };
        const meaning: Record<string, string> = {
          pending: "In progress. Check again in ~30 s.",
          filled: "Done: funds were delivered to the recipient.",
          refunded: "The swap did not complete and funds were refunded to the sender.",
          failed: "The swap failed. Check the source transaction on an explorer.",
          unknown: "The provider does not track this tx (common for same-chain swaps). Check the transaction on a block explorer.",
        };
        return { ...s, meaning: meaning[s.state] ?? s.state, srcExplorer: explorer(s.srcTxHash), dstExplorer: explorer(s.dstTxHash) };
      }),
  );

  server.registerTool(
    "list_orders",
    {
      title: "List orders for a wallet",
      description:
        "List LayerHop orders (swaps built or submitted through LayerHop) where the address is the sender or recipient, newest first, with status. Public data (addresses only). Read-only.",
      inputSchema: {
        address: z.string().min(1).describe("Wallet address (EVM 0x... or Solana base58)."),
        status: z.enum(ORDER_STATUSES).optional().describe("Only orders with this status."),
        limit: z.number().int().min(1).max(100).optional().describe("Max orders to return (default set by the API)."),
        cursor: z.string().optional().describe("nextCursor from a previous list_orders call, for the next page."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        const address = a.address.trim();
        if (!vmOfAddress(address)) throw new UserInputError(`"${address}" is not a valid EVM or Solana address.`);
        try {
          const [r, chains] = await Promise.all([client.listOrders({ address, status: a.status, limit: a.limit, cursor: a.cursor }), client.chains()]);
          const tokenLists = new Map<number, Awaited<ReturnType<LayerHopClient["tokens"]>>>();
          const human = async (chainId: unknown, token: unknown, amount: unknown) => {
            if (typeof chainId !== "number" || typeof token !== "string" || typeof amount !== "string" || !/^\d+$/.test(amount)) return undefined;
            if (!tokenLists.has(chainId)) tokenLists.set(chainId, await client.tokens(chainId));
            const t = tokenLists.get(chainId)!.find((x) => x.address.toLowerCase() === token.toLowerCase());
            return t ? `${fromBaseUnits(amount, t.decimals)} ${t.symbol}` : undefined;
          };
          const name = chainNameById(chains);
          const orders = await Promise.all(
            r.orders.map(async (o) => ({
              ...o,
              srcChain: typeof o.srcChainId === "number" ? name(o.srcChainId) : undefined,
              dstChain: typeof o.dstChainId === "number" ? name(o.dstChainId) : undefined,
              amountHuman: await human(o.srcChainId, o.srcToken, o.amount),
              dstAmountHuman: await human(o.dstChainId, o.dstToken, o.dstAmount),
            })),
          );
          return { address, count: orders.length, orders, nextCursor: r.nextCursor ?? null, note: "amount / dstAmount are base units; *Human fields are converted when the token is known." };
        } catch (e) {
          if (e instanceof EndpointUnavailableError) {
            return { address, orders: [], available: false, summary: "Order history is not available on this LayerHop API yet." };
          }
          throw e;
        }
      }),
  );

  server.registerTool(
    "get_swap_link",
    {
      title: "Get a layerhop.com swap link",
      description: `Create a https://layerhop.com/swap link prefilled with the swap, which the user opens to review the live quote and fees and sign in their own wallet. This is the default, safest way to execute a swap. ${NO_KEYS} The amount is in human units.`,
      inputSchema: {
        fromChain: chainSchema("Source"),
        fromToken: tokenSchema("Token to send (source)"),
        toChain: chainSchema("Destination"),
        toToken: tokenSchema("Token to receive (destination)"),
        amount: amountSchema.optional(),
        recipient: z.string().optional().describe("Optional destination address to prefill (the user can still edit it)."),
        slippageBps: slippageSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (a) =>
      run(async () => {
        const [src, dst] = await Promise.all([resolveChain(a.fromChain), resolveChain(a.toChain)]);
        let amount: string | undefined;
        const srcToken = await client.token(src.id, a.fromToken);
        if (a.amount !== undefined) {
          // Validate (>0, decimal format). Use token decimals when known, else a generous 36.
          amount = fromBaseUnits(toBaseUnits(a.amount, srcToken?.decimals ?? 36), srcToken?.decimals ?? 36);
        }
        const recipient = a.recipient?.trim() || undefined;
        if (recipient) assertAddress(dst.vm, recipient, "recipient", dst.name);
        const url = buildSwapLink(
          {
            fromChain: src.slug,
            fromToken: a.fromToken.trim(),
            toChain: dst.slug,
            toToken: a.toToken.trim(),
            amount,
            recipient,
            slippageBps: a.slippageBps,
            integrator: config.integrator,
          },
          config.appUrl,
        );
        return {
          url,
          summary: `Open ${url} to review the live quote and fees and sign with your own wallet.`,
        };
      }),
  );

  // ---------- deposit addresses (API key required) ----------
  const requireKey = () => {
    if (client.keyMode === "none") throw new UserInputError(DEPOSIT_KEY_MISSING);
  };
  /** Like resolveToken, but lets an unlisted (valid) address through without decimals. */
  const resolveTokenLoose = async (chain: Chain, input: string, decimals?: number): Promise<{ address: string; symbol: string; decimals?: number }> => {
    try {
      return await resolveToken(chain, input, decimals);
    } catch (e) {
      if (e instanceof UserInputError && isValidAddress(chain.vm, input.trim())) return { address: input.trim(), symbol: input.trim() };
      throw e;
    }
  };
  const tokenLookup = async (chainIds: number[]): Promise<TokenLookup> => {
    const ids = [...new Set(chainIds)];
    const lists = new Map(await Promise.all(ids.map(async (id) => [id, await client.tokens(id)] as const)));
    return (chainId, address) => {
      const t = lists.get(chainId)?.find((x) => x.address.toLowerCase() === address.toLowerCase());
      return t ? { symbol: t.symbol, address: t.address, decimals: t.decimals } : undefined;
    };
  };
  const describeDeposit = async (da: DepositAddressLike) => {
    const [chains, lookup] = await Promise.all([client.chains(), tokenLookup([da.chainId, da.dstChainId])]);
    const name = chainNameById(chains);
    return { name, lookup, view: formatDepositAddress(da, name, lookup), tellTheUser: depositRules(da, name, lookup) };
  };
  const depositIdSchema = z.string().regex(/^da_/, "deposit address ids start with da_").describe('Deposit address id (starts with "da_").');

  server.registerTool(
    "create_deposit_address",
    {
      title: "Create a deposit address",
      description: `Create an address the user sends tokens to; every deposit is swapped/bridged and delivered as toToken on toChain to recipient. No wallet connection or signing needed. Non-custodial: the address belongs to the liquidity provider (Relay), LayerHop never holds funds. ${DEPOSIT_WARNING} ${NO_KEYS}`,
      inputSchema: {
        fromChain: chainSchema("Source (deposit)"),
        fromToken: tokenSchema("The ONLY token the user may send to the address (source)"),
        toChain: chainSchema("Destination"),
        toToken: tokenSchema("Token to deliver (destination)"),
        recipient: z.string().min(1).describe("Address that receives toToken on toChain."),
        refundTo: z
          .string()
          .min(1)
          .describe("The user's OWN address on fromChain for refunds. NEVER an exchange (CEX) deposit address: refunds never go back to an exchange."),
        reusable: z.boolean().optional().describe("true (default): reusable for this route with any amount. false: one-time address for exactly `amount`."),
        amount: amountSchema
          .optional()
          .describe('HUMAN units of fromToken ("25" = 25 USDC). Required when reusable is false (the exact amount to send); otherwise only sizes the estimate. Minimum worth $1.'),
        fromTokenDecimals: decimalsSchema("fromToken"),
        label: z.string().min(1).max(64).optional().describe("Your reference for this address (1-64 chars), filterable in list_deposit_addresses."),
        metadata: z.record(z.string()).optional().describe("Up to 20 string key-value pairs stored on the address."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        requireKey();
        const [src, dst] = await Promise.all([resolveChain(a.fromChain), resolveChain(a.toChain)]);
        const [srcToken, dstToken] = await Promise.all([resolveTokenLoose(src, a.fromToken, a.fromTokenDecimals), resolveTokenLoose(dst, a.toToken)]);
        const recipient = a.recipient.trim();
        const refundTo = a.refundTo.trim();
        assertAddress(dst.vm, recipient, "recipient", dst.name);
        assertAddress(src.vm, refundTo, "refundTo", src.name);
        if (a.reusable === false && a.amount === undefined) throw new UserInputError("amount is required for a one-time address (reusable: false).");
        if (a.metadata && Object.keys(a.metadata).length > 20) throw new UserInputError("metadata takes at most 20 keys.");
        let amount: string | undefined;
        if (a.amount !== undefined) {
          if (srcToken.decimals === undefined) {
            throw new UserInputError(`Token ${srcToken.address} is not in LayerHop's token list for ${src.name}, so its decimals are unknown. Pass fromTokenDecimals.`);
          }
          amount = toBaseUnits(a.amount, srcToken.decimals);
        }
        const created = await client.createDepositAddress({
          srcChain: src.id,
          srcToken: srcToken.address,
          dstChain: dst.id,
          dstToken: dstToken.address,
          recipient,
          refundTo,
          ...(a.reusable !== undefined ? { reusable: a.reusable } : {}),
          ...(amount ? { amount } : {}),
          ...(a.label ? { label: a.label } : {}),
          ...(a.metadata ? { metadata: a.metadata } : {}),
        });
        const d = await describeDeposit(created);
        return {
          summary: `${created.livemode ? "" : "TEST MODE (fake address, never send real funds): "}send ${d.view.send.token} on ${d.view.send.chain} to ${created.address}; it is delivered as ${d.view.deliver.token} on ${d.view.deliver.chain} to ${created.recipient}.`,
          depositAddress: d.view,
          estimate: formatDepositEstimate(created.estimate, created, d.lookup),
          tellTheUser: d.tellTheUser,
          nextSteps: [
            "Show the user the address with the token, chain and every rule in tellTheUser (a QR code helps).",
            "When the user says they sent funds, call refresh_deposit_address, then get_deposit_address to see the deposit and its status.",
            ...(created.livemode ? [] : ["Test mode: call simulate_deposit to record a fake deposit."]),
          ],
        };
      }),
  );

  server.registerTool(
    "list_deposit_addresses",
    {
      title: "List deposit addresses",
      description:
        "List the deposit addresses of the API key's account and mode (live or test), newest first: address, route, status, deposit count. Needs a LayerHop API key. Read-only.",
      inputSchema: {
        status: z.enum(["active", "disabled"]).optional().describe("Only addresses with this status."),
        label: z.string().min(1).max(64).optional().describe("Only addresses with this label."),
        limit: z.number().int().min(1).max(100).optional().describe("Max addresses to return (default set by the API)."),
        cursor: z.string().optional().describe("nextCursor from a previous call, for the next page."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        requireKey();
        const r = await client.listDepositAddresses({ status: a.status, label: a.label, limit: a.limit, cursor: a.cursor });
        const [chains, lookup] = await Promise.all([client.chains(), tokenLookup(r.depositAddresses.flatMap((d) => [d.chainId, d.dstChainId]))]);
        const name = chainNameById(chains);
        return {
          count: r.depositAddresses.length,
          depositAddresses: r.depositAddresses.map((d) => formatDepositAddress(d, name, lookup)),
          nextCursor: r.nextCursor ?? null,
        };
      }),
  );

  server.registerTool(
    "get_deposit_address",
    {
      title: "Get a deposit address and its deposits",
      description: `Get one deposit address with its 20 most recent deposits (orders, quoteId starting with dep_): amount deposited and delivered, status (submitted, pending, filled, refunded, failed) and tx hashes. ${DEPOSIT_WARNING} Read-only.`,
      inputSchema: { id: depositIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) =>
      run(async () => {
        requireKey();
        const r = await client.getDepositAddress(id);
        const d = await describeDeposit(r);
        const deposits = (r.deposits ?? []).map((o) => formatDepositOrder(o, d.lookup));
        return {
          depositAddress: d.view,
          deposits,
          tellTheUser: d.tellTheUser,
          note: deposits.length
            ? "Deposits are newest first. Each deposit is an order; status filled means the tokens were delivered to recipient."
            : "No deposits detected yet. If the user just sent funds, call refresh_deposit_address and check again in ~15-30 s.",
        };
      }),
  );

  server.registerTool(
    "refresh_deposit_address",
    {
      title: "Check a deposit address for deposits now",
      description:
        "Ask LayerHop to check a deposit address for new deposits right away (instead of waiting for the next scheduled check). Call it when the user says they sent funds, then call get_deposit_address after ~15-30 s. Needs a LayerHop API key.",
      inputSchema: { id: depositIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ id }) =>
      run(async () => {
        requireKey();
        const r = await client.refreshDepositAddress(id);
        const d = await describeDeposit(r);
        return { depositAddress: d.view, summary: `Checking ${r.address} for deposits now. Call get_deposit_address in ~15-30 s to see new deposits.` };
      }),
  );

  server.registerTool(
    "disable_deposit_address",
    {
      title: "Disable a deposit address",
      description:
        "Disable a deposit address: LayerHop stops tracking it (no more orders or webhooks for it). The provider may still process funds sent to it later, so the user must stop using it. Cannot be undone. Confirm with the user first. Needs a LayerHop API key.",
      inputSchema: { id: depositIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ id }) =>
      run(async () => {
        requireKey();
        const r = await client.disableDepositAddress(id);
        const d = await describeDeposit(r);
        return {
          depositAddress: d.view,
          summary: `Disabled ${r.address}. Tell the user to stop sending funds to it: deposits sent to it from now on are not tracked.`,
        };
      }),
  );

  server.registerTool(
    "simulate_deposit",
    {
      title: "Simulate a deposit (test mode only)",
      description:
        "TEST MODE ONLY (lh_test_ key and a test deposit address): record a fake deposit so the integration can be tested end to end; it becomes a test order that settles with webhooks. The amount decides the outcome: base units ending in 4001 -> refunded, 4002 -> failed, anything else -> filled. Moves no real funds. Fails with a live key.",
      inputSchema: {
        id: depositIdSchema,
        amount: amountSchema.optional().describe('Deposit amount in HUMAN units of the address token ("25" = 25 USDC). Give this or amountBaseUnits.'),
        amountBaseUnits: z.string().regex(/^\d+$/, "integer string").optional().describe('Deposit amount in base units (e.g. "25004001" to test a refund for a 6-decimal token). Give this or amount.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        requireKey();
        if (client.keyMode === "live") {
          throw new UserInputError("simulate_deposit only works with a test key (lh_test_...). With a live key, deposits are real: send funds only to a live address.");
        }
        if ((a.amount === undefined) === (a.amountBaseUnits === undefined)) throw new UserInputError("Give exactly one of amount (human units) or amountBaseUnits.");
        const da = await client.getDepositAddress(a.id);
        if (da.livemode) throw new UserInputError("simulate_deposit only works on test-mode deposit addresses.");
        const lookup = await tokenLookup([da.chainId, da.dstChainId]);
        let base = a.amountBaseUnits;
        if (base === undefined) {
          const t = lookup(da.chainId, da.token);
          if (!t) throw new UserInputError(`The address token ${da.token} is not in LayerHop's token list, so its decimals are unknown. Pass amountBaseUnits instead.`);
          base = toBaseUnits(a.amount!, t.decimals);
        }
        if (BigInt(base) <= 0n) throw new UserInputError("Amount must be greater than 0.");
        const order = await client.simulateDeposit(a.id, base);
        const outcome = base.endsWith("4001") ? "refunded" : base.endsWith("4002") ? "failed" : "filled";
        return {
          order: formatDepositOrder(order, lookup),
          summary: `Recorded a test deposit (order ${order.quoteId}, status ${order.status}). The sandbox will settle it as ${outcome}; check with get_deposit_address.`,
        };
      }),
  );

  // ---------- resources ----------
  server.registerResource(
    "chains",
    "layerhop://chains",
    { title: "LayerHop chains", description: "Every chain LayerHop supports (JSON).", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ chains: await client.chains() }, null, 2) }] }),
  );

  server.registerResource(
    "tokens",
    new ResourceTemplate("layerhop://tokens/{chain}", {
      list: async () => ({
        resources: (await client.chains()).map((c) => ({ uri: `layerhop://tokens/${c.slug}`, name: `${c.name} tokens`, mimeType: "application/json" })),
      }),
      complete: { chain: async (v) => (await client.chains()).map((c) => c.slug).filter((s) => s.startsWith(v.toLowerCase())) },
    }),
    { title: "LayerHop tokens per chain", description: "Built-in token list for one chain (JSON): symbol, address/mint, decimals.", mimeType: "application/json" },
    async (uri, vars) => {
      const raw = Array.isArray(vars.chain) ? vars.chain[0] : vars.chain;
      const chain = await client.chain(decodeURIComponent(String(raw ?? "")));
      if (!chain) throw new Error(`Unknown chain "${raw}".`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ chain: chain.slug, chainId: chain.id, tokens: await client.tokens(chain.id) }, null, 2) }] };
    },
  );

  const llmsUrl = `${config.docsUrl}/llms.txt`;
  server.registerResource(
    "docs-llms-txt",
    llmsUrl,
    { title: "LayerHop docs (llms.txt)", description: "Index of the LayerHop developer docs for LLMs. Full text: llms-full.txt on the same site.", mimeType: "text/plain" },
    async (uri) => {
      let text: string;
      try {
        text = await client.text(llmsUrl);
      } catch {
        text = `LayerHop docs: ${config.docsUrl}\nIndex for LLMs: ${llmsUrl}\nFull docs as Markdown: ${config.docsUrl}/llms-full.txt\n`;
      }
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  // ---------- prompt ----------
  server.registerPrompt(
    "swap_assistant",
    {
      title: "Safe swap assistant",
      description: "Guide the user through a cross-chain or same-chain swap safely: quote, show every fee, confirm, then hand off a swap link to sign in their own wallet.",
      argsSchema: {
        request: z.string().optional().describe('What the user wants, e.g. "swap 100 USDC on Base to SOL on Solana".'),
      },
    },
    ({ request }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: swapAssistantPrompt(request),
          },
        },
      ],
    }),
  );

  return server;
}

export function swapAssistantPrompt(request?: string): string {
  return `You are helping the user swap or bridge tokens with LayerHop (tools from the "layerhop" MCP server).

Rules:
1. Never ask for, accept or handle private keys, seed phrases or wallet passwords. The LayerHop server holds no keys and never signs; neither do you.
2. Collect: source chain + token, amount (human units, e.g. "100"), destination chain + token, the sender address, and the recipient address if the destination chain uses a different address type (EVM 0x... vs Solana base58). Use list_chains / list_tokens when unsure. Never guess an address.
3. Call get_quote. Show the user, clearly: amount sent, expected amount received, minimum received after slippage, the LayerHop fee (and partner fee if any) in % and in tokens, provider/gas fees in USD when present, the ETA, the provider, and when the quote expires. Mention alternatives if they are close.
4. Ask the user to explicitly confirm before doing anything else. If they hesitate or anything looks off (large price impact, unknown token address, recipient differs from what they said), stop and say so.
5. Default execution: give the user the swapLink (or call get_swap_link) so they review the live quote and sign in their own wallet on layerhop.com.
6. Only if the user has their own signer and asks for raw transaction data: build_transaction (optionally simulate_transaction first), explain each step (approval first, then the swap), let THEIR wallet sign and broadcast, then call report_submitted and track with get_order_status.
7. Quotes expire quickly. If expired, get a fresh quote and show the numbers again.
${request ? `\nThe user's request: ${request}` : ""}`;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
