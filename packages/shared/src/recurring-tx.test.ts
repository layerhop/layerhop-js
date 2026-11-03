import { describe, expect, it } from "vitest";
import { recurringTxProblem, type DecodedSolanaTx, type RecurringTxDeps } from "./recurring-tx.js";

// Shape of a real Jupiter Recurring createOrder tx (fixture in packages/providers), with fake ATA/base58.
const WALLET = "GAdn7TZhszf5KTfwNRx3A2nP6KCRFEWucZubgdEqbJA2";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUT = "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3";
const DCA = "Ax3WePKTeeuacez3ThhpJBJKc2LqUSLwB9dyzpW7NC7L";
const USER_ATA = "HeMtL8F8PPsEWXxUzwBirNE2mYBtYpvZ4oq6erhjGr3n";
const IN_VAULT = "8wJR3gRXKo8ZL6UKomBzKNdGmzZtEG1R2yhCHPZKksMJ";
const OUT_VAULT = "BD93cCWJPNzYYutmbfNYvehdQVvF9BmTyFpCsFa4Gfkm";
const WSOL_ATA = "WsoLAta1111111111111111111111111111111111111";
const STRANGER = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const ORDER = "G1wnaWMJ7VTRnryBHvxNwWmwUDD5yUNBmLvZkRK1mPcT";
const SYS = "11111111111111111111111111111111";
const CB = "ComputeBudget111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const DCA_PROGRAM = "DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M";
const EVENT_AUTH = "Cspp27eGUDMXxPEdhmEXFVRn6Lt1L7xJyALF3nmnWoBj";

const deps: RecurringTxDeps = {
  ata: (owner, mint) => (owner === WALLET && mint === USDC ? USER_ATA : owner === WALLET && mint === "So11111111111111111111111111111111111111112" ? WSOL_ATA : `ata:${owner}:${mint}`),
  base58: (b) => (b.every((x) => x === 1) ? WALLET : "other"),
};

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

const OPEN = { program: DCA_PROGRAM, data: hex("8e772b6da2340bb11311de6a0000000000c2eb0b0000000000e1f50500000000803a090000000000000000"), accounts: [DCA, WALLET, WALLET, USDC, OUT, USER_ATA, IN_VAULT, OUT_VAULT, SYS, TOKEN, ATA, EVENT_AUTH, DCA_PROGRAM] };
const CLOSE = { program: DCA_PROGRAM, data: hex("16072162a8b722f3"), accounts: [WALLET, ORDER, USDC, OUT, "x", "y", USER_ATA, "z", SYS, TOKEN, ATA, EVENT_AUTH, DCA_PROGRAM] };
const realCreate = (): DecodedSolanaTx => ({
  payer: WALLET,
  signers: [WALLET],
  ixs: [
    { program: CB, data: hex("0278940100"), accounts: [] },
    { program: CB, data: hex("03400d030000000000"), accounts: [] },
    { program: ATA, data: hex("01"), accounts: [WALLET, USER_ATA, WALLET, USDC, SYS, TOKEN] },
    OPEN,
  ],
});
const realCancel = (): DecodedSolanaTx => ({
  payer: WALLET,
  signers: [WALLET],
  ixs: [{ program: CB, data: hex("0204d00000"), accounts: [] }, { program: CB, data: hex("03400d030000000000"), accounts: [] }, CLOSE],
});
const create = { kind: "create" as const, wallet: WALLET, inputMint: USDC, outputMint: OUT, inAmount: "200000000", count: 2, intervalSeconds: 604_800 };
const cancel = { kind: "cancel" as const, wallet: WALLET, order: ORDER };
const withIx = (base: DecodedSolanaTx, ix: DecodedSolanaTx["ixs"][number], at = 2): DecodedSolanaTx => ({ ...base, ixs: [...base.ixs.slice(0, at), ix, ...base.ixs.slice(at)] });

