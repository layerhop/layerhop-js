/**
 * Pre-sign checks for Jupiter Recurring create / cancel transactions (D-027 addendum), shared by the
 * provider (before the tx leaves the API) and the browser (before the wallet signs). Pure: callers
 * decode the tx with @solana/web3.js and pass ATA derivation and base58 encoding in, so this module
 * needs no Solana dependency.
 *
 * Whitelist, everything else is refused:
 * - ComputeBudget: SetComputeUnitLimit, SetComputeUnitPrice up to 1,000,000 micro-lamports.
 * - System: CreateAccount funded by the wallet for a new account that signs the tx; Transfer from the
 *   wallet to its own WSOL ATA or to the DCA account.
 * - SPL Token / Token-2022: InitializeAccount / 2 / 3 owned by the wallet, SyncNative, CloseAccount
 *   paying out to the wallet, Transfer / TransferChecked from the wallet's input-mint ATA into the DCA
 *   input vault (create only). Never Approve, SetAuthority, Burn, MintTo or anything else.
 * - Associated Token Account: Create / CreateIdempotent paid by the wallet, for the wallet or the DCA account.
 * - Jupiter DCA: exactly one `open_dca_v2` with the requested parameters (create), or exactly one
 *   `close_dca` for this wallet and order (cancel).
 * Accounts loaded from address lookup tables can't be checked, so such transactions are refused.
 */

export const JUPITER_DCA_PROGRAM_ID = "DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const WSOL = "So11111111111111111111111111111111111111112";
/** Anchor discriminators: sha256("global:<name>")[0..8]. */
const OPEN_DCA_V2 = "8e772b6da2340bb1";
const CLOSE_DCA = "16072162a8b722f3";
/** Priority fee cap for these transactions (micro-lamports per compute unit). */
export const RECURRING_MAX_CU_PRICE = 1_000_000n;

/** `open_dca_v2` accounts: [dca, user, payer, inputMint, outputMint, userAta, inVault, outVault, …]. */
const OPEN = { dca: 0, user: 1, inputMint: 3, outputMint: 4, inVault: 6 } as const;
/** `close_dca` accounts: [user, dca, …]. */
const CLOSE = { user: 0, dca: 1 } as const;

export interface DecodedSolanaIx {
  program: string;
  data: Uint8Array;
  /** `undefined` = an account from an address lookup table (not resolvable offline). */
  accounts: (string | undefined)[];
}

export interface DecodedSolanaTx {
  /** Fee payer (first static key). */
  payer: string;
  /** Accounts that must sign the tx (the first `numRequiredSignatures` static keys). */
  signers: string[];
  ixs: DecodedSolanaIx[];
}

export type RecurringTxWant =
  | { kind: "create"; wallet: string; inputMint: string; outputMint: string; inAmount: string; count: number; intervalSeconds: number }
  | { kind: "cancel"; wallet: string; order: string };

export interface RecurringTxDeps {
  /** Associated token account of `owner` for `mint` under `tokenProgram`. */
  ata(owner: string, mint: string, tokenProgram: string): string;
  /** 32 raw bytes → base58 public key. */
  base58(bytes: Uint8Array): string;
}

