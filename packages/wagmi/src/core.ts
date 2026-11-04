import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import type { EvmTx } from "@layerhop/sdk";
import { speedFees, speedSupported, type FeeSnapshot, type GasSpeed, type TxFees } from "./speed.js";

/** One call of a LayerHop EVM transaction, ready for the wallet (`value` in wei). */
export interface WalletCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Wallet steps a send goes through, reported as they start. */
export type SendStep = "switching" | "approving" | "signing";

/**
 * How the calls reached the chain: `batch` = one EIP-5792 `wallet_sendCalls` confirmation (atomic),
 * `sequential` = one transaction per call.
 */
export type SendMode = "batch" | "sequential";

/**
 * `auto` (default): batch when the wallet reports atomic batching for the chain, else sequential.
 * `never`: always sequential. `require`: batch or throw (no sequential fallback).
 */
export type BatchPreference = "auto" | "never" | "require";

/**
 * The few wallet operations a send needs. `wagmiDriver` (a wagmi `Config`) and
 * `walletClientDriver` (a viem `WalletClient`) implement it; tests and custom stacks can too.
 * Nothing here holds keys: every write goes to the user's wallet for confirmation.
 */
export interface EvmDriver {
  getAccount(): Promise<{ address?: Address; chainId?: number }>;
  switchChain(chainId: number): Promise<void>;
  readAllowance(p: { chainId: number; token: Address; owner: Address; spender: Address }): Promise<bigint>;
  /** `wallet_getCapabilities` for one chain; throw or return undefined when unsupported. */
  getCapabilities(p: { chainId: number; account: Address }): Promise<unknown>;
  /** `wallet_sendCalls` with `atomicRequired: true`; resolves to the batch id. */
  sendCalls(p: { chainId: number; account: Address; calls: WalletCall[] }): Promise<string>;
  /** Waits for `wallet_getCallsStatus` to settle. */
  waitForCalls(p: { chainId: number; id: string }): Promise<{ status?: string; receipts?: readonly { transactionHash: Hex; status?: string }[] }>;
  /** `fees`: fee fields to suggest to the wallet (a `speed`); without them the wallet picks its own. */
  sendTransaction(p: { chainId: number; account: Address; call: WalletCall; fees?: TxFees }): Promise<Hex>;
  /** Current fee data for `chainId` (read-only RPC). Needed for `speed`; without it the wallet picks the fees. */
  readFees?(p: { chainId: number }): Promise<FeeSnapshot>;
  /** Resolves true when the transaction succeeded, false when it reverted. */
  waitForReceipt(p: { chainId: number; hash: Hex }): Promise<boolean>;
}

export interface SendEvmTxOptions {
  onStep?: (step: SendStep) => void;
  /** The send includes an ERC-20 approval (`batched`: it rides in the same confirmation). */
  onApproval?: (info: { batched: boolean }) => void;
  /** Default `auto`. */
  batch?: BatchPreference;
  /**
   * Batching was tried and the send continues sequentially (approve, then swap): the wallet refused
   * the batch as unsupported, could not send it (e.g. balance or gas near a full-balance swap), or
   * the batch failed without anything in it landing. Happens at most once per send.
   */
  onBatchFallback?: (error: unknown) => void;
  /** A sequential extra call (e.g. the checkout fee transfer) was not sent. Default: console.warn. */
  onExtraTxError?: (error: unknown, index: number) => void;
  /**
   * Transaction speed (`speed.ts`). Default `normal`: the wallet picks the fees. `fast` / `instant`
   * suggest a higher priority fee from recent blocks; batches can't carry fee fields, so the calls
   * then go one by one (unless `batch` is set explicitly). No effect on chains that ignore the
   * priority fee (`NO_PRIORITY_FEE_CHAINS`) or when the driver can't read fees.
   */
  speed?: GasSpeed;
}

