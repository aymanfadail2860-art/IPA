import { describe, expect, it } from "vitest";

import { createDatabaseRetrieval } from "../../evals/engine/database-retrieval.ts";
import type { CorpusSnapshot, EvaluationEnvironment } from "../../evals/engine/evaluation-environment.ts";
import { evaluationEnvironmentFromEnv } from "../../evals/engine/evaluation-environment.ts";
import { createReranker } from "@/lib/knowledge/core/registry";

import { loadExample } from "./fixtures/eval-retrieval";
import { FIXTURE_MODEL, FIXTURE_USER, fixtureContext, fixtureDb, fixtureRow, productionProviders } from "./fixtures/production-config";

/**
 * 8B-I7 — the evaluation environment adapter (docs/08b §4.5) with a fake environment: the run
 * counts as the evaluation user only when the DATABASE confirms the identity (H7); the corpus is
 * read anew for the integrity check; the raw rows are kept for the leak check (H2).
 */

const inputs = loadExample();
const snapshot = (checksum: string): CorpusSnapshot => ({
  binding: { products: {}, documents: {}, conflicts: {} },
  texts: new Map(),
  chunkerVersions: { [fixtureRow(1).chunk_id]: "structure/1" },
  checksum,
  versions: new Map(),
});

function fakeEnvironment(authId: string, checksums: string[] = ["c1"]) {
  const calls: string[] = [];
  let reads = 0;
  const env: EvaluationEnvironment = {
    url: "http://evaluation.invalid",
    admin: null as never,
    assertEvaluation: async () => {},
    async signInUser(email) {
      calls.push(email);
      return { client: { schema: () => fixtureDb({ context: fixtureContext() }) } as never, userId: "identity-id", authId };
    },
    operator: async () => { throw new Error("not used"); },
    snapshot: async () => snapshot(checksums[Math.min(reads++, checksums.length - 1)]!),
  };
  return { env, calls };
}

function adapter(env: EvaluationEnvironment) {
  const providers = productionProviders();
  return createDatabaseRetrieval({
    env, manifest: inputs.set.manifest, snapshot: snapshot("c1"), embedder: providers.embedder, embeddingModelId: FIXTURE_MODEL.id,
    reranker: providers.reranker, baselineReranker: createReranker("none"),
  });
}

describe("the evaluation environment adapter", () => {
  const evalCase = inputs.set.cases.find((c) => !c.retired)!;

  it("runs as the case's evaluation user when the database confirms the identity — once per user", async () => {
    const { env, calls } = fakeEnvironment(FIXTURE_USER);
    const retrieval = adapter(env);
    const first = await retrieval.run(evalCase);
    await retrieval.run(evalCase);
    expect(first.actor).toBe(evalCase.actor);
    expect(calls).toEqual([`eval.${inputs.set.manifest.setId}.${evalCase.actor}@evaluation.invalid`]);
    // The SQL functions' rows are kept for H2; the identity read is not part of them.
    expect((first.raw as { fn: string }[]).map((entry) => entry.fn)).toContain("search_chunks");
    expect((first.raw as { fn: string }[]).map((entry) => entry.fn)).not.toContain("retrieval_context");
    expect(first.chunkerVersions).toEqual({ [fixtureRow(1).chunk_id]: "structure/1" });
  });

  it("a database that reports another identity makes the run someone else's (H7 fails)", async () => {
    const { env } = fakeEnvironment("00000000-0000-4000-8000-0000000000ff");
    expect((await adapter(env).run(evalCase)).actor).toBe(`unverified:${evalCase.actor}`);
  });

  it("reads the corpus anew for the integrity check, so a change during the run is seen (H7)", async () => {
    const { env } = fakeEnvironment(FIXTURE_USER, ["c1", "c2"]);
    const retrieval = adapter(env);
    expect(await retrieval.corpusChecksum()).toBe("c1");
    expect(await retrieval.corpusChecksum()).toBe("c2");
  });

  it("is 'evaluation' only by the database's word; the Q7 baseline runs without reranking and is not timed", async () => {
    const { env } = fakeEnvironment(FIXTURE_USER);
    const retrieval = adapter(env);
    expect(retrieval.environment).toBe("evaluation");
    expect(retrieval.withoutReranker()?.configuration().reranker.id).toBe("none");
  });
});

describe("the evaluation project's credentials", () => {
  it("come only from the IPA_EVAL_* variables — never the application's", () => {
    expect(evaluationEnvironmentFromEnv({ NEXT_PUBLIC_SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", NEXT_PUBLIC_SUPABASE_ANON_KEY: "z" })).toEqual({
      missing: ["IPA_EVAL_SUPABASE_URL", "IPA_EVAL_SUPABASE_ANON_KEY", "IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY"],
    });
    expect(evaluationEnvironmentFromEnv({ IPA_EVAL_SUPABASE_URL: "u", IPA_EVAL_SUPABASE_ANON_KEY: "a", IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY: "s" })).toEqual({ url: "u", anonKey: "a", serviceRoleKey: "s" });
  });
});
