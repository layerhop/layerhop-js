/**
 * Gas station (multi-chain refuel): one transaction sends a little native gas to several chains.
 * Source: Gas.zip (packages/providers/src/gaszip), behind GAS_STATION_ENABLED (default off).
 * Types and pure request checks, shared by the API and app.layerhop.com/gas.
 */
import type { EvmTx } from "./types.js";

export const GAS_STATION_MAX_CHAINS = 10;
/** Our per-chain caps (USD), on top of the source's own minimums / maximums. */
export const GAS_STATION_MIN_USD = 0.5;
export const GAS_STATION_MAX_USD = 50;
export const GAS_STATION_PRESETS: readonly { id: string; usd: number; label: string }[] = [
  { id: "1", usd: 1, label: "$1 on each" },
  { id: "2", usd: 2, label: "$2 on each" },
  { id: "5", usd: 5, label: "$5 on each" },
];

export interface GasStationChain {
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  /** Can pay from this chain (native token). */
  inbound: boolean;
  /** Can refuel this chain. */
  outbound: boolean;
  /** Per-destination USD range (our caps ∩ the source's). */
  minUsd: number;
  maxUsd: number;
  /** Source-side USD range of the whole deposit. */
  minDepositUsd?: number;
  maxDepositUsd?: number;
}

export interface GasStationDestination {
  chainId: number;
  usd: number;
}

export interface GasStationQuote {
  provider: "gaszip";
  srcChainId: number;
  sender: string;
  recipient: string;
  /** What the sender pays, wei of the source chain's native token, and its USD value. */
  depositWei: string;
  depositUsd: number;
  destinations: { chainId: number; name: string; symbol: string; decimals: number; expectedWei: string; usd: number; seconds?: number }[];
  /** ourFeeBps is 0: Gas.zip has no integrator fee (owner decision pending). providerFeeUsd = deposit − delivered. */
  fees: { ourFeeBps: number; providerFeeUsd: number };
  /** One transaction to sign on the source chain. */
  tx: EvmTx;
  /** eth_call of `tx` from `sender` (read-only): false usually means not enough balance. */
  simulation: { ok: boolean; error?: string };
  /** Unix seconds. */
  expiresAt: number;
}

export type GasStationIssue =
  | { code: "count"; message: string }
  | { code: "duplicate"; chainId: number; message: string }
  | { code: "same_chain"; chainId: number; message: string }
  | { code: "unsupported"; chainId: number; message: string }
  | { code: "amount"; chainId: number; message: string }
  | { code: "uneven"; message: string };

/**
 * Problems with a refuel request, in order; empty = valid. `chains` is the source's chain table.
 * One amount for all destinations: the source splits a single deposit evenly.
 */
export function gasStationIssues(srcChainId: number, dests: GasStationDestination[], chains: ReadonlyMap<number, GasStationChain>): GasStationIssue[] {
  const out: GasStationIssue[] = [];
  if (dests.length === 0 || dests.length > GAS_STATION_MAX_CHAINS) out.push({ code: "count", message: `Pick 1 to ${GAS_STATION_MAX_CHAINS} chains` });
  const seen = new Set<number>();
  for (const d of dests) {
    const c = chains.get(d.chainId);
    const name = c?.name ?? `chain ${d.chainId}`;
    if (seen.has(d.chainId)) out.push({ code: "duplicate", chainId: d.chainId, message: `${name} is listed twice` });
    seen.add(d.chainId);
    if (d.chainId === srcChainId) out.push({ code: "same_chain", chainId: d.chainId, message: `${name} is the chain you pay from` });
    if (!c?.outbound) out.push({ code: "unsupported", chainId: d.chainId, message: `${name} can't be refueled right now` });
    else if (!(d.usd >= c.minUsd && d.usd <= c.maxUsd)) out.push({ code: "amount", chainId: d.chainId, message: `${name}: pick between $${c.minUsd} and $${c.maxUsd}` });
  }
  if (dests.length > 1 && dests.some((d) => d.usd !== dests[0]!.usd)) out.push({ code: "uneven", message: "Use the same amount for every chain: one deposit is split evenly" });
  return out;
}

/** Wei for `usd` of a native token priced `price` USD, rounded up to a millionth of the token (each chain gets at least its share). */
export function usdToWei(usd: number, price: number, decimals: number): bigint {
  if (!(usd > 0) || !(price > 0)) return 0n;
  const micro = BigInt(Math.ceil((usd / price) * 1e6));
  return (micro * 10n ** BigInt(decimals) + 999_999n) / 1_000_000n;
}
