/**
 * x402 (HTTP 402 pay-per-request, Coinbase's open protocol; D-066, guide guides/x402.md).
 *
 * Scheme `exact` on EVM with EIP-3009 `transferWithAuthorization` (USDC). Pure helpers shared by the
 * API facilitator (`/v1/x402/*`), the worker and the merchant middleware in `@layerhop/sdk`:
 * networks, header codecs, and the v1 / v2 message shapes.
 *
 * Protocol versions: v1 (`X-PAYMENT` / `X-PAYMENT-RESPONSE` headers, network names like `base`,
 * `maxAmountRequired`) and v2 (`PAYMENT-SIGNATURE` / `PAYMENT-REQUIRED` / `PAYMENT-RESPONSE`, CAIP-2
 * networks like `eip155:8453`, `amount`). Both are accepted; responses carry both header sets.
 */

export interface X402Network {
  chainId: number;
  /** v1 network name. */
  name: string;
  /** v2 CAIP-2 id. */
  caip2: string;
  /** USDC (EIP-3009) on this chain. */
  asset: string;
  decimals: number;
  /** EIP-712 domain of the asset (read on chain 2026-11-04: `name()` / `version()`). */
  eip712: { name: string; version: string };
}

/**
 * Chains with native USDC that implements EIP-3009 and a CheckoutSplitterFactory (D-065). BNB Chain's
 * USDC (Binance-Peg) has no `transferWithAuthorization`, so it is not an x402 network.
 */
export const X402_NETWORKS: readonly X402Network[] = [
  { chainId: 8453, name: "base", caip2: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, eip712: { name: "USD Coin", version: "2" } },
  { chainId: 10, name: "optimism", caip2: "eip155:10", asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, eip712: { name: "USD Coin", version: "2" } },
  { chainId: 42161, name: "arbitrum", caip2: "eip155:42161", asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, eip712: { name: "USD Coin", version: "2" } },
  { chainId: 137, name: "polygon", caip2: "eip155:137", asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, eip712: { name: "USD Coin", version: "2" } },
];

/** A network by v1 name (`base`), CAIP-2 id (`eip155:8453`) or chain id. */
export function x402Network(v: string | number | undefined): X402Network | undefined {
  if (v === undefined) return undefined;
  const s = String(v).trim().toLowerCase();
  return X402_NETWORKS.find((n) => n.name === s || n.caip2 === s || String(n.chainId) === s);
}

/** Gas price caps (gwei) for settling on each network, like the deposit sweeps' defaults (D-065). */
export const X402_MAX_GWEI_DEFAULTS: Readonly<Record<number, number>> = { 8453: 1, 10: 1, 42161: 1, 137: 500 };

/** EIP-712 types of EIP-3009 `TransferWithAuthorization`. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Spec error reasons (x402 v2 §9) plus `invalid_exact_evm_payload_authorization_nonce_used`. */
export const X402_REASONS = [
  "insufficient_funds",
  "invalid_exact_evm_payload_authorization_valid_after",
  "invalid_exact_evm_payload_authorization_valid_before",
  "invalid_exact_evm_payload_authorization_value_mismatch",
  "invalid_exact_evm_payload_authorization_nonce_used",
  "invalid_exact_evm_payload_signature",
  "invalid_exact_evm_payload_recipient_mismatch",
  "invalid_network",
  "invalid_payload",
  "invalid_payment_requirements",
  "invalid_scheme",
  "unsupported_scheme",
  "invalid_x402_version",
  "invalid_transaction_state",
  "unexpected_verify_error",
  "unexpected_settle_error",
  "settlement_pending",
] as const;
export type X402Reason = (typeof X402_REASONS)[number];

/** Header names, both protocol versions. */
export const X402_HEADERS = {
  paymentV1: "x-payment",
  responseV1: "x-payment-response",
  paymentV2: "payment-signature",
  requiredV2: "payment-required",
  responseV2: "payment-response",
} as const;

export interface X402Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface X402ExactPayload {
  signature: string;
  authorization: X402Authorization;
}

/** v2 `PaymentRequirements`. */
export interface X402RequirementsV2 {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/** v1 `PaymentRequirements`. */
export interface X402RequirementsV1 {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: Record<string, unknown>;
}

export interface X402ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

/** What LayerHop's facilitator works with, from either version. */
export interface X402Requirements {
  scheme: string;
  network: X402Network | undefined;
  /** The raw network string, for error messages and echoing. */
  networkRaw: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
}

export interface X402Payment {
  x402Version: number;
  scheme: string;
  networkRaw: string;
  payload: X402ExactPayload;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Requirements of either version → the common form (undefined when not an object). */
export function normalizeRequirements(raw: unknown): X402Requirements | undefined {
  const r = obj(raw);
  if (!r) return undefined;
  const networkRaw = str(r.network);
  return {
    scheme: str(r.scheme),
    network: x402Network(networkRaw),
    networkRaw,
    amount: str(r.amount ?? r.maxAmountRequired),
    asset: str(r.asset),
    payTo: str(r.payTo),
    maxTimeoutSeconds: typeof r.maxTimeoutSeconds === "number" ? r.maxTimeoutSeconds : Number(r.maxTimeoutSeconds ?? 0),
  };
}

/** A `PaymentPayload` of either version (v2 carries scheme / network in `accepted`). */
export function normalizePayment(raw: unknown): X402Payment | undefined {
  const p = obj(raw);
  if (!p) return undefined;
  const accepted = obj(p.accepted);
  const payload = obj(p.payload);
  const auth = obj(payload?.authorization);
  if (!payload || !auth) return undefined;
  return {
    x402Version: Number(p.x402Version),
    scheme: str(p.scheme ?? accepted?.scheme),
    networkRaw: str(p.network ?? accepted?.network),
    payload: {
      signature: str(payload.signature),
      authorization: {
        from: str(auth.from), to: str(auth.to), value: str(auth.value),
        validAfter: str(auth.validAfter), validBefore: str(auth.validBefore), nonce: str(auth.nonce),
      },
    },
  };
}

/** Base64 of UTF-8 JSON (browser and Node). */
export function encodeX402Header(v: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(v));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Parse a base64 JSON header; undefined when malformed. */
export function decodeX402Header<T = unknown>(h: string | null | undefined): T | undefined {
  if (!h) return undefined;
  try {
    const bin = atob(h.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return undefined;
  }
}

/**
 * The resource key a deposit address is derived from: an http(s) URL without query or fragment
 * (lowercase origin), else the trimmed string. One address per (account, merchant, resource).
 */
export function normalizeX402Resource(resource: string): string {
  const s = resource.trim();
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
  } catch {
    /* not a URL */
  }
  return s;
}

/** `refKey` of an x402 payee; its `sessionRef` is `checkoutSessionRef(refKey)` (keccak256 of the UTF-8). */
export function x402RefKey(accountId: string, resourceKey: string): string {
  return `x402:${accountId}:${resourceKey}`;
}

/** `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)` */
export const TRANSFER_WITH_AUTHORIZATION_SELECTOR = "0xe3ee160e";
/** `authorizationState(address,bytes32)` */
export const AUTHORIZATION_STATE_SELECTOR = "0xe94a0102";
