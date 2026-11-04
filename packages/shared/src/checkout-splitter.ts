/**
 * Checkout deposit addresses on EVM (D-065): a per-session address that splits LayerHop's fee from a
 * plain transfer, for QR "send to address" payments. Contract: contracts/evm/src/CheckoutSplitterFactory.sol.
 *
 * The factory derives each address with CREATE2 from salt = keccak256(abi.encode(merchant, feeBps,
 * sessionRef)) and the forwarder's init code hash; anyone may `sweep(merchant, feeBps, sessionRef,
 * token)`, which pays `floor(balance * feeBps / 10_000)` to LayerHop's fee recipient and the rest to
 * the merchant. Pure helpers shared by the API, the worker, scripts and the checkout UI.
 */
import { keccak_256 } from "@noble/hashes/sha3";

/** keccak256 of CheckoutDepositForwarder's init code (solc 0.8.38, paris, optimizer 200, no metadata). */
export const CHECKOUT_FORWARDER_INIT_CODE_HASH = "0xe099df8fdd34b186b69756d07a712a4d762e36fe191916742ab8bf9f0df8fe5f";

/** The contract's fee cap (`MAX_FEE_BPS`). */
export const CHECKOUT_SPLITTER_MAX_FEE_BPS = 100;

/**
 * Chains where the factory must never be configured: zkSync-family chains compute CREATE2 addresses
 * differently, so a predicted deposit address would be unreachable (funds lost).
 */
export const CHECKOUT_SPLITTER_UNSUPPORTED_CHAINS: readonly number[] = [324, 300, 2741, 11124, 232, 37111, 50104, 531050104];

/**
 * Chains where deposit addresses stay off by policy (refused at startup like the zkSync family):
 * Ethereum mainnet, where the first sweep (~0.45M gas, it deploys the forwarder) costs more than the
 * 25 bps fee on a typical checkout. Start with L2s.
 */
export const CHECKOUT_SPLITTER_OFF_CHAINS: readonly number[] = [1];

/** `feeRecipient()` and `forwarderInitCodeHash()` selectors (the API checks both on chain). */
export const CHECKOUT_FEE_RECIPIENT_SELECTOR = "0x46904840";
export const CHECKOUT_INIT_CODE_HASH_SELECTOR = "0x634010b6";

/** `sweep(address,uint256,bytes32,address)` and `predict(address,uint256,bytes32)` selectors. */
export const CHECKOUT_SWEEP_SELECTOR = "0x482e1ea8";
export const CHECKOUT_PREDICT_SELECTOR = "0x223026f9";
/** `Swept(address,address,address,uint256,uint256)` topic. */
export const CHECKOUT_SWEPT_TOPIC = "0xf84bad408c039b5a953d2107920b192a190136cd283a1f5bc35558e7d7ae53ea";
/**
 * The merchant's own escape hatch `sweepTo(merchant, feeBps, sessionRef, token, to)` (only the merchant
 * may call it, e.g. when it can't receive the token itself) and its
 * `SweptTo(address,address,address,address,uint256,uint256)` topic (topics 1–3 like `Swept`).
 */
export const CHECKOUT_SWEEP_TO_SELECTOR = "0x2529ac41";
export const CHECKOUT_SWEPT_TO_TOPIC = "0x527fbb2a507dcd7695f1648fba866117d28e409a9acc3ae756b4e78a3fb16900";

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

const hexToBytes = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const bytesToHex = (b: Uint8Array): string => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const word = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/** keccak256 hex of raw bytes. */
export const keccakHex = (b: Uint8Array): string => bytesToHex(keccak_256(b));

/** `sessionRef` for a checkout session: keccak256 of the session id (UTF-8). */
export function checkoutSessionRef(sessionId: string): string {
  return keccakHex(new TextEncoder().encode(sessionId));
}

function checkInputs(merchant: string, feeBps: number, sessionRef: string) {
  if (!EVM_ADDR.test(merchant) || /^0x0{40}$/.test(merchant)) throw new Error("merchant must be a non-zero EVM address");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > CHECKOUT_SPLITTER_MAX_FEE_BPS) throw new Error(`feeBps must be 0..${CHECKOUT_SPLITTER_MAX_FEE_BPS}`);
  if (!HEX32.test(sessionRef)) throw new Error("sessionRef must be 32 bytes hex");
}

/** CREATE2 salt: keccak256(abi.encode(merchant, feeBps, sessionRef)). */
export function checkoutSplitterSalt(merchant: string, feeBps: number, sessionRef: string): string {
  checkInputs(merchant, feeBps, sessionRef);
  return keccakHex(hexToBytes(word(merchant) + word(feeBps.toString(16)) + word(sessionRef)));
}

