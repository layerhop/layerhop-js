import type { FeeChannel } from "./types.js";

/** Default LayerHop fee per channel in bps (docs/BOOTSTRAP_PLAN.md). Override via env in the API. */
export const DEFAULT_FEE_BPS: Record<FeeChannel, number> = {
  web: 30,
  widget: 30,
  api: 20,
  bot: 90,
};

/** amount * bps / 10_000, rounded down, on integer strings. */
export function applyBps(amount: string, bps: number): string {
  return ((BigInt(amount) * BigInt(bps)) / 10_000n).toString();
}

export function minAfterSlippage(amount: string, slippageBps: number): string {
  return ((BigInt(amount) * BigInt(10_000 - slippageBps)) / 10_000n).toString();
}
