import { LayerHopApiError, type OrderStatus, type Quote, type QuoteResponse } from "@layerhop/sdk";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoRefetchMs,
  LayerHopProvider,
  useBuildTx,
  useChains,
  useLayerHop,
  useOrderStatus,
  useQuote,
  useSwap,
  useTokens,
  type LayerHopClient,
  type SwapPhase,
} from "../src/index.js";

const quote = (over: Partial<Quote> = {}): Quote => ({
  quoteId: "q_1",
  provider: "relay",
  dstAmount: "612345678",
  dstAmountMin: "609283949",
  estimatedSeconds: 8,
  fees: { ourFeeBps: 20 },
  expiresAt: Math.floor(Date.now() / 1000) + 30,
  ...over,
});
const quoteResponse = (q = quote()): QuoteResponse => ({ best: q, quotes: [q], errors: [] });
const params = {
  srcChain: "base", srcToken: "USDC", amount: "100000000", dstChain: "solana", dstToken: "SOL",
  sender: "0x1111111111111111111111111111111111111111", recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
};

function mockClient(over: Partial<LayerHopClient> = {}) {
  return {
    quote: vi.fn(async () => quoteResponse()),
    buildTx: vi.fn(async () => ({ vm: "evm" as const, chainId: 8453, to: "0xabc", data: "0x", value: "0" })),
    submit: vi.fn(async () => "solsig"),
    status: vi.fn(async (provider: string, id: string): Promise<OrderStatus> => ({ provider: provider as "relay", id, state: "filled" })),
    ...over,
  } satisfies LayerHopClient;
}

function wrap(client: LayerHopClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <LayerHopProvider client={client} queryClient={queryClient}>{children}</LayerHopProvider>
  );
}

afterEach(() => vi.useRealTimers());

describe("LayerHopProvider", () => {
  it("throws a helpful error without a provider", () => {
    expect(() => renderHook(() => useLayerHop())).toThrow(/LayerHopProvider/);
  });

  it("creates a client from options and its own QueryClient", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(quoteResponse()), { status: 200 }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LayerHopProvider options={{ baseUrl: "http://api.test", fetch: fetch as unknown as typeof globalThis.fetch }}>{children}</LayerHopProvider>
    );
    const { result } = renderHook(() => useQuote(params, { refetchInterval: false }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toMatch(/^http:\/\/api\.test\/v1\/quote\?/);
  });
});

describe("useChains / useTokens", () => {
  it("falls back to the SDK's built-in registries", async () => {
    const wrapper = wrap(mockClient());
    const chains = renderHook(() => useChains(), { wrapper });
    await waitFor(() => expect(chains.result.current.data?.some((c) => c.slug === "solana")).toBe(true));
    const tokens = renderHook(() => useTokens("base"), { wrapper });
    await waitFor(() => expect(tokens.result.current.data?.map((t) => t.symbol)).toContain("USDC"));
    expect(tokens.result.current.data?.every((t) => t.chainId === 8453)).toBe(true);
  });

  it("uses client.chains/tokens when present and stays idle without a chain", async () => {
    const tokensFn = vi.fn(async () => [{ chainId: 1, address: "0x1", symbol: "X", decimals: 6 }]);
    const wrapper = wrap(mockClient({ tokens: tokensFn, chains: async () => [] }));
    const idle = renderHook(() => useTokens(undefined), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");
    const { result } = renderHook(() => useTokens(1), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]?.symbol).toBe("X"));
    expect(tokensFn).toHaveBeenCalledWith(1);
  });
});

