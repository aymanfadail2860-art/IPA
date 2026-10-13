import { describe, expect, it } from "vitest";

import { plainText } from "@/lib/egress/classification";
import { CONTROL_REFERENCES } from "@/lib/knowledge/core/control-references";
import {
  captureControlReference,
  compareWithReference,
  CONTROL_DRIFT_MARKER,
  controlSetChecksum,
  EMBEDDING_CONTROL_SET,
  embedControlSet,
  productionReferenceProblems,
  runControlCheck,
  withControlDriftMarker,
  type ControlReference,
} from "@/lib/knowledge/core/control-set";
import type { EmbeddingModelSpec, EmbeddingProvider } from "@/lib/knowledge/core/embedding";
import { ProviderError } from "@/lib/knowledge/core/provider";
import { hashEmbedding } from "@/lib/knowledge/core/test-embedder";
import type { Alert } from "@/lib/observability/alerts";

import { verifyForPublication } from "../../evals/engine/publication.ts";
import { checkEmbeddingControl, createControlGate, guardedEmbedderFor } from "../../workers/ingestion/control-check.ts";

import { buildReport, GATES_V1 } from "./fixtures/evaluation-report";
import { declaredProductionDoubles, fixtureMaterial } from "./fixtures/production-config";

/**
 * 8B-I8 C6 — the embedding control set (docs/08b §2.5, §15). A small, fixed, versioned set of
 * synthetic Danish texts is embedded and compared with an approved reference: dimensions and
 * invariants, the reference's identity (set, model, version label, settings, fingerprint part),
 * cosine to the reference and relations. Only an approved, calibrated reference captured through
 * a real provider path counts; a fake never does. A failure is never accepted automatically.
 *
 * Beta L2 (docs/beta.md §14): the code stays (B-035 §2.1) although the beta has no embedding model.
 * The "provider" here is a double with the removed Embed v4 adapter's declared descriptor that
 * answers like a model would: different vectors for queries and documents, related texts closer
 * than unrelated ones.
 */

const DIMENSIONS = 1024;
const DESCRIPTOR = declaredProductionDoubles().embedder.descriptor;
const MODEL: EmbeddingModelSpec = { id: "c6000000-0000-4000-8000-000000000001", provider: DESCRIPTOR.provider, model_name: DESCRIPTOR.model, model_version: DESCRIPTOR.modelVersion, dimensions: DESCRIPTOR.dimensions };

/** An embedding provider double with the declared descriptor: `answer` gives the vector per text and input type. */
function embedderAnswering(answer: (text: string, inputType: string) => number[]): EmbeddingProvider & { calls: { texts: string[]; inputType: string }[] } {
  const calls: { texts: string[]; inputType: string }[] = [];
  return {
    id: `${DESCRIPTOR.provider}:${DESCRIPTOR.model}@${DESCRIPTOR.modelVersion}`,
    grade: "development",
    dimensions: DESCRIPTOR.dimensions,
    descriptor: DESCRIPTOR,
    calls,
    async embed(texts, options) {
      const plain = texts.map((text) => plainText(text));
      calls.push({ texts: plain, inputType: options.inputType });
      return plain.map((text) => answer(text, options.inputType));
    },
  };
}

/** A model-like answer: input-type dependent, NOT the development fake's hash of the raw text. */
function modelVector(text: string, inputType: string, drift = 0): number[] {
  const base = hashEmbedding(`${inputType} ${text}`, DIMENSIONS).reverse();
  if (drift === 0) return base;
  const noise = hashEmbedding(`drift ${drift} ${text}`, DIMENSIONS);
  return base.map((value, i) => value + drift * noise[i]!);
}

function provider(options: { drift?: number; ignoreInputType?: boolean; dimensions?: number } = {}) {
  const embedder = embedderAnswering((text, inputType) => modelVector(text, options.ignoreInputType ? "document" : inputType, options.drift).slice(0, options.dimensions ?? DIMENSIONS));
  return { embedder, calls: embedder.calls };
}

