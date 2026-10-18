/**
 * Test mode (`lh_test_…` keys). Sandbox quotes and orders never touch a real provider; the order
 * lifecycle is simulated by the worker. The last digits of `amount` pick the outcome, like Stripe's
 * test card numbers, so every path can be exercised end to end.
 */
export const TEST_KEY_PREFIX = "lh_test_";
export const LIVE_KEY_PREFIX = "lh_live_";

export type SandboxOutcome = "filled" | "refunded" | "failed" | "no_route";

/** `amount` suffix → outcome. Anything else fills. */
export const SANDBOX_MAGIC_AMOUNTS: readonly { suffix: string; outcome: Exclude<SandboxOutcome, "filled"> }[] = [
  { suffix: "4001", outcome: "refunded" },
  { suffix: "4002", outcome: "failed" },
  { suffix: "4004", outcome: "no_route" },
];

export function sandboxOutcome(amount: string): SandboxOutcome {
  return SANDBOX_MAGIC_AMOUNTS.find((m) => amount.endsWith(m.suffix))?.outcome ?? "filled";
}

export const isTestKey = (key: string | undefined | null): boolean => !!key && key.startsWith(TEST_KEY_PREFIX);
