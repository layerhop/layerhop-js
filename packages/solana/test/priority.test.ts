// Pure transaction edits and mocked RPCs only: nothing is signed with a real key and nothing hits a network.
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  applySolanaSpeed, bytesToBase64, MAX_PRIORITY_FEE_LAMPORTS, priorityFeeLamports, readComputeBudget, sendSvmTx, speedCuPrice, SPEED_MIN_CU_PRICE, withComputeUnitPrice, type SolanaSigner,
} from "../src/index.js";

const USER = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const DEST = new PublicKey("So11111111111111111111111111111111111111112");
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";
const PROG = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const CB = ComputeBudgetProgram.programId;

// A lookup table holding two accounts the route instruction uses.
const ALT_KEYS = [Keypair.generate().publicKey, Keypair.generate().publicKey];
const ALT = new AddressLookupTableAccount({
  key: Keypair.generate().publicKey,
  state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: ALT_KEYS },
});

function routeIx(): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROG,
    keys: [
      { pubkey: USER, isSigner: true, isWritable: true },
      { pubkey: ALT_KEYS[0]!, isSigner: false, isWritable: true },
      { pubkey: ALT_KEYS[1]!, isSigner: false, isWritable: false },
      { pubkey: DEST, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([1, 2, 3, 4]),
  });
}

function v0(ixs: TransactionInstruction[], alts: AddressLookupTableAccount[] = [ALT]): VersionedTransaction {
  return new VersionedTransaction(new TransactionMessage({ payerKey: USER, recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message(alts));
}

const decompiled = (tx: VersionedTransaction, alts: AddressLookupTableAccount[] = [ALT]) =>
  TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: alts }).instructions;

const sameIx = (a: TransactionInstruction, b: TransactionInstruction) => {
  expect(a.programId.toBase58()).toBe(b.programId.toBase58());
  expect(Buffer.from(a.data).toString("hex")).toBe(Buffer.from(b.data).toString("hex"));
  expect(a.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(b.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]));
};

describe("readComputeBudget", () => {
  it("reads limit and price", () => {
    const tx = v0([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }), routeIx()]);
    expect(readComputeBudget(tx)).toEqual({ unitLimit: 300_000, unitPrice: 5_000n, priceIx: 1 });
  });
  it("uses the runtime default (200k per non-budget instruction) without a limit", () => {
    const tx = v0([routeIx(), SystemProgram.transfer({ fromPubkey: USER, toPubkey: DEST, lamports: 1 })]);
    expect(readComputeBudget(tx)).toEqual({ unitLimit: 400_000, unitPrice: 0n, priceIx: undefined });
  });
});

describe("speedCuPrice", () => {
  const fees = [0, 0, 10_000, 10_000, 10_000, 12_000, 50_000, 218_000, 300_000, 22_000_000];
  it("normal keeps the current price", () => expect(speedCuPrice("normal", fees, 200_000, 7n)).toBe(7n));
  it("fast takes the 75th percentile, instant the 95th", () => {
    expect(speedCuPrice("fast", fees, 200_000)).toBe(218_000n);
    // p95 = 22,000,000 is capped: 0.001 SOL over 200k CU = 5,000,000 µL/CU.
    expect(speedCuPrice("instant", fees, 200_000)).toBe((MAX_PRIORITY_FEE_LAMPORTS.instant * 1_000_000n) / 200_000n);
  });
  it("has a floor when blocks were cheap or the RPC said nothing", () => {
    expect(speedCuPrice("fast", [], 200_000)).toBe(SPEED_MIN_CU_PRICE.fast);
    expect(speedCuPrice("instant", [0, 0, 0], 200_000)).toBe(SPEED_MIN_CU_PRICE.instant);
  });
  it("never lowers the route's own price", () => expect(speedCuPrice("fast", [1], 200_000, 900_000n)).toBe(900_000n));
  it("keeps the whole priority fee under the cap", () => {
    const p = speedCuPrice("fast", [10 ** 9], 1_400_000);
    expect(priorityFeeLamports(p, 1_400_000)).toBeLessThanOrEqual(MAX_PRIORITY_FEE_LAMPORTS.fast);
  });
});

