"use server";

import { randomUUID } from "node:crypto";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  INTAKE_BUCKET,
  isUuid,
  ORIGINALS_BUCKET,
  originalPath,
  validateUploadMetadata,
  type UploadMetadataInput,
} from "./upload-validation";

/*
 * Upload of an original (docs/07 §5.1, docs/08b §21.6): the server checks permission and
 * metadata and issues a signed upload URL; the browser uploads the file directly to the private
 * QUARANTINE bucket knowledge-intake (large PDFs never pass through a Vercel function); the
 * server then registers the version, and the security examination (a scan job) is queued in the
 * same database transaction. Processing starts only after the file has been released.
 *
 * Every action runs as the signed-in user: the bucket policies and knowledge.register_upload
 * check knowledge.document.write again in the database.
 */

const WRITE = { allOf: ["knowledge.document.write"] } as const;
const DENIED = "Du har ikke adgang til at uploade dokumenter.";
const DEMO = "Upload er ikke tilgængelig i demoen uden database.";

type Failure = { ok: false; errors: string[] };

export type UploadTarget = { ok: true; documentId: string; versionId: string; path: string; token: string } | Failure;

export async function requestUploadTarget(input: UploadMetadataInput): Promise<UploadTarget> {
  if (isDemoMode()) return { ok: false, errors: [DEMO] };
  if (!(await authorize(WRITE))) return { ok: false, errors: [DENIED] };
  const validation = validateUploadMetadata(input);
  if (!validation.ok) return validation;

  const documentId = validation.value.documentId ?? randomUUID();
  const versionId = randomUUID();
  const path = originalPath(documentId, versionId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(INTAKE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, errors: ["Upload kunne ikke forberedes. Prøv igen."] };
  return { ok: true, documentId, versionId, path, token: data.token };
}

export type RegisterResult = { ok: true; versionId: string } | Failure;

export async function registerUploadedVersion(
  input: UploadMetadataInput & { documentId: string; versionId: string; isNewDocument: boolean },
): Promise<RegisterResult> {
  if (isDemoMode()) return { ok: false, errors: [DEMO] };
  if (!(await authorize(WRITE))) return { ok: false, errors: [DENIED] };
  if (!isUuid(input.documentId) || !isUuid(input.versionId)) return { ok: false, errors: ["Uploaden er ugyldig."] };
  const validation = validateUploadMetadata(
    input.isNewDocument ? { ...input, documentId: null } : { ...input, newDocument: null },
  );
  if (!validation.ok) return validation;
  const value = validation.value;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("knowledge").rpc("register_upload", {
    p_version_id: input.versionId,
    p_document_id: input.documentId,
    p_new_document: value.newDocument
      ? { product_id: value.newDocument.productId, document_type: value.newDocument.documentType, title: value.newDocument.title }
      : null,
    p_version_label: value.versionLabel,
    p_language: value.language,
    p_valid_from: value.validFrom,
    p_valid_to: value.validTo,
    p_checksum_sha256: value.checksumSha256,
    p_original_filename: value.originalFilename,
  });
  if (error || !data) return { ok: false, errors: ["Versionen kunne ikke registreres. Kontrollér metadata og prøv igen."] };
  return { ok: true, versionId: data as string };
}

export interface DuplicateVersion {
  versionId: string;
  documentId: string;
  title: string;
  versionLabel: string | null;
  status: string;
}

/** Duplicate dialog (docs/04 §14.3): does the file already exist as a version? */
export async function findDuplicateVersions(checksumSha256: string): Promise<DuplicateVersion[]> {
  if (isDemoMode() || !/^[0-9a-f]{64}$/i.test(checksumSha256)) return [];
  if (!(await authorize(WRITE))) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.schema("knowledge").rpc("find_versions_by_checksum", { p_checksum_sha256: checksumSha256 });
  return ((data ?? []) as { version_id: string; document_id: string; title: string; version_label: string | null; status: string }[]).map(
    (row) => ({ versionId: row.version_id, documentId: row.document_id, title: row.title, versionLabel: row.version_label, status: row.status }),
  );
}

/** A short-lived signed download URL for an original — knowledge managers only, audited. */
export async function getOriginalDownloadUrl(versionId: string): Promise<{ ok: true; url: string } | Failure> {
  if (isDemoMode()) return { ok: false, errors: [DEMO] };
  if (!isUuid(versionId) || !(await authorize({ anyOf: ["knowledge.document.write", "knowledge.version.publish"] }))) {
    return { ok: false, errors: ["Filen findes ikke."] };
  }
  const supabase = await createSupabaseServerClient();
  const { data: path, error } = await supabase.schema("knowledge").rpc("log_original_download", { p_version_id: versionId });
  if (error || !path) return { ok: false, errors: ["Filen findes ikke."] };
  const signed = await supabase.storage.from(ORIGINALS_BUCKET).createSignedUrl(path as string, 60);
  if (signed.error || !signed.data) return { ok: false, errors: ["Filen findes ikke."] };
  return { ok: true, url: signed.data.signedUrl };
}
