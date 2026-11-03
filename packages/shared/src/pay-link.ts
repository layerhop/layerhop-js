/**
 * Personal pay links (`layerhop.com/to/<name>`): anyone pays a person from any chain and token; the
 * person receives their preferred token on their preferred chain.
 *
 * `<name>` is an ENS name (`alice.eth`), a Solana name (`alice.sol`), or a plain EVM / Solana
 * address. The preferred token comes from, in order: the link's `?chain=&token=`, the ENS text record
 * `com.layerhop.receive`, then the default (USDC on Base for EVM addresses, USDC on Solana for Solana
 * addresses).
 *
 * Text record format (`com.layerhop.receive`): `<chain>:<token>`, where chain is a chain slug or id
 * (`base`, `8453`, `solana`) and token a symbol or address (`USDC`, `0x8335…`). Case-insensitive
 * except addresses. Several entries may be listed, comma-separated, in order of preference; the first
 * one LayerHop can deliver to is used. Example: `arbitrum:USDC` or `base:ETH, ethereum:USDC`.
 */
import { addressVm } from "./assets.js";
import { getAnyChain } from "./chains.js";
import type { Vm } from "./types.js";

export const PAY_LINK_TEXT_KEY = "com.layerhop.receive";
/** Longest text-record value we parse (anything longer is ignored). */
export const PAY_LINK_PREF_MAX = 256;
/** Longest note shown on a pay page. */
export const PAY_LINK_NOTE_MAX = 140;

export interface ReceivePreference {
  /** Chain slug or id, as written. */
  chain: string;
  /** Token symbol or address, as written. */
  token: string;
}

const ENTRY_RE = /^([a-z0-9-]{1,40}):([A-Za-z0-9._-]{1,64})$/;

/**
 * Parse a `com.layerhop.receive` value into its entries (in order). Invalid entries are skipped;
 * an empty list means "use the default". Chains are not checked against the registry here.
 */
export function parseReceivePreferences(value: string | null | undefined): ReceivePreference[] {
  if (!value || value.length > PAY_LINK_PREF_MAX) return [];
  const out: ReceivePreference[] = [];
  for (const raw of value.split(",")) {
    const m = ENTRY_RE.exec(raw.trim().replace(/^([^:]*)/, (c) => c.toLowerCase()));
    if (m) out.push({ chain: m[1]!, token: m[2]! });
  }
  return out;
}

/** The text-record value for a preference (what the "make your link" page tells people to set). */
export const formatReceivePreference = (p: ReceivePreference) => `${p.chain.toLowerCase()}:${p.token}`;

export const DEFAULT_RECEIVE: Record<Vm, ReceivePreference> = {
  evm: { chain: "base", token: "USDC" },
  svm: { chain: "solana", token: "USDC" },
  // Tron (D-048): only resolvable while TRON_ENABLED=1.
  tvm: { chain: "tron", token: "USDT" },
};

export type PayTarget =
  | { kind: "address"; vm: Vm; address: string }
  | { kind: "ens"; name: string }
  | { kind: "sns"; name: string };

const NAME_RE = /^(?:[a-z0-9¡-￿](?:[a-z0-9¡-￿_-]{0,62})?\.)+[a-z0-9¡-￿-]{2,63}$/u;

/**
 * What a `/to/<name>` path segment names, or undefined when it can't be a recipient. Names are
 * lowercased (ENS normalisation proper happens when resolving). `@` prefixes are tolerated.
 */
export function parsePayTarget(input: string): PayTarget | undefined {
  let v = input.trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    return undefined;
  }
  v = v.replace(/^@/, "");
  if (!v || v.length > 255) return undefined;
  const vm = addressVm(v);
  if (vm) return { kind: "address", vm, address: v };
  const name = v.toLowerCase();
  if (!NAME_RE.test(name)) return undefined;
  if (name.endsWith(".sol")) {
    // Second-level .sol names only (alice.sol); SNS subdomains are not resolved.
    return name.split(".").length === 2 ? { kind: "sns", name } : undefined;
  }
  return { kind: "ens", name };
}

/** A preference whose chain is in the registry, with that chain's VM. */
export function preferenceChain(p: ReceivePreference): { id: number; slug: string; vm: Vm } | undefined {
  const c = getAnyChain(/^\d+$/.test(p.chain) ? Number(p.chain) : p.chain);
  return c ? { id: c.id, slug: c.slug, vm: c.vm } : undefined;
}

export interface PayLinkParams {
  /** Requested amount in the recipient's token, human units ("25", "0.5"). */
  amount?: string;
  chain?: string;
  token?: string;
  note?: string;
}

const AMOUNT_RE = /^(?:\d{1,18}(?:\.\d{1,18})?|\.\d{1,18})$/;

/** Query params of a pay link; invalid values are dropped. The note is plain text, trimmed and capped. */
export function parsePayLinkParams(get: (k: string) => string | null | undefined): PayLinkParams {
  const amount = get("amount")?.trim();
  const chain = get("chain")?.trim().toLowerCase();
  const token = get("token")?.trim();
  // Control characters out; whitespace collapsed (the note is shown as text, never as HTML).
  const note = get("note")?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PAY_LINK_NOTE_MAX);
  return {
    ...(amount && AMOUNT_RE.test(amount) && Number(amount) > 0 ? { amount } : {}),
    ...(chain && /^[a-z0-9-]{1,40}$/.test(chain) ? { chain } : {}),
    ...(token && /^[A-Za-z0-9._-]{1,64}$/.test(token) ? { token } : {}),
    ...(note ? { note } : {}),
  };
}

/** `https://layerhop.com/to/<name>?…` for a name or address and optional params. */
export function buildPayLink(siteUrl: string, name: string, p: PayLinkParams = {}): string {
  const q = new URLSearchParams();
  if (p.amount) q.set("amount", p.amount);
  if (p.chain) q.set("chain", p.chain);
  if (p.token) q.set("token", p.token);
  if (p.note) q.set("note", p.note);
  const qs = q.toString();
  return `${siteUrl.replace(/\/$/, "")}/to/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`;
}
