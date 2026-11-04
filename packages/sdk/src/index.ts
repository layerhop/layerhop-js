import { verifyWebhookSignature } from "@layerhop/shared";
import type {
  Eip712TypedData, BalancesResponse, BuiltTx, ChainInfo, FeeBreakdown, FeeChannel, GasOnArrival, GaslessSignatures, GaslessSignRequest, OrderState, OrderStatus, PricesResponse, ProviderId, RouteSuggestion, SvmTx, TokenInfo, TokenRisk, TokensResponse,
} from "@layerhop/shared";

export type {
  BuiltTx, EvmTx, EvmCall, SvmTx, TronTx, TronCall, TronApproval, TronUnsignedTx, Vm, WalletVm, OrderStatus, ProviderId, FeeChannel, FeeBreakdown, GasOnArrival,
  Eip712TypedData, GaslessSignable, GaslessSignRequest, GaslessSignatures,
  ChainInfo, OnlyRoute, TokenInfo, Balance, TokensResponse, PricesResponse, BalancesResponse,
  ChainRouteHealth, RouteHealthState, RouteHealthStatus, GaslessExpectation, CowOrder, CowOrderExpectation,
} from "@layerhop/shared";

/**
 * `error.details` of `AMOUNT_TOO_SMALL` from a quote (D-036): the route's minimum when LayerHop could
 * tell it. `minAmountApprox: true` = found by probing $10 / $25 / $50 (the true minimum is at most this).
 */
export interface AmountTooSmallDetails {
  errors?: { provider: string; code: string; message: string }[];
  /** Base units of `srcToken`. */
  minAmount?: string;
  minAmountUsd?: number;
  minAmountApprox?: boolean;
}
/**
 * `error.details` of `NO_ROUTE` from a live quote (D-053): alternatives that quoted. Read them with
 * `parseRouteSuggestions(err.details)`.
 */
export interface NoRouteDetails {
  errors?: { provider: string; code: string; message: string }[];
  suggestions?: RouteSuggestion[];
}
export type { RouteLeg, RouteSuggestion, RouteSuggestionKind } from "@layerhop/shared";
export type { TokenRisk, TokenRiskCode, TokenRiskLevel, TokenRiskReason } from "@layerhop/shared";
export { parseRouteSuggestions } from "@layerhop/shared";
export type { AvoidableVenue, VenueKind } from "@layerhop/shared";
export { AVOIDABLE_VENUES, EXCLUDABLE_PROVIDERS } from "@layerhop/shared";
export {
  CHAINS, TOKENS, getChain, findToken, SOLANA_CHAIN_ID, EVM_NATIVE, SOL_NATIVE, HYPERLIQUID_CHAIN_ID,
  gasOnArrivalApplies, DEFAULT_GAS_ON_ARRIVAL_USD, gaslessApplies, GASLESS_CHAIN_IDS, gaslessProblems, PERMIT2_ADDRESS, GASLESS_MAX_DEADLINE_S,
  COW_CHAINS, COW_SETTLEMENT, COW_VAULT_RELAYER, COW_MAX_FEE_BPS, isCowChain, cowOrderProblems, cowCancellationProblems, cowOrderUid,
  SETTLEMENT_TOKENS, findSettlementToken, SANDBOX_MAGIC_AMOUNTS,
  verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_EVENT_HEADER, WEBHOOK_DELIVERY_HEADER,
} from "@layerhop/shared";
// x402 pay-per-request middleware (D-066).
export { x402 } from "./x402.js";
export type { X402Options, X402Requirements, X402SettleResponse, X402Check, HonoLikeContext, ExpressLikeRequest, ExpressLikeResponse } from "./x402.js";
export { X402_NETWORKS, X402_HEADERS, encodeX402Header, decodeX402Header } from "@layerhop/shared";

export interface LayerHopOptions {
  /** Defaults to https://api.layerhop.com */
  baseUrl?: string;
  apiKey?: string;
  channel?: FeeChannel;
  /**
   * Your partner id (`[a-z0-9-]{1,32}`), sent as `integrator` on every quote so you earn your
   * partner fee on top of LayerHop's. Unknown ids are ignored by the API.
   */
  integrator?: string;
  /**
   * Partner fee override in bps. Only honored when `apiKey` belongs to a partner, within that
   * partner's `maxFeeBps`; otherwise the configured partner fee applies.
   */
  integratorFeeBps?: number;
  fetch?: typeof fetch;
  /**
   * How Server-Sent Events streams (`streamOrder`, `checkout.stream`, `webhooks.stream`) are read.
   * `auto` (default): `fetch` with a streaming body where the runtime supports it, else
   * `XMLHttpRequest` progress events (React Native, whose `fetch` can't stream). A custom `fetch`
   * always uses `fetch`. A `fetch` response without a readable body is parsed once it completes.
   */
  streaming?: "auto" | "fetch" | "xhr";
}

export interface QuoteParams {
  /** Chain id or slug ("base", "solana"). */
  srcChain: string | number;
  /** Token symbol from the built-in list ("USDC") or address/mint. */
  srcToken: string;
  /** Integer string in base units. */
  amount: string;
  dstChain: string | number;
  dstToken: string;
  sender: string;
  recipient: string;
  slippageBps?: number;
  /**
   * Also deliver native gas on the destination chain: `true` = $2, or a USD amount (0.5–20).
   * Ignored for same-chain swaps, non-EVM destinations and native outputs; providers that can't do
   * it ignore it (check `quote.gasOnArrival`).
   */
  gasOnArrival?: boolean | number;
  /**
   * Gasless swap (when the deployment enables it): the wallet signs EIP-712 typed data instead of
   * sending a transaction, and the provider's relayer takes the network fee out of `srcToken`. ERC-20
   * input, same EVM chain only. Then `buildGasless` → sign → `submitGasless` → `gaslessStatus`.
   */
  gasless?: boolean;
  /**
   * Wallet that referred this user (EVM or Solana address), recorded on the order for referral
   * attribution. Never changes the fee or the price; invalid values and self-referral are ignored.
   */
  referrer?: string;
  /**
   * Copy this trade: the trade card's quote id (`q_…`) or the wallet whose trade the user copies. Its
   * owner gets the referral attribution for this quote (ahead of `referrer`); attribution only.
   */
  copyOf?: string;
  /**
   * What the payment is for: `tip`, `split` (with `splitId` + `splitShare`), `payout` or `gather`.
   * Recorded on the order for tip jar counters and split status; never changes the fee or the route.
   */
  purpose?: "tip" | "split" | "payout" | "gather" | "rebalance" | "fund";
  /** Pay one share of a split (`POST /v1/splits`): the quote must deliver the split's token to its recipient. */
  splitId?: string;
  splitShare?: number;
  /** A message to the recipient on a tip or split payment (plain text, at most 140 characters). */
  note?: string;
  /** Never ask these providers (ids from `EXCLUDABLE_PROVIDERS`, e.g. `"relay"`). Never changes the fee. */
  excludeProviders?: string[];
  /** Never route through these bridges (ids from `AVOIDABLE_VENUES` with `kind: "bridge"`, e.g. `"stargate"`). */
  excludeBridges?: string[];
  /** Never swap through these exchanges (ids from `AVOIDABLE_VENUES` with `kind: "exchange"`, e.g. `"1inch"`). */
  excludeExchanges?: string[];
}

/**
 * Receive an exact amount: `dstAmount` is what the recipient gets; each quote reports `srcAmount`
 * (what the sender pays) and `srcAmountMax` (the most the tx can take, for balance checks). Only
 * providers that quote a fixed output answer. Not with gas on arrival or gasless.
 */
export interface ExactOutputQuoteParams extends Omit<QuoteParams, "amount" | "gasOnArrival" | "gasless"> {
  /** The exact amount of `dstToken` the recipient receives (base units). */
  dstAmount: string;
}

/**
 * Destination calls: an exact-output quote whose output is used by contract calls on the destination
 * chain, run by the provider's executor (msg.sender is the executor, not the user). Send `calls` or
 * `action`. See the destination-calls guide for the trust model.
 */
export interface CallsQuoteParams extends Omit<QuoteParams, "amount" | "gasOnArrival" | "gasless"> {
  /** The exact amount of `dstToken` the calls receive (base units). The quote reports `srcAmount`. */
  dstAmount: string;
  calls?: DestinationCall[];
  /** A preset that builds the calls server-side, e.g. `{ type: "aave-v3-supply" }`. */
  action?: DestinationAction;
}

/** One contract call on the destination chain (`value` in wei, native outputs only). */
export interface DestinationCall {
  to: string;
  data: string;
  value?: string;
}

/** `aave-v3-supply`: approve the chain's Aave v3 Pool and supply `dstAmount` of `dstToken` for `recipient`. */
export interface DestinationAction {
  type: "aave-v3-supply";
}

/** The calls a quote's provider committed to run, and their pre-quote simulation. */
export interface DestinationCallsPlan {
  items: { to: string; data: string; value: string }[];
  /** Contract that receives the output and makes the calls (their msg.sender). */
  executor: string;
  executed: boolean;
  simulation?: { ok: boolean; gasUsed: string; leftover?: string };
}

export interface Quote {
  quoteId: string;
  provider: ProviderId;
  dstAmount: string;
  dstAmountMin: string;
  estimatedSeconds: number;
  fees: FeeBreakdown;
  expiresAt: number;
  /** Native gas delivered to the recipient on top of `dstAmount` (when requested and included). */
  gasOnArrival?: GasOnArrival;
  /** What the sender pays (base units of srcToken), on exact-output quotes (`dstAmount`, destination calls). */
  srcAmount?: string;
  /** Exact-output quotes: the most the transaction can take from the sender, slippage included (>= srcAmount). */
  srcAmountMax?: string;
  /** Destination calls the provider will run (when the request had `calls` / `action`). */
  calls?: DestinationCallsPlan;
  /** Gasless quotes: the gas fee taken from the input token, and whether an approval signature comes first. */
  gasless?: { gasFee?: { amount: string; token: string }; approval: boolean };
}

/** State of a submitted gasless order (`srcTxHash` once the relayer's tx is mined). */
export interface GaslessOrderStatus {
  quoteId: string;
  provider: ProviderId;
  orderId: string;
  state: OrderState;
  srcTxHash?: string;
  reason?: string;
}

export interface QuoteResponse {
  best: Quote;
  quotes: Quote[];
  errors: { provider: string; code: string; message: string }[];
  /** Present only when the request was served, but not exactly as asked (e.g. `GAS_ON_ARRIVAL_UNAVAILABLE`). Ignore codes you don't know. */
  warnings?: { code: string; message: string }[];
  /** false when the request used an `lh_test_` key (sandbox quotes). */
  livemode?: boolean;
  /** Address screening (D-069): listed addresses of this request; present once the API has a list loaded. */
  screening?: ScreeningAnnotation;
}

/** Address screening on quotes, orders and checkout quotes: which addresses are on the OFAC SDN list. */
export interface ScreeningAnnotation {
  source: "ofac_sdn";
  listUpdatedAt: string | null;
  sanctioned: { address: string; role: "sender" | "recipient" | "refundTo" | "payer" | "payout"; lists: string[] }[];
}

/** `POST /v1/screen`: one address's result. */
export interface ScreeningResult {
  address: string;
  sanctioned: boolean;
  /** Lists the address is on (`"OFAC SDN"`), empty when not listed. */
  lists: string[];
  source: "ofac_sdn";
  /** Publish date of the list checked; null while the API has no list loaded. */
  listUpdatedAt: string | null;
}

