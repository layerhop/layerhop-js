import { describe, expect, it } from "vitest";
import {
  HOME_CHAIN_OF_SYMBOL, buildShareTradesMessage, parseCommandAmount, parseSwapCommand, resolveSwapChain, swapCommandQuery, swapCommandSummary,
  type SwapCommand, type SwapCommandResult,
} from "./social.js";

const ok = (r: SwapCommandResult): SwapCommand => {
  if (!r.ok) throw new Error(`expected a command, got ${r.reason}: ${r.message}`);
  return r.command;
};
const clarifies = (r: SwapCommandResult, re?: RegExp) => {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.reason).toBe("clarify");
  if (re) expect(r.message).toMatch(re);
};
const silent = (r: SwapCommandResult) => {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("not_a_command");
};

describe("parseCommandAmount", () => {
  it.each([
    ["10", "10", false], ["0.5", "0.5", false], [".5", "0.5", false], ["1,000", "1000", false], ["1,000.25", "1000.25", false],
    ["2.5k", "2500", false], ["1k", "1000", false], ["1.5M", "1500000", false], ["$10", "10", true], ["10$", "10", true],
    ["$2.5k", "2500", true], ["007", "7", false], ["10.50", "10.5", false], ["0.000001", "0.000001", false],
  ])("%s → %s (usd %s)", (w, value, usd) => {
    expect(parseCommandAmount(w)).toEqual({ value, usd });
  });

  it.each(["", "abc", "1,00", "1.2.3", "$", "$10$", "1e5", "-5", "10x", "0.1234567890123456789"])("rejects %j", (w) => {
    expect(parseCommandAmount(w)).toBeUndefined();
  });
});

describe("resolveSwapChain", () => {
  it.each([
    ["base", "base"], ["Base", "base"], ["eth", "ethereum"], ["mainnet", "ethereum"], ["arb", "arbitrum"], ["op", "optimism"],
    ["bnb", "bsc"], ["BNB Chain", "bsc"], ["matic", "polygon"], ["sol", "solana"], ["solana", "solana"], ["8453", "base"], ["avax", "avalanche"],
  ])("%s → %s", (w, slug) => {
    expect(resolveSwapChain(w)?.slug).toBe(slug);
  });

  it("returns undefined for unknown names", () => {
    expect(resolveSwapChain("bsae")).toBeUndefined();
    expect(resolveSwapChain("")).toBeUndefined();
  });
});

describe("HOME_CHAIN_OF_SYMBOL", () => {
  it("maps single-chain native coins to their chain, never ETH or stablecoins", () => {
    expect(HOME_CHAIN_OF_SYMBOL.get("SOL")).toBe("solana");
    expect(HOME_CHAIN_OF_SYMBOL.get("BNB")).toBe("bsc");
    expect(HOME_CHAIN_OF_SYMBOL.get("POL")).toBe("polygon");
    expect(HOME_CHAIN_OF_SYMBOL.get("AVAX")).toBe("avalanche");
    expect(HOME_CHAIN_OF_SYMBOL.has("ETH")).toBe(false);
    expect(HOME_CHAIN_OF_SYMBOL.has("USDC")).toBe(false);
    expect(HOME_CHAIN_OF_SYMBOL.has("S")).toBe(false);
  });
});

