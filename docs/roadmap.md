# Roadmap — Insurance Partners (IPA)

Oversigt over projektets faser og deres status. Filen opdateres, når en fase skifter
status. En fase markeres først som gennemført efter eksplicit besked.

**Aktuel status:** Fase 1–7 og underfase 8A er gennemført og **låst**. 8A — AI Gateway blev
godkendt 2026-10-03 (B-018). 8B — Produktionsgrundlag: **specifikationen er godkendt og låst** 2026-10-03 (B-020,
`docs/08b-production-foundation.md`). **Deltrin 8B-I1 (evalueringsframework og gates) er
gennemført og godkendt, 8B-I2 (production embedding og reranking) er gennemført og godkendt,
8B-I2.5 (ekstern AI-datagrænse), 8B-I3 (workerens databaseidentitet og databasefunktioner) og
8B-I4 (workerens runtime), 8B-I5 (upload-sikkerhed, karantæne og malware-scanning), 8B-I5.5
(scanner-isolation og signaturforsyning) og 8B-I5.6 (ClamAV-patchversion 1.4.6) er gennemført og
godkendt — I5 er fuldt lukket. 8B-I6 (register over retrieval-konfigurationer og
ProductionEvidenceSet) er gennemført og godkendt og endeligt lukket med 8B-I6.1 (pilot-politik
og pilot-scope) og 8B-I6.2 (stabil produktidentitet i pilot-scope), som begge er gennemført og
godkendt. 8B-I7 (Evaluation Operations, Monitoring & Regression
Guardrails) er gennemført og venter på godkendelse.** 8B er ikke fuldt implementeret: baselinen med
et rigtigt pilotsæt og aktiveringen i et miljø med de rigtige udbydere udestår. Hvert deltrin
kræver godkendelse. 8C — Copilot
klar til brug er ikke påbegyndt. Masterfase 9–21 er ikke påbegyndt.

> **Husk til sidst (B-003):** Vercel-demoen kører midlertidigt **uden login** på fiktive data,
> fordi den ikke er koblet til en database. Når projektet er færdigt, skal demoen kobles på
> Supabase (EU), og demo-tilstanden skal fjernes. Fremgangsmåden står i `docs/decisions.md`
> B-003. Det hører til masterfase 21 Produktion.

---

## Master-roadmap — låst (B-019)

De 21 masterfaser er projektets overordnede roadmap og er **låst**. Denne fil er source of truth
for faserne. `CLAUDE.md` §2 og §3 henviser hertil.

**Regel:** Underfaser (fx 8A, 8B, 8C) må foreslås under en masterfase, når den tekniske
kompleksitet kræver det. Uden eksplicit godkendelse må ingen:

- fjerne en masterfase
- omnummerere en masterfase
- erstatte en masterfase
- indsætte en ny masterfase mellem de eksisterende
- flytte et oprindeligt hovedområde til et andet nummer

| Fase | Navn | Status | Leverance |
|------|------|--------|-----------|
| 1 | Produktdefinition (Product Definition) | 🔒 Gennemført og låst | `docs/01-product-definition.md` |
| 2 | Informationsarkitektur (Information Architecture) | 🔒 Gennemført og låst | `docs/02-information-architecture.md` |
| 3 | Teknisk arkitektur (Technical Architecture) | 🔒 Gennemført og låst | `docs/03-technical-architecture.md` |
| 4 | UI/UX-design (UI/UX Design) | 🔒 Gennemført og låst | `docs/04-ui-ux-design.md` |
| 5 | Grundplatform (Foundation Platform) | 🔒 Gennemført og låst | `docs/05-foundation-implementation.md` |
| 6 | Identity, database og adgangskontrol (Identity, Database & Access Control) | 🔒 Gennemført og låst | `docs/06-identity-database-access-control.md` |
| 7 | Knowledge Engine | 🔒 Gennemført og låst | `docs/07-knowledge-engine.md` |
| 8 | AI Copilot | 🔨 I gang — se underfaserne | — |
| 8A | AI Gateway | 🔒 Gennemført og låst | `docs/08-ai-gateway.md` |
| 8B | Produktionsgrundlag | 🔨 Specifikation låst (B-020). 8B-I1, 8B-I2, 8B-I2.5, 8B-I3, 8B-I4, 8B-I5, 8B-I5.5, 8B-I5.6 og 8B-I6 (inkl. I6.1 og I6.2) gennemført, 8B-I7 gennemført og venter på godkendelse, resten ikke påbegyndt | `docs/08b-production-foundation.md` |
| 8C | Copilot klar til brug | ⬜ Ikke påbegyndt | — |
| 9 | Learn | ⬜ Ikke påbegyndt | — |
| 10 | Practice | ⬜ Ikke påbegyndt | — |
| 11 | Advise | ⬜ Ikke påbegyndt | — |
| 12 | Assessment | ⬜ Ikke påbegyndt | — |
| 13 | Personlig AI og læringsprofil (Personal AI / Learning Profile) | ⬜ Ikke påbegyndt | — |
| 14 | Admin | ⬜ Ikke påbegyndt | — |
| 15 | Analytics | ⬜ Ikke påbegyndt | — |
| 16 | Kvalitet og guardrails (Quality & Guardrails) | ⬜ Ikke påbegyndt | — |
| 17 | Test (Testing) | ⬜ Ikke påbegyndt | — |
| 18 | Pilotversion (Pilot Version) | ⬜ Ikke påbegyndt | — |
| 19 | Feedback | ⬜ Ikke påbegyndt | — |
| 20 | Enterprise-version (Enterprise Version) | ⬜ Ikke påbegyndt | — |
| 21 | Produktion (Production) | ⬜ Ikke påbegyndt | — |

