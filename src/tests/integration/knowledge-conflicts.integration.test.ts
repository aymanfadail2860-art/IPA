import { beforeAll, describe, expect, it } from "vitest";

import { RESTRICTED_CONFLICT_MESSAGE } from "@/lib/knowledge/core/evidence";
import type { EmbeddingModelSpec } from "@/lib/knowledge/core/embedding";
import { createEmbedder, createReranker } from "@/lib/knowledge/core/registry";
import { runRetrieval, type RetrievalRequest } from "@/lib/knowledge/retrieval-core";

import { buildPdf, type PdfPage } from "../fixtures/knowledge-pdfs";

import { integrationConfigured, signedInClient, userIdOf, type SeedUserKey } from "./helpers";
import { RUN, runProduct, runWorkerOnce, uploadVersion, workerConfigured, type UploadedVersion } from "./knowledge-helpers";

/**
 * Fase 7, trin 7 — konflikter mod den rigtige lokale Supabase (docs/07 §11, §15 "Konflikter"
 * og "Konfliktlæk"). Kilde A og B har samme (testkørslens egen) produkt og dokumenttype og
 * overlappende gyldighed, så publiceringen af B registrerer en overlapping_scope-konflikt.
 *
 *   advisorA: læseadgang til A, ikke til B   → kun den neutrale indikator
 *   advisorB: læseadgang til A og B          → begge som fuld evidens
 */

function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());
}

function page(title: string, heading: string, sentence: string): PdfPage[] {
  return [{ lines: [{ text: title, size: 16, bold: true }, { text: heading, size: 13, bold: true, spaceBefore: 10 }, { text: sentence, spaceBefore: 4 }] }];
}

let activeModel: EmbeddingModelSpec;

async function search(key: SeedUserKey, request: RetrievalRequest) {
  return runRetrieval(request, {
    db: (await signedInClient(key)).schema("knowledge"),
    embedding: { embedder: createEmbedder(activeModel, "test"), modelId: activeModel.id },
    reranker: createReranker("none", "test"),
  });
}

async function rpc(key: SeedUserKey, fn: string, args: Record<string, unknown>) {
  return (await signedInClient(key)).schema("knowledge").rpc(fn, args);
}

