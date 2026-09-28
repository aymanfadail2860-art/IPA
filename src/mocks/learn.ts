/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional products, learning paths and lesson text.
 * The insurance content is invented for design evaluation and is not a professional basis.
 * Must never be used as or mixed with production data.
 */
import type { CourseModule, Lesson, Product } from "@/types/domain";

import { mockSources } from "./sources";

export const mockProducts: readonly Product[] = [
  {
    slug: "erhvervsansvar",
    name: "Erhvervsansvar",
    category: "Ansvar",
    summary: "Virksomhedens erstatningsansvar over for tredjemand for person- og tingskade.",
    status: "inProgress",
    currentModule: 4,
    changeNotice: "Nye betingelser gældende fra 1. oktober 2026",
  },
  {
    slug: "produktansvar",
    name: "Produktansvar",
    category: "Ansvar",
    summary: "Ansvar for skader forvoldt af produkter, virksomheden har fremstillet eller solgt.",
    status: "inProgress",
    currentModule: 2,
  },
  {
    slug: "bygning-erhverv",
    name: "Bygningsforsikring, erhverv",
    category: "Ting",
    summary: "Brand, storm, vand og andre skader på virksomhedens bygninger.",
    status: "completed",
  },
  {
    slug: "driftstab",
    name: "Driftstab",
    category: "Ting",
    summary: "Tabt dækningsbidrag, når en dækket skade afbryder driften.",
    status: "notStarted",
  },
  {
    slug: "erhvervsloesoere",
    name: "Erhvervsløsøre",
    category: "Ting",
    summary: "Inventar, maskiner og varelager mod brand, tyveri og vandskade.",
    status: "completed",
  },
  {
    slug: "arbejdsskade",
    name: "Arbejdsskade",
    category: "Person",
    summary: "Lovpligtig dækning af medarbejdere ved arbejdsulykker og erhvervssygdomme.",
    status: "notStarted",
  },
  {
    slug: "cyber",
    name: "Cyberforsikring",
    category: "Særlige risici",
    summary: "Omkostninger og tab ved hackerangreb, datalæk og IT-nedbrud.",
    status: "notStarted",
    changeNotice: "Opdateret produktvejledning",
  },
  {
    slug: "bestyrelsesansvar",
    name: "Bestyrelsesansvar",
    category: "Særlige risici",
    summary: "Personligt ansvar for ledelse og bestyrelse ved økonomisk tab hos tredjemand.",
    status: "notStarted",
  },
];

/** The eleven modules of every product learning path, in fixed order (IA §3). */
const MODULE_TITLES = [
  ["introduktion", "Introduktion"],
  ["produktforstaaelse", "Produktforståelse"],
  ["daekninger", "Dækninger"],
  ["undtagelser", "Undtagelser"],
  ["betingelser", "Betingelser"],
  ["acceptregler", "Acceptregler"],
  ["behovsafdaekning", "Behovsafdækning"],
  ["salg-og-raadgivning", "Salg og rådgivning"],
  ["eksempler", "Eksempler"],
  ["quiz", "Quiz"],
  ["afsluttende-case", "Afsluttende case"],
] as const;

export function mockCourseModules(product: Product): CourseModule[] {
  return MODULE_TITLES.map(([slug, title], index) => {
    const number = index + 1;
    const lessonCount = slug === "quiz" || slug === "afsluttende-case" ? 1 : 4;
    const current = product.currentModule ?? 0;
    const status =
      product.status === "completed" || number < current
        ? "completed"
        : number === current
          ? "inProgress"
          : "notStarted";
    const completedLessons = status === "completed" ? lessonCount : status === "inProgress" ? 1 : 0;
    return { number, slug, title, status, lessonCount, completedLessons };
  });
}

export const mockLesson: Lesson = {
  productSlug: "erhvervsansvar",
  moduleSlug: "daekninger",
  moduleNumber: 3,
  moduleTitle: "Dækninger",
  lessonNumber: 2,
  lessonCount: 4,
  title: "Ansvar for skade på ting",
  lessons: [
    { number: 1, title: "Personskade", status: "completed" },
    { number: 2, title: "Ansvar for skade på ting", status: "inProgress" },
    { number: 3, title: "Behandlingsskader", status: "notStarted" },
    { number: 4, title: "Forureningsskader", status: "notStarted" },
  ],
  blocks: [
    {
      type: "paragraph",
      text: "Erhvervsansvar dækker virksomhedens erstatningsansvar, når den efter dansk rets almindelige regler bliver ansvarlig for skade på andres ting. Det afgørende er ikke, at der er sket en skade, men at virksomheden er ansvarlig for den.",
    },
    { type: "heading", id: "ansvarsgrundlag", text: "Ansvarsgrundlaget" },
    {
      type: "paragraph",
      text: "Udgangspunktet er culpareglen: virksomheden er ansvarlig, hvis skaden skyldes fejl eller forsømmelse. Forsikringen dækker kun, hvor der er et ansvar. Et ønske om at hjælpe kunden kan ikke i sig selv udløse dækning.",
    },
    {
      type: "callout",
      variant: "important",
      title: "Vigtigt",
      text: "Afklar altid, om der er et ansvarsgrundlag, før dækningen drøftes med kunden. Mange henvendelser handler om skader, hvor virksomheden ikke er ansvarlig.",
    },
    { type: "heading", id: "behandling", text: "Ting under behandling" },
    {
      type: "paragraph",
      text: "Når en håndværker arbejder på en kundes ejendom eller ting, opstår en særlig risiko: skaden sker på netop det, der arbejdes på. Den risiko er som udgangspunkt undtaget i betingelserne og kan kun dækkes ved tillæg.",
    },
    {
      type: "callout",
      variant: "exception",
      title: "Undtagelse",
      text: "Skade på ting, som sikrede har til bearbejdning, reparation eller anden behandling, er ikke dækket, når skaden sker under eller som følge af behandlingen.",
    },
    {
      type: "callout",
      variant: "example",
      title: "Eksempel",
      text: "En tømrer sliber et parketgulv og kommer til at ødelægge det. Skaden er sket på den ting, der blev behandlet, og er derfor ikke dækket uden tillæg for behandlingsskader.",
    },
    {
      type: "callout",
      variant: "commonMistake",
      title: "Almindelig fejl",
      text: "At love kunden dækning ud fra et generelt kendskab til produktet. Tjek policen: tillæg for behandlingsskader gælder kun, hvis det er aftalt.",
    },
  ],
  sources: [mockSources.liabilityTermsV3, mockSources.liabilityGuideV4],
};