const hex8 = (d: Uint8Array) => Array.from(d.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const u64 = (d: Uint8Array, off: number) => view(d).getBigUint64(off, true);

const BAD_CREATE = "The transaction doesn't open the recurring order you asked for.";
const BAD_CANCEL = "The transaction doesn't cancel this recurring order.";
const unexpected = (what: string) => `The order transaction has an unexpected instruction (${what}).`;

function openMatches(ix: DecodedSolanaIx, w: Extract<RecurringTxWant, { kind: "create" }>): boolean {
  if (ix.data.length < 40) return false;
  const total = BigInt(w.inAmount);
  return ix.accounts[OPEN.user] === w.wallet && ix.accounts[OPEN.inputMint] === w.inputMint && ix.accounts[OPEN.outputMint] === w.outputMint
    && u64(ix.data, 16) === total && u64(ix.data, 24) === total / BigInt(w.count) && u64(ix.data, 32) === BigInt(w.intervalSeconds);
}

/**
 * What's wrong with a recurring create/cancel transaction for `want`, as a message for the user, or
 * null when it only does what was asked (see the module comment for the whitelist).
 */
export function recurringTxProblem(d: DecodedSolanaTx | null, want: RecurringTxWant, deps: RecurringTxDeps): string | null {
  if (!d) return "Couldn't read the order transaction.";
  const wallet = want.wallet;
  if (d.payer !== wallet) return "The order transaction isn't paid by your wallet.";
  if (d.ixs.some((ix) => ix.accounts.some((a) => a === undefined))) return "The order transaction uses lookup-table accounts that can't be checked.";
  const known = new Set([COMPUTE_BUDGET, SYSTEM, TOKEN, TOKEN_2022, ATA_PROGRAM, JUPITER_DCA_PROGRAM_ID]);
  if (d.ixs.some((ix) => !known.has(ix.program))) return "The order transaction calls an unexpected program.";

  // The Jupiter DCA call itself.
  const dcaIxs = d.ixs.filter((ix) => ix.program === JUPITER_DCA_PROGRAM_ID);
  let dcaAccount: string;
  let inVault: string | undefined;
  if (want.kind === "create") {
    const ix = dcaIxs[0];
    if (dcaIxs.length !== 1 || !ix || hex8(ix.data) !== OPEN_DCA_V2 || !openMatches(ix, want)) return BAD_CREATE;
    dcaAccount = ix.accounts[OPEN.dca]!;
    inVault = ix.accounts[OPEN.inVault];
  } else {
    const ix = dcaIxs[0];
    if (dcaIxs.length !== 1 || !ix || hex8(ix.data) !== CLOSE_DCA || ix.accounts[CLOSE.user] !== wallet || ix.accounts[CLOSE.dca] !== want.order) return BAD_CANCEL;
    dcaAccount = want.order;
  }

  for (const ix of d.ixs) {
    const a = ix.accounts as string[];
    const data = ix.data;
    switch (ix.program) {
      case JUPITER_DCA_PROGRAM_ID:
        continue;
      case COMPUTE_BUDGET: {
        if (data[0] === 2 && data.length === 5) continue;
        if (data[0] === 3 && data.length === 9) {
          if (u64(data, 1) > RECURRING_MAX_CU_PRICE) return "The order transaction's priority fee is above the cap.";
          continue;
        }
        return unexpected("compute budget");
      }
      case SYSTEM: {
        const kind = data.length >= 4 ? view(data).getUint32(0, true) : -1;
        if (kind === 0 && data.length === 52 && a[0] === wallet && a[1] !== wallet && d.signers.includes(a[1]!)) continue;
        if (kind === 2 && data.length === 12 && a[0] === wallet && (a[1] === deps.ata(wallet, WSOL, TOKEN) || a[1] === dcaAccount)) continue;
        return unexpected("system");
      }
      case TOKEN:
      case TOKEN_2022: {
        switch (data[0]) {
          case 1: // InitializeAccount [account, mint, owner, rent]
            if (a[2] === wallet) continue;
            break;
          case 16: // InitializeAccount2 / 3: owner in data
          case 18:
            if (data.length >= 33 && deps.base58(data.subarray(1, 33)) === wallet) continue;
            break;
          case 17: // SyncNative
            continue;
          case 9: // CloseAccount [account, destination, owner]
            if (a[1] === wallet) continue;
            break;
          case 3: // Transfer [source, destination, authority]
            if (want.kind === "create" && inVault && a[0] === deps.ata(wallet, want.inputMint, ix.program) && a[1] === inVault && a[2] === wallet) continue;
            break;
          case 12: // TransferChecked [source, mint, destination, authority]
            if (want.kind === "create" && inVault && a[1] === want.inputMint && a[0] === deps.ata(wallet, want.inputMint, ix.program) && a[2] === inVault && a[3] === wallet) continue;
            break;
        }
        return unexpected(`token ${data[0] ?? "?"}`);
      }
      case ATA_PROGRAM: {
        // Create (empty or 0) / CreateIdempotent (1): [payer, ata, owner, mint, system, tokenProgram]
        const kind = data.length === 0 ? 0 : data[0];
        if ((kind === 0 || kind === 1) && data.length <= 1 && a[0] === wallet && (a[2] === wallet || a[2] === dcaAccount)) continue;
        return unexpected("associated token account");
      }
    }
  }
  return null;
}
