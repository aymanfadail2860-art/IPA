import type { CaseSummary, CaseWorkspaceContent, CustomerCase, WorkArea, WorkAreaState } from "@/types/domain";

/** The seven work areas of a customer case, in intended — not locked — order (IA §3). */
export const WORK_AREA_NAMES = [
  ["virksomhedsprofil", "Virksomhedsprofil"],
  ["risikoanalyse", "Risikoanalyse"],
  ["manglende-oplysninger", "Manglende oplysninger"],
  ["forsikringsbehov", "Forsikringsbehov"],
  ["daekninger", "Dækninger"],
  ["accept", "Accept"],
  ["opsummering", "Opsummering"],
] as const;

export function buildWorkAreas(states: readonly WorkAreaState[] = [], openMissing?: number): WorkArea[] {
  return WORK_AREA_NAMES.map(([id, name], index) => ({
    id,
    name,
    state: states[index] ?? "notStarted",
    openItems: id === "manglende-oplysninger" ? openMissing : undefined,
  }));
}

/** A case whose work-area content has not been built yet (all areas not started). */
export function emptyWorkspaceContent(): CaseWorkspaceContent {
  return {
    industry: "",
    employees: "",
    currentAreaId: "virksomhedsprofil",
    workAreas: buildWorkAreas(),
    signals: [],
    facts: [],
    conclusions: [],
    onDemandSuggestions: [],
    note: "",
    sourceDocuments: 0,
    history: [],
  };
}

/** Combines the case from the database (identity, status, participants) with its content. */
export function composeCase(summary: CaseSummary, content: CaseWorkspaceContent): CustomerCase {
  const owner = summary.participants.find((participant) => participant.access === "Ejer") ?? summary.participants[0];
  return {
    ...content,
    id: summary.id,
    companyName: summary.companyName,
    status: summary.status,
    updatedAt: summary.updatedAt,
    owner,
    participants: summary.participants,
  };
}
