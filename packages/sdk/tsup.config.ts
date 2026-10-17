import { defineConfig } from "tsup";

// The published @layerhop/sdk is self-contained: @layerhop/shared is a private workspace package
// (chains, tokens, error codes, types), so it is inlined into the bundle and its types into the .d.ts.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  // tsconfig.build.json maps @layerhop/shared to its sources so the .d.ts inlines its types too.
  tsconfig: "tsconfig.build.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  noExternal: [/^@layerhop\//],
  treeshake: true,
});
