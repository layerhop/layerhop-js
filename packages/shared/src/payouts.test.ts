import { describe, expect, it } from "vitest";
import {
  baseToHuman, csvCell, estimateSourceAmount, humanToBase, MAX_PAYOUT_ROWS, parsePayoutCsv, planPayouts, receiptCsv, resizeForTarget, sizingVerdict, splitCsvLine,
  EVM_TRANSFER_BATCH, SVM_TRANSFER_BATCH, type ResolvedPayout,
} from "./payouts.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const A = "0x1111111111111111111111111111111111111111";

describe("parsePayoutCsv", () => {
  it("reads rows without a header in the default column order", () => {
    const r = parsePayoutCsv(`${A},25,USDC,base\nalice.eth,0.5,ETH,Arbitrum,March invoice`);
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { recipient: A, amount: "25", token: "USDC", chain: "base", index: 0, line: 1 },
      { recipient: "alice.eth", amount: "0.5", token: "ETH", chain: "arbitrum", label: "March invoice", index: 1, line: 2 },
    ]);
  });

  it("maps a header in any order, skips blanks and comments, handles quotes and BOM", () => {
    const text = '﻿Chain;Token;Amount;Address;Memo\n\n# team\nbase;USDC;"10.25";bob.sol;"Bob; design"\n';
    const r = parsePayoutCsv(text);
    expect(r.rows).toEqual([{ recipient: "bob.sol", amount: "10.25", token: "USDC", chain: "base", label: "Bob; design", index: 0, line: 4 }]);
  });

  it("reads tab-separated text pasted from a spreadsheet", () => {
    const r = parsePayoutCsv(`recipient\tamount\ttoken\tchain\n${A}\t1\tUSDC\t8453`);
    expect(r.rows[0]).toMatchObject({ recipient: A, chain: "8453" });
  });

  it("reports rows with a bad shape, with their line", () => {
    const r = parsePayoutCsv(`${A},1,000,USDC,base\n${A},abc,USDC,base\n,5,USDC,base\n${A},0,USDC,base\n${A},5,US DC,base`);
    expect(r.rows).toHaveLength(0);
    expect(r.issues.map((i) => i.line)).toEqual([1, 2, 3, 4, 5]);
    expect(r.issues[1]!.message).toMatch(/not a number/);
    expect(r.issues[2]!.message).toMatch(/Recipient/);
    expect(r.issues[3]!.message).toMatch(/above zero/);
  });

  it(`stops after ${MAX_PAYOUT_ROWS} rows`, () => {
    const text = Array.from({ length: MAX_PAYOUT_ROWS + 5 }, () => `${A},1,USDC,base`).join("\n");
    const r = parsePayoutCsv(text);
    expect(r.rows).toHaveLength(MAX_PAYOUT_ROWS);
    expect(r.truncated).toBe(true);
  });

  it("splits quoted cells with escaped quotes", () => {
    expect(splitCsvLine('a,"b ""x"", c",d')).toEqual(["a", 'b "x", c', "d"]);
  });
});

describe("units", () => {
  it("converts human amounts to base units and back without floats", () => {
    expect(humanToBase("1.5", 6)).toBe(1_500_000n);
    expect(humanToBase(".000001", 6)).toBe(1n);
    expect(humanToBase("0.0000001", 6)).toBeUndefined();
    expect(humanToBase("0", 6)).toBeUndefined();
    expect(humanToBase("123456789.123456789123456789", 18)).toBe(123456789123456789123456789n);
    expect(baseToHuman(1_500_000n, 6)).toBe("1.5");
    expect(baseToHuman("1", 18)).toBe("0.000000000000000001");
    expect(baseToHuman(5n, 0)).toBe("5");
  });
});

