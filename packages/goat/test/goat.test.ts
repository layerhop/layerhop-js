import { getTools, WalletClientBase, type Chain, type ToolBase } from "@goat-sdk/core";
import { describe, expect, it } from "vitest";
import { layerhop, LayerHopGoatPlugin } from "../src/index.js";
import { API, BASE_USDC, EVM, fakeApi, ROUTER, sameChainQuoteArgs, SOL } from "../../ai/test/fake-api.js";

/** A fake GOAT EVM wallet client: records transactions, signs nothing, holds no key. */
class FakeEvmWallet extends WalletClientBase {
  sent: { to: string; data?: string; value?: bigint }[] = [];
  constructor(private readonly allowance = 0n, private readonly chainId = 8453) {
    super();
  }
  getAddress() {
    return EVM;
  }
  getChain(): Chain {
    return { type: "evm", id: this.chainId, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } };
  }
  async signMessage(): Promise<{ signature: string }> {
    throw new Error("not used");
  }
  async balanceOf() {
    return { decimals: 18, symbol: "ETH", name: "Ether", value: "0", inBaseUnits: "0" };
  }
  async read(req: { functionName: string }) {
    expect(req.functionName).toBe("allowance");
    return { value: this.allowance };
  }
  async sendTransaction(tx: { to: string; data?: `0x${string}`; value?: bigint }) {
    this.sent.push(tx);
    return { hash: `0x${String(this.sent.length).repeat(64)}` };
  }
}

const opts = (api = fakeApi()) => ({ apiUrl: API, fetch: api.fetch, integrator: "goat-agent" });
const byName = (tools: ToolBase[], n: string) => tools.find((t) => t.name === n)!;

describe("GOAT plugin", () => {
  it("registers prefixed LayerHop tools next to the wallet's core tools", async () => {
    const wallet = new FakeEvmWallet();
    const tools = await getTools({ wallet, plugins: [layerhop(opts())] });
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_address", "layerhop_get_quote", "layerhop_build_transaction", "layerhop_execute_swap", "layerhop_create_checkout_session"]));
    expect(byName(tools, "layerhop_build_transaction").description).toMatch(/layerhop_get_quote/);
    // zod v3 schemas, as GOAT's adapters expect.
    expect(byName(tools, "layerhop_get_quote").parameters.safeParse(sameChainQuoteArgs).success).toBe(true);
  });

  it("quotes with channel api and the integrator", async () => {
    const api = fakeApi();
    const tools = await new LayerHopGoatPlugin(opts(api)).getTools(new FakeEvmWallet());
    const r = await byName(tools, "layerhop_get_quote").execute({ ...sameChainQuoteArgs });
    expect(r.best.quoteId).toBe("q_best");
    const q = api.last("/v1/quote")!.url.searchParams;
    expect(q.get("channel")).toBe("api");
    expect(q.get("integrator")).toBe("goat-agent");
  });

  it("executes a confirmed quote with the wallet client: approval, then swap, then report", async () => {
    const api = fakeApi();
    const wallet = new FakeEvmWallet(0n);
    const tools = await new LayerHopGoatPlugin(opts(api)).getTools(wallet);
    await byName(tools, "layerhop_get_quote").execute({ ...sameChainQuoteArgs });
    const r = await byName(tools, "layerhop_execute_swap").execute({ quoteId: "q_best", userConfirmed: true });
    expect(r.error).toBeUndefined();
    expect(wallet.sent.map((t) => t.to)).toEqual([BASE_USDC, ROUTER]);
    expect(wallet.sent[0]!.data!.startsWith("0x095ea7b3")).toBe(true);
    expect(wallet.sent[1]).toMatchObject({ data: "0xdeadbeef", value: 0n });
    expect(r).toMatchObject({ quoteId: "q_best", provider: "relay", reported: true });
    expect(api.calls.some((c) => c.url.pathname === "/v1/orders/q_best/submitted")).toBe(true);
  });

  it("skips the approval when the allowance is already there", async () => {
    const wallet = new FakeEvmWallet(10n ** 30n);
    const tools = await new LayerHopGoatPlugin(opts()).getTools(wallet);
    await byName(tools, "layerhop_get_quote").execute({ ...sameChainQuoteArgs });
    await byName(tools, "layerhop_execute_swap").execute({ quoteId: "q_best", userConfirmed: true });
    expect(wallet.sent.map((t) => t.to)).toEqual([ROUTER]);
  });

  it("refuses without explicit confirmation, for unknown quotes, and on the wrong chain", async () => {
    const wallet = new FakeEvmWallet();
    const tools = await new LayerHopGoatPlugin(opts()).getTools(wallet);
    const exec = byName(tools, "layerhop_execute_swap");
    expect((await exec.execute({ quoteId: "q_best", userConfirmed: false } as never)).error).toMatch(/userConfirmed/);
    expect((await exec.execute({ quoteId: "q_unknown", userConfirmed: true })).error).toMatch(/Unknown quoteId/);
    const other = new FakeEvmWallet(0n, 1);
    const tools2 = await new LayerHopGoatPlugin(opts()).getTools(other);
    await byName(tools2, "layerhop_get_quote").execute({ ...sameChainQuoteArgs });
    expect((await byName(tools2, "layerhop_execute_swap").execute({ quoteId: "q_best", userConfirmed: true })).error).toMatch(/Switch the wallet's network/);
    expect(wallet.sent).toHaveLength(0);
    expect(other.sent).toHaveLength(0);
  });

  it("can be quote-only", async () => {
    const tools = await new LayerHopGoatPlugin({ ...opts(), enableSwapExecution: false }).getTools(new FakeEvmWallet());
    expect(tools.some((t) => t.name === "layerhop_execute_swap")).toBe(false);
    expect(new LayerHopGoatPlugin().supportsChain({ type: "solana", nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 } })).toBe(true);
    expect(SOL).toBeTruthy();
  });
});
