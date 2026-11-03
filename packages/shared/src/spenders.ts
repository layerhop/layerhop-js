/**
 * Spenders we can name (approval targets of the routes LayerHop uses and of major DEXes), shared by
 * the approvals page and wallet health (apps/web) and the transaction preview (services/api).
 */
import { PERMIT2_ADDRESS } from "./calls.js";

export type SpenderKind = "layerhop" | "dex";

export interface KnownSpender {
  address: string;
  label: string;
  /** `layerhop`: a route LayerHop uses (packages/providers); `dex`: a major DEX or aggregator. */
  kind: SpenderKind;
  chains: readonly number[];
}

/** Ethereum, Arbitrum, Base, Optimism, BNB Chain, Polygon. */
export const SPENDER_CHAINS = [1, 42161, 8453, 10, 56, 137] as const;
const ALL: readonly number[] = SPENDER_CHAINS;

/**
 * Spenders we can name. Addresses from packages/providers (comments and fixtures) and the protocols'
 * docs; each was checked read-only to have contract code on the chains listed (2026-10-27).
 */
export const KNOWN_SPENDERS: readonly KnownSpender[] = [
  { address: PERMIT2_ADDRESS, label: "Permit2 (Uniswap)", kind: "layerhop", chains: ALL },
  { address: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", label: "LI.FI", kind: "layerhop", chains: ALL },
  { address: "0x0000000000001fF3684f28c67538D4D072C22734", label: "0x AllowanceHolder", kind: "layerhop", chains: ALL },
  { address: "0x0000000000005E88410CcDFaDe4a5EfaE4b49562", label: "0x AllowanceHolder", kind: "layerhop", chains: [56] },
  { address: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", label: "0x Exchange Proxy", kind: "layerhop", chains: [1, 56, 137, 8453, 42161] },
  { address: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", label: "KyberSwap", kind: "layerhop", chains: ALL },
  { address: "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05", label: "Odos", kind: "layerhop", chains: ALL },
  { address: "0x4cd00e387622c35bddb9b4c962c136462338bc31", label: "Relay Depository", kind: "layerhop", chains: ALL },
  { address: "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f", label: "Relay Router", kind: "layerhop", chains: ALL },
  { address: "0xaaaaaaae92Cc1cEeF79a038017889fDd26D23D4d", label: "Relay Approval Proxy", kind: "layerhop", chains: ALL },
  { address: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", label: "deBridge DLN", kind: "layerhop", chains: ALL },
  { address: "0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251", label: "deBridge Forwarder", kind: "layerhop", chains: ALL },
  { address: "0x337685fdaB40D39bd02028545a4FfA7D287cC3E2", label: "Mayan Forwarder", kind: "layerhop", chains: ALL },
  { address: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af", label: "Uniswap Universal Router", kind: "dex", chains: [1] },
  { address: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", label: "Uniswap Universal Router", kind: "dex", chains: [1, 10, 56, 137, 8453, 42161] },
  { address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", label: "Uniswap SwapRouter02", kind: "dex", chains: [1, 10, 137, 42161] },
  { address: "0x2626664c2603336E57B271c5C0b26F421741e481", label: "Uniswap SwapRouter02", kind: "dex", chains: [8453] },
  { address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", label: "Uniswap V2 Router", kind: "dex", chains: [1] },
  { address: "0x111111125421cA6dc452d289314280a0f8842A65", label: "1inch v6", kind: "dex", chains: ALL },
  { address: "0x1111111254EEB25477B68fb85Ed929f73A960582", label: "1inch v5", kind: "dex", chains: ALL },
  { address: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4", label: "PancakeSwap Smart Router", kind: "dex", chains: [1, 56, 8453] },
  { address: "0x10ED43C718714eb63d5aA57B78B54704E256024E", label: "PancakeSwap V2 Router", kind: "dex", chains: [56] },
  { address: "0x216B4B4Ba9F3e719726886d34a177484278Bfcae", label: "ParaSwap v5", kind: "dex", chains: [1, 10, 56, 137, 42161] },
  { address: "0x6A000F20005980200259B80c5102003040001068", label: "ParaSwap v6", kind: "dex", chains: ALL },
  { address: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", label: "Aerodrome Router", kind: "dex", chains: [8453] },
];

const lc = (a: string) => a.toLowerCase();

export function spendersFor(chainId: number): KnownSpender[] {
  return KNOWN_SPENDERS.filter((s) => s.chains.includes(chainId));
}

export function spenderInfo(chainId: number, address: string): KnownSpender | undefined {
  return KNOWN_SPENDERS.find((s) => s.chains.includes(chainId) && lc(s.address) === lc(address));
}
