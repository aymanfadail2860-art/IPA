# Roadmap — Insurance Partners (IPA)

Oversigt over projektets faser og deres status. Filen opdateres, når en fase skifter
status. En fase markeres først som gennemført efter eksplicit besked.

**Aktuel status:** Fase 1–7 er gennemført og **låst**. Fase 7 — Knowledge Engine er godkendt
(2026-10-02). Fase 8 — AI Gateway: **implementeret — afventer godkendelse**
(`docs/08-ai-gateway.md`). Fase 9 — Produktionsgrundlag for Knowledge Engine er **foreslået —
afventer godkendelse**. Udbydervalget er udskudt til fase 9 (B-011).

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
| 7 | Knowledge Engine | 🔒 Gennemført og låst | `docs/07-knowledge-engine.md` |
| 8 | AI Gateway | 🔨 Implementeret — afventer godkendelse | `docs/08-ai-gateway.md` |
| 9 | Produktionsgrundlag for Knowledge Engine | 📝 Foreslået — afventer godkendelse | — |
| 10+ | Ikke fastlagt | ⬜ Ikke påbegyndt | — |

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

**Status:** 🔒 Gennemført og låst (godkendt 2026-10-02). Alle ni trin i `docs/07` §18 er
bygget, og lint, typecheck, build, enhedstests, pgTAP samt integrations- og rutetests består.
Implementeringsstatus, afklaringer, mutationstests og kendte begrænsninger står i `docs/07`
§20. Beslutningerne B-005 til B-010 blev truffet undervejs.

**Formål:** Platformens autoritative videnslag: dokumenter, versioner, behandling,
menneskelig godkendelse, publicering, adgang pr. dokument, retrieval og evidens. Ingen AI.

**Videreført til fase 9:** udbydere, validering af retrieval-tallene (B-008), virusscanning
(B-26) og workerens produktionsadgang (B-16). Se `docs/07` §20.6 (rettet til fase 9 ved B-012).

---

## Fase 8 — AI Gateway

**Status:** 🔨 Implementeret — afventer godkendelse. Specifikationen blev godkendt 2026-10-02
(B-012 til B-017). Lint, typecheck, build, enhedstests (213), pgTAP (302) samt integrations- og
rutetests (107) består, og mutationstestene fanger 25 af 25 kodemutationer og 14 af 14
databasemutationer. Status og kendte begrænsninger står i `docs/08` §18. Fasen blev besluttet
2026-10-02 (B-011).

**Formål:** Politiklaget mellem applikationen og AI-modeller (`docs/03` §9). Det skal bygges
uanset udbyder og kan testes uden en. Det afgør, hvilke kundedata der forlader platformen,
og specifikationen skal derfor godkendes før implementering.

**Omfang:**

- Dataminimering: kun det nødvendige sendes med
- Redaction og anonymisering af identificerbare oplysninger
- Permission-tjek i gatewayen, ikke kun i applikationslaget
- Datakategori-matricen som konfiguration. Kundedata er ikke tilladt som standard
- Logning: hvad blev sendt, hvad kom retur, hvilke kilder, hvor lang tid, fejl
- Gating håndhævet på serveren: Copilot er utilgængelig under aktiv Assessment og under
  AI-rollespil
- Workflow-profiler for Learn, Copilot, Practice, Advise og Assessment med prompt, tilladte
  handlinger og output-kontrakt

**Ingen rigtig AI-model:** en stub-model efter mønstret fra test-embedderen (udviklingsgrad,
fail-closed, kun `local`/`test`). Copilot-brugerfladen viser mock-svar med kildekomponenter.

**Afgjort modstrid:** K-1 (B-012), K-2 (B-013) og K-3 (B-014). Desuden Q-1 (B-015), Q-4 (B-016)
og Q-9 (B-017). Se `docs/08` §15 og §16.

**Uden for omfang:** ekstern AI-udbyder, Claude API-adapter, valg af embedding- og
reranking-udbyder (fase 9), samtalelagring, Learn/Practice/Advise/Assessment som moduler.

---

## Fase 9 — Produktionsgrundlag for Knowledge Engine

**Status:** 📝 Foreslået — afventer godkendelse. Intet er specificeret eller implementeret.
Forslaget blev oprindelig stillet som fase 8 og er flyttet uændret til fase 9 (B-011).

**Udgangspunkt:** Fase 7 kører på en test-embedder og `none`-rerankeren. Guardrailen
(`docs/07` §9.1) forhindrer AI-moduler i at bruge udviklingsevidens. Der kan derfor ikke
bygges AI-moduler (Copilot, Learn AI, Practice AI, Advise AI), før rigtige udbydere er valgt
og retrieval-kvaliteten kan måles (`docs/07` §20.4, B-008). Fase 9 skaffer det grundlag. Den
bygger ingen AI-funktionalitet.

**Foreslået indhold:**

1. **Embedding-udbyder og -model.** Valg ud fra dansk sprogkvalitet, databehandling i EU og
   pris. Modellen indføres gennem den eksisterende model- og re-embedding-mekanisme
   (`docs/07` §7) med sit eget indeks.
2. **Reranking-udbyder.** En rigtig reranker bag `Reranker`-interfacet (`docs/07` §9) med
   grad `production`.
