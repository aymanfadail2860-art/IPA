import { beforeAll, describe, expect, it } from "vitest";

import { createEmbedder, createReranker } from "@/lib/knowledge/core/registry";
import { requireProductionEvidence, EvidenceGradeError } from "@/lib/knowledge/core/evidence";
import type { EmbeddingModelSpec } from "@/lib/knowledge/core/embedding";
import { runRetrieval, RetrievalError, type RetrievalRequest } from "@/lib/knowledge/retrieval-core";

import { buildPdf, longListFixturePages, type PdfPage } from "../fixtures/knowledge-pdfs";

import { anonClient, integrationConfigured, signedInClient, userIdOf, type SeedUserKey } from "./helpers";
import { RUN, runWorkerOnce, uploadVersion, workerConfigured, type UploadedVersion } from "./knowledge-helpers";

/**
 * Fase 7, trin 6 — retrieval mod den rigtige lokale Supabase med den rigtige worker, den
 * aktive (test-)embedding-model og rigtige brugersessioner (docs/07 §8, §15).
 *
 * retrieveEvidence (server-only) kører runRetrieval med den indloggede brugers klient og
 * implementeringerne fra registret; testen gør præcis det samme for hver seed-bruger.
 */

function today(offsetDays = 0): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

function termsPage(title: string, sentence: string): PdfPage[] {
  return [
    {
      lines: [
        { text: title, size: 16, bold: true },
        { text: "§ 4 Undtagelser", size: 13, bold: true, spaceBefore: 10 },
        { text: sentence, spaceBefore: 4 },
        { text: "Denne tekst er fiktiv og bruges kun i automatiske tests." },
      ],
    },
  ];
}

let activeModel: EmbeddingModelSpec;

async function search(key: SeedUserKey | "anon", request: RetrievalRequest) {
  const client = key === "anon" ? anonClient() : await signedInClient(key);
  return runRetrieval(request, {
    db: client.schema("knowledge"),
    embedding: { embedder: createEmbedder(activeModel, "test"), modelId: activeModel.id },
    reranker: createReranker("none", "test"),
  });
}

async function publish(versionId: string) {
  const admin = (await signedInClient("admin")).schema("knowledge");
  const review = await admin.rpc("start_review", { p_version_id: versionId });
  if (review.error) throw review.error;
  const approval = await admin.rpc("approve_version", { p_version_id: versionId, p_acknowledged_warnings: ["predecessor_superseded", "no_grants"] });
  if (approval.error) throw approval.error;
}

async function grant(documentId: string, key: SeedUserKey, permission: "knowledge.document.read" | "knowledge.document.read_historical") {
  const admin = (await signedInClient("admin")).schema("knowledge");
  const { error } = await admin
    .from("document_access_grants")
    .insert({ document_id: documentId, permission_key: permission, grantee_type: "user", user_id: await userIdOf(key) });
  if (error) throw error;
}

