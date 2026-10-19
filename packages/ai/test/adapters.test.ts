import { RunContext } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { createLangChainTools } from "../src/langchain.js";
import { createOpenAIAgentsTools } from "../src/openai-agents.js";
import { createOpenAITools } from "../src/openai.js";
import { createVercelTools } from "../src/vercel.js";
import { API, fakeApi, quoteArgs } from "./fake-api.js";

const opts = (api = fakeApi()) => ({ apiUrl: API, fetch: api.fetch, integrator: "myagent" });

describe("Vercel AI SDK adapter", () => {
  it("returns a ToolSet keyed by tool name whose execute runs the core tool", async () => {
    const api = fakeApi();
    const tools = createVercelTools(opts(api));
    expect(Object.keys(tools)).toContain("get_quote");
    const t = tools.get_quote!;
    expect(t.description).toMatch(/hold no private keys/);
    const out = (await t.execute!(quoteArgs, { toolCallId: "1", messages: [] } as never)) as any;
    expect(out.best.quoteId).toBe("q_best");
    expect(api.last("/v1/quote")!.url.searchParams.get("integrator")).toBe("myagent");
    const err = (await tools.build_transaction!.execute!({ quoteId: "bad" }, { toolCallId: "2", messages: [] } as never)) as any;
    expect(err.error).toMatch(/quoteId starts with q_/);
  });
});

describe("LangChain adapter", () => {
  it("creates DynamicStructuredTools that return JSON strings", async () => {
    const tools = createLangChainTools(opts());
    const t = tools.find((x) => x.name === "get_quote")!;
    const out = await t.invoke(quoteArgs);
    expect(JSON.parse(out as string).best.quoteId).toBe("q_best");
    const chains = tools.find((x) => x.name === "list_chains")!;
    expect(JSON.parse((await chains.invoke({})) as string).chains.length).toBeGreaterThan(3);
  });
});

describe("OpenAI function-calling adapter", () => {
  it("exposes JSON-schema specs and executes calls from JSON arguments", async () => {
    const kit = createOpenAITools(opts());
    const spec = kit.chatCompletionsTools.find((t) => t.function.name === "get_quote")!;
    expect(spec.type).toBe("function");
    expect(spec.function.parameters).toMatchObject({ type: "object", additionalProperties: false });
    expect(spec.function.parameters.required).toEqual(expect.arrayContaining(["fromChain", "amount", "sender"]));
    expect(kit.responsesTools[0]).toMatchObject({ type: "function", strict: false });
    const out = JSON.parse(await kit.handleToolCall("get_quote", JSON.stringify(quoteArgs)));
    expect(out.best.quoteId).toBe("q_best");
    expect(await kit.handleToolCall("get_quote", "{not json")).toMatch(/^Error: arguments for get_quote are not valid JSON/);
    expect(await kit.handleToolCall("transfer_all_funds", {})).toMatch(/^Error: Unknown tool/);
  });
});

describe("OpenAI Agents SDK adapter", () => {
  it("creates function tools the Agents SDK can invoke", async () => {
    const tools = createOpenAIAgentsTools(opts());
    const t = tools.find((x) => x.name === "get_quote")!;
    expect(t.type).toBe("function");
    expect(t.strict).toBe(false);
    const out = await t.invoke(new RunContext(), JSON.stringify(quoteArgs));
    expect(JSON.parse(out as string).best.quoteId).toBe("q_best");
  });
});
