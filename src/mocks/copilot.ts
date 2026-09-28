/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional Copilot conversations used to evaluate the
 * answer anatomy, source components and special answer states. No AI produced them.
 * Must never be used as or mixed with production data.
 */
import type { CopilotConversation } from "@/types/domain";

import { mockSources, withNumber } from "./sources";

export const mockCopilotConversations: readonly CopilotConversation[] = [
  {
    id: "conv-behandlingsskade",
    title: "Behandlingsskade under Erhvervsansvar",
    group: "today",
    context: "Erhvervsansvar · Modul 3 · Dækninger",
    updatedAt: "2026-09-28T09:12:00",
    exchanges: [
      {
        id: "ex-1",
        question:
          "Er en tømrers ansvar for skader på det emne, han arbejder på, dækket under Erhvervsansvar?",
        kind: "complete",
        retrieval: { passages: 7, documents: 3 },
        paragraphs: [
          [
            "Nej, ikke som udgangspunkt. Betingelserne undtager skade på ting, som sikrede har til bearbejdning, reparation eller anden behandling, når skaden sker under eller som følge af behandlingen ",
            { source: 1 },
            ".",
          ],
          [
            "Dækningen kan dog aftales som tillægsdækning for behandlingsskader med særskilt sum og selvrisiko. Tillægget skal fremgå af policen, før det gælder ",
            { source: 2 },
            ". Tjek derfor kundens police, før du svarer kunden.",
          ],
        ],
        sources: [mockSources.liabilityTermsV3, mockSources.liabilityGuideV4],
        followUps: [
          "Hvilken selvrisiko gælder for tillægget?",
          "Hvordan forklarer jeg undtagelsen til kunden?",
          "Vis lektionen om behandlingsskader",
        ],
      },
    ],
  },
  {
    id: "conv-standardaccept",
    title: "Omsætningsgrænse for standardaccept",
    group: "today",
    updatedAt: "2026-09-28T08:40:00",
    exchanges: [
      {
        id: "ex-2",
        question: "Hvad er den maksimale omsætning for standardaccept på Erhvervsansvar?",
        kind: "conflict",
        retrieval: { passages: 4, documents: 2 },
        paragraphs: [
          [
            "Kilderne er uenige, og jeg kan derfor ikke give ét svar. Acceptreglerne angiver en grænse på 25 mio. kr. ",
            { source: 1 },
            ", mens produktvejledningen angiver 20 mio. kr. ",
            { source: 2 },
            ".",
          ],
          [
            "Konflikten er meldt til fagligt ansvarlig. Indtil den er afklaret, bør en virksomhed med en omsætning mellem 20 og 25 mio. kr. forelægges tegningsafdelingen.",
          ],
        ],
        sources: [mockSources.acceptanceRulesV2, mockSources.liabilityGuideV4Acceptance],
        followUps: ["Hvem er fagligt ansvarlig for acceptregler?", "Vis begge passager i fuld længde"],
      },
    ],
  },
  {
    id: "conv-droner",
    title: "Droner i landbrug",
    group: "cases",
    caseName: "Nordjysk Entreprise A/S",
    context: "Nordjysk Entreprise A/S · Risikoanalyse",
    updatedAt: "2026-09-26T14:05:00",
    exchanges: [
      {
        id: "ex-3",
        question: "Dækker Erhvervsansvar skader forårsaget af droner, der bruges til opmåling?",
        kind: "insufficient",
        retrieval: { passages: 1, documents: 1 },
        paragraphs: [
          [
            "Jeg fandt ikke dokumentation i vidensgrundlaget, der dækker brug af droner under Erhvervsansvar. Jeg giver derfor ikke et fagligt svar.",
          ],
          [
            "Det eneste relaterede afsnit handler om de oplysninger, der indhentes ved nytegning, og siger intet om droner ",
            { source: 1 },
            ".",
          ],
        ],
        sources: [mockSources.businessProcessUnderwriting],
        followUps: ["Søg kun i Erhvervsansvar", "Omformulér spørgsmålet", "Kontakt fagligt ansvarlig"],
      },
    ],
  },
  {
    id: "conv-selvrisiko-2024",
    title: "Selvrisiko pr. 1. marts 2024",
    group: "earlier",
    updatedAt: "2026-09-22T11:30:00",
    exchanges: [
      {
        id: "ex-4",
        question: "Hvad var standardselvrisikoen på Erhvervsansvar pr. 1. marts 2024?",
        kind: "historical",
        historicalAsOf: "2024-03-01",
        retrieval: { passages: 3, documents: 1 },
        paragraphs: [
          [
            "Pr. 1. marts 2024 var standardselvrisikoen 5.000 kr. pr. skade, medmindre andet fremgik af policen ",
            { source: 1 },
            ".",
          ],
          ["Betingelserne er siden erstattet af version 3, gældende fra 1. juli 2025."],
        ],
        sources: [withNumber(mockSources.liabilityTermsV2Deductible, 1)],
        followUps: ["Hvad er selvrisikoen i dag?", "Hvad ændrede sig fra version 2 til 3?"],
      },
    ],
  },
];

/** Example questions shown when the conversation history is empty. */
export const mockCopilotExampleQuestions = [
  "Hvad dækker Erhvervsansvar ikke?",
  "Hvornår skal en kunde forelægges tegningsafdelingen?",
  "Hvilke oplysninger skal jeg indhente ved nytegning?",
];
