# Roadmap — Insurance Partners (IPA)

Oversigt over projektets faser og deres status. Filen opdateres, når en fase skifter
status. En fase markeres først som gennemført efter eksplicit besked.

**Aktuel status:** Fase 1–6 er gennemført og **låst**. Fase 6 — Identity, database og
adgangskontrol er godkendt (2026-09-29). Fase 7 — Knowledge Engine: specifikationen er
godkendt og låst (2026-09-29) og **implementeret — afventer godkendelse** (2026-10-01).

> **Husk til sidst (B-003):** Vercel-demoen kører midlertidigt **uden login** på fiktive data,
> fordi den ikke er koblet til en database. Når projektet er færdigt, skal demoen kobles på
> Supabase (EU), og demo-tilstanden skal fjernes. Fremgangsmåden står i `docs/decisions.md`
> B-003.

---

## Faseoversigt

| Fase | Navn | Status | Leverance |
|------|------|--------|-----------|
| 1 | Produktdefinition | 🔒 Gennemført og låst | `docs/01-product-definition.md` |
| 2 | Informationsarkitektur | 🔒 Gennemført og låst | `docs/02-information-architecture.md` |
| 3 | Teknisk arkitektur | 🔒 Gennemført og låst | `docs/03-technical-architecture.md` |
| 4 | UI/UX-design | 🔒 Gennemført og låst | `docs/04-ui-ux-design.md` |
| 5 | Grundplatform | 🔒 Gennemført og låst | `docs/05-foundation-implementation.md` |
| 6 | Identity, database og adgangskontrol | 🔒 Gennemført og låst | `docs/06-identity-database-access-control.md` |
| 7 | Knowledge Engine | 🟡 Implementeret — afventer godkendelse | `docs/07-knowledge-engine.md` |
| 8+ | Ikke fastlagt | ⬜ Ikke påbegyndt | — |

---

## Fase 1 — Produktdefinition

**Status:** 🔒 Gennemført og låst.

**Leverance:** `docs/01-product-definition.md`

Fastlagt i denne fase:

- [x] Hvad Insurance Partners er: AI-baseret platform til erhvervsforsikringsrådgivere
- [x] To overordnede formål: uddannelse og udvikling, samt AI-baseret arbejds- og sparringsværktøj
- [x] Fire centrale moduler: Learn, Copilot, Practice, Advise
- [x] Øvrige moduler: Assessment, Min profil, Admin, Analytics, Knowledge Engine
- [x] Knowledge Engine som fælles autoritativt grundlag for alle centrale AI-funktioner
- [x] Indholdstyper i Knowledge Engine
- [x] Principper for faglige AI-svar: kildedokumentation, intet opfundet indhold, kommunikeret usikkerhed
- [x] Nummererede krav (KRAV-AI-001 til KRAV-ADV-001)
- [x] Advise behandler potentielt virksomheds- og kundedata; compliancekrav henvist til fase 3
- [x] Tre brugerroller: Rådgiver, Leder og Administrator, med lederadgang og administratoradgang som adskilte rettigheder
- [x] Krav om at rollemodellen skal kunne udvides uden større arkitekturændringer

---

## Fase 2 — Informationsarkitektur

**Status:** 🔒 Gennemført og låst.

**Leverance:** `docs/02-information-architecture.md`

Dokumenteret i denne fase:

- [x] Forholdet mellem moduler og navigationsområder
- [x] Komplet sitemap over ni hovedområder
- [x] Formål med hver hovedsektion
- [x] Learn-hierarki: Produktbibliotek → Produkt → Produktforløb → elleve moduler
- [x] Practice som fem sideordnede træningsformer, med AI-rollespil som både form og mekanisme
- [x] Advise som syv arbejdsområder med fleksibel navigation mellem trinene
- [x] Knowledge Engine som fælles grundlag under Learn, Copilot, Practice og Advise
- [x] Copilot som globalt AI-lag, herunder kontekst, kilder og sporbarhed
- [x] Domænebegreber med flere anvendelser og kravet om entydige interne navne
- [x] Primære brugerflows mellem sektionerne (flow A–G)
- [x] Informationsflow mellem modulerne
- [x] Analytics som selvstændigt hovedområde med rollebaseret adgang
- [x] Adgangsmodel for Rådgiver, Leder og Administrator
- [x] Copilot deaktiveret under aktiv Assessment og under AI-rollespil, tilgængelig før og efter

