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
