import type { Quote, QuoteResponse } from "@layerhop/sdk";
import type { BuiltTx, Chain } from "@layerhop/shared";
import { fromBaseUnits } from "./amounts.js";

export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}

/** Everything we know about a quote request, remembered per quoteId for build/simulate formatting. */
export interface QuoteContext {
  quoteId: string;
  provider: string;
  srcChain: Chain;
  dstChain: Chain;
  srcToken: TokenInfo;
  dstToken: TokenInfo;
  amount: string; // human
  amountBaseUnits: string;
  sender: string;
  recipient: string;
  slippageBps: number;
  expiresAt: number;
}

/** Wording knobs so every integration (MCP server, agent frameworks) shares one formatter. */
export interface FormatOptions {
  /** Who holds no keys, e.g. "The LayerHop MCP server". Default "LayerHop". */
  holder?: string;
  /** Maps a base tool name ("build_transaction") to the name the agent sees. Default: unchanged. */
  toolName?: (base: string) => string;
}

const same = (n: string) => n;

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a few seconds";
  if (seconds < 60) return `~${Math.round(seconds)} s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `~${h} h ${m} min` : `~${h} h`;
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "") || "0"}%`;
}

/** bps of an integer base-unit amount, rounded down. */
function bpsOf(amountBase: string, bps: number): bigint {
  return (BigInt(amountBase) * BigInt(bps)) / 10_000n;
}

export function formatQuote(q: Quote, ctx: Omit<QuoteContext, "quoteId" | "provider" | "expiresAt">, nowSec = Math.floor(Date.now() / 1000)) {
  const src = ctx.srcToken;
  const dst = ctx.dstToken;
  const ourBps = q.fees.ourFeeBps ?? 0;
  const partnerBps = q.fees.integratorFeeBps ?? 0;
  const fees: Record<string, unknown> = {
    layerhop: {
      bps: ourBps,
      percent: bpsToPercent(ourBps),
      amount: `${fromBaseUnits(bpsOf(ctx.amountBaseUnits, ourBps), src.decimals)} ${src.symbol}`,
    },
  };
  if (partnerBps > 0 || q.fees.integrator) {
    fees.partner = {
      id: q.fees.integrator ?? null,
      bps: partnerBps,
      percent: bpsToPercent(partnerBps),
      amount: `${fromBaseUnits(bpsOf(ctx.amountBaseUnits, partnerBps), src.decimals)} ${src.symbol}`,
    };
  }
  fees.providerUsd = q.fees.providerFeeUsd ?? null;
  fees.networkGasUsd = q.fees.gasUsd ?? null;

  return {
    quoteId: q.quoteId,
    provider: q.provider,
    youSend: { amount: ctx.amount, token: src.symbol, chain: ctx.srcChain.name },
    youReceive: {
      amount: fromBaseUnits(q.dstAmount, dst.decimals),
      minimumAfterSlippage: fromBaseUnits(q.dstAmountMin, dst.decimals),
      token: dst.symbol,
      chain: ctx.dstChain.name,
      amountBaseUnits: q.dstAmount,
    },
    estimatedTime: formatEta(q.estimatedSeconds),
    estimatedSeconds: q.estimatedSeconds,
    fees,
    expiresAt: new Date(q.expiresAt * 1000).toISOString(),
    expiresInSeconds: Math.max(0, q.expiresAt - nowSec),
  };
}

export function formatQuoteResponse(r: QuoteResponse, ctx: Omit<QuoteContext, "quoteId" | "provider" | "expiresAt">, swapLink: string, opts: FormatOptions = {}) {
  const t = opts.toolName ?? same;
  const best = formatQuote(r.best, ctx);
  const alternatives = r.quotes.filter((q) => q.quoteId !== r.best.quoteId).map((q) => formatQuote(q, ctx));
  return {
    summary:
      `Best: send ${ctx.amount} ${ctx.srcToken.symbol} on ${ctx.srcChain.name}, receive ~${best.youReceive.amount} ${ctx.dstToken.symbol} ` +
      `on ${ctx.dstChain.name} (min ${best.youReceive.minimumAfterSlippage}) via ${best.provider} in ${best.estimatedTime}. ` +
      `LayerHop fee ${best.fees.layerhop && (best.fees.layerhop as { percent: string }).percent}. Quote expires in ${best.expiresInSeconds} s.`,
    best,
    alternatives,
    feesNote:
      "LayerHop and partner fees are a percentage of the input amount (bps = 1/100 of a percent) and are already deducted from youReceive. providerUsd and networkGasUsd are estimates in US dollars; null means the provider did not report them.",
    providerErrors: r.errors,
    from: { chain: ctx.srcChain.slug, chainId: ctx.srcChain.id, token: ctx.srcToken, sender: ctx.sender },
    to: { chain: ctx.dstChain.slug, chainId: ctx.dstChain.id, token: ctx.dstToken, recipient: ctx.recipient },
    slippageBps: ctx.slippageBps,
    swapLink,
    nextSteps: [
      "Show the user the output, minimum, fees and ETA, and get explicit confirmation before anything else.",
      `Safest path: give the user swapLink to review and sign in their own wallet on layerhop.com.`,
      `If the user has their own signer: call ${t("build_transaction")} with the chosen quoteId (before it expires), optionally ${t("simulate_transaction")}, let the user's wallet sign and broadcast, then ${t("report_submitted")} and ${t("get_order_status")}.`,
    ],
  };
}

