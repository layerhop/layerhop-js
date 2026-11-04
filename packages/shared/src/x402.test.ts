import { describe, expect, it } from "vitest";
import { BTC_ADDRESS_RE, bip21Uri, satsToBtc } from "./bitcoin.js";
import { decodeX402Header, encodeX402Header, normalizePayment, normalizeRequirements, normalizeX402Resource, x402Network, x402RefKey } from "./x402.js";

describe("x402 helpers", () => {
  it("finds networks by v1 name, CAIP-2 id or chain id", () => {
    expect(x402Network("base")?.chainId).toBe(8453);
    expect(x402Network("eip155:42161")?.name).toBe("arbitrum");
    expect(x402Network(10)?.caip2).toBe("eip155:10");
    expect(x402Network("bsc")).toBeUndefined();
    expect(x402Network("eip155:56")).toBeUndefined();
  });

  it("round-trips base64 JSON headers, including non-ASCII", () => {
    const v = { x402Version: 2, note: "café ✓" };
    expect(decodeX402Header(encodeX402Header(v))).toEqual(v);
    expect(decodeX402Header("%%%")).toBeUndefined();
    expect(decodeX402Header(undefined)).toBeUndefined();
  });

  it("normalizes v1 and v2 requirements and payloads", () => {
    const v1 = normalizeRequirements({ scheme: "exact", network: "base", maxAmountRequired: "10000", asset: "0xa", payTo: "0xb", maxTimeoutSeconds: 60, resource: "r", description: "", mimeType: "" });
    const v2 = normalizeRequirements({ scheme: "exact", network: "eip155:8453", amount: "10000", asset: "0xa", payTo: "0xb", maxTimeoutSeconds: 60 });
    expect(v1).toEqual(v2 && { ...v2, networkRaw: "base" });
    const auth = { from: "0x1", to: "0x2", value: "1", validAfter: "0", validBefore: "9", nonce: "0x3" };
    expect(normalizePayment({ x402Version: 1, scheme: "exact", network: "base", payload: { signature: "0xs", authorization: auth } })).toEqual({
      x402Version: 1, scheme: "exact", networkRaw: "base", payload: { signature: "0xs", authorization: auth },
    });
    expect(normalizePayment({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:8453" }, payload: { signature: "0xs", authorization: auth } })?.networkRaw).toBe("eip155:8453");
    expect(normalizePayment({ x402Version: 2, payload: {} })).toBeUndefined();
  });

  it("keys resources without query or fragment", () => {
    expect(normalizeX402Resource(" https://API.example.com/v1/weather?city=x#a ")).toBe("https://api.example.com/v1/weather");
    expect(normalizeX402Resource("weather-api")).toBe("weather-api");
    expect(x402RefKey("acc_1", "weather-api")).toBe("x402:acc_1:weather-api");
  });
});

describe("bitcoin helpers", () => {
  it("formats satoshis and BIP21 URIs", () => {
    expect(satsToBtc(33008n)).toBe("0.00033008");
    expect(satsToBtc("100000000")).toBe("1");
    expect(satsToBtc(150_000_000n)).toBe("1.5");
    expect(bip21Uri("bc1qxle9xtv9zpdg55qy08w2n43lzv7n468gje2kxt", 33008n, "Shop & co")).toBe("bitcoin:bc1qxle9xtv9zpdg55qy08w2n43lzv7n468gje2kxt?amount=0.00033008&label=Shop%20%26%20co");
  });

  it("checks mainnet address formats", () => {
    expect(BTC_ADDRESS_RE.test("bc1qxle9xtv9zpdg55qy08w2n43lzv7n468gje2kxt")).toBe(true);
    expect(BTC_ADDRESS_RE.test("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe(true);
    expect(BTC_ADDRESS_RE.test("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(true);
    expect(BTC_ADDRESS_RE.test("tb1qxle9xtv9zpdg55qy08w2n43lzv7n468gje2kxt")).toBe(false);
    expect(BTC_ADDRESS_RE.test("0x2222222222222222222222222222222222222222")).toBe(false);
  });
});
