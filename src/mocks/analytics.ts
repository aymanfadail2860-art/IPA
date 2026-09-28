/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional team figures and employees.
 * Must never be used as or mixed with production data.
 */
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

