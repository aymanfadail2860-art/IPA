"use server";

import { revalidatePath } from "next/cache";

import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import type { PermissionRequirement } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { EvidenceSet } from "./core/evidence";
import { isDocumentTypeKey } from "./document-types";
import { retrieveEvidence, RetrievalError, type RetrievalRequest } from "./retrieval";
import { isUuid } from "./upload-validation";

/*
 * Server actions for the Knowledge Engine administration (docs/07 §12). Each action checks
 * the permission itself; RLS and the database functions check it again. Nothing here
 * changes a version's status — that only happens through review-actions.ts.
 */

const WRITE: PermissionRequirement = { allOf: ["knowledge.document.write"] };
const MANAGE: PermissionRequirement = { anyOf: ["knowledge.document.write", "knowledge.version.publish"] };
const PUBLISH: PermissionRequirement = { allOf: ["knowledge.version.publish"] };
const DEMO = "Ikke tilgængelig i demoen uden database.";
const DENIED = "Du har ikke adgang til denne handling.";

export type AdminActionResult = { ok: true } | { ok: false; error: string };

async function guard(requirement: PermissionRequirement): Promise<AdminActionResult | null> {
  if (isDemoMode()) return { ok: false, error: DEMO };
  if (!(await authorize(requirement))) return { ok: false, error: DENIED };
  return null;
}

function fromError(error: { code?: string; message: string } | null, fallback: string): AdminActionResult {
  if (!error) return { ok: true };
  if (error.code === "42501") return { ok: false, error: DENIED };
  if (error.code === "23505") return { ok: false, error: "Findes allerede." };
  // Messages raised by the knowledge functions are written for the user (Danish, no internals).
  if (error.code === "23514" || error.code === "P0002") return { ok: false, error: error.message };
  return { ok: false, error: fallback };
}

async function knowledge() {
  return (await createSupabaseServerClient()).schema("knowledge");
}

// ---------------------------------------------------------------------------- Produkter

export async function saveProduct(input: { id?: string; name: string; category: string }): Promise<AdminActionResult> {
  const denied = await guard(WRITE);
  if (denied) return denied;
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) return { ok: false, error: "Skriv et produktnavn (højst 200 tegn)." };
  const category = input.category.trim() || null;
  const db = await knowledge();
  const { error } = input.id
    ? isUuid(input.id)
      ? await db.from("products").update({ name, category }).eq("id", input.id)
      : { error: { message: "Produktet findes ikke." } }
    : await db.from("products").insert({ name, category });
  revalidatePath("/admin/products");
  return fromError(error, "Produktet kunne ikke gemmes.");
}

/** "Udfas" / genaktivér. Products are never deleted (documents refer to them). */
export async function setProductStatus(id: string, status: "active" | "retired"): Promise<AdminActionResult> {
  const denied = await guard(WRITE);
  if (denied) return denied;
  if (!isUuid(id) || !["active", "retired"].includes(status)) return { ok: false, error: "Produktet findes ikke." };
  const { error } = await (await knowledge()).from("products").update({ status }).eq("id", id);
  revalidatePath("/admin/products");
  return fromError(error, "Produktet kunne ikke opdateres.");
}

// ---------------------------------------------------------------------------- Dokumenter

export async function updateDocumentMetadata(
  id: string,
  input: { title: string; productId: string; documentType: string; externalRef: string },
): Promise<AdminActionResult> {
  const denied = await guard(WRITE);
  if (denied) return denied;
  const title = input.title.trim();
  if (!isUuid(id) || !isUuid(input.productId)) return { ok: false, error: "Dokumentet findes ikke." };
  if (title.length === 0 || title.length > 300) return { ok: false, error: "Skriv en titel (højst 300 tegn)." };
  if (!isDocumentTypeKey(input.documentType)) return { ok: false, error: "Vælg en dokumenttype." };
  const { error } = await (await knowledge())
    .from("documents")
    .update({ title, product_id: input.productId, document_type: input.documentType, external_ref: input.externalRef.trim() || null })
    .eq("id", id);
  revalidatePath(`/admin/documents/${id}`);
  return fromError(error, "Dokumentet kunne ikke gemmes.");
}

// ---------------------------------------------------------------------------- Adgang

