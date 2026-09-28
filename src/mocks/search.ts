/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional global search index.
 * Must never be used as or mixed with production data.
 */
export type MockSearchGroup = "Produkter" | "Dokumenter" | "Læringsmoduler" | "Egne kundecases" | "Handlinger" | "Administration";

export interface MockSearchResult {
  id: string;
  group: MockSearchGroup;
  title: string;
  detail?: string;
  href: string;
  /** Only shown to users with admin permissions. */
  adminOnly?: boolean;
}

export const mockSearchIndex: readonly MockSearchResult[] = [
  { id: "s1", group: "Produkter", title: "Erhvervsansvar", detail: "Ansvar", href: "/learn/erhvervsansvar" },
  { id: "s2", group: "Produkter", title: "Produktansvar", detail: "Ansvar", href: "/learn" },
  { id: "s3", group: "Produkter", title: "Cyberforsikring", detail: "Særlige risici", href: "/learn" },
  { id: "s4", group: "Dokumenter", title: "Betingelser for Erhvervsansvar", detail: "Version 3 · Gældende", href: "/copilot" },
  { id: "s5", group: "Dokumenter", title: "Acceptregler Erhverv", detail: "Version 2 · Gældende", href: "/copilot" },
  { id: "s6", group: "Læringsmoduler", title: "Erhvervsansvar · Dækninger", detail: "Modul 3", href: "/learn/erhvervsansvar/daekninger" },
  { id: "s7", group: "Egne kundecases", title: "Nordjysk Entreprise A/S", detail: "Risikoanalyse", href: "/advise/nordjysk-entreprise" },
  { id: "s8", group: "Egne kundecases", title: "Bagerhuset ApS", detail: "Afventer kunde", href: "/advise" },
  { id: "s9", group: "Handlinger", title: "Start træning", detail: "Practice", href: "/practice" },
  { id: "s10", group: "Handlinger", title: "Se min kompetenceprofil", detail: "Min profil", href: "/profile" },
  { id: "s11", group: "Administration", title: "Dokumenter klar til review", detail: "2 afventer", href: "/admin/documents", adminOnly: true },
  { id: "s12", group: "Administration", title: "Videnshuller", detail: "Knowledge Base", href: "/admin/knowledge-base", adminOnly: true },
];
