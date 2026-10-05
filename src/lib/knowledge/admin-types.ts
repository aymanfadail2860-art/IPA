import type { Status } from "@/config/status";

export type { EvidenceConflict, EvidenceItem, EvidenceSet } from "./core/evidence";

/**
 * View models for the Knowledge Engine administration (docs/07 §12). Shared by server loaders
 * (admin-data.ts) and client components; no database or server code here.
 */

export type VersionStatus =
  | "uploaded"
  | "processing"
  | "processing_failed"
  | "processed"
  | "under_review"
  | "rejected"
  | "published"
  | "withdrawn"
  | "discarded";

/** Danish labels from docs/07 §2.1. */
export const VERSION_STATUS: Record<VersionStatus, { label: string; status: Status }> = {
  uploaded: { label: "Uploadet", status: "neutral" },
  processing: { label: "Behandles", status: "info" },
  processing_failed: { label: "Kunne ikke behandles", status: "error" },
  processed: { label: "Klar til review", status: "warning" },
  under_review: { label: "Under review", status: "info" },
  rejected: { label: "Afvist", status: "error" },
  published: { label: "Godkendt / Aktiv", status: "authoritative" },
  withdrawn: { label: "Deaktiveret", status: "neutral" },
  discarded: { label: "Kasseret", status: "neutral" },
};

/**
 * The security examination of the original (8B-I5, docs/08b §21.6). Only the category is shown —
 * never the file, the scanner's finding or other details that could help an attacker.
 */
export type SecurityStatus =
  | "quarantined"
  | "scanning"
  | "released"
  | "rejected_invalid"
  | "rejected_active_content"
  | "rejected_malware"
  | "scan_failed"
  | "not_scanned";

export const SECURITY_STATUS: Record<SecurityStatus, { label: string; status: Status }> = {
  quarantined: { label: "I karantæne", status: "warning" },
  scanning: { label: "Scanner", status: "info" },
  released: { label: "Godkendt sikkerhedskontrol", status: "success" },
  rejected_invalid: { label: "Afvist: ugyldig PDF", status: "error" },
  rejected_active_content: { label: "Afvist: aktivt indhold", status: "error" },
  rejected_malware: { label: "Afvist: malware", status: "error" },
  scan_failed: { label: "Teknisk scanfejl", status: "error" },
  // Uploaded before the security examination existed: never released, cannot be processed.
  not_scanned: { label: "Ikke sikkerhedsscannet", status: "neutral" },
};

/** The database's security state and failure code → the category the Admin shows. */
export function securityStatus(state: string | null | undefined, failureCode: string | null | undefined): SecurityStatus {
  switch (state) {
    case "quarantined":
      return "quarantined";
    case "scanning":
      return "scanning";
    case "released":
      return "released";
    case "scan_failed":
      return "scan_failed";
    case "rejected":
      if (failureCode === "malware_detected") return "rejected_malware";
      if (failureCode === "active_content" || failureCode === "embedded_file") return "rejected_active_content";
      return "rejected_invalid";
    case "legacy_unscanned":
      return "not_scanned";
    default:
      // Unknown: never shown as passed.
      return "quarantined";
  }
}

/** Document list tabs (docs/07 §12): one tab per status group. */
export const DOCUMENT_TABS = [
  { id: "processing", label: "Uploadet/Behandles", statuses: ["uploaded", "processing"] },
  { id: "processed", label: "Klar til review", statuses: ["processed"] },
  { id: "under_review", label: "Under review", statuses: ["under_review"] },
  { id: "processing_failed", label: "Kunne ikke behandles", statuses: ["processing_failed"] },
  { id: "published", label: "Godkendt/Aktiv", statuses: ["published"] },
  { id: "rejected", label: "Afvist", statuses: ["rejected"] },
  { id: "withdrawn", label: "Deaktiveret", statuses: ["withdrawn"] },
] as const satisfies readonly { id: string; label: string; statuses: readonly VersionStatus[] }[];

export type DocumentTabId = (typeof DOCUMENT_TABS)[number]["id"];

export interface AdminProduct {
  id: string;
  name: string;
  category: string | null;
  status: "active" | "retired";
  documentCount: number;
}

export interface AdminVersionRow {
  id: string;
  documentId: string;
  documentTitle: string;
  productName: string;
  documentType: string;
  versionLabel: string | null;
  language: string;
  status: VersionStatus;
  validFrom: string | null;
  validTo: string | null;
  supersededBy: string | null;
  uploadedAt: string;
  updatedAt: string;
  /** Plain-language reason for a processing failure (never document content). */
  errorMessage: string | null;
  /** The document has a gap in its validity (B-006). */
  documentHasGap: boolean;
  /** The security examination of the original (8B-I5). */
  security: SecurityStatus;
}

/** Derived state of a published version (docs/07 §3.3), relative to today. */
export function publishedState(version: Pick<AdminVersionRow, "validFrom" | "validTo" | "supersededBy">, today: string) {
  if (version.validTo && version.validTo <= today) return { key: "historical" as const, label: "Historisk", status: "historical" as const };
  if (version.validFrom && version.validFrom > today) return { key: "future" as const, label: "Godkendt", status: "authoritative" as const };
  return { key: "current" as const, label: "Aktiv", status: "authoritative" as const };
}

export interface ValidityGap {
  documentId: string;
  documentTitle: string;
  language: string;
  from: string;
  /** null = open-ended */
  to: string | null;
  kind: "between_versions" | "after_withdrawn_successor";
}

export interface AccessGrant {
  id: string;
  permission: "knowledge.document.read" | "knowledge.document.read_historical";
  granteeType: "all_users" | "team" | "user";
  granteeLabel: string;
  includeDescendants: boolean;
  grantedAt: string;
}

export interface ConflictPassage {
  side: "A" | "B";
  versionId: string;
  documentId: string;
  documentTitle: string;
  versionLabel: string | null;
  versionStatus: VersionStatus;
  /** null = the whole version. */
  chunk: { id: string; text: string; heading: string | null; pageStart: number; pageEnd: number } | null;
}

export interface AdminConflict {
  id: string;
  status: "open" | "resolved" | "dismissed";
  detectedBy: "system" | "user";
  rule: "overlapping_scope" | "duplicate_content" | "manual";
  description: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  passages: ConflictPassage[];
}

export const CONFLICT_RULE_LABEL: Record<AdminConflict["rule"], string> = {
  overlapping_scope: "Samme produkt og dokumenttype med overlappende gyldighed",
  duplicate_content: "Identisk tekst i dokumenter med forskellig metadata",
  manual: "Registreret manuelt",
};

export interface CoverageRow {
  productId: string;
  productName: string;
  /** Document type key → number of documents with a published version. */
  publishedByType: Record<string, number>;
}

export const GAP_KIND_LABEL: Record<ValidityGap["kind"], string> = {
  between_versions: "Mellem to versioner",
  after_withdrawn_successor: "Efter en deaktiveret efterfølger",
};