**Udestående:** ingen blokerende punkter. De fem emner i dokumentets afsnit 11 er bevidst
overladt til fase 3.

---

## Fase 3 — Teknisk arkitektur

**Status:** 🔒 Gennemført og låst.

**Leverance:** `docs/03-technical-architecture.md`

Stack fastlagt i denne fase:

- [x] Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui
- [x] Backend: Next.js server-side API-lag
- [x] Database: PostgreSQL via Supabase, vektorsøgning med pgvector
- [x] Auth: Supabase Auth; authorization via permissions med scope
- [x] Storage: Supabase Storage
- [x] AI: Claude API, kaldt server-side gennem fælles AI-gateway
- [x] Knowledge Engine: RAG-arkitektur med versioneret, tidsbestemt viden
- [x] Hosting: Vercel og Supabase, EU-region hvor muligt
- [x] Versionsstyring: Git og GitHub

Modelversioner, embedding-model og reranker er bevidst ikke låst og behandles som
konfiguration.

Dokumenteret i denne fase:

- [x] Arkitekturoverblik, systemdiagram og lagdeling
- [x] Domænearkitektur med ni adskilte dataområder
- [x] Konceptuel datamodel pr. domæne
- [x] Knowledge Engine-arkitektur og RAG-flow med retrieval-profiler pr. workflow
- [x] Dokumentpipeline med fejltilstande
- [x] AI-arkitektur med workflow-profiler og server-side gating
- [x] Rolle- og permission-model med scope
- [x] Datasikkerhed, privacy og dataklassifikation
- [x] Versionsstyring af faglig viden med to tidsakser
- [x] Observability og kvalitetsmåling
- [x] Deployment-arkitektur
- [x] Fremtidige integrationer via source-adaptere
- [x] Tekniske risici og tradeoffs

Låst i denne fase ud over stacken:

- [x] Ingestion som asynkron worker/job-arkitektur, uafhængig af request-levetid
- [x] Teknisk behandling og faglig godkendelse adskilt; kun mennesker aktiverer viden
- [x] AI Gateway som centralt policy-lag med dataminimering, redaction, permission-tjek, modelvalg og regler pr. modul
- [x] Kundedata ikke tilladt til ekstern AI-leverandør som standard; Advise designet privacy-first
- [x] Lederen ser både aggregeret og individniveau inden for autoriseret scope
- [x] Hierarkiske teams med flere medlemskaber og eksplicit leader scope
- [x] Kundecases med én ejer, deling, overdragelse, adgang pr. case og plads til four-eyes
- [x] Retention konfigurerbar pr. datakategori, ingen global periode
- [x] Dokumentadgang permission-baseret frem for faste access levels
- [x] Historiske dokumenter tilgængelige for autoriserede, altid markeret, aldrig blandet ind i aktuelle svar
- [x] Reranking som fast trin i Knowledge Engine fra V1
- [x] Multilingual-ready datamodel, dansk som eneste sprog i V1
- [x] Eksplicit status på sagsindhold: AI-forslag, arbejdsnote, valideret konklusion, autoritativ information
- [x] Dokumentkonflikter afgøres aldrig automatisk

**Udestående:** ingen blokerende. Ti non-blocking beslutninger står i dokumentets afsnit 17
og handler om leverandørvalg, tal og indhold inden for de låste rammer.

Input, der var defineret før fasen:

- Den præcise permission-model for Analytics, herunder afgrænsning af et team og
  skellet mellem individniveau og aggregeret visning
- Datatyper, adgangskrav, sikkerhed, GDPR, retention og øvrige compliancekrav for Advise
- Entydige interne navne til de domænebegreber, der har flere anvendelser i brugerfladen
- Versionsstyring af vidensgrundlaget, så et svar kan spores til den version, der gjaldt
- En rolle- og rettighedsmodel, der kan udvides uden større arkitekturændringer

---

## Fase 4 — UI/UX-design

**Status:** 🔒 Gennemført og låst.

**Leverance:** `docs/04-ui-ux-design.md`

