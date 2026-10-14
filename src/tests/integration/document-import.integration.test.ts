import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError, ConfigProblem, createSupabaseApi, type SupabaseApi } from "../../../workers/import/api.ts";
import { checkImport, directoryFolder, importStatus, runImport, type ImportDeps, type StatusRow } from "../../../workers/import/importer.ts";
import { fileJournal, type JournalStore } from "../../../workers/import/journal.ts";
import { MANIFEST_FILE } from "../../../workers/import/manifest.ts";
import { createEmbedder } from "../../lib/knowledge/core/registry";
import { devServiceRoleOriginals, devServiceRoleWorkerDb } from "../../../workers/ingestion/dev-service-role.ts";
import { databaseSecurityGate } from "../../../workers/ingestion/gate.ts";
import type { PipelineDeps, WorkerDb } from "../../../workers/ingestion/pipeline.ts";
import { runScanJob } from "../../../workers/ingestion/scan-job.ts";
import { childProcessInspector } from "../../../workers/ingestion/security/inspector.ts";
import { developmentFixtureScanner } from "../../../workers/ingestion/security/scanner.ts";
import { buildPdf, partlyScannedFixturePages, termsFixturePages, type PdfPage } from "../fixtures/knowledge-pdfs";
import { rawPdf } from "../fixtures/security-pdfs";

import { anonClient, env, integrationConfigured, seedUser, signedInClient } from "./helpers";
import { RUN, runProduct, runWorkerOnce, workerConfigured } from "./knowledge-helpers";

/**
 * Beta L3 — the administrator's document import end to end against the local stack
 * (docs/beta.md §15): the real importer (workers/import) signed in as the seeded administrator
 * through the public API, the real worker (development fixture scanner — local only; the real
 * ClamAV container is import-docker.integration.test.ts), the real database functions and the
 * professional approval as a person would give it in Admin.
 *
 * Every document is synthetic and obviously fictional (src/tests/fixtures).
 * Needs IPA_TEST_DB_ADMIN_URL (LOCAL only) and the worker's development access.
 */

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const configured = integrationConfigured && workerConfigured && /@(127\.0\.0\.1|localhost):/.test(adminUrl);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const HEADER = "fil;produkt_id;dokumenttype;titel;version;gyldig_fra;gyldig_til;sider";

/** The terms fixture, marked for this run and this file so its bytes are unique. */
async function termsPdf(marker: string): Promise<Uint8Array> {
  const pages: PdfPage[] = termsFixturePages();
  pages[0] = { ...pages[0]!, lines: [{ text: `Testprodukt — fiktive vilkår (${marker} ${RUN})`, size: 9 }, ...pages[0]!.lines] };
  return buildPdf(pages);
}

