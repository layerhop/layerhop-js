import { ComputeBudgetProgram, Message, MessageV0, PACKET_DATA_SIZE, PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { bytesToBase58 } from "./bytes.js";

/**
 * Transaction speed on Solana: the compute-unit price (priority fee) of a plain user transaction.
 *
 * - `normal`: the transaction is sent exactly as the route built it.
 * - `fast` / `instant`: the price is raised to the 75th / 95th percentile of what recent blocks charged
 *   for the accounts this transaction writes (`getRecentPrioritizationFees`), with a floor, and capped
 *   so the whole priority fee stays under `MAX_PRIORITY_FEE_LAMPORTS[speed]`. Never lowered.
 *
 * Only the ComputeBudget part of the message changes: an existing SetComputeUnitPrice gets its value
 * rewritten in place (same bytes, same length); without one, a SetComputeUnitPrice is appended at the
 * END (earlier instruction indexes stay the same for programs that inspect them). No other instruction,
 * account or fee transfer is touched. It is applied only before anyone signed: co-signed transactions
 * and transactions a provider lands itself (`submitViaApi`) are never changed.
 */
export type SolanaSpeed = "normal" | "fast" | "instant";

/** Floor of the compute-unit price per speed, in micro-lamports. */
export const SPEED_MIN_CU_PRICE: Record<Exclude<SolanaSpeed, "normal">, bigint> = { fast: 20_000n, instant: 200_000n };
/** Percentile of recent prioritization fees per speed. */
export const SPEED_PERCENTILE: Record<Exclude<SolanaSpeed, "normal">, number> = { fast: 0.75, instant: 0.95 };
/** Cap on the whole priority fee (price × compute-unit limit) per speed: 0.0002 / 0.001 SOL. */
export const MAX_PRIORITY_FEE_LAMPORTS: Record<Exclude<SolanaSpeed, "normal">, bigint> = { fast: 200_000n, instant: 1_000_000n };

/** Compute-unit limit the runtime applies without a SetComputeUnitLimit: 200k per non-budget instruction, max 1.4M. */
export const DEFAULT_CU_PER_IX = 200_000;
export const MAX_CU_LIMIT = 1_400_000;

const CB = ComputeBudgetProgram.programId;
const SET_LIMIT = 2;
const SET_PRICE = 3;

export interface ComputeBudgetInfo {
  /** SetComputeUnitLimit value, or the runtime default. */
  unitLimit: number;
  /** SetComputeUnitPrice value in micro-lamports, 0 when none. */
  unitPrice: bigint;
  /** Index of the SetComputeUnitPrice instruction, when there is one. */
  priceIx?: number;
}

const readU32 = (d: Uint8Array, at: number) => (d[at]! | (d[at + 1]! << 8) | (d[at + 2]! << 16)) + d[at + 3]! * 0x1000000;
function readU64(d: Uint8Array, at: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i]!);
  return v;
}
export function setPriceData(microLamports: bigint): Uint8Array {
  const out = new Uint8Array(9);
  out[0] = SET_PRICE;
  let v = microLamports;
  for (let i = 1; i < 9; i++, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
}

/** The transaction's compute budget: its unit limit (or the runtime default) and unit price. */
export function readComputeBudget(vtx: VersionedTransaction): ComputeBudgetInfo {
  const msg = vtx.message;
  const keys = msg.staticAccountKeys;
  let limit: number | undefined;
  let price = 0n;
  let priceIx: number | undefined;
  let others = 0;
  msg.compiledInstructions.forEach((ix, i) => {
    if (!keys[ix.programIdIndex]?.equals(CB)) {
      others++;
      return;
    }
    const d = ix.data;
    if (d[0] === SET_LIMIT && d.length === 5) limit = readU32(d, 1);
    else if (d[0] === SET_PRICE && d.length === 9) {
      price = readU64(d, 1);
      priceIx = i;
    }
  });
  return { unitLimit: limit ?? Math.min(MAX_CU_LIMIT, DEFAULT_CU_PER_IX * Math.max(1, others)), unitPrice: price, priceIx };
}

/** The `q` percentile (0..1) of `values`, 0 for none. */
export function percentile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))]!;
}

/** Priority fee in lamports of `price` micro-lamports per CU over `unitLimit` CUs (rounded up, like the runtime). */
export const priorityFeeLamports = (price: bigint, unitLimit: number): bigint => (price * BigInt(unitLimit) + 999_999n) / 1_000_000n;

/**
 * The compute-unit price for `speed`: the percentile of `recentFees` (micro-lamports), at least the
 * floor, at most what keeps `price × unitLimit` under the cap. Never below `current`. Pure.
 */
export function speedCuPrice(speed: SolanaSpeed, recentFees: readonly number[], unitLimit: number, current = 0n): bigint {
  if (speed === "normal") return current;
  let price = BigInt(Math.max(0, Math.floor(percentile(recentFees, SPEED_PERCENTILE[speed]))));
  if (price < SPEED_MIN_CU_PRICE[speed]) price = SPEED_MIN_CU_PRICE[speed];
  const cap = (MAX_PRIORITY_FEE_LAMPORTS[speed] * 1_000_000n) / BigInt(Math.max(1, unitLimit));
  if (price > cap) price = cap;
  return price > current ? price : current;
}

