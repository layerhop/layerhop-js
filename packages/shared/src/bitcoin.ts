/**
 * Bitcoin checkout helpers (D-067): the payer sends BTC to a Relay deposit address and the merchant
 * receives the settlement token. Pure helpers for the API, the worker and the hosted page.
 */

/** Relay's chain id for Bitcoin mainnet. */
export const BTC_RELAY_CHAIN_ID = 8253038;
/** Relay's currency id for native BTC (41 chars). */
export const BTC_RELAY_CURRENCY = "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8";
export const BTC_DECIMALS = 8;

/** Mainnet address: bech32 / bech32m (bc1…) or base58 P2PKH / P2SH (1… / 3…). Format check only. */
export const BTC_ADDRESS_RE = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;

/** Satoshis → a BTC decimal string without trailing zeros ("0.00033008"). */
export function satsToBtc(sats: bigint | string): string {
  const v = BigInt(sats);
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** BIP21 payment URI: `bitcoin:<address>?amount=<btc>&label=<label>`. */
export function bip21Uri(address: string, sats: bigint | string, label?: string): string {
  const q = [`amount=${satsToBtc(sats)}`];
  if (label) q.push(`label=${encodeURIComponent(label)}`);
  return `bitcoin:${address}?${q.join("&")}`;
}

/** Relay statuses that end a request (`success`, `refund`); `failure` may still be retried or refunded. */
export const RELAY_FINAL_STATUSES = ["success", "refund"] as const;
