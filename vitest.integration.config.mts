import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Integration tests against a real (local) Supabase + dev seed. See docs/06 §11. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(root, "src") } },
  test: {
    environment: "node",
    include: ["src/tests/integration/**/*.integration.test.ts"],
    fileParallelism: false,
    // Explicit, never inherited from the shell (8B-I6 housekeeping): a test that needs another
    // runtime environment — or none — sets it itself.
    // The Claude API key is blanked: no test can see a real key, even in an environment that has
    // one (beta L4b, docs/beta.md §17).
    env: { IPA_RUNTIME_ENV: "test", IPA_ANTHROPIC_API_KEY: "" },
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
