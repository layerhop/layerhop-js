import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BRIDGE_SCRIPT,
  LayerHopCheckout,
  LayerHopWidget,
  LayerHopWidgetError,
  buildEmbedUrl,
  originOf,
  widgetUrl,
  type CheckoutSession,
} from "../src/index.js";
import { native } from "./setup.js";

const last = () => {
  const views = native().webViews;
  return views[views.length - 1]!.props;
};

/** What react-native-webview hands `onMessage`: the bridged JSON and the page URL. */
const post = (data: unknown, url = "https://layerhop.com/embed?x=1") =>
  act(() => last().onMessage({ nativeEvent: { data: typeof data === "string" ? data : JSON.stringify(data), url } }));

const session = (over: Partial<CheckoutSession> = {}): CheckoutSession =>
  ({ id: "cs_test_abc123", object: "checkout.session", status: "paid", amount: "49000000", ...over }) as CheckoutSession;

describe("<LayerHopWidget />", () => {
  it("loads the same embed URL as @layerhop/widget, with the bridge injected", () => {
    const opts = { srcChain: "base", dstChain: "solana", dstToken: "SOL", amount: "25", theme: "light" as const, accent: "#22D3EE", integrator: "myapp", gasOnArrival: true };
    render(<LayerHopWidget {...opts} />);
    const p = last();
    expect(p.source.uri).toBe(buildEmbedUrl(opts));
    expect(p.source.uri).toContain("accent=22d3ee");
    expect(p.injectedJavaScriptBeforeContentLoaded).toBe(BRIDGE_SCRIPT);
    expect(p.injectedJavaScriptBeforeContentLoadedForMainFrameOnly).toBe(true);
    expect(p.originWhitelist).toEqual(["*"]);
    expect(screen.getByTestId("layerhop-widget").getAttribute("data-uri")).toBe(p.source.uri);
  });

  it("throws LayerHopWidgetError for invalid options during render, like the web component", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<LayerHopWidget accent="red" />)).toThrow(LayerHopWidgetError);
    expect(() => widgetUrl({ integrator: "Bad Id" })).toThrow(/integrator/);
    spy.mockRestore();
  });

  it("routes bridged events to typed callbacks, then onEvent; resizes; ignores other origins and junk", () => {
    const onReady = vi.fn();
    const onQuote = vi.fn();
    const onSubmitted = vi.fn();
    const onStatus = vi.fn();
    const onResize = vi.fn();
    const onWalletConnected = vi.fn();
    const onEvent = vi.fn();
    render(<LayerHopWidget {...{ onReady, onQuote, onSubmitted, onStatus, onResize, onWalletConnected, onEvent }} />);
    post({ source: "layerhop", type: "ready", payload: { version: "1.1.0" } });
    post({ source: "layerhop", type: "quote", payload: { provider: "relay", srcChain: "base", dstChain: "solana", amount: "1", dstAmount: "2" } });
    post({ source: "layerhop", type: "submitted", payload: { provider: "relay", srcChainId: 8453, srcTxHash: "0xabc" } });
    post({ source: "layerhop", type: "status", payload: { provider: "relay", srcTxHash: "0xabc", state: "filled" } });
    post({ source: "layerhop", type: "walletConnected", payload: { vm: "evm", address: "0x1" } });
    post({ source: "layerhop", type: "resize", payload: { height: 512.2 } });
    // Rejected: another origin, wrong source, malformed JSON, unknown type.
    post({ source: "layerhop", type: "ready", payload: { version: "evil" } }, "https://evil.example/embed");
    post({ source: "other", type: "ready", payload: {} });
    post("{not json");
    post({ source: "layerhop", type: "nope", payload: {} });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith({ version: "1.1.0" });
    expect(onQuote.mock.calls[0]![0]).toMatchObject({ provider: "relay", dstAmount: "2" });
    expect(onSubmitted).toHaveBeenCalledWith({ provider: "relay", srcChainId: 8453, srcTxHash: "0xabc" });
    expect(onStatus.mock.calls[0]![0].state).toBe("filled");
    expect(onWalletConnected).toHaveBeenCalledWith({ vm: "evm", address: "0x1" });
    expect(onResize).toHaveBeenCalledWith({ height: 512.2 });
    expect(onEvent).toHaveBeenCalledTimes(6);
    expect(onEvent.mock.calls.map((c) => c[0].type)).toEqual(["ready", "quote", "submitted", "status", "walletConnected", "resize"]);
  });

  it("uses the latest callbacks without reloading; a custom baseUrl changes the accepted origin", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<LayerHopWidget baseUrl="https://staging.layerhop.dev/app" onReady={first} />);
    const uri = last().source.uri;
    expect(uri).toBe("https://staging.layerhop.dev/app/embed");
    rerender(<LayerHopWidget baseUrl="https://staging.layerhop.dev/app" onReady={second} />);
    expect(last().source.uri).toBe(uri);
    post({ source: "layerhop", type: "ready", payload: { version: "1" } }, "https://layerhop.com/embed");
    post({ source: "layerhop", type: "ready", payload: { version: "1" } }, "https://staging.layerhop.dev/app/embed");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps wallet deep links and external pages out of the WebView and opens them with Linking", async () => {
    const opened: string[] = [];
    native().openURL.fn = async (url) => {
      opened.push(url);
    };
    const onExternalLink = vi.fn((url: string) => (url.includes("blocked") ? false : undefined));
    render(<LayerHopWidget onExternalLink={onExternalLink} />);
    const should = (url: string, isTopFrame = true) => last().onShouldStartLoadWithRequest({ url, isTopFrame });
    expect(should("https://layerhop.com/embed?amount=1")).toBe(true);
    expect(should("https://verify.walletconnect.org/frame", false)).toBe(true);
    expect(should("about:blank")).toBe(true);
    expect(should("wc:abc@2?relay-protocol=irn")).toBe(false);
    expect(should("metamask://wc?uri=wc%3Aabc")).toBe(false);
    expect(should("https://metamask.app.link/wc?uri=wc%3Aabc")).toBe(false);
    expect(should("https://basescan.org/tx/0x1")).toBe(false);
    expect(should("phantom://blocked")).toBe(false);
    expect(should("javascript:alert(1)")).toBe(false);
    last().onOpenWindow({ nativeEvent: { targetUrl: "https://solscan.io/tx/1" } });
    await Promise.resolve();
    expect(opened).toEqual([
      "wc:abc@2?relay-protocol=irn",
      "metamask://wc?uri=wc%3Aabc",
      "https://metamask.app.link/wc?uri=wc%3Aabc",
      "https://basescan.org/tx/0x1",
      "https://solscan.io/tx/1",
    ]);
    expect(onExternalLink).toHaveBeenCalledWith("phantom://blocked");
  });

  it("passes extra WebView props through but keeps the bridge and navigation handling", () => {
    const onLoadEnd = vi.fn();
    render(<LayerHopWidget webViewProps={{ onLoadEnd, injectedJavaScript: "evil()" } as never} />);
    expect(last().onLoadEnd).toBe(onLoadEnd);
    expect(last().injectedJavaScript).toBe(BRIDGE_SCRIPT);
  });
});

