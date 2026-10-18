import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerHopWidget } from "../src/react";
import { post } from "./helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("<LayerHopWidget>", () => {
  it("mounts an iframe, updates src on prop change, unmounts cleanly", () => {
    act(() => root.render(<LayerHopWidget srcChain="base" className="w" style={{ margin: 4 }} />));
    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.className).toBe("w");
    expect(wrapper.style.margin).toBe("4px");
    const iframe = container.querySelector("iframe")!;
    expect(iframe.src).toBe("https://layerhop.com/embed?srcChain=base");

    act(() => root.render(<LayerHopWidget srcChain="arbitrum" amount="10" className="w" />));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(iframe.src).toBe("https://layerhop.com/embed?srcChain=arbitrum&amount=10");

    // Removing a prop clears it from the URL.
    act(() => root.render(<LayerHopWidget srcChain="arbitrum" />));
    expect(iframe.src).toBe("https://layerhop.com/embed?srcChain=arbitrum");

    const remove = vi.spyOn(window, "removeEventListener");
    act(() => root.render(<></>));
    expect(container.querySelector("iframe")).toBeNull();
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
    remove.mockRestore();
  });

  it("calls the latest callback props without reloading", () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => root.render(<LayerHopWidget onQuote={first} />));
    const iframe = container.querySelector("iframe")!;
    const setSrc = vi.spyOn(iframe, "src", "set");
    act(() => root.render(<LayerHopWidget onQuote={second} />));
    const payload = { provider: "relay", srcChain: "base", dstChain: "solana", amount: "1", dstAmount: "2" };
    post(iframe, { source: "layerhop", type: "quote", payload });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(payload);
    expect(setSrc).not.toHaveBeenCalled();
  });

  it("remounts when baseUrl changes", () => {
    act(() => root.render(<LayerHopWidget />));
    const before = container.querySelector("iframe")!;
    act(() => root.render(<LayerHopWidget baseUrl="http://localhost:3000" />));
    const after = container.querySelector("iframe")!;
    expect(after).not.toBe(before);
    expect(after.src).toBe("http://localhost:3000/embed");
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });
});

describe("<LayerHopCheckout> / useLayerHopCheckout", () => {
  const SID = "cs_test_01jabc123";
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("mounts the inline checkout and forwards events to the latest callbacks", async () => {
    const { LayerHopCheckout } = await import("../src/react");
    const first = vi.fn();
    const second = vi.fn();
    act(() => root.render(<LayerHopCheckout sessionId={SID} className="co" onPaid={first} />));
    await act(flush);
    const iframe = container.querySelector("iframe")!;
    expect(iframe.src).toContain(`/pay/${SID}?embed=1`);
    expect(container.querySelector(".co")).not.toBeNull();
    act(() => root.render(<LayerHopCheckout sessionId={SID} className="co" onPaid={second} />));
    expect(container.querySelector("iframe")).toBe(iframe);
    post(iframe, { source: "layerhop-checkout", version: 1, type: "paid", sessionId: SID, session: { id: SID } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ id: SID });
    act(() => root.unmount());
    expect(iframe.isConnected).toBe(false);
    root = createRoot(container);
  });

  it("opens and closes the modal from a hook, closing on unmount", async () => {
    const { useLayerHopCheckout } = await import("../src/react");
    let api: ReturnType<typeof useLayerHopCheckout> | undefined;
    const onClose = vi.fn();
    function Shop() {
      api = useLayerHopCheckout({ onClose });
      return null;
    }
    act(() => root.render(<Shop />));
    act(() => void api!.open({ sessionId: SID }));
    expect(document.querySelector("[data-layerhop-checkout]")).not.toBeNull();
    act(() => api!.close());
    expect(document.querySelector("[data-layerhop-checkout]")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => void api!.open({ sessionId: SID }));
    act(() => root.unmount());
    expect(document.querySelector("[data-layerhop-checkout]")).toBeNull();
    root = createRoot(container);
  });
});
