import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Beta L4b only (docs/beta.md §17): the controlled live test, one step at a time
 * (IPA_L4B_STEP). Never part of `npm test` or the integration run. Runs in IPA_RUNTIME_ENV=local
 * against the LOCAL Supabase; the Claude API key comes from the environment and is never printed.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // The application's own model factory is imported unchanged; Next.js resolves this marker at build time.
      "server-only": path.resolve(root, "src/tests/live/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/tests/live/l4b.live.ts"],
    fileParallelism: false,
    env: { IPA_RUNTIME_ENV: "local" },
    testTimeout: 300000,
    hookTimeout: 120000,
  },
});
