/**
 * "Where's my money?": the universal transfer tracker (GET /v1/track/{txHash}, layerhop.com/track).
 * Types, the protocol registry and the pure next-step logic, shared by the API and the web page.
 */

export type TrackProtocolId =
  | "layerhop" | "relay" | "lifi" | "across" | "debridge" | "mayan" | "layerzero" | "cctp" | "wormhole" | "gaszip"
  | "arbitrum-native" | "op-native";

/**
 * - `needs_claim`: the funds are waiting for a second transaction (a native-bridge withdrawal, an
 *   attested CCTP / Wormhole transfer nobody redeemed yet).
 */
export type TrackStatus = "pending" | "filled" | "refunded" | "failed" | "needs_claim" | "unknown";

export interface TrackProtocol {
  id: TrackProtocolId;
  name: string;
  /** Where the protocol's own team takes questions. */
  supportUrl: string;
  /** Typical source-to-destination time in seconds (for "still within normal time"). */
  typicalSeconds: number;
  /** Per-transaction page on the protocol's explorer, `{hash}` replaced by the source tx hash. */
  explorer?: string;
}

/** Support links are the protocols' own help pages / explorers (checked 2026-10-26). */
export const TRACK_PROTOCOLS: Record<TrackProtocolId, TrackProtocol> = {
  layerhop: { id: "layerhop", name: "LayerHop", supportUrl: "https://layerhop.com/status", typicalSeconds: 120 },
  relay: { id: "relay", name: "Relay", supportUrl: "https://support.relay.link", typicalSeconds: 30, explorer: "https://relay.link/transaction/{hash}" },
  lifi: { id: "lifi", name: "LI.FI", supportUrl: "https://help.li.fi", typicalSeconds: 180, explorer: "https://scan.li.fi/tx/{hash}" },
  across: { id: "across", name: "Across", supportUrl: "https://discord.across.to", typicalSeconds: 60, explorer: "https://across.to/transactions" },
  debridge: { id: "debridge", name: "deBridge", supportUrl: "https://app.debridge.com", typicalSeconds: 60 },
  mayan: { id: "mayan", name: "Mayan", supportUrl: "https://explorer.mayan.finance", typicalSeconds: 180, explorer: "https://explorer.mayan.finance/tx/{hash}" },
  layerzero: { id: "layerzero", name: "LayerZero", supportUrl: "https://layerzeroscan.com", typicalSeconds: 180, explorer: "https://layerzeroscan.com/tx/{hash}" },
  cctp: { id: "cctp", name: "Circle CCTP", supportUrl: "https://developers.circle.com/cctp", typicalSeconds: 20 * 60 },
  wormhole: { id: "wormhole", name: "Wormhole", supportUrl: "https://wormholescan.io", typicalSeconds: 20 * 60, explorer: "https://wormholescan.io/#/tx/{hash}" },
  gaszip: { id: "gaszip", name: "Gas.zip", supportUrl: "https://www.gas.zip", typicalSeconds: 30 },
  "arbitrum-native": { id: "arbitrum-native", name: "Arbitrum Bridge", supportUrl: "https://portal.arbitrum.io", typicalSeconds: 15 * 60 },
  "op-native": { id: "op-native", name: "OP Stack Standard Bridge", supportUrl: "https://superbridge.app", typicalSeconds: 3 * 60 },
};

export function trackExplorerUrl(p: TrackProtocolId, hash: string): string | undefined {
  return TRACK_PROTOCOLS[p].explorer?.replace("{hash}", encodeURIComponent(hash));
}

export type TrackNextKind = "done" | "wait" | "late" | "claim" | "refunded" | "support" | "source_failed" | "not_found" | "unrecognized";

export interface TrackNext {
  kind: TrackNextKind;
  message: string;
  /** Where to act: Recover, the protocol's explorer / support page, the destination tx… */
  url?: string;
  label?: string;
}

export interface TrackResult {
  txHash: string;
  /** Source chain, when we found the transaction or a protocol told us. */
  chainId?: number;
  /** The source transaction itself: `reverted` means nothing left the wallet. */
  source?: "success" | "reverted";
  protocol?: { id: TrackProtocolId; name: string; via?: string; explorerUrl?: string; supportUrl: string };
  status: TrackStatus;
  dstChainId?: number;
  dstTxHash?: string;
  refundTxHash?: string;
  /** Unix seconds. */
  startedAt?: number;
  /** Native withdrawals: when the claim opens (unix seconds). */
  claimableAt?: number;
  typicalSeconds?: number;
  next: TrackNext;
  /** LayerHop order lookups go through our own order path (GET /v1/orders/{provider}/{id}). */
  layerhopProvider?: string;
  /** Status APIs that answered. */
  sources: string[];
  /** Unix seconds. */
  checkedAt: number;
}

/** "about 3 minutes" / "about 7 days". */
export function humanDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${Math.max(1, Math.round(s / 10) * 10)} seconds`;
  if (s < 90 * 60) return `${Math.round(s / 60)} minutes`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86_400)} days`;
}

