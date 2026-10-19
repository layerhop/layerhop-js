import { spawn, spawnSync } from "node:child_process";
import { getChain } from "@layerhop/shared";

/**
 * Optional Anvil forks for `layerhop dev --fork`: a local copy of mainnet state per EVM chain, so
 * wallet and contract code can be exercised against real token contracts with Anvil's prefunded test
 * accounts. Forks only read mainnet through the RPC; nothing is ever sent to a real chain.
 */

/** Public RPCs used when LAYERHOP_FORK_RPC_<SLUG> is not set (rate limited: set your own for heavy use). */
export const DEFAULT_FORK_RPCS: Record<string, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  bsc: "https://bsc-dataseed.bnbchain.org",
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
};

export const DEFAULT_FORK_CHAINS = ["base", "arbitrum"];
export const FIRST_FORK_PORT = 8545;

export interface ForkPlan {
  slug: string;
  chainId: number;
  port: number;
  rpcUrl: string;
  forkUrl: string;
}

export interface RunningProcess {
  kill: () => void;
  exited: Promise<number>;
}

export const forkEnvVar = (slug: string) => `LAYERHOP_FORK_RPC_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

/** Resolve `--fork-chains` into one Anvil instance per chain on consecutive ports. Throws on bad input. */
export function planForks(chains: string[], env: Record<string, string | undefined>, firstPort = FIRST_FORK_PORT): ForkPlan[] {
  return chains.map((name, i) => {
    const chain = getChain(name);
    if (!chain) throw new Error(`Unknown chain "${name}" in --fork-chains`);
    if (chain.vm !== "evm") throw new Error(`${chain.slug} is not an EVM chain: Anvil forks EVM chains only (a Solana test validator is not part of layerhop dev yet)`);
    const forkUrl = env[forkEnvVar(chain.slug)] ?? DEFAULT_FORK_RPCS[chain.slug];
    if (!forkUrl) throw new Error(`No default RPC for ${chain.slug}: set ${forkEnvVar(chain.slug)}=https://… to fork it`);
    const port = firstPort + i;
    return { slug: chain.slug, chainId: chain.id, port, rpcUrl: `http://127.0.0.1:${port}`, forkUrl };
  });
}

export const anvilArgs = (f: ForkPlan) => ["--fork-url", f.forkUrl, "--port", String(f.port), "--chain-id", String(f.chainId), "--silent"];

export function hasCommand(cmd: string): boolean {
  try {
    return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function startProcess(cmd: string, args: string[]): RunningProcess {
  const child = spawn(cmd, args, { stdio: "ignore" });
  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
  return { kill: () => void child.kill("SIGTERM"), exited };
}
