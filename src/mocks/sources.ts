/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional documents, versions and excerpts. They do not
 * describe real insurance terms and are not a professional basis for anything.
 * Must never be used as or mixed with production data.
 */
import type { SourceReference } from "@/types/domain";

export const mockSources = {
  liabilityTermsV3: {
    id: "src-ea-betingelser-v3-4-2",
    number: 1,
    documentTitle: "Betingelser for Erhvervsansvar",
    version: "3",
    section: "§ 4.2",
    page: 12,
    excerpt:
      "Forsikringen dækker ikke skade på ting, som sikrede har til bearbejdning, reparation, forarbejdning eller anden behandling, for så vidt skaden er sket under eller som følge af behandlingen.",
    validity: "current",
    validFrom: "2025-07-01",
  },
  liabilityGuideV4: {
    id: "src-ea-vejledning-v4-3-4",
    number: 2,
    documentTitle: "Produktvejledning Erhvervsansvar",
    version: "4",
    section: "Afsnit 3.4",
    page: 7,
    excerpt:
      "Behandlingsskader kan efter aftale medforsikres som tillægsdækning med særskilt sum og selvrisiko. Tillægget skal fremgå af policen.",
    validity: "current",
    validFrom: "2025-07-01",
  },
  acceptanceRulesV2: {
    id: "src-accept-erhverv-v2-3-1",
    number: 1,
    documentTitle: "Acceptregler Erhverv",
    version: "2",
    section: "§ 3.1",
    page: 4,
    excerpt:
      "Virksomheder med en årlig omsætning på op til 25 mio. kr. kan accepteres på standardvilkår uden forelæggelse for tegningsafdelingen.",
    validity: "current",
    validFrom: "2026-01-01",
    conflictsWith: 2,
  },
  liabilityGuideV4Acceptance: {
    id: "src-ea-vejledning-v4-5-2",
    number: 2,
    documentTitle: "Produktvejledning Erhvervsansvar",
    version: "4",
    section: "Afsnit 5.2",
    page: 11,
    excerpt:
      "Standardaccept forudsætter en årlig omsætning på højst 20 mio. kr. Øvrige virksomheder forelægges tegningsafdelingen.",
    validity: "current",
    validFrom: "2025-07-01",
    conflictsWith: 1,
  },
  liabilityTermsV2Deductible: {
    id: "src-ea-betingelser-v2-8-1",
    number: 1,
    documentTitle: "Betingelser for Erhvervsansvar",
    version: "2",
    section: "§ 8.1",
    page: 18,
    excerpt:
      "For hver skade gælder en selvrisiko på 5.000 kr., medmindre andet fremgår af policen.",
    validity: "historical",
    validFrom: "2024-01-01",
    validTo: "2025-07-01",
  },
  businessProcessUnderwriting: {
    id: "src-forretningsgang-tegning-2-1",
    number: 1,
    documentTitle: "Forretningsgang: Tegning af erhvervskunder",
    version: "5",
    section: "Afsnit 2.1",
    page: 3,
    excerpt:
      "Ved nytegning indhentes oplysninger om branche, omsætning, antal ansatte og tidligere skader, før tilbud udarbejdes.",
    validity: "current",
    validFrom: "2026-03-01",
  },
} satisfies Record<string, SourceReference>;

export function withNumber(source: SourceReference, number: number): SourceReference {
  return { ...source, number };
}
