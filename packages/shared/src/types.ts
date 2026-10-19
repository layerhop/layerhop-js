export type ChainId = number;
export type Vm = "evm" | "svm";

export type ProviderId = "jupiter" | "relay" | "debridge" | "mayan" | "zerox" | "kyberswap" | "odos" | "lifi" | "mock" | "sandbox" | "direct";

/** Where the trade came from — decides our fee (see docs/BOOTSTRAP_PLAN.md). */
export type FeeChannel = "web" | "widget" | "bot" | "api";

export interface QuoteRequest {
  srcChainId: ChainId;
  srcToken: string; // address / mint
  amount: string; // integer string, base units of srcToken
  dstChainId: ChainId;
  dstToken: string;
  sender: string;
  recipient: string;
  slippageBps: number;
  channel: FeeChannel;
  /**
   * Gas on arrival: also deliver this much (USD) of the destination chain's native gas token to the
   * recipient. Only cross-chain routes to an EVM chain with a non-native output honour it
   * (`gasOnArrivalApplies`); providers that can't do it ignore it.
   */
  gasOnArrivalUsd?: number;
  /**
   * `EXACT_INPUT` (default): `amount` is what the sender pays. `EXACT_OUTPUT`: `amount` is the exact
   * amount of `dstToken` delivered on the destination (used with destination calls, D-029).
   */
  tradeType?: TradeType;
  /**
   * Destination calls (D-029): contract calls run on the destination chain with the output, in
   * order, by the provider's executor contract (msg.sender is the executor, never the user). Only
   * providers with `destinationCalls` quote such requests; always paired with `EXACT_OUTPUT`.
   */
  calls?: EvmCall[];
}

export type TradeType = "EXACT_INPUT" | "EXACT_OUTPUT";

/** How a provider will run a quote's destination calls. */
export interface DestinationCallsPlan {
  /** The calls, exactly as the provider committed to them. */
  items: EvmCall[];
  /** Contract that receives the output and makes the calls (their msg.sender). */
  executor: string;
}

/** Native gas a quote delivers on top of `dstAmount` (gas on arrival). */
export interface GasOnArrival {
  /** Base units of the destination chain's native token, integer string. */
  amount: string;
  /** Native token address on the destination chain (EVM: 0x000…000). */
  token: string;
  symbol: string;
  decimals: number;
  /** USD value at quote time. */
  usd?: number;
}

export interface FeeBreakdown {
  /** LayerHop's fee in bps of input amount. */
  ourFeeBps: number;
  /** Provider/protocol fees in USD when the provider reports them. */
  providerFeeUsd?: number;
  /** Estimated network gas in USD when known. */
  gasUsd?: number;
  /** Partner (integrator) fee in bps of input amount, on top of ourFeeBps (D-020). */
  integratorFeeBps?: number;
  /** Partner id that earns integratorFeeBps. */
  integrator?: string;
}

/** A plain EVM call: target, calldata, native value (wei, integer string). */
export type EvmCall = { to: string; data: string; value: string };

export type EvmTx = {
  vm: "evm";
  chainId: ChainId;
  to: string;
  data: string;
  value: string; // wei, integer string
  /** ERC-20 approval the user must grant before sending `to/data`. */
  approval?: { token: string; spender: string; amount: string };
  /**
   * Further calls to send after `to/data`, in order, from the same wallet (e.g. LayerHop's fee
   * transfer on a same-token checkout payment). Wallets with EIP-5792 `wallet_sendCalls` may batch
   * them with the main call; otherwise each is its own transaction.
   */
  extraTxs?: EvmCall[];
  /** Test mode only: a placeholder that moves no funds. Never broadcast it. */
  sandbox?: true;
};

export type SvmTx = {
  vm: "svm";
  /** base64 serialized VersionedTransaction, to be signed by the user's wallet. */
  serializedTx: string;
  /**
   * When true, the wallet must only SIGN; the client then sends the signed tx to
   * `POST /v1/orders/submit` (e.g. Jupiter RFQ/gasless txs are co-signed by Jupiter and
   * never land via plain RPC).
   */
  submitViaApi?: boolean;
  /** Test mode only: a placeholder that moves no funds (and cannot land on chain). Never broadcast it. */
  sandbox?: true;
};

export type BuiltTx = EvmTx | SvmTx;

