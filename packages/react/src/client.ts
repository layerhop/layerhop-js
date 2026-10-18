import { CHAINS, TOKENS, getChain, type LayerHop, type OrderStatus, type ProviderId } from "@layerhop/sdk";

/** Chain as returned by `GET /v1/chains` (same shape as the SDK's built-in `CHAINS`). */
export type Chain = (typeof CHAINS)[number];
/** Token as returned by `GET /v1/tokens` (same shape as the SDK's built-in `TOKENS`). */
export type Token = (typeof TOKENS)[number];

/**
 * The part of the `@layerhop/sdk` client the hooks use. Any object with these methods works,
 * which keeps tests and custom transports simple. Optional methods are feature-detected:
 * `reportSubmitted` (POST /v1/orders/{quoteId}/submitted), `chains` / `tokens` (otherwise the
 * built-in registries shipped with the SDK are used).
 */
export type LayerHopClient = Pick<LayerHop, "quote" | "buildTx" | "submit" | "status"> & {
  reportSubmitted?: (quoteId: string, txHash: string) => Promise<unknown>;
  /** Live order status over SSE (`@layerhop/sdk` 0.3+); `useOrderStream` needs it. */
  streamOrder?: LayerHop["streamOrder"];
  chains?: () => Promise<readonly Chain[]>;
  /** May return the list itself or a `GET /v1/tokens` page (`{ tokens }`, as `LayerHop.tokens` does). */
  tokens?: (chain: string | number) => Promise<readonly Token[] | { tokens: readonly Token[] }>;
};

export const FINAL_STATES: readonly OrderStatus["state"][] = ["filled", "refunded", "failed"];

export function isFinalState(state: OrderStatus["state"] | undefined): boolean {
  return state !== undefined && FINAL_STATES.includes(state);
}

/**
 * Same-chain providers have nothing to track off-chain: the API always answers `unknown`.
 * Confirm those transactions on chain (your `sign` callback usually already waited for it).
 */
export const SAME_CHAIN_PROVIDERS: readonly ProviderId[] = ["jupiter", "zerox", "kyberswap"];

export async function loadChains(client: LayerHopClient): Promise<readonly Chain[]> {
  return typeof client.chains === "function" ? client.chains() : CHAINS;
}

export async function loadTokens(client: LayerHopClient, chain: string | number): Promise<readonly Token[]> {
  if (typeof client.tokens === "function") {
    const r = await client.tokens(chain);
    return "tokens" in r ? r.tokens : r;
  }
  const c = getChain(chain);
  if (!c) throw new Error(`Unsupported chain: ${chain}`);
  return TOKENS.filter((t) => t.chainId === c.id);
}
