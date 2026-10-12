import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 8B-I8 C5 — the CI workflow (docs/08b D-16, §17 pkt. 1). It runs every check a phase needs on
 * every push and pull request, from the locked lockfile, against a fresh local database — and
 * it never holds a production credential.
 */

const REPO = path.resolve(__dirname, "../..");
const ci = fs.readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8");
const code = ci.replace(/^\s*#.*$/gm, "");

describe("the CI workflow", () => {
  it("runs on pushes and pull requests", () => {
    expect(code).toMatch(/^on:\n  push:\n    branches: \[main, "claude\/\*\*"\]\n  pull_request:/m);
  });

  it("checks: locked install, lint, typecheck, unit tests and guardrails, evaluation data, build — in that order", () => {
    const steps = ["run: npm ci", "run: npm run lint", "run: npm run typecheck", "run: npm test", "src/tests/eval-retrieval-data.test.ts", "npm run eval:retrieval", "run: npm run build"];
    const positions = steps.map((step) => code.indexOf(step));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(code).not.toMatch(/npm install\b/);
  });

  it("database: a fresh local Supabase, every migration from scratch, pgTAP, the app and the integration tests", () => {
    const steps = ["npx supabase start", "npx supabase db reset --local", "npm run db:seed", "npx supabase test db", "npx next start -p 3300", "IPA_RUNTIME_ENV=production nohup npx next start -p 3302", "run: npm run test:integration"];
    const database = code.slice(code.indexOf("  database:"));
    const positions = steps.map((step) => database.indexOf(step));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("holds no production credential: no secrets, no AWS, no OIDC token, read-only", () => {
    expect(code).not.toMatch(/secrets\.|aws-actions|configure-aws-credentials|id-token|AWS_ACCESS_KEY|AWS_SECRET|vars\./);
    expect(code).toMatch(/^permissions:\n  contents: read\n/m);
    // The only keys are the local stack's own, written to the job's .env.local.
    expect(code).toMatch(/eval "\$\(npx supabase status -o env\)"/);
  });

  it("is documented with the required checks for branch protection", () => {
    const docs = fs.readFileSync(path.join(REPO, "docs/08b-production-foundation.md"), "utf8");
    for (const name of ["Lint, typecheck, unit, build, eval data", "Fresh database, pgTAP and integration"]) {
      expect(code).toContain(`name: ${name}`);
      expect(docs).toContain(name);
    }
  });
});
