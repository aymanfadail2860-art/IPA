/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional team figures and employees.
 * Must never be used as or mixed with production data.
 */
import type { TeamMemberRow } from "@/types/domain";

/** Teams the mock leader has scope for, as a hierarchy (leader_scopes, include_descendants). */
export const mockTeams = [
  { id: "erhverv-nord", name: "Erhverv Nord", parent: null },
  { id: "erhverv-nord-aalborg", name: "Erhverv Nord · Aalborg", parent: "erhverv-nord" },
  { id: "erhverv-nord-hjoerring", name: "Erhverv Nord · Hjørring", parent: "erhverv-nord" },
] as const;

export const mockTeamMetrics = [
  { id: "learning", label: "Læring", value: "68 %", explanation: "af tildelte forløb gennemført" },
  { id: "assessment", label: "Assessment", value: "12 bestået", explanation: "3 ikke bestået i perioden" },
  { id: "competence", label: "Kompetence", value: "4 områder", explanation: "under teamets mål" },
  { id: "activity", label: "Aktivitet", value: "+12 %", explanation: "aktive dage ift. forrige periode" },
];

export const mockTeamDevelopmentAreas = [
  { area: "Acceptregler", employees: 5 },
  { area: "Behovsafdækning", employees: 4 },
  { area: "Driftstab", employees: 3 },
  { area: "Cyberforsikring", employees: 2 },
];

/** Monthly completion rate (percent) — shown as a line chart with a data table behind it. */
export const mockLearningTrend = [
  { month: "Apr", value: 41 },
  { month: "Maj", value: 47 },
  { month: "Jun", value: 52 },
  { month: "Jul", value: 55 },
  { month: "Aug", value: 61 },
  { month: "Sep", value: 68 },
];

export const mockTeamMembers: readonly TeamMemberRow[] = [
  { id: "m1", name: "Mikkel Sørensen", initials: "MS", learningPercent: 46, assessments: "1 bestået · 1 ikke", competenciesBelowTarget: 2, lastActive: "2026-09-28" },
  { id: "m2", name: "Sara Lund", initials: "SL", learningPercent: 82, assessments: "3 bestået", competenciesBelowTarget: 0, lastActive: "2026-09-27" },
  { id: "m3", name: "Peter Dahl", initials: "PD", learningPercent: 71, assessments: "2 bestået", competenciesBelowTarget: 1, lastActive: "2026-09-26" },
  { id: "m4", name: "Louise Bech", initials: "LB", learningPercent: 58, assessments: "2 bestået · 1 ikke", competenciesBelowTarget: 2, lastActive: "2026-09-25" },
  { id: "m5", name: "Ahmad Rahimi", initials: "AR", learningPercent: 90, assessments: "4 bestået", competenciesBelowTarget: 0, lastActive: "2026-09-28" },
  { id: "m6", name: "Karen Vestergaard", initials: "KV", learningPercent: 61, assessments: "1 bestået · 1 ikke", competenciesBelowTarget: 1, lastActive: "2026-09-22" },
];
