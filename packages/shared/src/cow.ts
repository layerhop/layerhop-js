/**
 * EVM limit orders through CoW Protocol (D-061, see docs/DECISIONS.md). Pure helpers shared by the
 * API (builds and re-checks the order) and the browser (checks it again before the wallet signs):
 * the appData we attach (our partner fee), the EIP-712 order and cancellation typed data, the order
 * digest / UID, and `cowOrderProblems`, which refuses anything that is not exactly what the user asked for.
 *
 * Re-implemented from the public GPv2 specification (docs.cow.fi, the GPv2Settlement contract's
 * `Order` type hash), no CoW SDK code. Verified against the on-chain `domainSeparator()` of every
 * chain in `COW_CHAINS` (see cow.test.ts).
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { EVM_NATIVE } from "./tokens.js";
import type { Eip712TypedData } from "./types.js";

/** GPv2Settlement: the EIP-712 verifying contract, same address on every CoW chain. */
export const COW_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
/** GPv2VaultRelayer: the only spender a CoW order needs an ERC-20 allowance for. */
export const COW_VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
/** CoW's buy-token placeholder for the chain's native coin (our registry uses the zero address). */
export const COW_NATIVE_BUY_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * Chains with a CoW order book (`https://api.cow.fi/<slug>/api/v1`), checked 2026-11-03: each answers
 * `/version`, and each has GPv2Settlement + GPv2VaultRelayer deployed at the addresses above.
 */
export const COW_CHAINS: Readonly<Record<number, string>> = {
  1: "mainnet",
  100: "xdai",
  42161: "arbitrum_one",
  8453: "base",
  43114: "avalanche",
  137: "polygon",
  56: "bnb",
  59144: "linea",
  9745: "plasma",
  57073: "ink",
};
export const isCowChain = (chainId: number) => Object.prototype.hasOwnProperty.call(COW_CHAINS, chainId);

/** CoW caps partner volume fees at 100 bps (1%) at protocol level. */
export const COW_MAX_FEE_BPS = 100;
export const COW_APP_CODE = "LayerHop";
/** appData schema version we write (cowprotocol/app-data `v1.6.0`, partnerFee `v1.0.0`). */
export const COW_APP_DATA_VERSION = "1.6.0";
/** Limit-order lifetime bounds: at least a minute, at most a year (the order book's limit). */
export const COW_MIN_VALIDITY_S = 60;
export const COW_MAX_VALIDITY_S = 365 * 86_400;
/** Lifetime when the caller sets no `expiresAt` (CoW orders always expire). */
export const COW_DEFAULT_VALIDITY_S = 90 * 86_400;

export const COW_DOMAIN_NAME = "Gnosis Protocol";
export const COW_DOMAIN_VERSION = "v2";

const ORDER_FIELDS = [
  { name: "sellToken", type: "address" },
  { name: "buyToken", type: "address" },
  { name: "receiver", type: "address" },
  { name: "sellAmount", type: "uint256" },
  { name: "buyAmount", type: "uint256" },
  { name: "validTo", type: "uint32" },
  { name: "appData", type: "bytes32" },
  { name: "feeAmount", type: "uint256" },
  { name: "kind", type: "string" },
  { name: "partiallyFillable", type: "bool" },
  { name: "sellTokenBalance", type: "string" },
  { name: "buyTokenBalance", type: "string" },
] as const;
const DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;
const CANCELLATION_FIELDS = [{ name: "orderUids", type: "bytes[]" }] as const;

/** A GPv2 order as LayerHop builds it: sell orders, fee 0 (fees come from surplus), plain ERC-20 balances. */
export interface CowOrder {
  sellToken: string;
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  /** keccak256 of the full appData JSON. */
  appData: string;
  feeAmount: "0";
  kind: "sell";
  partiallyFillable: false;
  sellTokenBalance: "erc20";
  buyTokenBalance: "erc20";
}

const keccak = (b: Uint8Array) => keccak_256(b);
const hex0x = (b: Uint8Array) => `0x${bytesToHex(b)}`;
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const isAddr = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : undefined);

/** The buy token as CoW names it: the native coin is `0xEeee…`. */
export const cowBuyToken = (token: string) => (token.toLowerCase() === EVM_NATIVE ? COW_NATIVE_BUY_TOKEN : token);