const TOLERANCES = { version: 1, minCosineToReference: 0.995, minRelationalMargin: 0, calibration: "Kun til test: fastsat i testen, ikke kalibreret mod en rigtig udbyder." };
const APPROVAL = { decision: "B-999", approvedBy: "test", approvedAt: "2026-10-12T00:00:00.000Z" };

async function approvedReference(): Promise<ControlReference> {
  const draft = await captureControlReference(provider().embedder, { runtime: "evaluation", credentialSource: "github-oidc", capturedAt: "2026-10-12T00:00:00.000Z", runId: "test" });
  return { ...draft, tolerances: TOLERANCES, approval: APPROVAL };
}

describe("the control set", () => {
  it("is versioned, synthetic Danish insurance text, with both input types and valid relations", () => {
    const set = EMBEDDING_CONTROL_SET;
    expect(set).toMatchObject({ id: "embedding-control", version: 1 });
    // A change of the texts is a new version: the checksum is pinned here.
    expect(controlSetChecksum()).toBe("9759a7985043c43c57c90477523235d155c1e6f62c96e52b75044fc8a7075c1f");
    expect(Object.isFrozen(set) && Object.isFrozen(set.texts[0])).toBe(true);
    const ids = set.texts.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(set.texts.map((entry) => entry.inputType))).toEqual(new Set(["query", "document"]));
    for (const relation of set.relations) {
      for (const id of [relation.anchor, relation.closer, relation.farther]) expect(ids, id).toContain(id);
    }
    // Fictional: no CPR/CVR-like numbers, no e-mail addresses, no names of real persons.
    for (const entry of set.texts) expect(entry.text, entry.id).not.toMatch(/\d{6}-?\d{4}|\b\d{8}\b|@/);
  });

  it("is embedded as queries and documents through the egress boundary (evaluation_synthetic)", async () => {
    const { embedder, calls } = provider();
    const vectors = await embedControlSet(embedder);
    expect(Object.keys(vectors).sort()).toEqual(EMBEDDING_CONTROL_SET.texts.map((entry) => entry.id).sort());
    expect(calls.map((call) => call.inputType)).toEqual(["query", "document"]);
    // Only the set's own texts: nothing else can be classified this way.
    await expect(embedControlSet(embedder, { ...EMBEDDING_CONTROL_SET })).rejects.toThrow(/versionerede kontrolsæt/);
  });
});

describe("comparison with an approved reference", () => {
  it("passes for the same model", async () => {
    const reference = await approvedReference();
    expect(productionReferenceProblems(reference)).toEqual([]);
    const result = await runControlCheck(provider().embedder, reference);
    expect(result).toMatchObject({ status: "pass", problems: [] });
    expect(result.minCosine).toBeGreaterThan(0.999);
    expect(result.minMargin).toBeGreaterThan(0);
  });

  it("drift → fail (the provider changed the model behind the same id)", async () => {
    const result = await runControlCheck(provider({ drift: 0.5 }).embedder, await approvedReference());
    expect(result.status).toBe("fail");
    expect(result.problems.some((problem) => problem.startsWith("cosine:"))).toBe(true);
  });

  it("wrong dimension → fail", async () => {
    const reference = await approvedReference();
    const vectors = await embedControlSet(provider().embedder);
    const short = Object.fromEntries(Object.entries(vectors).map(([id, vector]) => [id, vector.slice(0, 512)]));
    expect(compareWithReference(short, reference, DESCRIPTOR).problems).toEqual(expect.arrayContaining(["dimensions:q-brand"]));
    // A provider that answers with the wrong dimension fails the check itself.
    const wrong = await runControlCheck(provider({ dimensions: 512 }).embedder, reference);
    expect(wrong.status).toBe("fail");
    expect(wrong.problems).toEqual(expect.arrayContaining(["dimensions:q-brand"]));
    const otherDimensions = { ...reference, model: { ...reference.model, dimensions: 1536 } };
    expect(compareWithReference(vectors, otherDimensions, DESCRIPTOR).status).toBe("fail");
  });

  it("wrong input type → fail (queries embedded as documents, or other input-type settings)", async () => {
    const reference = await approvedReference();
    const result = await runControlCheck(provider({ ignoreInputType: true }).embedder, reference);
    expect(result.status).toBe("fail");
    expect(result.problems).toEqual(expect.arrayContaining(["cosine:q-opbevaring", "cosine:q-brand", "cosine:q-cyber"]));
    expect(result.problems.some((problem) => problem.startsWith("cosine:d-"))).toBe(false);
    const otherSettings = { ...DESCRIPTOR, settings: { ...DESCRIPTOR.settings, inputTypeQuery: "search_document" } };
    expect(compareWithReference(await embedControlSet(provider().embedder), reference, otherSettings).problems).toEqual(expect.arrayContaining(["settings", "embedding_fingerprint"]));
  });

  it("wrong version → fail", async () => {
    const reference = await approvedReference();
    const otherVersion = { ...DESCRIPTOR, modelVersion: "eu-1024-v2" };
    expect(compareWithReference(await embedControlSet(provider().embedder), reference, otherVersion).problems).toEqual(expect.arrayContaining(["model_version", "embedding_fingerprint"]));
  });

  it("a relation that flips → fail, even when every vector is close", async () => {
    const reference = await approvedReference();
    const vectors = await embedControlSet(provider().embedder);
    const flipped = { ...vectors, "d-opbevaring": vectors["d-motor"]!, "d-motor": vectors["d-opbevaring"]! };
    expect(compareWithReference(flipped, { ...reference, vectors: flipped, tolerances: TOLERANCES }, DESCRIPTOR).problems).toContain("relation:q-opbevaring");
  });
});

