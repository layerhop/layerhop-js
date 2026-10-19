import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", actions: "src/actions.ts" },
  format: ["esm", "cjs"],
  // No path mapping here: @layerhop/react and @layerhop/sdk stay external (they are dependencies).
  tsconfig: "tsconfig.build.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  external: ["react", "react/jsx-runtime", "@tanstack/react-query", "wagmi", "wagmi/actions", "viem", "viem/actions", "@layerhop/sdk", "@layerhop/react"],
  treeshake: true,
});
