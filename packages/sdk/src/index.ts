import { verifyWebhookSignature } from "@layerhop/shared";
import type {
  BalancesResponse, BuiltTx, ChainInfo, FeeBreakdown, FeeChannel, GasOnArrival, OrderStatus, PricesResponse, ProviderId, SvmTx, TokenInfo, TokensResponse,
} from "@layerhop/shared";

export type {
  BuiltTx, EvmTx, EvmCall, SvmTx, OrderStatus, ProviderId, FeeChannel, FeeBreakdown, GasOnArrival,
  ChainInfo, OnlyRoute, TokenInfo, Balance, TokensResponse, PricesResponse, BalancesResponse,
  ChainRouteHealth, RouteHealthState, RouteHealthStatus,
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
export {
  CHAINS, TOKENS, getChain, findToken, SOLANA_CHAIN_ID, EVM_NATIVE, SOL_NATIVE, HYPERLIQUID_CHAIN_ID,
  gasOnArrivalApplies, DEFAULT_GAS_ON_ARRIVAL_USD,
  SETTLEMENT_TOKENS, findSettlementToken, SANDBOX_MAGIC_AMOUNTS,
  verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_EVENT_HEADER, WEBHOOK_DELIVERY_HEADER,
} from "@layerhop/shared";

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
}

/**
 * Destination calls: an exact-output quote whose output is used by contract calls on the destination
 * chain, run by the provider's executor (msg.sender is the executor, not the user). Send `calls` or
 * `action`. See the destination-calls guide for the trust model.
 */
export interface CallsQuoteParams extends Omit<QuoteParams, "amount" | "gasOnArrival"> {
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
  /** What the sender pays (base units of srcToken), on destination-call quotes. */
  srcAmount?: string;
  /** Destination calls the provider will run (when the request had `calls` / `action`). */
  calls?: DestinationCallsPlan;
}

export interface QuoteResponse {
  best: Quote;
  quotes: Quote[];
  errors: { provider: string; code: string; message: string }[];
  /** Present only when the request was served, but not exactly as asked (e.g. `GAS_ON_ARRIVAL_UNAVAILABLE`). Ignore codes you don't know. */
  warnings?: { code: string; message: string }[];
  /** false when the request used an `lh_test_` key (sandbox quotes). */
  livemode?: boolean;
}

/** Lifecycle of an order recorded by the API (docs/PLATFORM_SPEC.md "Orders"). */
export type OrderLifecycleStatus = "built" | "submitted" | "pending" | "filled" | "refunded" | "failed" | "expired";

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
  vm: "evm" | "svm";
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
    quoteId: string;
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
  createdAt: string;
  updatedAt: string;
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
  | "order.submitted" | "order.filled" | "order.refunded" | "order.failed"
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
  /** The maker wallet (base58): signs the order and receives the output. */
  wallet: string;
  /** Token to sell: mint, curated symbol (`USDC`) or `SOL`. */
  srcToken: string;
  /** Token to buy. Our fee applies when it is SOL, USDC or USDT. */
  dstToken: string;
  /** Base units of `srcToken` to sell (worth at least $5). */
  amount: string;
  /** Minimum base units of `dstToken` for the whole `amount`: the limit price is `dstAmount / amount`. */
  dstAmount: string;
  /** Unix seconds, at least 60 s ahead. Omit for good-till-cancelled. */
  expiresAt?: number;
  /** Only `solana` for now (the default). */
  chain?: string | number;
  /** Up to 20 string key-value pairs. */
  metadata?: Record<string, string>;
  /** Partner id whose fee applies, as for quotes. */
  integrator?: string;
  /** Partner fee in bps (up to your partner `maxFeeBps`), as for quotes. */
  integratorFeeBps?: number;
}

