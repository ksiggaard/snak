import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest configuration. Mirrors the `@/` alias from `vite.config.ts` and runs
// in jsdom so DOM-dependent helpers (matchMedia, localStorage) are available.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
    },
  },
});