/** Accounts the transaction writes (static keys only; at most 128, the RPC's limit). */
export function writableAccounts(vtx: VersionedTransaction): string[] {
  const msg = vtx.message;
  const out: string[] = [];
  msg.staticAccountKeys.forEach((k, i) => {
    if (msg.isAccountWritable(i)) out.push(k.toBase58());
  });
  return out.slice(0, 128);
}

/** Recent prioritization fees (micro-lamports) for the accounts `vtx` writes; [] when the RPC can't say. */
export async function recentPrioritizationFees(connection: Pick<Connection, "getRecentPrioritizationFees">, vtx: VersionedTransaction): Promise<number[]> {
  try {
    const res = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: writableAccounts(vtx).map((a) => new PublicKey(a)) });
    return res.map((r) => r.prioritizationFee).filter((n) => Number.isFinite(n) && n >= 0);
  } catch {
    return [];
  }
}

export type SpeedSkipReason = "normal" | "signed" | "too-large" | "unreadable";

export interface SpeedResult {
  tx: VersionedTransaction;
  /** The new price when it changed. */
  applied?: { microLamports: bigint; previous: bigint; feeLamports: bigint };
  /** Why the transaction was left as it was (`applied` unset and not skipped = already at least as fast). */
  skipped?: SpeedSkipReason;
}

const isSigned = (sigs: readonly Uint8Array[]) => sigs.some((s) => s.some((b) => b !== 0));

/**
 * A copy of the unsigned transaction with its compute-unit price set to `microLamports` (raise only).
 * Throws when it is signed or the result doesn't fit in one packet; the input is never mutated.
 */
export function withComputeUnitPrice(vtx: VersionedTransaction, microLamports: bigint): VersionedTransaction {
  if (isSigned(vtx.signatures)) throw new Error("already signed");
  const msg = vtx.message;
  const info = readComputeBudget(vtx);
  const data = setPriceData(microLamports);
  const header = { ...msg.header };
  const keys = [...msg.staticAccountKeys];
  let ixs = msg.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: [...ix.accountKeyIndexes], data: ix.data }));
  if (info.priceIx !== undefined) {
    ixs[info.priceIx] = { ...ixs[info.priceIx]!, data };
  } else {
    let cb = keys.findIndex((k) => k.equals(CB));
    if (cb < 0) {
      // Appended as the last static key (read-only, unsigned: that group comes last). Keys loaded from
      // lookup tables (v0) are numbered after the static ones, so their indexes move up by one.
      const n = keys.length;
      keys.push(CB);
      header.numReadonlyUnsignedAccounts++;
      ixs = ixs.map((ix) => ({
        programIdIndex: ix.programIdIndex >= n ? ix.programIdIndex + 1 : ix.programIdIndex,
        accountKeyIndexes: ix.accountKeyIndexes.map((a) => (a >= n ? a + 1 : a)),
        data: ix.data,
      }));
      cb = n;
    }
    // At the end: earlier instruction indexes stay the same.
    ixs.push({ programIdIndex: cb, accountKeyIndexes: [], data });
  }
  const next =
    msg.version === "legacy"
      ? new Message({
          header,
          accountKeys: keys,
          recentBlockhash: msg.recentBlockhash,
          instructions: ixs.map((ix) => ({ programIdIndex: ix.programIdIndex, accounts: ix.accountKeyIndexes, data: bytesToBase58(ix.data) })),
        })
      : new MessageV0({ header, staticAccountKeys: keys, recentBlockhash: msg.recentBlockhash, compiledInstructions: ixs, addressTableLookups: (msg as MessageV0).addressTableLookups });
  const out = new VersionedTransaction(next);
  let size: number;
  try {
    size = out.serialize().length;
  } catch {
    size = Infinity;
  }
  if (size > PACKET_DATA_SIZE) throw new Error("too large");
  return out;
}

/**
 * `vtx` at `speed`, reading recent fees from `connection` (read-only). Returns the original transaction,
 * with a reason, whenever it can't or shouldn't change.
 */
export async function applySolanaSpeed(
  connection: Pick<Connection, "getRecentPrioritizationFees">,
  vtx: VersionedTransaction,
  speed: SolanaSpeed,
): Promise<SpeedResult> {
  if (speed === "normal") return { tx: vtx, skipped: "normal" };
  if (isSigned(vtx.signatures)) return { tx: vtx, skipped: "signed" };
  let info: ComputeBudgetInfo;
  try {
    info = readComputeBudget(vtx);
  } catch {
    return { tx: vtx, skipped: "unreadable" };
  }
  const price = speedCuPrice(speed, await recentPrioritizationFees(connection, vtx), info.unitLimit, info.unitPrice);
  if (price <= info.unitPrice) return { tx: vtx };
  try {
    const tx = withComputeUnitPrice(vtx, price);
    return { tx, applied: { microLamports: price, previous: info.unitPrice, feeLamports: priorityFeeLamports(price, info.unitLimit) } };
  } catch (e) {
    return { tx: vtx, skipped: e instanceof Error && e.message === "too large" ? "too-large" : "unreadable" };
  }
}
