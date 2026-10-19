import { LayerHopError } from "./errors.js";
import type { EvmCall } from "./types.js";

/**
 * Destination calls (D-029): validation shared by the API and SDK docs. A call runs on the
 * destination chain with the route's output, made by the provider's executor contract (msg.sender
 * is the executor, never the user). See docs/PLATFORM_SPEC.md "Destination calls".
 */

export const MAX_DESTINATION_CALLS = 8;
/** Calldata of one call, in bytes. */
export const MAX_CALL_DATA_BYTES = 10_000;
/** Calldata of all calls together, in bytes. */
export const MAX_TOTAL_CALL_DATA_BYTES = 24_000;

/** Uniswap Permit2 (same address on every EVM chain): pulls funds from whoever approved it. */
export const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";

/**
 * Selectors that move or authorize someone else's assets. The executor is a shared contract that
 * users of other apps may have approved, so a call that pulls from a third party could drain them.
 */
export const BLOCKED_CALL_SELECTORS: Readonly<Record<string, string>> = {
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x42842e0e": "safeTransferFrom(address,address,uint256)",
  "0xb88d4fde": "safeTransferFrom(address,address,uint256,bytes)",
  "0xf242432a": "safeTransferFrom(address,address,uint256,uint256,bytes)",
  "0x2eb2c2d6": "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
  "0xd505accf": "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  "0x8fcbaf0c": "permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)",
};

const MAX_UINT256 = (1n << 256n) - 1n;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CALLDATA_RE = /^0x(?:[0-9a-fA-F]{2})*$/;

const bad = (i: number, msg: string): never => {
  throw new LayerHopError("INVALID_PARAMS", `calls[${i}]: ${msg}`);
};

export interface DestinationCallsContext {
  /** The route's output is the destination chain's native coin (calls may then carry `value`). */
  nativeOutput: boolean;
  /** Exact output the executor receives, base units of dstToken. */
  dstAmount: bigint;
}

/**
 * Check user-supplied calls and return them normalized (lowercase hex, `value` as a decimal string).
 * Throws INVALID_PARAMS with the offending index.
 */
export function validateDestinationCalls(input: unknown, ctx: DestinationCallsContext): EvmCall[] {
  if (!Array.isArray(input) || input.length === 0) throw new LayerHopError("INVALID_PARAMS", "calls must be a non-empty array");
  if (input.length > MAX_DESTINATION_CALLS) throw new LayerHopError("INVALID_PARAMS", `At most ${MAX_DESTINATION_CALLS} calls`);
  let totalBytes = 0;
  let totalValue = 0n;
  const out = input.map((raw, i): EvmCall => {
    if (!raw || typeof raw !== "object") return bad(i, "must be an object { to, data, value? }");
    const { to, data, value } = raw as Record<string, unknown>;
    if (typeof to !== "string" || !ADDRESS_RE.test(to)) return bad(i, "to must be a 0x-prefixed 20-byte address");
    const target = to.toLowerCase();
    // Zero address, precompiles and system contracts live below 2^16.
    if (BigInt(target) < 0x10000n) return bad(i, "to must not be the zero address or a precompile");
    if (target === PERMIT2_ADDRESS) return bad(i, "calls to Permit2 are not allowed");
    if (typeof data !== "string" || !CALLDATA_RE.test(data)) return bad(i, "data must be 0x-prefixed hex with whole bytes");
    const bytes = (data.length - 2) / 2;
    if (bytes > MAX_CALL_DATA_BYTES) return bad(i, `data is larger than ${MAX_CALL_DATA_BYTES} bytes`);
    if (bytes > 0 && bytes < 4) return bad(i, "data must be empty or start with a 4-byte selector");
    totalBytes += bytes;
    const selector = data.slice(0, 10).toLowerCase();
    const blocked = BLOCKED_CALL_SELECTORS[selector];
    if (blocked) return bad(i, `${blocked} is not allowed: calls must not move or authorize anyone else's assets`);
    let v = 0n;
    if (value !== undefined && value !== null) {
      if (typeof value !== "string" || !/^\d+$/.test(value)) return bad(i, "value must be an integer string in wei");
      v = BigInt(value);
      if (v > MAX_UINT256) return bad(i, "value is out of range");
    }
    if (v > 0n && !ctx.nativeOutput) return bad(i, "value must be 0: the output is an ERC-20 token, the executor holds no native coin");
    if (bytes === 0 && v === 0n) return bad(i, "a call needs data or value");
    totalValue += v;
    return { to: target, data: data.toLowerCase(), value: v.toString() };
  });
  if (totalBytes > MAX_TOTAL_CALL_DATA_BYTES) throw new LayerHopError("INVALID_PARAMS", `calls carry more than ${MAX_TOTAL_CALL_DATA_BYTES} bytes of data`);
  if (totalValue > ctx.dstAmount) throw new LayerHopError("INVALID_PARAMS", "The calls' total value exceeds dstAmount");
  return out;
}