describe("useQuote", () => {
  it("stays idle until params are complete and amount > 0", () => {
    const client = mockClient();
    const wrapper = wrap(client);
    renderHook(() => useQuote({ ...params, amount: "0" }), { wrapper });
    renderHook(() => useQuote({ ...params, amount: "1.5" }), { wrapper });
    renderHook(() => useQuote({ ...params, sender: "" }), { wrapper });
    renderHook(() => useQuote(params, { enabled: false }), { wrapper });
    renderHook(() => useQuote(undefined), { wrapper });
    expect(client.quote).not.toHaveBeenCalled();
  });

  it("fetches and does not retry client errors", async () => {
    const client = mockClient({ quote: vi.fn(async () => { throw new LayerHopApiError("NO_ROUTE", "none", 404); }) });
    const { result } = renderHook(() => useQuote(params), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as LayerHopApiError).code).toBe("NO_ROUTE");
    expect(client.quote).toHaveBeenCalledTimes(1);
  });

  it("auto-refetches shortly before expiresAt", async () => {
    const client = mockClient({ quote: vi.fn(async () => quoteResponse(quote({ expiresAt: Math.floor(Date.now() / 1000) + 6 }))) });
    const { result } = renderHook(() => useQuote(params, { refreshMarginSeconds: 5 }), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.quote).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it("autoRefetchMs subtracts the margin with a 1 s floor", () => {
    expect(autoRefetchMs(100, 5, 50_000)).toBe(45_000);
    expect(autoRefetchMs(10, 5, 50_000)).toBe(1000);
  });
});

describe("useBuildTx", () => {
  it("returns the tx for a quote id", async () => {
    const client = mockClient();
    const { result } = renderHook(() => useBuildTx(), { wrapper: wrap(client) });
    await act(async () => { await result.current.mutateAsync("q_1"); });
    expect(client.buildTx).toHaveBeenCalledWith("q_1");
    await waitFor(() => expect(result.current.data?.vm).toBe("evm"));
  });
});

describe("useOrderStatus", () => {
  it("polls until the state is final", async () => {
    const states: OrderStatus["state"][] = ["pending", "pending", "filled"];
    const status = vi.fn(async (provider: string, id: string): Promise<OrderStatus> => ({ provider: provider as "relay", id, state: states.shift() ?? "filled" }));
    const { result } = renderHook(() => useOrderStatus("relay", "0xhash", { intervalMs: 20 }), { wrapper: wrap(mockClient({ status })) });
    await waitFor(() => expect(result.current.isFinal).toBe(true));
    expect(result.current.data?.state).toBe("filled");
    const calls = status.mock.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(status.mock.calls.length).toBe(calls);
  });

  it("is idle without an id", () => {
    const client = mockClient();
    renderHook(() => useOrderStatus("relay", undefined), { wrapper: wrap(client) });
    expect(client.status).not.toHaveBeenCalled();
  });
});

describe("useSwap", () => {
  it("runs idle → quoting → building → awaiting-signature → submitted → tracking → done and reports the tx", async () => {
    const reportSubmitted = vi.fn(async () => ({ quoteId: "q_1", status: "submitted" }));
    const states: OrderStatus["state"][] = ["pending", "filled"];
    const client = mockClient({
      reportSubmitted,
      status: vi.fn(async (provider: string, id: string): Promise<OrderStatus> => ({ provider: provider as "relay", id, state: states.shift() ?? "filled" })),
    });
    const phases: SwapPhase[] = [];
    const sign = vi.fn(async () => "0xtxhash");
    const { result } = renderHook(() => useSwap({ sign, pollIntervalMs: 5, onPhase: (s) => phases.push(s.phase) }), { wrapper: wrap(client) });
    expect(result.current.phase).toBe("idle");
    await act(async () => { await result.current.start(params); });
    expect(phases.filter((p, i) => phases[i - 1] !== p)).toEqual(["quoting", "building", "awaiting-signature", "submitted", "tracking", "done"]);
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({ vm: "evm" }), { quote: expect.objectContaining({ quoteId: "q_1" }) });
    expect(reportSubmitted).toHaveBeenCalledWith("q_1", "0xtxhash");
    expect(client.status).toHaveBeenCalledWith("relay", "0xtxhash");
    expect(result.current.phase).toBe("done");
    expect(result.current.status?.state).toBe("filled");
    expect(result.current.txHash).toBe("0xtxhash");
    expect(result.current.isBusy).toBe(false);
  });

  it("skips quoting when given a quote, and works without reportSubmitted", async () => {
    const client = mockClient();
    const { result } = renderHook(() => useSwap({ sign: async () => ({ txHash: "0xh" }) }), { wrapper: wrap(client) });
    await act(async () => { await result.current.start({ quote: quote() }); });
    expect(client.quote).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("done");
  });

  it("sends submitViaApi Solana txs through submit()", async () => {
    const client = mockClient({
      buildTx: vi.fn(async () => ({ vm: "svm" as const, serializedTx: "AAA", submitViaApi: true })),
      quote: vi.fn(async () => quoteResponse(quote({ provider: "jupiter" }))),
      status: vi.fn(async (provider: string, id: string): Promise<OrderStatus> => ({ provider: provider as "jupiter", id, state: "unknown" })),
    });
    const { result } = renderHook(() => useSwap({ sign: async () => ({ signedTransaction: "c2lnbmVk" }) }), { wrapper: wrap(client) });
    await act(async () => { await result.current.start(params); });
    expect(client.submit).toHaveBeenCalledWith("q_1", "c2lnbmVk");
    expect(result.current.txHash).toBe("solsig");
    // same-chain provider: "unknown" is as final as it gets
    expect(result.current.phase).toBe("done");
  });

  it("ends in error on refund, on API errors and when the signer rejects", async () => {
    const refunded = mockClient({ status: vi.fn(async (p: string, id: string): Promise<OrderStatus> => ({ provider: p as "relay", id, state: "refunded" })) });
    const r1 = renderHook(() => useSwap({ sign: async () => "0xh" }), { wrapper: wrap(refunded) });
    await act(async () => { await r1.result.current.start(params); });
    expect(r1.result.current.phase).toBe("error");
    expect((r1.result.current.error as { code?: string }).code).toBe("ORDER_REFUNDED");

    const expired = mockClient({ buildTx: vi.fn(async () => { throw new LayerHopApiError("QUOTE_EXPIRED", "expired", 410); }) });
    const r2 = renderHook(() => useSwap({ sign: async () => "0xh" }), { wrapper: wrap(expired) });
    await act(async () => { await r2.result.current.start(params); });
    expect(r2.result.current.phase).toBe("error");
    expect(r2.result.current.error).toBeInstanceOf(LayerHopApiError);

    const rejecting = mockClient();
    const r3 = renderHook(() => useSwap({ sign: async () => { throw new Error("User rejected"); } }), { wrapper: wrap(rejecting) });
    await act(async () => { await r3.result.current.start(params); });
    expect(r3.result.current.phase).toBe("error");
    expect(r3.result.current.error?.message).toBe("User rejected");
    expect(r3.result.current.tx?.vm).toBe("evm");
  });

  it("a failing reportSubmitted does not fail the swap; reset() returns to idle", async () => {
    const client = mockClient({ reportSubmitted: vi.fn(async () => { throw new Error("404"); }) });
    const { result } = renderHook(() => useSwap({ sign: async () => "0xh" }), { wrapper: wrap(client) });
    await act(async () => { await result.current.start(params); });
    expect(result.current.phase).toBe("done");
    act(() => result.current.reset());
    expect(result.current.phase).toBe("idle");
    expect(result.current.quote).toBeUndefined();
  });

  it("reset() during signature abandons the run", async () => {
    let release!: (v: string) => void;
    const client = mockClient();
    const { result } = renderHook(() => useSwap({ sign: () => new Promise<string>((r) => { release = r; }) }), { wrapper: wrap(client) });
    let done!: Promise<unknown>;
    act(() => { done = result.current.start(params); });
    await waitFor(() => expect(result.current.phase).toBe("awaiting-signature"));
    act(() => result.current.reset());
    await act(async () => { release("0xh"); await done; });
    expect(result.current.phase).toBe("idle");
    expect(client.status).not.toHaveBeenCalled();
  });
});
