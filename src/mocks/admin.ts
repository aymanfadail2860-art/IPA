/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional documents, pipeline states, users and settings.
 * Must never be used as or mixed with production data.
 */
import type { AdminDocument } from "@/types/domain";

export const mockAdminDocuments: readonly AdminDocument[] = [
  { id: "d1", title: "Betingelser for Erhvervsansvar", product: "Erhvervsansvar", type: "Forsikringsbetingelser", version: "4", stage: "readyForReview", validFrom: "2026-10-01", updatedAt: "2026-09-27" },
  { id: "d2", title: "Produktvejledning Cyberforsikring", product: "Cyberforsikring", type: "Produktvejledning", version: "2", stage: "readyForReview", validFrom: "2026-10-15", updatedAt: "2026-09-26" },
  { id: "d3", title: "Acceptregler Erhverv", product: "Flere produkter", type: "Acceptregler", version: "3", stage: "processing", updatedAt: "2026-09-28" },
  { id: "d4", title: "Forretningsgang: Skadeanmeldelse", product: "Flere produkter", type: "Forretningsgang", version: "2", stage: "partial", updatedAt: "2026-09-25", detail: "8 af 10 sider behandlet" },
  { id: "d5", title: "Salgsmateriale Driftstab", product: "Driftstab", type: "Salgsmateriale", version: "1", stage: "failed", updatedAt: "2026-09-24", detail: "Filen kunne ikke læses — den er beskyttet med adgangskode" },
  { id: "d6", title: "Betingelser for Erhvervsansvar", product: "Erhvervsansvar", type: "Forsikringsbetingelser", version: "3", stage: "active", validFrom: "2025-07-01", updatedAt: "2025-06-20" },
  { id: "d7", title: "Produktvejledning Erhvervsansvar", product: "Erhvervsansvar", type: "Produktvejledning", version: "4", stage: "active", validFrom: "2025-07-01", updatedAt: "2025-06-20" },
  { id: "d8", title: "Betingelser for Bygningsforsikring, erhverv", product: "Bygningsforsikring, erhverv", type: "Forsikringsbetingelser", version: "5", stage: "active", validFrom: "2026-01-01", updatedAt: "2025-12-10" },
  { id: "d9", title: "Betingelser for Arbejdsskade", product: "Arbejdsskade", type: "Forsikringsbetingelser", version: "2", stage: "uploaded", updatedAt: "2026-09-28" },
];

export const mockDocumentConflicts = [
  {
    id: "k1",
    topic: "Omsætningsgrænse for standardaccept",
    left: "Acceptregler Erhverv v2 · § 3.1 — 25 mio. kr.",
    right: "Produktvejledning Erhvervsansvar v4 · afsnit 5.2 — 20 mio. kr.",
    reportedAt: "2026-09-28",
  },
];

export const mockAdminProducts = [
  { id: "p1", name: "Erhvervsansvar", category: "Ansvar", documents: 4, learningPaths: 1, status: "Aktiv" },
  { id: "p2", name: "Produktansvar", category: "Ansvar", documents: 3, learningPaths: 1, status: "Aktiv" },
  { id: "p3", name: "Bygningsforsikring, erhverv", category: "Ting", documents: 5, learningPaths: 1, status: "Aktiv" },
  { id: "p4", name: "Driftstab", category: "Ting", documents: 2, learningPaths: 1, status: "Aktiv" },
  { id: "p5", name: "Cyberforsikring", category: "Særlige risici", documents: 2, learningPaths: 1, status: "Kladde" },
];

export const mockAdminLearningContent = [
  { id: "l1", title: "Erhvervsansvar", modules: 11, lessons: 38, quizzes: 9, updatedAt: "2026-09-20", status: "Publiceret" },
  { id: "l2", title: "Produktansvar", modules: 11, lessons: 34, quizzes: 9, updatedAt: "2026-06-11", status: "Publiceret" },
  { id: "l3", title: "Cyberforsikring", modules: 11, lessons: 12, quizzes: 2, updatedAt: "2026-09-27", status: "Kladde" },
];