3. **Evalueringssæt.** Rigtige spørgsmål med kendte svar og kilder, også spørgsmål uden
   dokumentation. Måling af træfsikkerhed og af tærsklen for "utilstrækkeligt grundlag".
   Tallene i `docs/07` §20.4 valideres eller erstattes. Først derefter må production-evidens
   udstedes.
4. **Virusscanning af uploads** (`docs/07` B-26, i dag [AFKLARES]).
5. **Workerens placering og adgang i produktion.** Hvor workeren kører, og en dedikeret
   adgang med mindst mulige rettigheder i stedet for service-role-nøglen (`docs/07` §14.1,
   B-16).
6. **Eventuelt testisolation:** integrationstests mod en separat database og en
   browserbaseret upload-test (`docs/07` §20.5).

**Udenfor:** Claude API, Copilot og andre AI-moduler. AI Gateway er fase 8. Koblingen af Vercel-demoen
på Supabase (B-003) sker til sidst, når udbydere og en produktionsløsning for workeren er på
plads.

### Grundlag for udbydervalget (indsamlet 2026-10-02)

Analysen er lavet før fase 8 blev omlagt. Den gemmes her, så den kan bruges, når fase 9
specificeres. Oplysningerne er fra 2026-10-02 og skal efterprøves, før der vælges. Flere af
dem kunne kun bekræftes gennem søgeresultater, fordi udbydernes egen dokumentation ikke kunne
hentes.

**Brugerens svar (oplyst):**

- **EU er et krav, ikke en præference:** EU-region, hvor det er muligt, og en
  databehandleraftale med udbyderen.
- **Omfang i første omgang:** kun offentlige forsikringsbetingelser og -vilkår. Der gælder
  ingen fortrolighedsbegrænsning for dem. Acceptregler, forretningsgange og interne dokumenter
  kommer senere efter en særskilt beslutning. Udbydervalget må ikke gøre den beslutning
  sværere, men skal heller ikke træffe den nu. Afgrænsningen skrives ind i fasens
  specifikation.
- **Ingen eksisterende leverandøraftaler**, hverken nogen der skal bruges eller undgås. Frit
  valg inden for EU-kravet.
- **Volumen:** 30–40 produkter à 40–50 sider, i alt ca. 1.200–2.000 sider. Behandles én gang.
  Nye versioner kommer sjældent, måske med års mellemrum. 30 rådgivere à 20–30 spørgsmål om
  dagen giver 600–900 forespørgsler om dagen ved fuld brug.
- **Evalueringssæt:** brugeren skaffer offentlige betingelser og formulerer 30–50 spørgsmål,
  også nogle uden svar.

**Pris er ikke afgørende i den skala.** Embedding af hele grundlaget koster under 1 kr.
Reranking koster for alle tre kandidater mindre end ca. $50 om måneden ved 13.000–19.000
forespørgsler. Valget afgøres derfor af **træfsikkerhed på dansk**: sammensatte ord,
bøjninger, paragrafhenvisninger og juridisk præcision. Det kan ikke vurderes uden at prøve.
Der findes intet offentligt dansk juridisk benchmark. Fremgangsmåden er derfor at vælge én,
prøve den mod evalueringssættet og skifte, hvis den ikke rammer.

**Anbefaling: AWS Bedrock i Frankfurt (eu-central-1) med Cohere embed-multilingual-v3 og
Cohere Rerank 3.5.** Begrundelse: alt er dokumenteret in-region i Frankfurt. AWS'
databehandleraftale (GDPR DPA) indgår i vilkårene, og embedding og reranking købes hos samme
udbyder. Rerank 3.5 koster $2,00 pr. 1.000 forespørgsler. Den nyere Embed v4 findes i Frankfurt
kun via EU-profilen på tværs af AWS' EU-regioner, ikke in-region. Rerank 4 findes endnu ikke på
Bedrock.

**Dokumenteret alternativ: Microsoft Azure** med Azure OpenAI `text-embedding-3-large` og
Cohere Rerank 4 i Microsoft Foundry (fx Sweden Central). `text-embedding-3-large` har det
bedste offentlige resultat på skandinavisk (Scandinavian Embedding Benchmark, 2024), og Rerank
4 er nyere end 3.5. To punkter skal afklares først:

1. Kan `text-embedding-3-large` køre som regional deployment i en EU-region og ikke kun
   globalt?
2. Er Cohere-modellen i Foundry dækket af Microsofts databehandleraftale eller af separate
   Marketplace-vilkår?

**Mulighed, hvis ingen af dem rammer: Voyage AI via MongoDB Atlas** (voyage-4 og rerank-3).
EU-dataopbevaring i EØS har været tilgængelig siden 1. september 2026. Det er usikkert, om
dansk er blandt de 31 sprog i Voyages egen sammenligning. Det skal bekræftes, at MongoDBs
databehandleraftale dækker API'et.

**Fravalgt: Google Vertex AI.** Ranking-API'et understøtter 25 sprog, og dansk er ikke
bekræftet. Kontekstvinduet er kun 1.024 tokens pr. tekstudsnit.

**Lock-in er lav for alle tre.** Et skift af embedding-model kræver ny embedding af 1–1,5
mio. tokens gennem den eksisterende mekanisme (`docs/07` §7) og eventuelt et nyt indeks.
Rerankeren gemmer ingen tilstand og ligger bag `Reranker`-interfacet. Den reelle binding ligger
i kontrakt, databehandleraftale og regionsopsætning.