describe("only an approved, calibrated real-provider capture can be the production reference", () => {
  it("a draft is neither approved nor calibrated", async () => {
    const draft = await captureControlReference(provider().embedder, { runtime: "evaluation", credentialSource: "github-oidc", capturedAt: "2026-10-12T00:00:00.000Z", runId: "x" });
    expect(productionReferenceProblems(draft)).toEqual(["tolerances_not_calibrated", "not_approved"]);
    expect((await runControlCheck(provider().embedder, draft)).status).toBe("fail");
  });

  it("a fake baseline can never be registered — not even approved and calibrated", async () => {
    // A development fake hashes the raw text (the test embedder, or 8B's fake transport).
    const fakeEmbedder = embedderAnswering((text) => hashEmbedding(text, DIMENSIONS));
    const captured = await captureControlReference(fakeEmbedder, { runtime: "evaluation", credentialSource: "github-oidc", capturedAt: "2026-10-12T00:00:00.000Z", runId: "x" });
    const forged = { ...captured, tolerances: TOLERANCES, approval: APPROVAL };
    expect(productionReferenceProblems(forged).filter((problem) => problem.startsWith("fake_vector:"))).toHaveLength(EMBEDDING_CONTROL_SET.texts.length);
    // A development capture path, or the test model, is refused too.
    const real = await approvedReference();
    expect(productionReferenceProblems({ ...real, capture: { ...real.capture, credentialSource: "development-default-chain" } })).toEqual(["not_a_real_provider_capture"]);
    expect(productionReferenceProblems({ ...real, model: { ...real.model, provider: "test" } })).toContain("development_model");
    expect(productionReferenceProblems({ ...real, controlSet: { ...real.controlSet, version: 2 } })).toContain("control_set");
    // And a comparison against such a reference never passes.
    expect((await runControlCheck(fakeEmbedder, forged)).status).toBe("fail");
  });

  it("every committed production reference is valid (none yet: VALIDATION PENDING)", () => {
    for (const reference of CONTROL_REFERENCES) expect(productionReferenceProblems(reference), `${reference.model.model}@${reference.model.modelVersion}`).toEqual([]);
    expect(CONTROL_REFERENCES).toHaveLength(0);
  });
});