/**
 * The exact appData JSON LayerHop attaches (keys sorted, no whitespace) and its hash. With a fee, one
 * `partnerFee` entry: `volumeBps` of the order's volume to `recipient`, charged by the protocol on
 * every fill. Recipient lower-cased so the string is canonical.
 */
export function cowAppData(fee: { bps: number; recipient?: string }): { appData: string; appDataHash: string } {
  const metadata: Record<string, unknown> = { orderClass: { orderClass: "limit" } };
  if (fee.bps > 0) {
    if (!isAddr(fee.recipient)) throw new Error("cowAppData: a fee needs an EVM recipient");
    if (!Number.isInteger(fee.bps) || fee.bps > COW_MAX_FEE_BPS) throw new Error(`cowAppData: fee bps must be an integer ≤ ${COW_MAX_FEE_BPS}`);
    metadata.partnerFee = { recipient: fee.recipient.toLowerCase(), volumeBps: fee.bps };
  }
  const appData = JSON.stringify({ appCode: COW_APP_CODE, metadata, version: COW_APP_DATA_VERSION });
  return { appData, appDataHash: hex0x(keccak(utf8ToBytes(appData))) };
}

export const cowAppDataHash = (appData: string) => hex0x(keccak(utf8ToBytes(appData)));

const domain = (chainId: number) => ({ name: COW_DOMAIN_NAME, version: COW_DOMAIN_VERSION, chainId, verifyingContract: COW_SETTLEMENT });

/** Typed data the wallet signs (`eth_signTypedData_v4`) to place `order`. */
export function cowOrderTypedData(chainId: number, order: CowOrder): Eip712TypedData {
  return {
    types: { EIP712Domain: DOMAIN_FIELDS.map((f) => ({ ...f })), Order: ORDER_FIELDS.map((f) => ({ ...f })) },
    domain: domain(chainId),
    primaryType: "Order",
    message: { ...order },
  };
}

/** Typed data the wallet signs to cancel orders off-chain (`DELETE /api/v1/orders`). */
export function cowCancellationTypedData(chainId: number, orderUids: string[]): Eip712TypedData {
  return {
    types: { EIP712Domain: DOMAIN_FIELDS.map((f) => ({ ...f })), OrderCancellations: CANCELLATION_FIELDS.map((f) => ({ ...f })) },
    domain: domain(chainId),
    primaryType: "OrderCancellations",
    message: { orderUids: [...orderUids] },
  };
}

// --- EIP-712 hashing for the two fixed structs (no generic encoder needed) ---

