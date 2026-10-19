import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Test against @layerhop/react's sources (no build needed first).
  resolve: { alias: { "@layerhop/react": fileURLToPath(new URL("../react/src/index.ts", import.meta.url)) } },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"] },
});