/** A Solana limit order (Jupiter Trigger). Fills are orders whose `quoteId` starts with `lof_`. */
export interface LimitOrder {
  id: string;
  object: "limit_order";
  livemode: boolean;
  status: LimitOrderStatus;
  statusDetail: string | null;
  /** `jupiter` (live) or `sandbox` (test mode). */
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
  /** Set once a cancel tx was submitted; the status turns `cancelled` when the provider confirms. */
  cancelTxHash: string | null;
  channel: FeeChannel;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

/** `create` response: the order plus the unsigned tx (`submitViaApi: true`) for `wallet` to sign. */
export interface LimitOrderCreated extends LimitOrder {
  tx: SvmTx;
}

export interface LimitOrderWithFills extends LimitOrder {
  fills: OrderSummary[];
}

export interface LimitOrderList {
  limitOrders: LimitOrder[];
  nextCursor: string | null;
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

/** A token for `prices()`: `"chainId:address"` or `{ chainId, address }`. */
export type PriceId = string | { chainId: string | number; address: string };

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

  /** One token by address / mint. Tokens on no list are read on-chain and have `verified: false`. */
  async lookupToken(chain: string | number, address: string): Promise<TokenInfo> {
    const q = new URLSearchParams({ chain: String(chain), address });
    return (await this.call<{ token: TokenInfo }>(`/tokens/lookup?${q}`)).token;
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
   */
  balances(address: string, chains?: (string | number)[]): Promise<BalancesResponse> {
    const q = new URLSearchParams({ address });
    if (chains?.length) q.set("chains", chains.join(","));
    return this.call(`/balances?${q}`);
  }

  /**
   * Ask every liquidity provider; `best` is the highest output for the user. With `dstAmount` and
   * `calls` / `action` (destination calls) this sends `POST /v1/quote`, and only providers that run
   * calls answer.
   */
  quote(p: QuoteParams | CallsQuoteParams): Promise<QuoteResponse> {
    if ("dstAmount" in p) {
      const body: Record<string, unknown> = {
        srcChain: String(p.srcChain), srcToken: p.srcToken, dstChain: String(p.dstChain), dstToken: p.dstToken,
        dstAmount: p.dstAmount, sender: p.sender, recipient: p.recipient, slippageBps: p.slippageBps ?? 50, channel: this.opts.channel ?? "api",
      };
      if (p.calls) body.calls = p.calls;
      if (p.action) body.action = p.action;
      if (this.opts.integrator) body.integrator = this.opts.integrator;
      if (this.opts.integratorFeeBps !== undefined) body.integratorFeeBps = this.opts.integratorFeeBps;
      return this.call("/quote", { method: "POST", body: JSON.stringify(body) });
    }
    const q = new URLSearchParams({
      srcChain: String(p.srcChain), srcToken: p.srcToken, amount: p.amount,
      dstChain: String(p.dstChain), dstToken: p.dstToken, sender: p.sender, recipient: p.recipient,
      slippageBps: String(p.slippageBps ?? 50), channel: this.opts.channel ?? "api",
    });
    if (this.opts.integrator) q.set("integrator", this.opts.integrator);
    if (this.opts.integratorFeeBps !== undefined) q.set("integratorFeeBps", String(this.opts.integratorFeeBps));
    if (typeof p.gasOnArrival === "number") q.set("gasOnArrivalUsd", String(p.gasOnArrival));
    else if (p.gasOnArrival) q.set("gasOnArrival", "true");
    return this.call(`/quote?${q}`);
  }

  /** Get the transaction to sign for a quote. EVM txs may include an `approval` to send first. */
  async buildTx(quoteId: string): Promise<BuiltTx> {
    return (await this.call<{ tx: BuiltTx }>("/orders", { method: "POST", body: JSON.stringify({ quoteId }) })).tx;
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
   * Solana limit orders (beta, Jupiter Trigger). `create` returns an unsigned tx: have `wallet` sign it
   * (sign only, `tx.submitViaApi`), then `submit` it. `cancel` returns the cancel tx to sign and
   * `submit` the same way. An API key is optional; `simulate` works with test keys only.
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
    /** Send the wallet-signed create or cancel tx (base64). Returns the order and the tx signature. */
    submit: (id: string, signedTransaction: string): Promise<{ limitOrder: LimitOrder; txHash: string }> =>
      this.call(`/limit-orders/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify({ signedTransaction }) }),
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
    /** An open order: the cancel tx to sign and `submit`. A never-submitted order is cancelled at once (`tx: null`). */
    cancel: (id: string): Promise<{ limitOrder: LimitOrder; tx: SvmTx | null }> =>
      this.call(`/limit-orders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
    /** Test mode only: fill, half-fill or expire an open order (applied by the worker within seconds). */
    simulate: (id: string, outcome: "fill" | "partial_fill" | "expire"): Promise<LimitOrder> =>
      this.call(`/limit-orders/${encodeURIComponent(id)}/simulate`, { method: "POST", body: JSON.stringify({ outcome }) }),
  };

  /**
   * Live order status (Server-Sent Events): yields the order now and on every change, and ends when
   * it is final (filled, refunded, failed or expired). Pass an AbortSignal to stop early.
   */
  streamOrder(quoteId: string, opts: { signal?: AbortSignal } = {}): AsyncGenerator<OrderSummary> {
    return this.stream<OrderSummary>(`/orders/${encodeURIComponent(quoteId)}/events`, "order", opts.signal);
  }

  /** Webhook developer tools with an API key (the CLI's `listen` and `trigger`). */
  readonly webhooks = {
    /** Your account's webhook events (the key's mode) as they are created, with the exact payloads. */
    stream: (opts: { signal?: AbortSignal } = {}): AsyncGenerator<WebhookEventPayload> =>
      this.stream<WebhookEventPayload>("/webhooks/stream", "event", opts.signal),
    /** A sample event in test mode (test keys only): sent to your test endpoints and open streams. */
    trigger: (type: WebhookEventType): Promise<{ eventId: string; deliveries: number; payload: WebhookEventPayload }> =>
      this.call("/webhooks/trigger", { method: "POST", body: JSON.stringify({ type }) }),
  };

  /** Read a Server-Sent Events stream, yielding the JSON data of `event` frames. */
  private async *stream<T>(path: string, event: string, signal?: AbortSignal): AsyncGenerator<T> {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (this.opts.apiKey) headers["x-api-key"] = this.opts.apiKey;
    const url = `${this.baseUrl}/v1${path}`;
    if (this.streamTransport() === "xhr") {
      yield* xhrEventStream<T>(url, headers, event, signal);
      return;
    }
    const res = await this.fetchFn(url, { headers, signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; requestId?: string; details?: Record<string, unknown> } };
      throw new LayerHopApiError(body.error?.code ?? "INTERNAL", body.error?.message ?? res.statusText, res.status, body.error?.requestId, body.error?.details);
    }
    const parser = new SseParser(event);
    if (!res.body || typeof res.body.getReader !== "function" || typeof TextDecoder === "undefined") {
      // A fetch without streaming bodies (e.g. whatwg-fetch): the text arrives when the stream ends.
      for (const item of parser.push(await res.text())) yield item as T;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const item of parser.push(decoder.decode(value, { stream: true }))) yield item as T;
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

  /** Poll until the order is final (filled/refunded/failed), yielding each change. */
  async *watch(provider: ProviderId, id: string, { intervalMs = 3000, timeoutMs = 30 * 60_000 } = {}): AsyncGenerator<OrderStatus> {
    const end = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < end) {
      const s = await this.status(provider, id);
      if (s.state !== last) {
        last = s.state;
        yield s;
      }
      if (s.state === "filled" || s.state === "refunded" || s.state === "failed") return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/** Incremental Server-Sent Events parser: feed text chunks, get the JSON data of `event` frames. */
class SseParser {
  private buf = "";
  constructor(private readonly event: string) {}

  push(chunk: string): unknown[] {
    let s = this.buf + chunk;
    // A chunk may end between "\r" and "\n"; keep the "\r" until the next chunk decides.
    const hold = s.endsWith("\r") ? "\r" : "";
    if (hold) s = s.slice(0, -1);
    s = s.replace(/\r\n?/g, "\n");
    const out: unknown[] = [];
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
      if (name === this.event && data.length) out.push(JSON.parse(data.join("\n")));
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
async function* xhrEventStream<T>(url: string, headers: Record<string, string>, event: string, signal?: AbortSignal): AsyncGenerator<T> {
  if (signal?.aborted) return;
  const parser = new SseParser(event);
  const queue: unknown[] = [];
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
      while (queue.length && !signal?.aborted) yield queue.shift() as T;
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
