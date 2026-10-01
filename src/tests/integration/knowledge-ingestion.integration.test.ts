import { beforeAll, describe, expect, it } from "vitest";

import { buildPdf, partlyScannedFixturePages, simplePdf, termsFixturePages } from "../fixtures/knowledge-pdfs";

import { integrationConfigured, signedInClient } from "./helpers";
import { RUN, runWorkerOnce, uploadVersion, versionRow, workerConfigured, type UploadedVersion } from "./knowledge-helpers";

/**
 * Fase 7, trin 3 — den rigtige ingestion-worker mod lokal Supabase (docs/07 §5). Upload
 * og teknisk behandling gør aldrig en version synlig eller autoritativ: den når højst
 * "Klar til review".
 */
interface QualityReport {
  pages: Record<string, unknown>;
  normalization: { header_footer_lines_removed: number };
  structure: { recognized: boolean };
  tables: Record<string, unknown>;
  metadata: { complete: boolean };
  access: { no_grants: boolean };
}

describe.skipIf(!integrationConfigured || !workerConfigured)("ingestion worker end to end", () => {
  const uploads: Record<string, UploadedVersion> = {};

  beforeAll(async () => {
    const admin = await signedInClient("admin");
    uploads.terms = await uploadVersion(admin, await buildPdf(termsFixturePages()), { title: `Testbetingelser e2e ${RUN}` });
    uploads.notPdf = await uploadVersion(admin, new TextEncoder().encode(`ikke en pdf ${RUN}`), { title: `Ikke PDF ${RUN}` });
    uploads.scanned = await uploadVersion(admin, await buildPdf([{ lines: [], imageOnly: true }]), { title: `Scannet ${RUN}` });
    uploads.partly = await uploadVersion(admin, await buildPdf(partlyScannedFixturePages()), { title: `Delvist scannet ${RUN}` });
    uploads.mismatch = await uploadVersion(admin, await simplePdf(`mismatch-${RUN}`), {
      title: `Forkert kontrolsum ${RUN}`,
      declaredChecksum: "f".repeat(64),
    });
    await runWorkerOnce();
  }, 180_000);

  async function job(versionId: string) {
    const admin = await signedInClient("admin");
    const { data } = await admin.schema("knowledge").from("ingestion_jobs").select("*").eq("document_version_id", versionId).single();
    return data as Record<string, unknown> & { quality_report: QualityReport };
  }

  it("processes a valid PDF to 'Klar til review' — never further", async () => {
    const admin = await signedInClient("admin");
    const version = await versionRow(admin, uploads.terms!.versionId);
    expect(version).toMatchObject({ status: "processed", page_count: 4, published_at: null, approved_at: null });
    expect(version?.checksum_verified_at).not.toBeNull();
    expect(version?.extractor_version).toMatch(/^pdfjs-/);
    expect(version?.chunker_version).toBe("structure/1");
    expect((await job(uploads.terms!.versionId)).status).toBe("succeeded");
  });

  it("stores pages and traceable chunks with heading chains", async () => {
    const admin = await signedInClient("admin");
    const knowledge = admin.schema("knowledge");
    const { data: pages } = await knowledge.from("document_pages").select("*").eq("document_version_id", uploads.terms!.versionId).order("page_number");
    const { data: chunks } = await knowledge.from("document_chunks").select("*").eq("document_version_id", uploads.terms!.versionId).order("chunk_index");
    expect(pages).toHaveLength(4);
    expect(chunks!.length).toBeGreaterThan(5);
    for (const chunk of chunks!) {
      if (chunk.page_start !== chunk.page_end) continue;
      const page = pages!.find((entry) => entry.page_number === chunk.page_start)!;
      expect(page.text.slice(chunk.char_start - page.char_start, chunk.char_end - page.char_start)).toBe(chunk.text);
    }
    const pollution = chunks!.find((chunk) => chunk.text.includes("gradvis forurening"))!;
    expect(pollution.heading_path).toEqual(["Testbetingelser for Testprodukt Ansvar (fiktiv)", "§ 4 Undtagelser", "4.1 Forurening"]);
    expect(pollution.section_number).toBe("4.1");
  });

  it("attaches a quality report with worker and database facts", async () => {
    const report = (await job(uploads.terms!.versionId)).quality_report;
    expect(report.pages).toMatchObject({ total: 4, read: 4, all_read: true });
    expect(report.normalization.header_footer_lines_removed).toBe(8);
    expect(report.structure.recognized).toBe(true);
    expect(report.tables).toMatchObject({ found: 1, uncertain: 0 });
    expect(report.metadata.complete).toBe(true);
    expect(report.access.no_grants).toBe(true);
  });

  it("fails visibly, without retry, when the file is not a PDF, has no text layer or differs from the upload", async () => {
    const admin = await signedInClient("admin");
    for (const [key, code] of [["notPdf", "not_pdf"], ["scanned", "no_text"], ["mismatch", "checksum_mismatch"]] as const) {
      const version = await versionRow(admin, uploads[key]!.versionId);
      expect(version?.status, key).toBe("processing_failed");
      const failed = await job(uploads[key]!.versionId);
      expect(failed.status, key).toBe("failed");
      expect(failed.error_code, key).toBe(code);
      expect(failed.attempts, key).toBe(1);
      const { count } = await admin.schema("knowledge").from("document_chunks").select("id", { count: "exact", head: true }).eq("document_version_id", uploads[key]!.versionId);
      expect(count, key).toBe(0);
    }
  });

  it("processes a partly scanned PDF but records the unread page (approval is blocked later)", async () => {
    const admin = await signedInClient("admin");
    expect((await versionRow(admin, uploads.partly!.versionId))?.status).toBe("processed");
    expect((await job(uploads.partly!.versionId)).quality_report.pages).toMatchObject({ total: 2, read: 1, without_text: [2], all_read: false });
  });

  it("keeps unpublished pages, chunks and jobs invisible to advisors and leaders", async () => {
    for (const key of ["advisorA", "leaderNord"] as const) {
      const client = (await signedInClient(key)).schema("knowledge");
      for (const table of ["document_versions", "document_pages", "document_chunks", "ingestion_jobs"]) {
        const column = table === "document_versions" ? "id" : "document_version_id";
        const { data } = await client.from(table).select("*").eq(column, uploads.terms!.versionId);
        expect(data, `${key} ${table}`).toEqual([]);
      }
    }
  });

  it("does not let signed-in users act as the worker", async () => {
    const admin = await signedInClient("admin");
    const { error } = await admin.schema("knowledge").rpc("worker_claim_job", { p_worker: "x", p_lease_seconds: 10 });
    expect(error?.code).toBe("42501");
  });
});
