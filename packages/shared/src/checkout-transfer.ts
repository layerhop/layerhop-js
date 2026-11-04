/**
 * Checkout "Send to address" (scan-to-pay): the payer sends the settlement token from any wallet or
 * exchange instead of connecting a wallet to the page. Pure helpers shared by the API (what the page
 * shows), the worker (matching transfers to sessions) and the web app (QR payloads).
 *
 * EVM: a plain transfer carries no memo, so each session in this mode gets a **tag** (1–9999) that
 * is written into the amount's sub-cent digits: the payer sends the amount due rounded up to the next
 * amount whose remainder modulo 0.01 token equals `tag` millionths (at most 0.0099 token extra).
 * Tags are unique among the active sessions paying the same address, token and chain, so a transfer
 * maps to at most one session by its remainder alone. Exchanges usually take a round withdrawal fee
 * (e.g. 1 USDC), which keeps the remainder: the payment is then seen as short, and the top-up the page
 * asks for carries the same tag.
 *
 * Solana: a Solana Pay `reference` key (random 32 bytes) is added to the transfer instruction, so the
 * worker finds the payment with getSignaturesForAddress(reference); no amount tag needed.
 */
import type { ChainId } from "./types.js";

/** Tags are 1..TRANSFER_TAG_MAX (0 would match every round amount). */
export const TRANSFER_TAG_MAX = 9999;
/** A tag stays reserved this long after its session expired, so a late payment can't hit a new session. */
export const TRANSFER_TAG_COOLDOWN_MS = 24 * 3_600_000;

/** Base units of one tag step (1e-6 token) and the modulus (0.01 token). */
export function transferScale(decimals: number): { step: bigint; modulus: bigint } {
  const step = 10n ** BigInt(Math.max(0, decimals - 6));
  return { step, modulus: step * BigInt(TRANSFER_TAG_MAX + 1) };
}

/** The smallest amount ≥ `atLeast` (and > 0) whose remainder modulo 0.01 token is `tag` steps. */
export function taggedAmount(atLeast: bigint, tag: number, decimals: number): bigint {
  if (!Number.isInteger(tag) || tag < 1 || tag > TRANSFER_TAG_MAX) throw new Error(`invalid transfer tag ${tag}`);
  const { step, modulus } = transferScale(decimals);
  const want = BigInt(tag) * step;
  const base = atLeast > 0n ? atLeast : 1n;
  const r = base % modulus;
  return base - r + want + (want >= r ? 0n : modulus);
}

/** The tag a received amount carries, or null when it carries none (round amount, off-step digits). */
export function tagOf(amount: bigint, decimals: number): number | null {
  const { step, modulus } = transferScale(decimals);
  const r = amount % modulus;
  if (r === 0n || r % step !== 0n) return null;
  return Number(r / step);
}

/** A free tag (random among the unused ones), or null when all are taken. */
export function pickTransferTag(used: Iterable<number>, random: () => number = Math.random): number | null {
  const taken = new Set(used);
  const free: number[] = [];
  for (let t = 1; t <= TRANSFER_TAG_MAX; t++) if (!taken.has(t)) free.push(t);
  if (!free.length) return null;
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))]!;
}

export type TransferPaymentState = "waiting" | "partial" | "paid" | "overpaid";

/** Where a session stands after receiving `received` of `due`. */
export function transferPaymentState(received: bigint, due: bigint): TransferPaymentState {
  if (received <= 0n) return "waiting";
  if (received < due) return "partial";
  return received === due ? "paid" : "overpaid";
}

/** Integer base units → decimal string without trailing zeros ("1500000", 6 → "1.5"). */
export function unitsToDecimal(units: bigint | string, decimals: number): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals) || "0";
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/**
 * EIP-681 ERC-20 transfer request: `ethereum:<token>@<chainId>/transfer?address=<to>&uint256=<units>`.
 * Wallets that read it prefill token, network, recipient and the exact amount.
 */
export function eip681TransferUri(p: { chainId: ChainId; token: string; recipient: string; amount: bigint | string }): string {
  return `ethereum:${p.token}@${p.chainId}/transfer?address=${p.recipient}&uint256=${BigInt(p.amount).toString()}`;
}

/**
 * Solana Pay transfer request: `solana:<recipient>?amount=<decimal>&spl-token=<mint>&reference=<key>`
 * (amount in tokens, not base units; label / message URL-encoded).
 */
export function solanaPayTransferUri(p: {
  recipient: string; amount: bigint | string; decimals: number; mint: string; reference?: string; label?: string; message?: string;
}): string {
  const q = [`amount=${unitsToDecimal(p.amount, p.decimals)}`, `spl-token=${p.mint}`];
  if (p.reference) q.push(`reference=${p.reference}`);
  if (p.label) q.push(`label=${encodeURIComponent(p.label)}`);
  if (p.message) q.push(`message=${encodeURIComponent(p.message)}`);
  return `solana:${p.recipient}?${q.join("&")}`;
}

/**
 * Solana Pay transaction request: `solana:<https link>`. The wallet GETs the link for a label and
 * icon, then POSTs `{ account }` and signs the transaction it gets back. A link with a query string
 * must be URL-encoded (Solana Pay spec); a plain path is left as is.
 */
export function solanaPayTransactionUri(link: string): string {
  return `solana:${link.includes("?") ? encodeURIComponent(link) : link}`;
}
