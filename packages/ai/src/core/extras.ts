/**
 * Agent-facing formatting for newer API features: no-route suggestions and route minimums on quote
 * errors (D-053, D-036), gasless sign requests (D-043), token risk reports and Solana limit orders.
 * Nothing here signs anything.
 */
import { LayerHopApiError, type LimitOrder, type TokenRisk } from "@layerhop/sdk";
import { parseRouteSuggestions, type GaslessSignRequest, type RouteLeg } from "@layerhop/shared";
import { fromBaseUnits } from "./amounts.js";
import type { LayerHopClient } from "./client.js";
import type { QuoteContext } from "./format.js";

const same = (n: string) => n;

/** The wording every tool uses for an API error (MCP server and framework adapters alike). */
export function apiErrorText(e: LayerHopApiError): string {
  return `LayerHop API error ${e.code} (HTTP ${e.status}): ${e.message}${e.requestId ? ` [requestId ${e.requestId}]` : ""}. See https://docs.layerhop.com/errors/${e.code}`;
}

/** A quote error with the API's suggestions or route minimum spelled out for the model. */
export class QuoteHelpError extends Error {
  constructor(
    message: string,
    public readonly apiError: LayerHopApiError,
  ) {
    super(message);
    this.name = "QuoteHelpError";
  }
}

/**
 * Turn a quote's `NO_ROUTE` / `UNSUPPORTED_CHAIN` with `details.suggestions`, or `AMOUNT_TOO_SMALL`
 * with `details.minAmount`, into a `QuoteHelpError` whose message lists the alternatives in human
 * units. Any other error comes back unchanged.
 */
export async function explainQuoteError(
  e: unknown,
  client: LayerHopClient,
  opts: { toolName?: (base: string) => string; srcDecimals?: number; srcSymbol?: string } = {},
): Promise<unknown> {
  if (!(e instanceof LayerHopApiError)) return e;
  const t = opts.toolName ?? same;
  const details = e.details ?? {};
  if (e.code === "AMOUNT_TOO_SMALL" && typeof details.minAmount === "string" && /^\d+$/.test(details.minAmount)) {
    const min = opts.srcDecimals !== undefined ? `${fromBaseUnits(details.minAmount, opts.srcDecimals)} ${opts.srcSymbol ?? ""}`.trim() : `${details.minAmount} base units of the source token`;
    const usd = typeof details.minAmountUsd === "number" ? ` (about $${details.minAmountUsd.toFixed(2)})` : "";
    const approx = details.minAmountApprox === true ? "at most " : "";
    return new QuoteHelpError(`${apiErrorText(e)}. The smallest amount that quotes on this route is ${approx}${min}${usd}. Tell the user and offer to quote that amount.`, e);
  }
  const suggestions = parseRouteSuggestions(details);
  if (!suggestions.length) return e;
  const chains = await client.chains();
  const chainName = (id: number) => chains.find((c) => c.id === id)?.name ?? `chain ${id}`;
  const token = async (chainId: number, address: string) => {
    try {
      return await client.token(chainId, address);
    } catch {
      return undefined;
    }
  };
  const leg = async (l: RouteLeg) => {
    const [src, dst] = await Promise.all([token(l.srcChain, l.srcToken), token(l.dstChain, l.dstToken)]);
    const send = src ? `${fromBaseUnits(l.amount, src.decimals)} ${src.symbol}` : `${l.amount} base units of ${l.srcToken}`;
    const get = l.dstAmount === undefined ? (dst?.symbol ?? l.dstToken) : dst ? `~${fromBaseUnits(l.dstAmount, dst.decimals)} ${dst.symbol}` : `~${l.dstAmount} base units of ${l.dstToken}`;
    const args = `${t("get_quote")} { fromChain: ${l.srcChain}, fromToken: "${src?.symbol ?? l.srcToken}", amount: "${src ? fromBaseUnits(l.amount, src.decimals) : "?"}", toChain: ${l.dstChain}, toToken: "${dst?.symbol ?? l.dstToken}" }`;
    return `${send} on ${chainName(l.srcChain)} -> ${get} on ${chainName(l.dstChain)} (${args})`;
  };
  const lines = await Promise.all(
    suggestions.map(async (s, i) => {
      if (s.kind === "via_hub" && s.steps) {
        const [a, b] = await Promise.all([leg(s.steps[0]!), leg(s.steps[1]!)]);
        return `${i + 1}. ${s.message} [via_hub: TWO separate swaps, each its own quote and signature; quote step 2 again once step 1 has filled, with the amount actually received] step 1: ${a}; step 2: ${b}`;
      }
      return `${i + 1}. ${s.message} [${s.kind}]: ${await leg(s)}`;
    }),
  );
  return new QuoteHelpError(
    `${apiErrorText(e)}. Alternatives that do quote right now (ask the user before switching; amounts are estimates, get a fresh quote): ${lines.join(" ")}`,
    e,
  );
}

