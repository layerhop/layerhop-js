import type { Action, ActionExample, HandlerCallback, IAgentRuntime, Memory, Plugin, Provider, State } from "@elizaos/core";
import {
  AGENT_INSTRUCTIONS,
  createLayerHopTools,
  errorMessage,
  executeEvmSwap,
  executeSvmSwap,
  toJsonSchema,
  type EvmTxRequest,
  type LayerHopTool,
  type LayerHopToolsOptions,
  type LayerHopToolset,
  type ToolName,
} from "@layerhop/ai";

export const VERSION = "0.7.0";

/**
 * A signing service the agent's owner registers with the runtime (e.g. their wallet plugin) and names
 * in the LAYERHOP_SIGNER_SERVICE setting. LayerHop only hands it UNSIGNED transactions, and only
 * after the user explicitly confirmed in chat. LayerHop never holds or sees keys.
 */
export interface LayerHopSignerService {
  /** The address that signs on that VM (must be the quote's sender). */
  getAddress(vm: "evm" | "svm"): string | Promise<string>;
  /** EVM: sign and broadcast one transaction (switching to req.chainId as needed); returns the tx hash. */
  sendTransaction?(req: EvmTxRequest): Promise<string>;
  /** Solana: sign and broadcast a base64 VersionedTransaction; returns the signature. */
  signAndSendSolanaTransaction?(serializedTxBase64: string): Promise<string>;
  /** Solana sign-only (routes with submitViaApi); returns the signed tx as base64. */
  signSolanaTransaction?(serializedTxBase64: string): Promise<string>;
  /** Optional: current ERC-20 allowance, to skip approvals already in place. */
  getAllowance?(chainId: number, token: string, owner: string, spender: string): Promise<bigint>;
  /** Optional: wait until a tx is mined (after an approval). */
  waitForReceipt?(chainId: number, hash: string): Promise<unknown>;
}

export interface LayerHopPluginOptions extends Omit<LayerHopToolsOptions, "toolName" | "client" | "tools"> {
  /** Name of the runtime service that signs (overrides the LAYERHOP_SIGNER_SERVICE setting). Unset: never sign, hand out unsigned txs and links. */
  signerService?: string;
}

interface PendingSwap {
  quoteId: string;
  vm: "evm" | "svm";
  entityId: string;
  summary: string;
  createdAt: number;
}