Dokumenteret i denne fase:

- [x] UX- og designprincipper
- [x] Designsystem med semantiske tokens, herunder syv faglige statusroller
- [x] App shell med sidebar, topbar, kontekstpanel og global søgning
- [x] Navigation, herunder fuldskærmstilstand for Assessment og AI-rollespil
- [x] Home, Learn, Copilot, Practice, Advise, Assessment, Analytics, Min profil, Admin
- [x] Global Copilot med kontekst og låst tilstand
- [x] AI-states, herunder adskillelse af "utilstrækkeligt grundlag" fra systemfejl
- [x] Kilde- og citation-UX i tre niveauer
- [x] Visuel adskillelse af AI-forslag, arbejdsnote, valideret konklusion og kildegrundlag
- [x] Synlighedsfane i Min profil: hvad lederen kan og ikke kan se
- [x] Dokumentpipeline med synligt brud mellem teknisk behandling og faglig godkendelse
- [x] Loading, error, empty og success states
- [x] Responsivt design og accessibility (WCAG 2.2 AA)
- [x] Rollebaserede UI-forskelle, centrale flows, skærmliste og komponentliste

Låst i denne fase:

- [x] Selvstændig visuel identitet med mørk marineblå som primær brandrolle og lys flade
- [x] AI-signatur: stiplet kant, tonet baggrund, tydelig label — stiplet kant kun til AI
- [x] Copilot som skubbende sidepanel på desktop, overlay/fuldskærm på mindre skærme
- [x] Ledertransparens om datakategorier, ingen visning af konkrete opslag
- [x] Assessment på mobil med enhedspolitik pr. prøve
- [x] Assessment med og uden tidsgrænse, altid synlig resterende tid
- [x] Tabeltæthed Comfortable og Compact
- [x] Ingen dark mode i V1, men tokenarkitektur der ikke spærrer for det
- [x] AI i Advise on demand; kvalitetssignaler proaktive og visuelt adskilt fra forslag
- [x] Lucide Icons med faste betydninger
- [x] Konfigurerbare tastaturgenveje

**Udestående:** ingen blokerende. Otte non-blocking punkter i dokumentets afsnit 25.2.

---

## Fase 5 — Grundplatform

**Status:** 🔒 Gennemført og låst.

**Leverance:** Kørende grundplatform samt `docs/05-foundation-implementation.md`

Første implementeringsfase. Etablerer platformens fundament uden rigtig AI, data eller
authentication.

Omfang:

- [x] Applikationsfundament: Next.js, TypeScript, Tailwind CSS, shadcn/ui, Lucide Icons
- [x] Design system med konkrete V1-tokens og valgt skrifttype (Inter og JetBrains Mono via `next/font`)
- [x] App shell: sidebar, topbar, brugerområde, breadcrumbs, responsiv navigation
- [x] Routes: /home, /learn, /copilot, /practice, /advise, /assessment, /analytics, /profile, /admin
- [x] Grundsider med realistiske danske mock-data — ingen "coming soon"
- [x] Home-cockpit med mock-data
- [x] Global Copilot som UI-shell med mock-samtale og kildekomponenter
- [x] Statussystem for de syv faglige statusser
- [x] Development-only rolle-switcher: Rådgiver, Leder, Administrator
- [x] Reusable komponenter
- [x] Keyboard, focus, kontrast, reduced motion
- [x] Lint, typecheck og build består (samt 40 automatiserede tests)
- [x] Routes og responsivt grundlayout kontrolleret
- [x] Ingen secrets i repository

- [x] Advise følger den responsive profil: mobil kun læsning, tablet læsning og noter, desktop fuld funktionalitet

**Rettelser i låste dokumenter (logget i `docs/decisions.md`):**

- B-001: `docs/03` §10 — `advise.case.read` og `advise.case.write` er `own` for alle tre
  roller, også Administrator. Afgør den tidligere uoverensstemmelse om administratorens
  adgang til Advise.
- B-002: `docs/04` §10.4 — skitsen af "Bed AI om forslag" har fast ramme i stedet for stiplet.

**Bekræftede antagelser (se `docs/05-foundation-implementation.md` §11):**

- Koblingen mellem Synlighedsfanens datakategorier og permissions er udledt. Den erstattes,
  når det fulde permission-katalog skrives.
