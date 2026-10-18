import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LayerHopCheckoutError, acceptCheckoutMessage, buildBuyUrl, buildCheckoutUrl, checkoutOrigin, closeCheckout, createProductSession, getProduct,
  mountCheckout, openCheckout, parseCheckoutMessage, type CheckoutHandle,
} from "../src/checkout";
import { post } from "./helpers";

const SID = "cs_test_01jabc123";
const env = (type: string, extra: Record<string, unknown> = {}) => ({ source: "layerhop-checkout", version: 1, type, sessionId: SID, ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let handle: CheckoutHandle | undefined;
afterEach(() => {
  handle?.close();
  handle = undefined;
  closeCheckout();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("URLs", () => {
  it("builds the embed URL with mode and origin", () => {
    expect(buildCheckoutUrl(SID)).toBe(`https://layerhop.com/pay/${SID}?embed=1`);
    expect(buildCheckoutUrl(SID, { mode: "modal", origin: "https://shop.example.com" })).toBe(
      `https://layerhop.com/pay/${SID}?embed=modal&origin=https%3A%2F%2Fshop.example.com`,
    );
    expect(buildCheckoutUrl(SID, { baseUrl: "http://localhost:3110/", origin: "file://" })).toBe(`http://localhost:3110/pay/${SID}?embed=1`);
    expect(buildCheckoutUrl(SID, { baseUrl: "https://example.com/lh" })).toBe(`https://example.com/lh/pay/${SID}?embed=1`);
    expect(() => buildCheckoutUrl("cs_1")).toThrow(LayerHopCheckoutError);
    expect(() => buildCheckoutUrl(SID, { baseUrl: "javascript:alert(1)" })).toThrow(/http/);
  });

  it("builds /buy links and checkout origins", () => {
    expect(buildBuyUrl("prod_test_abc1", { reference: "o 1", metadata: { plan: "pro" } })).toBe(
      "https://layerhop.com/buy/prod_test_abc1?reference=o+1&metadata%5Bplan%5D=pro",
    );
    expect(() => buildBuyUrl("nope")).toThrow(/prod_/);
    expect(checkoutOrigin("http://localhost:3110/x/")).toBe("http://localhost:3110");
  });
});

describe("messages", () => {
  it("parses valid envelopes and rejects junk", () => {
    expect(parseCheckoutMessage(env("ready"))).toMatchObject({ type: "ready", sessionId: SID });
    expect(parseCheckoutMessage(env("resize", { height: 512 }))).toMatchObject({ height: 512 });
    expect(parseCheckoutMessage(env("status", { status: "processing" }))).toMatchObject({ status: "processing" });
    expect(parseCheckoutMessage(env("paid", { session: { id: SID, status: "paid" } }))).toMatchObject({ session: { id: SID } });
    for (const bad of [
      null, "x", env("nope"), { ...env("ready"), source: "layerhop" }, { ...env("ready"), version: 0 }, { ...env("ready"), sessionId: "x" },
      env("resize", { height: -1 }), env("resize", { height: "9" }), env("status", { status: "done" }), env("paid", { session: { id: "cs_other_123456" } }),
    ]) {
      expect(parseCheckoutMessage(bad)).toBeNull();
    }
  });

  it("accepts only the iframe's window, the checkout origin and the session", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const ok = { source: iframe.contentWindow, origin: "https://layerhop.com", data: env("ready") };
    expect(acceptCheckoutMessage(ok, iframe, "https://layerhop.com", SID)).not.toBeNull();
    expect(acceptCheckoutMessage({ ...ok, origin: "https://evil.example" }, iframe, "https://layerhop.com", SID)).toBeNull();
    expect(acceptCheckoutMessage({ ...ok, source: window }, iframe, "https://layerhop.com", SID)).toBeNull();
    expect(acceptCheckoutMessage({ ...ok, source: null }, iframe, "https://layerhop.com", SID)).toBeNull();
    expect(acceptCheckoutMessage(ok, iframe, "https://layerhop.com", "cs_test_other99")).toBeNull();
    expect(acceptCheckoutMessage(ok, null, "https://layerhop.com")).toBeNull();
  });
});

describe("product API", () => {
  it("creates a product session with reference and metadata", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(201, { id: SID, url: `https://layerhop.com/pay/${SID}` }));
    const s = await createProductSession("prod_test_abc1", { reference: "order_1", metadata: { plan: "pro" }, apiUrl: "https://api.example.com/", fetch: fetchFn as typeof fetch });
    expect(s.id).toBe(SID);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/checkout/products/prod_test_abc1/sessions");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(init.body as string)).toEqual({ reference: "order_1", metadata: { plan: "pro" } });
  });

  it("surfaces API errors with code and status", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(409, { error: { code: "CONFLICT", message: "This product is not available right now" } }));
    const err = await createProductSession("prod_test_abc1", { fetch: fetchFn as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(LayerHopCheckoutError);
    expect(err).toMatchObject({ code: "CONFLICT", status: 409, message: "This product is not available right now" });
    const net = await createProductSession("prod_test_abc1", { fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch }).catch((e) => e);
    expect(net.code).toBe("NETWORK_ERROR");
    await expect(createProductSession("bad")).rejects.toThrow(/prod_/);
  });

  it("reads a product", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { id: "prod_test_abc1", name: "Pro" }));
    await expect(getProduct("prod_test_abc1", { fetch: fetchFn as typeof fetch })).resolves.toMatchObject({ name: "Pro" });
    expect(fetchFn).toHaveBeenCalledWith("https://api.layerhop.com/v1/checkout/products/prod_test_abc1", expect.objectContaining({ method: "GET" }));
  });
});

