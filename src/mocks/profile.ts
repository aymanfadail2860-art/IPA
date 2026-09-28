/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional personal development data.
 * Must never be used as or mixed with production data.
 */
import type { HistoryEntry } from "@/types/domain";

export const mockProgression = {
  pathsInProgress: 2,
  pathsCompleted: 2,
  pathsAssigned: 5,
  currentPath: "Erhvervsansvar",
  currentModule: 4,
  moduleCount: 11,
  overallPercent: 46,
};

export const mockStrengths = [
  "Tingsforsikringer — bestået test med 16 af 18",
  "Grundig afdækning af arbejdssteder i behovsafdækning",
];

export const mockDevelopmentAreas = [
  "Acceptregler — test i Erhvervsløsøre ikke bestået",
  "Afdækning af underentreprenører i behovsafdækning",
];

export const mockHistory: readonly HistoryEntry[] = [
  { id: "h1", at: "2026-09-26", kind: "practice", title: "Behovsafdækning · Erhvervsansvar", detail: "Træning gennemført, feedback modtaget" },
  { id: "h2", at: "2026-09-24", kind: "learn", title: "Erhvervsansvar · Modul 3 Dækninger", detail: "Modul gennemført" },
  { id: "h3", at: "2026-09-18", kind: "practice", title: "Kundecase · Driftstab", detail: "Træning gennemført" },
  { id: "h4", at: "2026-09-10", kind: "assessment", title: "Erhvervsløsøre — faglig test", detail: "Ikke bestået · 9 af 15" },
  { id: "h5", at: "2026-08-14", kind: "assessment", title: "Bygningsforsikring, erhverv — faglig test", detail: "Bestået · 16 af 18" },
  { id: "h6", at: "2026-08-02", kind: "learn", title: "Erhvervsløsøre", detail: "Produktforløb gennemført" },
];
