import {
  LayerHop,
  LayerHopApiError,
  type CheckoutSession,
  type CreateCheckoutParams,
  type CreateDepositAddressParams,
  type DepositAddress,
  type DepositAddressCreated,
  type DepositAddressList,
  type DepositAddressStatus,
  type DepositAddressWithDeposits,
  type DepositOrder,
  type PriceId,
  type QuoteResponse,
} from "@layerhop/sdk";
import { CHAINS, TOKENS, type BuiltTx, type Chain, type OrderStatus, type PricesResponse, type ProviderId, type Token, type TokensResponse } from "@layerhop/shared";

export interface ClientOptions {
  apiUrl: string;
  apiKey?: string;
  /** Partner id (`[a-z0-9-]{1,32}`) sent on every quote so the integrator earns its partner fee. */
  integrator?: string;
  /** Partner fee override in bps (honored only with a partner's API key, within its maxFeeBps). */
  integratorFeeBps?: number;
  fetch?: typeof fetch;
  userAgent?: string;
}

/** The API answered 404 without a JSON error: this deployment does not have the endpoint yet. */
export class EndpointUnavailableError extends Error {
  constructor(public readonly endpoint: string) {
    super(`This LayerHop API (${endpoint}) does not support this operation yet.`);
    this.name = "EndpointUnavailableError";
  }
}

export interface SimulateResult {
  ok: boolean;
  vm: "evm" | "svm";
  gasEstimate?: string | number;
  computeUnits?: number;
  needsApproval?: boolean;
  error?: { code: string; message: string; logs?: string[] };
  tx?: BuiltTx;
}

export interface ListOrdersParams {
  address: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

/** Methods the SDK gains with docs/PLATFORM_SPEC.md. Used when present, raw HTTP otherwise. */
interface SdkPlatformMethods {
  reportSubmitted?: (quoteId: string, txHash: string) => Promise<unknown>;
  simulate?: (quoteId: string) => Promise<unknown>;
  listOrders?: (p: ListOrdersParams) => Promise<unknown>;
}

const META_TTL_MS = 5 * 60_000;

/**
 * Thin wrapper around `@layerhop/sdk`: read-only calls plus the order lifecycle endpoints.
 * Nothing in here can sign or broadcast a transaction.
 */
export class LayerHopClient {
  readonly sdk: LayerHop;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private chainsCache?: { at: number; chains: Chain[] };
  private readonly tokensCache = new Map<number, { at: number; tokens: Token[] }>();

  constructor(private readonly opts: ClientOptions) {
    this.baseUrl = opts.apiUrl.replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.sdk = new LayerHop({
      baseUrl: this.baseUrl,
      apiKey: opts.apiKey,
      channel: "api",
      integrator: opts.integrator,
      integratorFeeBps: opts.integratorFeeBps,
      fetch: this.fetchFn,
    });
  }

  get apiUrl(): string {
    return this.baseUrl;
  }

  /** Which kind of API key this client sends (never the key itself). */
  get keyMode(): "test" | "live" | "none" {
    const k = this.opts.apiKey;
    if (!k) return "none";
    return k.startsWith("lh_test_") ? "test" : "live";
  }

