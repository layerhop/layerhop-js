import type { Action, IAgentRuntime, Memory } from "@elizaos/core";
import { describe, expect, it } from "vitest";
import { createLayerHopPlugin, layerhopPlugin, type LayerHopSignerService } from "../src/index.js";
import { API, BASE_USDC, EVM, fakeApi, ROUTER, sameChainQuoteArgs, TEST_KEY } from "../../ai/test/fake-api.js";

const USER = "00000000-0000-0000-0000-000000000001";
const AGENT = "00000000-0000-0000-0000-0000000000aa";
const ROOM = "00000000-0000-0000-0000-0000000000r1";

/** A fake ElizaOS runtime: settings, an in-memory cache, a scripted OBJECT_SMALL model and optional services. */
function fakeRuntime(settings: Record<string, string> = {}, services: Record<string, unknown> = {}, modelOutput: unknown = sameChainQuoteArgs) {
  const cache = new Map<string, unknown>();
  const prompts: string[] = [];
  const rt = {
    agentId: AGENT,
    getSetting: (k: string) => settings[k] ?? null,
    getService: (n: string) => services[n] ?? null,
    getCache: async (k: string) => cache.get(k),
    setCache: async (k: string, v: unknown) => (cache.set(k, v), true),
    deleteCache: async (k: string) => cache.delete(k),
    useModel: async (_type: string, p: { prompt: string }) => {
      prompts.push(p.prompt);
      return modelOutput;
    },
  };
  return { rt: rt as unknown as IAgentRuntime, cache, prompts };
}

/** A fake signing service: records requests, holds no key, signs nothing. */
function fakeSigner() {
  const sent: { to: string; data: string; value: string }[] = [];
  const svc: LayerHopSignerService = {
    getAddress: () => EVM,
    sendTransaction: async (req) => {
      sent.push({ to: req.to, data: req.data, value: req.value });
      return `0x${String(sent.length).repeat(64)}`;
    },
  };
  return { svc, sent };
}

const msg = (text: string, entityId = USER): Memory => ({ entityId, roomId: ROOM, content: { text } }) as unknown as Memory;
const action = (plugin: ReturnType<typeof createLayerHopPlugin>, name: string) => plugin.actions!.find((a) => a.name === name)! as Action;
const run = async (a: Action, rt: IAgentRuntime, m: Memory, options?: Record<string, unknown>) => {
  const replies: string[] = [];
  const result = await a.handler(rt, m, { values: {}, data: {}, text: "" } as never, options, async (c) => (replies.push(c.text ?? ""), []));
  return { result: result as { success: boolean; text?: string; data?: any; error?: string }, replies };
};

const base = (api = fakeApi()) => ({ apiUrl: API, fetch: api.fetch });

