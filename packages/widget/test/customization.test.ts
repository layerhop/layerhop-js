import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLOR_OPTIONS, LIVE_PARAMS, LayerHopWidgetError, WIDGET_EVENT_TYPES, WIDGET_OPTION_KEYS, buildEmbedUrl, liveParamsPatch, mount, normalizeOrigin, parseWidgetMessage,
  type WidgetHandle, type WidgetOptions,
} from "../src/core";
import { PRESETS, PRESET_IDS, WIDGET_PRESETS, autoInit, getWidget, optionsFromDataset } from "../src/index";
import { post } from "./helpers";

const q = (o: WidgetOptions) => Object.fromEntries(new URL(buildEmbedUrl(o)).searchParams);

describe("buildEmbedUrl: customization options", () => {
  it("maps every theme option to its URL param", () => {
    expect(
      q({
        theme: "auto", preset: "ocean", accent: "#22D3EE", accentText: "#000", bg: "0b1220", surface: "111827", surfaceAlt: "1f2937",
        text: "f9fafb", textMuted: "9ca3af", borderColor: "374151", success: "34d399", warning: "fbbf24", danger: "f87171",
        radius: 12, radiusInner: 8, font: "manrope", fontScale: 1.05, density: "compact", width: 420, shadow: "soft",
      }),
    ).toEqual({
      theme: "auto", preset: "ocean", accent: "22d3ee", accentText: "000", bg: "0b1220", surface: "111827", surfaceAlt: "1f2937",
      text: "f9fafb", textMuted: "9ca3af", border: "374151", success: "34d399", warning: "fbbf24", danger: "f87171",
      radius: "12", radiusInner: "8", font: "manrope", fontScale: "1.05", density: "compact", width: "420", shadow: "soft",
    });
  });

  it("maps content and behaviour options", () => {
    expect(
      q({
        headerTitle: "  Deposit  to   Acme ", hideHeader: true, logo: "https://acme.xyz/logo.svg", buttonLabel: "Deposit", showUsd: false, border: false,
        fromChains: ["base", 42161], toChains: ["SOLANA"], excludeChains: ["bsc"], fromTokens: ["base:USDC", "USDT"], toTokens: ["solana:So11111111111111111111111111111111111111112"],
        recipient: "0x1111111111111111111111111111111111111111", lockAmount: true, lockRecipient: true, hideRoutes: true, hideSettings: true,
        integrator: "acme", hidePoweredBy: true, locale: "en", allowParentOrigin: "https://acme.xyz/",
      }),
    ).toEqual({
      title: "Deposit to Acme", hideHeader: "1", logo: "https://acme.xyz/logo.svg", buttonLabel: "Deposit", showUsd: "0", border: "0",
      fromChains: "base,42161", toChains: "solana", excludeChains: "bsc", fromTokens: "base:USDC,USDT", toTokens: "solana:So11111111111111111111111111111111111111112",
      recipient: "0x1111111111111111111111111111111111111111", lockAmount: "1", lockRecipient: "1", hideRoutes: "1", hideSettings: "1",
      integrator: "acme", hidePoweredBy: "1", locale: "en", allowParentOrigin: "https://acme.xyz",
    });
  });

  it("omits defaults: showUsd true, fontScale 1, false flags", () => {
    expect(q({ showUsd: true, fontScale: 1, hideRoutes: false, lockAmount: false })).toEqual({});
    expect(q({ border: true })).toEqual({ border: "1" });
  });

  it.each<[string, WidgetOptions]>([
    ["preset", { preset: "neon" as never }],
    ["theme", { theme: "sepia" as never }],
    ["color", { surface: "red" }],
    ["4-digit color", { text: "#ffff" }],
    ["radiusInner", { radiusInner: 33 }],
    ["font", { font: "comic-sans" as never }],
    ["fontScale", { fontScale: 2 }],
    ["density", { density: "cozy" as never }],
    ["width", { width: 200 }],
    ["width float", { width: 400.5 }],
    ["shadow", { shadow: "huge" as never }],
    ["border + borderColor", { border: true, borderColor: "333" }],
    ["headerTitle length", { headerTitle: "x".repeat(33) }],
    ["headerTitle control chars", { headerTitle: "a\u0007b" }],
    ["buttonLabel length", { buttonLabel: "y".repeat(25) }],
    ["logo http", { logo: "http://acme.xyz/logo.png" }],
    ["logo javascript", { logo: "javascript:alert(1)" }],
    ["logo credentials", { logo: "https://u:p@acme.xyz/l.png" }],
    ["fromChains empty", { fromChains: [] }],
    ["fromChains junk", { fromChains: ["base;drop"] }],
    ["toTokens junk", { toTokens: ["base:<script>"] }],
    ["lockRecipient w/o recipient", { lockRecipient: true }],
    ["hidePoweredBy w/o integrator", { hidePoweredBy: true }],
    ["locale", { locale: "fr" as never }],
    ["origin with path", { allowParentOrigin: "https://acme.xyz/app" }],
    ["origin wildcard", { allowParentOrigin: "*" }],
    ["origin plain http", { allowParentOrigin: "http://acme.xyz" }],
  ])("rejects invalid %s", (_, o) => {
    expect(() => buildEmbedUrl(o)).toThrow(LayerHopWidgetError);
  });

  it("allows http origins for localhost only", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => normalizeOrigin("http://example.com")).toThrow();
  });

  it("lists every option key once, including the new ones", () => {
    expect(new Set(WIDGET_OPTION_KEYS).size).toBe(WIDGET_OPTION_KEYS.length);
    for (const k of [...Object.keys(COLOR_OPTIONS), "preset", "font", "fromTokens", "hidePoweredBy", "allowParentOrigin"]) expect(WIDGET_OPTION_KEYS).toContain(k);
  });
});

