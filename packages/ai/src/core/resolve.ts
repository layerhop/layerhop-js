import type { Chain } from "@layerhop/shared";
import { isValidAddress } from "./address.js";
import type { LayerHopClient } from "./client.js";
import type { QuoteContext, TokenInfo, TokenLookup } from "./format.js";

/** An input problem the model can fix (unknown chain, bad address, missing decimals...). */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

/** quoteId -> request context, so build/simulate can show human amounts. In-memory, bounded. */
export class QuoteCache {
  private readonly map = new Map<string, QuoteContext>();
  constructor(private readonly max = 2000) {}
  set(ctx: QuoteContext): void {
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(ctx.quoteId, ctx);
  }
  get(quoteId: string): QuoteContext | undefined {
    return this.map.get(quoteId);
  }
}

/** Chain / token resolution with LLM-actionable errors (same rules as the MCP server). */
export function createResolvers(client: LayerHopClient) {
  const resolveChain = async (input: string | number): Promise<Chain> => {
    const c = await client.chain(input);
    if (!c) {
      const all = await client.chains();
      throw new UserInputError(`Unknown chain "${input}". Supported: ${all.map((x) => `${x.slug} (${x.id})`).join(", ")}.`);
    }
    return c;
  };

  const resolveToken = async (chain: Chain, input: string, decimals?: number): Promise<TokenInfo> => {
    const q = input.trim();
    const tokens = await client.tokens(chain.id);
    if (q.toLowerCase() === "native") {
      const n = tokens.find((t) => t.symbol === chain.nativeSymbol);
      if (n) return { symbol: n.symbol, address: n.address, decimals: n.decimals };
    }
    const known = tokens.find((t) => t.symbol.toLowerCase() === q.toLowerCase() || t.address.toLowerCase() === q.toLowerCase());
    if (known) return { symbol: known.symbol, address: known.address, decimals: decimals ?? known.decimals };
    if (isValidAddress(chain.vm, q)) {
      if (decimals === undefined) {
        throw new UserInputError(
          `Token ${q} is not in LayerHop's token list for ${chain.name}, so its decimals are unknown. Pass its decimals (fromTokenDecimals / toTokenDecimals) to convert the human amount.`,
        );
      }
      return { symbol: q, address: q, decimals };
    }
    throw new UserInputError(
      `Unknown token "${input}" on ${chain.name}. Known: ${tokens.map((t) => t.symbol).join(", ") || "none"}. You can also pass a token ${chain.vm === "evm" ? "contract address" : "mint address"}.`,
    );
  };

  /** Like resolveToken, but lets an unlisted (valid) address through without decimals. */
  const resolveTokenLoose = async (chain: Chain, input: string, decimals?: number): Promise<{ address: string; symbol: string; decimals?: number }> => {
    try {
      return await resolveToken(chain, input, decimals);
    } catch (e) {
      if (e instanceof UserInputError && isValidAddress(chain.vm, input.trim())) return { address: input.trim(), symbol: input.trim() };
      throw e;
    }
  };

  const tokenLookup = async (chainIds: number[]): Promise<TokenLookup> => {
    const ids = [...new Set(chainIds)];
    const lists = new Map(await Promise.all(ids.map(async (id) => [id, await client.tokens(id)] as const)));
    return (chainId, address) => {
      const t = lists.get(chainId)?.find((x) => x.address.toLowerCase() === address.toLowerCase());
      return t ? { symbol: t.symbol, address: t.address, decimals: t.decimals } : undefined;
    };
  };

  const chainNameById = (all: Chain[]) => (id: number) => all.find((c) => c.id === id)?.name ?? `chain ${id}`;

  return { resolveChain, resolveToken, resolveTokenLoose, tokenLookup, chainNameById };
}

export type Resolvers = ReturnType<typeof createResolvers>;
