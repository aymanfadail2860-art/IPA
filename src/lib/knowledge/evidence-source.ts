import type { SourceReference } from "@/types/domain";

import type { EvidenceItem } from "./core/evidence";

/**
 * An evidence item as the source card's reference (docs/04 §17.1). Pure — used by "Afprøv
 * retrieval" and by Copilot. Numbers follow the order of `items`; a visible conflict points to
 * its counterpart's number.
 */
export function evidenceToSource(item: EvidenceItem, items: readonly EvidenceItem[]): SourceReference {
  const counterpart = item.conflicts.find((conflict) => conflict.visibility === "visible");
  return {
    id: item.evidenceId,
    number: items.indexOf(item) + 1,
    documentTitle: item.document.title,
    version: item.document.versionLabel ?? "—",
    section: item.location.sectionNumber ? `§${item.location.sectionNumber}` : (item.location.heading ?? ""),
    page: item.location.pageStart,
    excerpt: item.excerpt.text,
    leadIn: item.excerpt.leadIn ?? undefined,
    validity: item.validity.temporalStatus === "historical" ? "historical" : "current",
    validFrom: item.validity.validFrom ?? "",
    validTo: item.validity.validTo ?? undefined,
    conflictsWith:
      counterpart && counterpart.visibility === "visible" ? items.findIndex((entry) => entry.evidenceId === counterpart.counterpartEvidenceId) + 1 || undefined : undefined,
  };
}