describe("presets", () => {
  it("exports every preset with full dark and light palettes", () => {
    expect(WIDGET_PRESETS).toBe(PRESETS);
    expect(PRESET_IDS).toEqual(["midnight", "paper", "lime", "ocean", "mono"]);
    for (const id of PRESET_IDS) {
      for (const mode of ["dark", "light"] as const) {
        const p = PRESETS[id][mode];
        expect(Object.keys(p)).toHaveLength(11);
        for (const v of Object.values(p)) expect(v).toMatch(/^[0-9a-f]{6}$/);
      }
    }
  });
});

describe("events added in embed 1.1", () => {
  it("parses and dispatches routes, wallet and amount events", () => {
    expect(WIDGET_EVENT_TYPES).toEqual(expect.arrayContaining(["routes", "walletConnected", "walletDisconnected", "amountChanged"]));
    expect(parseWidgetMessage({ source: "layerhop", type: "routes", payload: { count: 3, provider: "relay" } })).not.toBeNull();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cb = { onRoutes: vi.fn(), onWalletConnected: vi.fn(), onWalletDisconnected: vi.fn(), onAmountChanged: vi.fn(), onEvent: vi.fn() };
    const h = mount(host, cb);
    post(h.iframe, { source: "layerhop", type: "routes", payload: { count: 3, provider: "relay" } });
    post(h.iframe, { source: "layerhop", type: "walletConnected", payload: { vm: "evm", address: "0xabc" } });
    post(h.iframe, { source: "layerhop", type: "walletDisconnected", payload: { vm: "evm", address: "0xabc" } });
    post(h.iframe, { source: "layerhop", type: "amountChanged", payload: { amount: "5", srcChain: "base", srcToken: "0x1" } });
    expect(cb.onRoutes).toHaveBeenCalledWith({ count: 3, provider: "relay" });
    expect(cb.onWalletConnected).toHaveBeenCalledWith({ vm: "evm", address: "0xabc" });
    expect(cb.onWalletDisconnected).toHaveBeenCalledWith({ vm: "evm", address: "0xabc" });
    expect(cb.onAmountChanged).toHaveBeenCalledWith({ amount: "5", srcChain: "base", srcToken: "0x1" });
    expect(cb.onEvent).toHaveBeenCalledTimes(4);
    h.destroy();
  });
});

describe("liveParamsPatch", () => {
  const u = (o: WidgetOptions) => buildEmbedUrl(o);
  it("patches live params and refuses everything else", () => {
    expect(liveParamsPatch(u({ amount: "1", accent: "fff" }), u({ amount: "2", accent: "000", surface: "111" }))).toEqual({ amount: "2", accent: "000", surface: "111" });
    expect(liveParamsPatch(u({ amount: "1" }), u({}))).toEqual({ amount: "" });
    expect(liveParamsPatch(u({ accent: "fff" }), u({}))).toBeNull(); // removing a color needs a reload
    expect(liveParamsPatch(u({}), u({ radius: 4 }))).toBeNull();
    expect(liveParamsPatch(u({}), u({ borderColor: "333" }))).toBeNull();
    expect(LIVE_PARAMS).not.toContain("border");
  });
  it("respects locks", () => {
    expect(liveParamsPatch(u({ srcChain: "base", lockSrc: true }), u({ srcChain: "arbitrum", lockSrc: true }), { lockSrc: true })).toBeNull();
    expect(liveParamsPatch(u({ amount: "1", lockAmount: true }), u({ amount: "2", lockAmount: true }), { lockAmount: true })).toBeNull();
    expect(liveParamsPatch(u({ dstToken: "USDC" }), u({ dstToken: "USDT" }), {})).toEqual({ dstToken: "USDT" });
  });
});