const CONFIRM_RE = /^\s*(yes,?\s*)?(confirm|confirmed|i confirm|approve|go ahead|send it|sign it|do it)\b/i;
const CANCEL_RE = /^\s*(no\b|cancel|stop|abort|don'?t)/i;
const PENDING_TTL_MS = 5 * 60_000;

const setting = (rt: IAgentRuntime, key: string): string | undefined => {
  const v = rt.getSetting(key);
  return v === null || v === undefined || v === "" ? undefined : String(v);
};

function toolsetFor(rt: IAgentRuntime, opts: LayerHopPluginOptions, toolsets: WeakMap<IAgentRuntime, LayerHopToolset>): LayerHopToolset {
  let set = toolsets.get(rt);
  if (!set) {
    const fee = opts.integratorFeeBps ?? (setting(rt, "LAYERHOP_INTEGRATOR_FEE_BPS") ? Number(setting(rt, "LAYERHOP_INTEGRATOR_FEE_BPS")) : undefined);
    set = createLayerHopTools({
      ...opts,
      apiUrl: opts.apiUrl ?? setting(rt, "LAYERHOP_API_URL"),
      apiKey: opts.apiKey ?? setting(rt, "LAYERHOP_API_KEY"),
      integrator: opts.integrator ?? setting(rt, "LAYERHOP_INTEGRATOR"),
      integratorFeeBps: fee,
      appUrl: opts.appUrl ?? setting(rt, "LAYERHOP_APP_URL"),
      userAgent: opts.userAgent ?? `layerhop-elizaos/${VERSION}`,
    });
    toolsets.set(rt, set);
  }
  return set;
}

const pendingKey = (m: Memory) => `layerhop:pending:${m.roomId}:${m.entityId}`;
const lastQuoteKey = (m: Memory) => `layerhop:last-quote:${m.roomId}`;

function signerFor(rt: IAgentRuntime, opts: LayerHopPluginOptions): LayerHopSignerService | undefined {
  const name = opts.signerService ?? setting(rt, "LAYERHOP_SIGNER_SERVICE");
  if (!name) return undefined;
  const svc = rt.getService(name) as unknown as LayerHopSignerService | null;
  return svc && typeof svc.getAddress === "function" ? svc : undefined;
}

/**
 * Parameters for a tool: from `options.layerhop` / `message.content.layerhop` (programmatic use), else
 * extracted from the conversation by the runtime's OBJECT_SMALL model with the tool's JSON schema.
 */
async function paramsFor(rt: IAgentRuntime, message: Memory, state: State | undefined, options: unknown, tool: LayerHopTool, hint = ""): Promise<unknown> {
  const fromOptions = (options as { layerhop?: unknown } | undefined)?.layerhop;
  if (fromOptions && typeof fromOptions === "object") return fromOptions;
  const fromContent = (message.content as { layerhop?: unknown }).layerhop;
  if (fromContent && typeof fromContent === "object") return fromContent;
  const recent = typeof state?.text === "string" ? state.text.slice(-4000) : "";
  const prompt = `Extract the arguments for the "${tool.name}" tool from the conversation. ${tool.description}
Only use values the user actually gave (never invent addresses; leave unknown optional fields out). Amounts are HUMAN decimals ("100" = 100 USDC).${hint ? `\n${hint}` : ""}

Recent conversation:
${recent}

Latest message: ${message.content.text ?? ""}

Respond with a JSON object only.`;
  return rt.useModel("OBJECT_SMALL", { prompt, schema: toJsonSchema(tool) as never });
}

type Reply = { text: string; data?: Record<string, unknown>; success: boolean; error?: string };

async function respond(callback: HandlerCallback | undefined, action: string, r: Reply) {
  if (callback) await callback({ text: r.text, actions: [action], source: "layerhop" });
  return { text: r.text, success: r.success, ...(r.data ? { data: r.data } : {}), ...(r.error ? { error: r.error } : {}) };
}

const ex = (user: string, agent: string, action: string): ActionExample[] => [
  { name: "{{user1}}", content: { text: user } },
  { name: "{{agent}}", content: { text: agent, actions: [action] } },
];

const fmtFees = (best: any): string => {
  const f = best?.fees ?? {};
  const parts = [`LayerHop fee ${f.layerhop?.percent ?? "?"} (${f.layerhop?.amount ?? "?"})`];
  if (f.partner) parts.push(`partner fee ${f.partner.percent} (${f.partner.amount})`);
  if (f.providerUsd != null) parts.push(`provider ~$${f.providerUsd}`);
  if (f.networkGasUsd != null) parts.push(`gas ~$${f.networkGasUsd}`);
  return parts.join(", ");
};

/** Build the LayerHop ElizaOS plugin. Settings: LAYERHOP_API_URL, LAYERHOP_API_KEY, LAYERHOP_INTEGRATOR, LAYERHOP_INTEGRATOR_FEE_BPS, LAYERHOP_APP_URL, LAYERHOP_SIGNER_SERVICE. */
export function createLayerHopPlugin(opts: LayerHopPluginOptions = {}): Plugin {
  // One toolset (client, caches, quotes) per runtime and plugin instance.
  const toolsets = new WeakMap<IAgentRuntime, LayerHopToolset>();
  const tool = (rt: IAgentRuntime, name: ToolName) => toolsetFor(rt, opts, toolsets).byName[name]! as LayerHopTool;
  const hasKey = (rt: IAgentRuntime) => Boolean(opts.apiKey ?? setting(rt, "LAYERHOP_API_KEY"));

  /** A plain action: extract params, run one LayerHop tool, reply with its summary. */
  const simple = (name: string, toolName: ToolName, description: string, similes: string[], examples: ActionExample[][], render: (d: any) => string, needsKey = false): Action => ({
    name,
    similes,
    description,
    examples,
    validate: async (rt) => (needsKey ? hasKey(rt) : true),
    handler: async (rt, message, state, options, callback) => {
      const t = tool(rt, toolName);
      const r = await t.run(await paramsFor(rt, message, state, options, t));
      if (!r.ok) return respond(callback, name, { text: `I couldn't do that: ${r.error}`, success: false, error: r.error });
      return respond(callback, name, { text: render(r.data), data: r.data, success: true });
    },
  });

  const getQuote: Action = {
    name: "LAYERHOP_GET_QUOTE",
    similes: ["LAYERHOP_QUOTE", "BRIDGE_QUOTE", "SWAP_QUOTE", "CROSS_CHAIN_QUOTE"],
    description: "Get the best price to swap or bridge tokens (same chain or across EVM chains and Solana) with every fee spelled out. Read-only; nothing is signed.",
    examples: [ex("How much SOL do I get for 100 USDC on Base? My address is 0x... and my Solana address is ...", "Best route: ~0.95 SOL (min 0.945) via relay in ~2 min. LayerHop fee 0.2%.", "LAYERHOP_GET_QUOTE")],
    validate: async () => true,
    handler: async (rt, message, state, options, callback) => {
      const t = tool(rt, "get_quote");
      const signer = signerFor(rt, opts);
      let hint = "";
      if (signer) {
        try {
          hint = `If the user did not give a sender address, use the agent wallet's EVM address ${await signer.getAddress("evm")} (or Solana address ${await signer.getAddress("svm")} when sending from Solana).`;
        } catch {
          /* signer without that VM */
        }
      }
      const r = await t.run(await paramsFor(rt, message, state, options, t, hint));
      if (!r.ok) return respond(callback, getQuote.name, { text: `I couldn't get a quote: ${r.error}`, success: false, error: r.error });
      const d = r.data as any;
      await rt.setCache(lastQuoteKey(message), d.best.quoteId);
      const text = `${d.summary}\nYou receive ~${d.best.youReceive.amount} ${d.best.youReceive.token} (minimum ${d.best.youReceive.minimumAfterSlippage}). Fees: ${fmtFees(d.best)}.\nReview and sign in your own wallet: ${d.swapLink}${signer ? `\nOr say "prepare the swap" and I'll get the transaction ready for your wallet to sign after you confirm.` : ""}`;
      return respond(callback, getQuote.name, { text, data: d, success: true });
    },
  };

  const prepareSwap: Action = {
    name: "LAYERHOP_PREPARE_SWAP",
    similes: ["LAYERHOP_SWAP", "LAYERHOP_BRIDGE", "EXECUTE_LAYERHOP_QUOTE", "BUILD_SWAP_TRANSACTION"],
    description:
      "Prepare the UNSIGNED transaction for a LayerHop quote (the latest one by default). Never signs: if a signing service is configured it asks the user to explicitly confirm first; otherwise it returns the unsigned transaction and the swap link.",
    examples: [ex("Ok, swap it", 'The transaction is ready but NOT signed. Reply "confirm" to send it to your wallet for signing, or "cancel".', "LAYERHOP_PREPARE_SWAP")],
    validate: async () => true,
    handler: async (rt, message, state, options, callback) => {
      const set = toolsetFor(rt, opts, toolsets);
      const explicit = ((options as { layerhop?: { quoteId?: string } })?.layerhop ?? (message.content as { layerhop?: { quoteId?: string } }).layerhop)?.quoteId;
      const quoteId = explicit ?? (await rt.getCache<string>(lastQuoteKey(message)));
      if (!quoteId) return respond(callback, prepareSwap.name, { text: "Get a quote first (tell me what to swap), then I can prepare the transaction.", success: false, error: "NO_QUOTE" });
      const ctx = set.quotes.get(quoteId);
      const r = await set.byName.build_transaction!.run({ quoteId });
      if (!r.ok) return respond(callback, prepareSwap.name, { text: `I couldn't prepare the transaction: ${r.error}`, success: false, error: r.error });
      const d = r.data as any;
      const signer = signerFor(rt, opts);
      const summary = d.swap ?? `quote ${quoteId}`;
      if (!signer || d.sandbox) {
        const link = ctx ? `\nOr open the swap link from the quote to review and sign on layerhop.com.` : "";
        return respond(callback, prepareSwap.name, {
          text: `Here is the UNSIGNED transaction for ${summary}. I hold no keys and cannot sign: sign it with your own wallet.${d.sandbox ? " (Test mode: placeholder, never broadcast it.)" : ""}\n${d.signing.steps.join("\n")}${link}`,
          data: d,
          success: true,
        });
      }
      const pending: PendingSwap = { quoteId, vm: d.unsignedTransaction.vm, entityId: message.entityId, summary, createdAt: Date.now() };
      await rt.setCache(pendingKey(message), pending);
      return respond(callback, prepareSwap.name, {
        text: `Ready: ${summary}. Fees and minimum as quoted. The transaction is NOT signed. Reply "confirm" to send it to your wallet for signing, or "cancel". This expires in a few minutes.`,
        data: { ...d, awaitingConfirmation: true },
        success: true,
      });
    },
  };

  const confirmSwap: Action = {
    name: "LAYERHOP_CONFIRM_SWAP",
    similes: ["CONFIRM_LAYERHOP_SWAP", "APPROVE_LAYERHOP_SWAP"],
    description:
      "Only when the user explicitly confirms a swap that LAYERHOP_PREPARE_SWAP prepared in this conversation: hands the unsigned transaction to the configured wallet signing service. Never use it without the user's explicit confirmation.",
    examples: [ex("confirm", "Sent to your wallet: approval 0x..., swap 0x.... I'll track it.", "LAYERHOP_CONFIRM_SWAP")],
    validate: async (rt, message) => {
      if (message.entityId === rt.agentId) return false;
      if (!CONFIRM_RE.test(message.content.text ?? "")) return false;
      return Boolean(await rt.getCache<PendingSwap>(pendingKey(message)));
    },
    handler: async (rt, message, _state, _options, callback) => {
      const key = pendingKey(message);
      const pending = await rt.getCache<PendingSwap>(key);
      // One confirmation, one use: clear it before anything can fail.
      await rt.deleteCache(key);
      if (!pending || pending.entityId !== message.entityId || !CONFIRM_RE.test(message.content.text ?? "")) {
        return respond(callback, confirmSwap.name, { text: "There is no swap waiting for your confirmation.", success: false, error: "NO_PENDING_SWAP" });
      }
      if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
        return respond(callback, confirmSwap.name, { text: "That prepared swap expired. Ask me for a fresh quote.", success: false, error: "EXPIRED" });
      }
      const signer = signerFor(rt, opts);
      if (!signer) return respond(callback, confirmSwap.name, { text: "No wallet signing service is configured, so I can't send it. Use the swap link instead.", success: false, error: "NO_SIGNER" });
      const set = toolsetFor(rt, opts, toolsets);
      try {
        const r =
          pending.vm === "evm"
            ? await executeEvmSwap(set, pending.quoteId, {
                address: await signer.getAddress("evm"),
                sendTransaction: (req) => {
                  if (!signer.sendTransaction) throw new Error("The signing service cannot send EVM transactions.");
                  return signer.sendTransaction(req);
                },
                getAllowance: signer.getAllowance ? (token, owner, spender) => signer.getAllowance!(set.quotes.get(pending.quoteId)!.srcChain.id, token, owner, spender) : undefined,
                waitForReceipt: signer.waitForReceipt ? (hash) => signer.waitForReceipt!(set.quotes.get(pending.quoteId)!.srcChain.id, hash) : undefined,
              })
            : await executeSvmSwap(set, pending.quoteId, {
                address: await signer.getAddress("svm"),
                signAndSendTransaction: (b64) => {
                  if (!signer.signAndSendSolanaTransaction) throw new Error("The signing service cannot send Solana transactions.");
                  return signer.signAndSendSolanaTransaction(b64);
                },
                signTransaction: signer.signSolanaTransaction ? (b64) => signer.signSolanaTransaction!(b64) : undefined,
              });
        return respond(callback, confirmSwap.name, { text: r.summary, data: r, success: true });
      } catch (e) {
        const msg = errorMessage(e);
        return respond(callback, confirmSwap.name, { text: `The swap was not sent: ${msg}`, success: false, error: msg });
      }
    },
  };

  const cancelSwap: Action = {
    name: "LAYERHOP_CANCEL_SWAP",
    similes: ["CANCEL_LAYERHOP_SWAP"],
    description: "Discard a swap prepared by LAYERHOP_PREPARE_SWAP when the user declines.",
    examples: [ex("cancel", "Cancelled. Nothing was signed or sent.", "LAYERHOP_CANCEL_SWAP")],
    validate: async (rt, message) => CANCEL_RE.test(message.content.text ?? "") && Boolean(await rt.getCache<PendingSwap>(pendingKey(message))),
    handler: async (rt, message, _s, _o, callback) => {
      await rt.deleteCache(pendingKey(message));
      return respond(callback, cancelSwap.name, { text: "Cancelled. Nothing was signed or sent.", success: true });
    },
  };

  const status = simple(
    "LAYERHOP_ORDER_STATUS",
    "get_order_status",
    "Check a LayerHop swap/bridge after the source transaction was sent (provider + tx hash).",
    ["LAYERHOP_TRACK", "BRIDGE_STATUS"],
    [ex("Did my relay bridge 0xabc... arrive?", "Done: funds were delivered to the recipient.", "LAYERHOP_ORDER_STATUS")],
    (d) => `Status: ${d.state}. ${d.meaning}`,
  );
  const prices = simple(
    "LAYERHOP_GET_PRICES",
    "get_prices",
    "Current USD prices of tokens on any chain LayerHop supports.",
    ["TOKEN_PRICE"],
    [ex("What's SOL trading at?", "SOL on Solana: $142.10", "LAYERHOP_GET_PRICES")],
    (d) => d.prices.map((p: any) => `${p.symbol} on ${p.chain}: ${p.priceUsd === null ? "unknown" : `$${p.priceUsd}`}`).join("\n"),
  );
  const deposit = simple(
    "LAYERHOP_CREATE_DEPOSIT_ADDRESS",
    "create_deposit_address",
    "Create a deposit address: the user sends one token on one chain to it and receives another token on another chain. Needs LAYERHOP_API_KEY.",
    ["LAYERHOP_DEPOSIT_ADDRESS"],
    [ex("Give me an address to send USDC on Base and get USDC on Arbitrum at 0x...", "Send ONLY USDC on Base to 0x...", "LAYERHOP_CREATE_DEPOSIT_ADDRESS")],
    (d) => `${d.summary}\n${(d.tellTheUser as string[]).map((x) => `- ${x}`).join("\n")}`,
    true,
  );
  const checkout = simple(
    "LAYERHOP_CREATE_CHECKOUT",
    "create_checkout_session",
    "Create a hosted checkout link to get paid in USDC/USDT while the payer pays with any token. Needs LAYERHOP_API_KEY.",
    ["LAYERHOP_PAYMENT_LINK", "CREATE_PAYMENT_LINK"],
    [ex("Make a payment link for 49 USDC on Base to 0x...", "Send the payer to https://pay.layerhop.com/c/...", "LAYERHOP_CREATE_CHECKOUT")],
    (d) => d.summary,
    true,
  );

  const provider: Provider = {
    name: "LAYERHOP",
    description: "LayerHop swap rules, the user's pending swap (if any) and supported features.",
    get: async (rt, message) => {
      const pending = await rt.getCache<PendingSwap>(pendingKey(message));
      const signer = Boolean(signerFor(rt, opts));
      const lines = [
        AGENT_INSTRUCTIONS,
        signer
          ? "A wallet signing service is configured: swaps can be sent with it, but ONLY after the user explicitly confirms the prepared swap (LAYERHOP_CONFIRM_SWAP)."
          : "No signing service is configured: give the user the swap link or the unsigned transaction to sign in their own wallet.",
        pending ? `Pending swap awaiting the user's confirmation: ${pending.summary} (quote ${pending.quoteId}).` : "",
      ].filter(Boolean);
      return { text: lines.join("\n\n"), values: { layerhopPendingSwap: pending?.summary ?? null, layerhopCanSign: signer }, data: { pendingSwap: pending ?? null } };
    },
  };

  return {
    name: "layerhop",
    description: "LayerHop: best-price cross-chain and same-chain swaps (EVM + Solana), deposit addresses and checkout. Holds no keys; signing only through your own wallet service after explicit user confirmation.",
    actions: [getQuote, prepareSwap, confirmSwap, cancelSwap, status, prices, deposit, checkout],
    providers: [provider],
  };
}

/** The LayerHop plugin configured from runtime settings (LAYERHOP_*). */
export const layerhopPlugin: Plugin = createLayerHopPlugin();
export default layerhopPlugin;
