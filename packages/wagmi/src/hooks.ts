import { useLayerHop, useQuote, type LayerHopClient } from "@layerhop/react";
import { LayerHop, type BuiltTx } from "@layerhop/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig, type Connector } from "wagmi";
import type { BatchPreference } from "./core.js";
import { executeQuote, type ExecuteClient, type ExecuteQuoteResult, type ExecuteStep } from "./execute.js";

/**
 * Quotes from every provider, best first, refreshed before they expire. This is `useQuote` from
 * `@layerhop/react` (needs a `<LayerHopProvider>`), re-exported under a wallet-package name.
 */
export const useLayerHopQuote = useQuote;

export type ExecuteStatus = "idle" | ExecuteStep | "submitted" | "error";

export interface UseExecuteQuoteOptions {
  /** LayerHop client. Default: the one from `<LayerHopProvider>`, else `new LayerHop()`. */
  client?: ExecuteClient;
  /** Default `auto`: one EIP-5792 confirmation when the wallet supports it. */
  batch?: BatchPreference;
  connector?: Connector;
  onSubmitted?: (result: ExecuteQuoteResult) => void;
  onError?: (error: Error) => void;
}

export interface ExecuteQuoteInput {
  quote: { quoteId: string };
  /** An already built transaction for this quote (skips building). */
  tx?: BuiltTx;
}

export interface UseExecuteQuoteResult {
  /** Run it; resolves with the result, rejects with the error (also kept in `error`). */
  execute: (input: ExecuteQuoteInput) => Promise<ExecuteQuoteResult>;
  reset: () => void;
  /** idle → building → (switching) → (approving) → signing → reporting → submitted | error. */
  status: ExecuteStatus;
  result?: ExecuteQuoteResult;
  hash?: string;
  /** `batch` when everything went in one EIP-5792 confirmation. */
  mode?: ExecuteQuoteResult["mode"];
  /** The send included an ERC-20 approval (`batched` when it shared the confirmation). */
  approval?: { batched: boolean };
  error?: Error;
  isPending: boolean;
}

/** The `<LayerHopProvider>` client when there is one (the hook works without a provider too). */
function useOptionalLayerHop(): LayerHopClient | null {
  try {
    return useLayerHop();
  } catch {
    return null;
  }
}

/**
 * Executes a LayerHop quote with the connected wagmi wallet and tracks the step it's at.
 * Track the order afterwards with `useOrderStatus(quote.provider, hash)` from `@layerhop/react`.
 */
export function useExecuteQuote(opts: UseExecuteQuoteOptions = {}): UseExecuteQuoteResult {
  const config = useConfig();
  const ctxClient = useOptionalLayerHop();
  const [state, setState] = useState<Omit<UseExecuteQuoteResult, "execute" | "reset" | "isPending">>({ status: "idle" });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const runId = useRef(0);
  const fallbackClient = useRef<LayerHop | null>(null);

  useEffect(() => () => {
    runId.current++; // ignore in-flight runs after unmount
  }, []);

  const execute = useCallback(
    async ({ quote, tx }: ExecuteQuoteInput): Promise<ExecuteQuoteResult> => {
      const id = ++runId.current;
      const alive = () => id === runId.current;
      const set = (patch: Partial<typeof state>) => {
        if (alive()) setState((s) => ({ ...s, ...patch }));
      };
      setState({ status: tx ? "signing" : "building" });
      const o = optsRef.current;
      const client = o.client ?? ctxClient ?? (fallbackClient.current ??= new LayerHop());
      try {
        const result = await executeQuote(config, {
          quote,
          tx,
          client,
          batch: o.batch,
          connector: o.connector,
          onStep: (status) => set({ status }),
          onApproval: (approval) => set({ approval }),
        });
        set({ status: "submitted", result, hash: result.hash, mode: result.mode });
        if (alive()) o.onSubmitted?.(result);
        return result;
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        set({ status: "error", error });
        if (alive()) o.onError?.(error);
        throw error;
      }
    },
    [config, ctxClient],
  );

  const reset = useCallback(() => {
    runId.current++;
    setState({ status: "idle" });
  }, []);

  const isPending = state.status !== "idle" && state.status !== "submitted" && state.status !== "error";
  return { ...state, execute, reset, isPending };
}