describe("ElizaOS plugin", () => {
  it("has the documented actions and provider", () => {
    expect(layerhopPlugin.name).toBe("layerhop");
    expect(layerhopPlugin.actions!.map((a) => a.name)).toEqual([
      "LAYERHOP_GET_QUOTE",
      "LAYERHOP_PREPARE_SWAP",
      "LAYERHOP_CONFIRM_SWAP",
      "LAYERHOP_CANCEL_SWAP",
      "LAYERHOP_ORDER_STATUS",
      "LAYERHOP_GET_PRICES",
      "LAYERHOP_CREATE_DEPOSIT_ADDRESS",
      "LAYERHOP_CREATE_CHECKOUT",
    ]);
    expect(layerhopPlugin.providers!.map((p) => p.name)).toEqual(["LAYERHOP"]);
  });

  it("quotes from model-extracted params with channel api and the integrator settings", async () => {
    const api = fakeApi();
    const plugin = createLayerHopPlugin(base(api));
    const { rt, prompts } = fakeRuntime({ LAYERHOP_INTEGRATOR: "eliza-agent", LAYERHOP_INTEGRATOR_FEE_BPS: "15" });
    const { result, replies } = await run(action(plugin, "LAYERHOP_GET_QUOTE"), rt, msg("swap 100 USDC on base to ETH"));
    expect(result.success).toBe(true);
    expect(replies[0]).toMatch(/LayerHop fee 0.2%/);
    expect(replies[0]).toMatch(/https:\/\/layerhop\.com\/swap\?/);
    expect(prompts[0]).toMatch(/get_quote/);
    const q = api.last("/v1/quote")!.url.searchParams;
    expect([q.get("channel"), q.get("integrator"), q.get("integratorFeeBps")]).toEqual(["api", "eliza-agent", "15"]);
  });

  it("without a signer, returns the unsigned transaction and never asks to sign", async () => {
    const plugin = createLayerHopPlugin(base());
    const { rt, cache } = fakeRuntime();
    await run(action(plugin, "LAYERHOP_GET_QUOTE"), rt, msg("quote"));
    const { result, replies } = await run(action(plugin, "LAYERHOP_PREPARE_SWAP"), rt, msg("swap it"));
    expect(result.success).toBe(true);
    expect(replies[0]).toMatch(/UNSIGNED transaction/);
    expect(result.data.transactionRequests.map((x: any) => x.kind)).toEqual(["approval", "swap"]);
    expect([...cache.keys()].some((k) => k.startsWith("layerhop:pending"))).toBe(false);
  });

  it("with a signer: prepare -> explicit confirm -> signer sends approval then swap", async () => {
    const api = fakeApi();
    const { svc, sent } = fakeSigner();
    const plugin = createLayerHopPlugin({ ...base(api), signerService: "wallet" });
    const { rt } = fakeRuntime({}, { wallet: svc });
    await run(action(plugin, "LAYERHOP_GET_QUOTE"), rt, msg("quote"));
    const prep = await run(action(plugin, "LAYERHOP_PREPARE_SWAP"), rt, msg("swap it"));
    expect(prep.replies[0]).toMatch(/NOT signed. Reply "confirm"/);
    expect(sent).toHaveLength(0); // preparing never signs

    const confirm = action(plugin, "LAYERHOP_CONFIRM_SWAP");
    expect(await confirm.validate(rt, msg("sounds interesting"))).toBe(false); // not a confirmation
    expect(await confirm.validate(rt, msg("confirm", "00000000-0000-0000-0000-000000000002"))).toBe(false); // another user
    expect(await confirm.validate(rt, msg("confirm", AGENT))).toBe(false); // the agent itself
    expect(await confirm.validate(rt, msg("confirm"))).toBe(true);

    const done = await run(confirm, rt, msg("confirm"));
    expect(done.result.success).toBe(true);
    expect(sent.map((s) => s.to)).toEqual([BASE_USDC, ROUTER]);
    expect(done.result.data).toMatchObject({ quoteId: "q_best", reported: true });
    // Single use: a second "confirm" does nothing.
    expect(await confirm.validate(rt, msg("confirm"))).toBe(false);
  });

  it("cancel discards the prepared swap", async () => {
    const { svc, sent } = fakeSigner();
    const plugin = createLayerHopPlugin({ ...base(), signerService: "wallet" });
    const { rt } = fakeRuntime({}, { wallet: svc });
    await run(action(plugin, "LAYERHOP_GET_QUOTE"), rt, msg("quote"));
    await run(action(plugin, "LAYERHOP_PREPARE_SWAP"), rt, msg("swap it"));
    const cancel = action(plugin, "LAYERHOP_CANCEL_SWAP");
    expect(await cancel.validate(rt, msg("cancel"))).toBe(true);
    await run(cancel, rt, msg("cancel"));
    expect(await action(plugin, "LAYERHOP_CONFIRM_SWAP").validate(rt, msg("confirm"))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("checkout and deposit actions need an API key; params can be passed programmatically", async () => {
    const api = fakeApi();
    const plugin = createLayerHopPlugin(base(api));
    const { rt: noKey } = fakeRuntime();
    expect(await action(plugin, "LAYERHOP_CREATE_CHECKOUT").validate(noKey, msg("payment link"))).toBe(false);
    const { rt } = fakeRuntime({ LAYERHOP_API_KEY: TEST_KEY });
    const { result, replies } = await run(action(plugin, "LAYERHOP_CREATE_CHECKOUT"), rt, msg("payment link"), {
      layerhop: { amount: "49", settleChain: "base", settleToken: "USDC", recipient: EVM },
    });
    expect(result.success).toBe(true);
    expect(replies[0]).toMatch(/pay\.layerhop\.com/);
    expect(api.last("/v1/checkout/sessions")!.body.amount).toBe("49000000");
  });

  it("the provider shares the safety rules and the pending swap", async () => {
    const { svc } = fakeSigner();
    const plugin = createLayerHopPlugin({ ...base(), signerService: "wallet" });
    const { rt } = fakeRuntime({}, { wallet: svc });
    await run(action(plugin, "LAYERHOP_GET_QUOTE"), rt, msg("quote"));
    await run(action(plugin, "LAYERHOP_PREPARE_SWAP"), rt, msg("swap it"));
    const p = await plugin.providers![0]!.get(rt, msg("hi"), { values: {}, data: {}, text: "" } as never);
    expect(p.text).toMatch(/never ask for or accept private keys/);
    expect(p.text).toMatch(/Pending swap awaiting the user's confirmation/);
    expect(p.values?.layerhopCanSign).toBe(true);
  });
});