/** Pending past this multiple of the typical time (and at least LATE_MIN_SECONDS) counts as late. */
export const LATE_FACTOR = 3;
export const LATE_MIN_SECONDS = 15 * 60;

/**
 * The concrete next step for a tracked transfer. Pure: `now` and every input passed in.
 * `recoverUrl` is where native-bridge claims are done (app.layerhop.com/recover).
 */
export function trackNext(r: Pick<TrackResult, "status" | "source" | "protocol" | "startedAt" | "typicalSeconds" | "dstTxHash" | "refundTxHash" | "claimableAt" | "chainId">, o: { now: number; found: boolean; recoverUrl?: string; dstExplorerUrl?: string; srcExplorerUrl?: string; txHash?: string }): TrackNext {
  const p = r.protocol;
  if (r.source === "reverted") {
    return { kind: "source_failed", message: "This transaction failed on the source chain, so your funds never left your wallet (only the network fee was spent). You can try again." };
  }
  switch (r.status) {
    case "filled":
      return { kind: "done", message: "Delivered. The funds arrived on the destination chain.", ...(o.dstExplorerUrl ? { url: o.dstExplorerUrl, label: "Destination transaction" } : {}) };
    case "refunded":
      return {
        kind: "refunded",
        message: `${p?.name ?? "The bridge"} couldn't complete the transfer and refunded it on the source chain${p?.via ? ` (via ${p.via})` : ""}. Check the wallet that sent it.`,
        ...(o.dstExplorerUrl ? { url: o.dstExplorerUrl, label: "Refund transaction" } : {}),
      };
    case "needs_claim": {
      if (p?.id === "arbitrum-native" || p?.id === "op-native") {
        const wait = r.claimableAt && r.claimableAt > o.now ? ` It can be claimed in about ${humanDuration(r.claimableAt - o.now)}.` : "";
        return {
          kind: "claim",
          message: `This is a native-bridge withdrawal: the funds wait on Ethereum until someone sends the claim transaction.${wait}`,
          ...(o.recoverUrl ? { url: o.recoverUrl, label: "Claim it with Recover" } : {}),
        };
      }
      return {
        kind: "claim",
        message: `${p?.name ?? "The bridge"} has signed off on the transfer, but nobody has delivered it on the destination chain yet. The app you bridged with usually does this; if it doesn't, redeem it on ${p?.name ?? "the bridge"}'s own site.`,
        url: p?.explorerUrl ?? p?.supportUrl,
        label: `Open ${p?.name ?? "the bridge"}`,
      };
    }
    case "failed":
      return {
        kind: "support",
        message: `${p?.name ?? "The bridge"} reports this transfer as failed. Funds in a failed bridge transfer are usually refundable: contact ${p?.name ?? "the bridge"} with this transaction hash.`,
        url: p?.supportUrl, label: `Contact ${p?.name ?? "support"}`,
      };
    case "pending": {
      const typical = r.typicalSeconds ?? (p ? TRACK_PROTOCOLS[p.id].typicalSeconds : undefined);
      const elapsed = r.startedAt ? o.now - r.startedAt : undefined;
      if (typical !== undefined && elapsed !== undefined && elapsed > Math.max(typical * LATE_FACTOR, LATE_MIN_SECONDS)) {
        return {
          kind: "late",
          message: `This is taking longer than usual (${humanDuration(elapsed)} so far; it normally takes about ${humanDuration(typical)}). Contact ${p?.name ?? "the bridge"} with this transaction hash.`,
          url: p?.supportUrl, label: `Contact ${p?.name ?? "support"}`,
        };
      }
      return {
        kind: "wait",
        message: typical !== undefined
          ? `In progress and still within normal time: ${p?.name ?? "this bridge"} usually takes about ${humanDuration(typical)}.`
          : "In progress. Check again in a few minutes.",
        ...(p?.explorerUrl ? { url: p.explorerUrl, label: `View on ${p.name}` } : {}),
      };
    }
    default:
      if (!o.found) {
        return {
          kind: "not_found",
          message: "We couldn't find this transaction yet. If you just sent it, wait a minute and check again; otherwise check the hash and pick the chain it was sent on.",
        };
      }
      return {
        kind: "unrecognized",
        message: p
          ? `${p.name} hasn't indexed this transaction yet. Check again in a minute.`
          : "We found the transaction but couldn't match it to a bridge we track (Relay, LI.FI, Across, deBridge, Mayan, LayerZero / Stargate, CCTP, Wormhole, Gas.zip, Arbitrum and OP Stack bridges). Check with the app you used.",
        ...(o.srcExplorerUrl ? { url: o.srcExplorerUrl, label: "Source transaction" } : {}),
      };
  }
}

/** EVM tx hash or Solana signature. */
export function isTrackableHash(h: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(h) || /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(h);
}