  private async raw<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers["x-api-key"] = this.opts.apiKey;
    if (this.opts.userAgent) headers["user-agent"] = this.opts.userAgent;
    const res = await this.fetchFn(`${this.baseUrl}/v1${path}`, { ...init, headers });
    const text = await res.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      const e = (body as { error?: { code: string; message: string; requestId?: string } }).error;
      if (res.status === 404 && !e) throw new EndpointUnavailableError(`${init?.method ?? "GET"} /v1${path.split("?")[0]}`);
      throw new LayerHopApiError(e?.code ?? "INTERNAL", e?.message ?? res.statusText, res.status, e?.requestId);
    }
    return body as T;
  }

  /** Live chain list, cached 5 min; falls back to the built-in registry if the API is unreachable. */
  async chains(): Promise<Chain[]> {
    if (this.chainsCache && Date.now() - this.chainsCache.at < META_TTL_MS) return this.chainsCache.chains;
    try {
      const r = await this.raw<{ chains: Chain[] }>("/chains");
      if (Array.isArray(r.chains) && r.chains.length) {
        this.chainsCache = { at: Date.now(), chains: r.chains };
        return r.chains;
      }
    } catch {
      /* fall back below */
    }
    return [...CHAINS];
  }

  async chain(idOrSlug: string | number): Promise<Chain | undefined> {
    const q = String(idOrSlug).trim().toLowerCase();
    const all = await this.chains();
    return all.find((c) => String(c.id) === q || c.slug === q || c.name.toLowerCase() === q);
  }

  async tokens(chainId: number): Promise<Token[]> {
    const hit = this.tokensCache.get(chainId);
    if (hit && Date.now() - hit.at < META_TTL_MS) return hit.tokens;
    try {
      const r = await this.raw<{ tokens: Token[] }>(`/tokens?chain=${chainId}`);
      if (Array.isArray(r.tokens)) {
        this.tokensCache.set(chainId, { at: Date.now(), tokens: r.tokens });
        return r.tokens;
      }
    } catch {
      /* fall back below */
    }
    return TOKENS.filter((t) => t.chainId === chainId);
  }

  async token(chainId: number, symbolOrAddress: string): Promise<Token | undefined> {
    const q = symbolOrAddress.trim().toLowerCase();
    return (await this.tokens(chainId)).find((t) => t.symbol.toLowerCase() === q || t.address.toLowerCase() === q);
  }

  quote(p: Parameters<LayerHop["quote"]>[0]): Promise<QuoteResponse> {
    return this.sdk.quote(p);
  }

  /** POST /v1/orders: turns a quote into an unsigned transaction. Does not sign or send anything. */
  buildOrder(quoteId: string): Promise<{ quoteId: string; provider: ProviderId; tx: BuiltTx }> {
    return this.raw("/orders", { method: "POST", body: JSON.stringify({ quoteId }) });
  }

  status(provider: ProviderId, id: string): Promise<OrderStatus> {
    return this.sdk.status(provider, id);
  }

  private platform(): SdkPlatformMethods {
    return this.sdk as unknown as SdkPlatformMethods;
  }

  /**
   * Calls an SDK platform method, mapping "404 without a JSON error" (the SDK reports it as code
   * INTERNAL) to EndpointUnavailableError, exactly like `raw()` does.
   */
  private async viaSdk<T>(fn: () => Promise<T>, label: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LayerHopApiError && e.status === 404 && e.code === "INTERNAL") throw new EndpointUnavailableError(label);
      throw e;
    }
  }

  async reportSubmitted(quoteId: string, txHash: string): Promise<{ quoteId: string; status: string }> {
    const m = this.platform().reportSubmitted;
    if (typeof m === "function") {
      const r = await this.viaSdk(() => m.call(this.sdk, quoteId, txHash), `POST /v1/orders/${quoteId}/submitted`);
      return r && typeof r === "object" ? (r as { quoteId: string; status: string }) : { quoteId, status: "submitted" };
    }
    return this.raw(`/orders/${encodeURIComponent(quoteId)}/submitted`, { method: "POST", body: JSON.stringify({ txHash }) });
  }

  async simulate(quoteId: string): Promise<SimulateResult> {
    const m = this.platform().simulate;
    if (typeof m === "function") return (await this.viaSdk(() => m.call(this.sdk, quoteId), "POST /v1/simulate")) as SimulateResult;
    return this.raw("/simulate", { method: "POST", body: JSON.stringify({ quoteId }) });
  }

  async listOrders(p: ListOrdersParams): Promise<{ orders: Record<string, unknown>[]; nextCursor?: string | null }> {
    const m = this.platform().listOrders;
    const r =
      typeof m === "function"
        ? await this.viaSdk(() => m.call(this.sdk, p), "GET /v1/orders")
        : await this.raw<unknown>(
            `/orders?${new URLSearchParams(
              Object.entries({ address: p.address, status: p.status, cursor: p.cursor, limit: p.limit?.toString() }).filter(
                (e): e is [string, string] => e[1] !== undefined,
              ),
            )}`,
          );
    if (Array.isArray(r)) return { orders: r as Record<string, unknown>[] };
    const o = r as { orders?: Record<string, unknown>[]; nextCursor?: string | null };
    return { orders: o.orders ?? [], nextCursor: o.nextCursor ?? null };
  }

  /** Token search across LayerHop's lists (with prices), e.g. by symbol or name. */
  searchTokens(chainId: number, q?: string, limit?: number): Promise<TokensResponse> {
    return this.sdk.tokens({ chain: chainId, ...(q ? { q } : {}), ...(limit !== undefined ? { limit } : {}) });
  }

  /** USD prices keyed by "chainId:address". */
  prices(ids: PriceId[]): Promise<PricesResponse["prices"]> {
    return this.sdk.prices(ids);
  }

  // ---------- checkout (API key required) ----------

  createCheckout(p: CreateCheckoutParams): Promise<CheckoutSession> {
    return this.viaSdk(() => this.sdk.checkout.create(p), "POST /v1/checkout/sessions");
  }

  // ---------- deposit addresses (API key required) ----------

  createDepositAddress(p: CreateDepositAddressParams): Promise<DepositAddressCreated> {
    return this.viaSdk(() => this.sdk.depositAddresses.create(p), "POST /v1/deposit-addresses");
  }

  listDepositAddresses(p: { status?: DepositAddressStatus; label?: string; cursor?: string; limit?: number }): Promise<DepositAddressList> {
    return this.viaSdk(() => this.sdk.depositAddresses.list(p), "GET /v1/deposit-addresses");
  }

  getDepositAddress(id: string): Promise<DepositAddressWithDeposits> {
    return this.viaSdk(() => this.sdk.depositAddresses.get(id), "GET /v1/deposit-addresses/{id}");
  }

  refreshDepositAddress(id: string): Promise<DepositAddress> {
    return this.viaSdk(() => this.sdk.depositAddresses.refresh(id), "POST /v1/deposit-addresses/{id}/refresh");
  }

  disableDepositAddress(id: string): Promise<DepositAddress> {
    return this.viaSdk(() => this.sdk.depositAddresses.disable(id), "POST /v1/deposit-addresses/{id}/disable");
  }

  simulateDeposit(id: string, amount: string): Promise<DepositOrder> {
    return this.viaSdk(() => this.sdk.depositAddresses.simulate(id, { amount }), "POST /v1/deposit-addresses/{id}/simulate");
  }

  /** Fetch a text document (e.g. docs llms.txt). */
  async text(url: string): Promise<string> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.text();
  }
}
