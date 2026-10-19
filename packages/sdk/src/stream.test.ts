import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerHop, LayerHopApiError } from "./index.js";

/**
 * A minimal XMLHttpRequest that behaves like React Native's: `responseText` grows chunk by chunk
 * (readyState 3), then readyState 4 when the server closes the stream.
 */
class FakeXhr {
  static last: FakeXhr | null = null;
  static script: { status: number; chunks: string[]; networkError?: boolean } = { status: 200, chunks: [] };
  readyState = 0;
  status = 0;
  statusText = "";
  responseText = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  aborted = false;
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  abort() {
    this.aborted = true;
  }
  send() {
    const { status, chunks, networkError } = FakeXhr.script;
    void (async () => {
      await Promise.resolve();
      if (networkError) {
        this.readyState = 4;
        this.onerror?.();
        return;
      }
      this.status = status;
      this.statusText = status === 200 ? "OK" : "Not Found";
      this.readyState = 2;
      this.onreadystatechange?.();
      for (const c of chunks) {
        await new Promise((r) => setTimeout(r, 1));
        if (this.aborted) return;
        this.responseText += c;
        this.readyState = 3;
        this.onreadystatechange?.();
      }
      await new Promise((r) => setTimeout(r, 1));
      if (this.aborted) return;
      this.readyState = 4;
      this.onreadystatechange?.();
    })();
  }
}

const FRAMES = [
  "event: ready\ndata: {\"retryMs\":3000}\n\n: ping\n\nevent: order\ndata: {\"quoteId\":\"q_1\",\"status\":\"built\"}\r",
  "\n\r\nevent: order\ndata: {\"quoteId\":\"q_1\",\"status\":\"pending\"}\n\neve",
  "nt: order\ndata: {\"quoteId\":\"q_1\",\"status\":\"filled\"}\n\n",
];

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.last = null;
});

describe("SSE streams without a streaming fetch (React Native)", () => {
  it("auto mode uses XMLHttpRequest progress events in React Native and parses frames across chunks", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.stubGlobal("navigator", { product: "ReactNative" });
    FakeXhr.script = { status: 200, chunks: FRAMES };
    const lh = new LayerHop({ baseUrl: "http://x", apiKey: "lh_test_k" });
    const seen: string[] = [];
    for await (const o of lh.streamOrder("q_1")) seen.push(o.status);
    expect(seen).toEqual(["built", "pending", "filled"]);
    expect(FakeXhr.last!.method).toBe("GET");
    expect(FakeXhr.last!.url).toBe("http://x/v1/orders/q_1/events");
    expect(FakeXhr.last!.headers).toEqual({ accept: "text/event-stream", "x-api-key": "lh_test_k" });
  });

  it("xhr errors: API errors keep code/status/requestId; network failures throw TypeError (retryable)", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const lh = new LayerHop({ baseUrl: "http://x", streaming: "xhr" });
    FakeXhr.script = { status: 404, chunks: ['{"error":{"code":"ORDER_NOT_FOUND","message":"no such order","requestId":"r1"}}'] };
    const err = await lh.streamOrder("q_9").next().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LayerHopApiError);
    expect(err).toMatchObject({ code: "ORDER_NOT_FOUND", status: 404, requestId: "r1" });
    FakeXhr.script = { status: 0, chunks: [], networkError: true };
    await expect(lh.streamOrder("q_9").next()).rejects.toBeInstanceOf(TypeError);
  });

  it("aborting stops the xhr stream", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.script = { status: 200, chunks: FRAMES };
    const ctrl = new AbortController();
    const lh = new LayerHop({ baseUrl: "http://x", streaming: "xhr" });
    const seen: string[] = [];
    for await (const o of lh.streamOrder("q_1", { signal: ctrl.signal })) {
      seen.push(o.status);
      ctrl.abort();
    }
    expect(seen).toEqual(["built"]);
    expect(FakeXhr.last!.aborted).toBe(true);
  });

  it("a custom fetch always uses fetch; a response without a readable body is parsed when it completes", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.stubGlobal("navigator", { product: "ReactNative" });
    const text = FRAMES.join("");
    // whatwg-fetch style: no `body` stream, only text().
    const fetchFn = (async () => ({ ok: true, status: 200, statusText: "OK", body: null, text: async () => text, json: async () => ({}) })) as unknown as typeof fetch;
    const lh = new LayerHop({ baseUrl: "http://x", fetch: fetchFn });
    const seen: string[] = [];
    for await (const o of lh.checkout.stream("cs_1")) seen.push(String((o as unknown as { status: string }).status));
    expect(seen).toEqual([]); // checkout streams use `session` frames; none in this text
    for await (const o of lh.streamOrder("q_1")) seen.push(o.status);
    expect(seen).toEqual(["built", "pending", "filled"]);
    expect(FakeXhr.last).toBeNull();
  });
});
