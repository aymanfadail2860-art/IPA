/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional work-area content for ONE development seed case,
 * so the Advise workspace design from phase 5 can still be evaluated. Cases themselves
 * (identity, status, owner, participants) live in the database under RLS.
 *
 * The content is attached only to the seed fixture case "Testvirksomhed Alfa ApS"
 * (scripts/seed-fixtures.mjs). Real cases never match and show empty work areas.
 * Must never be used as or mixed with production data.
 */
import { buildWorkAreas } from "@/lib/advise/workspace";
import type { CaseWorkspaceContent } from "@/types/domain";

import { SEED_CASE_IDS } from "../../scripts/seed-fixtures.mjs";

import { mockSources } from "./sources";

const alfaContent: CaseWorkspaceContent =
{
    industry: "Tømrer- og snedkerentreprise",
    employees: "38 ansatte",
    currentAreaId: "risikoanalyse",
    workAreas: buildWorkAreas(["complete", "inProgress", "attention", "notStarted", "notStarted", "notStarted", "notStarted"], 3),
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
        validatedBy: "Test Rådgiver A",
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
      { at: "2026-09-25T13:40:00", text: "Konklusion valideret af Test Rådgiver A" },
      { at: "2026-09-24T10:02:00", text: "Sagen delt med Test Rådgiver B (kan læse)" },
      { at: "2026-09-23T09:30:00", text: "Sagen oprettet" },
    ],
  }
;

/** Mock work-area content for the development seed fixture case, or null for any other case. */
export function mockCaseWorkspaceContent(caseId: string): CaseWorkspaceContent | null {
  return caseId === SEED_CASE_IDS.alfa ? alfaContent : null;
}
