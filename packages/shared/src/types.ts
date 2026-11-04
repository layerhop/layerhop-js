import type { QuoteAvoid } from "./avoid.js";

export type ChainId = number;
/** Virtual machine family: EVM chains, Solana (`svm`) and Tron (`tvm`, D-048; behind TRON_ENABLED). */
export type Vm = "evm" | "svm" | "tvm";
/** VMs whose wallet signatures LayerHop verifies (sign-in, scam reports, trade feed opt-in). Not Tron yet. */
export type WalletVm = Exclude<Vm, "tvm">;

export type ProviderId = "jupiter" | "relay" | "debridge" | "mayan" | "zerox" | "kyberswap" | "odos" | "lifi" | "blast-native" | "across" | "mock" | "sandbox" | "direct";

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
   * amount of `dstToken` delivered on the destination ("receive exact amount", and always with
   * destination calls, D-029). Only providers with `exactOutput` (or `destinationCalls` for calls) quote it.
   */
  tradeType?: TradeType;
  /**
   * Destination calls (D-029): contract calls run on the destination chain with the output, in
   * order, by the provider's executor contract (msg.sender is the executor, never the user). Only
   * providers with `destinationCalls` quote such requests; always paired with `EXACT_OUTPUT`.
   */
  calls?: EvmCall[];
  /**
   * Gasless (D-043): the user signs EIP-712 typed data instead of sending a transaction, and the
   * provider's relayer pays the network fee out of `srcToken`. Only providers with `gasless` quote
   * such requests (EVM same-chain, ERC-20 input).
   */
  gasless?: boolean;
  /**
   * Providers, bridges and exchanges the user never wants this route to use (`excludeProviders`,
   * `excludeBridges`, `excludeExchanges`; see avoid.ts). The API skips avoided providers; providers
   * that route through third-party venues (LI.FI) pass the rest on and never return a route through one.
   */
  avoid?: QuoteAvoid;
}

/** EIP-712 typed data exactly as a provider returned it (sign it unchanged with `eth_signTypedData_v4`). */
export interface Eip712TypedData {
  types: Record<string, { name: string; type: string }[]>;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
}

/** One typed-data payload of a gasless order, with the provider's label for it. */
export interface GaslessSignable {
  /** Provider's kind, e.g. 0x `permit` / `executeMetaTransaction::approve` / `settler_metatransaction`. */
  type: string;
  eip712: Eip712TypedData;
}

/** What the wallet signs for a gasless quote (D-043). No transaction is sent by the user. */
export interface GaslessSignRequest {
  chainId: ChainId;
  /** Gasless token approval (EIP-2612 permit or meta-tx approve), signed first. Absent when the allowance is already set. */
  approval?: GaslessSignable;
  trade: GaslessSignable;
  /** Network fee the relayer takes from the input token (base units of `token`). */
  gasFee?: { amount: string; token: string };
}

/** Wallet signatures for a gasless order: 65-byte hex `0x{r}{s}{v}` from `eth_signTypedData_v4`. */
export interface GaslessSignatures {
  trade: string;
  approval?: string;
}

/** A gasless order's state at the provider; `srcTxHash` once the relayer broadcast it. */
export interface GaslessStatus {
  state: OrderState;
  srcTxHash?: string;
  /** Provider's failure reason, e.g. `order_expired`. */
  reason?: string;
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
  /**
   * Token class the LayerHop fee was priced on (D-058): `stable`, `major` or `longtail`. Present only
   * when fee tiers are on (FEE_TIERS_JSON).
   */
  tier?: "stable" | "major" | "longtail";
  /**
   * Who receives positive slippage (output above `dstAmount`), when the provider documents it (D-030).
   * - `user`: the recipient keeps all of it.
   * - `layerhop`: surplus ABOVE `dstAmount` goes to LayerHop, capped at `surplusMaxBps` of `dstAmount`;
   *   the user still receives at least `dstAmount` whenever execution reaches it (never less than the quote
   *   because of capture). Only with POSITIVE_SLIPPAGE_CAPTURE=1.
   * - `provider`: the provider keeps it (e.g. KyberSwap documents that surplus accrues to KyberSwap).
   * Absent when the provider does not document a policy.
   */
  surplusPolicy?: SurplusPolicy;
  /** With `surplusPolicy: "layerhop"`: the most LayerHop can take, in bps of `dstAmount`. */
  surplusMaxBps?: number;
}

export type SurplusPolicy = "user" | "layerhop" | "provider";

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

/**
 * One Tron smart-contract call (a `TriggerSmartContract`), as the wallet sends it. Addresses are
 * base58check T-addresses; amounts are integer strings in sun (1 TRX = 1,000,000 sun).
 */
export interface TronCall {
  /** Contract called (T-address). */
  to: string;
  /** ABI calldata, `0x` hex (4-byte selector + arguments). */
  data: string;
  /** TRX sent with the call, sun. */
  value: string;
  /**
   * Most TRX the network may burn for this call's energy, sun (`fee_limit`). Computed from a
   * simulation when one succeeded, else a conservative default. Unused TRX is not burned.
   */
  feeLimit: string;
}

/**
 * An unsigned Tron transaction exactly as the node built it (TronWeb's transaction object). Sign it
 * unchanged (`tronWeb.trx.sign(tx)` / TronLink) and broadcast; it expires at `raw_data.expiration`.
 */
export interface TronUnsignedTx {
  /** sha256 of `raw_data_hex`, hex without 0x (the tx hash once broadcast). */
  txID: string;
  /** Protobuf-encoded raw transaction, hex. This is what gets signed. */
  raw_data_hex: string;
  /** Decoded `raw_data` (contract, ref block, expiration, fee_limit). */
  raw_data: Record<string, unknown>;
  visible?: boolean;
}

