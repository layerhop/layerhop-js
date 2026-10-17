import { afterEach, describe, expect, it, vi } from "vitest";
import { autoInit, getWidget, optionsFromDataset } from "../src/auto-init";
import { post } from "./helpers";

afterEach(() => {
  document.querySelectorAll("[data-layerhop-widget]").forEach((el) => getWidget(el)?.destroy());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("autoInit", () => {
  it("mounts widgets from data attributes, once", () => {
    document.body.innerHTML = `
      <div id="a" data-layerhop-widget data-src-chain="base" data-dst-chain="solana" data-theme="dark"
           data-lock-src data-hide-history="0" data-slippage-bps="30" data-accent="#22d3ee"></div>
      <div id="b" data-layerhop-widget data-base-url="http://localhost:3000" data-integrator="demo"></div>`;
    const handles = autoInit();
    expect(handles).toHaveLength(2);
    const a = document.querySelector<HTMLIFrameElement>("#a iframe")!;
    const params = Object.fromEntries(new URL(a.src).searchParams);
    expect(params).toEqual({
      srcChain: "base",
      dstChain: "solana",
      slippageBps: "30",
      theme: "dark",
      accent: "22d3ee",
      lockSrc: "1",
    });
    expect(document.querySelector<HTMLIFrameElement>("#b iframe")!.src).toBe(
      "http://localhost:3000/embed?integrator=demo",
    );
    expect(autoInit()).toHaveLength(0);
    expect(document.querySelectorAll("iframe")).toHaveLength(2);
  });

  it("re-dispatches events as layerhop:<type> CustomEvents on the host element", () => {
    document.body.innerHTML = `<div id="a" data-layerhop-widget></div>`;
    const [handle] = autoInit();
    const listener = vi.fn();
    document.body.addEventListener("layerhop:quote", listener);
    const payload = { provider: "relay", srcChain: "base", dstChain: "solana", amount: "1", dstAmount: "2" };
    post(handle!.iframe, { source: "layerhop", type: "quote", payload });
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual(payload);
  });

  it("skips elements with invalid attributes and logs", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<div data-layerhop-widget data-integrator="Bad_Name"></div><div data-layerhop-widget></div>`;
    expect(autoInit()).toHaveLength(1);
    expect(err).toHaveBeenCalled();
  });

  it("parses flags and numbers", () => {
    const el = document.createElement("div");
    el.setAttribute("data-lock-dst", "true");
    el.setAttribute("data-lock-src", "false");
    el.setAttribute("data-auto-resize", "0");
    el.setAttribute("data-radius", "12");
    el.setAttribute("data-max-width", "100%");
    el.setAttribute("data-height", "700");
    expect(optionsFromDataset(el)).toEqual({
      lockDst: true,
      lockSrc: false,
      autoResize: false,
      radius: 12,
      maxWidth: "100%",
      height: 700,
    });
  });
});

describe("embed.js entry", () => {
  it("auto-inits on import and exposes the API", async () => {
    document.body.innerHTML = `<div data-layerhop-widget data-src-chain="base"></div>`;
    const mod = await import("../src/embed");
    expect(typeof mod.mount).toBe("function");
    expect(typeof mod.autoInit).toBe("function");
    expect(document.querySelector("iframe")!.src).toBe("https://layerhop.com/embed?srcChain=base");
  });
});
