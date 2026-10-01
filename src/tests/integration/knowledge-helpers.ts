import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SEED_PRODUCT_IDS } from "../../../scripts/seed-fixtures.mjs";
import { sha256 } from "../fixtures/knowledge-pdfs";

/**
 * Helpers for Knowledge Engine integration tests. They follow the same calls as the server
 * actions in src/lib/knowledge/upload-actions.ts — signed upload URL, direct upload to the
 * private bucket, registration through knowledge.register_upload — as the signed-in user.
 *
 * Versions are never deleted (docs/07 §2), so every test run creates its own documents with
 * a unique marker and only asserts on those.
 */

export const BUCKET = "knowledge-originals";
export const RUN = randomUUID().slice(0, 8);

export interface UploadOptions {
  documentId?: string;
  title?: string;
  documentType?: string;
  productId?: string;
  versionLabel?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  contentType?: string;
  /** Declared checksum (defaults to the real SHA-256 of the bytes). */
  declaredChecksum?: string;
}

export interface UploadedVersion {
  documentId: string;
  versionId: string;
  path: string;
}

/** Signed upload URL → upload → register. Throws with the failing step on error. */
export async function uploadVersion(client: SupabaseClient, bytes: Uint8Array, options: UploadOptions = {}): Promise<UploadedVersion> {
  const isNew = !options.documentId;
  const documentId = options.documentId ?? randomUUID();
  const versionId = randomUUID();
  const path = `${documentId}/${versionId}/original.pdf`;

  const signed = await client.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) throw new Error(`sign: ${signed.error.message}`);
  const upload = await client.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, signed.data.token, bytes, { contentType: options.contentType ?? "application/pdf" });
  if (upload.error) throw new Error(`upload: ${upload.error.message}`);

  const { error } = await client.schema("knowledge").rpc("register_upload", {
    p_version_id: versionId,
    p_document_id: documentId,
    p_new_document: isNew
      ? {
          product_id: options.productId ?? SEED_PRODUCT_IDS.ansvar,
          document_type: options.documentType ?? "terms",
          title: options.title ?? `Testbetingelser ${RUN}`,
        }
      : null,
    p_version_label: options.versionLabel === undefined ? "1" : options.versionLabel,
    p_language: "da",
    p_valid_from: options.validFrom === undefined ? "2026-01-01" : options.validFrom,
    p_valid_to: options.validTo ?? null,
    p_checksum_sha256: options.declaredChecksum ?? sha256(bytes),
    p_original_filename: "testbetingelser.pdf",
  });
  if (error) throw new Error(`register: ${error.message}`);
  return { documentId, versionId, path };
}

export async function versionRow(client: SupabaseClient, versionId: string) {
  const { data, error } = await client.schema("knowledge").from("document_versions").select("*").eq("id", versionId).maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

/** Runs the real ingestion worker (node workers/ingestion/main.ts --once) against the local stack. */
export async function runWorkerOnce(): Promise<string> {
  const { execFile } = await import("node:child_process");
  const path = await import("node:path");
  const root = path.resolve(__dirname, "../../..");
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["workers/ingestion/main.ts", "--once"],
      { cwd: root, env: { ...process.env, IPA_WORKER_ID: `test-${RUN}` }, timeout: 120_000 },
      (error, stdout, stderr) => (error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout)),
    );
  });
}

/** Runs the worker with environment overrides and reports how it exited (for startup checks). */
export async function runWorkerWith(env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  const { execFile } = await import("node:child_process");
  const path = await import("node:path");
  const root = path.resolve(__dirname, "../../..");
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["workers/ingestion/main.ts", "--once"],
      { cwd: root, env: { ...process.env, IPA_WORKER_ID: `test-${RUN}`, ...env }, timeout: 120_000 },
      (error, _stdout, stderr) => resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stderr }),
    );
  });
}

/** The worker needs its development-only access; integration runs without it skip the worker tests. */
export const workerConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