describe("planPayouts", () => {
  const row = (index: number, over: Partial<ResolvedPayout> = {}): ResolvedPayout => ({ index, chainId: 8453, vm: "evm", token: USDC_BASE, address: A, amount: "1000000", ...over });

  it("batches same-chain same-token rows as transfers and gives every other row its own route leg", () => {
    const rows = [
      row(0),
      row(1, { token: USDC_BASE.toLowerCase() }),
      row(2, { chainId: 42161, token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" }),
      row(3, { token: "0x0000000000000000000000000000000000000000" }),
      row(4, { chainId: 42161, token: "0x0000000000000000000000000000000000000000" }),
    ];
    const p = planPayouts(rows, { chainId: 8453, token: USDC_BASE, vm: "evm" });
    expect(p.transfers).toEqual([{ chainId: 8453, token: USDC_BASE, rows: [0, 1], total: "2000000" }]);
    expect(p.routes).toEqual([{ chainId: 42161, rows: [2, 4] }, { chainId: 8453, rows: [3] }]);
    expect(p.transferTotal).toBe("2000000");
  });

  it("caps transfer batches per VM", () => {
    const many = Array.from({ length: EVM_TRANSFER_BATCH * 2 + 1 }, (_, i) => row(i));
    expect(planPayouts(many, { chainId: 8453, token: USDC_BASE, vm: "evm" }).transfers.map((b) => b.rows.length)).toEqual([EVM_TRANSFER_BATCH, EVM_TRANSFER_BATCH, 1]);
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const sol = Array.from({ length: SVM_TRANSFER_BATCH + 1 }, (_, i) => row(i, { chainId: 7565164, vm: "svm", token: mint }));
    expect(planPayouts(sol, { chainId: 7565164, token: mint, vm: "svm" }).transfers.map((b) => b.rows.length)).toEqual([SVM_TRANSFER_BATCH, 1]);
  });

  it("compares Solana mints exactly", () => {
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const p = planPayouts([row(0, { chainId: 7565164, vm: "svm", token: mint.toLowerCase() })], { chainId: 7565164, token: mint, vm: "svm" });
    expect(p.transfers).toEqual([]);
    expect(p.routes).toHaveLength(1);
  });
});

describe("exact output sizing", () => {
  it("estimates a source amount from prices with a buffer", () => {
    // 100 USDC (6 dp) paid with ETH (18 dp) at $2,500: 0.04 ETH + 1%.
    expect(estimateSourceAmount({ target: 100_000_000n, dstDecimals: 6, dstUsd: 1, srcDecimals: 18, srcUsd: 2500 })).toBe(40_400_000_000_000_000n);
    expect(estimateSourceAmount({ target: 100n, dstDecimals: 6, srcDecimals: 6, srcUsd: 1 })).toBeUndefined();
  });

  it("re-sizes a quote so its minimum covers the target", () => {
    // 1,000,000 in gave a 980,000 minimum; we need 1,000,000 out (+0.3%).
    const next = resizeForTarget(1_000_000n, 980_000n, 1_000_000n);
    expect(next).toBe(1_023_470n);
    expect(next * 980_000n / 1_000_000n).toBeGreaterThanOrEqual(1_000_000n);
    expect(resizeForTarget(5n, 0n, 10n)).toBe(10n);
  });

  it("judges a quote short, fine or overpaying", () => {
    expect(sizingVerdict(999n, 1000n)).toBe("short");
    expect(sizingVerdict(1000n, 1000n)).toBe("ok");
    expect(sizingVerdict(1030n, 1000n)).toBe("ok");
    expect(sizingVerdict(1031n, 1000n)).toBe("over");
  });
});

describe("receipt CSV", () => {
  it("writes one line per row in order, quoting and neutralising formulas", () => {
    const csv = receiptCsv([
      { index: 1, recipientInput: "bob.eth", address: A, chain: "base", token: "USDC", amount: "2", kind: "route", status: "filled", txHash: "0xabc", label: "=HYPERLINK(1)" },
      { index: 0, recipientInput: "x, y", chain: "base", token: "USDC", amount: "1", kind: "invalid", status: "skipped", message: 'bad "name"' },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("row,label,recipient,address,chain,token,amount,kind,status,tx_hash,destination_tx_hash,message");
    expect(lines[1]).toBe('1,,"x, y",,base,USDC,1,invalid,skipped,,,"bad ""name"""');
    expect(lines[2]).toBe(`2,'=HYPERLINK(1),bob.eth,${A},base,USDC,2,route,filled,0xabc,,`);
    expect(csvCell("-1")).toBe("'-1");
  });
});
