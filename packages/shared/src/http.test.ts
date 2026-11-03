import { describe, expect, it } from "vitest";
import { fetchJson } from "./http.js";

/** fetch that never answers until its signal aborts (like a stuck provider). */
const hanging = (async (_u: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;

describe("fetchJson", () => {
  it("its own timeout is PROVIDER_TIMEOUT", async () => {
    await expect(fetchJson(hanging, "https://x.test/a", { timeoutMs: 20 })).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("a caller's timeout signal (the quote deadline) is PROVIDER_TIMEOUT too, not a network error", async () => {
    await expect(fetchJson(hanging, "https://x.test/a", { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("a caller's plain abort stays PROVIDER_ERROR; a 429 is RATE_LIMITED", async () => {
    const ac = new AbortController();
    const p = fetchJson(hanging, "https://x.test/a", { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    const limited = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    await expect(fetchJson(limited, "https://x.test/a")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