"Ikke påbegyndt" betyder, at fasen ikke er specificeret. Dele, som tidligere faser allerede har
bygget som fundament, er nævnt under fasen. Det rykker ikke fasens status.

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

**Videreført til 8B:** udbydere, validering af retrieval-tallene (B-008), virusscanning
(B-26) og workerens produktionsadgang (B-16). Se `docs/07` §20.6.

---

## Fase 8 — AI Copilot

**Status:** 🔨 I gang. Masterfasen er opdelt i tre underfaser (B-019), fordi en rigtig Copilot
forudsætter et politiklag (8A) og evidens i produktionskvalitet (8B), før den kan tages i brug
(8C). 8A er gennemført og låst. 8B's specifikation er godkendt og låst (B-020).
Implementeringen af 8B er i gang i deltrin, som hver er godkendt særskilt (se 8B nedenfor). 8C er
ikke påbegyndt.

### 8A — AI Gateway

**Status:** 🔒 Gennemført og låst (godkendt 2026-10-03, B-018). Leverance: `docs/08-ai-gateway.md`. Specifikationen blev godkendt
2026-10-02 (B-012 til B-017). Lint, typecheck, build, enhedstests (213), pgTAP (302) samt
integrations- og rutetests (107) består, og mutationstestene fanger 25 af 25 kodemutationer og
14 af 14 databasemutationer. Rettelsen af `retrieveEvidence` (`docs/08` §18.2 pkt. 1) er
bekræftet. Status og kendte begrænsninger står i `docs/08` §18. Fasen blev besluttet
2026-10-02 (B-011).

**Videreført:** forudsætningen om redaction og kundedata til 8B. Samtalelagring, rate limiting,
retention og validering af prompterne mod en rigtig model til 8C.

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
reranking-udbyder (8B), samtalelagring (8C), Learn/Practice/Advise/Assessment som moduler
(masterfase 9–12).

### 8B — Produktionsgrundlag

**Status:** 🔒 Specifikationen er godkendt og låst 2026-10-03 (B-020,
`docs/08b-production-foundation.md`). Implementeringen sker i deltrin, og hvert deltrin kræver
godkendelse.

- **8B-I1 — evalueringsframework og gates: ✅ gennemført og godkendt 2026-10-03.** Indholdet er
  `evals/engine/` og `evals/retrieval/`, og status, udledninger og udskudte dele står i
  `docs/08b` §21.1. Passage Recall blev rettet i I2 (B-021).
- **8B-I2 — production embedding og reranking: ✅ gennemført og godkendt 2026-10-03.**
  Provider-kontrakten og Bedrock-adapterne (Cohere Embed v4 EU, 1024 dimensioner, og Rerank 3.5 i
  eu-central-1) står i `docs/08b` §21.2. De er ikke koblet ind i applikationens register.
- **8B-I2.5 — ekstern AI-datagrænse: ✅ gennemført og godkendt 2026-10-03.**
  - Kundedataspærren gælder nu alle eksterne AI-kald gennem en central egress-policy:
    generering, forespørgsels- og dokument-embedding og reranking.
  - Spærren håndhæves også i databasen (L4), jf. `docs/08b` §21.3 og B-022.
  - Admin-værktøjet "Afprøv retrieval" redigerer ikke forespørgslen, og den afvises ved grænsen,
    hvis en ekstern udbyder bruges. Der er ingen tilsidesættelse. Beslutningen er låst for 8B
    (B-023).
