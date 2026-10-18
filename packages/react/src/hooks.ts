import {
  LayerHopApiError,
  type BuiltTx,
  type OrderStatus,
  type ProviderId,
  type QuoteParams,
  type QuoteResponse,
  type OrderSummary,
} from "@layerhop/sdk";
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isFinalState, loadChains, loadTokens, type Chain, type Token } from "./client.js";
import { useLayerHop } from "./provider.js";

/** Query-key roots, exported so apps can invalidate them. */
export const layerhopKeys = {
  all: ["layerhop"] as const,
  chains: () => ["layerhop", "chains"] as const,
  tokens: (chain: string | number) => ["layerhop", "tokens", String(chain)] as const,
  quote: (p: QuoteParams) => ["layerhop", "quote", p] as const,
  status: (provider: string, id: string) => ["layerhop", "status", provider, id] as const,
};

/** Don't retry client errors (bad params, no route, expired quote); retry 5xx twice. */
function retryServerErrors(count: number, err: Error): boolean {
  if (err instanceof LayerHopApiError && err.status < 500) return false;
  return count < 2;
}

/** Every chain LayerHop routes. Cached for the session. */
export function useChains(): UseQueryResult<readonly Chain[]> {
  const client = useLayerHop();
  return useQuery({ queryKey: layerhopKeys.chains(), queryFn: () => loadChains(client), staleTime: Infinity, retry: retryServerErrors });
}

/** The built-in token list for one chain (id or slug). Disabled while `chain` is empty. */
export function useTokens(chain: string | number | null | undefined): UseQueryResult<readonly Token[]> {
  const client = useLayerHop();
  return useQuery({
    queryKey: layerhopKeys.tokens(chain ?? ""),
    queryFn: () => loadTokens(client, chain as string | number),
    enabled: chain !== null && chain !== undefined && chain !== "",
    staleTime: Infinity,
    retry: retryServerErrors,
  });
}

export interface UseQuoteOptions {
  /** Extra gate on top of "params are complete". Default true. */
  enabled?: boolean;
  /**
   * `"auto"` (default) refetches shortly before the best quote's `expiresAt`, so the quote on
   * screen is always buildable. A number is a fixed interval in ms; `false` disables refetching.
   */
  refetchInterval?: "auto" | number | false;
  /** Seconds before `expiresAt` to refresh in auto mode. Default 5. */
  refreshMarginSeconds?: number;
}

/** Ms until the auto refetch: `expiresAt - margin`, at least 1 s. */
export function autoRefetchMs(expiresAt: number, marginSeconds = 5, now = Date.now()): number {
  return Math.max(1000, expiresAt * 1000 - marginSeconds * 1000 - now);
}

function isComplete(p: Partial<QuoteParams> | null | undefined): p is QuoteParams {
  return !!p && !!p.srcChain && !!p.srcToken && !!p.dstChain && !!p.dstToken && !!p.sender && !!p.recipient
    && typeof p.amount === "string" && /^\d+$/.test(p.amount) && BigInt(p.amount) > 0n;
}

/**
 * Quotes from every provider, best first. Pass `undefined` (or incomplete params) to stay idle.
 * `amount` is an integer string in base units.
 */
export function useQuote(params: Partial<QuoteParams> | null | undefined, opts: UseQuoteOptions = {}): UseQueryResult<QuoteResponse> {
  const client = useLayerHop();
  const { enabled = true, refetchInterval = "auto", refreshMarginSeconds = 5 } = opts;
  const ready = isComplete(params);
  return useQuery({
    queryKey: layerhopKeys.quote((params ?? {}) as QuoteParams),
    queryFn: () => client.quote(params as QuoteParams),
    enabled: enabled && ready,
    retry: retryServerErrors,
    refetchInterval: (query) => {
      if (refetchInterval !== "auto") return refetchInterval;
      const best = query.state.data?.best;
      return best ? autoRefetchMs(best.expiresAt, refreshMarginSeconds) : false;
    },
  });
}

/** `mutate(quoteId)` → the transaction for the user's wallet to sign. */
export function useBuildTx(): UseMutationResult<BuiltTx, Error, string> {
  const client = useLayerHop();
  return useMutation({ mutationFn: (quoteId: string) => client.buildTx(quoteId) });
}

export interface UseOrderStatusOptions {
  enabled?: boolean;
  /** Poll interval in ms. Default 3000. Polling stops once the state is final. */
  intervalMs?: number;
}

/** Polls an order until it is `filled`, `refunded` or `failed`. Idle while `provider` or `id` is empty. */
export function useOrderStatus(
  provider: ProviderId | null | undefined,
  id: string | null | undefined,
  opts: UseOrderStatusOptions = {},
): UseQueryResult<OrderStatus> & { isFinal: boolean } {
  const client = useLayerHop();
  const { enabled = true, intervalMs = 3000 } = opts;
  const q = useQuery({
    queryKey: layerhopKeys.status(provider ?? "", id ?? ""),
    queryFn: () => client.status(provider as ProviderId, id as string),
    enabled: enabled && !!provider && !!id,
    retry: retryServerErrors,
    refetchInterval: (query) => (isFinalState(query.state.data?.state) ? false : intervalMs),
  });
  return Object.assign(q, { isFinal: isFinalState(q.data?.state) });
}

const ORDER_FINAL = new Set(["filled", "refunded", "failed", "expired"]);

export interface OrderStreamState {
  /** The latest order (null until the first event). */
  order: OrderSummary | null;
  /** The last error; the hook keeps reconnecting with backoff until the order is final. */
  error: Error | null;
  /** True while a stream is open. */
  connected: boolean;
  /** filled, refunded, failed or expired: the stream is closed for good. */
  isFinal: boolean;
}

/**
 * Live order status over Server-Sent Events (`GET /v1/orders/{quoteId}/events`): updates the moment
 * the order changes, reconnects after network errors (1 s, 2 s, 4 s … up to 30 s) and stops once the
 * order is final. Idle while `quoteId` is empty. Needs `@layerhop/sdk` 0.3 or later.
 */
export function useOrderStream(quoteId: string | null | undefined): OrderStreamState {
  const client = useLayerHop();
  const [state, setState] = useState<OrderStreamState>({ order: null, error: null, connected: false, isFinal: false });
  useEffect(() => {
    if (!quoteId) return;
    if (typeof client.streamOrder !== "function") {
      setState((s) => ({ ...s, error: new Error("useOrderStream needs @layerhop/sdk 0.3+ (client.streamOrder)") }));
      return;
    }
    const ctrl = new AbortController();
    let attempt = 0;
    let final = false;
    void (async () => {
      while (!ctrl.signal.aborted && !final) {
        try {
          setState((s) => ({ ...s, connected: true }));
          for await (const order of client.streamOrder!(quoteId, { signal: ctrl.signal })) {
            attempt = 0;
            final = ORDER_FINAL.has(order.status);
            setState({ order, error: null, connected: !final, isFinal: final });
          }
          if (final || ctrl.signal.aborted) break;
        } catch (e) {
          if (ctrl.signal.aborted) break;
          if (e instanceof LayerHopApiError && e.status < 500 && e.status !== 429) {
            setState((s) => ({ ...s, error: e, connected: false }));
            break;
          }
          setState((s) => ({ ...s, error: e as Error, connected: false }));
        }
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt++)));
      }
      setState((s) => ({ ...s, connected: false }));
    })();
    return () => ctrl.abort();
  }, [client, quoteId]);
  return state;
}
