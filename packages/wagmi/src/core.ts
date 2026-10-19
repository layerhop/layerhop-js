import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import type { EvmTx } from "@layerhop/sdk";

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
  waitForCalls(p: { chainId: number; id: string }): Promise<{ status?: string; receipts?: readonly { transactionHash: Hex }[] }>;
  sendTransaction(p: { chainId: number; account: Address; call: WalletCall }): Promise<Hex>;
  /** Resolves true when the transaction succeeded, false when it reverted. */
  waitForReceipt(p: { chainId: number; hash: Hex }): Promise<boolean>;
}

export interface SendEvmTxOptions {
  onStep?: (step: SendStep) => void;
  /** The send includes an ERC-20 approval (`batched`: it rides in the same confirmation). */
  onApproval?: (info: { batched: boolean }) => void;
  /** Default `auto`. */
  batch?: BatchPreference;
  /** Batching was tried and the wallet refused it as unsupported; the send continues sequentially. */
  onBatchFallback?: (error: unknown) => void;
  /** A sequential extra call (e.g. the checkout fee transfer) was not sent. Default: console.warn. */
  onExtraTxError?: (error: unknown, index: number) => void;
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
  /** Resolves true once the main call is confirmed on chain, false when it reverted. */
  wait: () => Promise<boolean>;
}

/** Thrown for problems this package detects itself (wallet errors keep their own type). */
export class LayerHopWalletError extends Error {
  constructor(
    public readonly code: "NO_ACCOUNT" | "SANDBOX_TX" | "NOT_EVM" | "BATCH_UNSUPPORTED" | "BATCH_FAILED" | "APPROVAL_FAILED",
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
  const batch = opts.batch ?? "auto";

  if (batch !== "never" && calls.length > 1) {
    if (await detectAtomicBatch(driver, chainId, address)) {
      try {
        return await sendBatch(driver, chainId, address, calls, needsApproval, opts);
      } catch (e) {
        if (batch === "require" || !isBatchUnsupportedError(e)) throw e;
        opts.onBatchFallback?.(e);
      }
    } else if (batch === "require") {
      throw new LayerHopWalletError("BATCH_UNSUPPORTED", "The connected wallet does not support atomic batching (EIP-5792) on this chain.");
    }
  }
  return sendSequential(driver, chainId, address, calls, needsApproval, opts);
}

async function sendBatch(
  driver: EvmDriver, chainId: number, account: Address, calls: WalletCall[], needsApproval: boolean, opts: SendEvmTxOptions,
): Promise<SentEvmTx> {
  if (needsApproval) opts.onApproval?.({ batched: true });
  opts.onStep?.("signing");
  const id = await driver.sendCalls({ chainId, account, calls });
  const result = await driver.waitForCalls({ chainId, id });
  if (result.status !== "success") throw new LayerHopWalletError("BATCH_FAILED", "The batched transaction failed on-chain.");
  const receipts = result.receipts ?? [];
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
    approvalHash = await driver.sendTransaction({ chainId, account, call: calls[i++]! });
    if (!(await driver.waitForReceipt({ chainId, hash: approvalHash }))) {
      throw new LayerHopWalletError("APPROVAL_FAILED", "Token approval failed on-chain.");
    }
  }
  opts.onStep?.("signing");
  const hash = await driver.sendTransaction({ chainId, account, call: calls[i++]! });
  // Extra calls go after the main transaction. It has already been sent, so a rejected or failed
  // extra call never fails the send.
  const extraTxHashes: Hex[] = [];
  for (let n = 0; i < calls.length; i++, n++) {
    try {
      extraTxHashes.push(await driver.sendTransaction({ chainId, account, call: calls[i]! }));
    } catch (e) {
      if (opts.onExtraTxError) opts.onExtraTxError(e, n);
      else console.warn("LayerHop: extra transaction not sent", e);
    }
  }
  return { hash, chainId, mode: "sequential", approvalHash, extraTxHashes, wait: () => driver.waitForReceipt({ chainId, hash }) };
}