export function formatBuiltTx(
  tx: BuiltTx,
  provider: string,
  quoteId: string,
  ctx: QuoteContext | undefined,
  chainName: (id: number) => string,
  apiUrl = "https://api.layerhop.com",
  opts: FormatOptions = {},
) {
  const t = opts.toolName ?? same;
  const holder = opts.holder ?? "LayerHop";
  const steps: string[] = [];
  const reportStep = `After the transaction is broadcast, call ${t("report_submitted")} with quoteId "${quoteId}" and the tx hash/signature, then track it with ${t("get_order_status")} (provider "${provider}").`;
  let out: Record<string, unknown>;
  if (tx.vm === "evm") {
    const chain = chainName(tx.chainId);
    const approval = tx.approval
      ? {
          ...tx.approval,
          amountHuman:
            ctx && ctx.srcToken.address.toLowerCase() === tx.approval.token.toLowerCase()
              ? `${fromBaseUnits(tx.approval.amount, ctx.srcToken.decimals)} ${ctx.srcToken.symbol}`
              : undefined,
          description: `ERC-20 approve(spender, amount) on token ${tx.approval.token}. amount is in base units.`,
        }
      : undefined;
    if (approval) {
      steps.push(
        `Step 1 (approval): from the sender's wallet on ${chain} (chainId ${tx.chainId}), call approve(${tx.approval!.spender}, ${tx.approval!.amount}) on the token contract ${tx.approval!.token}${approval.amountHuman ? ` (= ${approval.amountHuman})` : ""}. Wait until it is mined.`,
      );
    }
    steps.push(
      `Step ${approval ? 2 : 1} (swap): from the sender's wallet on ${chain} (chainId ${tx.chainId}), send a transaction to ${tx.to} with the given data and value ${tx.value} wei${
        tx.value !== "0" ? ` (= ${fromBaseUnits(tx.value, 18)} native coin)` : ""
      }. Let the wallet estimate gas.`,
    );
    steps.push(reportStep);
    out = {
      vm: "evm",
      chainId: tx.chainId,
      chain,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      valueUnit: "wei (integer, 18 decimals)",
      ...(approval ? { approval } : {}),
    };
  } else {
    steps.push(
      "Step 1: deserialize serializedTx (base64) as a Solana VersionedTransaction and have the sender's wallet sign it. Do not change it.",
    );
    if (tx.submitViaApi) {
      steps.push(
        `Step 2: submitViaApi is true, so do NOT broadcast via RPC. Send the signed transaction (base64) to POST ${apiUrl}/v1/orders/submit with { quoteId, signedTransaction } (or the SDK's submit()). The response's txHash is the signature to track.`,
      );
    } else {
      steps.push("Step 2: broadcast the signed transaction to Solana (sendRawTransaction) and wait for confirmation.");
    }
    steps.push(reportStep);
    out = { vm: "svm", chain: "Solana", serializedTx: tx.serializedTx, encoding: "base64", submitViaApi: tx.submitViaApi === true };
  }
  return {
    quoteId,
    provider,
    unsignedTransaction: out,
    signing: {
      notice:
        `This is an UNSIGNED transaction. ${holder} holds no keys and never signs or broadcasts. Only the user's own wallet may sign it, after the user has reviewed and confirmed the swap. If the user has no programmatic wallet, give them the swap link from ${t("get_quote")} / ${t("get_swap_link")} instead.`,
      steps,
    },
    ...(ctx
      ? {
          swap: `${ctx.amount} ${ctx.srcToken.symbol} on ${ctx.srcChain.name} -> ${ctx.dstToken.symbol} on ${ctx.dstChain.name}, recipient ${ctx.recipient}`,
          expiresAt: new Date(ctx.expiresAt * 1000).toISOString(),
        }
      : {}),
  };
}

// ---------- deposit addresses ----------

/** Resolves a token on a chain (by address/mint) for display; undefined when unknown. */
export type TokenLookup = (chainId: number, address: string) => TokenInfo | undefined;

/** The deposit-address fields the formatters read (matches the API's DepositAddress). */
export interface DepositAddressLike {
  id: string;
  livemode: boolean;
  status: string;
  provider: string;
  address: string;
  chainId: number;
  token: string;
  dstChainId: number;
  dstToken: string;
  recipient: string;
  refundTo: string;
  reusable: boolean;
  amount: string | null;
  fees: { ourFeeBps: number; integratorFeeBps: number; integrator: string | null };
  label: string | null;
  metadata: Record<string, string> | null;
  depositCount: number;
  lastDepositAt: string | null;
  createdAt: string;
}

