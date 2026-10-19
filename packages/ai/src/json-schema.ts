import { z } from "zod/v4";
import type { LayerHopTool } from "./tools.js";

export type JsonObjectSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
  [k: string]: unknown;
};

/** A tool's input as a plain JSON Schema object (for function calling, MCP-style hosts, etc.). */
export function toJsonSchema(tool: Pick<LayerHopTool, "schema">): JsonObjectSchema {
  const { $schema: _drop, ...rest } = z.toJSONSchema(tool.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return { ...rest, type: "object", properties: (rest.properties as Record<string, unknown>) ?? {}, required: (rest.required as string[]) ?? [], additionalProperties: false } as JsonObjectSchema;
}
