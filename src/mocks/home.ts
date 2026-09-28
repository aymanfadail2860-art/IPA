/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional "Nyt siden sidst" items and admin tasks.
 * Must never be used as or mixed with production data.
 */
export const mockChanges = [
  {
    id: "n1",
    product: "Erhvervsansvar",
    change: "Nye betingelser (version 4). Tillæg for behandlingsskader får ny standardsum.",
    validFrom: "2026-10-01",
    affectsActiveCases: 1,
  },
  {
    id: "n2",
    product: "Cyberforsikring",
    change: "Opdateret produktvejledning med nyt afsnit om acceptkrav til backup.",
    validFrom: "2026-09-15",
    affectsActiveCases: 0,
  },
  {
    id: "n3",
    product: "Acceptregler Erhverv",
    change: "Afklaring af omsætningsgrænse for standardaccept er under faglig behandling.",
    validFrom: "2026-09-28",
    affectsActiveCases: 0,
  },
];

export const mockTeamStatus = {
  team: "Erhverv Nord",
  learningPercent: 68,
  assessmentsThisMonth: 5,
  developmentAreaTop: "Acceptregler (5 medarbejdere)",
};

export const mockAdminTasks = {
  readyForReview: 2,
  conflicts: 1,
  knowledgeGaps: 4,
};
