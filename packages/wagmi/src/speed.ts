/**
 * Transaction speed on EVM chains: fee fields we suggest to the wallet with the transaction.
 *
 * - `normal`: no fee fields; the wallet picks its own (the default, as before).
 * - `fast` / `instant`, EIP-1559 chains: the priority fee is the median of the 75th / 95th percentile
 *   tips paid over the last 10 blocks (`eth_feeHistory`), at least the node's own suggestion
 *   (`eth_maxPriorityFeePerGas`) and at most max(5 × that suggestion, 2 × the base fee) for fast,
 *   max(10 × the suggestion, 4 × the base fee) for instant. `maxFeePerGas`
 *   is 2× / 3× the next block's base fee plus the tip, so a rising base fee doesn't strand it (the
 *   chain only charges base fee + tip, never the whole ceiling).
 * - Legacy chains (no base fee): `gasPrice` × 1.2 / × 1.5.
 *
 * Wallets show these as the site's suggestion and the user can still change them. EIP-5792 batches
 * (`wallet_sendCalls`) carry no fee fields, so a send with a speed goes one transaction at a time.
 */
export type GasSpeed = "normal" | "fast" | "instant";

/** What the chain says about fees right now (all in wei). */
export interface FeeSnapshot {
  /** Next block's base fee; undefined (or 0 history) on a legacy chain. */
  baseFeePerGas?: bigint;
  /** Recent tips per block at the 75th and 95th percentile (`eth_feeHistory` rewards). */
  rewards?: { p75: bigint[]; p95: bigint[] };
  /** `eth_maxPriorityFeePerGas`. */
  suggestedTip?: bigint;
  /** `eth_gasPrice`. */
  gasPrice?: bigint;
}

export type TxFees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { gasPrice: bigint };

const median = (v: readonly bigint[]): bigint | undefined => {
  if (!v.length) return undefined;
  const s = [...v].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor(s.length / 2)];
};
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Fee fields for `speed`, or undefined to leave the fees to the wallet. Pure. */
export function speedFees(s: FeeSnapshot, speed: GasSpeed): TxFees | undefined {
  if (speed === "normal") return undefined;
  if (s.baseFeePerGas !== undefined && s.baseFeePerGas > 0n) {
    const base = s.baseFeePerGas;
    const suggested = s.suggestedTip ?? 0n;
    const fromHistory = median(speed === "instant" ? (s.rewards?.p95 ?? []) : (s.rewards?.p75 ?? [])) ?? 0n;
    let tip = max(fromHistory, suggested);
    if (speed === "instant") tip = max(tip, median(s.rewards?.p75 ?? []) ?? 0n);
    const cap = speed === "instant" ? max(suggested * 10n, base * 4n) : max(suggested * 5n, base * 2n);
    if (tip > cap) tip = cap;
    if (tip <= 0n) return undefined;
    return { maxFeePerGas: base * (speed === "instant" ? 3n : 2n) + tip, maxPriorityFeePerGas: tip };
  }
  if (s.gasPrice !== undefined && s.gasPrice > 0n) return { gasPrice: (s.gasPrice * (speed === "instant" ? 150n : 120n)) / 100n };
  return undefined;
}

/**
 * Chains whose sequencer ignores the priority fee (first come, first served): a speed would only cost
 * more, so none is offered or applied. Arbitrum One / Nova (docs.arbitrum.io gas and fees), ZKsync
 * Era and Abstract (ZK Stack: the operator doesn't use the priority fee).
 */
export const NO_PRIORITY_FEE_CHAINS: ReadonlySet<number> = new Set([42161, 42170, 324, 2741]);

/** Whether a speed can change anything on `chainId`. */
export const speedSupported = (chainId: number): boolean => !NO_PRIORITY_FEE_CHAINS.has(chainId);

/** Reads a FeeSnapshot from an RPC `request` (read-only). Missing pieces stay undefined. */
export async function readFeeSnapshot(request: (method: string, params: unknown[]) => Promise<unknown>): Promise<FeeSnapshot> {
  const big = (x: unknown) => (typeof x === "string" && /^0x[0-9a-f]+$/i.test(x) ? BigInt(x) : undefined);
  const [history, tip, price] = await Promise.all([
    request("eth_feeHistory", ["0xa", "latest", [75, 95]]).catch(() => undefined) as Promise<{ baseFeePerGas?: string[]; reward?: string[][] } | undefined>,
    request("eth_maxPriorityFeePerGas", []).catch(() => undefined),
    request("eth_gasPrice", []).catch(() => undefined),
  ]);
  const bases = (history?.baseFeePerGas ?? []).map(big).filter((x): x is bigint => x !== undefined);
  const rows = (history?.reward ?? []).map((r) => r.map(big));
  const col = (i: number) => rows.map((r) => r[i]).filter((x): x is bigint => x !== undefined);
  return {
    baseFeePerGas: bases.length ? bases[bases.length - 1] : undefined,
    rewards: rows.length ? { p75: col(0), p95: col(1) } : undefined,
    suggestedTip: big(tip),
    gasPrice: big(price),
  };
}