describe("parseSwapCommand: the basic forms", () => {
  it("the Farcaster example: @layerhop swap 10 USDC to SOL", () => {
    expect(ok(parseSwapCommand("@layerhop swap 10 USDC to SOL"))).toEqual({
      amount: "10", srcToken: "USDC", srcChain: "base", srcChainAssumed: true, dstToken: "SOL", dstChain: "solana",
    });
  });

  it("names both chains", () => {
    expect(ok(parseSwapCommand("swap 100 USDC on Arbitrum to USDT on Polygon"))).toMatchObject({
      amount: "100", srcToken: "USDC", srcChain: "arbitrum", srcChainAssumed: false, dstToken: "USDT", dstChain: "polygon",
    });
  });

  it("bridge X from A to B (chain name as the destination coin)", () => {
    expect(ok(parseSwapCommand("bridge 0.1 ETH from Arbitrum to Base"))).toMatchObject({
      amount: "0.1", srcToken: "ETH", srcChain: "arbitrum", dstToken: "ETH", dstChain: "base",
    });
    expect(ok(parseSwapCommand("bridge 1 eth from base to solana"))).toMatchObject({ dstToken: "SOL", dstChain: "solana" });
  });

  it("the bot's /quote order: amount token chain to token chain", () => {
    expect(ok(parseSwapCommand("swap 100 USDC base to SOL solana"))).toMatchObject({ srcChain: "base", srcChainAssumed: false, dstToken: "SOL", dstChain: "solana" });
    expect(ok(parseSwapCommand("swap 5 usdc bnb chain to usdc arbitrum one"))).toMatchObject({ srcChain: "bsc", dstChain: "arbitrum" });
  });

  it("without a verb, an amount + token + connector is still a command", () => {
    expect(ok(parseSwapCommand("@layerhop 25 usdc → sol"))).toMatchObject({ amount: "25", srcToken: "USDC", dstToken: "SOL" });
    expect(ok(parseSwapCommand("hey @layerhop can you do 0.5 SOL -> USDC on base?"))).toMatchObject({ srcToken: "SOL", srcChain: "solana", dstToken: "USDC", dstChain: "base" });
  });

  it.each(["to", "for", "into", "->", "→", "=>"])("connector %s", (c) => {
    expect(ok(parseSwapCommand(`swap 10 USDC ${c} SOL`)).dstToken).toBe("SOL");
  });

  it.each(["swap", "bridge", "convert", "trade", "exchange", "sell", "Swap", "SWAP"])("verb %s", (v) => {
    expect(ok(parseSwapCommand(`${v} 10 USDC to SOL`)).srcToken).toBe("USDC");
  });

  it("splits glued amounts and tokens (10usdc) but never addresses or 2.5k", () => {
    expect(ok(parseSwapCommand("swap 10usdc to sol"))).toMatchObject({ amount: "10", srcToken: "USDC" });
    expect(ok(parseSwapCommand("swap 2.5k usdc to sol"))).toMatchObject({ amount: "2500" });
  });

  it("ignores mentions, links, punctuation and trailing words", () => {
    expect(ok(parseSwapCommand("@layerhop @alice swap 10 USDC to SOL please! https://x.com/foo"))).toMatchObject({ amount: "10", dstToken: "SOL" });
    expect(ok(parseSwapCommand("swap 10 USDC to SOL."))).toMatchObject({ dstToken: "SOL" });
    expect(ok(parseSwapCommand('"swap 10 USDC to SOL" thanks'))).toMatchObject({ dstToken: "SOL" });
  });

  it("is case-insensitive and normalises symbols to upper case", () => {
    expect(ok(parseSwapCommand("SWAP 10 usdc ON BASE TO sol"))).toMatchObject({ srcToken: "USDC", srcChain: "base", dstToken: "SOL" });
  });
});

describe("parseSwapCommand: amounts", () => {
  it("dollars with a stablecoin or a bare $ (paid in USDC)", () => {
    expect(ok(parseSwapCommand("swap $10 USDC to SOL"))).toMatchObject({ amount: "10", srcToken: "USDC" });
    expect(ok(parseSwapCommand("swap $20 to SOL"))).toMatchObject({ amount: "20", srcToken: "USDC" });
  });

  it("asks for a token amount when $ is used with a volatile coin", () => {
    clarifies(parseSwapCommand("swap $10 ETH to SOL"), /amount in ETH/);
  });

  it("never guesses max/all/half", () => {
    clarifies(parseSwapCommand("swap max USDC to SOL"), /how much/i);
    clarifies(parseSwapCommand("swap all my ETH to SOL"), /how much/i);
  });

  it("asks for an amount when the verb has none", () => {
    clarifies(parseSwapCommand("swap USDC to SOL"), /how much/i);
  });

  it("rejects zero", () => {
    clarifies(parseSwapCommand("swap 0 USDC to SOL"), /more than 0/);
    clarifies(parseSwapCommand("swap 0.000 USDC to SOL"), /more than 0/);
  });

  it("thousands separators and suffixes", () => {
    expect(ok(parseSwapCommand("swap 1,500.5 USDC to SOL")).amount).toBe("1500.5");
    expect(ok(parseSwapCommand("swap 1m USDC to SOL")).amount).toBe("1000000");
  });
});