export interface ScreenResponse {
  results: ScreeningResult[];
  list: { source: "ofac_sdn"; name: string; publishedAt: string | null; fetchedAt: string; addressCount: number } | null;
  /** The API refuses listed addresses for everyone (`ADDRESS_SANCTIONED`). */
  enforced: boolean;
}

/** One `quote` event of `quotes.stream()`: a full quote response plus its sequence number. */
export interface QuoteStreamUpdate extends QuoteResponse {
  seq: number;
}

export interface QuoteStreamOptions {
  /** Refresh interval in ms (default 10000, minimum 5000). Each refresh counts as one request against your rate limit. */
  intervalMs?: number;
  signal?: AbortSignal;
}

/** Lifecycle of an order recorded by the API (docs/PLATFORM_SPEC.md "Orders"). */
/** `dropped`: the source transaction never reached the network (no funds moved); reporting a new hash revives the order. */
export type OrderLifecycleStatus = "built" | "submitted" | "pending" | "filled" | "refunded" | "failed" | "expired" | "dropped";

/** An order as returned by `GET /v1/orders` (public fields only). */
export interface OrderSummary {
  quoteId: string;
  status: OrderLifecycleStatus;
  statusDetail: string | null;
  provider: ProviderId;
  channel: FeeChannel;
  srcChainId: number;
  srcToken: string;
  dstChainId: number;
  dstToken: string;
  sender: string;
  recipient: string;
  amount: string;
  dstAmount: string;
  ourFeeBps: number;
  partnerFeeBps: number;
  srcTxHash: string | null;
  dstTxHash: string | null;
  /** false for test-mode orders. */
  livemode?: boolean;
  /** The checkout session this order pays, if any. */
  checkoutSessionId?: string | null;
  /** The checkout refund this order sends, if any. */
  refundId?: string | null;
  /** The deposit address this order came from, if any (`quoteId` then starts with `dep_`). */
  depositAddressId?: string | null;
  /** The limit order this order is a fill of, if any (`quoteId` then starts with `lof_`). */
  limitOrderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListOrdersParams {
  /** Sender or recipient address (EVM addresses match case-insensitively). */
  address: string;
  status?: OrderLifecycleStatus;
  /** `nextCursor` from the previous page. */
  cursor?: string;
  /** 1–200, default 50. */
  limit?: number;
}

export interface OrderList {
  orders: OrderSummary[];
  nextCursor: string | null;
}

export interface SubmittedResponse {
  quoteId: string;
  status: OrderLifecycleStatus;
  /** false when the tx was not visible on chain yet (provisional); report it again later to confirm it. */
  verified?: boolean;
}

/** `POST /v1/simulate`: a dry run of the tx for a quote. Nothing is signed or sent. */
export interface SimulationResponse {
  quoteId: string;
  provider: ProviderId;
  ok: boolean;
  vm: "evm" | "svm" | "tvm";
  /** Tron: energy the simulated call used. */
  energyUsed?: number;
  /** EVM gas units (decimal string) for what was simulated. */
  gasEstimate?: string;
  /** Solana compute units consumed. */
  computeUnits?: number;
  /** EVM: the allowance is too low — send `tx.approval` before the swap. */
  needsApproval?: boolean;
  /** `tx`: the swap itself was simulated · `approval`: only the approval could be. */
  simulated?: "tx" | "approval";
  error?: { code: "SIMULATION_FAILED" | "RPC_ERROR"; message: string; logs?: string[] };
  tx: BuiltTx;
}

export interface TokensParams {
  /** Chain id or slug. */
  chain: string | number;
  /** Symbol, name or exact address / mint. */
  q?: string;
  /** 1–200, default 50. */
  limit?: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
}

export type CheckoutStatus = "open" | "processing" | "paid" | "expired" | "needs_review";

export interface CreateCheckoutParams {
  /** Amount due, integer string in base units of the settlement token (49 USDC = "49000000"). */
  amount: string;
  /** Settlement chain id or slug: ethereum, arbitrum, base, optimism, bsc, polygon or solana. */
  settleChain: string | number;
  /** "USDC" or "USDT" (or its address) on that chain. */
  settleToken: string;
  /** Your payout address on the settlement chain. */
  recipient: string;
  merchantName?: string;
  /** Shown to the payer. */
  description?: string;
  /** Your own order id; never shown to the payer. */
  reference?: string;
  /** Up to 20 string values; never shown to the payer. */
  metadata?: Record<string, string>;
  successUrl?: string;
  cancelUrl?: string;
  /** 5–10080, default 60. */
  expiresInMinutes?: number;
  /** Embedded checkout: the only sites (exact origins) that may show the session in an iframe. Empty = any. */
  embedOrigins?: string[];
}

export interface CheckoutSession {
  id: string;
  object: "checkout.session";
  livemode: boolean;
  status: CheckoutStatus;
  statusDetail: string | null;
  amount: string;
  settlement: { chainId: number; token: string; symbol: string; decimals: number };
  recipient: string;
  merchantName: string | null;
  description: string | null;
  /** The hosted checkout page: send the payer here. */
  url: string;
  /** The product the session was started from, if any. */
  productId?: string | null;
  /** The invoice this session pays, if any. */
  invoiceId?: string | null;
  /** Completed refunds so far, base units of the settlement token ("0" when none). */
  refundedAmount?: string;
  successUrl: string | null;
  cancelUrl: string | null;
  expiresAt: string;
  payment: {
    /** "wallet": paid through a quote on the page; "transfer": a scan-to-pay transfer (D-064), no quote. */
    method?: "wallet" | "transfer";
    /** null for a scan-to-pay transfer. */
    quoteId: string | null;
    payer: string | null;
    srcChainId: number | null;
    srcToken: string | null;
    srcAmount: string | null;
    srcTxHash: string | null;
    dstTxHash: string | null;
    paidAt: string | null;
  } | null;
  /** Only with the owning account's API key. */
  reference?: string | null;
  metadata?: Record<string, string> | null;
  /** Only when paid plans are enabled: false when the merchant's plan is white-label (hide LayerHop branding). */
  branding?: boolean;
  /** The payer can be shown a "Send to address" QR (`checkout.startTransfer`). */
  transferAvailable?: boolean;
  /** Scan-to-pay state once the payer asked for a QR, else null. */
  transfer?: CheckoutTransfer | null;
  /** Sites allowed to embed this checkout (empty = any). */
  embedOrigins?: string[];
  /** "Pay with Bitcoin" (D-067; only present where the API enabled it): can this session show a BTC deposit address. */
  bitcoinAvailable?: boolean;
  /** The Bitcoin payment once the payer asked for it (`checkout.startBitcoin`), else null. */
  bitcoin?: CheckoutBitcoin | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * "Pay with Bitcoin" (D-067): send exactly `amountSats` (`amountBtc`) to `address`, a Relay deposit
 * address bound to this payment; the merchant receives `amountOut` of the settlement token. `uri` is
 * the BIP21 payment request for the QR. After `expiresAt` ask `startBitcoin` again for a fresh quote.
 */
export interface CheckoutBitcoin {
  address: string;
  amountSats: string;
  amountBtc: string;
  uri: string;
  amountOut: string;
  expiresAt: string;
  expired: boolean;
  /** Relay status: waiting, depositing, pending, submitted, success, failure or refund. */
  status: string;
  /** Satoshis seen at `address` (mempool included). */
  seenSats: string;
  requestId: string;
  feeBps: number;
  refundAddress: string | null;
  quotes: { address: string; amountSats: string; status: string; requestId: string; createdAt: string }[];
}

/**
 * Scan-to-pay ("Send to address", D-064). `evm_transfer`: send exactly `amount` of `token` to
 * `address` on `chainId` (the amount carries a tag in its sub-cent digits). `solana_pay`: scan `uri`
 * (a Solana Pay transaction request) with a Solana wallet. `evm_splitter` (D-065): send exactly
 * `amount` to `address`, the session's own fee-splitting deposit address (amount due + fee).
 */
export interface CheckoutTransfer {
  kind: "evm_transfer" | "solana_pay" | "evm_splitter";
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  address: string;
  /** What to send now, base units (EVM: the exact tagged amount; after a short payment, the tagged rest). */
  amount: string;
  amountDue: string;
  /** LayerHop's fee on top, inside the same Solana Pay transaction. */
  fee: { bps: number; amount: string } | null;
  /** QR payload: EIP-681 (EVM) or `solana:https://…/solana-pay` (Solana Pay transaction request). */
  uri: string;
  /** Solana Pay transfer request (plain transfer), only when enabled. */
  transferUri: string | null;
  reference: string | null;
  /** Confirmed so far, and seen but still confirming. */
  received: string;
  seen: string;
  state: "waiting" | "partial" | "paid" | "overpaid";
  txs: { hash: string; amount: string; at: string | null }[];
  startedAt: string;
  /** `evm_splitter` only: the sweep that paid the deposit out to the merchant. */
  sweepTxHash?: string | null;
}

export interface CreateCheckoutProductParams {
  name: string;
  description?: string | null;
  merchantName?: string | null;
  /** Price in base units of the settlement token. */
  amount: string;
  settleChain: string | number;
  settleToken: string;
  recipient: string;
  successUrl?: string | null;
  cancelUrl?: string | null;
  /** Lifetime of each session started from the product (5–10080, default 60). */
  expiresInMinutes?: number;
  /** https origins allowed to start sessions from a browser; empty = any. */
  allowedOrigins?: string[];
  active?: boolean;
}

export interface CheckoutProduct {
  id: string;
  object: "checkout.product";
  livemode: boolean;
  active: boolean;
  name: string;
  description: string | null;
  merchantName: string | null;
  amount: string;
  settlement: { chainId: number; token: string; symbol: string; decimals: number };
  /** `https://layerhop.com/buy/{id}` */
  url: string;
  /** Owner only (with the account's key): */
  recipient?: string;
  successUrl?: string | null;
  cancelUrl?: string | null;
  expiresInMinutes?: number;
  allowedOrigins?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CheckoutQuoteParams {
  srcChain: string | number;
  srcToken: string;
  /** The payer's address on `srcChain`. */
  sender: string;
  slippageBps?: number;
}

export interface CheckoutQuote extends Quote {
  /** What the payer sends, base units of the chosen token. */
  srcAmount: string;
}

export interface CheckoutQuoteResponse {
  sessionId: string;
  livemode: boolean;
  amountDue: string;
  best: CheckoutQuote;
  quotes: CheckoutQuote[];
  errors: { provider: string; code: string; message: string }[];
}

export type WebhookEventType =
  | "order.submitted" | "order.filled" | "order.refunded" | "order.failed" | "order.dropped"
  | "checkout.session.processing" | "checkout.session.completed" | "checkout.session.payment_failed" | "checkout.session.expired"
  | "checkout.session.refunded" | "invoice.sent" | "invoice.paid"
  | "subscription.created" | "subscription.renewed" | "subscription.past_due" | "subscription.canceled"
  | "limit_order.opened" | "limit_order.filled" | "limit_order.cancelled" | "limit_order.expired" | "limit_order.failed";

export type InvoiceStatus = "draft" | "open" | "paid" | "void";

export interface InvoiceLineItem {
  description: string;
  /** 1–10000. */
  quantity: number;
  /** Price of one unit, integer string in base units of the settlement token. */
  unitAmount: string;
}

export interface CreateInvoiceParams {
  /** 1–50 lines; the invoice total is the sum of quantity × unitAmount. */
  lineItems: InvoiceLineItem[];
  /** Settlement chain id or slug: ethereum, arbitrum, base, optimism, bsc, polygon or solana. */
  settleChain: string | number;
  /** "USDC" or "USDT" (or its address) on that chain. */
  settleToken: string;
  /** Your payout address on the settlement chain. */
  recipient: string;
  /** Where the invoice (and later the receipt) is emailed. */
  customerEmail?: string | null;
  customerName?: string | null;
  merchantName?: string | null;
  memo?: string | null;
  /** ISO date (`2026-11-01`) or date-time. */
  dueAt?: string | null;
  /** Finalize and email the invoice right away (otherwise it stays a draft). */
  send?: boolean;
}

/** Drafts only; every field is optional (`null` clears a nullable field). */
export type UpdateInvoiceParams = Partial<Omit<CreateInvoiceParams, "send">>;

/** The customer's view of an invoice (`publicView`, the hosted page `layerhop.com/invoice/{id}`). */
export interface PublicInvoice {
  id: string;
  object: "invoice";
  livemode: boolean;
  /** `INV-0001`, numbered per account and mode. */
  number: string;
  status: InvoiceStatus;
  merchantName: string | null;
  customerName: string | null;
  memo: string | null;
  lineItems: InvoiceLineItem[];
  /** Total, base units of the settlement token. */
  amount: string;
  settlement: { chainId: number; token: string; symbol: string; decimals: number };
  dueAt: string | null;
  paidAt: string | null;
  /** The hosted invoice page: `https://layerhop.com/invoice/{id}`. */
  url: string;
  /** PDF receipt, once paid. */
  receiptUrl: string | null;
  createdAt: string;
}

/** An invoice as its owner sees it (API key or dashboard). */
export interface Invoice extends PublicInvoice {
  customerEmail: string | null;
  recipient: string;
  /** The checkout session paying the invoice, once the customer started paying. */
  sessionId: string | null;
  /** The subscription this invoice bills a period of (issued by LayerHop's billing), if any. */
  subscriptionId?: string | null;
  sentAt: string | null;
  receiptSentAt: string | null;
  voidedAt: string | null;
  updatedAt: string;
}

export interface InvoiceList {
  invoices: Invoice[];
  nextCursor: string | null;
}

/**
 * `active` (billing each period), `past_due` (an invoice is unpaid past its due date: reminders go
 * out and renewals wait), `paused` (no invoices or reminders), `canceled` (by you, or 7 days past due).
 */
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "paused";
export type SubscriptionInterval = "day" | "week" | "month" | "year";

export interface CreateSubscriptionParams {
  /** Where each period's invoice and the reminders are emailed. */
  customerEmail: string;
  interval: SubscriptionInterval;
  /** Bill every `intervalCount` intervals (1–365, default 1; 3 + "month" = quarterly). */
  intervalCount?: number;
  /** Bill a product's price, settlement token and payout address (instead of the four fields below). */
  productId?: string;
  /** Price per period, integer string in base units of the settlement token. */
  amount?: string;
  /** Settlement chain id or slug: ethereum, arbitrum, base, optimism, bsc, polygon or solana. */
  settleChain?: string | number;
  /** "USDC" or "USDT" (or its address) on that chain. */
  settleToken?: string;
  /** Your payout address on the settlement chain. */
  recipient?: string;
  /** The invoice line item, e.g. "Pro plan" (required without `productId`). */
  description?: string;
  customerName?: string | null;
  merchantName?: string | null;
  memo?: string | null;
  /** Days after an invoice is issued that it is due (0–60, default 3). */
  daysUntilDue?: number;
  /** ISO date-time of the first period and invoice (default now, at most 366 days ahead). */
  startAt?: string;
  metadata?: Record<string, string> | null;
}

/** Changes apply from the next invoice. `cancelAtPeriodEnd: false` undoes a scheduled cancel. */
export interface UpdateSubscriptionParams {
  customerEmail?: string;
  customerName?: string | null;
  merchantName?: string | null;
  description?: string;
  memo?: string | null;
  amount?: string;
  daysUntilDue?: number;
  metadata?: Record<string, string> | null;
  cancelAtPeriodEnd?: boolean;
}

export interface Subscription {
  id: string;
  object: "subscription";
  livemode: boolean;
  status: SubscriptionStatus;
  customerEmail: string;
  customerName: string | null;
  merchantName: string | null;
  description: string;
  memo: string | null;
  productId: string | null;
  /** Price per period, base units of the settlement token. */
  amount: string;
  settlement: { chainId: number; token: string; symbol: string; decimals: number };
  recipient: string;
  interval: SubscriptionInterval;
  intervalCount: number;
  daysUntilDue: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** When the next invoice is issued (null when paused or canceled). */
  nextInvoiceAt: string | null;
  cancelAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  /** "requested" (you canceled) or "unpaid" (7 days past due). */
  cancellationReason: string | null;
  pausedAt: string | null;
  latestInvoiceId: string | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionList {
  subscriptions: Subscription[];
  nextCursor: string | null;
}

/** `POST /v1/invoices/{id}/pay`: the checkout session that pays the invoice (reused while live). */
export interface InvoicePayResponse {
  sessionId: string;
  /** The hosted checkout page. */
  url: string;
}

export type DepositAddressStatus = "active" | "disabled";

export interface CreateDepositAddressParams {
  /** Chain id or slug your user deposits on. */
  srcChain: string | number;
  /** The token to deposit (address / mint or symbol). Other tokens sent to the address may be unrecoverable. */
  srcToken: string;
  /** Chain id or slug to deliver on. */
  dstChain: string | number;
  dstToken: string;
  /** Receives `dstToken` on `dstChain`. */
  recipient: string;
  /** Your user's address on `srcChain` for refunds. Never an exchange (CEX) deposit address. */
  refundTo: string;
  /** true (default): reusable for this route with any amount. false: one-time, exactly `amount`. */
  reusable?: boolean;
  /** Base units of `srcToken`. Required when `reusable` is false; otherwise sizes the estimate (default ≈ $100). */
  amount?: string;
  /** Your reference (1–64 chars), filterable in `list`. */
  label?: string;
  /** Up to 20 string key-value pairs. */
  metadata?: Record<string, string>;
  /** Partner id whose fee applies, as for quotes. */
  integrator?: string;
  /** Partner fee in bps (up to your partner `maxFeeBps`), as for quotes. */
  integratorFeeBps?: number;
}

/** An address your user sends tokens to; each deposit becomes an order (`quoteId` starting with `dep_`). */
export interface DepositAddress {
  id: string;
  object: "deposit_address";
  livemode: boolean;
  status: DepositAddressStatus;
  /** `relay` (live) or `sandbox` (test mode, a fake address). */
  provider: string;
  /** Where your user sends `token` on `chainId`. */
  address: string;
  /** Source chain. */
  chainId: number;
  /** Token to deposit (address or mint). */
  token: string;
  dstChainId: number;
  dstToken: string;
  recipient: string;
  refundTo: string;
  reusable: boolean;
  /** The exact amount a one-time address expects; null when reusable. */
  amount: string | null;
  fees: { ourFeeBps: number; integratorFeeBps: number; integrator: string | null };
  label: string | null;
  metadata: Record<string, string> | null;
  depositCount: number;
  lastDepositAt: string | null;
  createdAt: string;
}

/** `create` response: the address plus an estimate for `estimate.amount`. */
export interface DepositAddressCreated extends DepositAddress {
  estimate: { amount: string; dstAmount: string; dstAmountMin: string; estimatedSeconds: number };
}

/** A deposit (order) as the account owner sees it. */
export interface DepositOrder extends OrderSummary {
  keyId: string | null;
  partnerId: string | null;
  partnerFeeEstimate: string;
}

/** `get` response: the address plus its 20 most recent deposits, newest first. */
export interface DepositAddressWithDeposits extends DepositAddress {
  deposits: DepositOrder[];
}

export interface DepositAddressList {
  depositAddresses: DepositAddress[];
  nextCursor: string | null;
}

export type LimitOrderStatus = "built" | "open" | "filled" | "cancelled" | "expired" | "failed";

export interface CreateLimitOrderParams {
  /** The maker wallet (base58 on Solana, 0x on EVM): signs the order and receives the output. */
  wallet: string;
  /** Token to sell: mint / address or curated symbol (`USDC`, `SOL`). EVM: an ERC-20, not the native coin. */
  srcToken: string;
  /** Token to buy. Solana: our fee applies when it is SOL, USDC or USDT. EVM: any token. */
  dstToken: string;
  /** Base units of `srcToken` to sell (worth at least $5). */
  amount: string;
  /** Minimum base units of `dstToken` for the whole `amount`: the limit price is `dstAmount / amount`. */
  dstAmount: string;
  /** Unix seconds, at least 60 s ahead. Solana: omit for good-till-cancelled. EVM: at most 365 days, default 90. */
  expiresAt?: number;
  /** `solana` (the default) or an EVM chain with CoW Protocol (`base`, `arbitrum`, `ethereum`, … or the id; see `COW_CHAINS`). */
  chain?: string | number;
  /** Up to 20 string key-value pairs. */
  metadata?: Record<string, string>;
  /** Partner id whose fee applies, as for quotes. */
  integrator?: string;
  /** Partner fee in bps (up to your partner `maxFeeBps`), as for quotes. */
  integratorFeeBps?: number;
}

/** A limit order (Solana: Jupiter Trigger; EVM: CoW Protocol). Fills are orders whose `quoteId` starts with `lof_`. */
export interface LimitOrder {
  id: string;
  object: "limit_order";
  livemode: boolean;
  status: LimitOrderStatus;
  statusDetail: string | null;
  /** `jupiter` (Solana), `cow` (EVM) or `sandbox` (test mode). */
  provider: string;
  chainId: number;
  wallet: string;
  srcToken: string;
  dstToken: string;
  amount: string;
  dstAmount: string;
  expiresAt: string | null;
  /** The fee written into the on-chain order (0 when `dstToken` carries no fee). */
  fees: { ourFeeBps: number; integratorFeeBps: number; integrator: string | null };
  providerOrderId: string;
  filledAmount: string;
  filledDstAmount: string;
  fillCount: number;
  openTxHash: string | null;
  /** Solana: set once a cancel tx was submitted; the status turns `cancelled` when the provider confirms. EVM: always null (see `statusDetail: "cancel requested"`). */
  cancelTxHash: string | null;
  channel: FeeChannel;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `create` response. Solana: the unsigned tx (`submitViaApi: true`) for `wallet` to sign. EVM: `tx` is
 * null; check `typedData` with `cowOrderProblems`, make sure the allowance covers `approval`, then have
 * `wallet` sign `typedData` (`eth_signTypedData_v4`) and `submit` the signature.
 */
export interface LimitOrderCreated extends LimitOrder {
  tx: SvmTx | null;
  /** EVM: the CoW order as EIP-712 typed data. */
  typedData?: Eip712TypedData;
  /** EVM: the order's full appData JSON (LayerHop's partner fee); `typedData.message.appData` is its hash. */
  appData?: string;
  /** EVM: allowance the order needs, to CoW's vault relayer only (exact amount). */
  approval?: { token: string; spender: string; amount: string };
  /** EVM test mode: never sent to CoW. */
  sandbox?: true;
}

/** What to `submit`: a signed Solana tx (base64, also accepted as a plain string) or an EVM typed-data signature. */
export type LimitOrderSignature = string | { signedTransaction: string } | { signature: string };

export interface LimitOrderWithFills extends LimitOrder {
  fills: OrderSummary[];
}

export interface LimitOrderList {
  limitOrders: LimitOrder[];
  nextCursor: string | null;
}

export interface CreateRecurringOrderParams {
  /** The Solana wallet (base58) that funds, signs and owns the order. */
  wallet: string;
  /** Token bought on each order: mint or symbol. */
  dstToken: string;
  /** Token spent: mint or symbol. Default `USDC`. */
  srcToken?: string;
  /** The whole budget in base units of `srcToken`, deposited when the order opens. */
  amount: string;
  /** Number of buys (at least 2; each worth at least $50). */
  orders: number;
  /** Seconds between buys (86400 = daily, 604800 = weekly). */
  intervalSeconds: number;
  /** Only `solana` (the default). */
  chain?: string | number;
}

/** `create` response: the unsigned tx for `wallet` to sign, and the `requestId` to submit it with. No LayerHop fee. */
export interface RecurringOrderBuild {
  object: "recurring_order_build";
  livemode: boolean;
  /** `jupiter` (live) or `sandbox` (test mode). */
  provider: string;
  chainId: number;
  wallet: string;
  srcToken: string;
  dstToken: string;
  amount: string;
  amountPerOrder: string;
  orders: number;
  intervalSeconds: number;
  fees: { ourFeeBps: 0; integratorFeeBps: 0 };
  requestId: string;
  tx: SvmTx;
}

export interface RecurringOrderFill {
  txHash: string;
  amount: string;
  dstAmount: string;
  feeAmount: string;
  feeToken: string | null;
  filledAt: string | null;
}

/** A Solana recurring order (Jupiter Recurring, time-based), read live from Jupiter. Base units throughout. */
export interface RecurringOrder {
  /** The order account. */
  id: string;
  object: "recurring_order";
  provider: "jupiter";
  chainId: number;
  status: "active" | "completed" | "cancelled";
  wallet: string;
  srcToken: string;
  dstToken: string;
  amount: string;
  amountPerOrder: string;
  orders: number;
  ordersFilled: number;
  intervalSeconds: number;
  spentAmount: string;
  withdrawnAmount: string;
  receivedAmount: string;
  openTxHash: string | null;
  closeTxHash: string | null;
  createdAt: string | null;
  fills: RecurringOrderFill[];
}

export interface RecurringOrderList {
  recurringOrders: RecurringOrder[];
  page: number;
  totalPages: number;
}

export type RefundStatus = "pending" | "submitted" | "completed" | "failed";

export interface CreateRefundParams {
  /** Settlement-token base units; default: everything not yet refunded. */
  amount?: string;
  reason?: string;
  /** The wallet that signs and sends the refund (default: the session's payout address). */
  from?: string;
  /** `original` (default): the payer's chain and token. `settlement`: the settlement token on the settlement chain. */
  to?: "original" | "settlement";
}

export interface Refund {
  id: string;
  object: "refund";
  sessionId: string;
  livemode: boolean;
  status: RefundStatus;
  statusDetail: string | null;
  /** Base units of the settlement token. */
  amount: string;
  reason: string | null;
  /** Build it with `buildTx(quoteId)`, sign from `from`, then `reportSubmitted(quoteId, txHash)`. */
  quoteId: string | null;
  to: { chainId: number; token: string; address: string };
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundCreateResponse {
  refund: Refund;
  quote: {
    quoteId: string;
    provider: ProviderId;
    srcAmount: string;
    dstAmount: string;
    dstAmountMin: string;
    estimatedSeconds: number;
    expiresAt: number;
    /** The wallet that must sign the refund. */
    from: string;
  };
  /** What to do next (build, sign, report). */
  next: string;
}

export type StatusComponentState = "operational" | "degraded" | "down";

export interface StatusComponent {
  id: string;
  name: string;
  group: string;
  status: StatusComponentState;
  latencyMs: number | null;
  /** Percent over the last 90 days (null without checks). */
  uptime90d: number | null;
  /** 90 days, oldest first. */
  days: { date: string; uptime: number | null }[];
}

export interface StatusIncident {
  id: string;
  componentId: string;
  component: string;
  title: string;
  startedAt: string;
  resolvedAt: string | null;
}

/** `GET /v1/status` (shown at status.layerhop.com). */
export interface StatusResponse {
  status: "operational" | "degraded" | "outage";
  updatedAt: string;
  components: StatusComponent[];
  /** The last 14 days. */
  incidents: StatusIncident[];
  url: string;
}

/** The JSON body LayerHop POSTs to your webhook endpoints. */
export interface WebhookEventPayload {
  id: string;
  type: WebhookEventType | "webhook.test";
  livemode: boolean;
  /** Present on samples from the dashboard or `trigger`. */
  sample?: boolean;
  createdAt: string;
  data: { order?: OrderSummary; session?: CheckoutSession | null; refund?: Refund; invoice?: Partial<Invoice>; subscription?: Subscription; [k: string]: unknown };
}

/** `webhooks.resend()` result: the deliveries queued (empty when only open streams get it). */
export interface WebhookResendResult {
  eventId: string;
  type: string;
  livemode: boolean;
  deliveries: { id: string; endpointId: string }[];
}

/** Requests per HTTP status class. */
export interface StatusClassCounts {
  "2xx": number;
  "3xx": number;
  "4xx": number;
  "5xx": number;
}

/** Options for `usage.get()`. Times are ISO 8601 or unix seconds. */
export interface UsageParams {
  bucket?: "hour" | "day";
  from?: string;
  to?: string;
  keyId?: string;
}

/** `GET /v1/usage`: the key's account and mode. Latency percentiles are estimates (null without traffic). */
export interface UsageReport {
  bucket: "hour" | "day";
  from: string;
  to: string;
  livemode: boolean;
  keyId: string | null;
  totals: { requests: number; errors: number; byStatusClass: StatusClassCounts; avgMs: number | null; p50Ms: number | null; p95Ms: number | null };
  series: { ts: string; requests: number; errors: number; byStatusClass: StatusClassCounts; p50Ms: number | null; p95Ms: number | null }[];
  byEndpoint: { group: string; requests: number; errors: number; byStatusClass: StatusClassCounts; avgMs: number | null; p50Ms: number | null; p95Ms: number | null }[];
  errorCodes: { code: string; count: number; byEndpoint: Record<string, number> }[];
}

/** One failed request from `usage.errors()`. */
export interface UsageError {
  ts: string;
  keyId: string | null;
  requestId: string;
  method: string;
  path: string;
  endpointGroup: string;
  status: number;
  code: string;
  latencyMs: number;
}

/** A token for `prices()`: `"chainId:address"` or `{ chainId, address }`. */
export type PriceId = string | { chainId: string | number; address: string };

/** Options for `balances()`. */
export interface BalancesOptions {
  /** Tokens always returned, even at zero (at most 20): `"chainId:address"` or `{ chainId, address }`. */
  tokens?: PriceId[];
  /** Skip the server's 20 s balance cache for this request. */
  fresh?: boolean;
}

/** A token as splits and payouts describe it. */
export interface PayoutToken {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  /** USD price when known. */
  usd?: number;
}

export interface CreateSplitParams {
  /** Address, ENS name or `.sol` name of whoever is owed. */
  recipient: string;
  /** Chain slug or id they receive on. */
  chain: string | number;
  /** Listed token symbol or address on that chain. */
  token: string;
  /** Base units of `token`. */
  total: string;
  /** Equal shares for this many people (2–50), or send `shares`. */
  participants?: number;
  /** One entry per person: a label (≤ 40 chars) and, for custom shares, an amount in base units (all or none; they add up to `total`). */
  shares?: { label?: string; amount?: string }[];
  /** Plain text, kept to 140 characters. */
  note?: string;
}

export interface SplitShare {
  /** The share's number from 0 (`splitShare` on quotes). */
  index: number;
  label: string;
  /** Base units of the split's token. */
  amount: string;
  /** Base units delivered by filled orders for this share. */
  received: string;
  /** `paid` within 0.5% of `amount`. */
  status: "unpaid" | "partial" | "paid";
  payments: number;
  pending: number;
}

/** A split bill (`POST /v1/splits`): each participant pays a share with `quote({ purpose: "split", splitId, splitShare })`. */
export interface Split {
  id: string;
  /** The split's page. */
  url: string;
  status: "open" | "closed";
  note: string | null;
  recipient: string;
  /** The ENS / .sol name given at creation. */
  recipientName: string | null;
  chainId: number;
  chain: string;
  token: { address: string; symbol: string; decimals: number };
  total: string;
  collected: string;
  paidCount: number;
  shares: SplitShare[];
  createdAt: string;
  updatedAt: string;
}

/** `createSplit` response: the split plus its edit secret, shown only once. */
export interface SplitCreated extends Split {
  editToken: string;
  /** The split's page with the secret in the URL fragment (`#k=`). */
  editUrl: string;
}

export interface UpdateSplitParams {
  /** `null` clears the note. */
  note?: string | null;
  /** One label per share. */
  labels?: string[];
  /** `closed` stops payments (quotes for it answer `CONFLICT`). */
  status?: "open" | "closed";
}

/** `GET /v1/tip-jars/{address}`: tip counters and the latest 10 messages. */
export interface TipJar {
  address: string;
  tippers: number;
  tips: number;
  messages: { text: string; at: string }[];
}

/** One payout row: `amount` in HUMAN units of `token` ("25", "0.5"). */
export interface PayoutRowInput {
  /** Address, ENS name or .sol name. */
  recipient: string;
  amount: string | number;
  token: string;
  chain: string | number;
  label?: string;
}

export interface PlanPayoutsParams {
  /** The chain the payer pays from. */
  srcChain: string | number;
  /** The token the payer pays with (listed). */
  srcToken: string;
  /** The payer's address on `srcChain`. */
  sender: string;
  /** Up to 100 rows; or send `csv`. */
  rows?: PayoutRowInput[];
  /** `recipient,amount,token,chain[,label]` lines, header optional. */
  csv?: string;
}

export interface PayoutPlanRow {
  /** Row number from 0 (header excluded). */
  index: number;
  /** 1-based CSV line (0 for JSON rows). */
  line: number;
  input: PayoutRowInput;
  ok: boolean;
  error?: { code: string; message: string };
  recipient?: { address: string; name: string | null };
  chainId?: number;
  chain?: string;
  token?: PayoutToken;
  /** Base units of `token`. */
  amount?: string;
  kind?: "transfer" | "route";
}

/** `POST /v1/payouts/plan`: every row checked, valid rows grouped into transfer batches and routes. */
export interface PayoutPlan {
  source: { chainId: number; chain: string; sender: string; token: PayoutToken };
  rows: PayoutPlanRow[];
  /** Build each batch with `buildPayoutTransfers` (no LayerHop fee). */
  transfers: { chainId: number; token: string; rows: number[]; total: string }[];
  /** Quote each row with `quote({ ..., purpose: "payout" })` (normal swap fee). */
  routes: { chainId: number; rows: number[] }[];
  transferTotal: string;
  totals: { chainId: number; token: string; symbol: string; decimals: number; amount: string; formatted: string; rows: number }[];
  valid: number;
  invalid: number;
  warnings: string[];
}

export interface BuildPayoutTransfersParams {
  chain: string | number;
  token: string;
  sender: string;
  /** At most 20 on EVM chains and 8 on Solana; addresses only (resolve names with `planPayouts`). */
  transfers: { recipient: string; amount: string }[];
}

/** One transfer batch for the payer's wallet to sign: EVM `calls` or a Solana `serializedTx`. Nothing is signed. */
export interface PayoutTransfers {
  vm: "evm" | "svm";
  chainId: number;
  token: PayoutToken;
  /** EVM: one call per transfer, in order (send as one EIP-5792 `wallet_sendCalls`, or one tx each). */
  calls?: { to: string; data: string; value: string }[];
  /** Solana: base64 unsigned legacy transaction (one signature slot, the sender's). */
  serializedTx?: string;
}

// ---- Market data (`/v1/market/*`, Berachain and Robinhood Chain; API key required; off unless the API runs with MARKET_API_LIVE=1) ----

/** `berachain` / 80094 or `robinhood` / 4663. */
export type MarketChainId = "berachain" | "robinhood" | 80094 | 4663 | (string & {});
export type MarketInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type MarketWindow = "24h" | "7d";

/** A figure over 5 min, 1 h, 6 h, 24 h (and 7 days as `d7` on the 7-day window / token detail). */
export interface MarketWindowNumbers {
  m5: number | null;
  h1: number | null;
  h6: number | null;
  h24: number | null;
  d7?: number | null;
}

export interface MarketChain {
  chainId: number;
  slug: "berachain" | "robinhood";
  name: string;
  dexes: string[];
  intervals: MarketInterval[];
  /** false when the deployment has no indexer for the chain. */
  available: boolean;
}

export interface MarketToken {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  priceUsd: number | null;
  /** Percent. */
  change: MarketWindowNumbers;
  volumeUsd: MarketWindowNumbers;
  trades: MarketWindowNumbers;
  /** The main (most traded) pool: use it with candles, trades and traders. */
  pool: string | null;
  poolCount: number | null;
  quoteSymbol: string | null;
  /** Unix ms. */
  createdAt: number | null;
}

export interface MarketTokensParams {
  sort?: "trending" | "top" | "new" | "gainers";
  window?: MarketWindow;
  /** Part of a symbol or name, or a token address. */
  q?: string;
  minVolumeUsd?: number;
  minTrades?: number;
  limit?: number;
}

export interface MarketTokenList {
  chainId: number;
  window: MarketWindow;
  sort: string;
  asOf: number | null;
  count: number;
  tokens: MarketToken[];
}

export interface MarketHolders {
  chainId: number;
  token: string;
  status: "ready" | "syncing" | "waiting_for_rpc" | "failed" | "too_large";
  holdersCount: number | null;
  /** Base units. */
  totalSupply: string | null;
  decimals: number | null;
  syncedBlock: number | null;
  partial: boolean;
  progress?: number;
  /** `amount` in base units, `pct` of the total supply. */
  holders: { address: string; amount: string; pct: number | null; tags: string[] }[];
}

export interface MarketPool {
  pool: string;
  token: { address: string; symbol: string | null; name: string | null };
  quoteSymbol: string | null;
  priceUsd: number | null;
  volumeUsd: number;
  trades: number;
}

export interface MarketCandle {
  /** Candle start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** USD. */
  volume: number;
}

export interface MarketCandles {
  chainId: number;
  pool: string;
  token: string | null;
  interval: MarketInterval;
  indexed: boolean;
  candles: MarketCandle[];
}

export interface MarketTrade {
  /** Unix ms. */
  time: number;
  kind: "buy" | "sell";
  usd: number | null;
  tokenAmount: number | null;
  priceUsd: number | null;
  wallet: string | null;
  txHash: string;
  block: number;
  logIndex: number;
  zap?: "add" | "remove";
}

export interface MarketTrades {
  chainId: number;
  pool: string;
  token: string | null;
  indexed: boolean;
  trades: MarketTrade[];
  /** Pass as `before` for older trades; null at the end. */
  next: string | null;
  partial: boolean;
}

export interface MarketTrader {
  wallet: string;
  buys: number | null;
  sells: number | null;
  boughtUsd: number | null;
  soldUsd: number | null;
  /** Base units. */
  boughtTokens: string | null;
  soldTokens: string | null;
  heldTokens: string | null;
  costBasisUsd: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  pnlUsd: number | null;
  /** Unix ms. */
  firstTrade: number | null;
  lastTrade: number | null;
}

export interface MarketTraders {
  chainId: number;
  pool: string;
  token: string | null;
  indexed: boolean;
  asOf: number | null;
  decimals: number | null;
  priceUsd: number | null;
  coverage: { trades: number; withWallet: number; complete: boolean };
  traders: MarketTrader[];
}

export class LayerHopApiError extends Error {
  constructor(
    public readonly code: string, message: string, public readonly status: number, public readonly requestId?: string,
    /** Extra context, e.g. `details.errors` (per-provider errors) on `NO_ROUTE`. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LayerHopApiError";
  }
}

/** Thrown by `constructWebhookEvent` when the `LayerHop-Signature` header does not verify. */
export class WebhookSignatureError extends Error {
  constructor(message = "Invalid LayerHop webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Verify a webhook request and parse its event. Pass the RAW request body (not re-serialized JSON)
 * and the `LayerHop-Signature` header. Throws `WebhookSignatureError` when the signature is
 * missing, wrong or older than `toleranceSec` (default 300 s).
 */
export async function constructWebhookEvent(
  secret: string, header: string | null | undefined, rawBody: string, toleranceSec = 300,
): Promise<WebhookEventPayload> {
  if (!(await verifyWebhookSignature(secret, header, rawBody, toleranceSec))) throw new WebhookSignatureError();
  return JSON.parse(rawBody) as WebhookEventPayload;
}

export class LayerHop {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: LayerHopOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.layerhop.com").replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers["x-api-key"] = this.opts.apiKey;
    const res = await this.fetchFn(`${this.baseUrl}/v1${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (body as { error?: { code: string; message: string; requestId?: string; details?: Record<string, unknown> } }).error;
      throw new LayerHopApiError(e?.code ?? "INTERNAL", e?.message ?? res.statusText, res.status, e?.requestId, e?.details);
    }
    return body as T;
  }

  /** Every chain LayerHop routes (live registry): popular first, then alphabetical. */
  async chains(): Promise<ChainInfo[]> {
    return (await this.call<{ chains: ChainInfo[] }>("/chains")).chains;
  }

  /**
   * Search / list tokens on a chain (LI.FI + Jupiter + curated lists, with prices). Page with
   * `nextCursor`. A bare chain id or slug is shorthand for `{ chain }`.
   */
  tokens(p: TokensParams | string | number): Promise<TokensResponse> {
    const o: TokensParams = typeof p === "object" ? p : { chain: p };
    const q = new URLSearchParams({ chain: String(o.chain) });
    if (o.q) q.set("q", o.q);
    if (o.limit !== undefined) q.set("limit", String(o.limit));
    if (o.cursor) q.set("cursor", o.cursor);
    return this.call(`/tokens?${q}`);
  }

  /**
   * One token by address / mint. Tokens on no list are read on-chain and have `verified: false`.
   * `lookupToken(address)` (or a `null` / `undefined` chain) lets the API find the chain: Solana for a
   * mint, else the supported chain with the most pool liquidity for the address.
   */
  async lookupToken(address: string): Promise<TokenInfo>;
  async lookupToken(chain: string | number | null | undefined, address: string): Promise<TokenInfo>;
  async lookupToken(chainOrAddress: string | number | null | undefined, maybeAddress?: string): Promise<TokenInfo> {
    const [chain, address] = maybeAddress === undefined ? [undefined, String(chainOrAddress ?? "")] : [chainOrAddress, maybeAddress];
    const q = new URLSearchParams(chain === undefined || chain === null || chain === "" ? { address } : { chain: String(chain), address });
    return (await this.call<{ token: TokenInfo }>(`/tokens/lookup?${q}`)).token;
  }

  /**
   * A token's safety report (honeypots, taxes, owner powers, fake majors). `level: "unknown"` means
   * no source answered: never block a swap on it; ask for an explicit confirmation on `danger`.
   */
  async getTokenRisk(chain: string | number, address: string): Promise<TokenRisk> {
    return (await this.call<{ risk: TokenRisk }>(`/tokens/${encodeURIComponent(String(chain))}/${encodeURIComponent(address)}/risk`)).risk;
  }

  // ---- Market data: Berachain and Robinhood Chain from LayerHop's own indexer (API key required) ----

  private market<T>(chain: MarketChainId, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    const qs = q.toString();
    return this.call(`/market/${encodeURIComponent(String(chain))}${path}${qs ? `?${qs}` : ""}`);
  }

  /** Chains with market data (Berachain, Robinhood Chain), their exchanges and candle intervals. */
  async marketChains(): Promise<MarketChain[]> {
    return (await this.call<{ chains: MarketChain[] }>("/market/chains")).chains;
  }

  /** Tokens traded on the chain (trending by default), or a search with `q`. */
  marketTokens(chain: MarketChainId, p: MarketTokensParams = {}): Promise<MarketTokenList> {
    return this.market(chain, "/tokens", { ...p });
  }

  /** One token traded in the last 7 days (`NOT_FOUND` otherwise). */
  async marketToken(chain: MarketChainId, address: string): Promise<MarketToken> {
    return (await this.market<{ token: MarketToken }>(chain, `/tokens/${encodeURIComponent(address)}`)).token;
  }

  /** Largest holders and the holder count; `status: "syncing"` while a new token is counted (ask again shortly). */
  marketHolders(chain: MarketChainId, address: string, p: { limit?: number } = {}): Promise<MarketHolders> {
    return this.market(chain, `/tokens/${encodeURIComponent(address)}/holders`, { ...p });
  }

  /** The most traded pools (each token's main pool) by USD volume. */
  async marketPools(chain: MarketChainId, p: { window?: MarketWindow; limit?: number } = {}): Promise<MarketPool[]> {
    return (await this.market<{ pools: MarketPool[] }>(chain, "/pools", { ...p })).pools;
  }

  /** USD OHLCV candles of a pool, oldest first (`time` in unix seconds). */
  marketCandles(chain: MarketChainId, pool: string, p: { interval?: MarketInterval; limit?: number; token?: string } = {}): Promise<MarketCandles> {
    return this.market(chain, `/pools/${encodeURIComponent(pool)}/candles`, { ...p });
  }

  /** A pool's trades, newest first; page back with `before: page.next`. */
  marketTrades(chain: MarketChainId, pool: string, p: { limit?: number; before?: string; token?: string } = {}): Promise<MarketTrades> {
    return this.market(chain, `/pools/${encodeURIComponent(pool)}/trades`, { ...p });
  }

  /** A pool's top traders by PnL (default), volume, buys or sells. */
  marketTraders(chain: MarketChainId, pool: string, p: { sort?: "pnl" | "volume" | "buys" | "sells"; days?: "all" | 1 | 7 | 30 | 90; limit?: number; token?: string } = {}): Promise<MarketTraders> {
    return this.market(chain, `/pools/${encodeURIComponent(pool)}/traders`, { ...p });
  }

  /**
   * Split a bill: `recipient` is owed `total` of `token`, in equal or custom shares. Public, no key.
   * Keep `editToken` (shown only here) to rename shares or close the split with `updateSplit`.
   */
  createSplit(p: CreateSplitParams): Promise<SplitCreated> {
    return this.call("/splits", { method: "POST", body: JSON.stringify(p) });
  }

  /** A split and who has paid. Public. */
  getSplit(id: string): Promise<Split> {
    return this.call(`/splits/${encodeURIComponent(id)}`);
  }

  /** Rename shares, change the note (`null` clears it) or close / reopen a split, with its edit secret. */
  updateSplit(id: string, editToken: string, p: UpdateSplitParams): Promise<Split> {
    return this.call(`/splits/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(p), headers: { "x-edit-token": editToken } });
  }

  /** Tip jar counters for an address (resolve names first). Public. */
  getTipJar(address: string): Promise<TipJar> {
    return this.call(`/tip-jars/${encodeURIComponent(address)}`);
  }

  /**
   * Check up to 100 payout rows (JSON `rows` or `csv`) and group them against the payer's token:
   * transfer batches (`buildPayoutTransfers`, no fee) and routes (quote each with `purpose: "payout"`).
   */
  planPayouts(p: PlanPayoutsParams): Promise<PayoutPlan> {
    return this.call("/payouts/plan", { method: "POST", body: JSON.stringify(p) });
  }

  /** Build one batch of plain transfers for the payer's wallet to sign. Check each call against its row first. */
  buildPayoutTransfers(p: BuildPayoutTransfersParams): Promise<PayoutTransfers> {
    return this.call("/payouts/transfers", { method: "POST", body: JSON.stringify(p) });
  }

  /** USD prices for up to 100 tokens, keyed by the ids as given (`"chainId:address"`). Unknown ids are omitted. */
  async prices(ids: PriceId[]): Promise<PricesResponse["prices"]> {
    if (ids.length === 0) return {};
    const list = ids.map((i) => (typeof i === "string" ? i : `${i.chainId}:${i.address}`));
    return (await this.call<PricesResponse>(`/prices?${new URLSearchParams({ ids: list.join(",") })}`)).prices;
  }

  /**
   * Non-zero balances of a wallet, highest USD value first. Without `chains`: popular EVM chains for an
   * EVM address, Solana for a Solana address. Chains that fail are listed in `errors`.
   * `tokens` (at most 20) are always returned, even at zero and even when not on any token list;
   * `fresh` skips the server's 20 s cache (use it right after a swap).
   */
  balances(address: string, chains?: (string | number)[], opts: BalancesOptions = {}): Promise<BalancesResponse> {
    const q = new URLSearchParams({ address });
    if (chains?.length) q.set("chains", chains.join(","));
    if (opts.tokens?.length) q.set("tokens", opts.tokens.map((i) => (typeof i === "string" ? i : `${i.chainId}:${i.address}`)).join(","));
    if (opts.fresh) q.set("fresh", "1");
    return this.call(`/balances?${q}`);
  }

  /**
   * Ask every liquidity provider; `best` is the highest output for the user. With `dstAmount` alone
   * (receive an exact amount) `best` is the lowest `srcAmount`. With `dstAmount` and `calls` /
   * `action` (destination calls) this sends `POST /v1/quote`, and only providers that run calls answer.
   */
  quote(p: QuoteParams | ExactOutputQuoteParams | CallsQuoteParams): Promise<QuoteResponse> {
    if ("dstAmount" in p && ("calls" in p || "action" in p) && (p.calls || p.action)) {
      const body: Record<string, unknown> = {
        srcChain: String(p.srcChain), srcToken: p.srcToken, dstChain: String(p.dstChain), dstToken: p.dstToken,
        dstAmount: p.dstAmount, sender: p.sender, recipient: p.recipient, slippageBps: p.slippageBps ?? 50, channel: this.opts.channel ?? "api",
      };
      if (p.calls) body.calls = p.calls;
      if (p.action) body.action = p.action;
      if (this.opts.integrator) body.integrator = this.opts.integrator;
      if (this.opts.integratorFeeBps !== undefined) body.integratorFeeBps = this.opts.integratorFeeBps;
      if (p.referrer) body.referrer = p.referrer;
      if (p.copyOf) body.copyOf = p.copyOf;
      for (const k of ["excludeProviders", "excludeBridges", "excludeExchanges"] as const) if (p[k]?.length) body[k] = p[k];
      return this.call("/quote", { method: "POST", body: JSON.stringify(body) });
    }
    return this.call(`/quote?${this.quoteQuery(p)}`);
  }

  /** `GET /v1/quote` / `GET /v1/quote/stream` query parameters. */
  private quoteQuery(p: QuoteParams | ExactOutputQuoteParams): URLSearchParams {
    const q = new URLSearchParams({
      srcChain: String(p.srcChain), srcToken: p.srcToken, ...("dstAmount" in p ? { dstAmount: p.dstAmount } : { amount: p.amount }),
      dstChain: String(p.dstChain), dstToken: p.dstToken, sender: p.sender, recipient: p.recipient,
      slippageBps: String(p.slippageBps ?? 50), channel: this.opts.channel ?? "api",
    });
    if (this.opts.integrator) q.set("integrator", this.opts.integrator);
    if (this.opts.integratorFeeBps !== undefined) q.set("integratorFeeBps", String(this.opts.integratorFeeBps));
    if (p.referrer) q.set("referrer", p.referrer);
    if (p.copyOf) q.set("copyOf", p.copyOf);
    if ("amount" in p) {
      if (typeof p.gasOnArrival === "number") q.set("gasOnArrivalUsd", String(p.gasOnArrival));
      else if (p.gasOnArrival) q.set("gasOnArrival", "true");
      if (p.gasless) q.set("gasless", "true");
    }
    if (p.purpose) q.set("purpose", p.purpose);
    if (p.splitId !== undefined) q.set("splitId", p.splitId);
    if (p.splitShare !== undefined) q.set("splitShare", String(p.splitShare));
    if (p.note) q.set("note", p.note);
    for (const k of ["excludeProviders", "excludeBridges", "excludeExchanges"] as const) if (p[k]?.length) q.set(k, p[k]!.join(","));
    return q;
  }

  readonly quotes = {
    /**
     * Live quotes (`GET /v1/quote/stream`, D-068): an async iterator that yields a fresh ranked quote
     * set whenever the best route or any amount changes (and before the shown quote expires). Ends
     * after the stream's lifetime (5 minutes); throws `LayerHopApiError` when a refresh fails (e.g.
     * `NO_ROUTE`, `RATE_LIMITED`). Break out of the loop or abort `signal` to stop. Same parameters as
     * `quote()` except destination calls.
     */
    stream: (p: QuoteParams | ExactOutputQuoteParams, opts: QuoteStreamOptions = {}): AsyncGenerator<QuoteStreamUpdate> => {
      const q = this.quoteQuery(p);
      if (opts.intervalMs !== undefined) q.set("intervalMs", String(opts.intervalMs));
      return this.quoteStream(`/quote/stream?${q}`, opts.signal);
    },
  };

  private async *quoteStream(path: string, signal?: AbortSignal): AsyncGenerator<QuoteStreamUpdate> {
    for await (const ev of this.streamEvents(path, ["quote", "error", "end"], signal)) {
      if (ev.event === "quote") yield ev.data as QuoteStreamUpdate;
      else if (ev.event === "error") {
        const d = ev.data as { status?: number; error?: { code?: string; message?: string; requestId?: string; details?: Record<string, unknown> } };
        throw new LayerHopApiError(d.error?.code ?? "INTERNAL", d.error?.message ?? "Quote stream failed", d.status ?? 500, d.error?.requestId, d.error?.details);
      } else return;
    }
  }

  /** `POST /v1/screen`: check up to 100 addresses against the OFAC SDN list (D-069). */
  screen(addresses: string[]): Promise<ScreenResponse> {
    return this.call("/screen", { method: "POST", body: JSON.stringify({ addresses }) });
  }

  /** Gasless quotes: the EIP-712 typed data to sign (an optional `approval`, then `trade`). Records the order. */
  async buildGasless(quoteId: string): Promise<GaslessSignRequest> {
    const r = await this.call<{ gasless?: GaslessSignRequest }>("/orders", { method: "POST", body: JSON.stringify({ quoteId }) });
    if (!r.gasless) throw new Error("This quote is not gasless; use buildTx");
    return r.gasless;
  }

  /** Gasless: send the wallet's `signTypedData` signatures; the provider's relayer sends the tx. */
  submitGasless(quoteId: string, signatures: GaslessSignatures): Promise<GaslessOrderStatus> {
    return this.call("/orders/gasless", { method: "POST", body: JSON.stringify({ quoteId, signatures }) });
  }

  /** Gasless: the order's state; poll until `filled` or `failed`. */
  gaslessStatus(quoteId: string): Promise<GaslessOrderStatus> {
    return this.call(`/orders/gasless/${encodeURIComponent(quoteId)}`);
  }

  /**
   * Get the transaction to sign for a quote. EVM txs may include an `approval` to send first; Tron
   * txs (`vm: "tvm"`) an `approval` transaction. Gasless quotes have no tx: use `buildGasless`.
   */
  async buildTx(quoteId: string): Promise<BuiltTx> {
    const r = await this.call<{ tx?: BuiltTx; gasless?: GaslessSignRequest }>("/orders", { method: "POST", body: JSON.stringify({ quoteId }) });
    if (!r.tx) throw new Error(r.gasless ? "This quote is gasless; use buildGasless" : "The API returned no transaction for this quote");
    return r.tx;
  }

  /** For SvmTx with `submitViaApi`: send the wallet-signed tx (base64) through LayerHop. Returns the tx signature. */
  async submit(quoteId: string, signedTransaction: string): Promise<string> {
    const r = await this.call<{ txHash: string }>("/orders/submit", { method: "POST", body: JSON.stringify({ quoteId, signedTransaction }) });
    return r.txHash;
  }

  /**
   * Tell LayerHop the source tx hash after your wallet broadcast the tx from `buildTx`, so the
   * order is tracked (status, webhooks, partner earnings). Idempotent.
   */
  reportSubmitted(quoteId: string, txHash: string): Promise<SubmittedResponse> {
    return this.call(`/orders/${encodeURIComponent(quoteId)}/submitted`, { method: "POST", body: JSON.stringify({ txHash }) });
  }

  /** Dry-run the tx for a quote (EVM eth_call + estimateGas, Solana simulateTransaction). */
  simulate(quoteId: string): Promise<SimulationResponse> {
    return this.call("/simulate", { method: "POST", body: JSON.stringify({ quoteId }) });
  }

  /** Orders sent from or to an address, newest first. Page with `nextCursor`. */
  listOrders(p: ListOrdersParams): Promise<OrderList> {
    const q = new URLSearchParams({ address: p.address });
    if (p.status) q.set("status", p.status);
    if (p.cursor) q.set("cursor", p.cursor);
    if (p.limit !== undefined) q.set("limit", String(p.limit));
    return this.call(`/orders?${q}`);
  }

  /**
   * Checkout ("pay with any token"). `create`, `list` and `expire` need an API key; `get` and
   * `quote` are public (the payer's side). Pay a quote with `buildTx` + `reportSubmitted` as usual.
   */
  readonly checkout = {
    create: (p: CreateCheckoutParams): Promise<CheckoutSession> =>
      this.call("/checkout/sessions", { method: "POST", body: JSON.stringify(p) }),
    get: (id: string): Promise<CheckoutSession> => this.call(`/checkout/sessions/${encodeURIComponent(id)}`),
    list: (p: { status?: CheckoutStatus; cursor?: string; limit?: number } = {}): Promise<{ sessions: CheckoutSession[]; nextCursor: string | null }> => {
      const q = new URLSearchParams();
      if (p.status) q.set("status", p.status);
      if (p.cursor) q.set("cursor", p.cursor);
      if (p.limit !== undefined) q.set("limit", String(p.limit));
      return this.call(`/checkout/sessions${q.size ? `?${q}` : ""}`);
    },
    expire: (id: string): Promise<CheckoutSession> =>
      this.call(`/checkout/sessions/${encodeURIComponent(id)}/expire`, { method: "POST", body: "{}" }),
    /** Public: show a "Send to address" QR for this session (idempotent); the session with its `transfer`. */
    startTransfer: (id: string): Promise<CheckoutSession> =>
      this.call(`/checkout/sessions/${encodeURIComponent(id)}/transfer`, { method: "POST", body: "{}" }),
    /** Public: show (or refresh, once expired) a Bitcoin deposit address for this session (D-067). */
    startBitcoin: (id: string, p: { refundAddress?: string } = {}): Promise<CheckoutSession> =>
      this.call(`/checkout/sessions/${encodeURIComponent(id)}/bitcoin`, { method: "POST", body: JSON.stringify(p) }),
    quote: (id: string, p: CheckoutQuoteParams): Promise<CheckoutQuoteResponse> =>
      this.call(`/checkout/sessions/${encodeURIComponent(id)}/quote`, { method: "POST", body: JSON.stringify(p) }),
    /**
     * Products: a fixed price for payment buttons, `/buy/{id}` links and plugins. `startSession` is
     * public (no key needed) and can only add a reference and metadata to the product's terms.
     */
    products: {
      create: (p: CreateCheckoutProductParams): Promise<CheckoutProduct> =>
        this.call("/checkout/products", { method: "POST", body: JSON.stringify(p) }),
      get: (id: string): Promise<CheckoutProduct> => this.call(`/checkout/products/${encodeURIComponent(id)}`),
      list: (p: { active?: boolean; cursor?: string; limit?: number } = {}): Promise<{ products: CheckoutProduct[]; nextCursor: string | null }> => {
        const q = new URLSearchParams();
        if (p.active !== undefined) q.set("active", String(p.active));
        if (p.cursor) q.set("cursor", p.cursor);
        if (p.limit !== undefined) q.set("limit", String(p.limit));
        return this.call(`/checkout/products${q.size ? `?${q}` : ""}`);
      },
      update: (id: string, p: Partial<CreateCheckoutProductParams>): Promise<CheckoutProduct> =>
        this.call(`/checkout/products/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(p) }),
      startSession: (id: string, p: { reference?: string; metadata?: Record<string, string> } = {}): Promise<CheckoutSession> =>
        this.call(`/checkout/products/${encodeURIComponent(id)}/sessions`, { method: "POST", body: JSON.stringify(p) }),
    },
    /** Live session status (SSE): yields now and on every change until paid, expired or needs_review. */
    stream: (id: string, opts: { signal?: AbortSignal } = {}): AsyncGenerator<CheckoutSession> =>
      this.stream<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(id)}/events`, "session", opts.signal),
    /**
     * Refunds of paid sessions (API key). Non-custodial: `create` returns a quote that you build with
     * `buildTx`, sign from `quote.from` (your wallet) and report with `reportSubmitted`.
     */
    refunds: {
      create: (sessionId: string, p: CreateRefundParams = {}): Promise<RefundCreateResponse> =>
        this.call(`/checkout/sessions/${encodeURIComponent(sessionId)}/refunds`, { method: "POST", body: JSON.stringify(p) }),
      list: async (sessionId: string): Promise<Refund[]> =>
        (await this.call<{ refunds: Refund[] }>(`/checkout/sessions/${encodeURIComponent(sessionId)}/refunds`)).refunds,
    },
  };

  /**
   * Invoices: line items billed to a customer by email and paid through checkout. `create`, `get`,
   * `list`, `update`, `send` and `void` need an API key; `publicView` and `pay` are public (the
   * customer's side, also behind `layerhop.com/invoice/{id}`).
   */
  readonly invoices = {
    create: (p: CreateInvoiceParams): Promise<Invoice> =>
      this.call("/invoices", { method: "POST", body: JSON.stringify(p) }),
    get: (id: string): Promise<Invoice> => this.call(`/invoices/${encodeURIComponent(id)}`),
    list: (p: { status?: InvoiceStatus; cursor?: string; limit?: number } = {}): Promise<InvoiceList> => {
      const q = new URLSearchParams();
      if (p.status) q.set("status", p.status);
      if (p.cursor) q.set("cursor", p.cursor);
      if (p.limit !== undefined) q.set("limit", String(p.limit));
      return this.call(`/invoices${q.size ? `?${q}` : ""}`);
    },
    /** Drafts only. */
    update: (id: string, p: UpdateInvoiceParams): Promise<Invoice> =>
      this.call(`/invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(p) }),
    /** Finalize a draft (draft → open) and email it; on an open invoice, re-sends the email. */
    send: (id: string): Promise<Invoice> =>
      this.call(`/invoices/${encodeURIComponent(id)}/send`, { method: "POST", body: "{}" }),
    /** Cancel a draft or open invoice (its open checkout session expires). */
    void: (id: string): Promise<Invoice> =>
      this.call(`/invoices/${encodeURIComponent(id)}/void`, { method: "POST", body: "{}" }),
    /** Public: the customer's view of a sent invoice. */
    publicView: (id: string): Promise<PublicInvoice> => this.call(`/invoices/${encodeURIComponent(id)}/public`),
    /** Public: start (or reuse) the checkout session that pays the invoice; send the customer to `url`. */
    pay: (id: string): Promise<InvoicePayResponse> =>
      this.call(`/invoices/${encodeURIComponent(id)}/pay`, { method: "POST", body: "{}" }),
  };

  /**
   * Subscriptions (API key): recurring billing. Crypto can't be pulled from a wallet, so LayerHop
   * issues and emails an invoice every period; the customer pays it with any token. Unpaid past the
   * due date → `past_due` with reminders (day 1 and 3), canceled after 7 days.
   */
  readonly subscriptions = {
    create: (p: CreateSubscriptionParams): Promise<Subscription> =>
      this.call("/subscriptions", { method: "POST", body: JSON.stringify(p) }),
    get: (id: string): Promise<Subscription> => this.call(`/subscriptions/${encodeURIComponent(id)}`),
    list: (p: { status?: SubscriptionStatus; customerEmail?: string; cursor?: string; limit?: number } = {}): Promise<SubscriptionList> => {
      const q = new URLSearchParams();
      if (p.status) q.set("status", p.status);
      if (p.customerEmail) q.set("customerEmail", p.customerEmail);
      if (p.cursor) q.set("cursor", p.cursor);
      if (p.limit !== undefined) q.set("limit", String(p.limit));
      return this.call(`/subscriptions${q.size ? `?${q}` : ""}`);
    },
    update: (id: string, p: UpdateSubscriptionParams): Promise<Subscription> =>
      this.call(`/subscriptions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(p) }),
    /** Cancel now (default) or at the end of the current period (`atPeriodEnd: true`). */
    cancel: (id: string, p: { atPeriodEnd?: boolean } = {}): Promise<Subscription> =>
      this.call(`/subscriptions/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify(p) }),
    /** Active only: no invoices or reminders until resumed. */
    pause: (id: string): Promise<Subscription> =>
      this.call(`/subscriptions/${encodeURIComponent(id)}/pause`, { method: "POST", body: "{}" }),
    /** Paused only: continues the paid period's schedule, or starts a new period now. */
    resume: (id: string): Promise<Subscription> =>
      this.call(`/subscriptions/${encodeURIComponent(id)}/resume`, { method: "POST", body: "{}" }),
    /** The invoices issued for the subscription (up to 100), newest first. */
    invoices: async (id: string): Promise<Invoice[]> =>
      (await this.call<{ invoices: Invoice[] }>(`/subscriptions/${encodeURIComponent(id)}/invoices`)).invoices,
  };

  /**
   * Deposit addresses (beta, API key): your user sends `srcToken` to an address and receives
   * `dstToken` on `dstChain`, without connecting a wallet. Each deposit becomes an order with
   * `depositAddressId` (and the usual `order.*` webhooks). `simulate` works with test keys only.
   */
  readonly depositAddresses = {
    /** `integrator` / `integratorFeeBps` default to the client options, as for `quote`. */
    create: (p: CreateDepositAddressParams): Promise<DepositAddressCreated> =>
      this.call("/deposit-addresses", {
        method: "POST",
        body: JSON.stringify({ integrator: this.opts.integrator, integratorFeeBps: this.opts.integratorFeeBps, ...p }),
      }),
    /** The address and its 20 most recent deposits. */
    get: (id: string): Promise<DepositAddressWithDeposits> => this.call(`/deposit-addresses/${encodeURIComponent(id)}`),
    list: (p: { status?: DepositAddressStatus; label?: string; cursor?: string; limit?: number } = {}): Promise<DepositAddressList> => {
      const q = new URLSearchParams();
      if (p.status) q.set("status", p.status);
      if (p.label) q.set("label", p.label);
      if (p.cursor) q.set("cursor", p.cursor);
      if (p.limit !== undefined) q.set("limit", String(p.limit));
      return this.call(`/deposit-addresses${q.size ? `?${q}` : ""}`);
    },
    /** Check for deposits now (call it when your user says they sent funds). */
    refresh: (id: string): Promise<DepositAddress> =>
      this.call(`/deposit-addresses/${encodeURIComponent(id)}/refresh`, { method: "POST", body: "{}" }),
    /** Stop tracking the address; stop showing it to your user. */
    disable: (id: string): Promise<DepositAddress> =>
      this.call(`/deposit-addresses/${encodeURIComponent(id)}/disable`, { method: "POST", body: "{}" }),
    /** Test mode only: record a deposit of `amount` (ends in 4001 → refunded, 4002 → failed). */
    simulate: async (id: string, p: { amount: string }): Promise<DepositOrder> =>
      (await this.call<{ order: DepositOrder }>(`/deposit-addresses/${encodeURIComponent(id)}/simulate`, { method: "POST", body: JSON.stringify(p) })).order,
  };

  /**
   * Solana recurring buys (beta, Jupiter Recurring, no LayerHop fee). `create` returns an unsigned tx
   * and a `requestId`: have `wallet` sign the tx (sign only), then `submit(requestId, signed)`.
   * `cancel` returns the cancel tx + `requestId`, submitted the same way. Nothing is stored by LayerHop.
   */
  readonly recurringOrders = {
    create: (p: CreateRecurringOrderParams): Promise<RecurringOrderBuild> =>
      this.call("/recurring-orders", { method: "POST", body: JSON.stringify({ ...p, ...(p.chain !== undefined ? { chain: String(p.chain) } : {}) }) }),
    /** Send the wallet-signed create or cancel tx (base64) with its `requestId`. */
    submit: (requestId: string, signedTransaction: string): Promise<{ txHash: string; order: string | null }> =>
      this.call("/recurring-orders/submit", { method: "POST", body: JSON.stringify({ requestId, signedTransaction }) }),
    list: (p: { wallet: string; status?: "active" | "history"; page?: number }): Promise<RecurringOrderList> => {
      const q = new URLSearchParams({ wallet: p.wallet });
      if (p.status) q.set("status", p.status);
      if (p.page !== undefined) q.set("page", String(p.page));
      return this.call(`/recurring-orders?${q}`);
    },
    cancel: (id: string, wallet: string): Promise<{ requestId: string; tx: SvmTx }> =>
      this.call(`/recurring-orders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ wallet }) }),
  };

