/** Builds deep links per docs/URL_CONTRACT.md. Only adds params, never renames them. */

export interface SwapLinkParams {
  srcChain: string;
  srcToken: string;
  dstChain: string;
  dstToken: string;
  /** Human units, `.` decimal separator (the contract's `amount`). */
  amount?: string;
  recipient?: string;
  slippageBps?: number;
  ref?: string;
  integrator?: string;
}

export interface EmbedParams {
  theme?: "dark" | "light";
  accent?: string;
  radius?: number;
  lockSrc?: boolean;
  lockDst?: boolean;
  hideHistory?: boolean;
}

export const WEB_ORIGIN = "https://layerhop.com";
const INTEGRATOR_RE = /^[a-z0-9-]{1,32}$/;

export function buildSwapLink(p: SwapLinkParams, opts: { embed?: EmbedParams | false; origin?: string } = {}): string {
  if (p.amount !== undefined && !/^\d+(\.\d+)?$/.test(p.amount)) {
    throw new Error(`amount must be a decimal in human units (e.g. 100 or 0.5), got "${p.amount}"`);
  }
  if (p.integrator !== undefined && !INTEGRATOR_RE.test(p.integrator)) {
    throw new Error("integrator must match [a-z0-9-]{1,32}");
  }
  if (p.slippageBps !== undefined && (!Number.isInteger(p.slippageBps) || p.slippageBps < 1 || p.slippageBps > 5000)) {
    throw new Error("slippage-bps must be an integer between 1 and 5000");
  }
  const q = new URLSearchParams();
  q.set("srcChain", p.srcChain);
  q.set("srcToken", p.srcToken);
  q.set("dstChain", p.dstChain);
  q.set("dstToken", p.dstToken);
  if (p.amount) q.set("amount", p.amount);
  if (p.recipient) q.set("recipient", p.recipient);
  if (p.slippageBps !== undefined) q.set("slippageBps", String(p.slippageBps));
  if (p.ref) q.set("ref", p.ref);
  if (p.integrator) q.set("integrator", p.integrator);
  const e = opts.embed;
  if (e) {
    if (e.theme) q.set("theme", e.theme);
    if (e.accent) {
      const accent = e.accent.replace(/^#/, "");
      if (!/^[0-9a-fA-F]{3,8}$/.test(accent)) throw new Error("accent must be a hex color like 22d3ee");
      q.set("accent", accent);
    }
    if (e.radius !== undefined) q.set("radius", String(e.radius));
    if (e.lockSrc) q.set("lockSrc", "1");
    if (e.lockDst) q.set("lockDst", "1");
    if (e.hideHistory) q.set("hideHistory", "1");
  }
  return `${opts.origin ?? WEB_ORIGIN}/${e ? "embed" : "swap"}?${q}`;
}
