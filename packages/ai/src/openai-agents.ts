import { tool, type FunctionTool } from "@openai/agents";
import { toJsonSchema } from "./json-schema.js";
import { createLayerHopTools, type LayerHopToolsOptions } from "./tools.js";

export { AGENT_INSTRUCTIONS, agentInstructions } from "./core/safety.js";

/**
 * LayerHop tools for the OpenAI Agents SDK (`@openai/agents`). Non-strict JSON-schema tools: the
 * input is validated by LayerHop's own schema, and errors come back as "Error: ..." text.
 *
 *   const agent = new Agent({ name: "Swapper", instructions: AGENT_INSTRUCTIONS, tools: createOpenAIAgentsTools() });
 */
export function createOpenAIAgentsTools(opts: LayerHopToolsOptions = {}): FunctionTool[] {
  const set = createLayerHopTools(opts);
  return set.tools.map(
    (t) =>
      tool({
        name: t.name,
        description: t.description,
        // Non-strict tools take additionalProperties: true; LayerHop's schema strips unknown keys anyway.
        parameters: { ...toJsonSchema(t), additionalProperties: true as const },
        strict: false,
        execute: async (input: unknown) => {
          const r = await t.run(input);
          return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
        },
      }) as unknown as FunctionTool,
  );
}
