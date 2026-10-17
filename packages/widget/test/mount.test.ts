import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, parseWidgetMessage, type WidgetHandle } from "../src/core";
import { post } from "./helpers";

let host: HTMLDivElement;
let handle: WidgetHandle | undefined;

beforeEach(() => {
  host = document.createElement("div");
  host.id = "host";
  document.body.appendChild(host);
});
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.innerHTML = "";
});

describe("mount", () => {
  it("creates a configured iframe (element or selector target)", () => {
    handle = mount("#host", { srcChain: "base", theme: "light" });
    const f = handle.iframe;
    expect(host.contains(f)).toBe(true);
    expect(f.src).toBe("https://layerhop.com/embed?srcChain=base&theme=light");
    expect(f.title).toBe("LayerHop swap");
    expect(f.getAttribute("allow")).toBe("clipboard-write");
    expect(f.style.width).toBe("100%");
    expect(f.style.maxWidth).toBe("480px");
    expect(f.style.height).toBe("640px");
    expect(f.style.getPropertyValue("border-style") || f.style.border).toMatch(/0|none/);
    expect(f.style.colorScheme).toBe("normal");
  });

  it("throws for a missing selector", () => {
    expect(() => mount("#nope")).toThrow(/not found/);
  });

  it("dispatches typed callbacks for every event", () => {
    const cb = {
      onReady: vi.fn(),
      onQuote: vi.fn(),
      onSubmitted: vi.fn(),
      onStatus: vi.fn(),
      onError: vi.fn(),
      onResize: vi.fn(),
      onEvent: vi.fn(),
    };
    handle = mount(host, cb);
    const f = handle.iframe;
    const quote = { provider: "relay", srcChain: "base", dstChain: "solana", amount: "100", dstAmount: "0.6" };
    post(f, { source: "layerhop", type: "ready", payload: { version: "1.0.0" } });
    post(f, { source: "layerhop", type: "quote", payload: quote });
    post(f, { source: "layerhop", type: "submitted", payload: { provider: "relay", srcChainId: 8453, srcTxHash: "0xabc" } });
    post(f, { source: "layerhop", type: "status", payload: { provider: "relay", srcTxHash: "0xabc", state: "filled" } });
    post(f, { source: "layerhop", type: "error", payload: { code: "QUOTE_EXPIRED", message: "expired" } });
    post(f, { source: "layerhop", type: "resize", payload: { height: 512 } });
    expect(cb.onReady).toHaveBeenCalledWith({ version: "1.0.0" });
    expect(cb.onQuote).toHaveBeenCalledWith(quote);
    expect(cb.onSubmitted).toHaveBeenCalledWith({ provider: "relay", srcChainId: 8453, srcTxHash: "0xabc" });
    expect(cb.onStatus).toHaveBeenCalledWith({ provider: "relay", srcTxHash: "0xabc", state: "filled" });
    expect(cb.onError).toHaveBeenCalledWith({ code: "QUOTE_EXPIRED", message: "expired" });
    expect(cb.onResize).toHaveBeenCalledWith({ height: 512 });
    expect(cb.onEvent).toHaveBeenCalledTimes(6);
  });

  it("ignores messages with wrong origin, wrong source window, or wrong envelope", () => {
    const onReady = vi.fn();
    handle = mount(host, { onReady });
    const f = handle.iframe;
    const msg = { source: "layerhop", type: "ready", payload: { version: "1" } };
    post(f, msg, { origin: "https://evil.example" });
    post(f, msg, { origin: "http://layerhop.com" });
    post(f, msg, { source: window });
    post(f, msg, { source: null });
    post(f, { ...msg, source: "other" });
    post(f, { ...msg, type: "unknown" });
    post(f, { source: "layerhop", type: "ready" });
    post(f, "layerhop");
    expect(onReady).not.toHaveBeenCalled();
    post(f, msg);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("filters by the configured baseUrl origin", () => {
    const onReady = vi.fn();
    handle = mount(host, { baseUrl: "http://localhost:3000", onReady });
    const msg = { source: "layerhop", type: "ready", payload: { version: "1" } };
    post(handle.iframe, msg);
    expect(onReady).not.toHaveBeenCalled();
    post(handle.iframe, msg, { origin: "http://localhost:3000" });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("only listens to its own iframe when several are mounted", () => {
    const a = vi.fn();
    const b = vi.fn();
    const other = document.createElement("div");
    document.body.appendChild(other);
    handle = mount(host, { onReady: a });
    const h2 = mount(other, { onReady: b });
    post(h2.iframe, { source: "layerhop", type: "ready", payload: { version: "1" } });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    h2.destroy();
  });

  it("auto-resizes on resize events, and not when autoResize=false", () => {
    handle = mount(host, { height: 600 });
    expect(handle.iframe.style.height).toBe("600px");
    post(handle.iframe, { source: "layerhop", type: "resize", payload: { height: 721.2 } });
    expect(handle.iframe.style.height).toBe("722px");
    post(handle.iframe, { source: "layerhop", type: "resize", payload: { height: "9999" } });
    post(handle.iframe, { source: "layerhop", type: "resize", payload: { height: -5 } });
    expect(handle.iframe.style.height).toBe("722px");
    handle.destroy();

    const onResize = vi.fn();
    handle = mount(host, { autoResize: false, onResize });
    post(handle.iframe, { source: "layerhop", type: "resize", payload: { height: 300 } });
    expect(handle.iframe.style.height).toBe("640px");
    expect(onResize).toHaveBeenCalledWith({ height: 300 });
  });

  it("update() merges options, changes src only when the URL changes, and swaps callbacks", () => {
    handle = mount(host, { srcChain: "base", dstChain: "solana" });
    const f = handle.iframe;
    const setSrc = vi.spyOn(f, "src", "set");
    handle.update({ amount: "5" });
    expect(f.src).toBe("https://layerhop.com/embed?srcChain=base&dstChain=solana&amount=5");
    handle.update({ amount: "5" });
    expect(setSrc).toHaveBeenCalledTimes(1);
    handle.update({ theme: "light" });
    expect(f.style.colorScheme).toBe("normal");

    const first = vi.fn();
    const second = vi.fn();
    handle.update({ onReady: first });
    handle.update({ onReady: second });
    expect(setSrc).toHaveBeenCalledTimes(2);
    post(f, { source: "layerhop", type: "ready", payload: { version: "1" } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("update() with invalid options throws and keeps the old src", () => {
    handle = mount(host, { srcChain: "base" });
    expect(() => handle!.update({ accent: "nope" })).toThrow();
    expect(handle.iframe.src).toBe("https://layerhop.com/embed?srcChain=base");
  });

  it("destroy() removes the iframe and the message listener", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const onReady = vi.fn();
    const h = mount(host, { onReady });
    const f = h.iframe;
    const contentWindow = f.contentWindow;
    h.destroy();
    h.destroy();
    expect(host.contains(f)).toBe(false);
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "layerhop", type: "ready", payload: { version: "1" } },
        origin: "https://layerhop.com",
        source: contentWindow,
      }),
    );
    expect(onReady).not.toHaveBeenCalled();
    remove.mockRestore();
  });
});

describe("parseWidgetMessage", () => {
  it("accepts valid envelopes and rejects junk", () => {
    expect(parseWidgetMessage({ source: "layerhop", type: "ready", payload: { version: "1" } })).not.toBeNull();
    expect(parseWidgetMessage(null)).toBeNull();
    expect(parseWidgetMessage({ source: "layerhop", type: "resize", payload: { height: NaN } })).toBeNull();
    expect(parseWidgetMessage({ source: "layerhop", type: "toString", payload: {} })).toBeNull();
  });
});
