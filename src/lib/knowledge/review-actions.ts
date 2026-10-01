"use server";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { isUuid } from "./upload-validation";

/*
 * Review and approval (docs/07 §2.2, §3). Thin server actions over the database functions,
 * which check permission and state again and run each transition in one transaction.
 * Nothing here can make a version authoritative except "Godkend som autoritativ" by a user
 * with knowledge.version.publish.
 */

const PUBLISH = { allOf: ["knowledge.version.publish"] } as const;
const WRITE = { allOf: ["knowledge.document.write"] } as const;
const DEMO = "Ikke tilgængelig i demoen uden database.";
const DENIED = "Du har ikke adgang til denne handling.";

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface ReviewIssue {
  code: string;
  message: string;
}

export interface ReviewState {
  status: string;
  canApprove: boolean;
  blockers: ReviewIssue[];
  warnings: ReviewIssue[];
  publication: Record<string, unknown>;
  qualityReport: Record<string, unknown>;
}

type Requirement = typeof PUBLISH | typeof WRITE;

async function run(requirement: Requirement, versionId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: DEMO };
  if (!isUuid(versionId)) return { ok: false, error: "Versionen findes ikke." };
  if (!(await authorize(requirement))) return { ok: false, error: DENIED };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.schema("knowledge").rpc(fn, { p_version_id: versionId, ...args });
  if (!error) return { ok: true };
  if (error.code === "42501") return { ok: false, error: DENIED };
  // The database's own messages are written for the user (Danish, no content, no internals).
  if (error.code === "23514" || error.code === "P0002") return { ok: false, error: error.message };
  return { ok: false, error: "Handlingen kunne ikke gennemføres. Prøv igen." };
}

export async function getReviewState(versionId: string): Promise<ReviewState | null> {
  if (isDemoMode() || !isUuid(versionId)) return null;
  if (!(await authorize({ anyOf: ["knowledge.document.write", "knowledge.version.publish"] }))) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("knowledge").rpc("review_state", { p_version_id: versionId });
  if (error || !data) return null;
  const state = data as {
    status: string;
    can_approve: boolean;
    blockers: ReviewIssue[];
    warnings: ReviewIssue[];
    publication: Record<string, unknown>;
    quality_report: Record<string, unknown>;
  };
  return {
    status: state.status,
    canApprove: state.can_approve,
    blockers: state.blockers,
    warnings: state.warnings,
    publication: state.publication,
    qualityReport: state.quality_report,
  };
}

/** "Påbegynd review" — locks the version's metadata. */
export async function startReview(versionId: string): Promise<ActionResult> {
  return run(PUBLISH, versionId, "start_review", {});
}

/** "Afbryd review". */
export async function cancelReview(versionId: string): Promise<ActionResult> {
  return run(PUBLISH, versionId, "cancel_review", {});
}

/**
 * "Godkend som autoritativ" — approval and publication in one transaction. The warning codes
 * shown in the confirmation dialog are recorded with the decision and in audit.
 */
export async function approveVersion(versionId: string, acknowledgedWarnings: string[]): Promise<ActionResult> {
  return run(PUBLISH, versionId, "approve_version", { p_acknowledged_warnings: acknowledgedWarnings.slice(0, 50) });
}

/** "Afvis" — a reason is required. */
export async function rejectVersion(versionId: string, reason: string): Promise<ActionResult> {
  if (reason.trim().length === 0) return { ok: false, error: "Skriv en begrundelse for afvisningen." };
  return run(PUBLISH, versionId, "reject_version", { p_reason: reason.trim().slice(0, 2000) });
}

export type WithdrawalCategory = "invalid" | "withdrawn_by_owner" | "other";

/** "Deaktivér" — removes the version from all retrieval at once; it is never deleted. */
export async function withdrawVersion(versionId: string, category: WithdrawalCategory, reason: string): Promise<ActionResult> {
  if (!["invalid", "withdrawn_by_owner", "other"].includes(category)) return { ok: false, error: "Vælg en kategori." };
  if (reason.trim().length === 0) return { ok: false, error: "Skriv en begrundelse for deaktiveringen." };
  return run(PUBLISH, versionId, "withdraw_version", { p_category: category, p_reason: reason.trim().slice(0, 2000) });
}

/** "Genbehandl" — after a processing failure or a rejection. */
export async function requestReprocess(versionId: string): Promise<ActionResult> {
  return run(WRITE, versionId, "request_reprocess", {});
}

/** "Kassér" — only versions that were never published. */
export async function discardVersion(versionId: string): Promise<ActionResult> {
  return run(WRITE, versionId, "discard_version", {});
}

/** Correct a version's metadata before review; a rejected version becomes ready for review again. */
export async function updateVersionMetadata(
  versionId: string,
  metadata: { versionLabel: string | null; language: string; validFrom: string | null; validTo: string | null },
): Promise<ActionResult> {
  const dates = [metadata.validFrom, metadata.validTo].filter((value): value is string => Boolean(value));
  if (dates.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))) return { ok: false, error: "Datoerne er ugyldige." };
  if (metadata.validFrom && metadata.validTo && metadata.validTo <= metadata.validFrom) {
    return { ok: false, error: "Gyldig til skal ligge efter gyldig fra." };
  }
  return run(WRITE, versionId, "update_version_metadata", {
    p_version_label: metadata.versionLabel,
    p_language: metadata.language || "da",
    p_valid_from: metadata.validFrom,
    p_valid_to: metadata.validTo,
  });
}
