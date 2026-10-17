import { defineConfig } from "tsup";

export default defineConfig([
  // Library entries: `@layerhop/widget` (core, no React) and `@layerhop/widget/react`.
  {
    entry: { index: "src/index.ts", react: "src/react.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
    external: ["react", "react/jsx-runtime"],
    treeshake: true,
  },
  // Drop-in <script> build: window.LayerHop.{mount, buildEmbedUrl, autoInit} + auto-init.
  {
    entry: { embed: "src/embed.ts" },
    format: ["iife"],
    globalName: "LayerHop",
    minify: true,
    sourcemap: true,
    clean: false,
    target: "es2018",
    outExtension: () => ({ js: ".js" }),
  },
]);
