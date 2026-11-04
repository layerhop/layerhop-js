import type { ProviderId } from "./types.js";

/**
 * Avoid-lists for quotes: providers, bridges and exchanges a user never wants a route to use.
 *
 * - `excludeProviders`: our provider ids (`relay`, `lifi`, …). Those providers are not asked.
 * - `excludeBridges` / `excludeExchanges`: venue ids from `AVOIDABLE_VENUES`. A venue that is itself
 *   one of our providers (Relay, deBridge, 0x, …) excludes that provider. A venue LI.FI can route
 *   through is sent to LI.FI as `denyBridges` / `denyExchanges` (its own tool keys, from
 *   `GET https://li.quest/v1/tools`; LI.FI answers 400 to unknown keys), and a LI.FI route that
 *   still names one of them is dropped.
 *
 * Avoiding a venue never changes the fee: every route that is still offered carries it as before.
 */
export type VenueKind = "bridge" | "exchange";

export interface AvoidableVenue {
  /** Stable id used in `excludeBridges` / `excludeExchanges`. */
  id: string;
  /** Display name. */
  name: string;
  kind: VenueKind;
  /** Our provider that IS this venue: excluded with it. */
  provider?: ProviderId;
  /** LI.FI tool keys for this venue (`denyBridges` for bridges, `denyExchanges` for exchanges). */
  lifi?: string[];
}

/** Every venue a user can avoid, by kind then name. LI.FI keys checked against GET /v1/tools on 2026-11-03. */
export const AVOIDABLE_VENUES: readonly AvoidableVenue[] = [
  { id: "across", name: "Across", kind: "bridge", provider: "across", lifi: ["across"] },
  { id: "allbridge", name: "Allbridge", kind: "bridge", lifi: ["allbridge"] },
  { id: "arbitrum-bridge", name: "Arbitrum Bridge", kind: "bridge", lifi: ["arbitrum"] },
  { id: "blast-bridge", name: "Blast Bridge", kind: "bridge", provider: "blast-native" },
  { id: "celer-cctp", name: "Celer (CCTP)", kind: "bridge", lifi: ["celercircle", "celercirclefast"] },
  { id: "debridge", name: "deBridge", kind: "bridge", provider: "debridge" },
  { id: "eco", name: "Eco", kind: "bridge", lifi: ["eco"] },
  { id: "garden", name: "Garden", kind: "bridge", lifi: ["garden"] },
  { id: "gaszip", name: "Gas.zip", kind: "bridge", lifi: ["gasZipBridge"] },
  { id: "glacis", name: "Glacis", kind: "bridge", lifi: ["glacis"] },
  { id: "layerswap", name: "Layerswap", kind: "bridge", lifi: ["layerswap"] },
  { id: "mayan", name: "Mayan", kind: "bridge", provider: "mayan", lifi: ["mayan", "mayanMCTP", "mayanFastMCTP"] },
  { id: "near-intents", name: "NEAR Intents", kind: "bridge", lifi: ["near"] },
  { id: "polymer", name: "Polymer", kind: "bridge", lifi: ["polymer", "polymerStandard"] },
  { id: "relay", name: "Relay", kind: "bridge", provider: "relay", lifi: ["relaydepository"] },
  { id: "squid", name: "Squid", kind: "bridge", lifi: ["squid"] },
  { id: "stargate", name: "Stargate", kind: "bridge", lifi: ["stargateV2", "stargateV2Bus"] },
  { id: "symbiosis", name: "Symbiosis", kind: "bridge", lifi: ["symbiosis"] },
  { id: "0x", name: "0x", kind: "exchange", provider: "zerox" },
  { id: "1inch", name: "1inch", kind: "exchange", lifi: ["1inch"] },
  { id: "dodo", name: "DODO", kind: "exchange", lifi: ["dodo"] },
  { id: "enso", name: "Enso", kind: "exchange", lifi: ["enso"] },
  { id: "jupiter", name: "Jupiter", kind: "exchange", provider: "jupiter" },
  { id: "kyberswap", name: "KyberSwap", kind: "exchange", provider: "kyberswap", lifi: ["kyberswap"] },
  { id: "okx", name: "OKX DEX", kind: "exchange", lifi: ["okx"] },
  { id: "sushiswap", name: "SushiSwap", kind: "exchange", lifi: ["sushiswap"] },
  { id: "velora", name: "Velora", kind: "exchange", lifi: ["paraswap"] },
];

/** Providers a user can exclude by id (`excludeProviders`): the ones that serve live quotes. */
export const EXCLUDABLE_PROVIDERS: readonly ProviderId[] = ["across", "blast-native", "debridge", "jupiter", "kyberswap", "lifi", "mayan", "relay", "zerox"];

/** Most ids in one avoid list (bounds the request). */
export const MAX_AVOID_IDS = 40;

/** A quote request's avoid-lists, venue ids validated against `AVOIDABLE_VENUES`. */
export interface QuoteAvoid {
  providers?: ProviderId[];
  bridges?: string[];
  exchanges?: string[];
}

const VENUES = new Map(AVOIDABLE_VENUES.map((v) => [v.id, v]));

export function findVenue(id: string): AvoidableVenue | undefined {
  return VENUES.get(id);
}

/**
 * Parse one avoid-list parameter: a comma-separated string (GET) or a string array (POST), ids
 * trimmed, case-insensitive, de-duplicated. Returns the unknown ids in `invalid`.
 */
export function parseAvoidList(raw: unknown, valid: (id: string) => boolean): { ids: string[]; invalid: string[] } {
  const parts = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw.map((x) => (typeof x === "string" ? x : String(x))) : [];
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const id = p.trim().toLowerCase();
    if (!id) continue;
    if (!valid(id)) invalid.push(p.trim());
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

export const isAvoidableProvider = (id: string): boolean => (EXCLUDABLE_PROVIDERS as readonly string[]).includes(id);
export const isAvoidableBridge = (id: string): boolean => VENUES.get(id)?.kind === "bridge";
export const isAvoidableExchange = (id: string): boolean => VENUES.get(id)?.kind === "exchange";

/** Every provider an avoid-list rules out: the listed ones plus those that are an avoided venue. */
export function avoidedProviders(avoid: QuoteAvoid | undefined): Set<ProviderId> {
  const out = new Set<ProviderId>(avoid?.providers ?? []);
  for (const id of [...(avoid?.bridges ?? []), ...(avoid?.exchanges ?? [])]) {
    const p = VENUES.get(id)?.provider;
    if (p) out.add(p);
  }
  return out;
}

/** LI.FI `denyBridges` / `denyExchanges` keys for an avoid-list (empty arrays when none). */
export function lifiDenyLists(avoid: QuoteAvoid | undefined): { bridges: string[]; exchanges: string[] } {
  const keys = (ids: string[] | undefined) => [...new Set((ids ?? []).flatMap((id) => VENUES.get(id)?.lifi ?? []))];
  return { bridges: keys(avoid?.bridges), exchanges: keys(avoid?.exchanges) };
}

/** True when the avoid-list asks for anything at all. */
export function hasAvoid(avoid: QuoteAvoid | undefined): boolean {
  return !!(avoid?.providers?.length || avoid?.bridges?.length || avoid?.exchanges?.length);
}
