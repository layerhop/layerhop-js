import { defineConfig } from "tsup";

// Workspace packages (@layerhop/sdk, @layerhop/shared) are TypeScript sources that are not published,
// so they are bundled in. Only the MCP SDK and zod stay as runtime dependencies.
export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  target: "node20",
  platform: "node",
  noExternal: [/^@layerhop\//],
  external: ["@modelcontextprotocol/sdk", "zod"],
  treeshake: true,
});