/** What build_transaction returns for a gasless quote: the typed data, and why the agent can't sign it. */
export function formatGaslessBuild(
  sign: GaslessSignRequest,
  provider: string,
  quoteId: string,
  ctx: QuoteContext | undefined,
  opts: { toolName?: (base: string) => string; holder?: string; swapLink?: string } = {},
) {
  const t = opts.toolName ?? same;
  const holder = opts.holder ?? "LayerHop";
  const fee = sign.gasFee && ctx && ctx.srcToken.address.toLowerCase() === sign.gasFee.token.toLowerCase()
    ? `${fromBaseUnits(sign.gasFee.amount, ctx.srcToken.decimals)} ${ctx.srcToken.symbol}`
    : sign.gasFee
      ? `${sign.gasFee.amount} base units of ${sign.gasFee.token}`
      : undefined;
  return {
    quoteId,
    provider,
    gasless: true,
    signRequest: sign,
    ...(fee ? { networkFeeTakenFromInput: fee } : {}),
    signing: {
      notice:
        `This is a GASLESS quote: there is no transaction to send. The user's own wallet signs EIP-712 typed data ` +
        `(${sign.approval ? "the approval, then the trade" : "the trade"}) on chainId ${sign.chainId}, and the provider's relayer sends the transaction and takes the network fee from the input token. ` +
        `${holder} holds no keys and cannot sign typed data for the user, and agent tools cannot submit the signatures. ` +
        `Give the user the swap link from ${t("get_quote")} / ${t("get_swap_link")} so they sign on layerhop.com; an app with its own signer can sign signRequest unchanged and send the signatures with the LayerHop SDK (submitGasless, then gaslessStatus).`,
      steps: [
        ...(sign.approval ? [`Sign signRequest.approval.eip712 unchanged (eth_signTypedData_v4) with the sender's wallet.`] : []),
        "Sign signRequest.trade.eip712 unchanged with the sender's wallet.",
        `POST the signatures to /v1/orders/gasless as { quoteId: "${quoteId}", signatures: { trade${sign.approval ? ", approval" : ""} } } (SDK submitGasless), then poll GET /v1/orders/gasless/${quoteId} until filled or failed.`,
      ],
    },
  };
}

/** A token risk report for the model, with what to tell the user. */
export function formatTokenRisk(risk: TokenRisk, chainName: string) {
  const advice: Record<TokenRisk["level"], string> = {
    ok: "No known issues. This is not a guarantee; unverified tokens can still lose value.",
    caution: "Show the user every reason before a buy.",
    danger: "Warn the user clearly with every reason, and only proceed after an explicit confirmation that they understand the risk.",
    unknown: "No safety source answered for this token. Say so; this alone should not block a swap.",
  };
  return {
    chain: chainName,
    chainId: risk.chainId,
    address: risk.address,
    symbol: risk.symbol ?? null,
    level: risk.level,
    verified: risk.verified,
    reasons: risk.reasons,
    source: risk.source,
    checkedAt: risk.checkedAt,
    summary: `${risk.symbol ?? risk.address} on ${chainName}: ${risk.level}${risk.reasons.length ? ` (${risk.reasons.map((r) => r.message).join(" ")})` : ""}.`,
    tellTheUser: advice[risk.level] ?? advice.unknown,
  };
}

type Lookup = (chainId: number, address: string) => { symbol: string; decimals: number } | undefined;

/** A limit order with human amounts where the tokens are known. */
export function formatLimitOrder(o: LimitOrder, lookup: Lookup) {
  const human = (address: string, amount: string) => {
    const tok = lookup(o.chainId, address);
    return tok ? `${fromBaseUnits(amount, tok.decimals)} ${tok.symbol}` : `${amount} base units of ${address}`;
  };
  return {
    id: o.id,
    status: o.status,
    statusDetail: o.statusDetail,
    mode: o.livemode ? "live" : "test",
    wallet: o.wallet,
    sell: human(o.srcToken, o.amount),
    forAtLeast: human(o.dstToken, o.dstAmount),
    filled: `${human(o.srcToken, o.filledAmount)} sold for ${human(o.dstToken, o.filledDstAmount)} in ${o.fillCount} fill(s)`,
    expiresAt: o.expiresAt,
    fees: o.fees,
    srcToken: o.srcToken,
    dstToken: o.dstToken,
    amountBaseUnits: o.amount,
    dstAmountBaseUnits: o.dstAmount,
    openTxHash: o.openTxHash,
    cancelTxHash: o.cancelTxHash,
    createdAt: o.createdAt,
  };
}
