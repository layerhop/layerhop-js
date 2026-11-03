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
 * - `wallet`: a plain user transaction. The wallet signs it and we broadcast it over your RPC.
 *
 * `wallet` and `cosigned` sends are re-broadcast (the same signed bytes) every ~2 s until the
 * transaction lands or its blockhash expires: a wallet that broadcasts once, with no re-sends, loses
 * many transactions when the network is busy. Only a wallet that can't sign without sending (some
 * mobile adapters) signs and sends itself; then we can only watch for it.
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
export type LayerHopSolanaErrorCode =
  | "SANDBOX_TX"
  | "NOT_SVM"
  | "CONFIRMATION_TIMEOUT"
  /** The blockhash's window closed before the transaction landed: it can never land now. */
  | "BLOCKHASH_EXPIRED"
  /** The wallet answered without a signature or signed transaction. */
  | "WALLET_NO_SIGNATURE"
  /** The wallet can't sign without sending (and this transaction must not be sent by the wallet). */
  | "SIGN_UNSUPPORTED";

export class LayerHopSolanaError extends Error {
  constructor(public readonly code: LayerHopSolanaErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LayerHopSolanaError";
  }
}

export interface SendSvmTxOptions {
  /** Your RPC connection: used to broadcast sign-only transactions and to confirm. */
  connection: Connection;
  /** Needed for `submitViaApi` transactions. */
  quoteId?: string;
  client?: Pick<SolanaExecuteClient, "submit">;
  /**
   * Options for the first broadcast. Default `{ skipPreflight: false, preflightCommitment: "confirmed",
   * maxRetries: 0 }`: the preflight catches a failing transaction before it is sent, and the re-sends
   * (without preflight) replace the RPC's own retries. A sign-and-send-only wallet gets `maxRetries: 3`.
   */
  sendOptions?: SendOptions;
  onStep?: (step: SolanaSendStep) => void;
  /** How often the signed transaction is sent again while it hasn't landed. Default 2000 ms. */
  resendIntervalMs?: number;
  /** Gives up re-sending after this long even when the block height can't be read. Default 120 s. */
  landTimeoutMs?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SentSvmTx {
  /** Transaction signature (base58): report this to LayerHop right away (re-sends continue in the background). */
  signature: string;
  mode: SolanaSendMode;
  /**
   * Resolves true once confirmed, false when the transaction failed (or `isCancelled`). Rejects with
   * `BLOCKHASH_EXPIRED` when the transaction can no longer land, `CONFIRMATION_TIMEOUT` after `timeoutMs`.
   */
  wait: (opts?: ConfirmOptions) => Promise<boolean>;
}

export interface ConfirmOptions {
  timeoutMs?: number;
  pollMs?: number;
  isCancelled?: () => boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

/** Solana blockhashes stay valid for 150 blocks: the upper bound for a transaction whose window we weren't given. */
export const BLOCKHASH_VALID_BLOCKS = 150;

const ZERO_SIG = (sig: Uint8Array | undefined) => !sig || !sig.some((b) => b !== 0);

/** The wallet's signed transaction, checked: a `VersionedTransaction` (or its bytes) with the fee payer's signature. */
function checkSigned(signed: unknown): VersionedTransaction {
  let tx = signed;
  if (tx instanceof Uint8Array) {
    try {
      tx = VersionedTransaction.deserialize(tx);
    } catch (e) {
      throw new LayerHopSolanaError("WALLET_NO_SIGNATURE", "The wallet returned an unreadable signed transaction, so nothing was sent.", { cause: e });
    }
  }
  const t = tx as Partial<VersionedTransaction> | null | undefined;
  if (!t || typeof t !== "object" || !Array.isArray(t.signatures) || typeof t.serialize !== "function" || ZERO_SIG(t.signatures[0])) {
    throw new LayerHopSolanaError("WALLET_NO_SIGNATURE", "The wallet returned no signed transaction, so nothing was sent. Try again, or reconnect your wallet.");
  }
  return t as VersionedTransaction;
}

/** A wallet's sign-and-send answer as a base58 signature (string, bytes or `{ signature }`), or a WALLET_NO_SIGNATURE error. */
export function walletSignature(r: unknown): string {
  const v = r && typeof r === "object" && !(r instanceof Uint8Array) ? (r as { signature?: unknown }).signature : r;
  if (typeof v === "string" && v.length > 0) return v;
  if (v instanceof Uint8Array && !ZERO_SIG(v)) return bytesToBase58(v);
  throw new LayerHopSolanaError(
    "WALLET_NO_SIGNATURE",
    "The wallet answered without a transaction signature. It may still have sent it: check your wallet's activity before trying again.",
  );
}

function errorChain(e: unknown): { code?: unknown; name?: unknown; message?: unknown }[] {
  const out: { code?: unknown; name?: unknown; message?: unknown }[] = [];
  for (let cur = e, i = 0; cur && typeof cur === "object" && i < 6; cur = (cur as { cause?: unknown }).cause, i++) out.push(cur as never);
  return out;
}

/** The user said no in the wallet: never retried another way. */
function isRejection(e: unknown): boolean {
  return errorChain(e).some((x) => x.code === 4001 || /user rejected|rejected the request|user denied|declined|cancel/i.test(String(x.message ?? "")));
}

/** The wallet has no sign-only method (or refused it as unsupported): the only case that may fall back to sign-and-send. */
export function isSignUnsupported(e: unknown): boolean {
  if (isRejection(e)) return false;
  return errorChain(e).some(
    (x) =>
      (x instanceof LayerHopSolanaError && x.code === "SIGN_UNSUPPORTED") ||
      x.code === 4200 || x.code === -32601 ||
      /method not (supported|found|implemented)|unsupported method|not supported by (this|the) wallet|signTransaction is not (a function|supported)/i.test(String(x.message ?? "")),
  );
}

const errText = (e: unknown) => errorChain(e).map((x) => String(x.message ?? "")).join(" | ");

async function heightOf(connection: Connection): Promise<number | undefined> {
  try {
    const h = await connection.getBlockHeight("confirmed");
    return typeof h === "number" ? h : undefined;
  } catch {
    return undefined;
  }
}

async function statusOf(connection: Connection, signature: string): Promise<boolean | null> {
  try {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) return false;
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return true;
  } catch {
    // An RPC hiccup: ask again next round.
  }
  return null;
}

/**
 * Until the transaction lands: poll its status, and send the same signed bytes again (no preflight)
 * every `intervalMs`. Stops with BLOCKHASH_EXPIRED once the block height passes `lastValidBlockHeight`
 * (after one last status check), CONFIRMATION_TIMEOUT after `timeoutMs`. Without `bytes` (the wallet
 * sent it) it only watches.
 */
export async function landSignedTx(opts: {
  connection: Connection;
  signature: string;
  bytes?: Uint8Array;
  lastValidBlockHeight: number;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const { connection, signature, bytes, intervalMs = 2000, timeoutMs = 120_000 } = opts;
  const pause = opts.sleep ?? sleep;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await statusOf(connection, signature);
    if (s !== null) return s;
    const height = await heightOf(connection);
    if (height !== undefined && height > opts.lastValidBlockHeight) {
      const last = await statusOf(connection, signature);
      if (last !== null) return last;
      throw new LayerHopSolanaError("BLOCKHASH_EXPIRED", "The Solana transaction expired before it landed (block height exceeded), so nothing was sent. You can try again.");
    }
    await pause(intervalMs);
    if (bytes) await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
  }
  throw new LayerHopSolanaError("CONFIRMATION_TIMEOUT", "Timed out waiting for Solana confirmation; check the explorer link.");
}

/** `wait()` over a landing that is already running: adds the caller's cancel and timeout. */
function waitOn(landing: Promise<boolean>, o: ConfirmOptions = {}, pause: (ms: number) => Promise<void> = sleep): Promise<boolean> {
  if (!o.isCancelled && o.timeoutMs === undefined) return landing;
  const { timeoutMs = 120_000, pollMs = 2000, isCancelled = () => false } = o;
  let settled = false;
  landing.then(() => (settled = true), () => (settled = true));
  const watch = (async (): Promise<boolean> => {
    const end = Date.now() + timeoutMs;
    while (!settled) {
      if (isCancelled()) return false;
      if (Date.now() >= end) throw new LayerHopSolanaError("CONFIRMATION_TIMEOUT", "Timed out waiting for Solana confirmation; check the explorer link.");
      await pause(pollMs);
    }
    return landing;
  })();
  return Promise.race([landing, watch]);
}

/**
 * Signs and sends a LayerHop Solana transaction with the user's wallet, in the mode it needs
 * (see `SolanaSendMode`). Test-mode (`sandbox`) transactions are refused: they must never reach a wallet.
 *
 * `wallet` / `cosigned`: the wallet signs only, the signed bytes go out over `connection` and are sent
 * again every `resendIntervalMs` in the background until they land or the blockhash expires; this
 * resolves right after the first broadcast is accepted, so the signature can be reported at once.
 */
export async function sendSvmTx(signer: SolanaSigner, tx: SvmTx, opts: SendSvmTxOptions): Promise<SentSvmTx> {
  if ((tx as { vm?: string }).vm !== "svm") throw new LayerHopSolanaError("NOT_SVM", "This is not a Solana transaction (use @layerhop/wagmi for EVM).");
  if (tx.sandbox) throw new LayerHopSolanaError("SANDBOX_TX", "This is a test-mode placeholder transaction; it must never be signed or broadcast.");
  const { connection } = opts;
  const pause = opts.sleep ?? sleep;
  const vtx = decodeSvmTx(tx);
  const mode = solanaSendMode(tx.submitViaApi, vtx.signatures);
  if (mode === "api" && (!opts.client || !opts.quoteId)) {
    throw new Error("This transaction must be submitted through the LayerHop API: pass `client` and `quoteId`.");
  }
  opts.onStep?.("signing");
  if (mode === "api") {
    const signed = checkSigned(await signer.signTransaction(vtx));
    opts.onStep?.("submitting");
    const signature = walletSignature(await opts.client!.submit(opts.quoteId!, bytesToBase64(signed.serialize())));
    return { signature, mode, wait: (o) => confirmSignature(connection, signature, o) };
  }

  let signed: VersionedTransaction | undefined;
  try {
    signed = checkSigned(await signer.signTransaction(vtx));
  } catch (e) {
    // Only a wallet that can't sign alone may sign-and-send, and never a co-signed transaction.
    if (!isSignUnsupported(e)) throw e;
    if (mode === "cosigned" || !signer.signAndSendTransaction) {
      throw e instanceof LayerHopSolanaError ? e : new LayerHopSolanaError("SIGN_UNSUPPORTED", "This wallet can't sign this transaction without sending it.", { cause: e });
    }
  }

  // The window closes no later than 150 blocks after now (the API's blockhash is at most this fresh).
  const height = await heightOf(connection);
  const lastValidBlockHeight = height !== undefined ? height + BLOCKHASH_VALID_BLOCKS : Number.MAX_SAFE_INTEGER;
  const land = (signature: string, bytes?: Uint8Array) => {
    const landing = landSignedTx({ connection, signature, bytes, lastValidBlockHeight, intervalMs: opts.resendIntervalMs, timeoutMs: opts.landTimeoutMs, sleep: pause });
    landing.catch(() => undefined); // surfaced through wait(); never an unhandled rejection
    return { signature, mode, wait: (o?: ConfirmOptions) => waitOn(landing, o, pause) };
  };

  if (!signed) {
    const sendOptions = opts.sendOptions ?? { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 };
    const signature = walletSignature(await signer.signAndSendTransaction!(vtx, { connection, sendOptions }));
    return land(signature);
  }

  const signature = bytesToBase58(signed.signatures[0]!);
  const bytes = signed.serialize();
  const first: SendOptions = opts.sendOptions ?? { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 };
  try {
    await connection.sendRawTransaction(bytes, first);
  } catch (e) {
    // Our RPC may lag the provider's and not know the blockhash yet: send without preflight. Any other
    // preflight failure means the transaction would fail, and nothing was sent.
    if (first.skipPreflight || !/blockhash not found/i.test(errText(e))) throw e;
    await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 });
  }
  return land(signature, bytes);
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
