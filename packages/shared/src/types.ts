export type ChainId = number;
export type Vm = "evm" | "svm";

export type ProviderId = "jupiter" | "relay" | "debridge" | "mayan" | "zerox" | "kyberswap" | "odos" | "lifi" | "mock";

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

export type EvmTx = {
  vm: "evm";
  chainId: ChainId;
  to: string;
  data: string;
  value: string; // wei, integer string
  /** ERC-20 approval the user must grant before sending `to/data`. */
  approval?: { token: string; spender: string; amount: string };
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
  supports(req: QuoteRequest): boolean;
  quote(req: QuoteRequest, ctx: ProviderContext): Promise<ProviderQuote>;
  /** Build the tx for a quote. Must return quote.tx if the provider already supplied it. */
  buildTx(quote: ProviderQuote, ctx: ProviderContext): Promise<BuiltTx>;
  /** id = provider order id or source tx hash, whatever the provider tracks by. */
  status(id: string, ctx: ProviderContext): Promise<OrderStatus>;
  /** Only for providers whose txs set `submitViaApi`: forward a user-signed tx (base64). */
  submit?(quote: ProviderQuote, signedTx: string, ctx: ProviderContext): Promise<{ txHash: string }>;
}
