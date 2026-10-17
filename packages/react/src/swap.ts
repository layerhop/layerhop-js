import type { BuiltTx, OrderStatus, Quote, QuoteParams } from "@layerhop/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { isFinalState, SAME_CHAIN_PROVIDERS, type LayerHopClient } from "./client.js";
import { useLayerHop } from "./provider.js";

export type SwapPhase = "idle" | "quoting" | "building" | "awaiting-signature" | "submitted" | "tracking" | "done" | "error";

/**
 * What your `sign` callback returns:
 * - a tx hash / signature string, after your wallet broadcast the transaction, or
 * - `{ txHash }`, the same thing, or
 * - `{ signedTransaction }` (base64) for Solana txs with `submitViaApi: true` — the hook then
 *   sends it through `POST /v1/orders/submit`. A plain string is treated as the signed tx in that case.
 */
export type SignResult = string | { txHash: string } | { signedTransaction: string };

export interface SignContext {
  quote: Quote;
}

/**
 * Wallet-agnostic signer. Send `tx.approval` first when present (EVM), then the main transaction.
 * The SDK and these hooks never see private keys.
 */
export type SignFn = (tx: BuiltTx, ctx: SignContext) => Promise<SignResult>;

export interface SwapState {
  phase: SwapPhase;
  quote?: Quote;
  tx?: BuiltTx;
  txHash?: string;
  status?: OrderStatus;
  error?: Error;
}

export interface UseSwapOptions {
  sign: SignFn;
  /** Status poll interval in ms. Default 3000. */
  pollIntervalMs?: number;
  /** Give up tracking after this many ms (phase → error, code TRACKING_TIMEOUT). Default 30 min. */
  trackTimeoutMs?: number;
  onPhase?: (state: SwapState) => void;
}

export type SwapInput = QuoteParams | { quote: Quote };

export interface UseSwapResult extends SwapState {
  /** Run the whole flow. Pass quote params, or `{ quote }` to skip quoting (e.g. from `useQuote`). */
  start: (input: SwapInput) => Promise<SwapState>;
  /** Back to idle; any in-flight run is abandoned. */
  reset: () => void;
  isBusy: boolean;
}

/** Error raised by the swap state machine itself (API errors keep their `LayerHopApiError` type). */
export class SwapError extends Error {
  constructor(public readonly code: "ORDER_FAILED" | "ORDER_REFUNDED" | "TRACKING_TIMEOUT" | "ABORTED", message: string) {
    super(message);
    this.name = "SwapError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendSigned(client: LayerHopClient, tx: BuiltTx, quote: Quote, r: SignResult): Promise<string> {
  if (tx.vm === "svm" && tx.submitViaApi) {
    const signed = typeof r === "string" ? r : "signedTransaction" in r ? r.signedTransaction : undefined;
    if (!signed) throw new Error("sign(): this Solana tx must be submitted via the API — return { signedTransaction } (base64)");
    return client.submit(quote.quoteId, signed);
  }
  if (typeof r === "string") return r;
  if ("txHash" in r) return r.txHash;
  throw new Error("sign(): return the broadcast tx hash (string or { txHash })");
}

/**
 * The whole swap as a state machine:
 * idle → quoting → building → awaiting-signature → submitted → tracking → done | error.
 */
export function useSwap(opts: UseSwapOptions): UseSwapResult {
  const client = useLayerHop();
  const [state, setState] = useState<SwapState>({ phase: "idle" });
  const runId = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => () => {
    runId.current++; // abandon in-flight runs on unmount
  }, []);

  const start = useCallback(
    async (input: SwapInput): Promise<SwapState> => {
      const id = ++runId.current;
      let cur: SwapState = { phase: "idle" };
      const alive = () => id === runId.current;
      const set = (patch: Partial<SwapState>) => {
        cur = { ...cur, ...patch };
        if (!alive()) throw new SwapError("ABORTED", "Swap was reset");
        setState(cur);
        optsRef.current.onPhase?.(cur);
      };
      const { sign, pollIntervalMs = 3000, trackTimeoutMs = 30 * 60_000 } = optsRef.current;
      try {
        let quote: Quote;
        if ("quote" in input) quote = input.quote;
        else {
          set({ phase: "quoting" });
          quote = (await client.quote(input)).best;
        }
        set({ phase: "building", quote });
        const tx = await client.buildTx(quote.quoteId);
        set({ phase: "awaiting-signature", tx });
        const signed = await sign(tx, { quote });
        if (!alive()) throw new SwapError("ABORTED", "Swap was reset");
        const txHash = await sendSigned(client, tx, quote, signed);
        set({ phase: "submitted", txHash });
        if (typeof client.reportSubmitted === "function") {
          // Best effort: tracking works without it, so a failed report never fails the swap.
          await client.reportSubmitted(quote.quoteId, txHash).catch(() => undefined);
        }
        set({ phase: "tracking" });
        const end = Date.now() + trackTimeoutMs;
        for (;;) {
          const status = await client.status(quote.provider, txHash);
          if (!alive()) throw new SwapError("ABORTED", "Swap was reset");
          if (status.state !== cur.status?.state) set({ status });
          if (status.state === "filled") break;
          if (status.state === "unknown" && SAME_CHAIN_PROVIDERS.includes(quote.provider)) break;
          if (isFinalState(status.state)) {
            const code = status.state === "refunded" ? "ORDER_REFUNDED" : "ORDER_FAILED";
            throw new SwapError(code, `Order ${status.state}`);
          }
          if (Date.now() >= end) throw new SwapError("TRACKING_TIMEOUT", "Order not final before trackTimeoutMs");
          await sleep(pollIntervalMs);
        }
        set({ phase: "done" });
        return cur;
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        if (alive()) {
          cur = { ...cur, phase: "error", error };
          setState(cur);
          optsRef.current.onPhase?.(cur);
        }
        return { ...cur, phase: "error", error };
      }
    },
    [client],
  );

  const reset = useCallback(() => {
    runId.current++;
    setState({ phase: "idle" });
  }, []);

  const isBusy = state.phase !== "idle" && state.phase !== "done" && state.phase !== "error";
  return { ...state, start, reset, isBusy };
}
