import { defineConfig } from "tsup";

// @layerhop/ai (and through it @layerhop/sdk) and @elizaos/core (types only) stay external.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["@layerhop/ai", "@layerhop/sdk", "@elizaos/core"],
  treeshake: true,
});
