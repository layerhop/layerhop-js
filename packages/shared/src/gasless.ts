import { PERMIT2_ADDRESS } from "./calls.js";
import { LayerHopError, type ErrorCode } from "./errors.js";
import { EVM_NATIVE } from "./tokens.js";
import type { ChainId, GaslessSignable, GaslessSignRequest, QuoteRequest } from "./types.js";

/**
 * Chains where 0x Gasless API v2 runs (D-043; docs.0x.org supported-chains table, checked 2026-10-25:
 * every 0x Swap chain except Linea), less Mantle and Arc, which our chain registry leaves out for 0x
 * (their native-coin address differs). Gasless sells must be ERC-20s: native coins have no `transferFrom`.
 */
export const GASLESS_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, 10, 56, 130, 137, 143, 146, 480, 999, 2741, 4217, 4663, 8453, 9745, 42161, 43114, 57073, 80094, 534352,
]);

/** Whether a gasless quote can exist for this route: same EVM chain with 0x Gasless, ERC-20 input. */
export function gaslessApplies(r: Pick<QuoteRequest, "srcChainId" | "dstChainId" | "srcToken" | "dstToken">): boolean {
  if (r.srcChainId !== r.dstChainId || !GASLESS_CHAIN_IDS.has(r.srcChainId)) return false;
  if (r.srcToken.toLowerCase() === EVM_NATIVE) return false;
  return r.srcToken.toLowerCase() !== r.dstToken.toLowerCase();
}

/**
 * A 65-byte `eth_signTypedData_v4` signature (`0x{r}{s}{v}`) as `{ r, s, v }`. `v` 0/1 (some
 * wallets, EIP-2098 style) becomes 27/28. Throws INVALID_PARAMS on anything else.
 */
export function splitSignature(sig: string): { r: string; s: string; v: number } {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new LayerHopError("INVALID_PARAMS", "signature must be a 65-byte hex string (0x + 130 hex)");
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) throw new LayerHopError("INVALID_PARAMS", "signature has an invalid v value");
  return { r: `0x${sig.slice(2, 66)}`, s: `0x${sig.slice(66, 130)}`, v };
}

/** A gasless trade's Permit2 deadline may be at most this far out (0x quotes use about a minute). */
export const GASLESS_MAX_DEADLINE_S = 600;

const MAX_UINT256 = 2n ** 256n - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** 0x's native-coin placeholder; our registry uses the zero address (EVM_NATIVE). */
const ZEROX_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
/** `approve(address,uint256)` */
const APPROVE_SELECTOR = "0x095ea7b3";

/** What the typed data of a gasless quote must commit to; anything else is refused before signing. */
export interface GaslessExpectation {
  /** Source chain (= the swap chain). */
  chainId: ChainId;
  /** The token being sold. */
  srcToken: string;
  /** Base units of `srcToken` the user agreed to sell (the trade may pull at most this). */
  srcAmount: string;
  /** The wallet that signs: owner of the approval. */
  sender: string;
  /** Who receives the output; defaults to `sender`. */
  recipient?: string;
  /** Buy token; checked against the trade's witness when given. */
  dstToken?: string;
  /** The quote's minimum out; the witness may not promise less. */
  minAmountOut?: string;
  /** The settler the provider named for this quote (0x `target`); the Permit2 spender must equal it. */
  spender?: string;
  /** Unix seconds; defaults to now. */
  now?: number;
}

