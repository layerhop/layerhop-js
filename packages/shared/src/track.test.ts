import { describe, expect, it } from "vitest";
import { humanDuration, isTrackableHash, trackNext, TRACK_PROTOCOLS } from "./track.js";

const proto = (id: keyof typeof TRACK_PROTOCOLS) => ({ id, name: TRACK_PROTOCOLS[id].name, supportUrl: TRACK_PROTOCOLS[id].supportUrl });
const NOW = 1_800_000_000;

describe("trackNext", () => {
  it("pending within the usual time: wait", () => {
    const n = trackNext({ status: "pending", protocol: proto("across"), startedAt: NOW - 120, typicalSeconds: 60 }, { now: NOW, found: true });
    expect(n.kind).toBe("wait");
    expect(n.message).toContain("usually takes about 60 seconds");
  });

  it("pending far past the usual time: contact support", () => {
    const n = trackNext({ status: "pending", protocol: proto("relay"), startedAt: NOW - 3_600, typicalSeconds: 30 }, { now: NOW, found: true });
    expect(n).toMatchObject({ kind: "late", url: "https://support.relay.link" });
    // Never "late" inside the 15-minute floor, even for a fast bridge.
    expect(trackNext({ status: "pending", protocol: proto("relay"), startedAt: NOW - 600, typicalSeconds: 30 }, { now: NOW, found: true }).kind).toBe("wait");
  });

  it("native withdrawals point at Recover with the claim ETA", () => {
    const n = trackNext({ status: "needs_claim", protocol: proto("arbitrum-native"), claimableAt: NOW + 3 * 86_400 }, { now: NOW, found: true, recoverUrl: "https://app.layerhop.com/recover?tx=0x1" });
    expect(n).toMatchObject({ kind: "claim", url: "https://app.layerhop.com/recover?tx=0x1", label: "Claim it with Recover" });
    expect(n.message).toContain("about 3 days");
  });

  it("a reverted source tx wins over everything else", () => {
    expect(trackNext({ status: "failed", source: "reverted", protocol: proto("lifi") }, { now: NOW, found: true }).kind).toBe("source_failed");
  });

  it("filled links the destination tx; refunded says where the money went", () => {
    expect(trackNext({ status: "filled" }, { now: NOW, found: true, dstExplorerUrl: "https://x/tx/1" })).toMatchObject({ kind: "done", url: "https://x/tx/1" });
    expect(trackNext({ status: "refunded", protocol: proto("debridge") }, { now: NOW, found: true }).message).toContain("refunded it on the source chain");
  });

  it("unknown: not found vs found but unrecognised", () => {
    expect(trackNext({ status: "unknown" }, { now: NOW, found: false }).kind).toBe("not_found");
    expect(trackNext({ status: "unknown" }, { now: NOW, found: true }).kind).toBe("unrecognized");
  });
});

describe("helpers", () => {
  it("humanDuration", () => {
    expect(humanDuration(30)).toBe("30 seconds");
    expect(humanDuration(180)).toBe("3 minutes");
    expect(humanDuration(5 * 3600)).toBe("5 hours");
    expect(humanDuration(7 * 86_400)).toBe("7 days");
  });

  it("isTrackableHash", () => {
    expect(isTrackableHash(`0x${"ab".repeat(32)}`)).toBe(true);
    expect(isTrackableHash("2pvouiKqyMCXt2FXGDFosqD62HxpAB6SRjEtZRecpxhSFDvXtfdxRxe2eM4p2p2B37XSavVPFq3XrmLQhbTUjDs7")).toBe(true);
    expect(isTrackableHash("0x1234")).toBe(false);
  });
});
