import type { FeeChannel } from "./types.js";

/**
 * Default LayerHop fee per channel in bps (D-034: halved on 2026-10-23 from 30/30/20/90). Override via
 * env in the API.
 */
export const DEFAULT_FEE_BPS: Record<FeeChannel, number> = {
  web: 15,
  widget: 15,
  api: 10,
  bot: 45,
};

/**
 * LayerHop fee on a checkout payment made in the settlement token on the settlement chain (a direct
 * transfer), in bps of the amount due, paid on top by the payer (FEE_BPS_CHECKOUT_DIRECT overrides).
 * D-025 set 50 bps; D-034 halved it to 25 bps.
 */
export const DEFAULT_CHECKOUT_DIRECT_FEE_BPS = 25;

/** amount * bps / 10_000, rounded down, on integer strings. */
export function applyBps(amount: string, bps: number): string {
  return ((BigInt(amount) * BigInt(bps)) / 10_000n).toString();
}

export function minAfterSlippage(amount: string, slippageBps: number): string {
  return ((BigInt(amount) * BigInt(10_000 - slippageBps)) / 10_000n).toString();
}