describe.skipIf(!integrationConfigured || !workerConfigured)("retrieval end to end", () => {
  let x1: UploadedVersion;
  let x2: UploadedVersion;
  let y: UploadedVersion;
  let list: UploadedVersion;
  let withdrawn: UploadedVersion;
  const xMarker = `kobolt${RUN}`;
  const yMarker = `zebra${RUN}`;
  const wMarker = `trækfugl${RUN}`;

  beforeAll(async () => {
    const admin = await signedInClient("admin");
    const { data: models, error } = await admin.schema("knowledge").rpc("active_embedding_model");
    if (error) throw error;
    activeModel = (models as EmbeddingModelSpec[])[0]!;

    x1 = await uploadVersion(admin, await buildPdf(termsPage(`Søgebetingelser X ${RUN}`, `Forsikringen dækker ikke gradvis forurening. Fiktiv markør ${xMarker} i første version.`)), {
      title: `Søgebetingelser X ${RUN}`,
      versionLabel: "1",
      validFrom: "2020-01-01",
    });
    y = await uploadVersion(admin, await buildPdf(termsPage(`Hemmelige betingelser Y ${RUN}`, `Hemmelig fiktiv klausul ${yMarker} om gradvis forurening.`)), {
      title: `Hemmelige betingelser Y ${RUN}`,
      validFrom: "2020-01-01",
    });
    list = await uploadVersion(admin, await buildPdf(longListFixturePages(50)), { title: `Listebetingelser ${RUN}`, validFrom: "2020-01-01" });
    withdrawn = await uploadVersion(admin, await buildPdf(termsPage(`Tilbagekaldte betingelser ${RUN}`, `Tilbagekaldt fiktiv klausul ${wMarker}.`)), {
      title: `Tilbagekaldte betingelser ${RUN}`,
      validFrom: "2020-01-01",
    });
    await runWorkerOnce();
    for (const version of [x1, y, list, withdrawn]) await publish(version.versionId);

    x2 = await uploadVersion(admin, await buildPdf(termsPage(`Søgebetingelser X ${RUN}`, `Forsikringen dækker ikke gradvis forurening. Fiktiv markør ${xMarker} i anden version.`)), {
      documentId: x1.documentId,
      versionLabel: "2",
      validFrom: today(),
    });
    await runWorkerOnce();
    await publish(x2.versionId);

    const { error: withdrawError } = await admin
      .schema("knowledge")
      .rpc("withdraw_version", { p_version_id: withdrawn.versionId, p_category: "invalid", p_reason: "Fiktiv fejl." });
    if (withdrawError) throw withdrawError;

    // advisorB: read + historical read on X, read on the list. advisorA: only read on X.
    await grant(x1.documentId, "advisorB", "knowledge.document.read");
    await grant(x1.documentId, "advisorB", "knowledge.document.read_historical");
    await grant(list.documentId, "advisorB", "knowledge.document.read");
    await grant(x1.documentId, "advisorA", "knowledge.document.read");
    await grant(withdrawn.documentId, "advisorB", "knowledge.document.read");
  }, 300_000);

  it("finds the current version of a granted document with the vector and the lexical retriever", async () => {
    const set = await search("advisorB", { query: xMarker });
    const item = set.items.find((entry) => entry.documentId === x1.documentId);
    expect(item).toBeDefined();
    expect(item!.documentVersionId).toBe(x2.versionId);
    expect(item!.validity.temporalStatus).toBe("current");
    expect(item!.excerpt.text).toContain(`${xMarker} i anden version`);
    expect(item!.relevance.reasons.map((reason) => reason.kind)).toEqual(expect.arrayContaining(["lexical_match", "vector_similarity", "fused_rank"]));
    expect(set.items.filter((entry) => entry.documentId === x1.documentId)).toHaveLength(1);
    expect(set.retrieval).toMatchObject({ grade: "development", embeddingModel: { id: "test:test-hash-embedder@1" }, reranker: { id: "none" } });
  });

  it("isolates documents: a verbatim unique phrase from a document without a grant gives 0 chunks", async () => {
    const set = await search("advisorB", { query: yMarker });
    expect(set.items.filter((entry) => entry.documentId === y.documentId)).toEqual([]);
    expect(JSON.stringify(set.items)).not.toContain(yMarker);
    const filtered = await search("advisorB", { query: yMarker, documentIds: [y.documentId] });
    expect(filtered.items).toEqual([]);
    expect(filtered.retrieval.candidateCount).toBe(0);
    // The administrator's role grants read with scope "all" — the document itself is findable.
    expect((await search("admin", { query: yMarker, documentIds: [y.documentId] })).items).toHaveLength(1);
  });

  it("gives an advisor without grants an empty result, and refuses an unauthenticated caller", async () => {
    const set = await search("advisorC", { query: "gradvis forurening", documentIds: [x1.documentId, y.documentId, list.documentId] });
    expect(set.items).toEqual([]);
    await expect(search("anon", { query: "gradvis forurening" })).rejects.toMatchObject({ name: "RetrievalError", code: "denied" });
    await expect(search("anon", { query: "gradvis forurening" })).rejects.toBeInstanceOf(RetrievalError);
  });

  it("returns the predecessor as historical only to a user with historical read access", async () => {
    const historical = await search("advisorB", { query: xMarker, mode: "as_of", asOf: "2022-01-01", documentIds: [x1.documentId] });
    expect(historical.items.map((item) => [item.documentVersionId, item.validity.temporalStatus])).toEqual([[x1.versionId, "historical"]]);
    expect(historical.items[0]!.authority.supersededBy).toBe(x2.versionId);
    expect(historical.signals.hasHistorical).toBe(true);
    expect((await search("advisorA", { query: xMarker, mode: "as_of", asOf: "2022-01-01", documentIds: [x1.documentId] })).items).toEqual([]);
    expect((await search("advisorA", { query: xMarker, documentIds: [x1.documentId] })).items.map((item) => item.documentVersionId)).toEqual([x2.versionId]);
  });

  it("never finds a withdrawn version — not for the administrator and not historically", async () => {
    for (const key of ["admin", "advisorB"] as const) {
      expect((await search(key, { query: wMarker, documentIds: [withdrawn.documentId] })).items).toEqual([]);
      expect((await search(key, { query: wMarker, mode: "as_of", asOf: "2021-01-01", documentIds: [withdrawn.documentId] })).items).toEqual([]);
    }
  });

  it("returns the exact source text and the repeated lead-in as separate context (B-005)", async () => {
    // A single page holds 50 list items: chunk 0 = lead-in + items 1–23, chunk 1 = items 24–46 (with the lead-in repeated).
    const set = await search("advisorB", { query: "fiktiv undtagelse nummer 37", documentIds: [list.documentId], topK: 1 });
    const item = set.items.find((entry) => entry.excerpt.text.includes("fiktiv undtagelse nummer 37,"));
    expect(item).toBeDefined();
    expect(item!.excerpt.leadIn).toBe("Forsikringen dækker heller ikke:");
    expect(item!.excerpt.text.startsWith("Forsikringen dækker heller ikke:")).toBe(false);
    expect(item!.sourceReference.label).toMatch(new RegExp(`^Listebetingelser ${RUN}, version 1, §7, side 1`));

    const client = (await signedInClient("advisorB")).schema("knowledge");
    const { data: chunks } = await client.from("document_chunks").select("id, text").in("id", item!.chunkIds).order("chunk_index");
    expect(chunks?.map((chunk) => chunk.id)).toEqual(item!.chunkIds);
    if (item!.chunkIds.length === 1) expect(item!.excerpt.text).toBe(chunks![0]!.text);
  });

  it("merges neighbouring chunks of the same section into one item with the exact source text", async () => {
    const set = await search("advisorB", { query: "fiktiv undtagelse nummer", documentIds: [list.documentId], topK: 20 });
    expect(set.items).toHaveLength(1);
    const [item] = set.items;
    expect(item!.chunkIds.length).toBeGreaterThan(1);
    const client = (await signedInClient("advisorB")).schema("knowledge");
    const { data: chunks } = await client.from("document_chunks").select("id, text, char_start, char_end").in("id", item!.chunkIds).order("chunk_index");
    // Consecutive list chunks are separated by one line break in the normalized text.
    expect(chunks!.every((chunk, i) => i === 0 || chunk.char_start === chunks![i - 1]!.char_end + 1)).toBe(true);
    expect(item!.excerpt.text).toBe(chunks!.map((chunk) => chunk.text).join("\n"));
    expect(item!.excerpt.leadIn).toBeNull();
  });

  it("is read-only: a search changes no knowledge rows", async () => {
    const admin = (await signedInClient("admin")).schema("knowledge");
    const snapshot = async () => {
      const versions = await admin.from("document_versions").select("id, status, valid_to, superseded_by, updated_at").in("document_id", [x1.documentId, y.documentId, list.documentId]).order("id");
      const counts = await Promise.all(
        ["document_versions", "document_chunks", "chunk_embeddings", "ingestion_jobs", "version_reviews", "document_access_grants"].map(async (table) => {
          const { count } = await admin.from(table).select("*", { count: "exact", head: true });
          return [table, count];
        }),
      );
      return JSON.stringify({ versions: versions.data, counts });
    };
    const before = await snapshot();
    await search("advisorB", { query: `pgtap-retrieval-${RUN} gradvis forurening` });
    await search("admin", { query: xMarker, mode: "as_of", asOf: "2022-01-01" });
    expect(await snapshot()).toBe(before);
  });

  it("produces development evidence that an AI module can never accept", async () => {
    const set = await search("advisorB", { query: xMarker });
    expect(set.items.length).toBeGreaterThan(0);
    expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
  });
});
