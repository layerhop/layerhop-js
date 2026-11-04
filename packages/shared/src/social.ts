/**
 * Social features shared by the API, the reply bots and the web app:
 *
 * - `parseSwapCommand`: "@layerhop swap 10 USDC to SOL" (Farcaster casts, X posts) → a prefilled swap
 *   link. The bots only ever reply with a link; the user reviews and signs in their own wallet.
 * - `buildShareTradesMessage`: the plain-text message a wallet signs to opt in to (or out of) the
 *   public trade feed, in the same pattern as the community reports (safety.ts).
 * - Ecosystem ("Built on LayerHop") categories and limits.
 */
import { CHAINS, getAnyChain, isDestinationOnly } from "./chains.js";
import type { ChainInfo } from "./assets.js";
import type { WalletVm } from "./types.js";

// ---- swap command parser -------------------------------------------------------------------------

/** A parsed swap request. Tokens are symbols (upper case) or addresses; chains are registry slugs. */
export interface SwapCommand {
  /** Human units, "." separator, no grouping ("1000", "0.5"). */
  amount: string;
  srcToken: string;
  srcChain: string;
  /** The source chain wasn't named; `defaultSrcChain` was used (the reply says so). */
  srcChainAssumed: boolean;
  dstToken: string;
  dstChain: string;
}

export type SwapCommandResult =
  | { ok: true; command: SwapCommand }
  /** `not_a_command`: no swap request in the text (bots stay silent). `clarify`: reply with `message`. */
  | { ok: false; reason: "not_a_command" | "clarify"; message: string };

export interface SwapCommandOptions {
  /** Source chain when the text names none and the token has no home chain (default `base`). */
  defaultSrcChain?: string;
}

/** Longest text the parser looks at (a long cast or post is cut, never rejected). */
export const SWAP_COMMAND_MAX_CHARS = 400;

export const SWAP_COMMAND_EXAMPLE = "swap 10 USDC on Base to SOL";

const USAGE = `Try: "${SWAP_COMMAND_EXAMPLE}" or "bridge 0.1 ETH from Arbitrum to Base".`;

/** Extra names people type for a chain (matched case-insensitively, as well as the slug, name and id). */
export const SWAP_CHAIN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ethereum: ["eth", "mainnet", "ether", "erc20", "l1"],
  arbitrum: ["arb", "arbitrum one", "arb1"],
  base: [],
  optimism: ["op", "opt", "op mainnet"],
  bsc: ["bnb", "bnb chain", "bnbchain", "binance", "bep20", "bnb smart chain"],
  polygon: ["matic", "pol", "poly"],
  solana: ["sol", "spl"],
  avalanche: ["avax", "avalanche c-chain", "c-chain"],
  hyperevm: ["hype", "hyperliquid evm"],
  berachain: ["bera"],
  "zksync": ["zksync era", "zk"],
  "world-chain": ["world", "worldchain"],
};

/** Token words people type → the symbol the app resolves. */
const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  usd: "USDC", dollar: "USDC", dollars: "USDC", bucks: "USDC", usdc: "USDC",
  tether: "USDT", usdt: "USDT",
  ether: "ETH", eth: "ETH", weth: "WETH",
  sol: "SOL", wsol: "SOL", solana: "SOL",
  matic: "POL", pol: "POL",
  bnb: "BNB", avax: "AVAX", hype: "HYPE",
};

/** Stablecoins a "$10" amount may be paid in. */
const USD_STABLES = new Set(["USDC", "USDT", "DAI", "USDC.E", "USDT0", "USDE"]);

/** "send" and "move" are left out on purpose: "send 10 USDC to 0x…" names a recipient, not a token. */
const VERBS = new Set(["swap", "bridge", "convert", "trade", "exchange", "change", "sell", "buy", "get"]);
const TO_WORDS = new Set(["to", "for", "into", "in2", "->", "→", "=>", "⇒", "➡", "➡️"]);
const CHAIN_PREPS = new Set(["on", "from", "via", "@"]);
const DST_CHAIN_PREPS = new Set(["on", "in", "at", "@"]);

