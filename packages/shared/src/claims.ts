/**
 * Unclaimed airdrop checker (app.layerhop.com/claims): the curated airdrops we check read-only, per
 * address, against their official claim contracts (and the official public data they publish). We
 * never build claim transactions for third-party airdrops: each result links to the official site.
 */

export type AirdropStatus = "live" | "ended";

export interface AirdropInfo {
  id: string;
  name: string;
  token: string;
  /** Chain the claim contract lives on (Merkl: every chain it pays on). */
  chainId: number;
  status: AirdropStatus;
  /** ISO date the claim window closed / closes; null when it has none. */
  deadline: string | null;
  /** Official claim site (the only place to claim: look-alike sites are phishing). */
  claimUrl: string;
  /** Claim / distributor contract we read. */
  contract: string;
  /** What the check can and can't tell, in one sentence. */
  coverage: string;
}

export const AIRDROPS: readonly AirdropInfo[] = [
  {
    id: "uniswap", name: "Uniswap (2020 retroactive)", token: "UNI", chainId: 1, status: "live", deadline: null,
    claimUrl: "https://app.uniswap.org", contract: "0x090D4613473dEE047c3f2706764f49E0821D256e",
    coverage: "Allocation from Uniswap's published Merkle data, claim status from the distributor's isClaimed on Ethereum. Still claimable, no deadline.",
  },
  {
    id: "merkl", name: "Merkl rewards (many protocols)", token: "various", chainId: 1, status: "live", deadline: null,
    claimUrl: "https://app.merkl.xyz", contract: "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae",
    coverage: "Incentive rewards distributed through Merkl on Ethereum, Base, Arbitrum, Optimism and Polygon: earned amounts from Merkl's public API, what was already claimed read from the distributor on chain.",
  },
  {
    id: "linea", name: "Linea (LINEA airdrop)", token: "LINEA", chainId: 59144, status: "ended", deadline: "2025-12-09T23:59:59Z",
    claimUrl: "https://linea.build", contract: "0x87bAa1694381aE3eCaE2660d97fe60404080Eb64",
    coverage: "Allocation (calculateAllocation) and claim status (hasClaimed) read from the airdrop contract on Linea. The claim window closed on 9 Dec 2025.",
  },
  {
    id: "layerzero", name: "LayerZero (ZRO, June 2024)", token: "ZRO", chainId: 42161, status: "ended", deadline: "2024-09-20T00:00:00Z",
    claimUrl: "https://www.layerzero.foundation", contract: "0xd6b6a6701303B5Ea36fa0eDf7389b562d8F894DB",
    coverage: "Only what an address already claimed on Arbitrum (zroClaimed, keyed by the eligible wallet): there is no public allocation data, so an unclaimed allocation can't be shown. The window closed in Sep 2024.",
  },
];

/**
 * - `claimable`: eligible and not claimed, and the window is open.
 * - `claimed`: already claimed (in full).
 * - `missed`: eligible, never claimed, and the window has closed.
 * - `not_eligible`: the published data has no allocation for this address.
 * - `unknown`: the check can't tell (e.g. ZRO without a claim) or a source failed.
 */
export type ClaimState = "claimable" | "claimed" | "missed" | "not_eligible" | "unknown";

export interface ClaimItem {
  /** Base units. */
  amount: string;
  symbol: string;
  decimals: number;
  chainId: number;
  /** Token address. */
  token: string;
}

export interface ClaimResult {
  airdrop: string;
  state: ClaimState;
  /** What can still be claimed (or was missed). */
  unclaimed: ClaimItem[];
  /** What was already claimed, when the source says. */
  claimed: ClaimItem[];
  note?: string;
  error?: boolean;
}

export interface ClaimsScan {
  address: string;
  results: ClaimResult[];
  checkedAt: number;
}
