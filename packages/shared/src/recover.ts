/**
 * Recover (stuck funds finder): native-bridge withdrawals whose second, on-Ethereum step (prove /
 * claim / finalize) was never done. Shared by the API scanner (services/api/src/recover) and the app
 * page (app.layerhop.com/recover). Types and pure helpers only.
 */
import type { EvmTx } from "./types.js";

export type RecoverBridge = "arbitrum" | "op-stack";

/**
 * Where a withdrawal stands:
 * - `waiting`: inside the challenge / proof window; `readyAt` says when it can be claimed.
 * - `ready_to_prove`: OP Stack step 1 of 2 can be sent now (then a 7-day wait, then finalize).
 * - `ready`: the final claim can be sent now (`step` says which call).
 * - `prove_elsewhere`: needs a proof we can't build for this chain yet; use the official bridge.
 * - `claimed`: already done, nothing to do.
 * - `unknown`: we found the withdrawal but couldn't read its state (RPC down, legacy format…).
 */
export type WithdrawalState = "waiting" | "ready_to_prove" | "ready" | "prove_elsewhere" | "claimed" | "unknown";

/** The transaction a `ready` / `ready_to_prove` withdrawal needs next. */
export type ClaimStep = "execute" | "prove" | "finalize";

export interface RecoverChain {
  /** The L2 the withdrawal starts on. */
  chainId: number;
  name: string;
  bridge: RecoverBridge;
  /**
   * Bridge UI for steps we don't build (and as a second opinion): the Arbitrum portal for Arbitrum;
   * Superbridge (the bridge the OP Stack chains link from their docs) for OP Stack chains.
   */
  bridgeUrl: string;
  bridgeName: string;
  /** Withdrawal window users should expect (seconds), for copy. */
  challengeSeconds: number;
}

/** L1 for every supported bridge today. */
export const RECOVER_L1_CHAIN_ID = 1;

/**
 * Chains the scanner covers. OP Stack chains are the ones in our chain list whose withdrawals finalize
 * through an OptimismPortal on Ethereum (addresses: services/api/src/recover/opstack.ts).
 */
export const RECOVER_CHAINS: readonly RecoverChain[] = [
  { chainId: 42161, name: "Arbitrum One", bridge: "arbitrum", bridgeName: "Arbitrum Bridge", bridgeUrl: "https://portal.arbitrum.io/bridge?sourceChain=arbitrum-one&destinationChain=ethereum", challengeSeconds: 6.4 * 86_400 },
  { chainId: 42170, name: "Arbitrum Nova", bridge: "arbitrum", bridgeName: "Arbitrum Bridge", bridgeUrl: "https://portal.arbitrum.io/bridge?sourceChain=arbitrum-nova&destinationChain=ethereum", challengeSeconds: 6.4 * 86_400 },
  { chainId: 10, name: "OP Mainnet", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/op", challengeSeconds: 7 * 86_400 },
  { chainId: 8453, name: "Base", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/base", challengeSeconds: 86_400 },
  { chainId: 130, name: "Unichain", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/unichain", challengeSeconds: 7 * 86_400 },
  { chainId: 57073, name: "Ink", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/ink", challengeSeconds: 7 * 86_400 },
  { chainId: 1868, name: "Soneium", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/soneium", challengeSeconds: 7 * 86_400 },
  { chainId: 480, name: "World Chain", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/world-chain", challengeSeconds: 7 * 86_400 },
  { chainId: 1135, name: "Lisk", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/lisk", challengeSeconds: 7 * 86_400 },
  { chainId: 34443, name: "Mode", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/mode", challengeSeconds: 7 * 86_400 },
  { chainId: 7777777, name: "Zora", bridge: "op-stack", bridgeName: "Superbridge", bridgeUrl: "https://superbridge.app/zora", challengeSeconds: 7 * 86_400 },
];

export function recoverChain(chainId: number): RecoverChain | undefined {
  return RECOVER_CHAINS.find((c) => c.chainId === chainId);
}

export interface RecoverToken {
  /** Token on Ethereum (where the claim pays out); `0x000…000` for ETH. */
  address: string;
  symbol?: string;
  decimals?: number;
}

export interface StuckWithdrawal {
  /** Stable id: `<l2ChainId>:<l2TxHash>:<n>` (n = the withdrawal's index within that tx). */
  id: string;
  bridge: RecoverBridge;
  chainId: number;
  l2TxHash: string;
  /** Unix seconds of the L2 transaction. */
  initiatedAt?: number;
  from?: string;
  /** Who receives the funds on Ethereum. */
  to: string;
  token: RecoverToken;
  /** Base units. */
  amount: string;
  state: WithdrawalState;
  /** Next transaction for `ready` / `ready_to_prove`. */
  step?: ClaimStep;
  /** `waiting`: unix seconds when the next step opens (an estimate when `readyAtEstimated`). */
  readyAt?: number;
  readyAtEstimated?: boolean;
  /** `claimed`: the L1 transaction, when known. */
  claimTxHash?: string;
  /** Bridge UI that can also finish this withdrawal (always set). */
  bridgeUrl: string;
  bridgeName: string;
  /** Plain-language detail for the user (why it's waiting, why we can't build a step…). */
  note?: string;
}

export interface RecoverCoverage {
  chainId: number;
  name: string;
  /** false when only part of the history was scanned (see `fromBlock` / `note`). */
  complete: boolean;
  /** First L2 block scanned. */
  fromBlock?: number;
  source: "rpc" | "indexer";
  /** Set when the scan of this chain failed or was partial. */
  note?: string;
  error?: boolean;
}

export interface RecoverScan {
  address: string;
  withdrawals: StuckWithdrawal[];
  coverage: RecoverCoverage[];
  /** Unix seconds. */
  scannedAt: number;
}

/**
 * `GET /v1/recover/claim`: the withdrawal's current state and, when it is actionable, the next
 * transaction (absent otherwise: claimed, waiting, or a proof we can't build).
 */
export interface RecoverClaim {
  withdrawal: StuckWithdrawal;
  step?: ClaimStep;
  /** The transaction to sign, on Ethereum. Anyone can send it; funds always go to `withdrawal.to`. */
  tx?: EvmTx;
  /** eth_call of `tx` from `sender` at the latest block. */
  simulation?: { ok: boolean; error?: string };
}

/** States a user can act on now. */
export function isActionable(w: Pick<StuckWithdrawal, "state">): boolean {
  return w.state === "ready" || w.state === "ready_to_prove";
}

/** Sort: actionable first, then waiting (soonest first), then the rest; newest first within a group. */
export function sortWithdrawals<T extends Pick<StuckWithdrawal, "state" | "readyAt" | "initiatedAt">>(ws: T[]): T[] {
  const rank: Record<WithdrawalState, number> = { ready: 0, ready_to_prove: 1, waiting: 2, prove_elsewhere: 3, unknown: 4, claimed: 5 };
  return [...ws].sort((a, b) =>
    rank[a.state] - rank[b.state]
    || (a.state === "waiting" ? (a.readyAt ?? Infinity) - (b.readyAt ?? Infinity) : 0)
    || (b.initiatedAt ?? 0) - (a.initiatedAt ?? 0));
}