  /**
   * Limit orders (beta). Solana (Jupiter Trigger): `create` returns an unsigned tx; have `wallet` sign
   * it (sign only, `tx.submitViaApi`), then `submit` it. EVM (CoW Protocol, `chain` = an EVM chain):
   * `create` returns `typedData` to sign; `submit` the `{ signature }`. `cancel` returns the cancel tx
   * (Solana) or cancellation `typedData` (EVM) to sign and `submit` the same way. An API key is
   * optional; `simulate` works with test keys only.
   */
  readonly limitOrders = {
    /** `integrator` / `integratorFeeBps` default to the client options and `channel` to the client channel. */
    create: (p: CreateLimitOrderParams): Promise<LimitOrderCreated> =>
      this.call("/limit-orders", {
        method: "POST",
        body: JSON.stringify({
          channel: this.opts.channel ?? "api", integrator: this.opts.integrator, integratorFeeBps: this.opts.integratorFeeBps,
          ...p, ...(p.chain !== undefined ? { chain: String(p.chain) } : {}),
        }),
      }),
    /**
     * Send the wallet's signature of the create or cancel step: the signed Solana tx (base64), or
     * `{ signature }` for EVM. Returns the order and the tx signature (null for EVM: off chain).
     */
    submit: (id: string, signed: LimitOrderSignature): Promise<{ limitOrder: LimitOrder; txHash: string | null }> =>
      this.call(`/limit-orders/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify(typeof signed === "string" ? { signedTransaction: signed } : signed) }),
    /** The order and its fills. */
    get: (id: string): Promise<LimitOrderWithFills> => this.call(`/limit-orders/${encodeURIComponent(id)}`),
    /** Orders of `wallet`, or without it your API key's account. */
    list: (p: { wallet?: string; status?: LimitOrderStatus; cursor?: string; limit?: number } = {}): Promise<LimitOrderList> => {
      const q = new URLSearchParams();
      if (p.wallet) q.set("wallet", p.wallet);
      if (p.status) q.set("status", p.status);
      if (p.cursor) q.set("cursor", p.cursor);
      if (p.limit !== undefined) q.set("limit", String(p.limit));
      return this.call(`/limit-orders${q.size ? `?${q}` : ""}`);
    },
    /**
     * An open order: the cancel tx (Solana) or cancellation `typedData` (EVM) to sign and `submit`.
     * A never-submitted order is cancelled at once (`tx: null`, no `typedData`).
     */
    cancel: (id: string): Promise<{ limitOrder: LimitOrder; tx: SvmTx | null; typedData?: Eip712TypedData }> =>
      this.call(`/limit-orders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
    /** Test mode only: fill, half-fill or expire an open order (applied by the worker within seconds). */
    simulate: (id: string, outcome: "fill" | "partial_fill" | "expire"): Promise<LimitOrder> =>
      this.call(`/limit-orders/${encodeURIComponent(id)}/simulate`, { method: "POST", body: JSON.stringify({ outcome }) }),
  };

  /**
   * Live order status (Server-Sent Events): yields the order now and on every change, and ends when
   * it is final (filled, refunded, failed, expired or dropped). Pass an AbortSignal to stop early.
   */
  streamOrder(quoteId: string, opts: { signal?: AbortSignal } = {}): AsyncGenerator<OrderSummary> {
    return this.stream<OrderSummary>(`/orders/${encodeURIComponent(quoteId)}/events`, "order", opts.signal);
  }

  /** Webhook developer tools with an API key (the CLI's `listen`, `trigger` and `events resend`). */
  readonly webhooks = {
    /**
     * Your account's webhook events (the key's mode) as they are created, with the exact payloads,
     * plus events resent later. `since` (ISO time, at most an hour back) first replays missed events.
     */
    stream: (opts: { signal?: AbortSignal; since?: string } = {}): AsyncGenerator<WebhookEventPayload> =>
      this.stream<WebhookEventPayload>(`/webhooks/stream${opts.since ? `?${new URLSearchParams({ since: opts.since })}` : ""}`, "event", opts.signal),
    /** A sample event in test mode (test keys only): sent to your test endpoints and open streams. */
    trigger: (type: WebhookEventType): Promise<{ eventId: string; deliveries: number; payload: WebhookEventPayload }> =>
      this.call("/webhooks/trigger", { method: "POST", body: JSON.stringify({ type }) }),
    /** Send an event of the key's mode again: to subscribed endpoints (or `endpointId`) and open streams. */
    resend: (eventId: string, opts: { endpointId?: string } = {}): Promise<WebhookResendResult> =>
      this.call(`/webhooks/events/${encodeURIComponent(eventId)}/resend`, { method: "POST", body: JSON.stringify(opts.endpointId ? { endpointId: opts.endpointId } : {}) }),
  };

  /** Usage and errors of the key's own account and mode (the dashboard's Usage page). */
  readonly usage = {
    /** Requests per hour or day with status classes, p50 / p95 latency, endpoint groups and error codes. */
    get: (p: UsageParams = {}): Promise<UsageReport> => {
      const q = new URLSearchParams();
      for (const k of ["bucket", "from", "to", "keyId"] as const) if (p[k]) q.set(k, String(p[k]));
      return this.call(`/usage${q.size ? `?${q}` : ""}`);
    },
    /** The newest failed requests with a stable error code (code, endpoint, time, requestId). */
    errors: async (p: { code?: string; keyId?: string; limit?: number } = {}): Promise<UsageError[]> => {
      const q = new URLSearchParams();
      if (p.code) q.set("code", p.code);
      if (p.keyId) q.set("keyId", p.keyId);
      if (p.limit !== undefined) q.set("limit", String(p.limit));
      return (await this.call<{ errors: UsageError[] }>(`/usage/errors${q.size ? `?${q}` : ""}`)).errors;
    },
  };

  /** Read a Server-Sent Events stream, yielding the JSON data of `event` frames. */
  private async *stream<T>(path: string, event: string, signal?: AbortSignal): AsyncGenerator<T> {
    for await (const ev of this.streamEvents(path, [event], signal)) yield ev.data as T;
  }

  /** Read a Server-Sent Events stream, yielding `{ event, data }` for frames named in `events`. */
  private async *streamEvents(path: string, events: readonly string[], signal?: AbortSignal): AsyncGenerator<SseEvent> {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (this.opts.apiKey) headers["x-api-key"] = this.opts.apiKey;
    const url = `${this.baseUrl}/v1${path}`;
    if (this.streamTransport() === "xhr") {
      yield* xhrEventStream(url, headers, events, signal);
      return;
    }
    const res = await this.fetchFn(url, { headers, signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; requestId?: string; details?: Record<string, unknown> } };
      throw new LayerHopApiError(body.error?.code ?? "INTERNAL", body.error?.message ?? res.statusText, res.status, body.error?.requestId, body.error?.details);
    }
    const parser = new SseParser(events);
    if (!res.body || typeof res.body.getReader !== "function" || typeof TextDecoder === "undefined") {
      // A fetch without streaming bodies (e.g. whatwg-fetch): the text arrives when the stream ends.
      for (const item of parser.push(await res.text())) yield item;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const item of parser.push(decoder.decode(value, { stream: true }))) yield item;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  /** `fetch` or `xhr` for SSE streams (see `LayerHopOptions.streaming`). */
  private streamTransport(): "fetch" | "xhr" {
    const mode = this.opts.streaming ?? "auto";
    if (mode !== "auto") return mode;
    if (this.opts.fetch || typeof XMLHttpRequest === "undefined") return "fetch";
    const nav = (globalThis as { navigator?: { product?: string } }).navigator;
    if (nav?.product === "ReactNative") return "xhr";
    const fetchStreams = typeof ReadableStream !== "undefined" && typeof TextDecoder !== "undefined"
      && typeof Response !== "undefined" && "body" in Response.prototype;
    return fetchStreams ? "fetch" : "xhr";
  }

  /** A provider order's status. */
  status(provider: ProviderId, id: string): Promise<OrderStatus> {
    return this.call(`/orders/${provider}/${encodeURIComponent(id)}`);
  }

  /** Platform status (`GET /v1/status`, shown at status.layerhop.com). Public. */
  serviceStatus(): Promise<StatusResponse> {
    return this.call("/status");
  }

  /** Poll until the order is final (filled/refunded/failed/dropped), yielding each change. */
  async *watch(provider: ProviderId, id: string, { intervalMs = 3000, timeoutMs = 30 * 60_000 } = {}): AsyncGenerator<OrderStatus> {
    const end = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < end) {
      const s = await this.status(provider, id);
      if (s.state !== last) {
        last = s.state;
        yield s;
      }
      if (s.state === "filled" || s.state === "refunded" || s.state === "failed" || s.state === "dropped") return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

interface SseEvent { event: string; data: unknown }

/** Incremental Server-Sent Events parser: feed text chunks, get `{ event, data }` (JSON) of the frames named in `events`. */
class SseParser {
  private buf = "";
  constructor(private readonly events: readonly string[]) {}

  push(chunk: string): SseEvent[] {
    let s = this.buf + chunk;
    // A chunk may end between "\r" and "\n"; keep the "\r" until the next chunk decides.
    const hold = s.endsWith("\r") ? "\r" : "";
    if (hold) s = s.slice(0, -1);
    s = s.replace(/\r\n?/g, "\n");
    const out: SseEvent[] = [];
    let i: number;
    while ((i = s.indexOf("\n\n")) >= 0) {
      const frame = s.slice(0, i);
      s = s.slice(i + 2);
      let name = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (this.events.includes(name) && data.length) out.push({ event: name, data: JSON.parse(data.join("\n")) });
    }
    this.buf = s + hold;
    return out;
  }
}

function apiErrorFromText(status: number, text: string, statusText: string): LayerHopApiError {
  let e: { code?: string; message?: string; requestId?: string; details?: Record<string, unknown> } | undefined;
  try {
    e = (JSON.parse(text) as { error?: typeof e }).error;
  } catch {
    e = undefined;
  }
  return new LayerHopApiError(e?.code ?? "INTERNAL", e?.message ?? statusText, status, e?.requestId, e?.details);
}

/**
 * SSE over XMLHttpRequest progress events, for runtimes whose `fetch` can't stream (React Native
 * delivers `responseText` incrementally once a readystatechange/progress handler is set).
 * Network failures throw a `TypeError`, like `fetch`, so callers retry them.
 */
async function* xhrEventStream(url: string, headers: Record<string, string>, events: readonly string[], signal?: AbortSignal): AsyncGenerator<SseEvent> {
  if (signal?.aborted) return;
  const parser = new SseParser(events);
  const queue: SseEvent[] = [];
  let finished = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const xhr = new XMLHttpRequest();
  let seen = 0;
  const ok = () => xhr.status >= 200 && xhr.status < 300;
  const drain = () => {
    const text = xhr.responseText ?? "";
    if (!ok() || text.length <= seen) return;
    try {
      queue.push(...parser.push(text.slice(seen)));
    } catch (e) {
      failure = e;
    }
    seen = text.length;
  };
  xhr.open("GET", url);
  for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
  xhr.onreadystatechange = () => {
    if (xhr.readyState >= 3) drain();
    if (xhr.readyState === 4 && !finished) {
      finished = true;
      if (xhr.status === 0) failure ??= new TypeError("Network request failed");
      else if (!ok()) failure ??= apiErrorFromText(xhr.status, xhr.responseText ?? "", xhr.statusText);
    }
    notify();
  };
  xhr.onprogress = () => {
    drain();
    notify();
  };
  xhr.onerror = () => {
    finished = true;
    failure ??= new TypeError("Network request failed");
    notify();
  };
  const onAbort = () => {
    finished = true;
    xhr.abort();
    notify();
  };
  signal?.addEventListener("abort", onAbort);
  xhr.send();
  try {
    for (;;) {
      while (queue.length && !signal?.aborted) yield queue.shift()!;
      if (signal?.aborted) return;
      if (failure) throw failure;
      if (finished) return;
      await new Promise<void>((r) => (wake = r));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!finished) {
      finished = true;
      xhr.abort();
    }
  }
}