describe("recurringTxProblem (create)", () => {
  it("accepts the real createOrder shape", () => {
    expect(recurringTxProblem(realCreate(), create, deps)).toBeNull();
  });

  it("rejects another fee payer or open_dca_v2 parameters", () => {
    expect(recurringTxProblem({ ...realCreate(), payer: STRANGER }, create, deps)).toMatch(/wallet/);
    expect(recurringTxProblem(realCreate(), { ...create, inAmount: "300000000" }, deps)).toMatch(/order/);
    expect(recurringTxProblem(realCreate(), { ...create, count: 4 }, deps)).toMatch(/order/);
  });

  it("rejects SPL Token Approve, SetAuthority and other token instructions", () => {
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: cat(hex("04"), u64(1n)), accounts: [USER_ATA, STRANGER, WALLET] }), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: hex("0602"), accounts: [USER_ATA, WALLET] }), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: cat(hex("07"), u64(1n)), accounts: [USDC, USER_ATA, WALLET] }), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: cat(hex("0d"), u64(1n), hex("06")), accounts: [USER_ATA, USDC, STRANGER, WALLET] }), create, deps)).toMatch(/unexpected/);
  });

  it("allows a token transfer only from the wallet's input ATA into the DCA vault", () => {
    const transfer = (src: string, dst: string) => ({ program: TOKEN, data: cat(hex("03"), u64(1n)), accounts: [src, dst, WALLET] });
    expect(recurringTxProblem(withIx(realCreate(), transfer(USER_ATA, IN_VAULT)), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), transfer(USER_ATA, STRANGER)), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), transfer(STRANGER, IN_VAULT)), create, deps)).toMatch(/unexpected/);
    const checked = (mint: string, dst: string) => ({ program: TOKEN, data: cat(hex("0c"), u64(1n), hex("06")), accounts: [USER_ATA, mint, dst, WALLET] });
    expect(recurringTxProblem(withIx(realCreate(), checked(USDC, IN_VAULT)), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), checked(OUT, IN_VAULT)), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), checked(USDC, OUT_VAULT)), create, deps)).toMatch(/unexpected/);
  });

  it("allows a SOL transfer only to the wallet's WSOL ATA or the DCA account", () => {
    const sol = (to: string, from = WALLET) => ({ program: SYS, data: cat(u32(2), u64(5000n)), accounts: [from, to] });
    expect(recurringTxProblem(withIx(realCreate(), sol(WSOL_ATA)), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), sol(DCA)), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), sol(STRANGER)), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: SYS, data: cat(u32(8), new Uint8Array(32)), accounts: [WALLET] }), create, deps)).toMatch(/unexpected/);
  });

  it("allows CreateAccount only from the wallet for an account that signs the tx", () => {
    const createAcc = (newAcc: string, from = WALLET) => ({ program: SYS, data: cat(u32(0), u64(2039280n), u64(165n), new Uint8Array(32).fill(6)), accounts: [from, newAcc] });
    const signed = (d: DecodedSolanaTx) => ({ ...d, signers: [WALLET, "NewKeypair11111111111111111111111111111111"] });
    expect(recurringTxProblem(signed(withIx(realCreate(), createAcc("NewKeypair11111111111111111111111111111111"))), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), createAcc(STRANGER)), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(signed(withIx(realCreate(), createAcc("NewKeypair11111111111111111111111111111111", STRANGER))), create, deps)).toMatch(/unexpected/);
  });

  it("checks InitializeAccount / SyncNative / CloseAccount", () => {
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: hex("11"), accounts: [WSOL_ATA] }), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: hex("09"), accounts: [WSOL_ATA, WALLET, WALLET] }), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: hex("09"), accounts: [WSOL_ATA, STRANGER, WALLET] }), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: cat(hex("12"), new Uint8Array(32).fill(1)), accounts: [WSOL_ATA, USDC] }), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: cat(hex("12"), new Uint8Array(32).fill(2)), accounts: [WSOL_ATA, USDC] }), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: hex("01"), accounts: [WSOL_ATA, USDC, STRANGER, SYS] }), create, deps)).toMatch(/unexpected/);
  });

  it("allows ATA creation only paid by the wallet, for the wallet or the DCA account", () => {
    expect(recurringTxProblem(withIx(realCreate(), { program: ATA, data: hex("01"), accounts: [STRANGER, USER_ATA, WALLET, USDC, SYS, TOKEN] }), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: ATA, data: hex("01"), accounts: [WALLET, "a", STRANGER, USDC, SYS, TOKEN] }), create, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCreate(), { program: ATA, data: new Uint8Array(), accounts: [WALLET, "a", DCA, USDC, SYS, TOKEN] }), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), { program: ATA, data: hex("02"), accounts: [WALLET, "a", WALLET, USDC, SYS, TOKEN] }), create, deps)).toMatch(/unexpected/);
  });

  it("caps the priority fee at 1,000,000 micro-lamports and refuses other compute-budget instructions", () => {
    expect(recurringTxProblem(withIx(realCreate(), { program: CB, data: cat(hex("03"), u64(1_000_000n)), accounts: [] }), create, deps)).toBeNull();
    expect(recurringTxProblem(withIx(realCreate(), { program: CB, data: cat(hex("03"), u64(1_000_001n)), accounts: [] }), create, deps)).toMatch(/priority fee/);
    expect(recurringTxProblem(withIx(realCreate(), { program: CB, data: cat(hex("01"), u32(262144)), accounts: [] }), create, deps)).toMatch(/unexpected/);
  });

  it("rejects unknown programs, extra DCA instructions and accounts it can't see (lookup tables)", () => {
    expect(recurringTxProblem(withIx(realCreate(), { program: STRANGER, data: hex("00"), accounts: [] }), create, deps)).toMatch(/program/);
    expect(recurringTxProblem(withIx(realCreate(), CLOSE), create, deps)).toMatch(/order/);
    expect(recurringTxProblem(withIx(realCreate(), { program: TOKEN, data: hex("11"), accounts: [undefined] }), create, deps)).toMatch(/lookup/);
  });
});

