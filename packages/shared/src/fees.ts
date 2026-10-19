import type { FeeChannel } from "./types.js";

/** Default LayerHop fee per channel in bps (docs/BOOTSTRAP_PLAN.md). Override via env in the API. */
export const DEFAULT_FEE_BPS: Record<FeeChannel, number> = {
  web: 30,
  widget: 30,
  api: 20,
  bot: 90,
};

/**
 * LayerHop fee on a checkout payment made in the settlement token on the settlement chain (a direct
 * transfer), in bps of the amount due, paid on top by the payer (FEE_BPS_CHECKOUT_DIRECT overrides).
 */
export const DEFAULT_CHECKOUT_DIRECT_FEE_BPS = 50;

/** amount * bps / 10_000, rounded down, on integer strings. */
export function applyBps(amount: string, bps: number): string {
  return ((BigInt(amount) * BigInt(bps)) / 10_000n).toString();
}

export function minAfterSlippage(amount: string, slippageBps: number): string {
  return ((BigInt(amount) * BigInt(10_000 - slippageBps)) / 10_000n).toString();
}
