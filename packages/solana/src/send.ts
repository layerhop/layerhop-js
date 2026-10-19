import { LayerHop, type BuiltTx, type SvmTx } from "@layerhop/sdk";
import { VersionedTransaction, type Connection, type SendOptions } from "@solana/web3.js";
import { base64ToBytes, bytesToBase58, bytesToBase64 } from "./bytes.js";
import type { SolanaSigner } from "./signers.js";

/**
 * How a Solana transaction from the API must be signed and broadcast.
 *
 * - `api`: the provider (e.g. Jupiter) lands it itself. The wallet only signs, then the signed bytes
 *   go to `POST /v1/orders/submit`.
 * - `cosigned`: the provider already added its own signatures (e.g. Mayan's ephemeral keys). Wallets
 *   may rewrite a tx they "sign and send" (priority fees, guard instructions), which would void those
 *   signatures, so the wallet only signs and the exact bytes are broadcast over RPC.
 * - `wallet`: a plain user transaction; the wallet signs and sends it.
 */
export type SolanaSendMode = "api" | "cosigned" | "wallet";

/** `signatures[0]` is the fee payer (the user); any non-zero later slot means a co-signer already signed. */
export function hasCoSignatures(signatures: readonly Uint8Array[]): boolean {
  return signatures.some((sig, i) => i > 0 && sig.some((b) => b !== 0));
}

export function solanaSendMode(submitViaApi: boolean | undefined, signatures: readonly Uint8Array[]): SolanaSendMode {
  if (submitViaApi) return "api";
  if (hasCoSignatures(signatures)) return "cosigned";
  return "wallet";
}

/** The LayerHop `SvmTx` (or its base64 `serializedTx`) as a `VersionedTransaction`. */
export function decodeSvmTx(tx: SvmTx | string): VersionedTransaction {
  return VersionedTransaction.deserialize(base64ToBytes(typeof tx === "string" ? tx : tx.serializedTx));
}

/** The part of the LayerHop client the Solana helpers use (`new LayerHop()` or `@layerhop/react`'s client). */
export interface SolanaExecuteClient {
  buildTx(quoteId: string): Promise<BuiltTx>;
  /** `POST /v1/orders/submit` for `submitViaApi` transactions; resolves to the signature. */
  submit(quoteId: string, signedTransaction: string): Promise<string>;
  reportSubmitted?: (quoteId: string, txHash: string) => Promise<unknown>;
}

export type SolanaSendStep = "signing" | "submitting";

/** Thrown for problems this package detects itself (wallet and RPC errors keep their own type). */
export class LayerHopSolanaError extends Error {
  constructor(public readonly code: "SANDBOX_TX" | "NOT_SVM" | "CONFIRMATION_TIMEOUT", message: string) {
    super(message);
    this.name = "LayerHopSolanaError";
  }
}

export interface SendSvmTxOptions {
  /** Your RPC connection: used to broadcast sign-only transactions and to confirm. */
  connection: Connection;
  /** Needed for `submitViaApi` transactions. */
  quoteId?: string;
  client?: Pick<SolanaExecuteClient, "submit">;
  /** Default `{ skipPreflight: false, maxRetries: 3 }`. */
  sendOptions?: SendOptions;
  onStep?: (step: SolanaSendStep) => void;
}

export interface SentSvmTx {
  /** Transaction signature (base58): report this to LayerHop. */
  signature: string;
  mode: SolanaSendMode;
  /** Resolves true once confirmed, false when the transaction failed. */
  wait: (opts?: ConfirmOptions) => Promise<boolean>;
}

export interface ConfirmOptions {
  timeoutMs?: number;
  pollMs?: number;
  isCancelled?: () => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls `getSignatureStatuses` until the signature is confirmed (true) or failed (false). Throws
 * `CONFIRMATION_TIMEOUT` after `timeoutMs` (default 120 s); returns false early when cancelled.
 */
export async function confirmSignature(connection: Connection, signature: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const { timeoutMs = 120_000, pollMs = 2000, isCancelled = () => false } = opts;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (isCancelled()) return false;
    const { value } = await connection.getSignatureStatuses([signature]);
    const s = value[0];
    if (s?.err) return false;
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return true;
    await sleep(pollMs);
  }
  throw new LayerHopSolanaError("CONFIRMATION_TIMEOUT", "Timed out waiting for Solana confirmation; check the explorer link.");
}

