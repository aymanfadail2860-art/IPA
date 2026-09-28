/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional tests, cases and results.
 * Must never be used as or mixed with production data.
 */
import type { AssessmentItem, Competency } from "@/types/domain";

export const mockAssessments: readonly AssessmentItem[] = [
  {
    id: "ass-erhvervsansvar-test",
    title: "Erhvervsansvar — faglig test",
    product: "Erhvervsansvar",
    type: "test",
    durationMinutes: 30,
    timeLimited: true,
    questions: 20,
    status: "available",
    devicePolicy: "mobileAllowed",
  },
  {
    id: "ass-erhvervsansvar-case",
    title: "Erhvervsansvar — rådgivningscase",
    product: "Erhvervsansvar",
    type: "case",
    durationMinutes: 45,
    timeLimited: false,
    status: "locked",
    devicePolicy: "desktopRequired",
    prerequisite: "Gennemfør produktforløbet Erhvervsansvar",
  },
  {
    id: "ass-bygning-test",
    title: "Bygningsforsikring, erhverv — faglig test",
    product: "Bygningsforsikring, erhverv",
    type: "test",
    durationMinutes: 25,
    timeLimited: true,
    questions: 18,
    status: "passed",
    devicePolicy: "mobileAllowed",
    result: { score: "16 af 18 rigtige", completedAt: "2026-08-14" },
  },
  {
    id: "ass-loesoere-test",
    title: "Erhvervsløsøre — faglig test",
    product: "Erhvervsløsøre",
    type: "test",
    durationMinutes: 20,
    timeLimited: false,
    questions: 15,
    status: "failed",
    devicePolicy: "desktopRecommended",
    result: { score: "9 af 15 rigtige", completedAt: "2026-09-10" },
  },
];

export const mockCompetencies: readonly Competency[] = [
  { id: "c-ansvar", name: "Ansvarsforsikringer", level: 3, target: 3, basis: "Test Erhvervsansvar (modul 1–3), træning" },
  { id: "c-ting", name: "Tingsforsikringer", level: 3, target: 3, basis: "Test Bygningsforsikring, bestået 14. aug." },
  { id: "c-behov", name: "Behovsafdækning", level: 2, target: 3, basis: "3 træninger, seneste 26. sep." },
  { id: "c-accept", name: "Acceptregler", level: 2, target: 3, basis: "Test Erhvervsløsøre, ikke bestået 10. sep." },
  { id: "c-raadgivning", name: "Salg og rådgivning", level: 2, target: 2, basis: "2 kundecases i Practice" },
];

export const mockCompetencyLevelLabels: Record<number, string> = {
  1: "Grundlæggende",
  2: "Øvet",
  3: "Selvstændig",
  4: "Ekspert",
};
