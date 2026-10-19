import { defineConfig } from "tsup";

// @layerhop/ai (and through it @layerhop/sdk), zod, AgentKit and @solana/web3.js stay external.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["@layerhop/ai", "@layerhop/sdk", "zod", "@coinbase/agentkit", "@solana/web3.js"],
  treeshake: true,
});