/**
 * Signs and sends a LayerHop Solana transaction with the user's wallet, in the mode it needs
 * (see `SolanaSendMode`). Test-mode (`sandbox`) transactions are refused: they must never reach a wallet.
 */
export async function sendSvmTx(signer: SolanaSigner, tx: SvmTx, opts: SendSvmTxOptions): Promise<SentSvmTx> {
  if ((tx as { vm?: string }).vm !== "svm") throw new LayerHopSolanaError("NOT_SVM", "This is not a Solana transaction (use @layerhop/wagmi for EVM).");
  if (tx.sandbox) throw new LayerHopSolanaError("SANDBOX_TX", "This is a test-mode placeholder transaction; it must never be signed or broadcast.");
  const { connection } = opts;
  const sendOptions: SendOptions = opts.sendOptions ?? { skipPreflight: false, maxRetries: 3 };
  const vtx = decodeSvmTx(tx);
  const mode = solanaSendMode(tx.submitViaApi, vtx.signatures);
  if (mode === "api" && (!opts.client || !opts.quoteId)) {
    throw new Error("This transaction must be submitted through the LayerHop API: pass `client` and `quoteId`.");
  }
  opts.onStep?.("signing");
  let signature: string;
  if (mode === "api") {
    const signed = await signer.signTransaction(vtx);
    opts.onStep?.("submitting");
    signature = await opts.client!.submit(opts.quoteId!, bytesToBase64(signed.serialize()));
  } else if (mode === "cosigned" || !signer.signAndSendTransaction) {
    const signed = await signer.signTransaction(vtx);
    signature = await connection.sendRawTransaction(signed.serialize(), sendOptions);
  } else {
    signature = await signer.signAndSendTransaction(vtx, { connection, sendOptions });
  }
  return { signature, mode, wait: (o) => confirmSignature(connection, signature, o) };
}

export interface ExecuteSolanaQuoteParameters extends Omit<SendSvmTxOptions, "quoteId" | "client" | "onStep"> {
  quote: { quoteId: string };
  /** Defaults to `new LayerHop()` (public API, no key). */
  client?: SolanaExecuteClient;
  /** An already built transaction for this quote; skips `buildTx`. */
  tx?: BuiltTx;
  /** Report the signature with `POST /v1/orders/{quoteId}/submitted` (best effort). Default true. */
  report?: boolean;
  onStep?: (step: "building" | SolanaSendStep | "reporting") => void;
}

export interface ExecuteSolanaQuoteResult extends Omit<SentSvmTx, "mode"> {
  quoteId: string;
  tx: SvmTx;
  /** `sandbox`: a test-mode tx; nothing reached the wallet and `signature` is a placeholder. */
  mode: SolanaSendMode | "sandbox";
  reported: boolean;
}

/** A well-formed placeholder signature for a test-mode transaction (never broadcast). */
export function placeholderSignature(): string {
  const b = new Uint8Array(64);
  globalThis.crypto.getRandomValues(b);
  return bytesToBase58(b);
}

/**
 * Build (unless `tx` is given), sign and send with the user's Solana wallet, then report the
 * signature. Test-mode (`sandbox`) transactions never reach the wallet: a placeholder signature is
 * reported instead, which is how test orders get filled.
 */
export async function executeSolanaQuote(signer: SolanaSigner, params: ExecuteSolanaQuoteParameters): Promise<ExecuteSolanaQuoteResult> {
  const { quote, report = true, onStep, ...rest } = params;
  const client = params.client ?? new LayerHop();
  let tx = params.tx;
  if (!tx) {
    onStep?.("building");
    tx = await client.buildTx(quote.quoteId);
  }
  if (tx.vm !== "svm") throw new LayerHopSolanaError("NOT_SVM", "This quote builds an EVM transaction: execute it with @layerhop/wagmi.");
  let sent: Omit<SentSvmTx, "mode"> & { mode: ExecuteSolanaQuoteResult["mode"] };
  if (tx.sandbox) sent = { signature: placeholderSignature(), mode: "sandbox", wait: async () => true };
  else sent = await sendSvmTx(signer, tx, { ...rest, quoteId: quote.quoteId, client, onStep });
  let reported = false;
  if (report && typeof client.reportSubmitted === "function") {
    onStep?.("reporting");
    reported = await client.reportSubmitted(quote.quoteId, sent.signature).then(() => true, () => false);
  }
  return { ...sent, quoteId: quote.quoteId, tx, reported };
}