describe("mountCheckout", () => {
  it("mounts an inline iframe that resizes and reports events", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cb = { onReady: vi.fn(), onStatus: vi.fn(), onPaid: vi.fn(), onCancel: vi.fn() };
    handle = mountCheckout(host, { sessionId: SID, ...cb });
    await expect(handle.sessionId).resolves.toBe(SID);
    await flush();
    const f = host.querySelector("iframe")!;
    expect(f).toBe(handle.iframe);
    expect(f.src).toBe(`https://layerhop.com/pay/${SID}?embed=1&origin=${encodeURIComponent(location.origin)}`);
    expect(f.style.height).toBe("600px");
    expect(f.style.colorScheme).toBe("normal");
    post(f, env("ready"));
    post(f, env("resize", { height: 731.4 }));
    post(f, env("status", { status: "paid" }));
    post(f, env("paid", { session: { id: SID } }));
    post(f, env("cancel"));
    post(f, env("resize", { height: 100 }), { origin: "https://evil.example" });
    expect(f.style.height).toBe("732px");
    expect(cb.onReady).toHaveBeenCalledTimes(1);
    expect(cb.onStatus).toHaveBeenCalledWith("paid");
    expect(cb.onPaid).toHaveBeenCalledWith({ id: SID });
    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    handle.close();
    expect(host.querySelector("iframe")).toBeNull();
    post(f, env("ready"));
    expect(cb.onReady).toHaveBeenCalledTimes(1);
  });

  it("starts a product session first, and reports failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, { id: SID })));
    const host = document.createElement("div");
    document.body.appendChild(host);
    handle = mountCheckout(host, { productId: "prod_test_abc1", reference: "r1", apiUrl: "https://api.example.com" });
    expect(host.getAttribute("aria-busy")).toBe("true");
    await handle.sessionId;
    await flush();
    expect(host.querySelector("iframe")?.src).toContain(`/pay/${SID}?embed=1`);
    handle.close();

    const onError = vi.fn();
    handle = mountCheckout(host, { sessionId: SID, productId: "prod_test_abc1", onError });
    await expect(handle.sessionId).rejects.toThrow(/exactly one/);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.any(LayerHopCheckoutError));
  });
});

describe("openCheckout (modal)", () => {
  const open = async (opts: Parameters<typeof openCheckout>[0]) => {
    handle = openCheckout(opts);
    await handle.sessionId.catch(() => undefined);
    await flush();
    return handle;
  };

  it("opens an accessible modal with the iframe and locks the page", async () => {
    const before = document.createElement("button");
    before.textContent = "Pay";
    const main = document.createElement("main");
    main.appendChild(before);
    document.body.appendChild(main);
    before.focus();
    const onReady = vi.fn();
    const h = await open({ sessionId: SID, onReady });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("LayerHop checkout");
    expect(document.getElementById("layerhop-checkout-style")).not.toBeNull();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(main.hasAttribute("inert")).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    const f = h.iframe!;
    expect(f.src).toBe(`https://layerhop.com/pay/${SID}?embed=modal&origin=${encodeURIComponent(location.origin)}`);
    const status = dialog.querySelector<HTMLElement>(".lhco-status")!;
    expect(status.hidden).toBe(false);
    post(f, env("ready"));
    expect(onReady).toHaveBeenCalled();
    expect(status.hidden).toBe(true);
    post(f, env("resize", { height: 690 }));
    expect(f.style.height).toBe("690px");
    h.close();
    expect(document.querySelector("[data-layerhop-checkout]")).toBeNull();
    expect(main.hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).toBe(before);
  });

  it("closes on Escape, backdrop, close and cancel messages, calling onClose once each", async () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    await open({ sessionId: SID, onClose });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("[data-layerhop-checkout]")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);

    await open({ sessionId: SID, onClose });
    document.querySelector<HTMLElement>(".lhco-backdrop")!.click();
    expect(onClose).toHaveBeenCalledTimes(2);

    let h = await open({ sessionId: SID, onClose });
    post(h.iframe!, env("close"));
    expect(onClose).toHaveBeenCalledTimes(3);

    h = await open({ sessionId: SID, onClose, onCancel });
    post(h.iframe!, env("cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(4);
    h.close();
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("keeps the modal open on paid and only one modal at a time", async () => {
    const onPaid = vi.fn();
    const first = await open({ sessionId: SID, onPaid });
    post(first.iframe!, env("paid", { session: { id: SID, status: "paid" } }));
    expect(onPaid).toHaveBeenCalledWith({ id: SID, status: "paid" });
    expect(document.querySelectorAll("[data-layerhop-checkout]")).toHaveLength(1);
    await open({ sessionId: "cs_test_second1" });
    expect(document.querySelectorAll("[data-layerhop-checkout]")).toHaveLength(1);
    expect(first.iframe!.isConnected).toBe(false);
  });

  it("shows an error with a close button when the product can't start", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(409, { error: { code: "CONFLICT", message: "This product is not available right now" } })));
    const onError = vi.fn();
    const onClose = vi.fn();
    await open({ productId: "prod_test_abc1", onError, onClose });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "CONFLICT" }));
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Not available right now");
    expect(document.querySelector("iframe")).toBeNull();
    alert.querySelector<HTMLButtonElement>(".lhco-btn")!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-layerhop-checkout]")).toBeNull();
  });
});