describe("mount: width and live updates", () => {
  let host: HTMLDivElement;
  let handle: WidgetHandle | undefined;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    document.body.innerHTML = "";
  });

  it("widens the iframe to fit `width` unless maxWidth is given", () => {
    handle = mount(host, { width: 600 });
    expect(handle.iframe.style.maxWidth).toBe("616px");
    handle.destroy();
    handle = mount(host, { width: 600, maxWidth: "100%" });
    expect(handle.iframe.style.maxWidth).toBe("100%");
  });

  it("sends setParams instead of reloading once the embed is ready", () => {
    handle = mount(host, { liveUpdates: true, amount: "1" });
    const f = handle.iframe;
    expect(new URL(f.src).searchParams.get("allowParentOrigin")).toBe(window.location.origin);
    // Before `ready`, changes reload.
    handle.update({ amount: "2" });
    expect(new URL(f.src).searchParams.get("amount")).toBe("2");
    post(f, { source: "layerhop", type: "ready", payload: { version: "1.1.0" } });
    const sent: unknown[] = [];
    vi.spyOn(f.contentWindow!, "postMessage").mockImplementation((m: unknown, o?: unknown) => void sent.push([m, o]));
    const before = f.src;
    handle.update({ amount: "3", accent: "38bdf8" });
    expect(f.src).toBe(before);
    expect(sent).toEqual([[{ source: "layerhop-host", type: "setParams", payload: { amount: "3", accent: "38bdf8" } }, "https://layerhop.com"]]);
    // A non-live change reloads with the full, current options.
    handle.update({ radius: 8 });
    const p = new URL(f.src).searchParams;
    expect(p.get("radius")).toBe("8");
    expect(p.get("amount")).toBe("3");
    expect(p.get("accent")).toBe("38bdf8");
  });

  it("reloads on every change without liveUpdates", () => {
    handle = mount(host, { amount: "1" });
    post(handle.iframe, { source: "layerhop", type: "ready", payload: { version: "1.1.0" } });
    handle.update({ amount: "2" });
    expect(new URL(handle.iframe.src).searchParams.get("amount")).toBe("2");
    expect(new URL(handle.iframe.src).searchParams.get("allowParentOrigin")).toBeNull();
  });
});

describe("auto-init data attributes", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads every new option from kebab-case attributes", () => {
    document.body.innerHTML = `<div data-layerhop-widget data-preset="lime" data-theme="auto" data-accent-text="000" data-surface-alt="1f2937"
      data-border-color="333333" data-radius-inner="6" data-font="dm-sans" data-font-scale="0.95" data-density="compact" data-width="400"
      data-shadow="none" data-header-title="Bridge" data-hide-header data-logo="https://acme.xyz/l.png" data-button-label="Go" data-show-usd="0"
      data-from-chains="base, arbitrum" data-to-tokens="solana:USDC,USDT" data-exclude-chains="bsc" data-lock-amount data-hide-routes
      data-hide-settings data-integrator="acme" data-hide-powered-by data-locale="en" data-live-updates></div>`;
    const el = document.querySelector<HTMLElement>("[data-layerhop-widget]")!;
    const o = optionsFromDataset(el);
    expect(o).toMatchObject({
      preset: "lime", theme: "auto", accentText: "000", surfaceAlt: "1f2937", borderColor: "333333", radiusInner: 6, font: "dm-sans", fontScale: 0.95,
      density: "compact", width: 400, shadow: "none", headerTitle: "Bridge", hideHeader: true, logo: "https://acme.xyz/l.png", buttonLabel: "Go", showUsd: false,
      fromChains: ["base", "arbitrum"], toTokens: ["solana:USDC", "USDT"], excludeChains: ["bsc"], lockAmount: true, hideRoutes: true, hideSettings: true,
      integrator: "acme", hidePoweredBy: true, locale: "en", liveUpdates: true,
    });
    autoInit();
    const src = new URL(getWidget(el)!.iframe.src).searchParams;
    expect(src.get("border")).toBe("333333");
    expect(src.get("fromChains")).toBe("base,arbitrum");
    expect(src.get("allowParentOrigin")).toBe(window.location.origin);
    getWidget(el)!.destroy();
  });
});
