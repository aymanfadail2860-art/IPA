import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRedactor } from "@/lib/ai/core/redaction";

import { validateGateSet } from "../../evals/engine/schema.ts";
import { loadExample } from "./fixtures/eval-retrieval";

/**
 * 8B-I1 — de versionsstyrede evalueringsfiler (docs/08b §5.1) og grænsen mellem
 * evalueringsværktøjet og applikationen.
 */

const REPO = path.resolve(__dirname, "../..");
const EVALS = path.join(REPO, "evals");

function files(dir: string, filter: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "reports" ? [] : files(full, filter);
    return filter(full) ? [full] : [];
  });
}

describe("the versioned evaluation files", () => {
  it("gates-v1 holds exactly the approved initial thresholds (B-020, docs/08b §4.4)", () => {
    const gates = validateGateSet(JSON.parse(fs.readFileSync(path.join(EVALS, "retrieval/gates/gates-v1.json"), "utf8")));
    expect(gates).toMatchObject({ id: "gates", version: 1, decision: "B-020", k: 8 });
    expect(Object.fromEntries(Object.entries(gates.quality).map(([id, gate]) => [id, gate.threshold ?? gate.comparator]))).toEqual({
      Q1: 0.95,
      Q2: 0.85,
      Q3: 0.7,
      Q4: 0.8,
      Q5: 0.1,
      Q6: 0.1,
      Q7: "not_lower",
    });
  });

  it("no gate file contains a hard gate", () => {
    for (const file of files(path.join(EVALS, "retrieval/gates"), (name) => name.endsWith(".json"))) {
      expect(fs.readFileSync(file, "utf8")).not.toMatch(/"H[1-7]"/);
    }
  });

  it("every set validates, including its anchors and fixtures", () => {
    const inputs = loadExample();
    expect(inputs.set.cases.length).toBeGreaterThan(0);
    expect(inputs.verifyUnchanged()).toBeNull();
  });

  it("every fixture is fictional and says so", () => {
    const fixtures = files(path.join(EVALS, "retrieval/fixtures"), (name) => name.endsWith(".json"));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const file of fixtures) {
      const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(fixture.fictional, file).toBe(true);
      expect(fixture.notice, file).toMatch(/^FIKTIVT TESTMATERIALE/);
    }
    for (const document of loadExample().set.manifest.documents) expect(document.fictional).toBe(true);
  });

  it("contains no customer data: 8A's redaction detectors find nothing in sets and fixtures (docs/08b §5.1)", () => {
    const scanned = files(path.join(EVALS, "retrieval"), (name) => /\.(json|jsonl)$/.test(name) && !name.includes(`${path.sep}schema${path.sep}`));
    expect(scanned.length).toBeGreaterThan(5);
    for (const file of scanned) {
      const redactor = createRedactor();
      redactor.redact(fs.readFileSync(file, "utf8"));
      expect(redactor.counts, path.relative(REPO, file)).toEqual({});
    }
  });

  it("the detectors would catch customer data (the scan is not vacuous)", () => {
    const redactor = createRedactor();
    redactor.redact('{"question":"Kunden har CPR 010190-1234 og mail kunde@example.dk"}');
    expect(redactor.counts).toMatchObject({ cpr: 1, email: 1 });
  });
});

describe("the evaluation tooling stays outside the application", () => {
  const engine = files(path.join(EVALS, "engine"), (name) => /\.(ts|mjs)$/.test(name)).map((file) => ({ file: path.relative(REPO, file), text: fs.readFileSync(file, "utf8") }));
  const app = files(path.join(REPO, "src"), (name) => /\.(ts|tsx)$/.test(name) && !name.includes(`${path.sep}tests${path.sep}`));

  it("the application never imports the evaluation engine", () => {
    const offenders = app.filter((file) => /from ["'][^"']*evals\//.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the engine never issues or upgrades evidence, and never talks to a database itself", () => {
    expect(engine.length).toBeGreaterThan(5);
    for (const { file, text } of engine) {
      expect(text, file).not.toMatch(/\bissueEvidenceSet\b|\brequireProductionEvidence\b|as\s+ProductionEvidenceSet/);
      expect(text, file).not.toMatch(/@supabase\/|createClient\(|service_role|SERVICE_ROLE/);
      expect(text, file).not.toMatch(/grade:\s*["']production["']/);
    }
  });

  it("the report can never claim production eligibility", () => {
    const runner = engine.find(({ file }) => file.endsWith("runner.ts"))!.text;
    expect(runner).toMatch(/production: \{ eligible: false; reason: string \}/);
    expect(runner).toMatch(/production: \{ eligible: false, reason: NOT_PRODUCTION_REASON \}/);
  });

  it("only the registry constructs the development implementations the CLI uses", () => {
    const cli = engine.find(({ file }) => file.endsWith("cli.ts"))!.text;
    expect(cli).toMatch(/createEmbedder\(/);
    expect(cli).toMatch(/createReranker\(/);
    for (const { file, text } of engine) expect(text, file).not.toMatch(/\bcreate(NoneReranker|TestEmbedder)\(/);
  });
});