describe("parseSwapCommand: token and chain synonyms", () => {
  it.each([
    ["usd", "USDC"], ["dollars", "USDC"], ["tether", "USDT"], ["ether", "ETH"], ["matic", "POL"], ["wsol", "SOL"],
  ])("token %s → %s", (w, sym) => {
    expect(ok(parseSwapCommand(`swap 10 ${w} on ethereum to USDC on base`)).srcToken).toBe(sym === "POL" ? "POL" : sym);
  });

  it("coins with one home chain name their chain (SOL, BNB, POL, AVAX)", () => {
    expect(ok(parseSwapCommand("swap 1 BNB to SOL"))).toMatchObject({ srcChain: "bsc", srcChainAssumed: false, dstChain: "solana" });
    expect(ok(parseSwapCommand("swap 10 POL to AVAX"))).toMatchObject({ srcChain: "polygon", dstChain: "avalanche" });
    expect(ok(parseSwapCommand("swap 10 matic to usdc on base"))).toMatchObject({ srcToken: "POL", srcChain: "polygon" });
  });

  it("a named chain beats the home chain (wrapped SOL elsewhere)", () => {
    expect(ok(parseSwapCommand("swap 10 USDC to SOL on bsc"))).toMatchObject({ dstToken: "SOL", dstChain: "bsc" });
  });

  it.each([
    ["on arb", "arbitrum"], ["on op", "optimism"], ["on eth", "ethereum"], ["on mainnet", "ethereum"], ["on bnb", "bsc"],
    ["on poly", "polygon"], ["on 8453", "base"], ["@ base", "base"], ["from arbitrum one", "arbitrum"],
  ])("source chain %s → %s", (phrase, slug) => {
    expect(ok(parseSwapCommand(`swap 10 USDC ${phrase} to SOL`)).srcChain).toBe(slug);
  });

  it("a chain alias that is also a token stays a token on the destination (to arb = ARB)", () => {
    expect(ok(parseSwapCommand("swap 10 USDC on arbitrum to arb"))).toMatchObject({ dstToken: "ARB", dstChain: "arbitrum" });
  });

  it("$-prefixed tickers ($SOL, $DEGEN)", () => {
    expect(ok(parseSwapCommand("swap 10 USDC to $SOL"))).toMatchObject({ dstToken: "SOL" });
    expect(ok(parseSwapCommand("swap 10 USDC on base to $DEGEN"))).toMatchObject({ dstToken: "DEGEN", dstChain: "base" });
  });
});

describe("parseSwapCommand: chain inference and ambiguity", () => {
  it("a missing destination chain is the source chain when that is named or implied", () => {
    expect(ok(parseSwapCommand("swap 10 USDC on base to ETH"))).toMatchObject({ srcChain: "base", dstChain: "base", dstToken: "ETH" });
    expect(ok(parseSwapCommand("swap 10 SOL to USDC"))).toMatchObject({ srcChain: "solana", dstChain: "solana" });
  });

  it("a chain named only on the destination is the source chain too", () => {
    expect(ok(parseSwapCommand("swap 0.1 ETH to USDC on Base"))).toMatchObject({ srcChain: "base", srcChainAssumed: false, dstChain: "base" });
  });

  it("asks which chain when the destination is ambiguous (ETH, USDC) and no chain was named", () => {
    clarifies(parseSwapCommand("swap 10 USDC to ETH"), /Which chain should ETH arrive on/);
    clarifies(parseSwapCommand("swap 10 USDT to USDC"), /Which chain should USDC arrive on/);
  });

  it("a missing source chain uses defaultSrcChain and flags it", () => {
    expect(ok(parseSwapCommand("swap 10 USDC to SOL", { defaultSrcChain: "arbitrum" }))).toMatchObject({ srcChain: "arbitrum", srcChainAssumed: true });
  });

  it("asks for a different token when both sides are the same", () => {
    clarifies(parseSwapCommand("swap 10 USDC on base to USDC on base"), /same token/);
    clarifies(parseSwapCommand("swap 10 SOL to SOL"), /same token/);
  });

  it("the same token across chains is a bridge, not an error", () => {
    expect(ok(parseSwapCommand("bridge 10 USDC from base to usdc on arbitrum"))).toMatchObject({ srcChain: "base", dstChain: "arbitrum" });
  });

  it("unknown chains after on/from are reported, not ignored", () => {
    clarifies(parseSwapCommand("swap 10 USDC on bsae to SOL"), /chain "bsae"/);
    clarifies(parseSwapCommand("swap 10 USDC to SOL on solanna"), /chain "solanna"/);
  });

  it("destination-only chains can't be the source", () => {
    clarifies(parseSwapCommand("swap 10 USDC on hyperliquid to SOL"), /only be a destination/);
  });

  it("asks what to swap to when the connector is missing", () => {
    clarifies(parseSwapCommand("swap 10 USDC"), /What should I swap 10 USDC to/);
    clarifies(parseSwapCommand("swap 10 USDC to"), /arrive as/);
  });

  it("asks when the verb has nothing after it", () => {
    clarifies(parseSwapCommand("@layerhop swap"), /What should I swap/);
  });
});

