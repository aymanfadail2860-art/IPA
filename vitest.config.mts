import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/tests/integration/**", "node_modules/**"],
    // Explicit, never inherited from the shell (8B-I6 housekeeping): a test that needs another
    // runtime environment — or none — sets it itself.
    env: { IPA_RUNTIME_ENV: "test" },
  },
});
