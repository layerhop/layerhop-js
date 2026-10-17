import { describe, expect, it } from "vitest";
import { buildEmbedUrl, LayerHopWidgetError, normalizeAccent, resolveEmbedEndpoint } from "../src/core";

const params = (u: string) => Object.fromEntries(new URL(u).searchParams);

describe("buildEmbedUrl", () => {
  it("defaults to https://layerhop.com/embed with no params", () => {
    expect(buildEmbedUrl()).toBe("https://layerhop.com/embed");
  });

  it("maps every option to the contract param", () => {
    const u = buildEmbedUrl({
      srcChain: "base",
      srcToken: "USDC",
      dstChain: 7565164,
      dstToken: "SOL",
      amount: "100.5",
      recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      slippageBps: 50,
      theme: "light",
      accent: "#22D3EE",
      radius: 16,
      lockSrc: true,
      lockDst: true,
      hideHistory: true,
      integrator: "my-app",
    });
    expect(new URL(u).pathname).toBe("/embed");
    expect(params(u)).toEqual({
      srcChain: "base",
      srcToken: "USDC",
      dstChain: "7565164",
      dstToken: "SOL",
      amount: "100.5",
      recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      slippageBps: "50",
      theme: "light",
      accent: "22d3ee",
      radius: "16",
      lockSrc: "1",
      lockDst: "1",
      hideHistory: "1",
      integrator: "my-app",
    });
  });

  it("omits false flags and empty strings", () => {
    const u = buildEmbedUrl({ lockSrc: false, hideHistory: false, srcChain: "", recipient: "  " });
    expect(params(u)).toEqual({});
  });

  it("honors a custom baseUrl (with or without path / trailing slash / /embed)", () => {
    expect(buildEmbedUrl({ theme: "dark" }, "http://localhost:3000")).toBe("http://localhost:3000/embed?theme=dark");
    expect(buildEmbedUrl({}, "http://localhost:3000/")).toBe("http://localhost:3000/embed");
    expect(buildEmbedUrl({}, "http://localhost:3000/embed")).toBe("http://localhost:3000/embed");
    expect(buildEmbedUrl({}, "https://x.dev/app/")).toBe("https://x.dev/app/embed");
    expect(resolveEmbedEndpoint("https://x.dev/a?q=1#h").toString()).toBe("https://x.dev/a/embed");
  });

  it("validates accent", () => {
    expect(normalizeAccent("#0AF")).toBe("0af");
    expect(normalizeAccent("22d3ee80")).toBe("22d3ee80");
    for (const bad of ["red", "#12345", "#gggggg", "##22d3ee"]) {
      expect(() => buildEmbedUrl({ accent: bad })).toThrow(LayerHopWidgetError);
    }
  });

  it("validates integrator", () => {
    expect(params(buildEmbedUrl({ integrator: "a".repeat(32) })).integrator).toHaveLength(32);
    for (const bad of ["", "MyApp", "my_app", "a".repeat(33), "app!"]) {
      expect(() => buildEmbedUrl({ integrator: bad })).toThrow(/integrator/);
    }
  });

  it("validates amount, slippage, radius, theme and baseUrl", () => {
    expect(params(buildEmbedUrl({ amount: "0.5" })).amount).toBe("0.5");
    for (const bad of ["1,5", "-1", "1e6", "abc", "1.2.3"]) {
      expect(() => buildEmbedUrl({ amount: bad })).toThrow(/amount/);
    }
    expect(() => buildEmbedUrl({ slippageBps: 1.5 })).toThrow(/slippageBps/);
    expect(() => buildEmbedUrl({ slippageBps: 10_001 })).toThrow(/slippageBps/);
    expect(() => buildEmbedUrl({ radius: -1 })).toThrow(/radius/);
    expect(() => buildEmbedUrl({ theme: "blue" as never })).toThrow(/theme/);
    expect(() => buildEmbedUrl({}, "not a url")).toThrow(/baseUrl/);
    expect(() => buildEmbedUrl({}, "javascript:alert(1)")).toThrow(/baseUrl/);
  });
});
