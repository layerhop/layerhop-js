import { LayerHopApiError } from "@layerhop/sdk";
import { findSettlementToken, type ProviderId } from "@layerhop/shared";
import type { z } from "zod/v4";
import { assertAddress, isTxHash } from "./core/address.js";
import { AmountError, fromBaseUnits, toBaseUnits } from "./core/amounts.js";
import { EndpointUnavailableError, LayerHopClient } from "./core/client.js";
import { depositRules, formatBuiltTx, formatDepositAddress, formatDepositEstimate, formatDepositOrder, formatQuoteResponse, type DepositAddressLike, type FormatOptions } from "./core/format.js";
import { buildSwapLink, DEFAULT_APP_URL } from "./core/links.js";
import { createResolvers, QuoteCache, UserInputError } from "./core/resolve.js";
import { API_KEY_MISSING, DEPOSIT_WARNING, NO_KEYS } from "./core/safety.js";
import { SandboxTxError, toTransactionRequests } from "./core/txs.js";
import { TOOL_NAMES, zodV4Schemas, type ToolName, type ToolSchemas } from "./schemas.js";

export const VERSION = "0.7.0";
const DEFAULT_API_URL = "https://api.layerhop.com";
const INTEGRATOR_RE = /^[a-z0-9-]{1,32}$/;

