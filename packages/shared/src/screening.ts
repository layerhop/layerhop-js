/**
 * Address screening (D-069): the digital currency addresses of the US Treasury OFAC SDN list.
 *
 * The SDN list is public (https://sanctionslistservice.ofac.treas.gov). Each sanctioned person or
 * entity (`<sdnEntry>`) may list addresses as `<id>` items whose `idType` is
 * "Digital Currency Address - XBT" (or ETH, USDT, TRX, SOL, ...). The worker downloads SDN.XML once a
 * day, `parseSdnXml` pulls those addresses out, and the API matches them exactly (after
 * `normalizeScreenAddress`). This is a list lookup only: no clustering, no exposure analysis.
 */

/** The OFAC SDN list as XML (redirects to a signed download). */
export const OFAC_SDN_XML_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
export const OFAC_SDN_SOURCE = "ofac_sdn";
/** Name of the list in `lists` (what a screening result says the address is on). */
export const OFAC_SDN_LIST = "OFAC SDN";

const ID_TYPE_PREFIX = "Digital Currency Address - ";

export interface SanctionedAddress {
  /** Normalized (see normalizeScreenAddress). */
  address: string;
  /** Currency code as OFAC writes it: XBT, ETH, USDT, TRX, SOL, ... */
  currency: string;
  /** SDN entry uid and name (person or entity the address belongs to). */
  entryUid: number;
  entryName: string;
  /** Sanctions programs of the entry (e.g. DPRK3, CYBER2). */
  programs: string[];
}

export interface SdnParseResult {
  /** `Publish_Date` of the list as an ISO date (YYYY-MM-DD), when present. */
  publishedAt: string | null;
  /** One row per (address); an address listed under several entries keeps the first. */
  addresses: SanctionedAddress[];
}

/** Lowercase EVM hex and bech32 (case-insensitive by spec); keep base58 (Solana, Tron, BTC legacy) as is. */
export function normalizeScreenAddress(raw: string): string {
  const a = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return a.toLowerCase();
  if (/^(bc1|tb1|ltc1|bitcoincash:)/i.test(a)) return a.toLowerCase();
  return a;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e.startsWith("#x") ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : XML_ENTITIES[e]!);
}

const tag = (block: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? unescapeXml(m[1]!.trim()) : undefined;
};

/** `MM/DD/YYYY` → `YYYY-MM-DD`. */
function isoDate(us: string | undefined): string | null {
  const m = us ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(us.trim()) : null;
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
}

/**
 * Parse the classic SDN.XML (namespace-agnostic, regex-based: the file is flat and machine-written).
 * Throws when the text doesn't look like the SDN list, so a broken download never empties the table.
 */
export function parseSdnXml(xml: string): SdnParseResult {
  if (!/<sdnList[\s>]/.test(xml)) throw new Error("not an OFAC SDN XML document (no <sdnList>)");
  const publish = /<publshInformation>([\s\S]*?)<\/publshInformation>/.exec(xml)?.[1];
  const publishedAt = isoDate(publish ? tag(publish, "Publish_Date") : undefined);
  const seen = new Set<string>();
  const addresses: SanctionedAddress[] = [];
  const entryRe = /<sdnEntry>([\s\S]*?)<\/sdnEntry>/g;
  for (let m = entryRe.exec(xml); m; m = entryRe.exec(xml)) {
    const entry = m[1]!;
    if (!entry.includes(ID_TYPE_PREFIX)) continue;
    const head = entry.split(/<(?:programList|akaList|idList|addressList)>/)[0]!;
    const entryUid = Number(tag(head, "uid"));
    const entryName = [tag(head, "firstName"), tag(head, "lastName")].filter(Boolean).join(" ");
    const programs = [...entry.matchAll(/<program>([\s\S]*?)<\/program>/g)].map((p) => unescapeXml(p[1]!.trim()));
    for (const id of entry.matchAll(/<id>([\s\S]*?)<\/id>/g)) {
      const type = tag(id[1]!, "idType");
      const number = tag(id[1]!, "idNumber");
      if (!type?.startsWith(ID_TYPE_PREFIX) || !number) continue;
      const address = normalizeScreenAddress(number);
      if (!address || seen.has(address)) continue;
      seen.add(address);
      addresses.push({ address, currency: type.slice(ID_TYPE_PREFIX.length).trim(), entryUid, entryName, programs });
    }
  }
  return { publishedAt, addresses };
}

/** One address's screening result (`POST /v1/screen`, `screening` on quotes and sessions). */
export interface ScreeningResult {
  address: string;
  sanctioned: boolean;
  /** Lists the address is on (`["OFAC SDN"]`), empty when not sanctioned. */
  lists: string[];
  source: typeof OFAC_SDN_SOURCE;
  /** Publish date of the list version checked (ISO), null when no list is loaded. */
  listUpdatedAt: string | null;
}
