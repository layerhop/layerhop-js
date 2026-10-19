import { tool, type Tool } from "ai";
import { createLayerHopTools, type LayerHopToolsOptions } from "./tools.js";

export { AGENT_INSTRUCTIONS, agentInstructions } from "./core/safety.js";

/**
 * LayerHop tools for the Vercel AI SDK: pass the result as `tools` to generateText / streamText /
 * an Agent. Errors come back as `{ error }` so the model can correct itself.
 *
 *   const result = await generateText({ model, tools: createVercelTools({ integrator: "myapp" }), prompt });
 */
export function createVercelTools(opts: LayerHopToolsOptions = {}): Record<string, Tool> {
  const set = createLayerHopTools(opts);
  return Object.fromEntries(
    set.tools.map((t) => [
      t.name,
      tool({
        title: t.title,
        description: t.description,
        inputSchema: t.schema,
        execute: async (input: unknown) => {
          const r = await t.run(input);
          return r.ok ? r.data : { error: r.error };
        },
      }) as Tool,
    ]),
  );
}
