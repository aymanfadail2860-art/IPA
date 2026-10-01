import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Mock data never reaches a production database (CLAUDE.md §2: mock data must never be
 * mistaken for or mixed with production data). Migrations run everywhere, so they may not
 * contain development fixtures — those belong in scripts/seed-dev.mjs (local only).
 */
const dir = path.resolve(__dirname, "../../supabase/migrations");
const migrations = readdirSync(dir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => ({ file, text: readFileSync(path.join(dir, file), "utf8") }));

describe("migrations contain no development fixtures", () => {
  it("found the migrations", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(8);
  });

  it("creates no test embedding model and no index for one", () => {
    for (const { file, text } of migrations) {
      expect(text, file).not.toMatch(/insert\s+into\s+knowledge\.embedding_models/i);
      expect(text, file).not.toMatch(/test[-_]hash[-_]embedder/i);
    }
  });

  it("contains no seed identities, seed ids or fictional seed data", () => {
    for (const { file, text } of migrations) {
      expect(text, file).not.toMatch(/@ipa\.test/);
      expect(text, file).not.toMatch(/00000000-0000-4000-[ab]000-/);
      expect(text, file).not.toMatch(/Testvirksomhed|Testprodukt|Test Rådgiver/);
    }
  });
});
