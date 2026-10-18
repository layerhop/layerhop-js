# @layerhop/cli

[![npm](https://img.shields.io/npm/v/@layerhop/cli?color=c3f06b&labelColor=090d15)](https://www.npmjs.com/package/@layerhop/cli) [![license](https://img.shields.io/npm/l/@layerhop/cli?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/cli)

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
layerhop devnet                                   # local API with the mock provider (monorepo)
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
- `devnet`, run inside the LayerHop monorepo, starts `@layerhop/api` with
  `LAYERHOP_ENABLE_MOCK=1 PROVIDERS=mock`. Point clients at it with
  `LAYERHOP_API_URL=http://localhost:8787`. Mock transactions are dummies: never broadcast them.

Global options: `--api-url` (env `LAYERHOP_API_URL`, default `https://api.layerhop.com`), `--api-key`
(env `LAYERHOP_API_KEY`), `--json`, `--help`, `--version`.

Exit codes: `0` ok, `1` API or order failure (`error: CODE: message`, plus a docs link), `2` usage error.

## License

MIT
