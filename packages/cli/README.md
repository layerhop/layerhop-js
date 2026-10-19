# @layerhop/cli

[![npm](https://img.shields.io/npm/v/@layerhop/cli?color=c3f06b&labelColor=090d15&cacheSeconds=3600)](https://www.npmjs.com/package/@layerhop/cli) [![license](https://img.shields.io/npm/l/@layerhop/cli?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/cli)

LayerHop from your terminal. Quote swaps, track orders, print deep links, scaffold a project and run
a local mock API.

> **Never holds keys.** The CLI quotes, builds links and tracks orders. It never signs or sends
> transactions; your wallet does that.

## Install

```bash
npm install -g @layerhop/cli     # or: npx @layerhop/cli <command>
layerhop --help
```

Node 20+. The package is a single file with no runtime dependencies.

## Commands

```bash
layerhop chains                                   # supported chains
layerhop tokens base                              # built-in tokens on a chain
layerhop quote 100 USDC base SOL solana --sender 0x… --recipient 9WzD…
layerhop quote 100000000 USDC base SOL solana --base-units --sender 0x… --recipient 9WzD… --json
layerhop status relay 0x… --watch                 # poll until filled / refunded / failed
layerhop link 100 USDC base SOL solana --ref x    # https://layerhop.com/swap?...
layerhop link 100 USDC arbitrum USDC base --embed --theme light --lock-dst
layerhop init next my-app                         # or: layerhop init node my-script
layerhop dev                                      # local mock API on :8787 (offline, deterministic, signed webhooks)
layerhop devnet                                   # real API with the mock provider (monorepo)
layerhop deposit-address create USDC base USDC arbitrum --recipient 0x… --refund-to 0x…
layerhop deposit-address list --status active     # also: get / refresh / disable <da_…>
layerhop deposit-address simulate da_… 25         # test key only: record a fake deposit
```

- `quote` takes the amount in **human units** (`100` = 100 USDC) and converts it to base units from
  the built-in token list. For tokens that aren't on the list, pass base units with `--base-units`.
  Options: `--slippage-bps`, `--integrator`.
- `status --watch` prints each state change. It exits 0 on `filled` and 1 on `refunded` / `failed`.
- `link` follows the [URL contract](https://docs.layerhop.com/guides/deep-links): amounts in human
  units, plus `--recipient`, `--slippage-bps`, `--ref`, `--integrator`. With `--embed` you can also
  pass `--theme`, `--accent`, `--radius`, `--lock-src`, `--lock-dst` and `--hide-history`.
- `init [node|next] <dir>` writes a minimal project that uses `@layerhop/sdk`. It refuses a
  non-empty directory unless you pass `--force`.
- `deposit-address` (API key required) manages [deposit addresses](https://docs.layerhop.com/guides/deposit-addresses):
  `create <token> <chain> <toToken> <toChain> --recipient --refund-to` (plus `--amount`, `--one-time`,
  `--label`, `--metadata k=v,…`, `--base-units`), `list` (`--status`, `--label`, `--limit`, `--cursor`),
  `get <id>` (with recent deposits), `refresh <id>`, `disable <id>` and `simulate <id> <amount>` (test
  keys only). Send only the source token on the source chain, at least $1 worth, and never use an
  exchange deposit address as `--refund-to`.
- `dev` starts a self-contained mock LayerHop API on `http://127.0.0.1:8787` (no account, key or
  network): chains, tokens, quote, build, simulate, report, status and order list, with fixed prices
  and test-mode outcomes (amounts ending in `4001` refund, `4002` fail, `4004` have no route).
  `--webhook-url` sends signed `order.*` webhooks, `--fill-after <s>` sets how long orders take, and
  `--fork` also starts Anvil forks (`--fork-chains base,arbitrum`, needs Foundry). Transactions are
  placeholders: never broadcast them. Docs: https://docs.layerhop.com/guides/local-development
- `devnet`, run inside the LayerHop monorepo, starts `@layerhop/api` with
  `LAYERHOP_ENABLE_MOCK=1 PROVIDERS=mock`. Point clients at it with
  `LAYERHOP_API_URL=http://localhost:8787`. Mock transactions are dummies: never broadcast them.

Global options: `--api-url` (env `LAYERHOP_API_URL`, default `https://api.layerhop.com`), `--api-key`
(env `LAYERHOP_API_KEY`), `--json`, `--help`, `--version`.

Exit codes: `0` ok, `1` API or order failure (`error: CODE: message`, plus a docs link), `2` usage error.

## License

MIT
