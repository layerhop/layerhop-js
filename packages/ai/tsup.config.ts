import { defineConfig } from "tsup";

// @layerhop/shared is private and inlined; @layerhop/sdk, zod and the agent frameworks stay external
// (the frameworks are optional peers, imported only by their own subpath entry).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    core: "src/core/index.ts",
    vercel: "src/vercel.ts",
    langchain: "src/langchain.ts",
    openai: "src/openai.ts",
    "openai-agents": "src/openai-agents.ts",
  },
  format: ["esm", "cjs"],
  tsconfig: "tsconfig.build.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  noExternal: [/^@layerhop\/shared/],
  external: ["@layerhop/sdk", "zod", "ai", "@langchain/core", "@openai/agents"],
  treeshake: true,
});
