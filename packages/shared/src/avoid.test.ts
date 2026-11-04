import { describe, expect, it } from "vitest";
import {
  AVOIDABLE_VENUES, EXCLUDABLE_PROVIDERS, avoidedProviders, hasAvoid, isAvoidableBridge, isAvoidableExchange, isAvoidableProvider, lifiDenyLists, parseAvoidList,
} from "./avoid.js";

describe("avoid-lists", () => {
  it("venue ids are unique, lower-case and name only excludable providers", () => {
    const ids = AVOIDABLE_VENUES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of AVOIDABLE_VENUES) {
      expect(v.id).toBe(v.id.toLowerCase());
      expect(v.provider || v.lifi?.length).toBeTruthy();
      if (v.provider) expect(EXCLUDABLE_PROVIDERS).toContain(v.provider);
    }
  });

  it("parses comma strings and arrays and reports unknown ids", () => {
    expect(parseAvoidList(" Relay,lifi,, relay ", isAvoidableProvider)).toEqual({ ids: ["relay", "lifi"], invalid: [] });
    expect(parseAvoidList(["stargate", "nope"], isAvoidableBridge)).toEqual({ ids: ["stargate"], invalid: ["nope"] });
    expect(parseAvoidList(undefined, isAvoidableExchange)).toEqual({ ids: [], invalid: [] });
    expect(isAvoidableBridge("1inch")).toBe(false);
    expect(isAvoidableExchange("1inch")).toBe(true);
  });

  it("maps venues to the providers they are and to LI.FI keys", () => {
    const avoid = { providers: ["lifi" as const], bridges: ["relay", "stargate"], exchanges: ["0x", "kyberswap"] };
    expect([...avoidedProviders(avoid)].sort()).toEqual(["kyberswap", "lifi", "relay", "zerox"]);
    expect(lifiDenyLists(avoid)).toEqual({ bridges: ["relaydepository", "stargateV2", "stargateV2Bus"], exchanges: ["kyberswap"] });
    expect(lifiDenyLists(undefined)).toEqual({ bridges: [], exchanges: [] });
    expect(hasAvoid({})).toBe(false);
    expect(hasAvoid(avoid)).toBe(true);
  });
});