const chainIndex = new Map<string, ChainInfo>();
for (const c of CHAINS) {
  if (isDestinationOnly(c.id) && c.slug !== "hyperliquid") continue;
  chainIndex.set(c.slug, c);
  chainIndex.set(c.name.toLowerCase(), c);
  for (const a of SWAP_CHAIN_ALIASES[c.slug] ?? []) chainIndex.set(a, c);
}

/** A chain from a slug, name, numeric id or alias (case-insensitive). */
export function resolveSwapChain(word: string): ChainInfo | undefined {
  const q = word.trim().toLowerCase();
  if (!q) return undefined;
  return chainIndex.get(q) ?? (/^\d+$/.test(q) ? getAnyChain(Number(q)) : undefined);
}

/**
 * Native coins that exist on exactly one chain (SOL, BNB, POL, AVAX, …): naming the coin names the
 * chain. ETH is on dozens of chains, so it never does. One-letter symbols and stablecoin-native chains
 * are left out.
 */
export const HOME_CHAIN_OF_SYMBOL: ReadonlyMap<string, string> = (() => {
  const count = new Map<string, ChainInfo[]>();
  for (const c of CHAINS) {
    if (c.destinationOnly) continue;
    const s = c.nativeSymbol.toUpperCase();
    count.set(s, [...(count.get(s) ?? []), c]);
  }
  const out = new Map<string, string>();
  for (const [s, cs] of count) {
    if (cs.length === 1 && s.length >= 2 && !/USD/.test(s)) out.set(s, cs[0]!.slug);
  }
  return out;
})();

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL = /^\$?[A-Za-z][A-Za-z0-9.]{0,11}$/;
const AMOUNT = /^\$?(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?([km])?\$?$/i;

interface Amount {
  value: string;
  usd: boolean;
}

/** "10", "0.5", ".5", "1,000", "2.5k", "$10", "10$" → a plain decimal string; undefined when not an amount. */
export function parseCommandAmount(word: string): Amount | undefined {
  const w = word.trim();
  const m = AMOUNT.exec(w);
  if (!m || (!m[1] && !m[2]) || (w.startsWith("$") && w.endsWith("$") && w.length > 1)) return undefined;
  const usd = w.startsWith("$") || w.endsWith("$");
  const int = (m[1] ?? "0").replace(/,/g, "");
  const frac = (m[2] ?? "").slice(1);
  if (frac.length > 18) return undefined;
  const mult = m[3]?.toLowerCase() === "k" ? 3 : m[3]?.toLowerCase() === "m" ? 6 : 0;
  // Shift the decimal point by the suffix without floats.
  const digits = int + frac.padEnd(Math.max(frac.length, mult), "0");
  const point = int.length + mult;
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const rest = digits.slice(point).replace(/0+$/, "");
  const value = rest ? `${whole}.${rest}` : whole;
  return { value, usd };
}

interface TokenRef {
  /** Symbol (upper case) or address. */
  token: string;
  /** Chain implied by the token itself (a Solana mint, a home-chain coin, a chain name used as a coin). */
  impliedChain?: string;
  isAddress: boolean;
  /** The word was a chain name used as its coin ("to solana"). */
  fromChainWord?: boolean;
}

function tokenRef(word: string): TokenRef | undefined {
  const w = word.trim().replace(/^\$(?=[A-Za-z])/, "");
  if (EVM_ADDRESS.test(w)) return { token: w, isAddress: true };
  if (SOL_ADDRESS.test(w) && /\d/.test(w) && w.length >= 32) return { token: w, isAddress: true, impliedChain: "solana" };
  if (!SYMBOL.test(w)) return undefined;
  const lower = w.toLowerCase();
  const alias = TOKEN_ALIASES[lower];
  const symbol = alias ?? w.toUpperCase();
  const home = HOME_CHAIN_OF_SYMBOL.get(symbol);
  return { token: symbol, isAddress: false, ...(home ? { impliedChain: home } : {}) };
}

/** "10usdc" → ["10", "usdc"] (never an address or a mint, never "2.5k"). */
function splitGlued(w: string): string[] {
  const m = /^(\$?[\d.,]+)([A-Za-z][A-Za-z0-9.]{0,11})$/.exec(w);
  if (!m || w.startsWith("0x") || /^[km]$/i.test(m[2]!)) return [w];
  return [m[1]!, m[2]!];
}

/** Text → words: mentions, URLs and punctuation dropped; arrows split off; "10usdc" split. */
function words(text: string): string[] {
  return text
    .slice(0, SWAP_COMMAND_MAX_CHARS)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(^|\s)@[\w.-]+/g, " ")
    .replace(/\s*(→|->|=>|⇒|➡️?)\s*/g, " → ")
    .replace(/[!?;:"“”'‘’()[\]{}]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[,.]+$/, ""))
    .filter(Boolean)
    .flatMap(splitGlued);
}

const clarify = (message: string): SwapCommandResult => ({ ok: false, reason: "clarify", message });
const none: SwapCommandResult = { ok: false, reason: "not_a_command", message: USAGE };

/** Reads `<token> [on|from <chain> | <chain>]` at `i`; returns the next index. */
function readSide(ws: string[], i: number, preps: ReadonlySet<string>): { ref?: TokenRef; tokenWord?: string; chain?: ChainInfo; chainWord?: string; badChain?: string; next: number } {
  const tokenWord = ws[i];
  if (tokenWord === undefined) return { next: i };
  let ref = tokenRef(tokenWord);
  let j = i + 1;
  // A chain name used as the coin: "to solana", "to base" (= ETH on Base).
  const asChain = resolveSwapChain(tokenWord);
  let chain: ChainInfo | undefined;
  let chainWord: string | undefined;
  const next = ws[j]?.toLowerCase();
  if (next !== undefined && preps.has(next)) {
    // "on bnb chain", "on arbitrum one": try two words, then one.
    const two = ws[j + 1] && ws[j + 2] ? resolveSwapChain(`${ws[j + 1]} ${ws[j + 2]}`) : undefined;
    const one = ws[j + 1] ? resolveSwapChain(ws[j + 1]!) : undefined;
    if (two) return { ref, tokenWord, chain: two, chainWord: `${ws[j + 1]} ${ws[j + 2]}`, next: j + 3 };
    if (one) return { ref, tokenWord, chain: one, chainWord: ws[j + 1], next: j + 2 };
    return { ref, tokenWord, badChain: ws[j + 1] ?? "", next: j + 2 };
  }
  if (next !== undefined && !TO_WORDS.has(next) && next !== "with" && next !== "of") {
    const two = ws[j + 1] ? resolveSwapChain(`${ws[j]} ${ws[j + 1]}`) : undefined;
    const one = resolveSwapChain(ws[j]!);
    if (two) {
      chain = two;
      chainWord = `${ws[j]} ${ws[j + 1]}`;
      j += 2;
    } else if (one) {
      chain = one;
      chainWord = ws[j];
      j += 1;
    }
  }
  // Only the slug or full name ("solana", "base"), never an alias that is also a token ("arb", "op").
  const fullName = !!asChain && (tokenWord.toLowerCase() === asChain.slug || tokenWord.toLowerCase() === asChain.name.toLowerCase());
  if (asChain && fullName && !chain && (!ref || !HOME_CHAIN_OF_SYMBOL.has(ref.token)) && !TOKEN_ALIASES[tokenWord.toLowerCase()]) {
    ref = { token: asChain.nativeSymbol.toUpperCase(), isAddress: false, impliedChain: asChain.slug, fromChainWord: true };
  }
  return { ref, tokenWord, chain, chainWord, next: j };
}

function chainName(slug: string): string {
  return getAnyChain(slug)?.name ?? slug;
}

/**
 * Parses a swap request from free text. Understood:
 *
 * - `[swap|bridge|convert|sell] <amount> <token> [on|from <chain>] to|for|into|→ <token> [on <chain>]`
 * - `buy <token> [on <chain>] with <amount> <token> [on <chain>]`, `buy $<amount> [of] <token> [on <chain>]`
 * - amounts `10`, `0.5`, `1,000`, `2.5k`, `$10` (dollars: only with a stablecoin); tokens by symbol
 *   (aliases such as `usd`, `ether`, `matic`) or address; chains by slug, name, id or alias (`arb`, `op`,
 *   `bnb`, `eth`, `sol`); a chain name as the destination coin (`to solana`).
 *
 * A coin that lives on one chain (SOL, BNB, POL, AVAX, …) names its chain. A missing source chain is
 * `defaultSrcChain` (flagged `srcChainAssumed`). A missing destination chain is the source chain when
 * that was named, else the reply asks which chain. Never guesses an amount.
 */
export function parseSwapCommand(text: string, opts: SwapCommandOptions = {}): SwapCommandResult {
  const ws = words(text ?? "");
  if (!ws.length) return none;
  // Find where the command starts: a verb, or an amount followed by a token.
  let start = ws.findIndex((w) => VERBS.has(w.toLowerCase()));
  const verb = start >= 0 ? ws[start]!.toLowerCase() : undefined;
  if (start < 0) {
    // No verb: only a complete, unambiguous request counts ("25 USDC → SOL"); anything else is chat
    // ("I sent 10 USDC to my friend") and gets no reply.
    start = ws.findIndex((w, k) => parseCommandAmount(w) !== undefined && ws[k + 1] !== undefined && tokenRef(ws[k + 1]!) !== undefined && ws.slice(k + 2).some((x) => TO_WORDS.has(x.toLowerCase())));
    if (start < 0 || ws.slice(0, start).some((w) => SEND_WORDS.has(w.toLowerCase()))) return none;
    const r = parseRest(ws.slice(start), undefined, opts);
    return r.ok ? r : none;
  }
  return parseRest(ws.slice(start + 1), verb, opts);
}

/** "send 10 USDC to …", "I sent 10 USDC to …": a transfer to someone, never a swap. */
const SEND_WORDS = new Set(["send", "sent", "sending", "transfer", "transferred", "pay", "paid", "move", "moved"]);

function parseRest(rest: string[], verb: string | undefined, opts: SwapCommandOptions): SwapCommandResult {
  if (!rest.length) return clarify(`What should I swap? ${USAGE}`);

  if (verb === "buy" || verb === "get") return parseBuy(rest, opts);

  // <amount> <token> …
  const amt = parseCommandAmount(rest[0]!);
  if (!amt) {
    if (/^(max|all|everything|half)$/i.test(rest[0]!)) return clarify(`Say how much to swap as a number. ${USAGE}`);
    if (verb) return clarify(`Say how much to swap, e.g. "${verb} 10 USDC to SOL".`);
    return none;
  }
  // "$10 to SOL": dollars paid in USDC.
  let i = 1;
  let srcSide: ReturnType<typeof readSide>;
  if (amt.usd && rest[1] !== undefined && TO_WORDS.has(rest[1].toLowerCase())) {
    srcSide = { ref: { token: "USDC", isAddress: false }, tokenWord: "USDC", next: 1 };
  } else {
    srcSide = readSide(rest, i, CHAIN_PREPS);
  }
  if (!srcSide.ref) return clarify(rest[i] ? `I don't recognise the token "${rest[i]!.slice(0, 44)}". ${USAGE}` : `Which token should I swap? ${USAGE}`);
  if (srcSide.badChain !== undefined) return clarify(`I don't know the chain "${srcSide.badChain.slice(0, 40)}". ${USAGE}`);
  i = srcSide.next;
  const conn = rest[i]?.toLowerCase();
  if (conn === undefined || !TO_WORDS.has(conn)) return clarify(`What should I swap ${amt.usd ? "$" : ""}${amt.value} ${srcSide.ref.token} to? ${USAGE}`);
  const dstSide = readSide(rest, i + 1, DST_CHAIN_PREPS);
  if (!dstSide.ref) return clarify(rest[i + 1] ? `I don't recognise the token "${rest[i + 1]!.slice(0, 44)}". ${USAGE}` : `Which token should it arrive as? ${USAGE}`);
  if (dstSide.badChain !== undefined) return clarify(`I don't know the chain "${dstSide.badChain.slice(0, 40)}". ${USAGE}`);
  return finish(amt, srcSide.ref, srcSide.chain, dstSide.ref, dstSide.chain, opts);
}

/** `buy <token> [on chain] with <amount> <token> [on chain]` / `buy $10 [of] <token> [on chain]` / `buy 10 USDC of SOL`. */
function parseBuy(rest: string[], opts: SwapCommandOptions): SwapCommandResult {
  const amt = parseCommandAmount(rest[0]!);
  if (amt) {
    // buy $10 [of] SOL · buy 10 USDC of SOL · buy 10 USDC on base of SOL
    let i = 1;
    let src: ReturnType<typeof readSide> = { ref: { token: "USDC", isAddress: false }, next: 1 };
    if (!amt.usd && rest[1] && rest[1].toLowerCase() !== "of") {
      src = readSide(rest, 1, CHAIN_PREPS);
      if (!src.ref) return clarify(`I don't recognise the token "${rest[1].slice(0, 44)}". ${USAGE}`);
      if (src.badChain !== undefined) return clarify(`I don't know the chain "${src.badChain.slice(0, 40)}". ${USAGE}`);
      i = src.next;
      if (rest[i]?.toLowerCase() !== "of") return clarify(`Say what to pay with: "buy ${src.ref.token} with 10 USDC" or "buy $10 of ${src.ref.token}".`);
    } else if (!amt.usd) {
      return clarify(`Which token should I buy, and with what? Try "buy $10 of SOL".`);
    }
    if (rest[i]?.toLowerCase() === "of") i += 1;
    const dst = readSide(rest, i, DST_CHAIN_PREPS);
    if (!dst.ref) return clarify(`Which token should I buy? Try "buy $10 of SOL".`);
    if (dst.badChain !== undefined) return clarify(`I don't know the chain "${dst.badChain.slice(0, 40)}". ${USAGE}`);
    return finish(amt, src.ref!, src.chain, dst.ref, dst.chain, opts);
  }
  // buy SOL with 10 USDC
  const dst = readSide(rest, 0, DST_CHAIN_PREPS);
  if (!dst.ref) return clarify(`Which token should I buy? Try "buy SOL with 10 USDC".`);
  if (dst.badChain !== undefined) return clarify(`I don't know the chain "${dst.badChain.slice(0, 40)}". ${USAGE}`);
  if (rest[dst.next]?.toLowerCase() !== "with") return clarify(`How much should I spend on ${dst.ref.token}? Try "buy ${dst.ref.token} with 10 USDC".`);
  const a = rest[dst.next + 1] ? parseCommandAmount(rest[dst.next + 1]!) : undefined;
  if (!a) return clarify(`Say how much to spend as a number, e.g. "buy ${dst.ref.token} with 10 USDC".`);
  let src: ReturnType<typeof readSide>;
  if (rest[dst.next + 2] !== undefined) {
    src = readSide(rest, dst.next + 2, CHAIN_PREPS);
    if (!src.ref) return clarify(`I don't recognise the token "${rest[dst.next + 2]!.slice(0, 44)}". ${USAGE}`);
    if (src.badChain !== undefined) return clarify(`I don't know the chain "${src.badChain.slice(0, 40)}". ${USAGE}`);
  } else if (a.usd) {
    src = { ref: { token: "USDC", isAddress: false }, next: dst.next + 2 };
  } else {
    return clarify(`Which token should I pay with? Try "buy ${dst.ref.token} with 10 USDC".`);
  }
  return finish(a, src.ref!, src.chain, dst.ref, dst.chain, opts);
}

function finish(amt: Amount, src: TokenRef, srcChainIn: ChainInfo | undefined, dst: TokenRef, dstChainIn: ChainInfo | undefined, opts: SwapCommandOptions): SwapCommandResult {
  if (amt.usd && !USD_STABLES.has(src.token.toUpperCase())) {
    return clarify(`Say the amount in ${src.token}, or pay in USDC: "$${amt.value} USDC to ${dst.token}".`);
  }
  if (!/[1-9]/.test(amt.value)) return clarify("The amount must be more than 0.");
  if (src.isAddress && !srcChainIn && !src.impliedChain) return clarify(`Which chain is ${short(src.token)} on? Add "on <chain>", e.g. "on Base".`);
  if (dst.isAddress && !dstChainIn && !dst.impliedChain) return clarify(`Which chain is ${short(dst.token)} on? Add "on <chain>" after it.`);

  // A named chain beats one implied by the coin ("SOL on BNB Chain" is wrapped SOL there).
  let srcChain = srcChainIn?.slug ?? src.impliedChain;
  let srcChainAssumed = false;
  let dstChain = dstChainIn?.slug ?? dst.impliedChain;
  if (src.impliedChain && srcChainIn && src.isAddress && src.impliedChain !== srcChainIn.slug) return clarify(`${short(src.token)} is a Solana address, not a ${srcChainIn.name} one.`);
  if (dst.impliedChain && dstChainIn && dst.isAddress && dst.impliedChain !== dstChainIn.slug) return clarify(`${short(dst.token)} is a Solana address, not a ${dstChainIn.name} one.`);
  if (!dstChain) {
    // "swap 10 SOL to USDC", "swap 10 USDC on Base to ETH": same chain as the (named or implied) source.
    if (srcChain) dstChain = srcChain;
    else return clarify(`Which chain should ${dst.token} arrive on? Add "on <chain>", e.g. "to ${dst.token} on Base".`);
  }
  // "swap 10 ETH to USDC on Base": a chain named only on the destination is the source chain too.
  if (!srcChain && dstChainIn) srcChain = dstChainIn.slug;
  if (!srcChain) {
    const fallback = resolveSwapChain(opts.defaultSrcChain ?? "base");
    if (!fallback) return clarify(`Which chain should the ${src.token} come from? Add "on <chain>".`);
    srcChain = fallback.slug;
    srcChainAssumed = true;
  }
  const sc = getAnyChain(srcChain)!;
  const dc = getAnyChain(dstChain)!;
  if (isDestinationOnly(sc.id)) return clarify(`${sc.name} can only be a destination.`);
  if (sc.id === dc.id && src.token.toLowerCase() === dst.token.toLowerCase()) return clarify(`That's the same token on the same chain. Name a different token or chain to swap ${src.token} to.`);
  // Address tokens must match the chain family.
  if (src.isAddress && EVM_ADDRESS.test(src.token) !== (sc.vm === "evm")) return clarify(`${short(src.token)} isn't a ${sc.name} token address.`);
  if (dst.isAddress && EVM_ADDRESS.test(dst.token) !== (dc.vm === "evm")) return clarify(`${short(dst.token)} isn't a ${dc.name} token address.`);
  return {
    ok: true,
    command: { amount: amt.value, srcToken: src.token, srcChain: sc.slug, srcChainAssumed, dstToken: dst.token, dstChain: dc.slug },
  };
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Deep-link query (docs/URL_CONTRACT.md) for a parsed command: chains as slugs, amount in human units. */
export function swapCommandQuery(c: SwapCommand): { srcChain: string; srcToken: string; dstChain: string; dstToken: string; amount: string } {
  return { srcChain: c.srcChain, srcToken: c.srcToken, dstChain: c.dstChain, dstToken: c.dstToken, amount: c.amount };
}

/** "10 USDC on Base → SOL on Solana". */
export function swapCommandSummary(c: SwapCommand): string {
  const tok = (t: string) => short(t);
  return `${c.amount} ${tok(c.srcToken)} on ${chainName(c.srcChain)} → ${tok(c.dstToken)} on ${chainName(c.dstChain)}`;
}

// ---- trade feed opt-in ---------------------------------------------------------------------------

/** A signed opt-in must reach the API within this long of its `Issued At`. */
export const SHARE_TRADES_SIGNATURE_TTL_MS = 10 * 60_000;

export interface ShareTradesFields {
  vm: WalletVm;
  /** The signing wallet (EVM lowercase 0x…, Solana base58). */
  wallet: string;
  /** true = show my trades in the public feed; false = stop. */
  enabled: boolean;
  /** ISO 8601 (Date.toISOString()). */
  issuedAt: string;
}

/**
 * The exact text a wallet signs to opt in to or out of the public trade feed (EIP-191 personal_sign on
 * EVM, signMessage on Solana). Plain text, not SIWE; the API rebuilds it from the submitted fields,
 * so the wallet, the choice and the time are all covered. Signing is free and moves no funds.
 */
export function buildShareTradesMessage(f: ShareTradesFields): string {
  return [
    "LayerHop trade feed",
    "",
    f.enabled
      ? "Show my LayerHop swaps from now on, with my wallet address, in the public trade feed. Signing is free and does not move funds."
      : "Stop showing my LayerHop swaps in the public trade feed. Signing is free and does not move funds.",
    "",
    `Wallet: ${f.wallet}`,
    `Share trades: ${f.enabled ? "yes" : "no"}`,
    `Issued At: ${f.issuedAt}`,
  ].join("\n");
}

// ---- launch curation (featured / hidden launches) ------------------------------------------------

export const LAUNCH_CURATION_ACTIONS = ["feature", "unfeature", "hide", "unhide"] as const;
export type LaunchCurationAction = (typeof LAUNCH_CURATION_ACTIONS)[number];
export const LAUNCH_CURATION_SIGNATURE_TTL_MS = 10 * 60_000;

export interface LaunchCurationFields {
  vm: WalletVm;
  /** A launch admin wallet (EVM lowercase 0x…, Solana base58). */
  wallet: string;
  /** The launched token (Solana mint or EVM token address, as stored: EVM lowercase). */
  token: string;
  action: LaunchCurationAction;
  /** ISO 8601 (Date.toISOString()). */
  issuedAt: string;
}

/**
 * The exact text a launch admin wallet signs on app.layerhop.com/create/admin to feature (pin) or hide a
 * LayerHop launch. Plain text like the trade feed opt-in; the API rebuilds it from the submitted fields.
 * Featuring is promotion only: it says nothing about a token's safety.
 */
export function buildLaunchCurationMessage(f: LaunchCurationFields): string {
  return [
    "LayerHop launch admin",
    "",
    "Change how a LayerHop launch is shown in the app. Signing is free and does not move funds.",
    "",
    `Wallet: ${f.wallet}`,
    `Token: ${f.token}`,
    `Action: ${f.action}`,
    `Issued At: ${f.issuedAt}`,
  ].join("\n");
}

// ---- ecosystem ("Built on LayerHop") -------------------------------------------------------------

export const ECOSYSTEM_CATEGORIES = ["wallet", "dapp", "bot", "agent", "payments", "tooling", "analytics", "other"] as const;
export type EcosystemCategory = (typeof ECOSYSTEM_CATEGORIES)[number];

export const ECOSYSTEM_CATEGORY_LABEL: Record<EcosystemCategory, string> = {
  wallet: "Wallets",
  dapp: "Apps",
  bot: "Bots",
  agent: "AI agents",
  payments: "Payments",
  tooling: "Developer tools",
  analytics: "Analytics",
  other: "Other",
};

/** What LayerHop part a project uses. */
export const ECOSYSTEM_USES = ["api", "sdk", "widget", "checkout", "mcp", "telegram", "other"] as const;
export type EcosystemUse = (typeof ECOSYSTEM_USES)[number];

export const ECOSYSTEM_NAME_MAX = 60;
export const ECOSYSTEM_TAGLINE_MAX = 140;
export const ECOSYSTEM_DESCRIPTION_MAX = 1000;
/** Logos are fetched once at submission (https only, public hosts) and stored; at most this size. */
export const ECOSYSTEM_LOGO_MAX_BYTES = 512 * 1024;

export type EcosystemStatus = "pending" | "approved" | "rejected";

/** A public ecosystem entry (curated in the repo, or submitted and approved). */
export interface EcosystemEntry {
  id: string;
  name: string;
  tagline: string;
  description?: string;
  category: EcosystemCategory;
  uses: EcosystemUse[];
  url: string;
  /** Absolute URL of the logo (served by the API for submitted entries). */
  logoUrl?: string;
  twitter?: string;
  github?: string;
  /** Chains it works on (internal ids). */
  chainIds?: number[];
}
