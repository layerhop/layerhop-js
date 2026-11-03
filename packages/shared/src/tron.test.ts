import { describe, expect, it } from "vitest";
import {
  CHAINS, FLAGGED_CHAINS, PREVIEW_ADDRESS, TRON_CHAIN, TRON_CHAIN_ID, TRON_USDT, TRX_NATIVE, addressVm, checkReportedTx, crossChainVariantsOf,
  findToken, gasOnArrivalApplies, getAnyChain, isNative, isTronAddress, isTronTxHash, nativeAddress, normalizeTronTxHash, parseTronFeeRecipient, rpcUrl,
  toTronAddress, tronApiConfig, tronToEvmHex, tronToHex41,
} from "./index.js";

const USER = "TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm";
const DEPOSITORY = "TXtEs6t2oUWQsNos7m68gbHdE9Q5n6x2oN";

describe("Tron chain family (D-048)", () => {
  it("parses FEE_RECIPIENT_TVM: T-address or unset; anything else fails at startup", () => {
    expect(parseTronFeeRecipient(undefined)).toBeUndefined();
    expect(parseTronFeeRecipient("  ")).toBeUndefined();
    expect(parseTronFeeRecipient(` ${USER} `)).toBe(USER);
    expect(() => parseTronFeeRecipient(tronToEvmHex(USER))).toThrow(/FEE_RECIPIENT_TVM/);
    expect(() => parseTronFeeRecipient(USER.slice(0, -1) + "x")).toThrow(/FEE_RECIPIENT_TVM/);
  });

  it("is resolvable by id and slug but not part of the public CHAINS list", () => {
    expect(getAnyChain(TRON_CHAIN_ID)).toBe(TRON_CHAIN);
    expect(getAnyChain("tron")?.vm).toBe("tvm");
    expect(CHAINS.some((c) => c.id === TRON_CHAIN_ID || c.vm === "tvm")).toBe(false);
    expect(FLAGGED_CHAINS).toContain(TRON_CHAIN);
    expect(TRON_CHAIN).toMatchObject({ nativeSymbol: "TRX", nativeDecimals: 6, explorerTx: "https://tronscan.org/#/transaction/" });
  });

  it("lists TRX and USDT, with TRX_NATIVE as the native coin", () => {
    expect(findToken(TRON_CHAIN_ID, "USDT")).toMatchObject({ address: TRON_USDT, decimals: 6 });
    expect(findToken(TRON_CHAIN_ID, "trx")?.address).toBe(TRX_NATIVE);
    expect(isNative(TRON_CHAIN_ID, TRX_NATIVE)).toBe(true);
    expect(isNative(TRON_CHAIN_ID, TRON_USDT)).toBe(false);
    expect(nativeAddress(TRON_CHAIN_ID)).toBe(TRX_NATIVE);
    expect(toTronAddress(`41${"0".repeat(40)}`)).toBe(TRX_NATIVE);
  });

  it("classifies T-addresses as tvm (not svm)", () => {
    expect(addressVm(USER)).toBe("tvm");
    expect(addressVm(TRON_USDT)).toBe("tvm");
    expect(addressVm("TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STn")).toBe("svm"); // bad checksum: just base58
    expect(isTronAddress(PREVIEW_ADDRESS.tvm)).toBe(true);
  });

  it("never offers gas on arrival to Tron and never suggests Tron as a cheaper chain", () => {
    expect(gasOnArrivalApplies({ srcChainId: 8453, dstChainId: TRON_CHAIN_ID, dstToken: TRON_USDT })).toBe(false);
    expect(crossChainVariantsOf("USDT").some((v) => v.chainId === TRON_CHAIN_ID)).toBe(false);
  });

  it("normalizes tx hashes to bare lowercase hex", () => {
    const h = "96BC32700D5E0BDBA25982B2B99D7EF0FC03D462C3FA2C799DC09992BDEC5E7B";
    expect(isTronTxHash(h)).toBe(true);
    expect(normalizeTronTxHash(`0x${h}`)).toBe(h.toLowerCase());
    expect(normalizeTronTxHash("0x123")).toBeUndefined();
  });

  it("uses TronGrid: JSON-RPC for receipts, the HTTP API for building (key optional)", () => {
    expect(rpcUrl(TRON_CHAIN_ID)).toBe("https://api.trongrid.io/jsonrpc");
    expect(rpcUrl(TRON_CHAIN_ID, { RPC_URL_728126428: "https://my.node/jsonrpc" })).toBe("https://my.node/jsonrpc");
    expect(tronApiConfig({})).toEqual({ url: "https://api.trongrid.io" });
    expect(tronApiConfig({ TRON_API_URL: "https://node.example/", TRONGRID_API_KEY: "k" })).toEqual({ url: "https://node.example", apiKey: "k" });
  });

  describe("checkReportedTx on Tron (TronGrid eth_getTransactionByHash)", () => {
    const hash = "96bc32700d5e0bdba25982b2b99d7ef0fc03d462c3fa2c799dc09992bdec5e7b";
    const deposit = { vm: "tvm", to: DEPOSITORY, data: "0xe8017952aa", value: "0" };
    const node = (tx: unknown) => {
      const seen: unknown[] = [];
      const fetch = (async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(String(init.body)).params);
        return Response.json({ jsonrpc: "2.0", id: 1, result: tx });
      }) as unknown as typeof globalThis.fetch;
      return { seen, deps: { fetch, rpcUrl: () => "https://api.trongrid.io/jsonrpc" } };
    };
    const order = { srcChainId: TRON_CHAIN_ID, sender: USER, builtTxs: [deposit] };

    it("verifies a tx from the sender to the built contract, sending the hash 0x-prefixed", async () => {
      const n = node({ from: tronToEvmHex(USER), to: tronToEvmHex(DEPOSITORY), input: "0xe8017952aa" });
      expect(await checkReportedTx(order, hash, n.deps)).toEqual({ result: "verified" });
      expect(n.seen[0]).toEqual([`0x${hash}`]);
    });

    it("rejects another sender or another contract; not found stays notfound", async () => {
      expect((await checkReportedTx(order, hash, node({ from: tronToEvmHex(DEPOSITORY), to: tronToEvmHex(DEPOSITORY), input: "0x" }).deps)).result).toBe("mismatch");
      expect((await checkReportedTx(order, hash, node({ from: tronToEvmHex(USER), to: tronToEvmHex(TRON_USDT), input: "0x095ea7b3" }).deps)).result).toBe("mismatch");
      expect((await checkReportedTx(order, hash, node(null).deps)).result).toBe("notfound");
      expect((await checkReportedTx(order, "0xnothex", node(null).deps)).result).toBe("mismatch");
      expect(tronToHex41(USER)).toBe("41a346f2bd7d43a5d90b7c57a18196be96b2840e61");
    });
  });
});