describe("parseSwapCommand: addresses", () => {
  const BASE_DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
  const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

  it("an EVM token address needs a chain", () => {
    clarifies(parseSwapCommand(`swap 10 USDC on base to ${BASE_DEGEN}`) as SwapCommandResult, undefined);
    expect(ok(parseSwapCommand(`swap 10 USDC to ${BASE_DEGEN} on base`))).toMatchObject({ dstToken: BASE_DEGEN, dstChain: "base" });
    clarifies(parseSwapCommand(`swap 10 USDC to ${BASE_DEGEN}`), /Which chain/);
  });

  it("a Solana mint implies Solana", () => {
    expect(ok(parseSwapCommand(`swap 10 USDC to ${BONK}`))).toMatchObject({ dstToken: BONK, dstChain: "solana" });
  });

  it("an address of the wrong chain family is refused", () => {
    clarifies(parseSwapCommand(`swap 10 USDC to ${BONK} on base`), /Solana address/);
    clarifies(parseSwapCommand(`swap 10 USDC to ${BASE_DEGEN} on solana`), /isn't a Solana token address/);
  });
});

describe("parseSwapCommand: buy", () => {
  it("buy $10 of SOL / buy $10 SOL", () => {
    expect(ok(parseSwapCommand("@layerhop buy $10 of SOL"))).toMatchObject({ amount: "10", srcToken: "USDC", dstToken: "SOL", dstChain: "solana" });
    expect(ok(parseSwapCommand("buy $10 SOL"))).toMatchObject({ amount: "10", srcToken: "USDC", dstToken: "SOL" });
  });

  it("buy 10 USDC of SOL", () => {
    expect(ok(parseSwapCommand("buy 10 USDC on arbitrum of SOL"))).toMatchObject({ srcChain: "arbitrum", srcToken: "USDC", dstToken: "SOL" });
  });

  it("buy SOL with 10 USDC [on chain]", () => {
    expect(ok(parseSwapCommand("buy SOL with 10 USDC on base"))).toMatchObject({ amount: "10", srcToken: "USDC", srcChain: "base", dstToken: "SOL" });
    expect(ok(parseSwapCommand("buy DEGEN on base with $5"))).toMatchObject({ amount: "5", srcToken: "USDC", srcChain: "base", dstToken: "DEGEN", dstChain: "base" });
  });

  it("asks when the buy is ambiguous", () => {
    clarifies(parseSwapCommand("buy 10 SOL"), /pay with/);
    clarifies(parseSwapCommand("buy SOL"), /How much/);
    clarifies(parseSwapCommand("buy SOL with lots of USDC"), /how much/i);
    clarifies(parseSwapCommand("buy SOL with 10"), /pay with/);
  });
});

describe("parseSwapCommand: not a command", () => {
  it.each([
    "", "gm @layerhop", "@layerhop what chains do you support?", "love this app", "I sent 10 USDC to my friend",
    "send 10 USDC to 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", "10 USDC",
  ])("%j stays silent", (t) => {
    silent(parseSwapCommand(t));
  });

  it("cuts very long texts instead of rejecting them", () => {
    expect(ok(parseSwapCommand(`swap 10 USDC to SOL ${"x ".repeat(1000)}`)).dstToken).toBe("SOL");
  });

  it("never throws on odd input", () => {
    for (const t of ["→→→", "$$$", "swap $ to $", "swap 10 → → SOL", "buy with with", "swap 1 2 3 to 4", "🚀🚀 swap 10 🚀 to 🚀", "swap 10 USDC to SOL on"]) {
      expect(() => parseSwapCommand(t)).not.toThrow();
    }
  });
});

describe("swapCommandQuery / swapCommandSummary", () => {
  it("builds the deep-link query and a one-line summary", () => {
    const c = ok(parseSwapCommand("swap 10 USDC on base to SOL"));
    expect(swapCommandQuery(c)).toEqual({ srcChain: "base", srcToken: "USDC", dstChain: "solana", dstToken: "SOL", amount: "10" });
    expect(swapCommandSummary(c)).toBe("10 USDC on Base → SOL on Solana");
  });

  it("shortens addresses in the summary", () => {
    const c = ok(parseSwapCommand("swap 10 USDC to DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"));
    expect(swapCommandSummary(c)).toContain("DezXAZ…B263");
  });
});

describe("buildShareTradesMessage", () => {
  const f = { vm: "evm" as const, wallet: "0xabc0000000000000000000000000000000000001", enabled: true, issuedAt: "2026-10-29T10:00:00.000Z" };

  it("covers the wallet, the choice and the time", () => {
    const m = buildShareTradesMessage(f);
    expect(m).toContain("Wallet: 0xabc0000000000000000000000000000000000001");
    expect(m).toContain("Share trades: yes");
    expect(m).toContain("Issued At: 2026-10-29T10:00:00.000Z");
    expect(m).toMatch(/does not move funds/);
  });

  it("an opt-out is a different message (a signature can't be reused for the other choice)", () => {
    expect(buildShareTradesMessage({ ...f, enabled: false })).not.toBe(buildShareTradesMessage(f));
    expect(buildShareTradesMessage({ ...f, enabled: false })).toContain("Share trades: no");
  });
});