describe("withComputeUnitPrice", () => {
  it("rewrites an existing price in place (same size, nothing else changes)", () => {
    const before = v0([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }), routeIx()]);
    const after = withComputeUnitPrice(before, 250_000n);
    expect(after.serialize().length).toBe(before.serialize().length);
    expect(readComputeBudget(after)).toMatchObject({ unitLimit: 300_000, unitPrice: 250_000n, priceIx: 1 });
    const a = decompiled(before);
    const b = decompiled(after);
    sameIx(b[0]!, a[0]!);
    sameIx(b[2]!, a[2]!);
    expect(readComputeBudget(before).unitPrice).toBe(5_000n); // input untouched
  });

  it("appends a price at the end when the budget program is already there", () => {
    const before = v0([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), routeIx()]);
    const after = withComputeUnitPrice(before, 40_000n);
    const ixs = decompiled(after);
    expect(ixs).toHaveLength(3);
    sameIx(ixs[1]!, decompiled(before)[1]!);
    sameIx(ixs[2]!, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 40_000 }));
  });

  it("adds the budget program as a static key and shifts lookup-table indexes", () => {
    const before = v0([routeIx()]);
    expect(before.message.staticAccountKeys.some((k) => k.equals(CB))).toBe(false);
    const after = withComputeUnitPrice(before, 40_000n);
    expect(after.message.staticAccountKeys.at(-1)!.equals(CB)).toBe(true);
    expect(after.message.header.numReadonlyUnsignedAccounts).toBe(before.message.header.numReadonlyUnsignedAccounts + 1);
    const ixs = decompiled(after);
    sameIx(ixs[0]!, decompiled(before)[0]!); // the route still reads the same accounts, incl. the table's
    sameIx(ixs[1]!, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 40_000 }));
    // Writability of every account is unchanged.
    const w = (tx: VersionedTransaction) => tx.message.getAccountKeys({ addressLookupTableAccounts: [ALT] }).keySegments().flat().map((k, i) => `${k.toBase58()}:${tx.message.isAccountWritable(i)}`).filter((x) => !x.startsWith(CB.toBase58()));
    expect(w(after).sort()).toEqual(w(before).sort());
  });

  it("works on legacy messages", () => {
    const msg = new TransactionMessage({ payerKey: USER, recentBlockhash: BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: USER, toPubkey: DEST, lamports: 5 })] }).compileToLegacyMessage();
    const before = new VersionedTransaction(msg);
    const after = withComputeUnitPrice(before, 30_000n);
    expect(after.version).toBe("legacy");
    const ixs = TransactionMessage.decompile(after.message).instructions;
    sameIx(ixs[0]!, SystemProgram.transfer({ fromPubkey: USER, toPubkey: DEST, lamports: 5 }));
    sameIx(ixs[1]!, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30_000 }));
  });

  it("refuses a signed transaction and one that would outgrow a packet", () => {
    const signed = v0([routeIx()]);
    signed.signatures[0] = new Uint8Array(64).fill(1);
    expect(() => withComputeUnitPrice(signed, 1n)).toThrow("already signed");
    const big = v0([routeIx(), new TransactionInstruction({ programId: PROG, keys: [], data: Buffer.alloc(1000) })]);
    expect(() => withComputeUnitPrice(big, 1n)).toThrow("too large");
  });
});

const feeRpc = (fees: number[]) => ({ getRecentPrioritizationFees: vi.fn(async () => fees.map((prioritizationFee, slot) => ({ slot, prioritizationFee }))) });

