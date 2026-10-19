import { defineConfig } from "tsup";

// @layerhop/ai (and through it @layerhop/sdk), zod and the GOAT SDK stay external.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["@layerhop/ai", "@layerhop/sdk", "zod", "@goat-sdk/core"],
  treeshake: true,
});