- Administratorens Analytics-scope ("efter rettigheder") er i mock-data sat til `all`. Det er
  en mock-antagelse.

**Uden for omfang:** Claude API, RAG, embeddings, vector retrieval, dokument-ingestion,
Knowledge Engine-logik, produktionsdatabase, rigtig authentication, kundedata,
AI-generering.

**Udviklingsmiljø:** Implementeringen sker i Claude Code direkte i projektets
Git-repository, hvor afhængigheder kan installeres, og lint, typecheck og build kan køres.
Fra fase 5 er repositoryet den autoritative kilde til både kode og dokumentation.

Fasen markeres først som gennemført, når alle relevante checks består.

---

## Fase 6 — Identity, database og adgangskontrol

**Status:** 🔒 Gennemført og låst. Godkendt 2026-09-29 efter gennemgang af implementering,
tests, sikkerhedsmodel, begrænsninger og de seks implementeringsbeslutninger.

**Leverance:** Migrationer i `supabase/`, Supabase Auth i appen samt
`docs/06-identity-database-access-control.md`

Omfang:

- [x] PostgreSQL via Supabase med versionerede migrationer (`identity`, `advise`, `audit`)
- [x] Brugere, roller, permissions, rolle-permissions, brugerroller
- [x] Teams med hierarki, flere medlemskaber og eksplicitte lederscopes (inkl./ekskl. underteams)
- [x] Permission-katalog præcis som `docs/03` §10 — ingen opfundne permissions
- [x] Supabase Auth: login, logout, session, beskyttede routes
- [x] Rolle-switcheren fra fase 5 er fjernet
- [x] RLS på alle tabeller; server-side autorisation i hver side
- [x] Adgangsfundament for kundecases (ejer, deltagere, deling) — ingen "admin ser alt"
- [x] Append-only audit af administrative ændringer og lederens individadgang
- [x] Grundlag for transparens: `my_visibility()` driver Min profil → Synlighed
- [x] Development-seed kun mod lokal Supabase, uden passwords i repoet
- [x] Lint, typecheck, 44 enhedstests, 9 pgTAP-tests, 45 integrationstests og build består
- [x] Adgangskontrol verificeret mod rigtig Supabase Auth + Postgres (inkl. mutationstest)

**Godkendte beslutninger:** De seks implementeringsbeslutninger i `docs/06` §14 er godkendt.

**Henlagt til senere faser (bevidst, ikke udestående i fase 6):** hostet/produktions-Supabase
(Vercel-demoen viser indtil da login-siden med besked om manglende forbindelse), MFA, SSO,
brugeradministration i UI og nulstilling af adgangskode i UI.

**Uden for omfang:** Knowledge Engine, RAG, embeddings, ingestion, Claude API, AI i Copilot,
Practice og Advise, produktionsdata.

---

## Fase 7 — Knowledge Engine

**Status:** 🟡 Implementeret — afventer godkendelse (2026-10-01). Alle ni trin i `docs/07`
§18 er bygget, og lint, typecheck, build, enhedstests, pgTAP samt integrations- og rutetests
består. Status, afklaringer til bekræftelse og mutationstests står i `docs/07` §20. Fasen
markeres først som gennemført ved eksplicit godkendelse.

**Formål:** Platformens autoritative videnslag: dokumenter, versioner, behandling,
menneskelig godkendelse, publicering, adgang pr. dokument, retrieval og evidens. Ingen AI.

**Afgjort:** Beslutningerne i `docs/07` §17.2 er godkendt. Konflikterne K-1 til K-3 er lukket
(`docs/07` §19).

**Udestående (ikke blokerende for fase 7):**

- [AFKLARES]: virusscanning af uploads. Skal afklares før håndtering af rigtige dokumenter og
  ændrer ikke fase 7-specifikationen.
- Afklaringerne i `docs/07` §20.2 skal bekræftes.
- Forudsætning før AI-modulerne må bruge production-evidens: tallene for reranking og
  evidensudvælgelse skal valideres med et evalueringssæt og en rigtig embedder og reranker
  (`docs/07` §20.4, B-008).

---

## Fase 8 og frem

Ikke fastlagt.
