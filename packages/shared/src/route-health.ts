/**
 * Route health (D-036). The API probes every listed chain every few hours with small read-only
 * quotes, in both directions:
 * - `in`:  Base USDC → the chain's native coin / canonical stablecoin
 * - `out`: the chain's native coin / canonical stablecoin → Base USDC
 * (Arbitrum USDC is the counterpart for Base itself.) A direction works when any of its probes got a
 * quote. GET /v1/chains reports the result per chain as `routeHealth`.
 *
 * Hysteresis: a direction turns `failing` only after it failed in ROUTE_HEALTH_FAIL_RUNS runs in a
 * row; one success restores `ok`. Until a direction has been checked it is `unknown`.
 */

export type RouteHealthDirection = "in" | "out";
export type RouteHealthTokenKind = "native" | "stable";
/** One direction of one chain. */
export type RouteHealthState = "ok" | "failing" | "unknown";
/** The chain as a whole. */
export type RouteHealthStatus = "ok" | "deposit_only" | "withdraw_only" | "unavailable" | "unknown";

export interface ChainRouteHealth {
  /** Routes into the chain (bridging to it). */
  in: RouteHealthState;
  /** Routes out of the chain (bridging from it). */
  out: RouteHealthState;
  status: RouteHealthStatus;
  /** ISO time of the newest probe of this chain. */
  checkedAt?: string;
}

/** Failed runs in a row before a direction counts as failing. */
export const ROUTE_HEALTH_FAIL_RUNS = 2;

/** What the store keeps per probe (chain × direction × token kind). */
export interface RouteHealthProbeRow {
  chainId: number;
  direction: RouteHealthDirection;
  tokenKind: RouteHealthTokenKind;
  ok: boolean;
  lastOkAt: Date | null;
  lastCheckedAt: Date;
  consecutiveFailures: number;
  lastErrorCode?: string | null;
}

/**
 * State of one direction from its probe rows. The direction's failure streak is the smallest streak
 * of its probes (a probe that worked last run resets it to 0).
 */
export function directionState(rows: readonly Pick<RouteHealthProbeRow, "consecutiveFailures" | "lastOkAt">[]): RouteHealthState {
  if (rows.length === 0) return "unknown";
  const streak = Math.min(...rows.map((r) => r.consecutiveFailures));
  if (streak === 0) return "ok";
  if (streak >= ROUTE_HEALTH_FAIL_RUNS) return "failing";
  // One failed run: keep "ok" if it ever worked (hysteresis), else we don't know yet.
  return rows.some((r) => r.lastOkAt) ? "ok" : "unknown";
}

export function chainStatus(dirIn: RouteHealthState, dirOut: RouteHealthState): RouteHealthStatus {
  if (dirIn === "failing" && dirOut === "failing") return "unavailable";
  if (dirIn === "failing") return dirOut === "ok" ? "withdraw_only" : "unknown";
  if (dirOut === "failing") return dirIn === "ok" ? "deposit_only" : "unknown";
  if (dirIn === "ok" || dirOut === "ok") return "ok";
  return "unknown";
}

/** `routeHealth` of every chain that has probe rows. */
export function deriveRouteHealth(rows: readonly RouteHealthProbeRow[]): Map<number, ChainRouteHealth> {
  const byChain = new Map<number, RouteHealthProbeRow[]>();
  for (const r of rows) {
    let l = byChain.get(r.chainId);
    if (!l) byChain.set(r.chainId, (l = []));
    l.push(r);
  }
  const out = new Map<number, ChainRouteHealth>();
  for (const [chainId, list] of byChain) {
    const dirIn = directionState(list.filter((r) => r.direction === "in"));
    const dirOut = directionState(list.filter((r) => r.direction === "out"));
    const checked = Math.max(...list.map((r) => r.lastCheckedAt.getTime()));
    out.set(chainId, { in: dirIn, out: dirOut, status: chainStatus(dirIn, dirOut), checkedAt: new Date(checked).toISOString() });
  }
  return out;
}

/** One probe's outcome in a run. `inconclusive` (every provider rate-limited / timed out) changes nothing. */
export interface RouteHealthProbeResult {
  chainId: number;
  direction: RouteHealthDirection;
  tokenKind: RouteHealthTokenKind;
  token: string;
  ok: boolean;
  inconclusive?: boolean;
  errorCode?: string;
}

/**
 * Next probe row after a result. Returns undefined when the result is inconclusive (the row stays
 * as it was).
 */
export function applyProbeResult(prev: RouteHealthProbeRow | undefined, r: RouteHealthProbeResult, at: Date): RouteHealthProbeRow | undefined {
  if (r.inconclusive) return undefined;
  return {
    chainId: r.chainId,
    direction: r.direction,
    tokenKind: r.tokenKind,
    ok: r.ok,
    lastOkAt: r.ok ? at : prev?.lastOkAt ?? null,
    lastCheckedAt: at,
    consecutiveFailures: r.ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
    lastErrorCode: r.ok ? null : r.errorCode ?? null,
  };
}

/**
 * Whether a run's results may be applied: a run in which no probe got a quote (our network or every
 * provider down) says nothing about the chains and is ignored.
 */
export function runIsUsable(results: readonly RouteHealthProbeResult[]): boolean {
  return results.some((r) => r.ok && !r.inconclusive);
}

/** Copy for apps: a destination / source chain whose routes currently fail in one direction. */
export function routeHealthWarning(chain: { name: string; routeHealth?: ChainRouteHealth }, side: "src" | "dst"): string | undefined {
  const h = chain.routeHealth;
  if (!h) return undefined;
  if (side === "dst") {
    if (h.in === "failing") return `Routes into ${chain.name} are currently unavailable.`;
    if (h.out === "failing") {
      return `You can bridge into ${chain.name} with LayerHop, but routes back out are currently unavailable — your funds could be stuck there.`;
    }
    return undefined;
  }
  if (h.out === "failing") return `Routes out of ${chain.name} are currently unavailable.`;
  return undefined;
}

/** Short picker label for a chain's route health ("deposit only"…), or undefined when nothing to say. */
export function routeHealthLabel(h: ChainRouteHealth | undefined): string | undefined {
  switch (h?.status) {
    case "deposit_only":
      return "deposit only";
    case "withdraw_only":
      return "withdraw only";
    case "unavailable":
      return "unavailable";
    default:
      return undefined;
  }
}