export interface ProviderQuote {
  provider: ProviderId;
  request: QuoteRequest;
  dstAmount: string; // expected output, base units
  dstAmountMin: string; // after slippage
  estimatedSeconds: number;
  fees: FeeBreakdown;
  expiresAt: number; // unix seconds
  /** Set when the route also delivers native gas to the recipient (request.gasOnArrivalUsd). */
  gasOnArrival?: GasOnArrival;
  /**
   * What the sender pays, base units of srcToken. Set on `EXACT_OUTPUT` quotes, where
   * `request.amount` is the destination amount; otherwise the input is `request.amount`.
   */
  srcAmount?: string;
  /** Set when the request had destination calls and this provider will run them. */
  calls?: DestinationCallsPlan;
  /** Some providers return the transaction together with the quote. */
  tx?: BuiltTx;
  /** Provider-specific data needed by buildTx / status (never sent to clients). */
  raw?: unknown;
}

export type OrderState = "pending" | "filled" | "refunded" | "failed" | "unknown";

export interface OrderStatus {
  provider: ProviderId;
  id: string;
  state: OrderState;
  srcTxHash?: string;
  dstTxHash?: string;
}

export interface FeeRecipients {
  evm?: string; // EVM address receiving our fees (0x, KyberSwap, Relay, deBridge EVM, LI.FI)
  svm?: string; // Solana address receiving our fees (deBridge Solana, Mayan)
  jupiterReferralAccount?: string; // Jupiter Ultra-project referral account, used by the /order path (min 50 bps)
  /** mint → token account for Jupiter /build platform fees (any bps, no Jupiter cut). Preferred when set. */
  jupiterFeeAccounts?: Record<string, string>;
  /**
   * mint → referral token account under Jupiter's Trigger project, for limit-order fees (Trigger V1
   * `feeAccount`, output mint only). Must exist on chain: the program rejects the order otherwise.
   */
  jupiterTriggerFeeAccounts?: Record<string, string>;
}

export interface ProviderContext {
  feeBps: number;
  feeRecipients: FeeRecipients;
  apiKeys: Partial<Record<ProviderId, string>>;
  fetch: typeof fetch;
  signal?: AbortSignal;
  /** RPC endpoints for providers that build txs client-side (e.g. Mayan's Solana path needs a blockhash + account reads). */
  rpc?: { solana?: string };
}

/** Every liquidity source (partner today, our own solver later) implements this. */
export interface RouteProvider {
  readonly id: ProviderId;
  readonly name: string;
  /**
   * Runs `request.calls` on the destination with an exact-output quote (D-029). Providers without it
   * are skipped when a request has calls or `tradeType: "EXACT_OUTPUT"`.
   */
  readonly destinationCalls?: boolean;
  supports(req: QuoteRequest): boolean;
  quote(req: QuoteRequest, ctx: ProviderContext): Promise<ProviderQuote>;
  /** Build the tx for a quote. Must return quote.tx if the provider already supplied it. */
  buildTx(quote: ProviderQuote, ctx: ProviderContext): Promise<BuiltTx>;
  /** id = provider order id or source tx hash, whatever the provider tracks by. */
  status(id: string, ctx: ProviderContext): Promise<OrderStatus>;
  /** Only for providers whose txs set `submitViaApi`: forward a user-signed tx (base64). */
  submit?(quote: ProviderQuote, signedTx: string, ctx: ProviderContext): Promise<{ txHash: string }>;
}

/** A deposit address request (D-024): the end user sends `srcToken`, the provider delivers `dstToken`. */
export interface DepositAddressRequest {
  srcChainId: ChainId;
  srcToken: string;
  dstChainId: ChainId;
  dstToken: string;
  recipient: string;
  /** Refunds go here (an address on the source chain). */
  refundTo: string;
  /** Reusable (open) addresses accept any amount; one-time (strict) addresses expect exactly this. */
  amount: string;
  reusable: boolean;
}

export interface CreatedDepositAddress {
  address: string;
  /** Provider reference for the address (Relay: quote-time request id). */
  providerRef?: string;
  /** Combined fee (ours + partner) the provider accepted, in bps of the input. */
  feeBps: number;
  /** Estimate for `amount`. */
  dstAmount: string;
  dstAmountMin: string;
  estimatedSeconds: number;
}

/** One deposit the provider saw on an address. */
export interface ObservedDeposit {
  /** Provider request id; stable per deposit. */
  id: string;
  state: OrderState;
  /** The request was replaced by a newer one (track that one instead). */
  superseded: boolean;
  amount?: string;
  dstAmount?: string;
  sender?: string;
  srcTxHash?: string;
  dstTxHash?: string;
  /** bps of the input actually paid to LayerHop's fee recipient (0 when the provider dropped it). */
  appliedFeeBps: number;
  createdAt?: string;
}

export interface DepositAddressProvider {
  readonly id: ProviderId;
  supports(req: Pick<DepositAddressRequest, "srcChainId" | "dstChainId">): boolean;
  create(req: DepositAddressRequest, ctx: ProviderContext): Promise<CreatedDepositAddress>;
  deposits(address: string, ctx: ProviderContext): Promise<ObservedDeposit[]>;
}