describe("applySolanaSpeed", () => {
  it("asks for the fees of the accounts the transaction writes", async () => {
    const rpc = feeRpc([100_000]);
    const r = await applySolanaSpeed(rpc, v0([ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), routeIx()]), "fast");
    const arg = (rpc.getRecentPrioritizationFees.mock.calls[0] as unknown as [{ lockedWritableAccounts: PublicKey[] }])[0];
    expect(arg.lockedWritableAccounts.map((k) => k.toBase58())).toEqual(expect.arrayContaining([USER.toBase58(), DEST.toBase58()]));
    expect(r.applied).toEqual({ microLamports: 100_000n, previous: 0n, feeLamports: 20_000n });
  });
  it("leaves normal, signed and already-fast transactions alone", async () => {
    const rpc = feeRpc([100]);
    const tx = v0([routeIx()]);
    expect(await applySolanaSpeed(rpc, tx, "normal")).toEqual({ tx, skipped: "normal" });
    const fast = v0([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000_000 }), routeIx()]);
    expect((await applySolanaSpeed(rpc, fast, "fast")).tx).toBe(fast);
    const signed = v0([routeIx()]);
    signed.signatures[0] = new Uint8Array(64).fill(1);
    expect((await applySolanaSpeed(rpc, signed, "instant")).skipped).toBe("signed");
  });
  it("falls back to the floor when the RPC fails", async () => {
    const r = await applySolanaSpeed({ getRecentPrioritizationFees: async () => { throw new Error("429"); } }, v0([routeIx()]), "fast");
    expect(r.applied?.microLamports).toBe(SPEED_MIN_CU_PRICE.fast);
  });
});

describe("sendSvmTx with speed", () => {
  function setup() {
    let signedTx: VersionedTransaction | undefined;
    const signer: SolanaSigner = {
      signTransaction: vi.fn(async (tx: VersionedTransaction) => {
        tx.signatures[0] = new Uint8Array(64).fill(7);
        signedTx = tx;
        return tx;
      }),
    };
    const connection = {
      ...feeRpc([60_000]),
      sendRawTransaction: vi.fn(async () => "sig"),
      getSignatureStatuses: vi.fn(async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] })),
      getBlockHeight: vi.fn(async () => 1000),
    } as unknown as Connection;
    return { signer, connection, signed: () => signedTx };
  }
  const tx = (vtx: VersionedTransaction, over = {}) => ({ vm: "svm" as const, serializedTx: bytesToBase64(vtx.serialize()), ...over });

  it("raises the price of a plain user transaction before the wallet signs", async () => {
    const s = setup();
    const sent = await sendSvmTx(s.signer, tx(v0([routeIx()], [])), { connection: s.connection, speed: "fast", sleep: async () => undefined });
    expect(readComputeBudget(s.signed()!).unitPrice).toBe(60_000n);
    expect(sent.priority?.microLamports).toBe(60_000n);
  });
  it("normal sends the bytes as built", async () => {
    const s = setup();
    const vtx = v0([routeIx()], []);
    await sendSvmTx(s.signer, tx(vtx), { connection: s.connection, sleep: async () => undefined });
    expect(readComputeBudget(s.signed()!).unitPrice).toBe(0n);
    expect(s.connection.getRecentPrioritizationFees).not.toHaveBeenCalled();
  });
  it("never changes a co-signed or provider-landed transaction", async () => {
    const s = setup();
    const ix = routeIx();
    ix.keys.push({ pubkey: DEST, isSigner: true, isWritable: false });
    const co = v0([ix], []);
    co.signatures[1] = new Uint8Array(64).fill(9);
    await sendSvmTx(s.signer, tx(co), { connection: s.connection, speed: "instant", sleep: async () => undefined });
    expect(readComputeBudget(s.signed()!).unitPrice).toBe(0n);
    const s2 = setup();
    const client = { submit: vi.fn(async () => "apiSig") };
    await sendSvmTx(s2.signer, tx(v0([routeIx()], []), { submitViaApi: true }), { connection: s2.connection, speed: "instant", quoteId: "q", client });
    expect(readComputeBudget(s2.signed()!).unitPrice).toBe(0n);
    expect(s2.connection.getRecentPrioritizationFees).not.toHaveBeenCalled();
  });
});