const addr = (v: unknown): string | undefined => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : undefined);
function uint(v: unknown): bigint | undefined {
  if (typeof v === "bigint") return v >= 0n ? v : undefined;
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : undefined;
  if (typeof v !== "string" || !/^(\d+|0x[0-9a-fA-F]+)$/.test(v)) return undefined;
  return BigInt(v);
}
const sameToken = (a: string | undefined, b: string | undefined) => {
  if (!a || !b) return false;
  const n = (t: string) => (t === ZEROX_NATIVE ? EVM_NATIVE : t);
  return n(a) === n(b);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** EIP-712 domain bound to this chain: `chainId`, or (Polygon-style meta-tx tokens) a `salt` holding the chain id. */
function domainChainOk(domain: Record<string, unknown>, chainId: number): boolean {
  if (domain.chainId !== undefined) return uint(domain.chainId) === BigInt(chainId);
  return typeof domain.salt === "string" && uint(domain.salt) === BigInt(chainId);
}

function tradeProblems(t: GaslessSignable, e: GaslessExpectation, out: string[]): void {
  const { domain, message, primaryType } = t.eip712;
  const now = e.now ?? Math.floor(Date.now() / 1000);
  if (primaryType !== "PermitWitnessTransferFrom") out.push(`trade: primaryType ${primaryType} is not PermitWitnessTransferFrom`);
  if (!domainChainOk(domain, e.chainId)) out.push("trade: domain chainId is not the source chain");
  if (addr(domain.verifyingContract) !== PERMIT2_ADDRESS.toLowerCase()) out.push("trade: verifyingContract is not the canonical Permit2");
  const permitted = isObj(message.permitted) ? message.permitted : undefined;
  if (addr(permitted?.token) !== addr(e.srcToken)) out.push("trade: permitted token is not the sell token");
  const amount = uint(permitted?.amount);
  if (amount === undefined || amount === 0n || amount > BigInt(e.srcAmount)) out.push("trade: permitted amount is missing or above the quoted sell amount");
  const spender = addr(message.spender);
  const forbidden = [ZERO_ADDRESS, PERMIT2_ADDRESS.toLowerCase(), addr(e.srcToken), addr(e.sender)];
  if (!spender || forbidden.includes(spender)) out.push("trade: spender is missing, zero, Permit2, the token or the wallet");
  else if (e.spender !== undefined && spender !== addr(e.spender)) out.push("trade: spender is not the quote's settler");
  const deadline = uint(message.deadline);
  if (deadline === undefined || deadline <= BigInt(now) || deadline > BigInt(now + GASLESS_MAX_DEADLINE_S)) {
    out.push(`trade: deadline must be in the next ${GASLESS_MAX_DEADLINE_S / 60} minutes`);
  }
  // The witness (0x: `slippageAndActions`) binds recipient, buy token and minimum out.
  const witnesses = Object.entries(message).filter(([k, v]) => k !== "permitted" && isObj(v) && "recipient" in v).map(([, v]) => v as Record<string, unknown>);
  if (witnesses.length !== 1) {
    out.push("trade: no single witness with a recipient");
    return;
  }
  const w = witnesses[0]!;
  if (addr(w.recipient) !== addr(e.recipient ?? e.sender)) out.push("trade: witness recipient is not the requested recipient");
  if (e.dstToken !== undefined && !sameToken(addr(w.buyToken), addr(e.dstToken))) out.push("trade: witness buy token is not the requested token");
  if (e.minAmountOut !== undefined) {
    const min = uint(w.minAmountOut);
    if (min === undefined || min < BigInt(e.minAmountOut)) out.push("trade: witness minimum out is below the quote's");
  }
}

/** Allowed approval amount: up to the sell amount, or unlimited (0x's gasless permits approve Permit2 for MaxUint256). */
const amountOk = (v: bigint | undefined, srcAmount: string) => v !== undefined && (v <= BigInt(srcAmount) || v === MAX_UINT256);

function approvalProblems(a: GaslessSignable, e: GaslessExpectation, out: string[]): void {
  const { domain, message } = a.eip712;
  if (!domainChainOk(domain, e.chainId)) out.push("approval: domain is not bound to the source chain");
  if (addr(domain.verifyingContract) !== addr(e.srcToken)) out.push("approval: verifyingContract is not the sell token");
  const permit2 = PERMIT2_ADDRESS.toLowerCase();
  const sender = addr(e.sender);
  switch (a.type) {
    case "permit":
    case "erc7597Permit":
      if (addr(message.owner) !== sender) out.push("approval: owner is not the wallet");
      if (addr(message.spender) !== permit2) out.push("approval: spender is not Permit2");
      if (!amountOk(uint(message.value), e.srcAmount)) out.push("approval: value is above the sell amount and not the standard unlimited Permit2 approval");
      return;
    case "daiPermit":
      // DAI-style permits are all-or-nothing (`allowed`), so only the holder and spender can be checked.
      if (addr(message.holder) !== sender) out.push("approval: holder is not the wallet");
      if (addr(message.spender) !== permit2) out.push("approval: spender is not Permit2");
      return;
    case "executeMetaTransaction::approve": {
      if (addr(message.from) !== sender) out.push("approval: from is not the wallet");
      const data = typeof message.functionSignature === "string" ? message.functionSignature.toLowerCase() : "";
      if (!/^0x[0-9a-f]{136}$/.test(data) || !data.startsWith(APPROVE_SELECTOR)) {
        out.push("approval: meta-transaction is not approve(address,uint256)");
        return;
      }
      const spenderWord = data.slice(10, 74);
      if (!spenderWord.startsWith("0".repeat(24)) || `0x${spenderWord.slice(24)}` !== permit2) out.push("approval: spender is not Permit2");
      if (!amountOk(BigInt(`0x${data.slice(74)}`), e.srcAmount)) out.push("approval: amount is above the sell amount and not the standard unlimited Permit2 approval");
      return;
    }
    default:
      out.push(`approval: unknown type ${a.type}`);
  }
}

/**
 * Everything wrong with a gasless sign request against what the user asked for (D-043), as
 * human-readable problems (empty = fine). Checked by the provider on every quote and by the browser
 * before `signTypedData`, so a tampered or buggy payload is never signed:
 * - trade: Permit2 `PermitWitnessTransferFrom` on the source chain at the canonical Permit2, for the
 *   sell token and at most the sell amount, spender = the quote's settler (never zero / Permit2 / token
 *   / wallet), witness recipient = requested recipient, buy token and minimum out as quoted, deadline
 *   in the next 10 minutes.
 * - approval (optional): on the sell token's contract and chain, owner = wallet, spender = Permit2,
 *   amount ≤ sell amount or MaxUint256 (the 0x Gasless approval grants Permit2 an unlimited allowance;
 *   Permit2 still needs a per-trade signature like the trade above to move anything).
 */
export function gaslessProblems(req: GaslessSignRequest, e: GaslessExpectation): string[] {
  const out: string[] = [];
  if (req.chainId !== e.chainId) out.push("chainId is not the source chain");
  if (!req.trade?.eip712?.message || !req.trade.eip712.domain) out.push("trade: missing typed data");
  else tradeProblems(req.trade, e, out);
  if (req.approval) {
    if (!req.approval.eip712?.message || !req.approval.eip712.domain) out.push("approval: missing typed data");
    else approvalProblems(req.approval, e, out);
  }
  return out;
}

/** Throws `code` (PROVIDER_ERROR by default) when `gaslessProblems` finds anything. */
export function checkGaslessSignRequest(req: GaslessSignRequest, e: GaslessExpectation, code: ErrorCode = "PROVIDER_ERROR"): void {
  const p = gaslessProblems(req, e);
  if (p.length) throw new LayerHopError(code, `Gasless typed data failed safety checks: ${p.join("; ")}`, { problems: p });
}
