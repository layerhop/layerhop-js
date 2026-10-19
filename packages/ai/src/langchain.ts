import { DynamicStructuredTool } from "@langchain/core/tools";
import { createLayerHopTools, type LayerHopToolsOptions } from "./tools.js";

export { AGENT_INSTRUCTIONS, agentInstructions } from "./core/safety.js";

/**
 * LayerHop tools for LangChain JS / LangGraph (`DynamicStructuredTool`s). Each returns a JSON string;
 * errors come back as "Error: ..." so the model can correct itself.
 *
 *   const agent = createReactAgent({ llm, tools: createLangChainTools({ integrator: "myapp" }) });
 */
export function createLangChainTools(opts: LayerHopToolsOptions = {}): DynamicStructuredTool[] {
  const set = createLayerHopTools(opts);
  return set.tools.map(
    (t) =>
      new DynamicStructuredTool({
        name: t.name,
        description: t.description,
        schema: t.schema,
        func: async (input: unknown) => {
          const r = await t.run(input);
          return r.ok ? JSON.stringify(r.data, null, 2) : `Error: ${r.error}`;
        },
      }),
  );
}