export async function addGrant(
  documentId: string,
  input: { permission: string; granteeType: string; teamId?: string; userId?: string; includeDescendants?: boolean },
): Promise<AdminActionResult> {
  const denied = await guard(WRITE);
  if (denied) return denied;
  if (!isUuid(documentId)) return { ok: false, error: "Dokumentet findes ikke." };
  if (!["knowledge.document.read", "knowledge.document.read_historical"].includes(input.permission)) return { ok: false, error: "Vælg en rettighed." };
  const row: Record<string, unknown> = { document_id: documentId, permission_key: input.permission, grantee_type: input.granteeType };
  if (input.granteeType === "team") {
    if (!isUuid(input.teamId)) return { ok: false, error: "Vælg et team." };
    row.team_id = input.teamId;
    row.include_descendants = Boolean(input.includeDescendants);
  } else if (input.granteeType === "user") {
    if (!isUuid(input.userId)) return { ok: false, error: "Vælg en bruger." };
    row.user_id = input.userId;
  } else if (input.granteeType !== "all_users") {
    return { ok: false, error: "Vælg hvem der får adgang." };
  }
  const { error } = await (await knowledge()).from("document_access_grants").insert(row);
  revalidatePath(`/admin/documents/${documentId}`);
  return fromError(error, "Tildelingen kunne ikke gemmes.");
}

/** Removing a grant removes the access at once (docs/07 §4). */
export async function removeGrant(documentId: string, grantId: string): Promise<AdminActionResult> {
  const denied = await guard(WRITE);
  if (denied) return denied;
  if (!isUuid(documentId) || !isUuid(grantId)) return { ok: false, error: "Tildelingen findes ikke." };
  const { error } = await (await knowledge()).from("document_access_grants").delete().eq("id", grantId).eq("document_id", documentId);
  revalidatePath(`/admin/documents/${documentId}`);
  return fromError(error, "Tildelingen kunne ikke fjernes.");
}

// ---------------------------------------------------------------------------- Konflikter

/** "Registrér konflikt" between two versions (version level). */
export async function flagConflict(input: { description: string; versionA: string; versionB: string }): Promise<AdminActionResult> {
  const denied = await guard(MANAGE);
  if (denied) return denied;
  if (!isUuid(input.versionA) || !isUuid(input.versionB) || input.versionA === input.versionB) return { ok: false, error: "Vælg to forskellige versioner." };
  const { error } = await (await knowledge()).rpc("flag_conflict", {
    p_description: input.description.trim().slice(0, 2000),
    p_passages: [
      { side: "A", version_id: input.versionA },
      { side: "B", version_id: input.versionB },
    ],
  });
  revalidatePath("/admin/knowledge-base");
  return fromError(error, "Konflikten kunne ikke registreres.");
}

/** "Løs" (with a note) or "Afvis" (with a reason). The system never decides which source is right. */
export async function closeConflict(id: string, outcome: "resolved" | "dismissed", note: string): Promise<AdminActionResult> {
  const denied = await guard(PUBLISH);
  if (denied) return denied;
  if (!isUuid(id)) return { ok: false, error: "Konflikten findes ikke." };
  if (note.trim().length === 0) return { ok: false, error: outcome === "resolved" ? "Skriv en note om løsningen." : "Skriv en begrundelse for afvisningen." };
  const db = await knowledge();
  const { error } =
    outcome === "resolved"
      ? await db.rpc("resolve_conflict", { p_conflict_id: id, p_note: note.trim().slice(0, 2000) })
      : await db.rpc("dismiss_conflict", { p_conflict_id: id, p_reason: note.trim().slice(0, 2000) });
  revalidatePath("/admin/knowledge-base");
  return fromError(error, "Konflikten kunne ikke afgøres.");
}

// ---------------------------------------------------------------------------- Afprøv retrieval

export type RetrievalTestResult = { ok: true; set: EvidenceSet } | { ok: false; error: string };

/**
 * "Afprøv retrieval" (docs/07 §12.1): the SAME retrieveEvidence as later modules, for the
 * signed-in user only, with the same configuration. Read-only; the query is not stored or
 * logged. Requires knowledge.document.read and Admin access.
 */
export async function testRetrieval(request: RetrievalRequest): Promise<RetrievalTestResult> {
  if (isDemoMode()) return { ok: false, error: DEMO };
  if (!(await authorize(ADMIN_REQUIREMENT)) || !(await authorize({ allOf: ["knowledge.document.read"] }))) return { ok: false, error: DENIED };
  try {
    const set = await retrieveEvidence({
      query: request.query,
      mode: request.mode,
      asOf: request.asOf,
      language: request.language,
      productIds: request.productIds,
      documentIds: request.documentIds,
      documentTypes: request.documentTypes,
      topK: request.topK,
    });
    return { ok: true, set: structuredClone(set) };
  } catch (error) {
    if (error instanceof RetrievalError) return { ok: false, error: error.message };
    return { ok: false, error: "Søgningen kunne ikke gennemføres. Prøv igen." };
  }
}
