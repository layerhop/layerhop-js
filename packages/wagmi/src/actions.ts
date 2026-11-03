// Framework-free entry (`@layerhop/wagmi/actions`): viem + wagmi core actions, no React.
export {
  sendEvmTx,
  evmCalls,
  approvalCall,
  supportsAtomicBatch,
  detectAtomicBatch,
  atomicBatchStatus,
  detectAtomicBatchStatus,
  isBatchUnsupportedError,
  isBatchSendFailure,
  LayerHopWalletError,
  sendWalletCalls,
  PartialSendError,
  type AtomicBatchStatus,
  BatchPendingError,
  checkWalletCalls,
  type SendWalletCallsOptions,
  type SentWalletCalls,
  type EvmDriver,
  type WalletCall,
  type SendStep,
  type SendMode,
  type BatchPreference,
  type SendEvmTxOptions,
  type SentEvmTx,
} from "./core.js";
export {
  wagmiDriver,
  walletClientDriver,
  CALLS_TIMEOUT_MS,
  type WagmiDriverOptions,
  type WalletClientDriverOptions,
} from "./drivers.js";
export {
  executeQuote,
  executeQuoteWithWalletClient,
  executeQuoteWith,
  placeholderTxHash,
  type ExecuteClient,
  type ExecuteStep,
  type ExecuteQuoteParameters,
  type ExecuteQuoteResult,
} from "./execute.js";
export { signGasless, wagmiGaslessSigner, type GaslessSigner } from "./gasless.js";

import type { Config } from "wagmi";
import { detectAtomicBatch, detectAtomicBatchStatus, type AtomicBatchStatus } from "./core.js";
import { wagmiDriver } from "./drivers.js";

/**
 * Whether the wallet connected to `config` batches atomically (EIP-5792) on `chainId`, i.e. whether
 * approve + swap (+ fee transfer) will take one confirmation. False when not connected.
 */
export async function getAtomicBatchSupport(config: Config, chainId: number): Promise<boolean> {
  const driver = wagmiDriver(config);
  const { address } = await driver.getAccount();
  return address ? detectAtomicBatch(driver, chainId, address) : false;
}

/**
 * `supported`, `ready` (the wallet upgrades the account with EIP-7702 on the first batch, after the
 * user approves it in the wallet) or `none`, for the wallet connected to `config` on `chainId`;
 * `none` when not connected. For "one signature" hints next to a send button.
 */
export async function getAtomicBatchStatus(config: Config, chainId: number): Promise<AtomicBatchStatus> {
  const driver = wagmiDriver(config);
  const { address } = await driver.getAccount();
  return address ? detectAtomicBatchStatus(driver, chainId, address) : "none";
}