- **8B-I3 — workerens databaseidentitet og databasefunktioner: ✅ gennemført og godkendt 2026-10-05.**
  - Blue/green-login-roller med kun `EXECUTE` på det godkendte worker-API.
  - Lease-token (hash i databasen) på hvert kald og DB-kontrakten for engangsbilletter.
  - Rotation og nødspærring på databasesiden. service_role er kun worker lokalt (seed).
  - Detaljer i `docs/08b` §21.4 og B-024.
- **8B-I4 — workerens runtime: ✅ gennemført og godkendt 2026-10-05.**
  - postgres.js via Supavisor (transaktionstilstand, TLS, `prepare: false`) som den aktive
    blue/green-rolle.
  - Job-løkke med uafhængig heartbeat, backoff og nedlukning.
  - Secrets Manager via ECS-injektion, adskilte IAM-roller og Fargate-specifikation i
    `deploy/ingestion-worker/`.
  - Edge Function `worker-storage` til billetindløsning.
  - Detaljer i `docs/08b` §21.5 og B-025.
  - Den lukkede I5-gate er erstattet af release-gaten fra 8B-I5.
  - Konto, VPC, NAT/EIP, ECR og secret oprettes, når produktionskontoen findes [AFKLARES] —
    åbne deploymentforudsætninger.
  - **Kendt flaky-test-observation:** én isoleret AI Gateway-testfejl i den fulde kørsel ved I4.
    Fejler samme test igen i et senere deltrin, undersøges årsagen før pilot/produktion. Ved I5
    bestod den fulde suite (se `docs/08b` §21.6).
- **8B-I5 — upload-sikkerhed, karantæne og malware-scanning: ✅ gennemført og godkendt 2026-10-06 (endeligt lukket med I5.5).**
  - Uploads lander i `knowledge-intake` (karantæne). Kun frigivne filer ligger i
    `knowledge-originals`; afviste i `knowledge-quarantine`.
  - Byteniveau-validering → ClamAV (egen service, I5.5) → strukturinspektion i en isoleret børneproces.
    Verdict afledes i databasen og er bundet til version, sti, checksum og politikversion.
  - Release-gate i databasen før download og før parsing. Ingen bytes når pdfjs, chunker eller
    embedder før `safe`.
  - Detaljer i `docs/08b` §21.6 og B-026.
- **8B-I5.5 — scanner-isolation og signaturforsyning: ✅ gennemført og godkendt 2026-10-06.**
  - ClamAV er en separat ECS-service uden taskrolle og uden internet. Kun workerens SG når den på
    TCP 3310 via Cloud Map (`clamav.ipa-worker.internal`).
  - Et planlagt signaturimage hver 6. time med verifikation og uforanderligt tag lig
    scanner-revisionen, som også står på hvert verdict.
  - Fejlet opdatering: den gamle scanner bliver, alarmer udløses, og 24-timersgrænsen stopper
    `safe`.
  - Detaljer i `docs/08b` §21.7 og B-027. De to [AFKLARES]-punkter fra I5 (sidecar/taskrolle og
    signaturforsyning) er lukket.
  - Deploymentforudsætninger, når kontoen findes: ECR, VPC/subnets/endpoints, Cloud Map, roller,
    GitHub OIDC og alarmtopic.
- **8B-I5.6 — ClamAV-patchversion: ✅ gennemført og godkendt 2026-10-07.** Kandidatkørslen mod 1.4.6 er en deploymentforudsætning.
  - Production på ClamAV 1.4.6 (LTS-linje 1.4) via `deploy/clamav/engine.json`.
  - Databasen kender de godkendte engines; en ikke-godkendt engine giver aldrig `safe`.
  - Signaturopdatering (automatisk) og engine-opgradering (manuel kandidat med tests og godkendt
    digest) er adskilt. Detaljer i `docs/08b` §21.8 og B-028.
- **8B-I6 — register over retrieval-konfigurationer og ProductionEvidenceSet: ✅ gennemført og
  godkendt 2026-10-07 (B-029, B-030).**
  - Register, append-only kørsler, gate-sæt og statushistorik. `evaluation_publisher` med
    genberegning i SQL. Godkendelse, aktivering, suspendering og udfasning med
    `system.settings.manage`.
  - P1–P9 afleder graden ved hvert retrieval. EvidenceSet schemaVersion 2.
  - Detaljer i `docs/08b` §21.9 og B-029.
  - Pilotens `uncertain` er afgjort i B-030 (se 8B-I6.1).
  - Ingen rigtig konfiguration er aktiveret. CI-transporten til publiceringen er leveret i I7.