export interface SentEvmTx {
  /** Hash of the transaction that carries the main call: report this to LayerHop. */
  hash: Hex;
  chainId: number;
  mode: SendMode;
  /** EIP-5792 batch id (batch mode). */
  batchId?: string;
  /** Approval transaction (sequential mode, when one was needed). */
  approvalHash?: Hex;
  /** Extra call transactions that were sent (sequential mode). */
  extraTxHashes: Hex[];
  /** Fee fields suggested with the main call (a `speed`); undefined = the wallet picked them. */
  fees?: TxFees;
  /** Resolves true once the main call is confirmed on chain, false when it reverted. */
  wait: () => Promise<boolean>;
}

/** Thrown for problems this package detects itself (wallet errors keep their own type). */
export class LayerHopWalletError extends Error {
  constructor(
    public readonly code: "NO_ACCOUNT" | "SANDBOX_TX" | "NOT_EVM" | "BATCH_UNSUPPORTED" | "BATCH_FAILED" | "APPROVAL_FAILED" | "GASLESS_UNSAFE",
    message: string,
  ) {
    super(message);
    this.name = "LayerHopWalletError";
  }
}

const asCall = (c: { to: string; data: string; value: string }): WalletCall => ({
  to: c.to as Address,
  data: (c.data || "0x") as Hex,
  value: BigInt(c.value || "0"),
});

/** The exact-amount `approve(spender, amount)` call for `tx.approval` (never an unlimited allowance). */
export function approvalCall(approval: NonNullable<EvmTx["approval"]>): WalletCall {
  return {
    to: approval.token as Address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spender as Address, BigInt(approval.amount)] }),
    value: 0n,
  };
}

/**
 * Every call of a LayerHop EVM transaction in order: the approval (only when `needsApproval`), the
 * main call, then `extraTxs` (e.g. LayerHop's fee transfer on a same-token checkout payment).
 */
export function evmCalls(tx: EvmTx, needsApproval: boolean): WalletCall[] {
  return [
    ...(needsApproval && tx.approval ? [approvalCall(tx.approval)] : []),
    asCall(tx),
    ...(tx.extraTxs ?? []).map(asCall),
  ];
}

/**
 * True when `wallet_getCapabilities` (for one chain) says the wallet executes batches atomically:
 * EIP-5792 v2 `atomic.status` "supported" or "ready" (the wallet upgrades the account on first use),
 * or the earlier draft's `atomicBatch.supported`.
 */
export function supportsAtomicBatch(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const c = capabilities as { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } };
  return c.atomic?.status === "supported" || c.atomic?.status === "ready" || c.atomicBatch?.supported === true;
}

/**
 * How the wallet batches on one chain, for UI copy:
 * - `supported`: atomic batches today (a smart account, or an EOA already delegated with EIP-7702);
 * - `ready`: atomic after the wallet upgrades the account (EIP-7702 delegation to the wallet's own
 *   implementation). The wallet asks the user to approve that upgrade itself, with the first batch;
 *   we never build a delegation or an authorization ourselves;
 * - `none`: one transaction per call.
 * Only `atomic` / `atomicBatch` are read, and `wallet_sendCalls` never asks for `paymasterService`
 * or any other capability (no sponsored gas, owner decision): the user always pays their own gas.
 */
export type AtomicBatchStatus = "supported" | "ready" | "none";

export function atomicBatchStatus(capabilities: unknown): AtomicBatchStatus {
  if (!supportsAtomicBatch(capabilities)) return "none";
  return (capabilities as { atomic?: { status?: string } }).atomic?.status === "ready" ? "ready" : "supported";
}

/** The wallet's batch status on `chainId` (`none` when it can't say). */
export async function detectAtomicBatchStatus(driver: EvmDriver, chainId: number, account: Address): Promise<AtomicBatchStatus> {
  try {
    return atomicBatchStatus(await driver.getCapabilities({ chainId, account }));
  } catch {
    return "none";
  }
}

/** RPC error codes meaning "this wallet can't batch these calls" (never a user rejection, 4001). */
const BATCH_UNSUPPORTED_CODES = new Set([
  -32601, // method not found
  4200, // unsupported method (EIP-1193)
  5700, // unsupported non-optional capability (EIP-5792)
  5710, // unsupported chain id
  5740, // batch too large
  5750, // user rejected the account upgrade (atomic "ready"), not the payment itself
  5760, // atomicity not supported
]);
const BATCH_UNSUPPORTED_NAMES = new Set([
  "MethodNotFoundRpcError",
  "MethodNotSupportedRpcError",
  "UnsupportedProviderMethodError",
  "UnsupportedNonOptionalCapabilityError",
  "UnsupportedChainIdError",
  "BundleTooLargeError",
  "AtomicReadyWalletRejectedUpgradeError",
  "AtomicityNotSupportedError",
]);

