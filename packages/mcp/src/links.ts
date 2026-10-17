/** Deep links per docs/URL_CONTRACT.md: https://layerhop.com/swap?srcChain&srcToken&dstChain&dstToken&amount(human)&... */

export interface SwapLinkParams {
  fromChain: string | number;
  fromToken: string;
  toChain: string | number;
  toToken: string;
  /** Human units, decimal string with "." separator. */
  amount?: string;
  recipient?: string;
  slippageBps?: number;
  integrator?: string;
  /** Attribution. Anything other than "bot" uses the web fee channel. */
  ref?: string;
}

export const DEFAULT_APP_URL = "https://layerhop.com";
const INTEGRATOR_RE = /^[a-z0-9-]{1,32}$/;

export function buildSwapLink(p: SwapLinkParams, appUrl = DEFAULT_APP_URL): string {
  const url = new URL("/swap", appUrl.replace(/\/$/, "") + "/");
  const q = url.searchParams;
  q.set("srcChain", String(p.fromChain));
  q.set("srcToken", p.fromToken);
  q.set("dstChain", String(p.toChain));
  q.set("dstToken", p.toToken);
  if (p.amount) q.set("amount", p.amount);
  if (p.recipient) q.set("recipient", p.recipient);
  if (p.slippageBps !== undefined) q.set("slippageBps", String(p.slippageBps));
  if (p.integrator && INTEGRATOR_RE.test(p.integrator)) q.set("integrator", p.integrator);
  q.set("ref", p.ref ?? "mcp");
  return url.toString();
}