describe("<LayerHopCheckout />", () => {
  it("loads /pay/{sessionId} and maps checkout messages to callbacks (inline)", () => {
    const onReady = vi.fn();
    const onStatus = vi.fn();
    const onPaid = vi.fn();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    render(<LayerHopCheckout sessionId="cs_test_abc123" {...{ onReady, onStatus, onPaid, onCancel, onClose }} />);
    expect(last().source.uri).toBe("https://layerhop.com/pay/cs_test_abc123?embed=1");
    const msg = (m: Record<string, unknown>) => post({ source: "layerhop-checkout", version: 1, sessionId: "cs_test_abc123", ...m }, "https://layerhop.com/pay/cs_test_abc123?embed=1");
    msg({ type: "ready" });
    msg({ type: "status", status: "processing" });
    msg({ type: "paid", session: session() });
    msg({ type: "cancel" });
    msg({ type: "close" });
    // Another session's message is ignored.
    post({ source: "layerhop-checkout", version: 1, sessionId: "cs_test_other99", type: "ready" }, "https://layerhop.com/pay/x");
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("processing");
    expect(onPaid.mock.calls[0]![0].id).toBe("cs_test_abc123");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // inline pages have no close button
  });

  it("modal mode: the page's close button and cancel call onClose", () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(<LayerHopCheckout sessionId="cs_test_abc123" mode="modal" onClose={onClose} onCancel={onCancel} />);
    expect(last().source.uri).toBe("https://layerhop.com/pay/cs_test_abc123?embed=modal");
    const msg = (type: string) => post({ source: "layerhop-checkout", version: 1, sessionId: "cs_test_abc123", type }, "https://layerhop.com/pay/cs_test_abc123");
    msg("cancel");
    msg("close");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("creates a session for productId (loading state first), then loads it", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify(session({ id: "cs_test_new456", status: "open" })), { status: 200 });
    }) as typeof fetch;
    render(<LayerHopCheckout productId="prod_test_shirt" reference="order_7" metadata={{ plan: "pro" }} fetch={fetchFn} />);
    expect(screen.getByTestId("activity")).toBeTruthy();
    await waitFor(() => expect(native().webViews.length).toBeGreaterThan(0));
    expect(last().source.uri).toBe("https://layerhop.com/pay/cs_test_new456?embed=1");
    expect(calls[0]!.url).toBe("https://api.layerhop.com/v1/checkout/products/prod_test_shirt/sessions");
    expect(JSON.parse(calls[0]!.body)).toEqual({ reference: "order_7", metadata: { plan: "pro" } });
  });

  it("reports errors through onError: bad options and API failures", async () => {
    const onError = vi.fn();
    render(<LayerHopCheckout sessionId="nope" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toMatchObject({ name: "LayerHopCheckoutError", code: "INVALID_OPTIONS" });

    const onError2 = vi.fn();
    const fetchFn = (async () => new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Product is inactive" } }), { status: 409 })) as typeof fetch;
    render(<LayerHopCheckout productId="prod_test_shirt" fetch={fetchFn} onError={onError2} />);
    await waitFor(() => expect(onError2).toHaveBeenCalledTimes(1));
    expect(onError2.mock.calls[0]![0]).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(native().webViews.length).toBe(0);
  });
});

