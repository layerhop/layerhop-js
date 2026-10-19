import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { assertStandardUrl, createReturnUrl, hasStandardUrl, isWalletDeepLink, navigationDecision, openWalletLink, useWalletReturn, type WalletReturnEvent } from "../src/index.js";
import { resetUrlSupportCache } from "../src/bridge.js";
import { native } from "./setup.js";

function Probe({ onReturn, scheme }: { onReturn: (e: WalletReturnEvent) => void; scheme?: string }) {
  useWalletReturn(onReturn, { scheme });
  return null;
}

const appState = (s: string) => act(() => native().appStateListeners.forEach((l) => l(s)));
const openUrl = (url: string) => act(() => native().urlListeners.forEach((l) => l({ url })));

describe("wallet deep links", () => {
  it("navigationDecision", () => {
    const o = "https://layerhop.com";
    expect(navigationDecision("https://layerhop.com/embed", o)).toBe("load");
    expect(navigationDecision("https://layerhop.com:443/x", o)).toBe("load");
    expect(navigationDecision("https://evil.layerhop.com.example/x", o)).toBe("external");
    expect(navigationDecision("https://other.example/x", o, false)).toBe("load");
    expect(navigationDecision("data:text/html,hi", o)).toBe("load");
    expect(navigationDecision("solflare://ul/v1/connect", o)).toBe("external");
    expect(navigationDecision("intent://wc#Intent;scheme=metamask;end", o)).toBe("external");
    expect(navigationDecision("javascript:void(0)", o)).toBe("block");
    expect(navigationDecision("not a url", o)).toBe("block");
    expect(isWalletDeepLink("wc:abc@2")).toBe(true);
    expect(isWalletDeepLink("https://metamask.app.link/x")).toBe(false);
  });

  it("createReturnUrl", () => {
    expect(createReturnUrl("myapp")).toBe("myapp://");
    expect(createReturnUrl("MyApp://", "/swap/done", { order: "q 1" })).toBe("myapp://swap/done?order=q%201");
    expect(() => createReturnUrl("https")).toThrow();
    expect(() => createReturnUrl("my app")).toThrow();
  });

  it("openWalletLink resolves false when no app handles the link", async () => {
    native().openURL.fn = async () => {
      throw new Error("No app");
    };
    expect(await openWalletLink("phantom://ul/connect")).toBe(false);
    native().openURL.fn = async () => undefined;
    expect(await openWalletLink("phantom://ul/connect")).toBe(true);
    expect(await openWalletLink("javascript:alert(1)")).toBe(false);
  });

  it("useWalletReturn: foreground once per hand-off, and app URLs with the scheme", async () => {
    const events: WalletReturnEvent[] = [];
    const other: WalletReturnEvent[] = [];
    const { unmount } = render(
      <>
        <Probe onReturn={(e) => events.push(e)} scheme="myapp" />
        <Probe onReturn={(e) => other.push(e)} />
      </>,
    );
    appState("active"); // no hand-off yet
    expect(events).toEqual([]);
    native().openURL.fn = async () => undefined;
    await openWalletLink("metamask://wc?uri=x");
    appState("background");
    appState("active");
    appState("active"); // only once
    expect(events).toEqual([{ reason: "foreground" }]);
    expect(other).toEqual([{ reason: "foreground" }]);
    openUrl("otherapp://x");
    openUrl("myapp://swap?ok=1");
    expect(events).toEqual([{ reason: "foreground" }, { reason: "url", url: "myapp://swap?ok=1" }]);
    expect(other).toHaveLength(1);
    unmount();
    expect(native().urlListeners.size).toBe(0);
    expect(native().appStateListeners.size).toBe(0);
  });
});

describe("URL support", () => {
  it("detects a non-standard URL (old React Native) and explains the fix", () => {
    const Real = globalThis.URL;
    class BrokenUrl {
      constructor(public href: string) {}
      get searchParams(): never {
        throw new Error("not implemented");
      }
    }
    vi.stubGlobal("URL", BrokenUrl);
    resetUrlSupportCache();
    try {
      expect(hasStandardUrl()).toBe(false);
      expect(() => assertStandardUrl()).toThrow(/react-native-url-polyfill/);
    } finally {
      vi.stubGlobal("URL", Real);
      vi.unstubAllGlobals();
      resetUrlSupportCache();
    }
    expect(hasStandardUrl()).toBe(true);
  });
});
