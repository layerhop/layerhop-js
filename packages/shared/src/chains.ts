import type { ChainId, Vm } from "./types.js";

export interface Chain {
  id: ChainId;
  slug: string;
  name: string;
  vm: Vm;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerTx: string; // `${explorerTx}${hash}`
}

/** LayerHop internal id for Solana (EVM chains use their real chain id). */
export const SOLANA_CHAIN_ID = 7565164;

export const CHAINS: readonly Chain[] = [
  { id: 1, slug: "ethereum", name: "Ethereum", vm: "evm", nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://etherscan.io/tx/" },
  { id: 42161, slug: "arbitrum", name: "Arbitrum", vm: "evm", nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://arbiscan.io/tx/" },
  { id: 8453, slug: "base", name: "Base", vm: "evm", nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://basescan.org/tx/" },
  { id: 10, slug: "optimism", name: "Optimism", vm: "evm", nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://optimistic.etherscan.io/tx/" },
  { id: 56, slug: "bsc", name: "BNB Chain", vm: "evm", nativeSymbol: "BNB", nativeDecimals: 18, explorerTx: "https://bscscan.com/tx/" },
  { id: 137, slug: "polygon", name: "Polygon", vm: "evm", nativeSymbol: "POL", nativeDecimals: 18, explorerTx: "https://polygonscan.com/tx/" },
  { id: SOLANA_CHAIN_ID, slug: "solana", name: "Solana", vm: "svm", nativeSymbol: "SOL", nativeDecimals: 9, explorerTx: "https://solscan.io/tx/" },
] as const;

export function getChain(idOrSlug: ChainId | string): Chain | undefined {
  return CHAINS.find((c) => c.id === Number(idOrSlug) || c.slug === String(idOrSlug).toLowerCase());
}

export function isSameChain(a: ChainId, b: ChainId): boolean {
  return a === b;
}
