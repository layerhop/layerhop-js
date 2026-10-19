import { describe, expect, it } from "vitest";
import { LayerHopError, MAX_CALL_DATA_BYTES, MAX_DESTINATION_CALLS, PERMIT2_ADDRESS, rankQuotes, validateDestinationCalls } from "./index.js";

describe("destination calls", () => {
  const ctx = { nativeOutput: false, dstAmount: 10n };
  const approve = { to: "0xAF88d065e77c8cC2239327C5EDb3A432268e5831", data: "0x095ea7b3" + "0".repeat(128) };

  it("normalizes valid calls", () => {
    expect(validateDestinationCalls([approve], ctx)).toEqual([{ to: approve.to.toLowerCase(), data: approve.data, value: "0" }]);
    expect(validateDestinationCalls([{ to: approve.to, data: "0x", value: "10" }], { nativeOutput: true, dstAmount: 10n })[0]!.value).toBe("10");
  });

  it("rejects bad shapes, sizes, values and asset-pulling calls", () => {
    const bad = (calls: unknown, c = ctx) => expect(() => validateDestinationCalls(calls, c)).toThrow(LayerHopError);
    bad(undefined);
    bad([]);
    bad([null]);
    bad(Array(MAX_DESTINATION_CALLS + 1).fill(approve));
    bad([{ ...approve, to: "0x0000000000000000000000000000000000000001" }]);
    bad([{ ...approve, to: PERMIT2_ADDRESS }]);
    bad([{ ...approve, data: "0x095ea7" }]);
    bad([{ ...approve, data: "0x" + "ab".repeat(MAX_CALL_DATA_BYTES + 1) }]);
    bad([{ ...approve, data: "0x23b872dd" + "0".repeat(192) }]); // transferFrom
    bad([{ ...approve, data: "0xd505accf" + "0".repeat(448) }]); // permit
    bad([{ ...approve, value: "1" }]); // value with an ERC-20 output
    bad([{ ...approve, value: "-1" }]);
    bad([{ to: approve.to, data: "0x" }], { nativeOutput: true, dstAmount: 10n });
    bad([{ to: approve.to, data: "0x", value: "11" }], { nativeOutput: true, dstAmount: 10n });
  });

  it("ranks exact-output quotes by the cheaper input", () => {
    const base = { provider: "relay" as const, request: {} as never, dstAmount: "10", dstAmountMin: "10", estimatedSeconds: 5, fees: { ourFeeBps: 0 }, expiresAt: 0 };
    const ranked = rankQuotes([{ ...base, srcAmount: "12" }, { ...base, provider: "debridge", srcAmount: "11" }]);
    expect(ranked[0]!.provider).toBe("debridge");
  });
});
