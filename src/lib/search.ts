import { casesForUser } from "@/lib/auth/case-access";
import type { CustomerCase } from "@/types/domain";

export interface SearchEntry {
  id: string;
  group: string;
  title: string;
  detail?: string;
  href: string;
  /** Only shown to users with admin permissions. */
  adminOnly?: boolean;
}

export const OWN_CASES_GROUP = "Egne kundecases";

/**
 * Entries the global search may show this user (docs/04 §21). Customer cases are derived
 * from the cases the user owns or is assigned to — the same per-case rule as the case
 * overview, for every role. Static entries never contain customer cases.
 */
export function searchEntriesForUser({
  entries,
  cases,
  userId,
  isAdmin,
}: {
  entries: readonly SearchEntry[];
  cases: readonly CustomerCase[];
  userId: string;
  isAdmin: boolean;
}): SearchEntry[] {
  const caseEntries: SearchEntry[] = casesForUser(cases, userId).map((entry) => ({
    id: `case-${entry.id}`,
    group: OWN_CASES_GROUP,
    title: entry.companyName,
    detail: entry.workAreas.find((area) => area.id === entry.currentAreaId)?.name,
    href: `/advise/${entry.id}`,
  }));
  const staticEntries = entries.filter((entry) => entry.group !== OWN_CASES_GROUP && (!entry.adminOnly || isAdmin));
  return [...staticEntries, ...caseEntries];
}