describe("bridge", () => {
  it("installs a window.parent that forwards only LayerHop envelopes to React Native", () => {
    const sent: string[] = [];
    const win = { ReactNativeWebView: { postMessage: (s: string) => sent.push(s) } } as Record<string, any>;
    // Evaluate the injected script with `window` bound to a fake window.
    new Function("window", BRIDGE_SCRIPT)(win);
    expect(win.parent).not.toBe(win);
    win.parent.postMessage({ source: "layerhop", type: "ready", payload: { version: "1" } }, "*");
    win.parent.postMessage({ source: "layerhop-checkout", version: 1, type: "ready", sessionId: "cs_test_abc123" }, "https://x");
    win.parent.postMessage({ source: "someone-else" }, "*");
    expect(sent.map((s) => JSON.parse(s).source)).toEqual(["layerhop", "layerhop-checkout"]);
    // Idempotent: a second injection keeps the same parent.
    const parent = win.parent;
    new Function("window", BRIDGE_SCRIPT)(win);
    expect(win.parent).toBe(parent);
  });

  it("originOf parses http(s) origins without URL", () => {
    expect(originOf("https://LayerHop.com:443/embed?x=1")).toBe("https://layerhop.com");
    expect(originOf("http://localhost:3000/embed")).toBe("http://localhost:3000");
    expect(originOf("https://user@evil.example/")).toBeNull();
    expect(originOf("wc:abc")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
