/**
 * Bulk payouts (app.layerhop.com/payouts, `POST /v1/payouts/plan`): pay up to MAX_PAYOUT_ROWS people
 * from one wallet and one token. Each row names a recipient (address, ENS or .sol name), an amount in
 * human units of the token they receive, the token and the chain.
 *
 * Rows that receive the payer's own token on the payer's chain are plain transfers, sent in batches
 * (one EIP-5792 confirmation per batch on EVM where the wallet supports it, several transfers per
 * Solana transaction). Every other row is a LayerHop route (a normal quote with the row's recipient),
 * sized so the recipient gets at least the amount (exact output). Pure, so it's tested; nothing here
 * signs or sends anything.
 */

export const MAX_PAYOUT_ROWS = 100;
/** Transfers per EVM batch (one `wallet_sendCalls`); wallets refuse very large batches. */
export const EVM_TRANSFER_BATCH = 20;
/** Transfers per Solana transaction (each adds an idempotent account creation; 1232-byte limit). */
export const SVM_TRANSFER_BATCH = 8;
export const PAYOUT_LABEL_MAX = 60;
/** Extra input on top of the price estimate, so a route still delivers the full amount after slippage. */
export const PAYOUT_BUFFER_BPS = 100n;

export interface PayoutRowInput {
  recipient: string;
  /** Human units of `token` ("25", "0.5"). */
  amount: string;
  /** Symbol or address. */
  token: string;
  /** Chain slug or id. */
  chain: string;
  label?: string;
}

export interface PayoutRowIssue {
  /** 0-based row index (data rows, header excluded). */
  index: number;
  /** 1-based line in the pasted text (0 for rows that didn't come from text). */
  line: number;
  message: string;
}

export interface ParsedPayouts {
  rows: (PayoutRowInput & { index: number; line: number })[];
  issues: PayoutRowIssue[];
  /** More than MAX_PAYOUT_ROWS data rows: the extra ones are not in `rows`. */
  truncated: boolean;
}

const HUMAN_AMOUNT_RE = /^(?:\d{1,30}(?:\.\d{1,36})?|\.\d{1,36})$/;
const CHAIN_RE = /^[a-z0-9-]{1,40}$/;
const TOKEN_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** One CSV line into cells: commas or semicolons or tabs, double-quoted cells with "" escapes. */
export function splitCsvLine(line: string, sep = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const HEADER_NAMES: Record<string, keyof PayoutRowInput> = {
  recipient: "recipient", address: "recipient", to: "recipient", wallet: "recipient", name: "recipient",
  amount: "amount", value: "amount",
  token: "token", asset: "token", symbol: "token", currency: "token",
  chain: "chain", network: "chain",
  label: "label", memo: "label", note: "label", description: "label",
};

/** The separator the text uses: tab, then semicolon, else comma (spreadsheets paste tabs). */
function detectSeparator(lines: readonly string[]): string {
  const first = lines.find((l) => l.trim() !== "") ?? "";
  if (first.includes("\t")) return "\t";
  if (first.includes(";") && !first.includes(",")) return ";";
  return ",";
}

/** A row's shape (not whether the recipient or token exist; the API resolves those). */
export function checkPayoutRow(r: PayoutRowInput): string | undefined {
  if (!r.recipient || r.recipient.length > 255) return "Recipient is missing";
  if (!HUMAN_AMOUNT_RE.test(r.amount)) return `Amount "${r.amount.slice(0, 40)}" is not a number (use a dot for decimals, no thousands separators)`;
  if (!/[1-9]/.test(r.amount)) return "Amount must be above zero";
  if (!TOKEN_RE.test(r.token) || !/[A-Za-z]/.test(r.token)) return `Token "${r.token.slice(0, 40)}" is not a symbol or address`;
  if (!CHAIN_RE.test(r.chain)) return `Chain "${r.chain.slice(0, 40)}" is not a chain name or id`;
  return undefined;
}

/**
 * Parse pasted or uploaded CSV: `recipient,amount,token,chain[,label]`, with or without a header row
 * (a header may name the columns in any order: recipient/address, amount, token/asset, chain/network,
 * label/memo). Blank lines and `#` comments are skipped. Rows with a bad shape are reported in
 * `issues` (and left out of `rows`).
 */
export function parsePayoutCsv(text: string): ParsedPayouts {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const sep = detectSeparator(lines);
  let columns: (keyof PayoutRowInput | undefined)[] = ["recipient", "amount", "token", "chain", "label"];
  const rows: ParsedPayouts["rows"] = [];
  const issues: PayoutRowIssue[] = [];
  let truncated = false;
  let headerSeen = false;
  let index = 0;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const cells = splitCsvLine(raw, sep);
    if (!headerSeen) {
      headerSeen = true;
      const named = cells.map((c) => HEADER_NAMES[c.toLowerCase().replace(/[^a-z]/g, "")]);
      if (named.includes("recipient") && named.includes("amount")) {
        columns = named;
        continue;
      }
    }
    if (index >= MAX_PAYOUT_ROWS) {
      truncated = true;
      break;
    }
    const get = (k: keyof PayoutRowInput) => {
      const at = columns.indexOf(k);
      return at >= 0 ? (cells[at] ?? "").trim() : "";
    };
    const row: PayoutRowInput = {
      recipient: get("recipient"),
      amount: get("amount"),
      token: get("token"),
      chain: get("chain").toLowerCase(),
      ...(get("label") ? { label: cleanPayoutLabel(get("label")) } : {}),
    };
    const problem = checkPayoutRow(row);
    if (problem) issues.push({ index, line: n + 1, message: problem });
    else rows.push({ ...row, index, line: n + 1 });
    index++;
  }
  return { rows, issues, truncated };
}

