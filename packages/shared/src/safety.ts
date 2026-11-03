/**
 * Community safety: scam reports (POST /v1/reports, GET /v1/reports/{target}) and the transaction
 * preview (POST /v1/preview). Shared by the API, the web app and the SDKs' types.
 */
import type { WalletVm } from "./types.js";

// ---- community reports ---------------------------------------------------------------------------

export const REPORT_CATEGORIES = ["scam", "phishing", "poisoning", "rug"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  scam: "Scam",
  phishing: "Phishing / drainer",
  poisoning: "Address poisoning",
  rug: "Rug pull",
};

/** What was reported: a wallet or contract address, or a token. */
export type ReportTargetKind = "address" | "token";

/** `pending`: counted, note hidden · `approved`: counted, note shown · `hidden`: spam, not counted. */
export type ReportStatus = "pending" | "approved" | "hidden";

export const REPORT_NOTE_MAX = 500;
/** A signed report must reach the API within this long of its `Issued At`. */
export const REPORT_SIGNATURE_TTL_MS = 10 * 60_000;

export interface ReportFields {
  vm: WalletVm;
  /** The signing wallet (EVM 0x…, Solana base58). */
  reporter: string;
  /** Chain the target lives on (internal chain id; Solana 7565164). */
  chainId: number;
  target: string;
  kind: ReportTargetKind;
  category: ReportCategory;
  txHash?: string;
  note?: string;
  /** ISO 8601. */
  issuedAt: string;
}

/**
 * The exact text a reporter's wallet signs (EIP-191 personal_sign on EVM, signMessage on Solana).
 * Plain text rather than SIWE, so a wallet never shows a "sign in to another site" warning; the API
 * rebuilds it from the submitted fields, so every field (note included) is covered by the signature.
 * Signing it costs nothing and moves no funds.
 */
export function buildReportMessage(f: ReportFields): string {
  return [
    "LayerHop community report",
    "",
    "I report this as a scam. Signing is free and does not move funds.",
    "",
    `Reporter: ${f.reporter}`,
    `Chain ID: ${f.chainId}`,
    `${f.kind === "token" ? "Token" : "Address"}: ${f.target}`,
    `Category: ${f.category}`,
    `Transaction: ${f.txHash ?? "-"}`,
    `Note: ${(f.note ?? "").replace(/\s+/g, " ").trim() || "-"}`,
    `Issued At: ${f.issuedAt}`,
  ].join("\n");
}

export interface CommunityNote {
  category: ReportCategory;
  note: string;
  txHash?: string;
  chainId: number;
  createdAt: string;
}

/**
 * Community reports for one address or token. `count` includes reports not reviewed yet; notes are
 * shown only after a LayerHop admin approved them. Reports are a signal, never a verdict: they don't
 * block swaps and don't change a token's risk level.
 */
export interface CommunityReports {
  target: string;
  count: number;
  /**
   * Of `count`, the reports a LayerHop admin approved. Only these can raise a transaction preview's
   * risk; unreviewed ones are shown as information.
   */
  approved?: number;
  categories: Partial<Record<ReportCategory, number>>;
  /** Chains the reports were filed on. */
  chainIds: number[];
  /** Newest approved notes (at most 5). */
  notes: CommunityNote[];
  lastReportedAt?: string;
}

// ---- transaction preview -------------------------------------------------------------------------

export type PreviewFlagCode =
  | "unlimited_approval"
  | "approval_to_eoa"
  | "approval_to_unknown"
  | "approve_all_nfts"
  | "permit_to_unknown"
  | "permit_to_eoa"
  | "long_permit"
  | "value_to_eoa"
  | "unverified_contract"
  | "new_contract"
  | "gives_away_assets"
  | "community_reports"
  | "simulation_failed"
  | "unknown_function"
  | "wrong_chain";

export interface PreviewFlag {
  code: PreviewFlagCode;
  level: "caution" | "danger";
  message: string;
}

/** A change to the `from` wallet's balance (signed: negative = leaves the wallet). */
export interface PreviewBalanceChange {
  /** EVM: token address, or `native`. Solana: mint, or `native` (SOL). */
  token: string;
  symbol?: string;
  decimals?: number;
  /** Base units, signed integer string. */
  delta: string;
  /** ERC-721 / ERC-1155 id when the change is an NFT. */
  tokenId?: string;
  standard?: "native" | "erc20" | "erc721" | "erc1155" | "spl";
}

/** A transfer the transaction makes, to anyone (who gets what). */
export interface PreviewTransfer {
  token: string;
  symbol?: string;
  decimals?: number;
  from: string;
  to: string;
  /** Base units (1 for an ERC-721). */
  amount: string;
  tokenId?: string;
}

export interface PreviewApproval {
  /** Token (or NFT collection) the approval is on. */
  token: string;
  symbol?: string;
  decimals?: number;
  spender: string;
  /** Base units, or `all` for setApprovalForAll / an NFT collection. */
  amount: string;
  unlimited: boolean;
  /** approve | increaseAllowance | setApprovalForAll | permit (EIP-2612) | permit2 */
  via: "approve" | "increaseAllowance" | "setApprovalForAll" | "permit" | "permit2";
  /** Unix seconds when the approval or signature stops working (permits). */
  expiresAt?: number;
  spenderLabel?: string;
  spenderIsContract?: boolean;
}

export interface PreviewAction {
  /** Plain-language line, e.g. "Approve 0xabc… to spend unlimited USDC". */
  text: string;
  /** Decoded function or primary type: `approve(address,uint256)`, `PermitSingle` … */
  method?: string;
}

export interface PreviewSimulation {
  /** How the result was produced: a full simulation with logs, a plain eth_call, decode only, or Solana's simulateTransaction. */
  method: "eth_simulateV1" | "debug_traceCall" | "eth_call" | "decode" | "simulateTransaction" | "none";
  ok: boolean;
  error?: string;
  gasUsed?: string;
}

export interface TxPreview {
  kind: "evm_tx" | "typed_data" | "solana_tx";
  chainId: number;
  /** The wallet the preview is for (tx sender / signer). */
  from?: string;
  /** One sentence for the top of the page. */
  summary: string;
  /** Worst flag level, `ok` when none. */
  risk: "ok" | "caution" | "danger";
  actions: PreviewAction[];
  balanceChanges: PreviewBalanceChange[];
  transfers: PreviewTransfer[];
  approvals: PreviewApproval[];
  flags: PreviewFlag[];
  simulation: PreviewSimulation;
  /** Community reports for the addresses involved (only those with reports). */
  community: CommunityReports[];
  /** Addresses involved, with what we know about them. */
  addresses: { address: string; role: string; label?: string; isContract?: boolean; verified?: boolean }[];
}
