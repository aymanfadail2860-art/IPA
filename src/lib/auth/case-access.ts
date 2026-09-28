import type { CustomerCase } from "@/types/domain";

/**
 * Case access is granted PER CASE through participants — never through a role
 * (docs/03-technical-architecture.md §10). `advise.case.read` with scope `own` means
 * "own and assigned cases" for every role.
 *
 * Phase 5: evaluated in the UI against mock data. Later enforced server-side and in RLS.
 */
export function isCaseParticipant(customerCase: CustomerCase, userId: string): boolean {
  return customerCase.participants.some((participant) => participant.userId === userId);
}

export function casesForUser(cases: readonly CustomerCase[], userId: string): CustomerCase[] {
  return cases.filter((entry) => isCaseParticipant(entry, userId));
}