describe.skipIf(!configured)("the administrator's document import against the local stack (beta L3)", () => {
  let sql: Sql;
  let admin: SupabaseClient;
  let api: SupabaseApi;
  let product = "";
  const folders: string[] = [];

  /** A fresh import folder and report folder with these files and import list rows. */
  const setup = async (files: Record<string, Uint8Array>, rows: string[]) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ipa-import-it-"));
    const reports = await mkdtemp(path.join(os.tmpdir(), "ipa-reports-it-"));
    folders.push(directory, reports);
    for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(directory, name), bytes);
    await writeFile(path.join(directory, MANIFEST_FILE), `${HEADER}\n${rows.join("\n")}\n`);
    return { directory, reports, deps: (overrides: Partial<ImportDeps> = {}): ImportDeps => ({ api, folder: directoryFolder(directory), journal: fileJournal(reports), ...overrides }) };
  };
  const row = (file: string, title: string, pages = "") => `${file};${product};Betingelser;${title} ${RUN};2026-01;2026-01-01;;${pages}`;
  const versionsOf = async (checksum: string) =>
    sql`select id, document_id, status, security_state, storage_bucket from knowledge.document_versions where checksum_sha256 = ${checksum} order by uploaded_at`;
  const statusOf = async (deps: ImportDeps, file: string): Promise<StatusRow> => (await importStatus(deps)).rows.find((entry) => entry.file === file)!;

  beforeAll(async () => {
    sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
    admin = await signedInClient("admin");
    product = await runProduct(admin, "import");
    api = createSupabaseApi({ url: env.url, publishableKey: env.anonKey, allowHttp: true });
    await api.signIn(seedUser("admin").email, env.password);
    // Earlier test files may leave ready jobs: drain the shared queue first.
    await runWorkerOnce();
  }, 240_000);

  afterAll(async () => {
    await api?.signOut();
    for (const folder of folders) await rm(folder, { recursive: true, force: true });
    await sql?.end({ timeout: 2 });
  });

  it("a complete synthetic document is imported, scanned, extracted, approved by a person and read back whole", async () => {
    const bytes = await termsPdf("komplet");
    const { deps } = await setup({ "vilkaar-komplet.pdf": bytes }, [row("vilkaar-komplet.pdf", "Fiktive vilkår", "4")]);

    expect((await checkImport(deps())).rows).toEqual([expect.objectContaining({ outcome: "ready", sha256: sha(bytes) })]);
    expect(await versionsOf(sha(bytes))).toEqual([]);

    const imported = (await runImport(deps())).rows[0]!;
    expect(imported).toMatchObject({ outcome: "imported" });
    // In quarantine: registered, not released, and not readable by anyone — not even the operator.
    expect(await versionsOf(sha(bytes))).toEqual([expect.objectContaining({ id: imported.versionId, status: "uploaded", security_state: "quarantined", storage_bucket: "knowledge-intake" })]);
    const intakePath = `${imported.documentId}/${imported.versionId}/original.pdf`;
    expect((await admin.storage.from("knowledge-intake").download(intakePath)).error).not.toBeNull();
    expect((await anonClient().storage.from("knowledge-intake").download(intakePath)).error).not.toBeNull();
    expect((await fetch(`${env.url}/storage/v1/object/public/knowledge-intake/${intakePath}`)).ok).toBe(false);
    expect((await statusOf(deps(), "vilkaar-komplet.pdf")).category).toBe("waiting_scan");

    await runWorkerOnce();

    const ready = await statusOf(deps(), "vilkaar-komplet.pdf");
    expect(ready).toMatchObject({ category: "ready_for_review", completeness: { complete: true, pages: 4, pagesWithText: 4, originalMatches: true } });
    // Nothing is approved or published by the import or the worker.
    expect(await versionsOf(sha(bytes))).toEqual([expect.objectContaining({ status: "processed", security_state: "released", storage_bucket: "knowledge-originals" })]);

    // The professional approval — a person in Admin (here: the seeded administrator).
    expect((await admin.schema("knowledge").rpc("start_review", { p_version_id: imported.versionId })).error).toBeNull();
    const approval = await admin.schema("knowledge").rpc("approve_version", { p_version_id: imported.versionId, p_acknowledged_warnings: ["no_grants"] });
    expect(approval.error).toBeNull();

    const published = await statusOf(deps(), "vilkaar-komplet.pdf");
    expect(published).toMatchObject({ category: "published", completeness: { complete: true, pages: 4, originalMatches: true } });
    expect(published.messages).toContain("Dokumentet har ingen adgangstildelinger: kun administratorer kan finde det. Tildel adgang i Admin.");

    // Read back by an adviser through the beta's retrieval method, once access is granted in Admin.
    expect((await admin.schema("knowledge").from("document_access_grants").insert({ document_id: imported.documentId, permission_key: "knowledge.document.read", grantee_type: "all_users" })).error).toBeNull();
    const adviser = await signedInClient("advisorA");
    const read = await adviser.schema("knowledge").rpc("product_document_chunks", { p_product_id: product, p_document_ids: [imported.documentId] });
    // The grant served only this read: other tests (pgTAP) expect advisers without grants to see nothing.
    await sql`delete from knowledge.document_access_grants where document_id = ${imported.documentId!} and grantee_type = 'all_users'`;
    expect(read.error).toBeNull();
    const chunks = read.data as { chunk_index: number; page_start: number; page_end: number; version_id: string; version_chunk_count: number; text: string }[];
    const [stored] = await sql`select count(*)::int as chunks, (select count(*)::int from knowledge.document_pages where document_version_id = ${imported.versionId!}) as pages
                               from knowledge.document_chunks where document_version_id = ${imported.versionId!}`;
    expect(chunks.length).toBe(stored!.chunks);
    expect(chunks.every((chunk) => chunk.version_id === imported.versionId && chunk.version_chunk_count === stored!.chunks)).toBe(true);
    expect(chunks.map((chunk) => chunk.chunk_index)).toEqual([...Array(stored!.chunks).keys()]);
    const covered = new Set(chunks.flatMap((chunk) => Array.from({ length: chunk.page_end - chunk.page_start + 1 }, (_, index) => chunk.page_start + index)));
    expect([...covered].sort()).toEqual([1, 2, 3, 4]);
    expect(chunks.map((chunk) => chunk.text).join(" ")).toContain(`(komplet ${RUN})`);

    // The proof reads the stored original back: bytes replaced behind the platform's back (only
    // possible with Storage's service credential) make the version incomplete.
    const service = createClient(env.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const tampered = await termsPdf("manipuleret-original");
    expect((await service.storage.from("knowledge-originals").upload(intakePath, tampered, { upsert: true, contentType: "application/pdf" })).error).toBeNull();
    const after = await statusOf(deps(), "vilkaar-komplet.pdf");
    expect(after).toMatchObject({ category: "incomplete", completeness: { complete: false, originalMatches: false } });
    expect(after.messages).toContain("Den gemte original er ikke den importerede fil (SHA-256 afviger).");
    expect((await service.storage.from("knowledge-originals").upload(intakePath, bytes, { upsert: true, contentType: "application/pdf" })).error).toBeNull();
    expect((await statusOf(deps(), "vilkaar-komplet.pdf")).category).toBe("published");
  }, 240_000);

  it("a repeated import sends nothing and creates no second version", async () => {
    const bytes = await termsPdf("gentaget");
    const { deps } = await setup({ "gentaget.pdf": bytes }, [row("gentaget.pdf", "Gentaget")]);
    expect((await runImport(deps())).rows[0]!.outcome).toBe("imported");
    const [first] = await versionsOf(sha(bytes));
    const again = await runImport(deps());
    expect(again.rows[0]).toMatchObject({ outcome: "exists", versionId: first!.id });
    // Also from a fresh journal (another machine, a lost report folder).
    const elsewhere = await setup({ "kopi.pdf": bytes }, [row("kopi.pdf", "Kopi")]);
    expect((await runImport(elsewhere.deps())).rows[0]).toMatchObject({ outcome: "exists", versionId: first!.id });
    expect(await versionsOf(sha(bytes))).toHaveLength(1);
    const [objects] = await sql`select count(*)::int as n from storage.objects where bucket_id like 'knowledge-%' and name like ${`${first!.document_id}/%`}`;
    expect(objects!.n).toBe(1);
  }, 120_000);

  it("an interrupted import resumes safely — same ids, no second copy, nothing published automatically", async () => {
    const afterUpload = await termsPdf("afbrudt-efter-upload");
    const afterRegister = await termsPdf("afbrudt-efter-registrering");
    const { deps, reports } = await setup({ "a.pdf": afterUpload, "b.pdf": afterRegister }, [row("a.pdf", "Afbrudt A"), row("b.pdf", "Afbrudt B")]);

    // Run 1: the connection drops after a.pdf's upload; b.pdf is registered, but the run dies
    // before the journal says so.
    let dropped = false;
    const flaky: SupabaseApi = {
      ...api,
      rpc: (async (schema: "knowledge" | "identity", fn: string, args: Record<string, unknown>) => {
        if (fn === "register_upload" && !dropped) {
          dropped = true;
          throw new ApiError("Platformen kunne ikke nås.", 0, "TypeError");
        }
        return api.rpc(schema, fn, args);
      }) as SupabaseApi["rpc"],
    };
    const real = fileJournal(reports);
    const dying: JournalStore = {
      read: () => real.read(),
      write: async (journal) => {
        if (Object.values(journal.entries).some((entry) => entry.file === "b.pdf" && entry.stage === "registered")) throw new Error("processen stoppede");
        return real.write(journal);
      },
    };
    const first = await runImport(deps({ api: flaky, journal: dying }));
    expect(first.rows.map((entry) => entry.outcome)).toEqual(["failed", "failed"]);
    const journal = await real.read();
    const entryA = journal.entries[sha(afterUpload)]!;
    expect(entryA.stage).toBe("uploaded");
    expect(await versionsOf(sha(afterUpload))).toEqual([]);
    expect(await versionsOf(sha(afterRegister))).toHaveLength(1);

    // Run 2: a.pdf resumes with its ids; b.pdf is found by its SHA-256.
    const second = await runImport(deps());
    expect(second.rows).toEqual([
      expect.objectContaining({ file: "a.pdf", outcome: "imported", versionId: entryA.versionId, documentId: entryA.documentId }),
      expect.objectContaining({ file: "b.pdf", outcome: "exists" }),
    ]);
    expect(await versionsOf(sha(afterUpload))).toHaveLength(1);
    expect(await versionsOf(sha(afterRegister))).toHaveLength(1);
    const [objects] = await sql`select count(*)::int as n from storage.objects where bucket_id = 'knowledge-intake' and name like ${`${entryA.documentId}/%`}`;
    expect(objects!.n).toBe(1);

    await runWorkerOnce();
    for (const file of ["a.pdf", "b.pdf"]) expect((await statusOf(deps(), file)).category, file).toBe("ready_for_review");
    for (const checksum of [sha(afterUpload), sha(afterRegister)]) expect((await versionsOf(checksum))[0]!.status).toBe("processed");
  }, 240_000);

  it("a document with a page without text, or fewer pages than the list says, is never complete — and cannot be approved", async () => {
    const scanned = await buildPdf([{ lines: [{ text: `Delvist skannet (${RUN})`, size: 9 }] }, ...partlyScannedFixturePages()]);
    const short = await termsPdf("for-faa-sider");
    const { deps } = await setup({ "skannet.pdf": scanned, "kort.pdf": short }, [row("skannet.pdf", "Skannet"), row("kort.pdf", "Kort", "7")]);
    expect((await runImport(deps())).rows.map((entry) => entry.outcome)).toEqual(["imported", "imported"]);
    await runWorkerOnce();

    const partial = await statusOf(deps(), "skannet.pdf");
    expect(partial.category).toBe("incomplete");
    expect(partial.messages).toEqual(expect.arrayContaining([expect.stringMatching(/Sider uden tekstlag: 3/), expect.stringMatching(/Blokerer godkendelse: Ikke alle sider er læst/)]));
    expect((await admin.schema("knowledge").rpc("start_review", { p_version_id: partial.versionId })).error).toBeNull();
    const refused = await admin.schema("knowledge").rpc("approve_version", { p_version_id: partial.versionId, p_acknowledged_warnings: ["no_grants"] });
    expect(refused.error?.message).toMatch(/Ikke alle sider er læst/);

    const missing = await statusOf(deps(), "kort.pdf");
    expect(missing.category).toBe("incomplete");
    expect(missing.messages).toContain("Dokumentet har 4 sider, men importlisten siger 7.");
  }, 240_000);

  it("files the security chain refuses are reported as such and never reach text extraction", async () => {
    // The marker object makes this run's file unique (the fixture is otherwise byte-identical).
    const encrypted = rawPdf({ trailer: "/Encrypt 5 0 R /ID [<00> <00>]", objects: ["<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>", `(${RUN})`] });
    const whole = await termsPdf("oedelagt");
    const broken = whole.subarray(0, Math.floor(whole.byteLength / 3));
    const notPdf = new TextEncoder().encode(`Dette er ikke en PDF (${RUN})`);
    const { deps } = await setup({ "krypteret.pdf": encrypted, "oedelagt.pdf": broken, "forklaedt.pdf": notPdf }, [
      row("krypteret.pdf", "Krypteret"),
      row("oedelagt.pdf", "Ødelagt"),
      row("forklaedt.pdf", "Forklædt"),
    ]);
    expect((await runImport(deps())).rows.map((entry) => entry.outcome)).toEqual(["imported", "imported", "imported"]);
    await runWorkerOnce();
    const report = await importStatus(deps());
    for (const entry of report.rows) {
      expect(["security_rejected", "processing_failed"], entry.file).toContain(entry.category);
      expect(entry.completeness, entry.file).toBeUndefined();
      const [counts] = await sql`select (select count(*)::int from knowledge.document_pages where document_version_id = ${entry.versionId!}) as pages,
                                        (select count(*)::int from knowledge.document_chunks where document_version_id = ${entry.versionId!}) as chunks`;
      expect(counts, entry.file).toEqual({ pages: 0, chunks: 0 });
    }
    expect(report.rows.find((entry) => entry.file === "krypteret.pdf")).toMatchObject({ category: "security_rejected", security: "Afvist: ugyldig PDF" });
    expect(report.rows.find((entry) => entry.file === "forklaedt.pdf")).toMatchObject({ category: "security_rejected", security: "Afvist: ugyldig PDF" });
  }, 240_000);

  it("a file changed after its scan is not released: the release is refused, the file is scanned again and rejected", async () => {
    const bytes = await termsPdf("aendret-efter-scanning");
    const { deps } = await setup({ "aendret.pdf": bytes }, [row("aendret.pdf", "Ændret")]);
    const imported = (await runImport(deps())).rows[0]!;
    const service = createClient(env.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const db: WorkerDb = devServiceRoleWorkerDb(service, `import-${RUN}`);
    const originals = devServiceRoleOriginals(service, db);
    const swapped = await termsPdf("manipuleret");
    const pipeline: PipelineDeps = {
      db,
      // Between the verdict and the release, someone with Storage's credential replaces the bytes.
      originals: {
        ...originals,
        move: async (job, purpose) => {
          if (purpose === "release_original") {
            expect((await service.storage.from("knowledge-intake").upload(`${imported.documentId}/${imported.versionId}/original.pdf`, swapped, { upsert: true, contentType: "application/pdf" })).error).toBeNull();
          }
          return originals.move(job, purpose);
        },
      },
      gate: databaseSecurityGate(db),
      scan: { scanner: developmentFixtureScanner("test"), inspector: childProcessInspector() },
      log: () => {},
      embedderFor: (model) => createEmbedder(model, "test"),
    };
    const claim = async () => {
      await sql`update knowledge.ingestion_jobs set next_attempt_at = now() + interval '45 minutes' where status = 'queued' and next_attempt_at <= now() and document_version_id <> ${imported.versionId!}`;
      await sql`update knowledge.ingestion_jobs set next_attempt_at = now() where status = 'queued' and document_version_id = ${imported.versionId!}`;
      const job = await db.claim();
      await sql`update knowledge.ingestion_jobs set next_attempt_at = now() where status = 'queued' and next_attempt_at > now() + interval '40 minutes'`;
      expect(job).toMatchObject({ version_id: imported.versionId, kind: "scan" });
      return job!;
    };
    expect(await runScanJob(await claim(), pipeline)).toBe("retry");
    const [afterRelease] = await versionsOf(sha(bytes));
    expect(afterRelease).toMatchObject({ security_state: expect.not.stringMatching(/^released$/), storage_bucket: expect.not.stringMatching(/originals/) });
    const [verdict] = await sql`select final_verdict, superseded_reason from knowledge.security_verdicts where document_version_id = ${imported.versionId!} order by created_at desc limit 1`;
    expect(verdict).toEqual({ final_verdict: "safe", superseded_reason: "checksum_changed" });

    // The next scan sees the swapped bytes — not the imported file — and rejects them.
    expect(await runScanJob(await claim(), { ...pipeline, originals })).toBe("succeeded");
    expect(await statusOf(deps(), "aendret.pdf")).toMatchObject({ category: "security_rejected" });
    const [counts] = await sql`select count(*)::int as pages from knowledge.document_pages where document_version_id = ${imported.versionId!}`;
    expect(counts!.pages).toBe(0);
  }, 120_000);

  it("only an administrator with write access can import; a secret key is refused before anything is sent", async () => {
    expect(() => createSupabaseApi({ url: env.url, publishableKey: serviceKey, allowHttp: true })).toThrow(ConfigProblem);

    const adviser = createSupabaseApi({ url: env.url, publishableKey: env.anonKey, allowHttp: true });
    await adviser.signIn(seedUser("advisorA").email, env.password);
    expect(await adviser.rpc("identity", "has_permission", { p_permission: "knowledge.document.write" })).toBe(false);
    const bytes = await termsPdf("uden-ret");
    const upload = await adviser.upload("knowledge-intake", `${crypto.randomUUID()}/${crypto.randomUUID()}/original.pdf`, bytes, "application/pdf");
    expect(upload.ok).toBe(false);
    const register = await adviser.rpc("knowledge", "register_upload", {
      p_version_id: crypto.randomUUID(), p_document_id: crypto.randomUUID(), p_new_document: { product_id: product, document_type: "terms", title: "x" },
      p_version_label: "1", p_language: "da", p_valid_from: "2026-01-01", p_valid_to: null, p_checksum_sha256: sha(bytes), p_original_filename: "x.pdf",
    }).catch((error: unknown) => error as ApiError);
    expect(register).toMatchObject({ code: "42501" });
    await adviser.signOut();
    expect(await versionsOf(sha(bytes))).toEqual([]);
  }, 60_000);
});