- **8B-I6.1 — pilot-politik og pilot-scope: ✅ gennemført og godkendt 2026-10-07.**
  - En pilot, der består på punktestimatet med usikre Wilson-intervaller
    (`pass_with_uncertainty`), kan kun godkendes efter en registreret menneskelig accept.
  - Tier standard er uændret. Hårde gates kan aldrig accepteres.
  - En pilot-godkendelse gælder kun de evaluerede par af produkt og dokumenttype. Det håndhæves
    pr. element i P3, så et uevalueret produkt aldrig arver den.
  - Detaljer i `docs/08b` §21.10 og B-030.
- **8B-I6.2 — stabil produktidentitet i pilot-scope: ✅ gennemført og godkendt 2026-10-07.**
  8B-I6 er hermed endeligt lukket.
  - Scope binder til produktets stabile id og dokumenttypen. Navnet er et historisk
    øjebliksbillede.
  - Et omdøbt produkt forbliver i området. Et nyt produkt med samme navn arver intet.
  - Detaljer i `docs/08b` §21.11 og B-031.
- **8B-I7 — Evaluation Operations, Monitoring & Regression Guardrails: gennemført 2026-10-08,
  venter på godkendelse (B-032).**
  - Evalueringsmiljøet er et eget projekt, som databasen selv erklærer (`evaluation`).
    Provisioneringen er idempotent, og den rigtige retrieval køres som evalueringsbrugerne med
    bekræftet identitet.
  - Publicering er et særskilt CI-job med kun `evaluation_publisher`. Det bruger kortlivet OIDC,
    TLS og SHA-256-kontrol af filerne.
  - Regression ugentligt, ved ændringer og manuelt. Et hårdt brud suspenderer uden fallback, og en
    kvalitetsregression giver alarm og vurdering. Begge auditeres med sæt, gate-sæt og
    fingeraftryk.
  - `AlertSink` med `log` og `webhook`. Workeren kører en sundhedskontrol hvert 5. minut, appen
    har retrieval-telemetri, og Admin har et afsnit med Systemstatus.
  - Performance-målene i §12 er versioneret og genberegnes i databasen. Afvigelser kræver
    dokumenteret godkendelse.
  - Udledte punkter til bekræftelse står i B-032. Detaljer i `docs/08b` §21.12.
  - Rate limiting, samtalelagring og retention hører fortsat til 8C.
- Øvrige deltrin er ikke påbegyndt. Indholdet blev foreslået ved afslutningen af
fase 7, hed derefter "fase 9" (B-011) og er nu underfase 8B (B-019). Beslutningerne D-1–D-20 står
i specifikationens §19, og implementeringsrækkefølgen i §20.

**Åbne spørgsmål (blokerer ikke specifikationen, `docs/08b` §19):**
- Å-1: Bedrock-kvoter — afklares i trin 1 af implementeringen.
- Å-2: databehandleraftaler — før rigtige dokumenter indlæses og før reel produktionsbrug
  (exit-kriterium 11).
- Å-3: hvem der vedligeholder evalueringssættet — før baseline.
- Å-4: retningslinjer for fiktive dokumenter — i `evals/retrieval/README.md` før baseline.
- Å-5: første alarmkanal og modtager. Kanalen er implementeret som en generisk webhook (B-032); modtager og tjeneste vælges ved deployment.
- Å-6: licens for offentlige betingelser — pr. dokument ved indlæsning.

Afsnittene nedenfor er det oprindelige forslag og udbydergrundlaget. Den låste specifikation er
`docs/08b`.

**Udgangspunkt:** Fase 7 kører på en test-embedder og `none`-rerankeren. Guardrailen
(`docs/07` §9.1, B-012) forhindrer, at udviklingsevidens når en production-model. AI-moduler kan
godt bygges og testes mod stub- og testimplementeringer, sådan som Copilot er i 8A. Det, der er
blokeret, er **produktionsklar anvendelse**: der kan ikke dannes production-evidens, før rigtige
udbydere er valgt, og retrieval-kvaliteten kan måles (`docs/07` §20.4, B-008). 8B skaffer det
grundlag. Den bygger ingen AI-funktionalitet.

