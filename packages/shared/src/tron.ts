/**
 * Tron (TVM) address helpers (D-048). Tron accounts are 21 bytes: a 0x41 prefix byte plus the same
 * 20-byte account an EVM address has. Three spellings exist:
 *
 * - base58check "T-address" (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`): what users and wallets show,
 *   and LayerHop's canonical form everywhere (API, DB, tokens).
 * - 41-hex (`41a614f803b6fd780986a42c78ec9c7f77e6ded13c`): what the node HTTP API (TronGrid
 *   `triggersmartcontract`, `triggerconstantcontract`) and Relay's steps use.
 * - 0x-hex (`0xa614f803b6fd780986a42c78ec9c7f77e6ded13c`): the 20-byte account inside ABI calldata.
 *
 * Pure functions, no network; safe in browsers.
 */
import { sha256 } from "@noble/hashes/sha256";
import { createBase58check } from "@scure/base";

const b58c = createBase58check(sha256);

/** Address prefix byte of Tron mainnet accounts. */
export const TRON_ADDRESS_PREFIX = 0x41;
const T_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const HEX41_RE = /^41[0-9a-fA-F]{40}$/;
const HEX20_RE = /^(0x)?[0-9a-fA-F]{40}$/;

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

/** 21 raw bytes (0x41 + account) of a T-address, or undefined when it isn't a valid one. */
function decodeT(address: string): Uint8Array | undefined {
  if (!T_ADDRESS_RE.test(address)) return undefined;
  try {
    const b = b58c.decode(address);
    return b.length === 21 && b[0] === TRON_ADDRESS_PREFIX ? b : undefined;
  } catch {
    return undefined;
  }
}

/** A valid base58check Tron mainnet address (`T…`, 34 characters, checksum verified). */
export function isTronAddress(value: string): boolean {
  return decodeT(value) !== undefined;
}

/** T-address → `41…` hex (42 lowercase hex characters). Throws on an invalid address. */
export function tronToHex41(address: string): string {
  const b = decodeT(address);
  if (!b) throw new Error(`Not a Tron address: ${address}`);
  return toHex(b);
}

/** T-address → the 20-byte account as `0x…` (lowercase), as it appears in ABI calldata. */
export function tronToEvmHex(address: string): `0x${string}` {
  return `0x${tronToHex41(address).slice(2)}`;
}

/**
 * Any spelling → T-address: a T-address (checked), `41…` hex (42 chars) or a 20-byte `0x…` / bare
 * hex account. Throws on anything else.
 */
export function toTronAddress(value: string): string {
  const v = value.trim();
  if (decodeT(v)) return v;
  let bytes: Uint8Array;
  if (HEX41_RE.test(v)) bytes = fromHex(v.toLowerCase());
  else if (HEX20_RE.test(v)) bytes = fromHex(`41${v.replace(/^0x/, "").toLowerCase()}`);
  else throw new Error(`Not a Tron address: ${value}`);
  return b58c.encode(bytes);
}

/** `toTronAddress`, or undefined instead of throwing. */
export function normalizeTronAddress(value: string): string | undefined {
  try {
    return toTronAddress(value);
  } catch {
    return undefined;
  }
}

/**
 * Tron tx hashes are 32 bytes. LayerHop's canonical form is 64 lowercase hex WITHOUT `0x` (what
 * Tronscan, TronLink and Relay show); `0x…` input is accepted and normalized.
 */
const TRON_TX_HASH_RE = /^(0x)?[0-9a-fA-F]{64}$/;

export function isTronTxHash(value: string): boolean {
  return TRON_TX_HASH_RE.test(value.trim());
}

/** Canonical Tron tx hash (64 lowercase hex, no 0x), or undefined. */
export function normalizeTronTxHash(value: string): string | undefined {
  const v = value.trim();
  return TRON_TX_HASH_RE.test(v) ? v.replace(/^0x/i, "").toLowerCase() : undefined;
}

/**
 * FEE_RECIPIENT_TVM (D-048): our Tron fee wallet as a T-address, or undefined when unset/blank.
 * Throws at startup on anything that is not a valid base58check T-address (a 0x or 41-hex spelling
 * is refused too: deBridge wants the T-form, and a typo must not silently turn Tron fees off).
 */
export function parseTronFeeRecipient(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (!isTronAddress(v)) throw new Error("FEE_RECIPIENT_TVM must be a base58 Tron address (T…)");
  return v;
}
