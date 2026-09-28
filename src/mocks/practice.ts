/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional training activity and feedback.
 * Must never be used as or mixed with production data.
 */
import type { TrainingForm, TrainingSessionSummary } from "@/types/domain";

export const mockTrainingForms: readonly TrainingForm[] = [
  {
    id: "kundecases",
    name: "Kundecases",
    trains: "Samlet håndtering af en fiktiv kundesituation fra behov til anbefaling.",
    lastActivity: "Senest 18. september · Vestjysk Maskinstation",
  },
  {
    id: "rollespil",
    name: "AI-rollespil",
    trains: "Den frie samtale med en simuleret kunde. Copilot er slået fra under selve samtalen.",
    lastActivity: "Senest 26. september · Bagerhuset, behovsafdækning",
    copilotLockedDuringSession: true,
  },
  {
    id: "behovsafdaekning",
    name: "Behovsafdækning",
    trains: "At afdække kundens faktiske behov gennem åbne, præcise spørgsmål.",
    lastActivity: "Senest 26. september",
  },
  {
    id: "objection-training",
    name: "Objection Training",
    trains: "At håndtere indvendinger som pris, eksisterende forsikring og tidspres.",
  },
  {
    id: "produkttraening",
    name: "Produkttræning",
    trains: "At beherske et konkret produkt: dækninger, undtagelser og acceptregler.",
    lastActivity: "Senest 9. september · Erhvervsløsøre",
  },
];

export const mockRecentTraining: readonly TrainingSessionSummary[] = [
  {
    id: "ts-1",
    form: "Behovsafdækning",
    product: "Erhvervsansvar",
    completedAt: "2026-09-26T13:30:00",
    summary:
      "Du afdækkede virksomhedens arbejdssteder grundigt, men spurgte ikke til underentreprenører. Det er afgørende for både ansvar og accept.",
  },
  {
    id: "ts-2",
    form: "Kundecases",
    product: "Driftstab",
    completedAt: "2026-09-18T10:00:00",
    summary:
      "Din anbefaling var velbegrundet. Dækningsperioden blev sat ud fra kundens oplysning uden at udfordre den.",
  },
];

export const mockRecommendedTraining = {
  form: "Objection Training",
  product: "Erhvervsansvar",
  reason: "Du har gennemført modul 3 om dækninger. Træn indvendingen \"vi har allerede en forsikring\".",
};

export const mockLatestFeedback = {
  form: "Behovsafdækning · Erhvervsansvar",
  completedAt: "2026-09-26",
  overall:
    "En struktureret samtale med gode åbne spørgsmål. Du fik kunden til at beskrive en typisk arbejdsdag, hvilket gav et godt grundlag.",
  strengths: ["\"Hvor udfører I typisk jeres arbejde — på egne eller kundens adresser?\""],
  improvements: [
    "Du spurgte ikke til underentreprenører. Prøv: \"Løser I alle opgaver selv, eller bruger I andre firmaer?\"",
  ],
};