export interface DepositOrderLike {
  quoteId: string;
  status: string;
  statusDetail?: string | null;
  srcChainId: number;
  srcToken: string;
  dstChainId: number;
  dstToken: string;
  amount: string;
  dstAmount: string;
  srcTxHash: string | null;
  dstTxHash: string | null;
  createdAt: string;
}

function humanAmount(lookup: TokenLookup, chainId: number, token: string, base: string | null | undefined): string | null {
  if (base === null || base === undefined) return null;
  if (!/^\d+$/.test(base)) return base;
  const t = lookup(chainId, token);
  return t ? `${fromBaseUnits(base, t.decimals)} ${t.symbol}` : `${base} (base units)`;
}

/** The rules an agent must relay to the user next to the address. */
export function depositRules(da: DepositAddressLike, chainName: (id: number) => string, lookup: TokenLookup): string[] {
  const sym = lookup(da.chainId, da.token)?.symbol ?? da.token;
  const chain = chainName(da.chainId);
  const rules = [
    `Send ONLY ${sym} on ${chain} to ${da.address}. Any other token, or ${sym} on another chain, sent to this address may be lost for good.`,
    "Send at least $1 worth; smaller deposits may never be picked up.",
    `Refunds go to refundTo (${da.refundTo}), never back to an exchange. refundTo must be an address the user controls, never an exchange (CEX) deposit address.`,
  ];
  if (!da.reusable && da.amount) {
    rules.push(
      `One-time address: send exactly ${humanAmount(lookup, da.chainId, da.token, da.amount)}, once. An underpayment is refunded; do not reuse the address afterwards.`,
    );
  }
  if (!da.livemode) rules.unshift("TEST MODE: this is a fake sandbox address. NEVER send real funds to it; use simulate_deposit instead.");
  if (da.status === "disabled") rules.unshift("This address is DISABLED: stop showing it to the user. Deposits sent to it are no longer tracked.");
  return rules;
}

export function formatDepositAddress(da: DepositAddressLike, chainName: (id: number) => string, lookup: TokenLookup) {
  const src = lookup(da.chainId, da.token);
  const dst = lookup(da.dstChainId, da.dstToken);
  return {
    id: da.id,
    status: da.status,
    mode: da.livemode ? "live" : "test",
    provider: da.provider,
    address: da.address,
    send: { token: src?.symbol ?? da.token, tokenAddress: da.token, chain: chainName(da.chainId), chainId: da.chainId },
    deliver: { token: dst?.symbol ?? da.dstToken, tokenAddress: da.dstToken, chain: chainName(da.dstChainId), chainId: da.dstChainId },
    recipient: da.recipient,
    refundTo: da.refundTo,
    reusable: da.reusable,
    amount: humanAmount(lookup, da.chainId, da.token, da.amount),
    amountBaseUnits: da.amount,
    fees: {
      layerhop: { bps: da.fees.ourFeeBps, percent: bpsToPercent(da.fees.ourFeeBps) },
      ...(da.fees.integratorFeeBps > 0 || da.fees.integrator
        ? { partner: { id: da.fees.integrator, bps: da.fees.integratorFeeBps, percent: bpsToPercent(da.fees.integratorFeeBps) } }
        : {}),
    },
    label: da.label,
    metadata: da.metadata,
    depositCount: da.depositCount,
    lastDepositAt: da.lastDepositAt,
    createdAt: da.createdAt,
  };
}

export function formatDepositOrder(o: DepositOrderLike, lookup: TokenLookup) {
  return {
    quoteId: o.quoteId,
    status: o.status,
    ...(o.statusDetail ? { statusDetail: o.statusDetail } : {}),
    deposited: humanAmount(lookup, o.srcChainId, o.srcToken, o.amount),
    delivered: humanAmount(lookup, o.dstChainId, o.dstToken, o.dstAmount),
    amountBaseUnits: o.amount,
    dstAmountBaseUnits: o.dstAmount,
    srcTxHash: o.srcTxHash,
    dstTxHash: o.dstTxHash,
    createdAt: o.createdAt,
  };
}

export function formatDepositEstimate(
  e: { amount: string; dstAmount: string; dstAmountMin: string; estimatedSeconds: number },
  da: DepositAddressLike,
  lookup: TokenLookup,
) {
  return {
    ifYouSend: humanAmount(lookup, da.chainId, da.token, e.amount),
    youReceive: humanAmount(lookup, da.dstChainId, da.dstToken, e.dstAmount),
    minimumReceived: humanAmount(lookup, da.dstChainId, da.dstToken, e.dstAmountMin),
    estimatedTime: formatEta(e.estimatedSeconds),
    note: "A guide only: each deposit is priced when it arrives, after LayerHop and partner fees.",
  };
}