**Foreslået indhold:**

1. **Embedding-udbyder og -model.** Valg ud fra dansk sprogkvalitet, databehandling i EU og
   pris. Modellen indføres gennem den eksisterende model- og re-embedding-mekanisme
   (`docs/07` §7) med sit eget indeks.
2. **Reranking-udbyder.** En rigtig reranker bag `Reranker`-interfacet (`docs/07` §9) med
   grad `production`.
3. **Evalueringssæt og evalueringsinfrastruktur.** Rigtige spørgsmål med kendte svar og
   kilder, også spørgsmål uden dokumentation, og en gentagelig kørsel af dem. Måling af
   træfsikkerhed og af tærsklen for "utilstrækkeligt grundlag". Tallene i `docs/07` §20.4
   valideres eller erstattes. Først derefter må production-evidens udstedes. Sættet og
   infrastrukturen bruges i 8C til at validere Copilot-prompterne mod en rigtig model.
4. **Virusscanning af uploads** (`docs/07` B-26, i dag [AFKLARES]).
5. **Workerens placering og adgang i produktion.** Hvor workeren kører, og en dedikeret
   adgang med mindst mulige rettigheder i stedet for service-role-nøglen (`docs/07` §14.1,
   B-16).
6. **Eventuelt testisolation:** integrationstests mod en separat database og en
   browserbaseret upload-test (`docs/07` §20.5).

**Forudsætning, før kundedata må tillades (videreført fra 8A):** Redaction kan ikke finde
navne i fri tekst (`docs/08` §7.2). I dag er det ufarligt, fordi matricen afviser
`customer_identifiable` som standard. Beslutningen om at tillade kundedata for en model
(`docs/03` §17 pkt. 4) **må ikke kunne træffes**, før problemet er løst på én af to måder:

- redaction kan finde navne i fri tekst, målt mod et testsæt, eller
- fri tekst fra en kundecase sendes aldrig til modellen, og det håndhæves i gatewayen.

Det er en forudsætning for beslutningen, ikke en kendt begrænsning. 8B træffer ikke selv
beslutningen om kundedata, og den har betydning for Advise (masterfase 11).

**Udenfor:** generering med Claude API og Copilot klar til brug (8C) og de øvrige AI-moduler
(masterfase 9–12). Koblingen af Vercel-demoen på Supabase (B-003) sker til sidst
(masterfase 21).

#### Grundlag for udbydervalget (indsamlet 2026-10-02)

Analysen er lavet, før fase 8 blev opdelt. Den gemmes her, så den kan bruges, når 8B
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

### 8C — Copilot klar til brug

**Status:** 📝 Ikke specificeret og ikke godkendt. Intet bygges, før det er godkendt. Indholdet
hed tidligere den foreslåede "fase 10 — Copilot i produktion". Navnet er ændret, så det ikke
forveksles med masterfase 21 Production (B-019).

**Begrundelse for placeringen (udledt):** Copilot er det første AI-modul, en rådgiver kan bruge
i hverdagen. Når 8B har skaffet production-evidens, er den næste forudsætning en rigtig
model bag gatewayen. Samtalelagring og rate limiting hører til her, fordi de først får
betydning med en rigtig model og rigtige brugere. Rate limiting hører til, når kald koster
noget. Samtalelagring er en del af Copilot-modulet, og den kræver retentionsbeslutningen.

**Videreført hertil fra 8A:**

1. **Samtalelagring.** `docs/02` §5 kræver samtalehistorik, som er brugerens egen og knyttet
   til den kontekst, samtalen blev ført i. En samtale ført inde i en kundecase skal kunne
   genfindes fra sagen og følger kundecasens adgangs- og sletteregler (`docs/03` §11). 8A
   sender én tur ad gangen og gemmer intet (`docs/08` Q-5).
2. **Rate limiting.** `docs/03` §9 lægger den i AI Gateway, og `docs/07` §14 siger, at den
   kommer med gatewayen. Kaldsloggen indeholder allerede det, der skal tælles (`docs/08` §10,
   Q-3). Omkostningsstyring pr. workflow (`docs/03` §16) hører sammen med den.

3. **Retention.** I dag er kun to ting bygget: kundesagens indhold i AI-loggen slettes sammen
   med sagen, og loggen kan ikke rettes (`docs/08` §11.4). Der findes ingen retentionspolitik
   pr. datakategori og intet sletningsjob. Mekanismen og perioderne (`docs/03` §11, §17 pkt.
   5) hører hertil.
