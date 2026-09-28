import { hasPermission, type PermissionGrant, type PermissionKey } from "@/lib/auth/permissions";

/**
 * Data categories shown in Min profil → Synlighed (docs/04-ui-ux-design.md §13.1).
 *
 * The list is DERIVED from the leader's actual permissions — not static text — so it is
 * always true. A category is visible to the leader only when the leader holds the
 * permission with scope "team". Categories without any leader permission (Copilot
 * conversations, case content, working notes, individual answers) are always "cannot see".
 *
 * The mapping category → permission is an interpretation of docs/03 §10 and must be
 * confirmed when the full permission catalogue is fixed.
 */
export interface VisibilityCategory {
  id: string;
  label: string;
  permission: PermissionKey | null;
}

export const VISIBILITY_CATEGORIES: readonly VisibilityCategory[] = [
  { id: "learning-progress", label: "Din læringsprogression", permission: "learning.progress.read" },
  { id: "completed-paths", label: "Gennemførte læringsforløb", permission: "learning.progress.read" },
  { id: "assessment-results", label: "Assessment-resultater", permission: "assessment.result.read" },
  { id: "competencies", label: "Kompetencer", permission: "assessment.result.read" },
  { id: "development-areas", label: "Udviklingsområder", permission: "assessment.result.read" },
  { id: "copilot", label: "Dine Copilot-samtaler", permission: null },
  { id: "case-content", label: "Indholdet af dine kundecases", permission: null },
  { id: "notes", label: "Dine arbejdsnoter", permission: null },
  { id: "practice-answers", label: "Dine svar i øvelser og rollespil, ud over den samlede feedback", permission: null },
];

export function leaderVisibility(leaderGrants: readonly PermissionGrant[]) {
  const withAccess = VISIBILITY_CATEGORIES.map((category) => ({
    ...category,
    visible: category.permission !== null && hasPermission(leaderGrants, category.permission, "team"),
  }));
  return {
    canSee: withAccess.filter((category) => category.visible),
    cannotSee: withAccess.filter((category) => !category.visible),
  };
}
