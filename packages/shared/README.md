# @layerhop/shared

The types and constants every LayerHop TypeScript package agrees on: the chain registry, the built-in token list, the `RouteProvider` interface, stable error codes, fee math, quote ranking, default RPCs and webhook signing. It has no runtime dependencies besides `zod`. Private workspace package: it exports raw TypeScript (`src/index.ts`). When the SDK repositories are exported it is inlined into the public packages (see [`docs/DEPLOY.md`](../../docs/DEPLOY.md)).

## Where it runs

It is not deployed on its own. It is imported by `services/api`, `services/worker`, `services/bot`, `packages/providers`, the Next.js apps (through `transpilePackages`) and the published SDK packages.

## Usage

```ts
import { CHAINS, getChain, findToken, LayerHopError, rankQuotes, applyBps, verifyWebhookSignature } from "@layerhop/shared";
getChain("base")?.id;                         // 8453
findToken(8453, "USDC")?.address;             // 0x8335…2913
throw new LayerHopError("NO_ROUTE", "…");     // status 404, docsUrl https://docs.layerhop.com/errors/NO_ROUTE
```

## Test / typecheck

```bash
pnpm --filter @layerhop/shared test
pnpm --filter @layerhop/shared typecheck
```

## Key files

| File | What it does |
|---|---|
| `src/types.ts` | `QuoteRequest`, `ProviderQuote`, `FeeBreakdown`, `BuiltTx` (`EvmTx` with optional `approval`, `SvmTx` with `submitViaApi`), `OrderStatus`, `ProviderContext`, **`RouteProvider`**, `ProviderId`, `FeeChannel` |
| `src/chains.ts` | `CHAINS`: Ethereum, Arbitrum, Base, Optimism, BNB Chain, Polygon, Solana. `SOLANA_CHAIN_ID = 7565164` (internal id). `getChain(idOrSlug)`. |
| `src/tokens.ts` | `TOKENS` (natives plus USDC/USDT), `EVM_NATIVE` (zero address), `SOL_NATIVE` (wSOL mint), `findToken`, `tokensForChain`, `isNative` |
| `src/errors.ts` | `ERROR_CODES` (code → HTTP status), `LayerHopError`, and the JSON error envelope with `docsUrl` |
| `src/fees.ts` | `DEFAULT_FEE_BPS` per channel (web 30, widget 30, api 20, bot 90), `applyBps`, `minAfterSlippage`. All math is BigInt on integer strings. |
| `src/rank.ts` | `rankQuotes`: highest output adjusted for time (1 bp per minute after the first, capped at 50 bps), then fastest. Never ranks by our fee. |
| `src/http.ts` | `fetchJson`: timeout, and HTTP or network failures turned into `PROVIDER_*` / `RATE_LIMITED` errors |
| `src/rpc.ts` | `DEFAULT_RPC_URLS` (public nodes), `rpcUrl(chainId, env)` with `RPC_URL_<chainId>` / `SOLANA_RPC_URL` overrides |
| `src/preview.ts` | `PREVIEW_ADDRESS`: well-known wallets used only for indicative quotes before a user connects |
| `src/webhooks.ts` | `signWebhookPayload` / `verifyWebhookSignature` for `LayerHop-Signature: t=…,v1=…` (Web Crypto, runs on edge runtimes too) |

## Rules

- Amounts are integer strings in base units. Never use JS floats.
- To add an error code, add it to `ERROR_CODES`. `apps/docs/src/lib/errors-catalog.ts` is typed `Record<ErrorCode, …>`, so the docs typecheck fails until the code has an entry there.
- To add a chain or token, edit `CHAINS` / `TOKENS`. The docs chains page and `GET /v1/chains` are generated from them.