export function cleanPayoutLabel(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PAYOUT_LABEL_MAX);
}

/** "1.5" with 6 decimals → 1500000n; undefined for anything else (too many decimals, zero, not a number). */
export function humanToBase(value: string, decimals: number): bigint | undefined {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return undefined;
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) return undefined;
  const base = BigInt((m[1] || "0") + frac.padEnd(decimals, "0"));
  return base > 0n ? base : undefined;
}

/** 1500000n with 6 decimals → "1.5" (exact; no rounding). */
export function baseToHuman(amount: bigint | string, decimals: number): string {
  const n = BigInt(amount);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/* -------------------------------------------------------------------------- grouping */

/** A validated row: recipient resolved, token resolved, amount in base units. */
export interface ResolvedPayout {
  index: number;
  chainId: number;
  vm: "evm" | "svm";
  /** Token address (native = the chain's native address). */
  token: string;
  address: string;
  /** Base units of `token`. */
  amount: string;
}

export interface PayoutSource {
  chainId: number;
  token: string;
  vm: "evm" | "svm";
}

export interface TransferBatch {
  chainId: number;
  token: string;
  /** Row indices, in input order. */
  rows: number[];
  /** Sum of the batch's amounts (base units). */
  total: string;
}

export interface RouteGroup {
  /** Destination chain; one leg (one quote, one signature) per row. */
  chainId: number;
  rows: number[];
}

export interface PayoutPlan {
  transfers: TransferBatch[];
  routes: RouteGroup[];
  /** Everything the payer sends as plain transfers (base units of the source token). */
  transferTotal: string;
}

const sameToken = (vm: "evm" | "svm", a: string, b: string) => (vm === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** A row the payer can send as a plain transfer: the source token on the source chain. */
export function isTransferRow(r: Pick<ResolvedPayout, "chainId" | "token">, src: PayoutSource): boolean {
  return r.chainId === src.chainId && sameToken(src.vm, r.token, src.token);
}

/**
 * Group validated rows: same-chain same-token rows into transfer batches (at most EVM_TRANSFER_BATCH /
 * SVM_TRANSFER_BATCH each, input order kept); every other row is its own route leg, grouped by
 * destination chain (chains in order of first appearance).
 */
export function planPayouts(rows: readonly ResolvedPayout[], src: PayoutSource): PayoutPlan {
  const size = src.vm === "svm" ? SVM_TRANSFER_BATCH : EVM_TRANSFER_BATCH;
  const direct = rows.filter((r) => isTransferRow(r, src));
  const transfers: TransferBatch[] = [];
  for (let i = 0; i < direct.length; i += size) {
    const part = direct.slice(i, i + size);
    transfers.push({ chainId: src.chainId, token: src.token, rows: part.map((r) => r.index), total: part.reduce((a, r) => a + BigInt(r.amount), 0n).toString() });
  }
  const routes: RouteGroup[] = [];
  for (const r of rows) {
    if (isTransferRow(r, src)) continue;
    let g = routes.find((x) => x.chainId === r.chainId);
    if (!g) routes.push((g = { chainId: r.chainId, rows: [] }));
    g.rows.push(r.index);
  }
  return { transfers, routes, transferTotal: direct.reduce((a, r) => a + BigInt(r.amount), 0n).toString() };
}

/* -------------------------------------------------------------------------- exact output sizing */

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * A first source amount for a route that must deliver `target` (base units of the destination token),
 * from USD prices, plus `bufferBps`. Prices are scaled to integers (1e-12 precision) so the amount
 * math stays in BigInt. undefined without both prices.
 */
export function estimateSourceAmount(i: { target: bigint; dstDecimals: number; dstUsd?: number; srcDecimals: number; srcUsd?: number; bufferBps?: bigint }): bigint | undefined {
  if (!i.dstUsd || !i.srcUsd || !(i.dstUsd > 0) || !(i.srcUsd > 0) || !Number.isFinite(i.dstUsd / i.srcUsd)) return undefined;
  const ratio = BigInt(Math.round((i.dstUsd / i.srcUsd) * 1e12));
  if (ratio <= 0n) return undefined;
  const buffer = 10_000n + (i.bufferBps ?? PAYOUT_BUFFER_BPS);
  // target × ratio × 10^srcDecimals / 10^dstDecimals, then the buffer.
  const num = i.target * ratio * 10n ** BigInt(i.srcDecimals) * buffer;
  const den = 10n ** 12n * 10n ** BigInt(i.dstDecimals) * 10_000n;
  return ceilDiv(num, den);
}

/**
 * Re-size a quoted source amount so its guaranteed output (`quotedMin`) covers `target` with
 * `bufferBps` to spare: amount × target / quotedMin, rounded up, plus the buffer. Routes are close to
 * linear around a quote, so one or two rounds converge.
 */
export function resizeForTarget(amount: bigint, quotedMin: bigint, target: bigint, bufferBps = 30n): bigint {
  if (quotedMin <= 0n) return amount * 2n;
  return ceilDiv(amount * target * (10_000n + bufferBps), quotedMin * 10_000n);
}

/** Overpaying by more than this (bps of the target) is worth a re-quote with a smaller amount. */
export const PAYOUT_MAX_OVERPAY_BPS = 300n;

export type SizingVerdict = "short" | "ok" | "over";

/** Does a quote's guaranteed output cover the target, and without overpaying by more than PAYOUT_MAX_OVERPAY_BPS? */
export function sizingVerdict(quotedMin: bigint, target: bigint): SizingVerdict {
  if (quotedMin < target) return "short";
  return (quotedMin - target) * 10_000n > target * PAYOUT_MAX_OVERPAY_BPS ? "over" : "ok";
}

/* -------------------------------------------------------------------------- receipt */

export interface ReceiptRow {
  index: number;
  label?: string;
  recipientInput: string;
  address?: string;
  chain: string;
  token: string;
  amount: string;
  kind: "transfer" | "route" | "invalid";
  status: string;
  txHash?: string;
  dstTxHash?: string;
  message?: string;
}

/** A CSV cell: quoted when needed; a leading = + - @ is neutralised (spreadsheet formula injection). */
export function csvCell(v: string | number | undefined): string {
  let s = v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const RECEIPT_COLUMNS = ["row", "label", "recipient", "address", "chain", "token", "amount", "kind", "status", "tx_hash", "destination_tx_hash", "message"] as const;

/** The receipt CSV a payout run downloads: one line per row, in row order. */
export function receiptCsv(rows: readonly ReceiptRow[]): string {
  const lines = [RECEIPT_COLUMNS.join(",")];
  for (const r of [...rows].sort((a, b) => a.index - b.index)) {
    lines.push([r.index + 1, r.label, r.recipientInput, r.address, r.chain, r.token, r.amount, r.kind, r.status, r.txHash, r.dstTxHash, r.message].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
