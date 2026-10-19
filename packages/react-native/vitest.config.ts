import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Test against the widget sources (no build needed). react-native and react-native-webview are
  // mocked in the tests (test/setup.tsx): their real entry points need the native runtime.
  resolve: { alias: { "@layerhop/widget": fileURLToPath(new URL("../widget/src/index.ts", import.meta.url)) } },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["test/setup.tsx"] },
});
