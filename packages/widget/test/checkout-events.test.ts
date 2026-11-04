import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerHopCheckoutError, buildCheckoutUrl, closeCheckout, mountCheckout, openCheckout, parseCheckoutMessage, type CheckoutHandle } from "../src/checkout";
import { post } from "./helpers";

const SID = "cs_test_01jabc123";
const env = (type: string, extra: Record<string, unknown> = {}) => ({ source: "layerhop-checkout", version: 1, type, sessionId: SID, ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));

let handle: CheckoutHandle | undefined;
afterEach(() => {
  handle?.close();
  handle = undefined;
  closeCheckout();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("expired / error messages and theme", () => {
  it("parses expired and error envelopes strictly", () => {
    expect(parseCheckoutMessage(env("expired"))).toMatchObject({ type: "expired", sessionId: SID });
    expect(parseCheckoutMessage(env("error", { code: "NOT_FOUND", message: "gone" }))).toMatchObject({ type: "error", code: "NOT_FOUND", message: "gone" });
    expect(parseCheckoutMessage(env("error", { code: "<script>", message: "x" }))).toBeNull();
    expect(parseCheckoutMessage(env("error", { code: "NOT_FOUND" }))).toBeNull();
  });

  it("adds the theme to the URL (dark is the default) and rejects unknown themes", () => {
    expect(buildCheckoutUrl(SID, { theme: "light" })).toBe(`https://layerhop.com/pay/${SID}?embed=1&theme=light`);
    expect(buildCheckoutUrl(SID, { theme: "dark" })).toBe(`https://layerhop.com/pay/${SID}?embed=1`);
    expect(() => buildCheckoutUrl(SID, { theme: "neon" as never })).toThrow(LayerHopCheckoutError);
  });

  it("inline: onExpired and onError from the frame; messages from other origins or windows are ignored", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cb = { onExpired: vi.fn(), onError: vi.fn() };
    handle = mountCheckout(host, { sessionId: SID, theme: "auto", ...cb });
    await handle.sessionId;
    await flush();
    const f = host.querySelector("iframe")!;
    expect(f.src).toContain("theme=auto");
    post(f, env("expired"), { origin: "https://evil.example" });
    post(f, env("expired"), { source: window });
    post(f, env("expired"));
    expect(cb.onExpired).toHaveBeenCalledTimes(1);
    post(f, env("error", { code: "NOT_FOUND", message: "This checkout session doesn't exist" }));
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError.mock.calls[0]![0]).toMatchObject({ code: "NOT_FOUND", message: "This checkout session doesn't exist" });
    // Another session's message (same frame) is ignored.
    post(f, { ...env("expired"), sessionId: "cs_test_other123" });
    expect(cb.onExpired).toHaveBeenCalledTimes(1);
  });

  it("modal: onExpired keeps it open", async () => {
    const onExpired = vi.fn();
    handle = openCheckout({ sessionId: SID, onExpired });
    await handle.sessionId;
    await flush();
    post(handle.iframe!, env("expired"));
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-layerhop-checkout]")).not.toBeNull();
  });

  it("checkout.js defines LayerHop.checkout", async () => {
    const mod = await import("../src/checkout-embed");
    const g = (window as unknown as { LayerHop: { checkout: unknown } }).LayerHop;
    expect(g.checkout).toBe(mod.checkoutNamespace);
    expect(typeof mod.checkoutNamespace.mount).toBe("function");
  });
});