/** The wallet refused `wallet_sendCalls` as unsupported (safe to fall back to sequential txs). */
export function isBatchUnsupportedError(error: unknown): boolean {
  for (let e = error as { code?: unknown; name?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
    if (typeof e !== "object") break;
    if (e.code === 4001 || e.name === "UserRejectedRequestError") return false;
    if (typeof e.code === "number" && BATCH_UNSUPPORTED_CODES.has(e.code)) return true;
    if (typeof e.name === "string" && BATCH_UNSUPPORTED_NAMES.has(e.name)) return true;
  }
  return false;
}

/**
 * `wallet_sendCalls` threw because the wallet could not send the batch (funds, gas, simulation),
 * not because the user said no, a request is already pending, or the call timed out. Nothing was
 * sent, so one sequential attempt is safe. Near a full-balance swap a smart wallet that pays gas in
 * the token being swapped refuses the batch this way, while plain approve + swap still goes through.
 */
export function isBatchSendFailure(error: unknown): boolean {
  let failed = false;
  for (let e = error as { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
    if (typeof e !== "object") break;
    const text = [e.name, e.message, e.shortMessage, e.details].filter((x) => typeof x === "string").join(" ");
    if (e.code === 4001 || e.code === -32002 || e.code === 5750 || e.name === "UserRejectedRequestError") return false;
    if (/user (rejected|denied|cancel)|rejected the request|declined|already pending|resource not available|timed? ?out|timeout/i.test(text)) return false;
    if (e.code === -32603 || e.code === -32000 || e.code === -32003) failed = true;
    if (/insufficient|exceeds (the )?balance|not enough|gas|revert|simulat|paymaster/i.test(text)) failed = true;
  }
  return failed;
}

/** Whether the connected wallet batches atomically on `chainId` (false when it can't say). */
export async function detectAtomicBatch(driver: EvmDriver, chainId: number, account: Address): Promise<boolean> {
  try {
    return supportsAtomicBatch(await driver.getCapabilities({ chainId, account }));
  } catch {
    return false; // no wallet_getCapabilities: a plain EIP-1193 wallet
  }
}

/**
 * Sends a built LayerHop EVM transaction with the user's wallet:
 *
 * 1. switch the wallet to `tx.chainId` if needed;
 * 2. read the ERC-20 allowance when `tx.approval` is set (an approval call is added only if it is short);
 * 3. if there is more than one call (approval, main, `extraTxs`) and the wallet reports atomic
 *    batching, send them all with one EIP-5792 `wallet_sendCalls` (one confirmation) and wait for the
 *    batch to land, so the returned hash is the mined transaction's;
 * 4. otherwise, or when the wallet refuses the batch as unsupported: approve (exact amount) and wait,
 *    send the main call, then each extra call (an extra call that fails never fails the send).
 *
 * Test-mode (`sandbox`) transactions are refused: they must never reach a wallet.
 */
export async function sendEvmTx(driver: EvmDriver, tx: EvmTx, opts: SendEvmTxOptions = {}): Promise<SentEvmTx> {
  if ((tx as { vm?: string }).vm !== "evm") throw new LayerHopWalletError("NOT_EVM", "This is not an EVM transaction (use @layerhop/solana for Solana).");
  if (tx.sandbox) throw new LayerHopWalletError("SANDBOX_TX", "This is a test-mode placeholder transaction; it must never be signed or broadcast.");
  const chainId = tx.chainId;
  const { address, chainId: current } = await driver.getAccount();
  if (!address) throw new LayerHopWalletError("NO_ACCOUNT", "Connect an EVM wallet to continue.");
  if (current !== chainId) {
    opts.onStep?.("switching");
    await driver.switchChain(chainId);
  }

  let needsApproval = false;
  if (tx.approval) {
    const allowance = await driver.readAllowance({
      chainId, token: tx.approval.token as Address, owner: address, spender: tx.approval.spender as Address,
    });
    needsApproval = allowance < BigInt(tx.approval.amount);
  }
  const calls = evmCalls(tx, needsApproval);
  const batch = opts.batch ?? (speedActive(driver, chainId, opts.speed) ? "never" : "auto");

  if (batch !== "never" && calls.length > 1) {
    if (await detectAtomicBatch(driver, chainId, address)) {
      if (needsApproval) opts.onApproval?.({ batched: true });
      opts.onStep?.("signing");
      let id: string | undefined;
      try {
        id = await driver.sendCalls({ chainId, account: address, calls });
      } catch (e) {
        // Only a refused wallet_sendCalls may fall back: once it returned, the batch may be on its way.
        if (batch === "require" || !(isBatchUnsupportedError(e) || isBatchSendFailure(e))) throw e;
        opts.onBatchFallback?.(e);
      }
      if (id !== undefined) {
        const settled = await settleEvmBatch(driver, chainId, id, calls, needsApproval);
        if (!("failed" in settled)) return settled;
        // The atomic batch failed and none of it landed: one sequential try (approve, then swap).
        if (batch === "require") throw settled.failed;
        opts.onBatchFallback?.(settled.failed);
        return sendSequentialFresh(driver, chainId, address, tx, opts);
      }
    } else if (batch === "require") {
      throw new LayerHopWalletError("BATCH_UNSUPPORTED", "The connected wallet does not support atomic batching (EIP-5792) on this chain.");
    }
  }
  return sendSequential(driver, chainId, address, calls, needsApproval, opts);
}

/** A speed other than `normal` applies on this chain with this driver. */
export function speedActive(driver: Pick<EvmDriver, "readFees">, chainId: number, speed: GasSpeed | undefined): boolean {
  return !!speed && speed !== "normal" && typeof driver.readFees === "function" && speedSupported(chainId);
}

/** Fee fields for the next transaction at `speed` (fresh fee data each time); undefined = the wallet decides. */
async function feesFor(driver: EvmDriver, chainId: number, speed: GasSpeed | undefined): Promise<TxFees | undefined> {
  if (!speedActive(driver, chainId, speed)) return undefined;
  try {
    return speedFees(await driver.readFees!({ chainId }), speed!);
  } catch {
    return undefined;
  }
}

/** Sequential send after a failed batch: the allowance is read again, so an approval that did land isn't repeated. */
async function sendSequentialFresh(driver: EvmDriver, chainId: number, address: Address, tx: EvmTx, opts: SendEvmTxOptions): Promise<SentEvmTx> {
  let needsApproval = false;
  if (tx.approval) {
    const allowance = await driver.readAllowance({ chainId, token: tx.approval.token as Address, owner: address, spender: tx.approval.spender as Address });
    needsApproval = allowance < BigInt(tx.approval.amount);
  }
  return sendSequential(driver, chainId, address, evmCalls(tx, needsApproval), needsApproval, opts);
}

export interface SendWalletCallsOptions {
  /** Default `auto`: one EIP-5792 batch where the wallet supports it, else one transaction per call. */
  batch?: BatchPreference;
  onStep?: (step: "switching" | "signing") => void;
  /** Sequential mode: called as each call's transaction is sent (index in `calls`). */
  onSent?: (index: number, hash: Hex) => void;
  onBatchFallback?: (error: unknown) => void;
  /** Batch mode: `wallet_sendCalls` returned this id (record it: from here on the calls must not be resent). */
  onBatchSent?: (batchId: string) => void;
}

export interface SentWalletCalls {
  mode: SendMode;
  /** Per call: the transaction that carried it (batch: the same hash for every call). */
  hashes: Hex[];
  batchId?: string;
}

/** A sequential send stopped part-way: `hashes` holds the transactions already sent, in order. */
export class PartialSendError extends Error {
  constructor(public readonly hashes: Hex[], public readonly cause: unknown) {
    super(`Sent ${hashes.length} transaction(s) before stopping: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PartialSendError";
  }
}

/**
 * `wallet_sendCalls` returned, but the batch's outcome is unknown (the status lookup failed, timed out
 * or is still pending). The calls may have landed: never resend them. Check later with `checkWalletCalls`.
 */
export class BatchPendingError extends Error {
  constructor(public readonly batchId: string, public readonly chainId: number, public readonly cause: unknown) {
    super(`The batch was sent but its status is unknown (${cause instanceof Error ? cause.message : String(cause)}). Don't send it again; check its status instead.`);
    this.name = "BatchPendingError";
  }
}

type BatchReceipt = { transactionHash: Hex; status?: string };
type BatchOutcome = { status: "success"; receipts: readonly BatchReceipt[] } | { status: "failed"; receipts: readonly BatchReceipt[] };

/** Waits for a sent batch. Explicit on-chain failure → `failed` (atomic: nothing landed); anything unclear → BatchPendingError. */
async function settleBatch(driver: EvmDriver, chainId: number, id: string): Promise<BatchOutcome> {
  let result: Awaited<ReturnType<EvmDriver["waitForCalls"]>>;
  try {
    result = await driver.waitForCalls({ chainId, id });
  } catch (e) {
    throw new BatchPendingError(id, chainId, e);
  }
  if (result.status === "failure") return { status: "failed", receipts: result.receipts ?? [] };
  const receipts = result.receipts ?? [];
  if (result.status !== "success" || receipts.length === 0) {
    throw new BatchPendingError(id, chainId, new Error(`wallet reported status ${result.status ?? "unknown"} with ${receipts.length} receipt(s)`));
  }
  return { status: "success", receipts };
}

/**
 * Looks up a batch sent earlier (after a BatchPendingError): `success` with the transaction hashes,
 * `failed` (nothing landed, safe to send again) or `pending` (still unknown: don't resend).
 */
export async function checkWalletCalls(driver: EvmDriver, chainId: number, batchId: string): Promise<{ status: "success" | "failed" | "pending"; hashes: Hex[] }> {
  try {
    const r = await settleBatch(driver, chainId, batchId);
    return { status: r.status, hashes: r.receipts.map((x) => x.transactionHash) };
  } catch (e) {
    if (e instanceof BatchPendingError) return { status: "pending", hashes: [] };
    throw e;
  }
}

/**
 * Sends independent calls (e.g. payout transfers) from the connected wallet: one EIP-5792
 * `wallet_sendCalls` confirmation when the wallet batches atomically on the chain (all or nothing),
 * else one transaction per call, each confirmed before the next is sent. A sequential send that
 * stops part-way throws PartialSendError with the hashes already sent; a reverted call throws too.
 * Falls back to sequential only when `wallet_sendCalls` itself is refused as unsupported; once it
 * returned a batch id, an unclear outcome throws BatchPendingError (never a resend).
 * Resolves once every call is on chain.
 */
export async function sendWalletCalls(driver: EvmDriver, chainId: number, calls: WalletCall[], opts: SendWalletCallsOptions = {}): Promise<SentWalletCalls> {
  if (calls.length === 0) return { mode: "sequential", hashes: [] };
  const { address, chainId: current } = await driver.getAccount();
  if (!address) throw new LayerHopWalletError("NO_ACCOUNT", "Connect an EVM wallet to continue.");
  if (current !== chainId) {
    opts.onStep?.("switching");
    await driver.switchChain(chainId);
  }
  const batch = opts.batch ?? "auto";
  if (batch !== "never" && calls.length > 1) {
    if (await detectAtomicBatch(driver, chainId, address)) {
      let id: string | undefined;
      try {
        opts.onStep?.("signing");
        id = await driver.sendCalls({ chainId, account: address, calls });
      } catch (e) {
        // Only a refused wallet_sendCalls may fall back: once it returned, the batch may be on its way.
        if (batch === "require" || !isBatchUnsupportedError(e)) throw e;
        opts.onBatchFallback?.(e);
      }
      if (id !== undefined) {
        opts.onBatchSent?.(id);
        const { status, receipts } = await settleBatch(driver, chainId, id);
        if (status === "failed") throw new LayerHopWalletError("BATCH_FAILED", "The batched transaction failed on-chain; nothing in it was sent.");
        const hashes = calls.map((_, i) => (receipts.length === calls.length ? receipts[i]! : receipts[receipts.length - 1]!).transactionHash);
        return { mode: "batch", hashes, batchId: id };
      }
    } else if (batch === "require") {
      throw new LayerHopWalletError("BATCH_UNSUPPORTED", "The connected wallet does not support atomic batching (EIP-5792) on this chain.");
    }
  }
  const hashes: Hex[] = [];
  for (const [i, call] of calls.entries()) {
    try {
      opts.onStep?.("signing");
      const hash = await driver.sendTransaction({ chainId, account: address, call });
      hashes.push(hash);
      opts.onSent?.(i, hash);
      if (!(await driver.waitForReceipt({ chainId, hash }))) throw new LayerHopWalletError("BATCH_FAILED", `Transaction ${i + 1} of ${calls.length} reverted on-chain.`);
    } catch (e) {
      if (hashes.length === 0) throw e;
      throw new PartialSendError(hashes, e);
    }
  }
  return { mode: "sequential", hashes };
}

/**
 * A settled batch as a sent tx, or `{ failed }` when it failed with nothing landed (safe to retry
 * sequentially). A failed batch with a successful receipt (partly landed) throws: retrying could pay twice.
 */
async function settleEvmBatch(
  driver: EvmDriver, chainId: number, id: string, calls: WalletCall[], needsApproval: boolean,
): Promise<SentEvmTx | { failed: LayerHopWalletError }> {
  const { status, receipts } = await settleBatch(driver, chainId, id);
  if (status === "failed") {
    const err = new LayerHopWalletError("BATCH_FAILED", "The batched transaction failed on-chain.");
    if (receipts.some((r) => r.status === "success")) throw err;
    return { failed: err };
  }
  // Atomic batches usually land as one transaction; if the wallet reports one receipt per call,
  // take the main call's (it follows the approval).
  const main = receipts.length === calls.length ? receipts[needsApproval ? 1 : 0] : receipts[receipts.length - 1];
  if (!main) throw new LayerHopWalletError("BATCH_FAILED", "The wallet reported the batch without a transaction receipt.");
  return { hash: main.transactionHash, chainId, mode: "batch", batchId: id, extraTxHashes: [], wait: async () => true };
}

async function sendSequential(
  driver: EvmDriver, chainId: number, account: Address, calls: WalletCall[], needsApproval: boolean, opts: SendEvmTxOptions,
): Promise<SentEvmTx> {
  let i = 0;
  let approvalHash: Hex | undefined;
  if (needsApproval) {
    opts.onApproval?.({ batched: false });
    opts.onStep?.("approving");
    approvalHash = await driver.sendTransaction({ chainId, account, call: calls[i++]!, ...withFees(await feesFor(driver, chainId, opts.speed)) });
    if (!(await driver.waitForReceipt({ chainId, hash: approvalHash }))) {
      throw new LayerHopWalletError("APPROVAL_FAILED", "Token approval failed on-chain.");
    }
  }
  opts.onStep?.("signing");
  const fees = await feesFor(driver, chainId, opts.speed);
  const hash = await driver.sendTransaction({ chainId, account, call: calls[i++]!, ...withFees(fees) });
  // Extra calls go after the main transaction. It has already been sent, so a rejected or failed
  // extra call never fails the send.
  const extraTxHashes: Hex[] = [];
  for (let n = 0; i < calls.length; i++, n++) {
    try {
      extraTxHashes.push(await driver.sendTransaction({ chainId, account, call: calls[i]!, ...withFees(fees) }));
    } catch (e) {
      if (opts.onExtraTxError) opts.onExtraTxError(e, n);
      else console.warn("LayerHop: extra transaction not sent", e);
    }
  }
  return { hash, chainId, mode: "sequential", approvalHash, extraTxHashes, ...withFees(fees), wait: () => driver.waitForReceipt({ chainId, hash }) };
}

/** `{ fees }` when there are fee fields, else nothing (drivers and results keep their old shape). */
const withFees = (fees: TxFees | undefined): { fees?: TxFees } => (fees ? { fees } : {});
