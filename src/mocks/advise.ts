/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional companies and customer cases. No real customer
 * data exists in phase 5, and none may ever be added to this file.
 * Must never be used as or mixed with production data.
 */
import type { CaseParticipant, CustomerCase, WorkArea, WorkAreaState } from "@/types/domain";

import { mockSources } from "./sources";

/** The seven work areas of a customer case, in intended — not locked — order (IA §3). */
const WORK_AREA_NAMES = [
  ["virksomhedsprofil", "Virksomhedsprofil"],
  ["risikoanalyse", "Risikoanalyse"],
  ["manglende-oplysninger", "Manglende oplysninger"],
  ["forsikringsbehov", "Forsikringsbehov"],
  ["daekninger", "Dækninger"],
  ["accept", "Accept"],
  ["opsummering", "Opsummering"],
] as const;

function workAreas(
  states: readonly WorkAreaState[],
  openMissing?: number,
): WorkArea[] {
  return WORK_AREA_NAMES.map(([id, name], index) => ({
    id,
    name,
    state: states[index] ?? "notStarted",
    openItems: id === "manglende-oplysninger" ? openMissing : undefined,
  }));
}

const mikkel: CaseParticipant = { userId: "mock-user-mikkel", name: "Mikkel Sørensen", initials: "MS", access: "Ejer" };
const sara: CaseParticipant = { userId: "mock-user-sara", name: "Sara Lund", initials: "SL", access: "Kan redigere" };
const peter: CaseParticipant = { userId: "mock-user-peter", name: "Peter Dahl", initials: "PD", access: "Kan læse" };
const jonas: CaseParticipant = { userId: "mock-user-jonas", name: "Jonas Kjær", initials: "JK", access: "Kan redigere" };
const anne: CaseParticipant = { userId: "mock-user-anne", name: "Anne Holm", initials: "AH", access: "Kan læse" };

const emptyCaseContent = {
  signals: [],
  facts: [],
  conclusions: [],
  onDemandSuggestions: [],
  note: "",
  sourceDocuments: 0,
  history: [],
} as const;

export const mockCases: readonly CustomerCase[] = [
  {
    id: "nordjysk-entreprise",
    companyName: "Nordjysk Entreprise A/S",
    industry: "Tømrer- og snedkerentreprise",
    employees: "38 ansatte",
    status: "active",
    currentAreaId: "risikoanalyse",
    owner: mikkel,
    participants: [mikkel, sara, peter],
    updatedAt: "2026-09-28T08:15:00",
    workAreas: workAreas(["complete", "inProgress", "attention", "notStarted", "notStarted", "notStarted", "notStarted"], 3),
    signals: [
      {
        id: "sig-1",
        tone: "warning",
        title: "2 kritiske oplysninger mangler",
        detail: "Omsætning · Tidligere skader de seneste 5 år",
        actionLabel: "Gå til Manglende oplysninger",
        targetAreaId: "manglende-oplysninger",
      },
      {
        id: "sig-2",
        tone: "info",
        title: "Nye betingelser for Erhvervsansvar gælder fra 1. oktober 2026",
        detail: "Sagen hviler i dag på version 3. Vurder, om ændringen påvirker rådgivningen.",
        actionLabel: "Se ændringen",
      },
    ],
    facts: [
      { label: "Branche", value: "Tømrer- og snedkerentreprise (DB07 43.32.00)" },
      { label: "Ansatte", value: "38" },
      { label: "Arbejdssteder", value: "Kundernes byggepladser i Nordjylland" },
      { label: "Nuværende forsikringer", value: "Erhvervsansvar, Arbejdsskade, Erhvervsløsøre" },
    ],
    conclusions: [
      {
        id: "con-1",
        title: "Arbejde på kundens ejendom er den væsentligste ansvarsrisiko",
        text: "Virksomheden udfører størstedelen af sit arbejde i kundernes bygninger. Skader på det, der arbejdes på, er den risiko, der oftest fører til krav.",
        validatedBy: "Mikkel Sørensen",
        validatedAt: "2026-09-25",
        sources: [mockSources.liabilityTermsV3],
      },
    ],
    onDemandSuggestions: [
      {
        id: "sug-1",
        title: "Behandlingsskader er ikke dækket i den nuværende police",
        text: "Policen indeholder ikke tillæg for behandlingsskader. Med virksomhedens arbejdsform bør tillægget drøftes med kunden.",
        sources: [mockSources.liabilityTermsV3, mockSources.liabilityGuideV4],
      },
      {
        id: "sug-2",
        title: "Nøgler og adgangskort hos kunder bør afdækkes",
        text: "Ansatte får udleveret nøgler til kundernes ejendomme. Afklar, om bortkomst af nøgler og omkodning af låse er relevant at dække.",
        sources: [mockSources.businessProcessUnderwriting],
      },
      {
        id: "sug-3",
        title: "Underentreprenører skal afklares",
        text: "Det fremgår ikke, om virksomheden bruger underentreprenører. Det påvirker både ansvarsvurdering og accept.",
        sources: [mockSources.businessProcessUnderwriting],
      },
    ],
    note: "Kunden nævnte på mødet, at de overvejer at udvide med vinduesudskiftning i 2027. Tag det op ved næste gennemgang.",
    sourceDocuments: 4,
    history: [
      { at: "2026-09-28T08:15:00", text: "Risikoanalyse opdateret" },
      { at: "2026-09-25T13:40:00", text: "Konklusion valideret af Mikkel Sørensen" },
      { at: "2026-09-24T10:02:00", text: "Sagen delt med Sara Lund (kan redigere)" },
      { at: "2026-09-23T09:30:00", text: "Sagen oprettet" },
    ],
  },
  {
    id: "bagerhuset",
    companyName: "Bagerhuset ApS",
    industry: "Bageri med butik",
    employees: "14 ansatte",
    status: "awaitingCustomer",
    currentAreaId: "manglende-oplysninger",
    owner: mikkel,
    participants: [mikkel, anne],
    updatedAt: "2026-09-26T15:20:00",
    workAreas: workAreas(["complete", "complete", "attention", "inProgress"], 2),
    ...emptyCaseContent,
  },
  {
    id: "vestkyst-logistik",
    companyName: "Vestkyst Logistik ApS",
    industry: "Godstransport og lager",
    employees: "62 ansatte",
    status: "active",
    currentAreaId: "daekninger",
    owner: mikkel,
    participants: [mikkel, sara, jonas],
    updatedAt: "2026-09-24T11:05:00",
    workAreas: workAreas(["complete", "complete", "complete", "complete", "inProgress"], 0),
    ...emptyCaseContent,
  },
  {
    id: "tandklinikken-aalborg",
    companyName: "Tandklinikken Aalborg I/S",
    industry: "Tandlægepraksis",
    employees: "9 ansatte",
    status: "draft",
    currentAreaId: "virksomhedsprofil",
    owner: mikkel,
    participants: [mikkel],
    updatedAt: "2026-09-19T09:45:00",
    workAreas: workAreas(["inProgress"]),
    ...emptyCaseContent,
  },
  {
    id: "fjordens-vvs",
    companyName: "Fjordens VVS ApS",
    industry: "VVS-installation",
    employees: "21 ansatte",
    status: "closed",
    currentAreaId: "opsummering",
    owner: mikkel,
    participants: [mikkel],
    updatedAt: "2026-08-30T14:10:00",
    workAreas: workAreas(["complete", "complete", "complete", "complete", "complete", "complete", "complete"], 0),
    ...emptyCaseContent,
  },
];

export function mockCaseById(id: string): CustomerCase | undefined {
  return mockCases.find((entry) => entry.id === id);
}
