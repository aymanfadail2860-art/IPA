import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Beta L4b (docs/beta.md §17): the live harness's guards are fixed in code, and no ordinary test
 * run can ever reach it or see a real API key.
 */

const REPO = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(REPO, file), "utf8");
const harness = read("src/tests/live/l4b.live.ts");

describe("the L4b harness keeps to the approved plan", () => {
  it("the plan's numbers: four messages, 1.84 USD summed maximum, 3,000 output tokens, one attempt, effort low", () => {
    const plan = /export const L4B_PLAN = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(harness)?.[1] ?? "";
    expect(plan.replace(/\s+/g, " ").trim()).toBe('maxMessages: 4, maxTotalReservedUsd: 1.84, maxOutputTokens: 3000, maxAttempts: 1, effort: "low",');
  });

  it("every live guard reads the database, and a paid step needs an explicit confirmation", () => {
    // Sent = an attempt was opened; counted across reruns, for the model, from the database.
    expect(harness).toMatch(/from ai\.usage_reservations where model_id = \$\{modelId\} and attempts >= 1/);
    expect(harness).toMatch(/expect\(sent\.messages, "at most four messages in all"\)\.toBeLessThan\(L4B_PLAN\.maxMessages\)/);
    expect(harness).toMatch(/expect\(sent\.reservedUsd \+ expectedMaxUsd, "the summed maximum cost stays ≤ 1\.84 USD"\)/);
    expect(harness).toMatch(/status in \('pending', 'uncertain'\)/);
    expect(harness).toMatch(/expect\(process\.env\.IPA_L4B_CONFIRM, "IPA_L4B_CONFIRM=ja"\)\.toBe\("ja"\)/);
    expect(harness).toMatch(/expect\(fs\.existsSync\(HALT_FILE\)/);
    // A case is recorded before its call and never repeated.
    expect(harness).toMatch(/a case is never repeated/);
    const recorded = harness.indexOf("state.cases[id] = placeholder;\n    writeState(state);");
    expect(recorded).toBeGreaterThan(0);
    expect(recorded).toBeLessThan(harness.indexOf("ran = await runCase(c, model, state, expectedMaxUsd, \"live\");"));
  });

  it("the live calls use the application's own model factory; the ceiling test cannot send a message", () => {
    expect(harness).toMatch(/createModel\(modelId, runtimeEnv\(\), \{ anthropic: configuredAnthropicModel \}\)/);
    expect(harness).toMatch(/if \(new URL\(url\)\.pathname === "\/v1\/messages\/count_tokens"\) return globalThis\.fetch\(input, init\);/);
    expect(harness).toMatch(/messageAttempts \+= 1;\s*return new Response\(/);
  });

  it("the harness contains no model id, and its output stays out of Git", () => {
    expect(harness.match(/claude-[a-z0-9.-]+/g)?.filter((id) => id !== "claude-l4b-dry-run") ?? []).toEqual([]);
    expect(read(".gitignore")).toMatch(/^\/\.l4b\/$/m);
  });
});

describe("no ordinary test run reaches the harness or sees a real key", () => {
  it("the unit and integration configurations blank the key and include no live file", () => {
    for (const config of ["vitest.config.mts", "vitest.integration.config.mts"]) {
      const text = read(config);
      expect(text, config).toMatch(/env: \{ IPA_RUNTIME_ENV: "test", IPA_ANTHROPIC_API_KEY: "" \}/);
      expect(text, config).not.toMatch(/live|l4b/);
    }
  });

  it("only vitest.l4b.config.mts runs the harness, in IPA_RUNTIME_ENV=local", () => {
    const l4b = read("vitest.l4b.config.mts");
    expect(l4b).toMatch(/include: \["src\/tests\/live\/l4b\.live\.ts"\]/);
    expect(l4b).toMatch(/env: \{ IPA_RUNTIME_ENV: "local" \}/);
    expect(JSON.parse(read("package.json")).scripts.l4b).toBe("node --env-file=.env.local ./node_modules/vitest/vitest.mjs run -c vitest.l4b.config.mts");
    // The harness does nothing without a named step.
    expect(harness).toMatch(/const configured = Boolean\(STEP\) && integrationConfigured && workerConfigured && local;/);
  });
});
