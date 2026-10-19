import type { EvmTx } from "@layerhop/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { base } from "viem/chains";
import { WagmiProvider } from "wagmi";
import { describe, expect, it, vi } from "vitest";
import { LayerHopProvider, useExecuteQuote, useLayerHopQuote, type ExecuteStatus } from "../src/index.js";
import { connectFake, fakeConfig, fakeWallet, ROUTER, SPENDER, TOKEN } from "./fakeWallet.js";

const built: EvmTx = {
  vm: "evm", chainId: base.id, to: ROUTER, data: "0xdeadbeef", value: "0",
  approval: { token: TOKEN, spender: SPENDER, amount: "5" },
};

async function setup(capabilities: Record<string, unknown> | null) {
  const w = fakeWallet({ capabilities, allowance: 0n });
  const config = fakeConfig(w);
  await connectFake(config);
  const client = {
    quote: vi.fn(),
    buildTx: vi.fn(async () => built),
    submit: vi.fn(),
    status: vi.fn(),
    reportSubmitted: vi.fn(async () => ({})),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <LayerHopProvider client={client}>{children}</LayerHopProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
  return { w, client, wrapper };
}

describe("useExecuteQuote", () => {
  it("walks the status states and ends submitted in batch mode (one confirmation)", async () => {
    const { w, client, wrapper } = await setup({ atomic: { status: "supported" } });
    const seen: ExecuteStatus[] = [];
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => {
      const r = useExecuteQuote({ onSubmitted });
      if (seen[seen.length - 1] !== r.status) seen.push(r.status);
      return r;
    }, { wrapper });
    expect(result.current.status).toBe("idle");
    await act(async () => {
      await result.current.execute({ quote: { quoteId: "q_1" } });
    });
    await waitFor(() => expect(result.current.status).toBe("submitted"));
    expect(result.current.mode).toBe("batch");
    expect(result.current.approval).toEqual({ batched: true });
    expect(result.current.isPending).toBe(false);
    expect(result.current.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(client.reportSubmitted).toHaveBeenCalledWith("q_1", result.current.hash);
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(w.of("wallet_sendCalls")).toHaveLength(1);
    expect(seen[0]).toBe("idle");
    expect(seen[seen.length - 1]).toBe("submitted");
  });

  it("goes to error with the wallet's error and can reset", async () => {
    const { wrapper } = await setup(null);
    const { result } = renderHook(() => useExecuteQuote({ client: { buildTx: async () => ({ vm: "svm", serializedTx: "AQ==" }) } }), { wrapper });
    await act(async () => {
      await result.current.execute({ quote: { quoteId: "q_1" } }).catch(() => undefined);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/Solana/);
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });

  it("useLayerHopQuote is @layerhop/react's useQuote (idle on incomplete params)", async () => {
    const { wrapper, client } = await setup(null);
    const { result } = renderHook(() => useLayerHopQuote({ srcChain: "base" }), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(client.quote).not.toHaveBeenCalled();
  });
});