describe("the worker: startup and daily check", () => {
  async function run(embedder: EmbeddingProvider | (() => never), references: readonly ControlReference[]) {
    const gate = createControlGate();
    const alerts: Alert[] = [];
    const logged: Record<string, unknown>[] = [];
    const embedderFor = () => (typeof embedder === "function" ? embedder() : embedder);
    await checkEmbeddingControl([MODEL], { embedderFor, references, gate, sink: { send: async (alert) => void alerts.push(alert) }, log: (event) => void logged.push(event) });
    return { gate, alerts, logged, guarded: guardedEmbedderFor(embedderFor as (model: EmbeddingModelSpec) => EmbeddingProvider, gate) };
  }

  it("pass → logged, the model stays in use", async () => {
    const { gate, alerts, logged } = await run(provider().embedder, [await approvedReference()]);
    expect(gate.blocked(MODEL.id)).toBe(false);
    expect(alerts).toEqual([]);
    expect(logged[0]).toMatchObject({ event: "embedding_control_passed", model: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1" });
  });

  it("fail → the model is no longer used (fail closed) and a critical alarm is raised — never accepted", async () => {
    const { gate, alerts, logged, guarded } = await run(provider({ drift: 0.5 }).embedder, [await approvedReference()]);
    expect(gate.blocked(MODEL.id)).toBe(true);
    expect(alerts.map((alert) => [alert.code, alert.severity])).toEqual([["embedding_model_changed", "critical"]]);
    expect(String(alerts[0]!.details.problems)).toMatch(/cosine:/);
    expect(JSON.stringify(alerts)).not.toMatch(/forsikring|Dækker/i);
    expect(logged[0]).toMatchObject({ event: "embedding_control_failed" });
    expect(() => guarded(MODEL)).toThrow(/kontrolsættet/);
  });

  it("no approved reference → unverified in the log; a provider error is not drift", async () => {
    const none = await run(provider().embedder, []);
    expect(none.logged).toEqual([{ event: "embedding_control_unverified", model: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1", reason: "no_approved_reference" }]);
    expect(none.gate.blocked(MODEL.id)).toBe(false);
    const failing = embedderAnswering(() => {
      throw new ProviderError("unavailable", "aws-bedrock", "nede", { httpStatus: 503 });
    });
    const down = await run(failing, [await approvedReference()]);
    expect(down.gate.blocked(MODEL.id)).toBe(false);
    expect(down.alerts).toEqual([]);
    expect(down.logged[0]).toMatchObject({ event: "embedding_control_error", provider_error_kind: "unavailable" });
  });
});

describe("the evaluation: drift becomes H6", () => {
  it("the runtime reports a marked model version, so the run fails H6 and is published as exactly that", () => {
    const declared = fixtureMaterial();
    const runtime = { ...declared, embedding: withControlDriftMarker(declared.embedding!) };
    expect(runtime.embedding.modelVersion).toBe(`${declared.embedding!.modelVersion}${CONTROL_DRIFT_MARKER}`);
    const report = buildReport({ configuration: declared, runtime });
    expect(report.configuration.matches).toBe(false);
    expect(report.hardGates.find((gate) => gate.id === "H6")).toMatchObject({ status: "fail" });
    expect(report).toMatchObject({ valid: false, verdict: "fail" });
    // Consistent H6: the database decides — suspension in service (C4), invalid otherwise.
    expect(verifyForPublication(report, GATES_V1)).toEqual({ ok: true });
  });

  it("the control texts never leave as anything but synthetic evaluation material", async () => {
    const { embedder } = provider();
    let seen: unknown[] = [];
    const spy: EmbeddingProvider = { ...embedder, embed: async (texts, options) => ((seen = [...seen, ...texts]), embedder.embed(texts, options)) };
    await embedControlSet(spy);
    expect(seen.map((text) => (text as { provenance: { category: string } }).provenance.category)).toEqual(Array(EMBEDDING_CONTROL_SET.texts.length).fill("evaluation_synthetic"));
    expect(seen.map((text) => plainText(text as never)).sort()).toEqual(EMBEDDING_CONTROL_SET.texts.map((entry) => entry.text).sort());
  });
});