describe("recurringTxProblem (cancel)", () => {
  it("accepts the real cancelOrder shape (close_dca)", () => {
    expect(recurringTxProblem(realCancel(), cancel, deps)).toBeNull();
  });
  it("rejects another order or wallet, open_dca_v2 or any non-close DCA call", () => {
    expect(recurringTxProblem(realCancel(), { ...cancel, order: STRANGER }, deps)).toMatch(/order/);
    expect(recurringTxProblem(realCancel(), { ...cancel, wallet: STRANGER }, deps)).toMatch(/wallet/);
    expect(recurringTxProblem(realCreate(), cancel, deps)).toMatch(/order/);
    expect(recurringTxProblem({ ...realCancel(), ixs: [{ ...CLOSE, data: hex("b712469c946da122") }] }, cancel, deps)).toMatch(/order/);
  });
  it("rejects Approve, token transfers and SOL transfers to strangers", () => {
    expect(recurringTxProblem(withIx(realCancel(), { program: TOKEN, data: cat(hex("04"), u64(1n)), accounts: [USER_ATA, STRANGER, WALLET] }), cancel, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCancel(), { program: TOKEN, data: cat(hex("03"), u64(1n)), accounts: [USER_ATA, STRANGER, WALLET] }), cancel, deps)).toMatch(/unexpected/);
    expect(recurringTxProblem(withIx(realCancel(), { program: SYS, data: cat(u32(2), u64(1n)), accounts: [WALLET, STRANGER] }), cancel, deps)).toMatch(/unexpected/);
    // Unwrapping WSOL back to the wallet is fine.
    expect(recurringTxProblem(withIx(realCancel(), { program: TOKEN, data: hex("09"), accounts: [WSOL_ATA, WALLET, WALLET] }), cancel, deps)).toBeNull();
  });
});