/** The deposit address `factory.predict(merchant, feeBps, sessionRef)` returns (lowercase). */
export function predictCheckoutDepositAddress(factory: string, merchant: string, feeBps: number, sessionRef: string, initCodeHash = CHECKOUT_FORWARDER_INIT_CODE_HASH): string {
  if (!EVM_ADDR.test(factory)) throw new Error("factory must be an EVM address");
  const salt = checkoutSplitterSalt(merchant, feeBps, sessionRef);
  const h = keccakHex(hexToBytes(`ff${factory.replace(/^0x/, "")}${salt.replace(/^0x/, "")}${initCodeHash.replace(/^0x/, "")}`));
  return `0x${h.slice(-40)}`.toLowerCase();
}

/** Fee the contract takes from a sweep of `amount` (rounded down, like the contract). */
export function checkoutSplitterFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / 10_000n;
}

/**
 * What the payer sends so the merchant nets at least `due` after the contract's fee: the smallest
 * `gross` with `gross - floor(gross * feeBps / 10_000) >= due`, i.e. ceil(due * 10_000 / (10_000 - feeBps)) or one unit less.
 * The fee is charged on top, as on direct checkout payments (D-025), but as feeBps of the gross.
 */
export function checkoutGrossAmount(due: bigint, feeBps: number): bigint {
  const d = 10_000n - BigInt(feeBps);
  let gross = (due * 10_000n + d - 1n) / d;
  // The fee rounds down, so one unit less can still net `due`: take the smallest.
  while (gross > due && gross - 1n - checkoutSplitterFee(gross - 1n, feeBps) >= due) gross -= 1n;
  return gross;
}

/** Calldata for `sweep(merchant, feeBps, sessionRef, token)` (token `0x000…0` = native coin). */
export function checkoutSweepCalldata(merchant: string, feeBps: number, sessionRef: string, token: string): string {
  checkInputs(merchant, feeBps, sessionRef);
  if (!EVM_ADDR.test(token)) throw new Error("token must be an EVM address");
  return `${CHECKOUT_SWEEP_SELECTOR}${word(merchant)}${word(feeBps.toString(16))}${word(sessionRef)}${word(token)}`;
}

/** Calldata for `predict(merchant, feeBps, sessionRef)`. */
export function checkoutPredictCalldata(merchant: string, feeBps: number, sessionRef: string): string {
  checkInputs(merchant, feeBps, sessionRef);
  return `${CHECKOUT_PREDICT_SELECTOR}${word(merchant)}${word(feeBps.toString(16))}${word(sessionRef)}`;
}

/**
 * `CHECKOUT_SPLITTER_ADDRESSES`: JSON `{ "<chainId>": "<factory address>" }`. Unset / empty = off.
 * Throws on malformed input, a zkSync-family chain or a chain off by policy (Ethereum mainnet) (config errors should fail at startup).
 */
export function parseCheckoutSplitterAddresses(raw: string | undefined): Record<number, string> {
  if (!raw || !raw.trim()) return {};
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("CHECKOUT_SPLITTER_ADDRESSES must be JSON: {\"<chainId>\": \"0x<factory>\"}");
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("CHECKOUT_SPLITTER_ADDRESSES must be a JSON object");
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`CHECKOUT_SPLITTER_ADDRESSES: bad chain id ${k}`);
    if (CHECKOUT_SPLITTER_UNSUPPORTED_CHAINS.includes(id)) throw new Error(`CHECKOUT_SPLITTER_ADDRESSES: chain ${id} is zkSync-family (CREATE2 differs); not supported`);
    if (CHECKOUT_SPLITTER_OFF_CHAINS.includes(id)) throw new Error(`CHECKOUT_SPLITTER_ADDRESSES: chain ${id} is off by policy (Ethereum mainnet: the sweep gas exceeds the fee); use an L2`);
    if (typeof v !== "string" || !EVM_ADDR.test(v)) throw new Error(`CHECKOUT_SPLITTER_ADDRESSES: chain ${k} needs a 0x address`);
    out[id] = v.toLowerCase();
  }
  return out;
}

/**
 * What a scan-to-pay session must receive at its payment address: the gross (amount due + fee) for a
 * splitter deposit address, else the amount due.
 */
export function transferDueAmount(amount: string, t: { kind: string; gross?: string }): bigint {
  return t.kind === "evm_splitter" && t.gross ? BigInt(t.gross) : BigInt(amount);
}
