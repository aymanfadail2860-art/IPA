import type { CaseSummary } from "@/types/domain";

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

const STATUS_LABEL: Record<CaseSummary["status"], string> = {
  draft: "Kladde",
  active: "Aktiv",
  awaitingCustomer: "Afventer kunde",
  closed: "Afsluttet",
};

/**
 * Entries the global search may show this user (docs/04 §21). Customer cases come only
 * from `cases`, which the server loads under RLS (own and assigned cases, every role).
 * Static entries never contain customer cases.
 */
export function searchEntriesForUser({
  entries,
  cases,
  isAdmin,
}: {
  entries: readonly SearchEntry[];
  cases: readonly CaseSummary[];
  isAdmin: boolean;
}): SearchEntry[] {
  const caseEntries: SearchEntry[] = cases.map((entry) => ({
    id: `case-${entry.id}`,
    group: OWN_CASES_GROUP,
    title: entry.companyName,
    detail: STATUS_LABEL[entry.status],
    href: `/advise/${entry.id}`,
  }));
  const staticEntries = entries.filter((entry) => entry.group !== OWN_CASES_GROUP && (!entry.adminOnly || isAdmin));
  return [...staticEntries, ...caseEntries];
}