const typeString = (name: string, fields: readonly { name: string; type: string }[]) => `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
const word = (n: bigint) => {
  if (n < 0n || n >= 2n ** 256n) throw new Error("value out of uint256 range");
  return hexToBytes(n.toString(16).padStart(64, "0"));
};
const addrWord = (a: string) => {
  if (!isAddr(a)) throw new Error(`not an address: ${a}`);
  return hexToBytes(strip(a).toLowerCase().padStart(64, "0"));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
const strHash = (s: string) => keccak(utf8ToBytes(s));

/** EIP-712 domain separator of GPv2Settlement on `chainId` (equals the contract's `domainSeparator()`). */
export function cowDomainSeparator(chainId: number): string {
  return hex0x(keccak(concat(
    keccak(utf8ToBytes(typeString("EIP712Domain", DOMAIN_FIELDS))),
    strHash(COW_DOMAIN_NAME), strHash(COW_DOMAIN_VERSION), word(BigInt(chainId)), addrWord(COW_SETTLEMENT),
  )));
}

function orderStructHash(o: CowOrder): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(o.appData)) throw new Error("appData must be a bytes32 hash");
  if (!Number.isInteger(o.validTo) || o.validTo < 0 || o.validTo > 0xffffffff) throw new Error("validTo must be a uint32");
  return keccak(concat(
    keccak(utf8ToBytes(typeString("Order", ORDER_FIELDS))),
    addrWord(o.sellToken), addrWord(o.buyToken), addrWord(o.receiver),
    word(BigInt(o.sellAmount)), word(BigInt(o.buyAmount)), word(BigInt(o.validTo)),
    hexToBytes(strip(o.appData)), word(BigInt(o.feeAmount)),
    strHash(o.kind), word(o.partiallyFillable ? 1n : 0n), strHash(o.sellTokenBalance), strHash(o.buyTokenBalance),
  ));
}

/** The EIP-712 digest the wallet signs for `order` on `chainId`. */
export function cowOrderDigest(chainId: number, order: CowOrder): string {
  return hex0x(keccak(concat(hexToBytes("1901"), hexToBytes(strip(cowDomainSeparator(chainId))), orderStructHash(order))));
}

/** CoW order UID: digest (32 bytes) ‖ owner (20) ‖ validTo (uint32, 4). Known before the order is signed. */
export function cowOrderUid(chainId: number, order: CowOrder, owner: string): string {
  if (!isAddr(owner)) throw new Error("owner must be an EVM address");
  return `${cowOrderDigest(chainId, order)}${strip(owner).toLowerCase()}${order.validTo.toString(16).padStart(8, "0")}`;
}

/** The EIP-712 digest of an off-chain cancellation of `orderUids`. */
export function cowCancellationDigest(chainId: number, orderUids: string[]): string {
  const arrayHash = keccak(concat(...orderUids.map((u) => keccak(hexToBytes(strip(u))))));
  const struct = keccak(concat(keccak(utf8ToBytes(typeString("OrderCancellations", CANCELLATION_FIELDS))), arrayHash));
  return hex0x(keccak(concat(hexToBytes("1901"), hexToBytes(strip(cowDomainSeparator(chainId))), struct)));
}

// --- Safety checks before signing (API and browser) ---

/** What the user asked for; the typed data must commit to exactly this. */
export interface CowOrderExpectation {
  chainId: number;
  /** The wallet that signs; it must also be the receiver. */
  owner: string;
  /** Registry addresses (the zero address = native coin, allowed as the buy token only). */
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  /** Our fee (+ partner fee) in bps, and where it goes. 0 = no partnerFee in the appData. */
  feeBps: number;
  feeRecipient?: string;
  /** The order's UID as the API reported it (`providerOrderId`); checked when given. */
  orderUid?: string;
  /** Unix seconds; defaults to now. */
  now?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sameFields = (got: unknown, want: readonly { name: string; type: string }[]) =>
  Array.isArray(got) && got.length === want.length && got.every((f, i) => isObj(f) && Object.keys(f).length === 2 && f.name === want[i]!.name && f.type === want[i]!.type);
const uintStr = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : undefined);

function domainProblems(t: Eip712TypedData, chainId: number, out: string[]): void {
  const d = t.domain;
  if (!isObj(d)) {
    out.push("domain is missing");
    return;
  }
  const keys = Object.keys(d).sort().join(",");
  if (keys !== "chainId,name,verifyingContract,version") out.push(`domain has unexpected fields (${keys})`);
  if (d.name !== COW_DOMAIN_NAME || d.version !== COW_DOMAIN_VERSION) out.push("domain is not GPv2 (Gnosis Protocol v2)");
  if (uintStr(d.chainId) !== String(chainId)) out.push("domain chainId is not the order's chain");
  if (lower(d.verifyingContract) !== COW_SETTLEMENT.toLowerCase()) out.push("verifyingContract is not GPv2Settlement");
  const dt = t.types.EIP712Domain;
  if (dt !== undefined && !sameFields(dt, DOMAIN_FIELDS)) out.push("EIP712Domain type is not the standard one");
}

/**
 * Everything wrong with the typed data + appData of a CoW limit order against what the user asked
 * for, as readable problems (empty = safe to sign): GPv2 domain on this chain; the canonical `Order`
 * type and no other types or message fields; sell / buy token and amounts exactly as requested;
 * receiver = the signing wallet; fee 0, sell kind, fill-or-kill, ERC-20 balances; validTo between a
 * minute and a year ahead; appData exactly LayerHop's (our fee recipient and bps, nothing else) and
 * the message's appData field its hash; and, when given, the UID the API reported.
 */
export function cowOrderProblems(t: Eip712TypedData | undefined, appData: string | undefined, e: CowOrderExpectation): string[] {
  const out: string[] = [];
  if (!t || !isObj(t.message) || !isObj(t.types)) return ["typed data is missing"];
  if (!isCowChain(e.chainId)) out.push(`chain ${e.chainId} has no CoW order book`);
  domainProblems(t, e.chainId, out);
  if (t.primaryType !== "Order") out.push(`primaryType ${t.primaryType} is not Order`);
  const typeNames = Object.keys(t.types).filter((k) => k !== "EIP712Domain");
  if (typeNames.length !== 1 || typeNames[0] !== "Order" || !sameFields(t.types.Order, ORDER_FIELDS)) out.push("types are not exactly the GPv2 Order type");
  const m = t.message;
  const keys = Object.keys(m).sort().join(",");
  const want = ORDER_FIELDS.map((f) => f.name).sort().join(",");
  if (keys !== want) out.push(`message fields differ from the GPv2 order (${keys})`);

  if (e.sellToken.toLowerCase() === EVM_NATIVE) out.push("the native coin cannot be sold through a CoW order (wrap it first)");
  if (lower(m.sellToken) !== e.sellToken.toLowerCase()) out.push("sellToken is not the token you sell");
  if (lower(m.buyToken) !== cowBuyToken(e.buyToken).toLowerCase()) out.push("buyToken is not the token you buy");
  if (!isAddr(m.receiver) || lower(m.receiver) !== e.owner.toLowerCase()) out.push("receiver is not your wallet");
  if (uintStr(m.sellAmount) !== e.sellAmount) out.push("sellAmount is not the amount you sell");
  if (uintStr(m.buyAmount) !== e.buyAmount) out.push("buyAmount is not the minimum you asked for");
  if (uintStr(m.feeAmount) !== "0") out.push("feeAmount must be 0");
  if (m.kind !== "sell") out.push("kind must be sell");
  if (m.partiallyFillable !== false) out.push("partiallyFillable must be false");
  if (m.sellTokenBalance !== "erc20" || m.buyTokenBalance !== "erc20") out.push("token balances must be plain erc20");

  const now = e.now ?? Math.floor(Date.now() / 1000);
  const validTo = typeof m.validTo === "number" ? m.validTo : Number(uintStr(m.validTo) ?? NaN);
  if (!Number.isInteger(validTo) || validTo < now + COW_MIN_VALIDITY_S || validTo > now + COW_MAX_VALIDITY_S + 3600) {
    out.push("validTo must be between a minute and a year from now");
  }

  if (e.feeBps > COW_MAX_FEE_BPS) out.push(`fee above CoW's ${COW_MAX_FEE_BPS} bps cap`);
  if (e.feeBps > 0 && !isAddr(e.feeRecipient)) out.push("no fee recipient configured");
  if (typeof appData !== "string") out.push("appData is missing");
  else {
    let expected: string | undefined;
    try {
      expected = cowAppData({ bps: e.feeBps, recipient: e.feeRecipient }).appData;
    } catch {
      expected = undefined;
    }
    if (appData !== expected) out.push("appData is not LayerHop's (fee recipient, fee or extra fields differ)");
    if (lower(m.appData) !== cowAppDataHash(appData)) out.push("appData hash in the order does not match the appData");
  }

  if (e.orderUid !== undefined && out.length === 0) {
    try {
      const uid = cowOrderUid(e.chainId, m as unknown as CowOrder, e.owner);
      if (uid !== e.orderUid.toLowerCase()) out.push("order UID does not match the typed data");
    } catch (err) {
      out.push(`order cannot be hashed: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Problems with an off-chain cancellation's typed data: GPv2 domain on this chain, exactly `[orderUid]`. */
export function cowCancellationProblems(t: Eip712TypedData | undefined, chainId: number, orderUid: string): string[] {
  const out: string[] = [];
  if (!t || !isObj(t.message) || !isObj(t.types)) return ["typed data is missing"];
  domainProblems(t, chainId, out);
  if (t.primaryType !== "OrderCancellations") out.push(`primaryType ${t.primaryType} is not OrderCancellations`);
  const typeNames = Object.keys(t.types).filter((k) => k !== "EIP712Domain");
  if (typeNames.length !== 1 || !sameFields(t.types.OrderCancellations, CANCELLATION_FIELDS)) out.push("types are not exactly OrderCancellations");
  const uids = t.message.orderUids;
  if (Object.keys(t.message).length !== 1 || !Array.isArray(uids) || uids.length !== 1 || lower(uids[0]) !== orderUid.toLowerCase()) {
    out.push("the cancellation does not cover exactly this order");
  }
  return out;
}

/** A CoW order's lifecycle state, mapped to ours. */
export type CowOrderState = "open" | "filled" | "cancelled" | "expired";
export function cowOrderState(status: string | undefined): CowOrderState {
  switch (status) {
    case "fulfilled":
      return "filled";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "open"; // open, presignaturePending
  }
}
