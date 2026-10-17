import { defineConfig } from "tsup";

// The CLI ships as one self-contained file: @layerhop/sdk and @layerhop/shared are bundled in.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: false,
  dts: false,
  noExternal: [/^@layerhop\//, "zod"],
  banner: { js: "#!/usr/bin/env node" },
});