4. **Validering af Copilot-prompterne mod en rigtig model** med evalueringssættet og
   -infrastrukturen fra 8B (`docs/08` §4.2).
5. **Generering med en rigtig model:** en production-model bag `Model`-interfacet (Claude API,
   `docs/03` §2), og om EU- og databehandleraftale-kravet også gælder den (`docs/08` Q-7).

**Kontrolleret Copilot-pilot (B-030):** kommer efter 8C og er **ikke** masterfase 18. Den bruger
kun:
- godkendt pilot-scope og godkendte dokumenter;
- navngivne autoriserede brugere;
- tæt monitorering;
- guardrails fra 8B og 8C.

Den forudsætter det hostede pilotmiljø (se fase 21).

**Andre kandidater (udledt, til afklaring, når 8C specificeres):** citations-tabellen og om
administratorers læsning af metadata og videnshuller skal slås til (B-014, `docs/08` Q-10).

---

## Fase 9 — Learn

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** sider med mock-data (fase 5). En Learn-profil i AI Gateway
uden brugerflade (8A).

---

## Fase 10 — Practice

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** sider med mock-data (fase 5). En Practice-profil i AI Gateway
og den minimale tabel `practice.roleplay_sessions` til gating (8A, B-013). Fasen udvider
tabellen og bygger den ikke om.

---

## Fase 11 — Advise

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** sider med mock-data (fase 5), adgang pr. sag med ejer og
deltagere (fase 6) og en Advise-profil i AI Gateway (8A). **Kundedata må ikke tillades til en
model, før forudsætningen i 8B er opfyldt.**

---

## Fase 12 — Assessment

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** sider med mock-data (fase 5). Den minimale tabel
`assessment.assessment_attempts` og server-side gating af AI under en aktiv prøve (8A, B-013,
B-015). Fasen udvider tabellen og bygger den ikke om.

---

## Fase 13 — Personlig AI og læringsprofil

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** Min profil med mock-data (fase 5) og synlighedsfanen på
rigtige data (`my_visibility`, fase 6).

---

## Fase 14 — Admin

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** Knowledge Engine-administrationen (fase 7) og AI Gatewayens
tilstand (8A). Brugeradministration i brugerfladen og nulstilling af adgangskode blev henlagt i
fase 6.

---

## Fase 15 — Analytics

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** sider med mock-data (fase 5). Lederscopes og audit af
lederens individadgang (fase 6).

---

## Fase 16 — Kvalitet og guardrails

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** guardrailen for evidensgrad (fase 7), gatewayens politiklag,
output-kontrakter og parringsreglen (8A, B-012) samt mutationstests i fase 7 og 8A.
Evalueringssættet hører til 8B.

---

## Fase 17 — Test

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** hver fase har sine egne tests (enhed, pgTAP, integration,
rute og mutation). Testisolation og en browserbaseret upload-test er foreslået i 8B
(`docs/07` §20.5).

---

## Fase 18 — Pilotversion

**Status:** ⬜ Ikke påbegyndt — ikke specificeret. Intet bygget.

**Forudsætninger (B-030):**
- Fasen er uændret. Den kontrollerede Copilot-pilot efter 8C er ikke denne fase.
- Fasen forudsætter et isoleret, hostet pilotmiljø (se fase 21).
- Fasen forudsætter et evalueringssæt med mindst 100 spørgsmål med holdout (`docs/08b` §4.4).

---

## Fase 19 — Feedback

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** knapperne til tommel op og ned under Copilot-svar er kun
brugerflade. Intet gemmes.

---

## Fase 20 — Enterprise-version

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Fundament fra tidligere faser:** MFA og SSO blev henlagt i fase 6. Connectors er beskrevet i
`docs/03` §15.

---

## Fase 21 — Produktion

**Status:** ⬜ Ikke påbegyndt — ikke specificeret.

**Hører hertil:** Supabase i produktion i EU (henlagt i fase 6) og koblingen af Vercel-demoen på
Supabase med fjernelse af demo-tilstanden (B-003). Workerens placering og adgang i produktion
hører til 8B, fordi production-evidens forudsætter den.

**Pilotmiljø før fase 21 (B-030):** masterfase 21 betyder den endelige produktion og go-live. Et
isoleret, hostet pilot-/staging-miljø må etableres før. Det er en forudsætning for den
kontrollerede Copilot-pilot og for masterfase 18. Det omnummererer intet.
