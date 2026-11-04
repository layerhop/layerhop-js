import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeScreenAddress, parseSdnXml } from "./screening.js";

/** Shape of the real SDN.XML (trimmed): two entries with addresses, one without. */
const SDN_FIXTURE = `<?xml version="1.0" standalone="yes"?>
<sdnList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
  <publshInformation>
    <Publish_Date>10/28/2026</Publish_Date>
    <Record_Count>3</Record_Count>
  </publshInformation>
  <sdnEntry>
    <uid>36</uid>
    <lastName>AEROCARIBBEAN AIRLINES</lastName>
    <sdnType>Entity</sdnType>
    <programList><program>CUBA</program></programList>
  </sdnEntry>
  <sdnEntry>
    <uid>27307</uid>
    <lastName>LAZARUS GROUP</lastName>
    <sdnType>Entity</sdnType>
    <programList>
      <program>DPRK3</program>
    </programList>
    <idList>
      <id>
        <uid>135306</uid>
        <idType>Transactions Prohibited For Persons Owned or Controlled By U.S. Financial Institutions:</idType>
        <idNumber>North Korea Sanctions Regulations section 510.214</idNumber>
      </id>
      <id>
        <uid>150215</uid>
        <idType>Digital Currency Address - ETH</idType>
        <idNumber>0x098B716B8Aaf21512996dC57EB0615e2383E2f96</idNumber>
      </id>
    </idList>
  </sdnEntry>
  <sdnEntry>
    <uid>40001</uid>
    <firstName>Jane</firstName>
    <lastName>DOE &amp; CO</lastName>
    <sdnType>Individual</sdnType>
    <programList><program>CYBER2</program><program>SDGT</program></programList>
    <idList>
      <id><uid>1</uid><idType>Digital Currency Address - XBT</idType><idNumber>bc1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH</idNumber></id>
      <id><uid>2</uid><idType>Digital Currency Address - TRX</idType><idNumber>TXyzTronAddressExample11111111111111</idNumber></id>
      <id><uid>3</uid><idType>Digital Currency Address - USDT</idType><idNumber>0x098b716b8aaf21512996dc57eb0615e2383e2f96</idNumber></id>
      <id><uid>4</uid><idType>Digital Currency Address - SOL</idType><idNumber>42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi</idNumber></id>
    </idList>
  </sdnEntry>
</sdnList>`;

describe("parseSdnXml", () => {
  it("extracts digital currency addresses with their entry and programs", () => {
    const r = parseSdnXml(SDN_FIXTURE);
    expect(r.publishedAt).toBe("2026-10-28");
    expect(r.addresses).toEqual([
      { address: "0x098b716b8aaf21512996dc57eb0615e2383e2f96", currency: "ETH", entryUid: 27307, entryName: "LAZARUS GROUP", programs: ["DPRK3"] },
      { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", currency: "XBT", entryUid: 40001, entryName: "Jane DOE & CO", programs: ["CYBER2", "SDGT"] },
      { address: "TXyzTronAddressExample11111111111111", currency: "TRX", entryUid: 40001, entryName: "Jane DOE & CO", programs: ["CYBER2", "SDGT"] },
      // The USDT duplicate of the ETH address is dropped (first wins).
      { address: "42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi", currency: "SOL", entryUid: 40001, entryName: "Jane DOE & CO", programs: ["CYBER2", "SDGT"] },
    ]);
  });

  it("refuses a document that isn't the SDN list", () => {
    expect(() => parseSdnXml("<html><body>maintenance</body></html>")).toThrow(/not an OFAC SDN/);
  });

  it("normalizes case only where the address format is case-insensitive", () => {
    expect(normalizeScreenAddress(" 0xABCDEF0000000000000000000000000000000001 ")).toBe("0xabcdef0000000000000000000000000000000001");
    expect(normalizeScreenAddress("BC1QABC")).toBe("bc1qabc");
    expect(normalizeScreenAddress("42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi")).toBe("42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi");
  });

  // Read-only check against a real download: SDN_XML=/path/to/SDN.XML pnpm --filter @layerhop/shared test
  it.skipIf(!process.env.SDN_XML)("parses the real SDN list and finds a known listed address", () => {
    const r = parseSdnXml(readFileSync(process.env.SDN_XML!, "utf8"));
    expect(r.addresses.length).toBeGreaterThan(500);
    const lazarus = r.addresses.find((a) => a.address === "0x098b716b8aaf21512996dc57eb0615e2383e2f96");
    expect(lazarus?.entryName).toBe("LAZARUS GROUP");
  });
});