describe.skipIf(!integrationConfigured || !workerConfigured)("conflicts end to end", () => {
  let a: UploadedVersion;
  let b: UploadedVersion;
  let bChunkIds: string[];
  let bChunk: { page_start: number; section_number: string | null; heading: string | null; text: string };
  let scopeConflictId: string;
  let manualConflictId: string;
  const aMarker = `ankerklausul${RUN}`;
  const bTitle = `Hemmelig modpart ${RUN}`;
  const bLabel = `Modpartversion-${RUN}`;
  const bHeading = `§ 9 Skjult afsnit ${RUN}`;
  const bSentence = `Skjult fiktiv modsigelse ${RUN}: virksomheder med ${aMarker} accepteres altid.`;
  const description = `Fiktiv beskrivelse ${RUN} af modstriden`;
  const note = `Fiktiv note ${RUN} om løsningen`;

  beforeAll(async () => {
    const admin = await signedInClient("admin");
    const { data: models } = await admin.schema("knowledge").rpc("active_embedding_model");
    activeModel = (models as EmbeddingModelSpec[])[0]!;
    const productId = await runProduct(admin, "Konflikt");

    a = await uploadVersion(admin, await buildPdf(page(`Acceptregler A ${RUN}`, "§ 2 Accept", `Virksomheder med ${aMarker} accepteres ikke (fiktivt).`)), {
      title: `Acceptregler A ${RUN}`,
      productId,
      documentType: "acceptance_rules",
      validFrom: "2020-01-01",
    });
    b = await uploadVersion(admin, await buildPdf(page(bTitle, bHeading, bSentence)), {
      title: bTitle,
      productId,
      documentType: "acceptance_rules",
      versionLabel: bLabel,
      validFrom: "2022-01-01",
    });
    await runWorkerOnce();
    const knowledge = admin.schema("knowledge");
    for (const version of [a, b]) {
      expect((await knowledge.rpc("start_review", { p_version_id: version.versionId })).error).toBeNull();
      expect((await knowledge.rpc("approve_version", { p_version_id: version.versionId, p_acknowledged_warnings: [] })).error).toBeNull();
    }

    for (const [document, key] of [[a, "advisorA"], [a, "advisorB"], [b, "advisorB"]] as const) {
      const { error } = await knowledge
        .from("document_access_grants")
        .insert({ document_id: document.documentId, permission_key: "knowledge.document.read", grantee_type: "user", user_id: await userIdOf(key) });
      if (error) throw error;
    }

    const { data: chunks } = await knowledge.from("document_chunks").select("id, page_start, section_number, heading, text").eq("document_version_id", b.versionId);
    bChunkIds = (chunks ?? []).map((chunk) => chunk.id as string);
    bChunk = chunks![0] as typeof bChunk;
    const { data: aChunks } = await knowledge.from("document_chunks").select("id").eq("document_version_id", a.versionId);

    const { data: passages } = await knowledge.from("conflict_passages").select("conflict_id, side, document_version_id").eq("document_version_id", b.versionId);
    scopeConflictId = (passages ?? [])[0]?.conflict_id as string;

    const flagged = await knowledge.rpc("flag_conflict", {
      p_description: description,
      p_passages: [
        { side: "A", version_id: a.versionId, chunk_id: aChunks![0]!.id },
        { side: "B", version_id: b.versionId, chunk_id: bChunkIds[0] },
      ],
    });
    if (flagged.error) throw flagged.error;
    manualConflictId = flagged.data as string;
  }, 300_000);

  it("registers a structural candidate when the second source is published", async () => {
    const knowledge = (await signedInClient("admin")).schema("knowledge");
    const { data: conflict } = await knowledge.from("conflicts").select("status, detected_by, detection_rule").eq("id", scopeConflictId).single();
    expect(conflict).toEqual({ status: "open", detected_by: "system", detection_rule: "overlapping_scope" });
    const { data: passages } = await knowledge.from("conflict_passages").select("side, document_version_id, chunk_id").eq("conflict_id", scopeConflictId).order("side");
    expect(passages).toEqual([
      { side: "A", document_version_id: b.versionId, chunk_id: null },
      { side: "B", document_version_id: a.versionId, chunk_id: null },
    ]);
  });

  it("(a) gives a user without access to the counterpart exactly one neutral indicator", async () => {
    const set = await search("advisorA", { query: aMarker, documentIds: [a.documentId] });
    expect(set.items.map((item) => item.documentId)).toEqual([a.documentId]);
    expect(set.items[0]!.conflicts).toEqual([{ visibility: "restricted", message: RESTRICTED_CONFLICT_MESSAGE }]);
    expect(set.signals.hasConflicts).toBe(true);
  });

  it("(b) never puts the hidden source's values in the evidence — not even indirectly", async () => {
    const serialized = JSON.stringify(await search("advisorA", { query: `${aMarker} ${RUN}` }));
    const hidden = [
      b.documentId,
      b.versionId,
      ...bChunkIds,
      bTitle,
      bLabel,
      bHeading,
      bChunk.text,
      "Skjult fiktiv modsigelse",
      scopeConflictId,
      manualConflictId,
      '"overlapping_scope"',
      '"manual"',
      "detection_rule",
      description,
    ];
    for (const value of hidden) expect(serialized, value).not.toContain(value);
  });

  it("(c) keeps the hidden source's metadata inside the database — the raw function results contain none of it", async () => {
    const { data: aChunks } = await (await signedInClient("admin")).schema("knowledge").from("document_chunks").select("id").eq("document_version_id", a.versionId);
    const conflicts = await rpc("advisorA", "evidence_conflicts", { p_chunk_ids: aChunks!.map((chunk) => chunk.id), p_date: today() });
    expect(conflicts.error).toBeNull();
    expect(conflicts.data).toEqual(
      aChunks!.map((chunk) => ({ chunk_id: chunk.id, restricted: true, conflict_id: null, counterpart_document_id: null, counterpart_version_id: null, counterpart_chunk_id: null })),
    );
    const raw = JSON.stringify([
      conflicts.data,
      (await rpc("advisorA", "search_chunks", { p_query: bSentence, p_query_embedding: null, p_model_id: null })).data,
      (await rpc("advisorA", "evidence_chunks", { p_chunk_ids: bChunkIds, p_version_ids: [b.versionId], p_date: today() })).data,
    ]);
    for (const value of [b.documentId, b.versionId, ...bChunkIds, bTitle, bLabel, bHeading, scopeConflictId, manualConflictId, description]) {
      expect(raw, value).not.toContain(value);
    }
  });

  it("(d) lets neither advisors nor leaders read conflicts or passages directly", async () => {
    for (const key of ["advisorA", "advisorB", "leaderSyd"] as const) {
      const knowledge = (await signedInClient(key)).schema("knowledge");
      expect((await knowledge.from("conflicts").select("id")).data, key).toEqual([]);
      expect((await knowledge.from("conflict_passages").select("id")).data, key).toEqual([]);
      expect((await knowledge.rpc("conflict_candidates", { p_version_id: b.versionId })).error?.code, key).toBe("42501");
    }
  });

  it("(e) returns both sources as full evidence, linked both ways, to a user with access to both", async () => {
    const set = await search("advisorB", { query: aMarker, documentIds: [a.documentId] });
    const itemA = set.items.find((item) => item.documentId === a.documentId)!;
    const itemsB = set.items.filter((item) => item.documentId === b.documentId);
    expect(itemsB.length).toBeGreaterThan(0);
    expect(itemA.conflicts.every((conflict) => conflict.visibility === "visible")).toBe(true);
    expect(itemA.conflicts.map((conflict) => (conflict.visibility === "visible" ? conflict.conflictId : null)).sort()).toEqual([manualConflictId, scopeConflictId].sort());
    for (const conflict of itemA.conflicts) {
      const target = set.items.find((item) => conflict.visibility === "visible" && item.evidenceId === conflict.counterpartEvidenceId)!;
      expect(target.documentId).toBe(b.documentId);
      expect(target.conflicts.some((back) => back.visibility === "visible" && back.counterpartEvidenceId === itemA.evidenceId)).toBe(true);
    }
    expect(itemsB[0]!.excerpt.text).toBe(bChunk.text);
    expect(itemsB[0]!.location).toMatchObject({ pageStart: bChunk.page_start, sectionNumber: bChunk.section_number, heading: bChunk.heading });
  });

  it("does not let an advisor resolve or dismiss a conflict", async () => {
    for (const fn of ["resolve_conflict", "dismiss_conflict"]) {
      const args = fn === "resolve_conflict" ? { p_conflict_id: scopeConflictId, p_note: "x" } : { p_conflict_id: scopeConflictId, p_reason: "x" };
      expect((await rpc("advisorB", fn, args)).error?.code).toBe("42501");
    }
  });

  it("stops marking evidence once the conflicts are resolved or dismissed", async () => {
    expect((await rpc("admin", "resolve_conflict", { p_conflict_id: scopeConflictId, p_note: note })).error).toBeNull();
    expect((await rpc("admin", "dismiss_conflict", { p_conflict_id: manualConflictId, p_reason: note })).error).toBeNull();
    for (const key of ["advisorA", "advisorB"] as const) {
      const set = await search(key, { query: aMarker, documentIds: [a.documentId] });
      expect(set.items.map((item) => item.documentId), key).toEqual([a.documentId]);
      expect(set.items[0]!.conflicts, key).toEqual([]);
    }
    const { data } = await (await signedInClient("admin")).schema("knowledge").from("conflicts").select("status, resolution_note").in("id", [scopeConflictId, manualConflictId]).order("status");
    expect(data).toEqual([{ status: "dismissed", resolution_note: note }, { status: "resolved", resolution_note: note }]);
  });
});
