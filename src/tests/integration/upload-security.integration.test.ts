import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEmbedder } from "../../lib/knowledge/core/registry";
import { devServiceRoleOriginals, devServiceRoleWorkerDb } from "../../../workers/ingestion/dev-service-role.ts";
import { databaseSecurityGate } from "../../../workers/ingestion/gate.ts";
import { processJob, type ClaimedJob, type PipelineDeps, type ScanTools, type WorkerDb } from "../../../workers/ingestion/pipeline.ts";
import { runScanJob } from "../../../workers/ingestion/scan-job.ts";
import { childProcessInspector } from "../../../workers/ingestion/security/inspector.ts";
import { clamdScanner, developmentFixtureScanner } from "../../../workers/ingestion/security/scanner.ts";
import { buildPdf, simplePdf, termsFixturePages } from "../fixtures/knowledge-pdfs";
import { eicar, rawPdf } from "../fixtures/security-pdfs";

import { env, integrationConfigured, signedInClient } from "./helpers";
import { INTAKE_BUCKET, ORIGINALS_BUCKET, RUN, runWorkerOnce, securityStatus, uploadVersion, versionRow, workerConfigured, type UploadedVersion } from "./knowledge-helpers";

/**
 * 8B-I5 — upload security end to end against the local stack (docs/08b §21.6): quarantine,
 * the security examination, release with checksum confirmation, the release gate, rejection
 * into knowledge-quarantine, and attempts to get around them. The storage moves run through the
 * real worker-storage handler (in-process, with the local service-role client) and the real
 * database functions.
 *
 * ClamAV: with IPA_TEST_CLAMD_HOST/PORT (a local clamd), the EICAR test file is scanned for real.
 * Needs IPA_TEST_DB_ADMIN_URL (LOCAL only) to keep other queued jobs out of the way.
 */

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const configured = integrationConfigured && workerConfigured && /@(127\.0\.0\.1|localhost):/.test(adminUrl);
const clamd = process.env.IPA_TEST_CLAMD_HOST ? { host: process.env.IPA_TEST_CLAMD_HOST, port: Number(process.env.IPA_TEST_CLAMD_PORT ?? 3310) } : null;
const QUARANTINE_BUCKET = "knowledge-quarantine";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe.skipIf(!configured)("upload security end to end (8B-I5)", () => {
  let admin: Sql;
  let service: SupabaseClient;
  let db: WorkerDb;
  const uploads: Record<string, UploadedVersion & { bytes: Uint8Array }> = {};
  // ⚠ Development fixture scanner: the local seed allows it; production has no such row.
  const devTools = (): ScanTools => ({ scanner: developmentFixtureScanner("test"), inspector: childProcessInspector() });
  const deps = (scan: ScanTools = devTools()): PipelineDeps => ({
    db,
    originals: devServiceRoleOriginals(service, db),
    gate: databaseSecurityGate(db),
    scan,
    log: () => {},
    embedderFor: (model) => createEmbedder(model, "test"),
  });

  /** Claims exactly this version's job of this kind (other ready jobs are moved out of the way). */
  const claimOnly = async (versionId: string, kind: "scan" | "process"): Promise<ClaimedJob> => {
    await admin`update knowledge.ingestion_jobs set next_attempt_at = now() + interval '45 minutes'
                where status = 'queued' and next_attempt_at <= now() and not (document_version_id = ${versionId} and kind = ${kind})`;
    await admin`update knowledge.ingestion_jobs set next_attempt_at = now() where status = 'queued' and document_version_id = ${versionId} and kind = ${kind}`;
    const job = await db.claim();
    expect(job?.version_id).toBe(versionId);
    expect(job?.kind).toBe(kind);
    return job!;
  };
  const stored = async (bucket: string, path: string): Promise<Uint8Array | null> => {
    const { data, error } = await service.storage.from(bucket).download(path);
    return error || !data ? null : new Uint8Array(await data.arrayBuffer());
  };
  const verdicts = (versionId: string) =>
    admin`select final_verdict, failure_code, scanner_engine, scanner_version, signature_version, malware_result, malware_name, checksum_sha256,
                 object_bucket, object_path, policy_version, findings, released_at, superseded_at, superseded_reason
          from knowledge.security_verdicts where document_version_id = ${versionId} order by created_at`;
  const audit = async (versionId: string) =>
    (await admin`select action from audit.audit_log where entity_id = ${versionId} and action like 'knowledge.version.%' order by occurred_at, id`).map((row) => row.action as string);
  const counts = async (versionId: string) => {
    const [row] = await admin`select (select count(*)::int from knowledge.document_pages where document_version_id = ${versionId}) as pages,
                                     (select count(*)::int from knowledge.document_chunks where document_version_id = ${versionId}) as chunks,
                                     (select count(*)::int from knowledge.ingestion_jobs where document_version_id = ${versionId} and kind = 'process') as process_jobs`;
    return row as { pages: number; chunks: number; process_jobs: number };
  };
  const upload = async (key: string, bytes: Uint8Array, options: Parameters<typeof uploadVersion>[2] = {}) => {
    const client = await signedInClient("admin");
    uploads[key] = { ...(await uploadVersion(client, bytes, { title: `Sikkerhed ${key} ${RUN}`, ...options })), bytes };
    return uploads[key]!;
  };

  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    service = createClient(env.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    db = devServiceRoleWorkerDb(service, `security-${RUN}`);
    // Earlier test files may leave ready jobs: drain the shared queue first.
    await runWorkerOnce();
  }, 240_000);

  afterAll(async () => {
    if (!admin) return;
    await admin`update knowledge.ingestion_jobs set next_attempt_at = now() where status = 'queued' and next_attempt_at > now() + interval '40 minutes'`;
    await admin.end({ timeout: 2 });
  });

  it("an upload waits in quarantine; the worker examines, releases (same bytes) and only then processes it", async () => {
    const bytes = await buildPdf(termsFixturePages());
    const version = await upload("clean", bytes);
    const client = await signedInClient("admin");
    expect(await securityStatus(client, version.versionId)).toMatchObject({ security_state: "quarantined" });
    expect(await stored(INTAKE_BUCKET, version.path)).not.toBeNull();

    await runWorkerOnce();

    expect(await versionRow(client, version.versionId)).toMatchObject({ status: "processed", security_state: "released", storage_bucket: ORIGINALS_BUCKET });
    const [verdict] = await verdicts(version.versionId);
    expect(verdict).toMatchObject({
      final_verdict: "safe", failure_code: null, scanner_engine: "development-fixture", malware_result: "clean", policy_version: "pdf-v1",
      checksum_sha256: sha(bytes), object_path: version.path, superseded_at: null,
    });
    expect(verdict!.released_at).not.toBeNull();
    // The released object is exactly the scanned bytes; quarantine no longer holds it.
    expect(sha((await stored(ORIGINALS_BUCKET, version.path))!)).toBe(sha(bytes));
    expect(await stored(INTAKE_BUCKET, version.path)).toBeNull();
    expect(await audit(version.versionId)).toEqual(expect.arrayContaining(["knowledge.version.security_verdict", "knowledge.version.security_released"]));
    expect((await counts(version.versionId)).chunks).toBeGreaterThan(0);
  }, 180_000);

  it("rejects active content, embedded files, encryption, polyglots and non-PDFs into knowledge-quarantine — none is ever parsed", async () => {
    const cases = {
      javascript: [rawPdf({ catalog: "/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>" }), "active_content"],
      launch: [rawPdf({ page: "/AA << /O << /S /Launch /F (cmd.exe) >> >>" }), "active_content"],
      attachment: [rawPdf({ catalog: "/Names << /EmbeddedFiles << /Names [(a.exe) << /Type /Filespec /F (a.exe) /EF << /F 5 0 R >> >>] >> >>", objects: ["<< /Type /EmbeddedFile /Length 0 >>\nstream\n\nendstream"] }), "embedded_file"],
      encrypted: [rawPdf({ trailer: "/Encrypt 5 0 R /ID [<00> <00>]", objects: ["<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>"] }), "encrypted_pdf"],
      polyglot: [rawPdf({ after: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]) }), "polyglot"],
      text: [new TextEncoder().encode(`ikke en pdf ${RUN}`), "invalid_file_type"],
      exe: [await simplePdf(`exe-${RUN}`), "extension_mismatch"],
    } as const;
    for (const [key, [bytes]] of Object.entries(cases)) await upload(key, bytes, key === "exe" ? { filename: "program.exe" } : {});

    await runWorkerOnce();

    const client = await signedInClient("admin");
    for (const [key, [bytes, code]] of Object.entries(cases)) {
      const version = uploads[key]!;
      expect(await securityStatus(client, version.versionId), key).toMatchObject({ security_state: "rejected", failure_code: code });
      expect(await versionRow(client, version.versionId), key).toMatchObject({ status: "processing_failed", storage_bucket: QUARANTINE_BUCKET });
      expect(sha((await stored(QUARANTINE_BUCKET, version.path))!), key).toBe(sha(bytes));
      expect(await stored(INTAKE_BUCKET, version.path), key).toBeNull();
      expect(await stored(ORIGINALS_BUCKET, version.path), key).toBeNull();
      expect(await counts(version.versionId), key).toEqual({ pages: 0, chunks: 0, process_jobs: 0 });
      // Nobody can get the file: no download URL, no read of the quarantine bucket.
      expect((await client.schema("knowledge").rpc("log_original_download", { p_version_id: version.versionId })).error?.code, key).toBe("P0002");
      expect((await client.storage.from(QUARANTINE_BUCKET).download(version.path)).error, key).not.toBeNull();
      // A rejected file cannot be sent back to processing.
      expect((await client.schema("knowledge").rpc("request_reprocess", { p_version_id: version.versionId })).error, key).not.toBeNull();
      expect(await audit(version.versionId), key).toContain("knowledge.version.quarantined");
    }
    const [javascript] = await verdicts(uploads.javascript!.versionId);
    expect(javascript!.findings).toEqual(expect.arrayContaining(["javascript", "open_action"]));
  }, 180_000);

  it("bytes swapped in quarantine before the scan are not the uploaded file: rejected", async () => {
    const version = await upload("swap-before", await simplePdf(`swap-before-${RUN}`));
    const other = await simplePdf(`anden-fil-${RUN}`);
    expect((await service.storage.from(INTAKE_BUCKET).upload(version.path, other, { upsert: true, contentType: "application/pdf" })).error).toBeNull();
    const job = await claimOnly(version.versionId, "scan");
    expect(await runScanJob(job, deps())).toBe("succeeded");
    expect(await securityStatus(await signedInClient("admin"), version.versionId)).toMatchObject({ security_state: "rejected", failure_code: "checksum_mismatch" });
  }, 60_000);

  it("bytes swapped after release are stopped by the release gate before any parsing — and the file goes back to quarantine", async () => {
    const version = await upload("swap-after", await simplePdf(`swap-after-${RUN}`));
    expect(await runScanJob(await claimOnly(version.versionId, "scan"), deps())).toBe("succeeded");
    expect((await versionRow(await signedInClient("admin"), version.versionId))?.security_state).toBe("released");

    // Tampering with the released object (only possible with Storage's service credential).
    const tampered = await simplePdf(`manipuleret-${RUN}`);
    expect((await service.storage.from(ORIGINALS_BUCKET).upload(version.path, tampered, { upsert: true, contentType: "application/pdf" })).error).toBeNull();

    const processing = await claimOnly(version.versionId, "process");
    expect(await processJob(processing, deps())).toBe("failed");
    expect(await counts(version.versionId)).toMatchObject({ pages: 0, chunks: 0 });
    expect(await versionRow(await signedInClient("admin"), version.versionId)).toMatchObject({ security_state: "quarantined", status: "processing" });
    const history = await verdicts(version.versionId);
    expect(history.at(-1)).toMatchObject({ final_verdict: "safe", superseded_reason: "checksum_changed" });
    expect(await audit(version.versionId)).toContain("knowledge.version.security_release_invalidated");

    // The new scan sees the tampered bytes — not the uploaded file — and rejects them.
    expect(await runScanJob(await claimOnly(version.versionId, "scan"), deps())).toBe("succeeded");
    expect(await securityStatus(await signedInClient("admin"), version.versionId)).toMatchObject({ security_state: "rejected", failure_code: "checksum_mismatch" });
    expect(sha((await stored(QUARANTINE_BUCKET, version.path))!)).toBe(sha(tampered));
    expect(await stored(ORIGINALS_BUCKET, version.path)).toBeNull();
  }, 90_000);

  it("a signed-in administrator cannot release anything from the client", async () => {
    const version = await upload("spoof", await simplePdf(`spoof-${RUN}`));
    const knowledge = (await signedInClient("admin")).schema("knowledge");
    const update = await knowledge.from("document_versions").update({ security_state: "released", storage_bucket: ORIGINALS_BUCKET }).eq("id", version.versionId).select("id");
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    expect((await knowledge.from("security_verdicts").insert({ document_version_id: version.versionId, final_verdict: "safe" })).error).not.toBeNull();
    expect((await knowledge.rpc("worker_record_security_verdict", { p_job_id: version.versionId, p_lease_token: "0".repeat(64), p_result: { final: "safe" } })).error?.code).toBe("42501");
    expect((await knowledge.rpc("confirm_worker_storage_operation", { p_ticket_id: version.versionId, p_sha256: "0".repeat(64) })).error?.code).toBe("42501");
    expect((await knowledge.rpc("worker_security_clearance", { p_job_id: version.versionId, p_lease_token: "0".repeat(64) })).error?.code).toBe("42501");
    expect((await versionRow(await signedInClient("admin"), version.versionId))?.security_state).toBe("quarantined");
  });

  describe.skipIf(!clamd)("ClamAV (real clamd)", () => {
    it("finds the EICAR test file and quarantines it", async () => {
      const bytes = new TextEncoder().encode(eicar());
      const version = await upload("eicar", bytes, { filename: "eicar.pdf" });
      const job = await claimOnly(version.versionId, "scan");
      expect(await runScanJob(job, deps({ scanner: clamdScanner(clamd!), inspector: childProcessInspector() }))).toBe("succeeded");
      expect(await securityStatus(await signedInClient("admin"), version.versionId)).toMatchObject({ security_state: "rejected", failure_code: "malware_detected" });
      const [verdict] = await verdicts(version.versionId);
      expect(verdict).toMatchObject({ malware_result: "infected", scanner_engine: "ClamAV" });
      expect(verdict!.malware_name).toMatch(/eicar/i);
      expect(sha((await stored(QUARANTINE_BUCKET, version.path))!)).toBe(sha(bytes));
      const [quarantined] = await admin`select details from audit.audit_log where entity_id = ${version.versionId} and action = 'knowledge.version.quarantined'`;
      expect((quarantined!.details as { malware_name: string }).malware_name).toMatch(/eicar/i);
    }, 60_000);

    it("never releases a clean file on unknown or stale signatures — and never when clamd is down", async () => {
      const scanner = clamdScanner(clamd!);
      const info = await scanner.info();
      const version = await upload("clamd-clean", await simplePdf(`clamd-clean-${RUN}`));
      const outcome = await runScanJob(await claimOnly(version.versionId, "scan"), deps({ scanner, inspector: childProcessInspector() }));
      const status = await securityStatus(await signedInClient("admin"), version.versionId);
      if ("error" in info || !info.signatureTime || Date.now() - info.signatureTime.getTime() > 86_400_000) {
        // A local clamd with test signatures only reports no signature date: fail closed.
        expect(outcome).toBe("retry");
        expect(status).toMatchObject({ security_state: "scan_failed" });
        expect(["signature_unknown", "stale_signatures"]).toContain(status!.failure_code);
      } else {
        expect(outcome).toBe("succeeded");
        expect(status).toMatchObject({ security_state: "released" });
      }

      const down = await upload("clamd-down", await simplePdf(`clamd-down-${RUN}`));
      expect(await runScanJob(await claimOnly(down.versionId, "scan"), deps({ scanner: clamdScanner({ host: "127.0.0.1", port: 1 }), inspector: childProcessInspector() }))).toBe("retry");
      expect(await securityStatus(await signedInClient("admin"), down.versionId)).toMatchObject({ security_state: "scan_failed", failure_code: "scanner_unavailable" });
      expect(await counts(down.versionId)).toEqual({ pages: 0, chunks: 0, process_jobs: 0 });
    }, 60_000);
  });
});
