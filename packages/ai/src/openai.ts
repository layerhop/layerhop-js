import { toJsonSchema, type JsonObjectSchema } from "./json-schema.js";
import { createLayerHopTools, type LayerHopToolsOptions } from "./tools.js";

export { AGENT_INSTRUCTIONS, agentInstructions } from "./core/safety.js";

/** Chat Completions `tools[]` entry. */
export interface ChatCompletionFunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: JsonObjectSchema; strict?: boolean };
}

/** Responses API `tools[]` entry. */
export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonObjectSchema;
  strict: boolean;
}

export interface OpenAIToolkit {
  /** For `client.chat.completions.create({ tools })`. */
  chatCompletionsTools: ChatCompletionFunctionTool[];
  /** For `client.responses.create({ tools })`. */
  responsesTools: ResponsesFunctionTool[];
  /**
   * Execute a function call from the model. `args` is the JSON string (or parsed object) the model
   * produced. Always resolves to a string to send back as the tool output (errors start with "Error:").
   */
  handleToolCall(name: string, args: string | Record<string, unknown>): Promise<string>;
}

/**
 * LayerHop tools as plain OpenAI function-calling specs plus an executor. No OpenAI dependency:
 * works with the `openai` package, Azure OpenAI and any OpenAI-compatible API. For the OpenAI
 * Agents SDK use `@layerhop/ai/openai-agents`.
 */
export function createOpenAITools(opts: LayerHopToolsOptions = {}): OpenAIToolkit {
  const set = createLayerHopTools(opts);
  const specs = set.tools.map((t) => ({ name: t.name, description: t.description, parameters: toJsonSchema(t) }));
  return {
    chatCompletionsTools: specs.map((s) => ({ type: "function", function: s })),
    responsesTools: specs.map((s) => ({ type: "function", ...s, strict: false })),
    handleToolCall: async (name, args) => {
      let input: unknown = args;
      if (typeof args === "string") {
        try {
          input = args.trim() ? JSON.parse(args) : {};
        } catch {
          return `Error: arguments for ${name} are not valid JSON.`;
        }
      }
      const r = await set.call(name, input);
      return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
    },
  };
}
