import { LayerHop, type BuiltTx, type EvmTx } from "@layerhop/sdk";
import type { Hex, WalletClient } from "viem";
import type { Config } from "wagmi";
import { LayerHopWalletError, sendEvmTx, type EvmDriver, type SendEvmTxOptions, type SentEvmTx, type SendStep } from "./core.js";
import { walletClientDriver, wagmiDriver, type WagmiDriverOptions, type WalletClientDriverOptions } from "./drivers.js";

/** The part of the LayerHop client `executeQuote` uses (a `new LayerHop()` or the client from `@layerhop/react`). */
export interface ExecuteClient {
  buildTx(quoteId: string): Promise<BuiltTx>;
  reportSubmitted?: (quoteId: string, txHash: string) => Promise<unknown>;
}

export type ExecuteStep = "building" | SendStep | "reporting";

export interface ExecuteQuoteParameters extends Omit<SendEvmTxOptions, "onStep"> {
  /** The quote to execute (from `lh.quote()` / `useLayerHopQuote`); only `quoteId` is read. */
  quote: { quoteId: string };
  /** Defaults to `new LayerHop()` (public API, no key). Pass yours for an API key or integrator id. */
  client?: ExecuteClient;
  /** An already built transaction for this quote; skips `buildTx`. */
  tx?: BuiltTx;
  /** Report the hash with `POST /v1/orders/{quoteId}/submitted` (best effort). Default true. */
  report?: boolean;
  onStep?: (step: ExecuteStep) => void;
}

export interface ExecuteQuoteResult extends Omit<SentEvmTx, "mode"> {
  quoteId: string;
  tx: EvmTx;
  /** `sandbox`: a test-mode tx; nothing reached the wallet and `hash` is a placeholder. */
  mode: SentEvmTx["mode"] | "sandbox";
  /** The API accepted the submitted report. */
  reported: boolean;
}

/** A well-formed placeholder hash for a test-mode transaction (never broadcast). */
export function placeholderTxHash(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build (unless `tx` is given), send with the wallet behind `driver`, then report the hash.
 * Test-mode (`sandbox`) transactions never reach the wallet: a placeholder hash is reported instead,
 * which is how test orders get filled.
 */
export async function executeQuoteWith(driver: EvmDriver, params: ExecuteQuoteParameters): Promise<ExecuteQuoteResult> {
  const { quote, report = true, onStep, ...sendOpts } = params;
  const client = params.client ?? new LayerHop();
  let tx = params.tx;
  if (!tx) {
    onStep?.("building");
    tx = await client.buildTx(quote.quoteId);
  }
  if (tx.vm !== "evm") throw new LayerHopWalletError("NOT_EVM", "This quote builds a Solana transaction: execute it with @layerhop/solana.");

  let sent: Omit<SentEvmTx, "mode"> & { mode: ExecuteQuoteResult["mode"] };
  if (tx.sandbox) sent = { hash: placeholderTxHash(), chainId: tx.chainId, mode: "sandbox", extraTxHashes: [], wait: async () => true };
  else sent = await sendEvmTx(driver, tx, { ...sendOpts, onStep });

  let reported = false;
  if (report && typeof client.reportSubmitted === "function") {
    onStep?.("reporting");
    // Best effort: order tracking works without it, so a failed report never fails the send.
    reported = await client.reportSubmitted(quote.quoteId, sent.hash).then(() => true, () => false);
  }
  return { ...sent, quoteId: quote.quoteId, tx, reported };
}

/**
 * Execute a LayerHop quote with the wallet connected to a wagmi `Config`: approval (only if the
 * allowance is short), the swap and any `extraTxs`, in ONE confirmation when the wallet supports
 * EIP-5792 atomic batching, else as sequential transactions; then report the hash.
 */
export function executeQuote(config: Config, params: ExecuteQuoteParameters & WagmiDriverOptions): Promise<ExecuteQuoteResult> {
  return executeQuoteWith(wagmiDriver(config, { connector: params.connector }), params);
}

/** `executeQuote` for a viem `WalletClient` (embedded wallets, raw EIP-1193 providers). */
export function executeQuoteWithWalletClient(
  walletClient: WalletClient,
  params: ExecuteQuoteParameters & WalletClientDriverOptions,
): Promise<ExecuteQuoteResult> {
  return executeQuoteWith(walletClientDriver(walletClient, params), params);
}
