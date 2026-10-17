import type {
  BalancesResponse, BuiltTx, ChainInfo, FeeBreakdown, FeeChannel, OrderStatus, PricesResponse, ProviderId, TokenInfo, TokensResponse,
} from "@layerhop/shared";

export type {
  BuiltTx, EvmTx, SvmTx, OrderStatus, ProviderId, FeeChannel, FeeBreakdown,
  ChainInfo, TokenInfo, Balance, TokensResponse, PricesResponse, BalancesResponse,
} from "@layerhop/shared";
export { CHAINS, TOKENS, getChain, findToken, SOLANA_CHAIN_ID, EVM_NATIVE, SOL_NATIVE } from "@layerhop/shared";

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
}

export interface Quote {
  quoteId: string;
  provider: ProviderId;
  dstAmount: string;
  dstAmountMin: string;
  estimatedSeconds: number;
  fees: FeeBreakdown;
  expiresAt: number;
}

export interface QuoteResponse {
  best: Quote;
  quotes: Quote[];
  errors: { provider: string; code: string; message: string }[];
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

/** A token for `prices()`: `"chainId:address"` or `{ chainId, address }`. */
export type PriceId = string | { chainId: string | number; address: string };

export class LayerHopApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly requestId?: string) {
    super(message);
    this.name = "LayerHopApiError";
  }
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
      const e = (body as { error?: { code: string; message: string; requestId?: string } }).error;
      throw new LayerHopApiError(e?.code ?? "INTERNAL", e?.message ?? res.statusText, res.status, e?.requestId);
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

  /** Ask every liquidity provider; `best` is the highest output for the user. */
  quote(p: QuoteParams): Promise<QuoteResponse> {
    const q = new URLSearchParams({
      srcChain: String(p.srcChain), srcToken: p.srcToken, amount: p.amount,
      dstChain: String(p.dstChain), dstToken: p.dstToken, sender: p.sender, recipient: p.recipient,
      slippageBps: String(p.slippageBps ?? 50), channel: this.opts.channel ?? "api",
    });
    if (this.opts.integrator) q.set("integrator", this.opts.integrator);
    if (this.opts.integratorFeeBps !== undefined) q.set("integratorFeeBps", String(this.opts.integratorFeeBps));
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

  status(provider: ProviderId, id: string): Promise<OrderStatus> {
    return this.call(`/orders/${provider}/${encodeURIComponent(id)}`);
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
