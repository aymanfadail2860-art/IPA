import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256, simplePdf } from "../fixtures/knowledge-pdfs";

import { env, integrationConfigured, signedInClient } from "./helpers";
import { INTAKE_BUCKET, ORIGINALS_BUCKET, RUN, runWorkerOnce, securityStatus, uploadVersion, versionRow, workerConfigured } from "./knowledge-helpers";

/**
 * Fase 7, trin 2 — originaler i en privat bucket, upload via signeret URL og registrering
 * af versionen (docs/07 §2.2, §5.1, §14). Kører mod lokal Supabase inkl. Storage.
 *
 * 8B-I5: uploads lander i karantæne-bucketten knowledge-intake, som ingen kan læse. Kun en
 * frigivet fil ligger i knowledge-originals og kan hentes.
 */
describe.skipIf(!integrationConfigured)("knowledge uploads and originals", () => {
  it("lets a knowledge manager upload and register a version: status uploaded, in quarantine, a queued security scan", async () => {
    const admin = await signedInClient("admin");
    const bytes = await simplePdf(`upload-${RUN}`);
    const uploaded = await uploadVersion(admin, bytes);

    const version = await versionRow(admin, uploaded.versionId);
    expect(version).toMatchObject({
      status: "uploaded",
      document_id: uploaded.documentId,
      storage_path: uploaded.path,
      checksum_sha256: sha256(bytes),
      byte_size: bytes.byteLength,
      mime_type: "application/pdf",
      approved_at: null,
      published_at: null,
    });

    const { data: jobs } = await admin.schema("knowledge").from("ingestion_jobs").select("status, kind").eq("document_version_id", uploaded.versionId);
    expect(jobs).toEqual([{ status: "queued", kind: "scan" }]);
    expect(await securityStatus(admin, uploaded.versionId)).toMatchObject({ security_state: "quarantined", failure_code: null });
  });

  it("nobody can read a file in quarantine — not even a knowledge manager", async () => {
    const admin = await signedInClient("admin");
    const uploaded = await uploadVersion(admin, await simplePdf(`karantaene-${RUN}`));
    expect((await admin.storage.from(INTAKE_BUCKET).download(uploaded.path)).error).not.toBeNull();
    expect((await admin.storage.from(INTAKE_BUCKET).createSignedUrl(uploaded.path, 60)).error).not.toBeNull();
    expect((await admin.storage.from(ORIGINALS_BUCKET).download(uploaded.path)).error).not.toBeNull();
    const { error } = await admin.schema("knowledge").rpc("log_original_download", { p_version_id: uploaded.versionId });
    expect(error?.code).toBe("P0002");
  });

  it("finds duplicates by checksum for managers only", async () => {
    const admin = await signedInClient("admin");
    const bytes = await simplePdf(`dup-${RUN}`);
    const uploaded = await uploadVersion(admin, bytes);

    const { data: found } = await admin.schema("knowledge").rpc("find_versions_by_checksum", { p_checksum_sha256: sha256(bytes) });
    expect((found as { version_id: string }[]).map((row) => row.version_id)).toContain(uploaded.versionId);

    const advisor = await signedInClient("advisorA");
    const { data: hidden } = await advisor.schema("knowledge").rpc("find_versions_by_checksum", { p_checksum_sha256: sha256(bytes) });
    expect(hidden).toEqual([]);
  });

  it("does not let an advisor or a leader upload, register or read originals", async () => {
    const admin = await signedInClient("admin");
    const uploaded = await uploadVersion(admin, await simplePdf(`deny-${RUN}`));

    for (const key of ["advisorA", "leaderNord"] as const) {
      const client = await signedInClient(key);
      const path = `${randomUUID()}/${randomUUID()}/original.pdf`;
      for (const bucket of [INTAKE_BUCKET, ORIGINALS_BUCKET]) {
        const signed = await client.storage.from(bucket).createSignedUploadUrl(path);
        expect(signed.error, `${key} sign upload ${bucket}`).not.toBeNull();
        const download = await client.storage.from(bucket).download(uploaded.path);
        expect(download.error, `${key} download ${bucket}`).not.toBeNull();
        const signedDownload = await client.storage.from(bucket).createSignedUrl(uploaded.path, 60);
        expect(signedDownload.error, `${key} signed download ${bucket}`).not.toBeNull();
      }

      const { error } = await client.schema("knowledge").rpc("log_original_download", { p_version_id: uploaded.versionId });
      expect(error?.code, `${key} download url`).toBe("42501");
    }
  });

  it("refuses to register a version whose file is not in Storage", async () => {
    const admin = await signedInClient("admin");
    const { error } = await admin.schema("knowledge").rpc("register_upload", {
      p_version_id: randomUUID(),
      p_document_id: randomUUID(),
      p_new_document: { product_id: "00000000-0000-4000-a000-000000000301", document_type: "terms", title: `Uden fil ${RUN}` },
      p_version_label: "1",
      p_language: "da",
      p_valid_from: null,
      p_valid_to: null,
      p_checksum_sha256: "b".repeat(64),
      p_original_filename: "x.pdf",
    });
    expect(error?.code).toBe("P0002");
  });

  it("only accepts PDFs in the bucket and only in the fixed path structure", async () => {
    const admin = await signedInClient("admin");
    await expect(uploadVersion(admin, new TextEncoder().encode("ikke en pdf"), { contentType: "text/plain" })).rejects.toThrow(/upload/);

    const wrongPath = await admin.storage.from(INTAKE_BUCKET).createSignedUploadUrl(`fritekst/${RUN}.pdf`);
    expect(wrongPath.error).not.toBeNull();
    // 8B-I5: uploads go to quarantine only — no one uploads straight to the released originals.
    const direct = await admin.storage.from(ORIGINALS_BUCKET).createSignedUploadUrl(`${randomUUID()}/${randomUUID()}/original.pdf`);
    expect(direct.error).not.toBeNull();
  });

  it("never overwrites the original of a registered version", async () => {
    const admin = await signedInClient("admin");
    const uploaded = await uploadVersion(admin, await simplePdf(`immutable-${RUN}`));
    const again = await admin.storage.from(INTAKE_BUCKET).createSignedUploadUrl(uploaded.path, { upsert: true });
    const overwritten = again.error
      ? again
      : await admin.storage.from(INTAKE_BUCKET).uploadToSignedUrl(uploaded.path, again.data.token, await simplePdf("x"), { contentType: "application/pdf" });
    expect(overwritten.error).not.toBeNull();
  });

  it("keeps the bucket private: no public URL serves an original", async () => {
    const admin = await signedInClient("admin");
    const uploaded = await uploadVersion(admin, await simplePdf(`private-${RUN}`));
    for (const bucket of [INTAKE_BUCKET, ORIGINALS_BUCKET, "knowledge-quarantine"]) {
      const response = await fetch(admin.storage.from(bucket).getPublicUrl(uploaded.path).data.publicUrl);
      expect(response.ok, bucket).toBe(false);
    }
    const publicUrl = admin.storage.from(INTAKE_BUCKET).getPublicUrl(uploaded.path).data.publicUrl;
    expect(publicUrl.startsWith(env.url)).toBe(true);
  });

  it.skipIf(!workerConfigured)("issues a short-lived signed download URL to a knowledge manager — once the file is released", async () => {
    const admin = await signedInClient("admin");
    const bytes = await simplePdf(`download-${RUN}`);
    const uploaded = await uploadVersion(admin, bytes);
    await runWorkerOnce();
    expect(await securityStatus(admin, uploaded.versionId)).toMatchObject({ security_state: "released" });
    const { data: path, error } = await admin.schema("knowledge").rpc("log_original_download", { p_version_id: uploaded.versionId });
    expect(error).toBeNull();
    const signed = await admin.storage.from(ORIGINALS_BUCKET).createSignedUrl(path as string, 60);
    expect(signed.error).toBeNull();
    const response = await fetch(signed.data!.signedUrl);
    expect(response.ok).toBe(true);
    expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(sha256(bytes));
  });
});
