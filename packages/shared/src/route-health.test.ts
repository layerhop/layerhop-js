import { describe, expect, it } from "vitest";
import {
  applyProbeResult, chainStatus, deriveRouteHealth, directionState, routeHealthLabel, routeHealthWarning, runIsUsable,
  type RouteHealthProbeResult, type RouteHealthProbeRow,
} from "./route-health.js";
import { minUsdBucket, sanitizeFunnelProps } from "./funnel.js";

const t0 = new Date("2026-10-23T00:00:00Z");
const t1 = new Date("2026-10-23T02:00:00Z");
const t2 = new Date("2026-10-23T04:00:00Z");
const res = (ok: boolean, extra: Partial<RouteHealthProbeResult> = {}): RouteHealthProbeResult => ({
  chainId: 42170, direction: "out", tokenKind: "native", token: "0x0", ok, ...extra,
});

describe("route health derivation", () => {
  it("a direction fails only after 2 failed runs in a row; one success restores it", () => {
    let row: RouteHealthProbeRow | undefined = applyProbeResult(undefined, res(true), t0);
    expect(directionState([row!])).toBe("ok");
    row = applyProbeResult(row, res(false, { errorCode: "NO_ROUTE" }), t1);
    expect(row).toMatchObject({ consecutiveFailures: 1, lastOkAt: t0, lastErrorCode: "NO_ROUTE" });
    expect(directionState([row!])).toBe("ok"); // hysteresis: one failure keeps ok
    row = applyProbeResult(row, res(false), t2);
    expect(directionState([row!])).toBe("failing");
    row = applyProbeResult(row, res(true), t2);
    expect(row).toMatchObject({ consecutiveFailures: 0, lastErrorCode: null });
    expect(directionState([row!])).toBe("ok");
  });

  it("never-ok with one failure is unknown; no rows is unknown; the best probe of a direction wins", () => {
    const once = applyProbeResult(undefined, res(false), t0)!;
    expect(directionState([once])).toBe("unknown");
    expect(directionState([])).toBe("unknown");
    const failing = { ...once, consecutiveFailures: 3 };
    const okStable = { ...once, tokenKind: "stable" as const, consecutiveFailures: 0, lastOkAt: t0 };
    expect(directionState([failing, okStable])).toBe("ok");
  });

  it("inconclusive results leave the row unchanged", () => {
    const prev = applyProbeResult(undefined, res(true), t0)!;
    expect(applyProbeResult(prev, res(false, { inconclusive: true }), t1)).toBeUndefined();
  });

  it("chain status from both directions", () => {
    expect(chainStatus("ok", "ok")).toBe("ok");
    expect(chainStatus("ok", "failing")).toBe("deposit_only");
    expect(chainStatus("failing", "ok")).toBe("withdraw_only");
    expect(chainStatus("failing", "failing")).toBe("unavailable");
    expect(chainStatus("ok", "unknown")).toBe("ok");
    expect(chainStatus("unknown", "unknown")).toBe("unknown");
    expect(chainStatus("unknown", "failing")).toBe("unknown");
  });

  it("derives per-chain routeHealth with the newest check time", () => {
    const rows: RouteHealthProbeRow[] = [
      { chainId: 1, direction: "in", tokenKind: "native", ok: true, lastOkAt: t1, lastCheckedAt: t1, consecutiveFailures: 0 },
      { chainId: 1, direction: "out", tokenKind: "native", ok: false, lastOkAt: null, lastCheckedAt: t2, consecutiveFailures: 2 },
      { chainId: 1, direction: "out", tokenKind: "stable", ok: false, lastOkAt: t0, lastCheckedAt: t0, consecutiveFailures: 4 },
      { chainId: 2, direction: "in", tokenKind: "native", ok: false, lastOkAt: null, lastCheckedAt: t2, consecutiveFailures: 2 },
      { chainId: 2, direction: "out", tokenKind: "native", ok: false, lastOkAt: null, lastCheckedAt: t2, consecutiveFailures: 2 },
    ];
    const h = deriveRouteHealth(rows);
    expect(h.get(1)).toEqual({ in: "ok", out: "failing", status: "deposit_only", checkedAt: t2.toISOString() });
    expect(h.get(2)!.status).toBe("unavailable");
  });

  it("a run where no probe got a quote is not usable", () => {
    expect(runIsUsable([res(false), res(false, { inconclusive: true })])).toBe(false);
    expect(runIsUsable([])).toBe(false);
    expect(runIsUsable([res(false), res(true)])).toBe(true);
  });

  it("app copy: warnings per side and picker labels", () => {
    const depositOnly = { name: "Flare", routeHealth: { in: "ok", out: "failing", status: "deposit_only" } as const };
    expect(routeHealthWarning(depositOnly, "dst")).toMatch(/You can bridge into Flare with LayerHop, but routes back out are currently unavailable — your funds could be stuck there\./);
    expect(routeHealthWarning(depositOnly, "src")).toBe("Routes out of Flare are currently unavailable.");
    const withdrawOnly = { name: "Flow EVM", routeHealth: { in: "failing", out: "ok", status: "withdraw_only" } as const };
    expect(routeHealthWarning(withdrawOnly, "dst")).toBe("Routes into Flow EVM are currently unavailable.");
    expect(routeHealthWarning({ name: "Base" }, "dst")).toBeUndefined();
    expect(routeHealthLabel(depositOnly.routeHealth)).toBe("deposit only");
    expect(routeHealthLabel(withdrawOnly.routeHealth)).toBe("withdraw only");
    expect(routeHealthLabel(undefined)).toBeUndefined();
  });

  it("min_usd_bucket funnel prop", () => {
    expect(minUsdBucket(3)).toBe("<5");
    expect(minUsdBucket(10)).toBe("10-25");
    expect(minUsdBucket(80)).toBe("50+");
    expect(sanitizeFunnelProps({ min_usd_bucket: "10-25", error_code: "AMOUNT_TOO_SMALL" })).toEqual({ min_usd_bucket: "10-25", error_code: "AMOUNT_TOO_SMALL" });
    expect(sanitizeFunnelProps({ min_usd_bucket: "12.5" })).toEqual({});
  });
});