export interface LayerHopToolsOptions {
  /** LayerHop API base URL. Default https://api.layerhop.com. */
  apiUrl?: string;
  /** API key (`lh_live_…` / `lh_test_…`). Optional; required by deposit addresses and checkout. Never sent to the model. */
  apiKey?: string;
  /** Your partner id (`[a-z0-9-]{1,32}`): every quote carries it so you earn your partner fee. */
  integrator?: string;
  /** Partner fee override in bps (honored only with your partner API key, within your maxFeeBps). */
  integratorFeeBps?: number;
  /** Web app for swap links. Default https://layerhop.com. */
  appUrl?: string;
  /** Custom fetch (tests, proxies, edge runtimes). */
  fetch?: typeof fetch;
  /** Only expose these tools (default: all). */
  tools?: readonly ToolName[];
  /** Maps base tool names to the names the agent sees, e.g. (n) => `layerhop_${n}`. Default: unchanged. */
  toolName?: (base: ToolName) => string;
  /** Sent as user-agent to the API (server runtimes only). */
  userAgent?: string;
  /** Reuse an existing client (and its caches). */
  client?: LayerHopClient;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type ToolResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** One framework-agnostic LayerHop tool. Adapters wrap `schema` + `run` in their framework's tool type. */
export interface LayerHopTool<K extends ToolName = ToolName> {
  /** The name the agent sees (after `toolName`). */
  name: string;
  /** The base name ("get_quote"). */
  baseName: K;
  title: string;
  description: string;
  /** zod v4 object schema of the input. */
  schema: ToolSchemas[K];
  annotations: ToolAnnotations;
  /** Validated execution. Throws on bad input or API errors (use `run` for a never-throwing variant). */
  execute(input: z.input<ToolSchemas[K]>): Promise<Record<string, unknown>>;
  /** Validates `input` with `schema`, executes, and maps every error to a message the model can act on. */
  run(input: unknown): Promise<ToolResult<Record<string, unknown>>>;
}

export interface LayerHopToolset {
  tools: LayerHopTool[];
  /** Lookup by base name. */
  byName: { [K in ToolName]?: LayerHopTool<K> };
  client: LayerHopClient;
  /** Quotes returned by get_quote (request context per quoteId), used by the swap executors. */
  quotes: QuoteCache;
  /** The tool name mapper in effect. */
  toolName: (base: string) => string;
  /** Run a tool by the name the agent used (handles `toolName` mapping); unknown names give an error result. */
  call(name: string, input: unknown): Promise<ToolResult<Record<string, unknown>>>;
}

/** Turn any thrown error into the text the model sees (same wording as the MCP server). */
export function errorMessage(e: unknown): string {
  if (e instanceof LayerHopApiError) {
    return `LayerHop API error ${e.code} (HTTP ${e.status}): ${e.message}${e.requestId ? ` [requestId ${e.requestId}]` : ""}. See https://docs.layerhop.com/errors/${e.code}`;
  }
  if (e instanceof EndpointUnavailableError || e instanceof AmountError || e instanceof UserInputError || e instanceof SandboxTxError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

function formatZodError(name: string, err: z.ZodError): string {
  const issues = err.issues.map((i) => `${i.path.length ? i.path.join(".") : "input"}: ${i.message}`).join("; ");
  return `Invalid input for ${name}: ${issues}`;
}

type Exec = { [K in ToolName]: (a: z.output<ToolSchemas[K]>) => Promise<Record<string, unknown>> };
type Meta = { [K in ToolName]: { title: string; description: string; annotations: ToolAnnotations } };

const RO: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

/** Create the LayerHop tools: framework-agnostic definitions shared by every adapter. */
export function createLayerHopTools(opts: LayerHopToolsOptions = {}): LayerHopToolset {
  if (opts.integrator !== undefined && !INTEGRATOR_RE.test(opts.integrator)) {
    throw new Error(`Invalid integrator "${opts.integrator}": use 1-32 characters a-z, 0-9 or "-".`);
  }
  if (opts.integratorFeeBps !== undefined && (!Number.isInteger(opts.integratorFeeBps) || opts.integratorFeeBps < 0 || opts.integratorFeeBps > 10_000)) {
    throw new Error(`Invalid integratorFeeBps ${opts.integratorFeeBps}: an integer number of basis points.`);
  }
  const apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
  const appUrl = (opts.appUrl ?? DEFAULT_APP_URL).replace(/\/$/, "");
  const client =
    opts.client ??
    new LayerHopClient({
      apiUrl,
      apiKey: opts.apiKey,
      integrator: opts.integrator,
      integratorFeeBps: opts.integratorFeeBps,
      fetch: opts.fetch,
      userAgent: opts.userAgent,
    });
  const t = (n: string) => (opts.toolName ? opts.toolName(n as ToolName) : n);
  const fmt: FormatOptions = { holder: "LayerHop", toolName: t };
  const schemas = zodV4Schemas(t);
  const quotes = new QuoteCache();
  const r = createResolvers(client);

  const requireKey = () => {
    if (client.keyMode === "none") throw new UserInputError(API_KEY_MISSING);
  };
  const describeDeposit = async (da: DepositAddressLike) => {
    const [chains, lookup] = await Promise.all([client.chains(), r.tokenLookup([da.chainId, da.dstChainId])]);
    const name = r.chainNameById(chains);
    return { lookup, view: formatDepositAddress(da, name, lookup) };
  };

  const meta: Meta = {
    list_chains: {
      title: "List supported chains",
      description: "List every blockchain LayerHop can swap from or to: slug, numeric chain id, name, VM type (evm or svm = Solana) and native coin. Read-only.",
      annotations: RO,
    },
    list_tokens: {
      title: "Look up tokens on a chain",
      description: `List LayerHop's built-in tokens on one chain (symbol, contract address or mint, decimals), or search all known tokens on it with query (adds name, USD price, verified flag). Symbols and addresses can be used in ${t("get_quote")}. Read-only.`,
      annotations: RO,
    },
    get_prices: {
      title: "Get token prices in USD",
      description: "Current USD price of up to 25 tokens (by chain + symbol or address). Unknown tokens come back with priceUsd null. Read-only.",
      annotations: RO,
    },
    get_quote: {
      title: "Get swap/bridge quotes",
      description: `Get the best price to swap or bridge tokens, within one chain or across chains (EVM <-> Solana). Asks every liquidity provider and returns the best quote plus alternatives with human-readable amounts, minimum received after slippage, fees (LayerHop fee, partner fee, provider fee, gas) and ETA. Returns a quoteId (valid until expiresAt) and a layerhop.com swapLink a human can open to review and sign. Read-only: ${NO_KEYS} Always show the user the fees and output and get confirmation before proceeding.`,
      annotations: RO,
    },
    build_transaction: {
      title: "Build the unsigned transaction for a quote",
      description: `Turn a quoteId from ${t("get_quote")} into the UNSIGNED transaction the user's own wallet must sign: EVM {chainId, to, data, value in wei, optional ERC-20 approval to send first} or Solana {serializedTx base64}, plus transactionRequests (the ordered list to hand to the host's signer) and plain-language signing steps. ${NO_KEYS} Only use this after the user confirmed the quote and when the user or app has its own signer; otherwise give them the swap link.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    simulate_transaction: {
      title: "Dry-run a quote's transaction",
      description: `Build the transaction for a quoteId and dry-run it on-chain (EVM eth_call + gas estimate from the sender; Solana simulateTransaction) without sending anything or recording an order. Reports whether it would succeed, gas / compute units, whether an ERC-20 approval is still needed, and the error if it would fail. Read-only: ${NO_KEYS}`,
      annotations: RO,
    },
    report_submitted: {
      title: "Report a broadcast transaction",
      description: `Tell LayerHop that the user's wallet broadcast the transaction for a quoteId, so the order is tracked (status, webhooks, partner earnings). Call this once after broadcasting, with the EVM tx hash (0x + 64 hex) or Solana signature. Idempotent. Does not sign or send anything.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    get_order_status: {
      title: "Get swap/bridge order status",
      description:
        "Check the status of a swap or bridge after the source transaction was sent: pending, filled (funds delivered), refunded, failed, or unknown (some same-chain providers; check the tx on an explorer). Read-only.",
      annotations: RO,
    },
    get_swap_link: {
      title: "Get a layerhop.com swap link",
      description: `Create a https://layerhop.com/swap link prefilled with the swap, which the user opens to review the live quote and fees and sign in their own wallet. This is the default, safest way to execute a swap. ${NO_KEYS} The amount is in human units.`,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    create_deposit_address: {
      title: "Create a deposit address",
      description: `Create an address the user sends tokens to; every deposit is swapped/bridged and delivered as toToken on toChain to recipient. No wallet connection or signing needed. Non-custodial: the address belongs to the liquidity provider (Relay), LayerHop never holds funds. ${DEPOSIT_WARNING} ${NO_KEYS}`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    get_deposit_address: {
      title: "Get a deposit address and its deposits",
      description: `Get one deposit address with its 20 most recent deposits: amount deposited and delivered, status (submitted, pending, filled, refunded, failed) and tx hashes. ${DEPOSIT_WARNING} Read-only.`,
      annotations: RO,
    },
    create_checkout_session: {
      title: "Create a checkout session (accept a payment)",
      description: `Create a hosted LayerHop checkout page where a payer pays an amount with any token on any supported chain; the merchant receives USDC or USDT on settleChain at recipient. Returns the checkout url to send the payer to. Needs a LayerHop API key. Non-custodial. ${NO_KEYS}`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
  };

  const exec: Exec = {
    list_chains: async () => {
      const chains = await client.chains();
      return {
        chains: chains.map((c) => ({ slug: c.slug, id: c.id, name: c.name, vm: c.vm, nativeSymbol: c.nativeSymbol, nativeDecimals: c.nativeDecimals })),
        note: "Use the slug or id as fromChain/toChain. vm 'evm' takes 0x addresses, 'svm' (Solana) takes base58 addresses.",
      };
    },

    list_tokens: async (a) => {
      const c = await r.resolveChain(a.chain);
      if (a.query) {
        const res = await client.searchTokens(c.id, a.query, a.limit ?? 20);
        return {
          chain: c.slug,
          chainId: c.id,
          query: a.query,
          tokens: res.tokens.map((x) => ({ symbol: x.symbol, name: x.name, address: x.address, decimals: x.decimals, priceUsd: x.priceUsd ?? null, verified: x.verified })),
          note: "verified false means the token is on no curated list: double-check the address with the user before swapping.",
        };
      }
      const tokens = await client.tokens(c.id);
      return { chain: c.slug, chainId: c.id, tokens: tokens.map((x) => ({ symbol: x.symbol, address: x.address, decimals: x.decimals })) };
    },

    get_prices: async (a) => {
      const items = await Promise.all(
        a.tokens.map(async (x) => {
          const c = await r.resolveChain(x.chain);
          const tok = await r.resolveTokenLoose(c, x.token);
          return { chain: c.slug, chainId: c.id, symbol: tok.symbol, address: tok.address, id: `${c.id}:${tok.address}` };
        }),
      );
      const prices = await client.prices(items.map((i) => i.id));
      return {
        prices: items.map(({ id, ...i }) => ({ ...i, priceUsd: prices[id] ?? null })),
        note: "USD prices are indicative; quotes are the source of truth for swap amounts.",
      };
    },

    get_quote: async (a) => {
      const [src, dst] = await Promise.all([r.resolveChain(a.fromChain), r.resolveChain(a.toChain)]);
      const [srcToken, dstToken] = await Promise.all([r.resolveToken(src, a.fromToken, a.fromTokenDecimals), r.resolveToken(dst, a.toToken, a.toTokenDecimals)]);
      const sender = a.sender.trim();
      assertAddress(src.vm, sender, "sender", src.name);
      let recipient = a.recipient?.trim();
      if (!recipient) {
        if (src.vm !== dst.vm) {
          throw new UserInputError(`recipient is required: ${dst.name} uses a different address format than ${src.name}. Ask the user for their ${dst.name} address.`);
        }
        recipient = sender;
      }
      assertAddress(dst.vm, recipient, "recipient", dst.name);
      const amountBaseUnits = toBaseUnits(a.amount, srcToken.decimals);
      const amount = fromBaseUnits(amountBaseUnits, srcToken.decimals);
      const slippageBps = a.slippageBps ?? 50;
      const res = await client.quote({ srcChain: src.id, srcToken: srcToken.address, amount: amountBaseUnits, dstChain: dst.id, dstToken: dstToken.address, sender, recipient, slippageBps });
      const base = { srcChain: src, dstChain: dst, srcToken, dstToken, amount, amountBaseUnits, sender, recipient, slippageBps };
      for (const q of res.quotes.length ? res.quotes : [res.best]) quotes.set({ ...base, quoteId: q.quoteId, provider: q.provider, expiresAt: q.expiresAt });
      const link = buildSwapLink(
        {
          fromChain: src.slug,
          fromToken: srcToken.symbol === srcToken.address ? srcToken.address : srcToken.symbol,
          toChain: dst.slug,
          toToken: dstToken.symbol === dstToken.address ? dstToken.address : dstToken.symbol,
          amount,
          recipient: a.recipient?.trim() || undefined,
          slippageBps: a.slippageBps,
          integrator: opts.integrator,
          ref: "agent",
        },
        appUrl,
      );
      return formatQuoteResponse(res, base, link, fmt);
    },

    build_transaction: async ({ quoteId }) => {
      const [built, chains] = await Promise.all([client.buildOrder(quoteId), client.chains()]);
      const out = formatBuiltTx(built.tx, built.provider, quoteId, quotes.get(quoteId), r.chainNameById(chains), apiUrl, fmt);
      return {
        ...out,
        ...(built.tx.sandbox ? { sandbox: true, warning: "TEST MODE: placeholder transaction that moves no funds. Never broadcast it." } : {}),
        transactionRequests: toTransactionRequests(built.tx),
      };
    },

    simulate_transaction: async ({ quoteId }) => {
      try {
        const s = await client.simulate(quoteId);
        const { tx: _tx, ...rest } = s;
        return {
          ...rest,
          summary: s.ok
            ? `Simulation succeeded${s.gasEstimate !== undefined ? `, estimated gas ${s.gasEstimate}` : ""}${s.computeUnits !== undefined ? `, ${s.computeUnits} compute units` : ""}${s.needsApproval ? ". An ERC-20 approval is still needed before the swap (only the approval was simulated)." : "."}`
            : `Simulation failed: ${s.error?.code ?? "UNKNOWN"} ${s.error?.message ?? ""}`.trim(),
        };
      } catch (e) {
        if (e instanceof EndpointUnavailableError) {
          return { ok: null, available: false, summary: `Simulation is not available on this LayerHop API yet. Let the user's wallet simulate the transaction from ${t("build_transaction")}, or use the swap link.` };
        }
        throw e;
      }
    },

    report_submitted: async ({ quoteId, txHash }) => {
      const h = txHash.trim();
      if (!isTxHash(h)) throw new UserInputError(`"${txHash}" is not a valid EVM tx hash (0x + 64 hex) or Solana signature.`);
      try {
        const res = await client.reportSubmitted(quoteId, h);
        const provider = quotes.get(quoteId)?.provider;
        return { ...res, next: provider ? `Track it with ${t("get_order_status")} { provider: "${provider}", txHash: "${h}" }.` : `Track it with ${t("get_order_status")}.` };
      } catch (e) {
        if (e instanceof EndpointUnavailableError) {
          return { quoteId, reported: false, summary: `This LayerHop API does not accept submission reports yet; tracking still works with ${t("get_order_status")}.` };
        }
        throw e;
      }
    },

    get_order_status: async ({ provider, txHash }) => {
      const s = await client.status(provider as ProviderId, txHash.trim());
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
    },

    get_swap_link: async (a) => {
      const [src, dst] = await Promise.all([r.resolveChain(a.fromChain), r.resolveChain(a.toChain)]);
      const srcToken = await client.token(src.id, a.fromToken);
      const amount = a.amount !== undefined ? fromBaseUnits(toBaseUnits(a.amount, srcToken?.decimals ?? 36), srcToken?.decimals ?? 36) : undefined;
      const recipient = a.recipient?.trim() || undefined;
      if (recipient) assertAddress(dst.vm, recipient, "recipient", dst.name);
      const url = buildSwapLink(
        { fromChain: src.slug, fromToken: a.fromToken.trim(), toChain: dst.slug, toToken: a.toToken.trim(), amount, recipient, slippageBps: a.slippageBps, integrator: opts.integrator, ref: "agent" },
        appUrl,
      );
      return { url, summary: `Open ${url} to review the live quote and fees and sign with your own wallet.` };
    },

    create_deposit_address: async (a) => {
      requireKey();
      const [src, dst] = await Promise.all([r.resolveChain(a.fromChain), r.resolveChain(a.toChain)]);
      const [srcToken, dstToken] = await Promise.all([r.resolveTokenLoose(src, a.fromToken, a.fromTokenDecimals), r.resolveTokenLoose(dst, a.toToken)]);
      const recipient = a.recipient.trim();
      const refundTo = a.refundTo.trim();
      assertAddress(dst.vm, recipient, "recipient", dst.name);
      assertAddress(src.vm, refundTo, "refundTo", src.name);
      if (a.reusable === false && a.amount === undefined) throw new UserInputError("amount is required for a one-time address (reusable: false).");
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
      });
      const [chains, d] = await Promise.all([client.chains(), describeDeposit(created)]);
      return {
        summary: `${created.livemode ? "" : "TEST MODE (fake address, never send real funds): "}send ${d.view.send.token} on ${d.view.send.chain} to ${created.address}; it is delivered as ${d.view.deliver.token} on ${d.view.deliver.chain} to ${created.recipient}.`,
        depositAddress: d.view,
        estimate: formatDepositEstimate(created.estimate, created, d.lookup),
        tellTheUser: depositRules(created, r.chainNameById(chains), d.lookup),
        nextSteps: [
          "Show the user the address with the token, chain and every rule in tellTheUser (a QR code helps).",
          `When the user says they sent funds, call ${t("get_deposit_address")} after ~15-30 s to see the deposit and its status.`,
        ],
      };
    },

    get_deposit_address: async ({ id }) => {
      requireKey();
      const res = await client.getDepositAddress(id);
      const [chains, d] = await Promise.all([client.chains(), describeDeposit(res)]);
      const deposits = (res.deposits ?? []).map((o) => formatDepositOrder(o, d.lookup));
      return {
        depositAddress: d.view,
        deposits,
        tellTheUser: depositRules(res, r.chainNameById(chains), d.lookup),
        note: deposits.length
          ? "Deposits are newest first. Each deposit is an order; status filled means the tokens were delivered to recipient."
          : "No deposits detected yet. If the user just sent funds, check again in ~15-30 s.",
      };
    },

    create_checkout_session: async (a) => {
      requireKey();
      const chain = await r.resolveChain(a.settleChain);
      const settle = findSettlementToken(chain.id, a.settleToken);
      if (!settle) throw new UserInputError(`${a.settleToken} on ${chain.name} cannot settle checkouts. Use USDC or USDT on ethereum, arbitrum, base, optimism, bsc, polygon or solana.`);
      const recipient = a.recipient.trim();
      assertAddress(chain.vm, recipient, "recipient", chain.name);
      const amountBaseUnits = toBaseUnits(a.amount, settle.decimals);
      const s = await client.createCheckout({
        amount: amountBaseUnits,
        settleChain: chain.id,
        settleToken: settle.address,
        recipient,
        ...(a.description ? { description: a.description } : {}),
        ...(a.merchantName ? { merchantName: a.merchantName } : {}),
        ...(a.reference ? { reference: a.reference } : {}),
        ...(a.successUrl ? { successUrl: a.successUrl } : {}),
        ...(a.cancelUrl ? { cancelUrl: a.cancelUrl } : {}),
        ...(a.expiresInMinutes ? { expiresInMinutes: a.expiresInMinutes } : {}),
      });
      return {
        id: s.id,
        url: s.url,
        status: s.status,
        mode: s.livemode ? "live" : "test",
        amount: `${fromBaseUnits(s.amount, s.settlement.decimals)} ${s.settlement.symbol}`,
        amountBaseUnits: s.amount,
        settlement: { chain: chain.name, chainId: chain.id, token: s.settlement.symbol, recipient: s.recipient },
        expiresAt: s.expiresAt,
        summary: `${s.livemode ? "" : "TEST MODE: "}send the payer to ${s.url} to pay ${fromBaseUnits(s.amount, s.settlement.decimals)} ${s.settlement.symbol} with any token; it expires at ${s.expiresAt}.`,
      };
    },
  };

  const selected = new Set<ToolName>(opts.tools ?? TOOL_NAMES);
  const make = <K extends ToolName>(k: K): LayerHopTool<K> => {
    const schema = schemas[k];
    const fn = exec[k] as (a: unknown) => Promise<Record<string, unknown>>;
    const execute = async (input: unknown) => {
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) throw new UserInputError(formatZodError(t(k), parsed.error));
      return fn(parsed.data);
    };
    return {
      name: t(k),
      baseName: k,
      ...meta[k],
      schema,
      execute: execute as LayerHopTool<K>["execute"],
      run: async (input) => {
        try {
          return { ok: true, data: await execute(input) };
        } catch (e) {
          return { ok: false, error: errorMessage(e) };
        }
      },
    };
  };
  const tools = TOOL_NAMES.filter((k) => selected.has(k)).map((k) => make(k)) as LayerHopTool[];
  const byName = Object.fromEntries(tools.map((x) => [x.baseName, x])) as LayerHopToolset["byName"];
  const byAgentName = new Map(tools.map((x) => [x.name, x]));
  return {
    tools,
    byName,
    client,
    quotes,
    toolName: t,
    call: async (name, input) => {
      const tool = byAgentName.get(name);
      if (!tool) return { ok: false, error: `Unknown tool "${name}". Available: ${[...byAgentName.keys()].join(", ")}.` };
      return tool.run(input);
    },
  };
}