/** A TRC-20 approval the Tron wallet must send before the main call (a separate transaction). */
export interface TronApproval {
  /** TRC-20 token (T-address). */
  token: string;
  /** Spender (T-address). */
  spender: string;
  /** Allowance granted, base units. */
  amount: string;
  /** The `approve` call itself. */
  call: TronCall;
  /** Prebuilt unsigned tx for `call` (set by buildTx; absent on quotes). */
  unsigned?: TronUnsignedTx;
}

/**
 * Tron transaction(s) for a quote (D-048). The wallet sends `approval` first when present, then the
 * main call. Each call is also given prebuilt (`unsigned`) by `POST /v1/orders`; a wallet may
 * instead rebuild from `call` with its own node (fresh reference block), the result is equivalent.
 */
export type TronTx = {
  vm: "tvm";
  chainId: ChainId;
  /** Owner (signer) of every call, T-address. */
  from: string;
  /** The main call (Relay: the deposit into its depository). */
  call: TronCall;
  /** Prebuilt unsigned tx for `call` (set by buildTx). */
  unsigned?: TronUnsignedTx;
  approval?: TronApproval;
  /** Test mode only: a placeholder that moves no funds. Never broadcast it. */
  sandbox?: true;
};

export type BuiltTx = EvmTx | SvmTx | TronTx;

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
  /**
   * `EXACT_OUTPUT` quotes: the most the transaction can take from the sender (base units of srcToken),
   * slippage included; >= srcAmount. Balance and approval checks use it. Defaults to srcAmount.
   */
  srcAmountMax?: string;
  /** Set when the request had destination calls and this provider will run them. */
  calls?: DestinationCallsPlan;
  /** Some providers return the transaction together with the quote. */
  tx?: BuiltTx;
  /**
   * The provider's id for tracking this order when its status API can't find it by the source tx
   * hash (Relay requestId on Tron-source routes, D-048). Stored on the order (`providerRef`) and
   * passed to `status()` instead of the hash.
   */
  orderRef?: string;
  /** Gasless quotes (request.gasless): typed data to sign instead of `tx`. */
  gasless?: GaslessSignRequest;
  /** Provider-specific data needed by buildTx / status (never sent to clients). */
  raw?: unknown;
}

/**
 * `dropped` (D-051) is never reported by a provider: the API answers it for a LayerHop order whose
 * source transaction never reached the network (the worker marked the order `dropped`).
 */
export type OrderState = "pending" | "filled" | "refunded" | "failed" | "unknown" | "dropped";

export interface OrderStatus {
  provider: ProviderId;
  id: string;
  state: OrderState;
  srcTxHash?: string;
  dstTxHash?: string;
}

export interface FeeRecipients {
  evm?: string; // EVM address receiving our fees (0x, KyberSwap, Relay, deBridge EVM, LI.FI, Across)
  svm?: string; // Solana address receiving our fees (deBridge Solana, Mayan)
  /** Tron T-address receiving our fees (FEE_RECIPIENT_TVM): deBridge on a Tron source (D-048). Unset: deBridge never quotes Tron. */
  tvm?: string;
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
  rpc?: {
    solana?: string;
    /** RPC_URL_<chainId> overrides for EVM reads (e.g. blast-native status checks L1 and Blast receipts). */
    env?: Record<string, string | undefined>;
    /** Tron node HTTP API (TronGrid), for providers that build Tron txs (D-048). */
    tron?: TronApiConfig;
  };
  /**
   * D-030 positive-slippage capture (POSITIVE_SLIPPAGE_CAPTURE=1, default off). When set, providers with an
   * official surplus-recipient parameter send surplus above the quoted output to `feeRecipients`, capped at
   * `maxBps` of the quoted output. Absent = off: the user keeps whatever the provider gives them.
   */
  surplusCapture?: { maxBps: number };
}

/** A Tron full-node HTTP API (TronGrid by default) and its optional `TRON-PRO-API-KEY`. */
export interface TronApiConfig {
  url: string;
  apiKey?: string;
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
  /**
   * Quotes `tradeType: "EXACT_OUTPUT"` without calls ("receive exact amount"): the quote carries
   * `srcAmount` (+ `srcAmountMax`) and `dstAmountMin` >= the requested amount. Providers without it
   * are skipped for such requests, never faked. Our fee bps must be the same as for exact input.
   */
  readonly exactOutput?: boolean;
  supports(req: QuoteRequest): boolean;
  quote(req: QuoteRequest, ctx: ProviderContext): Promise<ProviderQuote>;
  /** Build the tx for a quote. Must return quote.tx if the provider already supplied it. */
  buildTx(quote: ProviderQuote, ctx: ProviderContext): Promise<BuiltTx>;
  /** id = provider order id or source tx hash, whatever the provider tracks by. */
  status(id: string, ctx: ProviderContext): Promise<OrderStatus>;
  /** Only for providers whose txs set `submitViaApi`: forward a user-signed tx (base64). */
  submit?(quote: ProviderQuote, signedTx: string, ctx: ProviderContext): Promise<{ txHash: string }>;
  /**
   * Quotes `request.gasless` (D-043): the quote carries `gasless` typed data instead of `tx`.
   * Providers without it are skipped for gasless requests.
   */
  readonly gasless?: boolean;
  /** Gasless: relay the wallet's signatures. Returns the provider's order id (0x: the trade hash). */
  submitGasless?(quote: ProviderQuote, sigs: GaslessSignatures, ctx: ProviderContext): Promise<{ orderId: string }>;
  /** Gasless: the order's state by provider order id. */
  gaslessStatus?(quote: ProviderQuote, orderId: string, ctx: ProviderContext): Promise<GaslessStatus>;
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
