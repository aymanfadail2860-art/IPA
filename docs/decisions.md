# Beslutninger — Insurance Partners (IPA)

Beslutningslog efter `CLAUDE.md` §5. Hvert punkt indeholder dato, beslutning, overvejede
alternativer og begrundelse. Nyeste øverst.

**Fasehenvisninger før B-019:** Beslutninger fra før 3. oktober 2026 bruger datidens numre. I
B-011 til B-018 betyder "fase 8" 8A — AI Gateway, "fase 9" betyder 8B — Produktionsgrundlag, og
"den foreslåede fase 10" betyder 8C — Copilot klar til brug. Teksten i de enkelte beslutninger
er ikke omskrevet, fordi loggen er historik.

---

## B-037 — AWS fjernet fra den aktive beta; skjulte områder (beta L2)

**Dato:** 13. oktober 2026
**Område:** `docs/beta.md` §2, §9, §14; `deploy/import/compose.yaml`;
`deploy/monitoring/aggregate-alarms.*` (version 2); `src/config/beta-surface.ts`, `src/proxy.ts`

**Beslutning:**
- **AWS er fjernet fra den aktive kode og konfiguration** (B-035, `docs/beta.md` §14.1). Det
  omfatter Bedrock-adaptere og -transport, credential-vejene, kataloget, provider-runtime og
  provider-metrikker. Fjernet er også ECS-, ECR-, IAM-, security group-, Cloud Map- og
  CloudWatch-filer, de AWS-baserede workflows og AWS-dependencies. Intet er slettet fra historikken.
  Rollback-punktet er uændret (§10).
- **Den hybride metode kan ikke længere give production-evidens.** Der findes ingen
  production-embedder eller -reranker. En hybrid konfiguration med en production-udbyder afvises af
  registret (fail-closed), og en hybrid evidensmængde opfylder aldrig P1/P2. Betaens
  production-vej er `product_documents` (B-035).
- **Leverandøruafhængige sikkerhedskrav er flyttet før sletning.** Hvert fjernet AWS-afhængigt
  testkrav er ført over i en ny eller ændret test (`docs/beta.md` §14.3). Scannerens og workerens
  isolation gælder nu containerspecifikationen `deploy/import/compose.yaml`.
- **Kontrolsættet af embedding-vektorer (C6) bliver**, som B-035 fastslår (§2.1). Koden er
  leverandøruafhængig. Betaen har ingen embedding-model, så kontrollen har intet at måle.
- **Undtagelsen `createEvaluationBaselineReranker` er fjernet.** Den lod "none" konstruere i enhver
  runtime, og kun Bedrock-evalueringen i CI brugte den. "None" kan nu kun konstrueres gennem
  registrets kontrol af grade.
- **De aggregerede alarmer er version 2.** Kilden `provider_call` og alarmerne A2 og A6 havde kun
  Bedrock som kilde og er fjernet. CloudWatch-alarmerne er også fjernet. Numrene genbruges ikke.
  A1 og A3–A5, minimum 20 forsøg og enkelthændelserne er uændrede.
- **Betaen skjuler Advise, Analytics og Min profil server-side.**
  - Det gælder for alle roller, uanset permissions.
  - Proxyen og siderne svarer 404, og server-actions afviser. Områderne optræder ikke i navigation,
    søgning, brugermenu eller på Home.
  - Kundecases indlæses ikke.
  - Copilot, Learn, Practice, Assessment, Home og Admin er uændrede.
  - Demoen uden login (B-003) er ikke betaen og beholder alle områder.

**Overvejede alternativer:**
- *Bevare Bedrock-koden inaktiv.* Fravalgt. B-035 kræver, at AWS ikke indgår i den aktive runtime
  og ikke i afhængighederne. Koden kan gendannes fra historikken.
- *En testdobbelt, der registreres som production-implementering, så de hybride positive tests
  kunne blive.* Fravalgt. Det ville åbne for præcis det, mekanismen skal forhindre: at noget, der
  ikke er en rigtig production-adapter, bliver det. I stedet er P3–P9 vist med doubler, der kun
  erklærer production og derfor fejler netop P1 og P2. Den positive vej er vist med
  `product_documents`.
- *Skjule områderne kun i menuen.* Fravalgt. En URL eller en server-action ville stadig nå dem.
- *Skjule også Learn, Practice og Assessment, fordi de endnu viser udviklingsdata.* Fravalgt. De er
  betaens kernemoduler og bygges i L6–L8.

**Begrundelse:** betaen skal være så lille og så kontrolleret som muligt. Det, der ikke indgår i den,
må hverken kunne kaldes eller ses. De sikkerhedskrav, AWS-koden testede, er ikke knyttet til AWS.
De er ført over, så de stadig håndhæves af det, der findes.

**Udledt (til bekræftelse):**
1. **Betaen er enhver session med database.** Kun demoen uden login er ikke betaen.
2. **Min profil skjules sammen med Advise og Analytics.** Siden viser kun udviklingsdata (fase 13)
   og indgår ikke i betaens scope (`docs/beta.md` §1).
3. **De rutetests, der viste sagsadgang og lederscope gennem siderne, viser nu 404.** Selve reglerne
   testes uændret i databasen (`rls.integration.test.ts`).

---

## B-036 — Gate-sæt for product_documents, tre adskilte godkendelser og L2 (beta L1.1)

**Dato:** 13. oktober 2026
**Område:** `docs/beta.md` §5, §8, §13; `evals/retrieval/gates/product-documents-gates-v1.json`;
`evals/acceptance/`; migrations `20261013000100` og `20261013000200`

**Beslutning:**
- **L0 og L1 er godkendt.** `product_documents` er betaens primære retrieval-strategi.
- **Publiceringsreglen er bekræftet** (B-035, udledt 1):
  - uden aktiv embedding-model kan en version publiceres uden embeddings, når alle øvrige
    sikkerheds-, review-, versions- og adgangskrav er opfyldt;
  - med en aktiv model gælder embedding-kontrollen;
  - intet godkendes eller publiceres automatisk.
- **Permission-modellen er godkendt principielt.** `docs/beta.md` §8 er efterprøvet mod principperne,
  og afvigelserne er rapporteret dér (§8.1).
- **Gate-sættet `product-documents-gates` v1 (D1–D6)** måler metodens faktiske opgave: at levere
  korrekte, fuldstændige, autoriserede og relevante produktdokumenter.
  - Hver gate er en invariant med tærsklen 1. Metrik, retning og tærskel er låst i koden og i
    databasen.
  - De hårde gates H1–H7 gælder. H4 og H6 er tilpasset eksplicit for metoden:
    - netop spørgsmålets ene produkt;
    - hele grundlaget, hver version komplet, i rækkefølge og uforkortet;
    - inden for budgettet.
  - Et gate-sæt gælder netop én metode. D1–D6 kan aldrig godkende en hybrid konfiguration, og
    Q1–Q7 kan aldrig godkende `product_documents`.
  - Q1–Q7 (`gates-v1`) er uændrede for den hybride metode.
- **E2E-svarkvalitet er en separat kontrol** (`beta-answer-acceptance` v1), med disse krav:
  - mindst 40 spørgsmål i alle ni kategorier;
  - mindst 95 % fuldt korrekte;
  - 0 kritiske fejl og 0 opdigtede kilder;
  - korrekt håndtering af undtagelser og afvisninger;
  - en rigtig Claude-model;
  - eksplicit faglig, menneskelig validering.
- **Tre adskilte godkendelser i databasen:**
  - godkendt retrieval-konfiguration;
  - valideret AI-svarkvalitet;
  - betaversion godkendt til rådgivere.

  Ingen af dem medfører automatisk en anden.
- **Dokumentbudgettet på 360.000 tegn er et midlertidigt udviklingsloft.** Det er ikke dokumenteret
  API-kapacitet. Før rigtige Claude-kald kontrolleres disse punkter (`docs/beta.md` §5.3):
  - tokenantal;
  - kontekstgrænse;
  - reserverede outputtokens;
  - systemprompt;
  - antal dokumenter;
  - pris og svartid.

  Kan hele grundlaget ikke være med, afvises kaldet. Der afkortes eller udelades aldrig noget.
- **Dokumentindhold er kildedata**, aldrig systeminstruktioner.
- **Rollback:** commit `5461546` er den dokumenterede reference. Et manglende remote-tag blokerer ikke.
- **L2 må gennemføres**, når L1.1 består. Derefter stoppes der før L3.

**Overvejede alternativer:**
- *Q1–Q7 med K = hele sættet* (forslaget i L1, `docs/beta.md` §5.1). Fravalgt:
  - MRR og rerankerens løft har ingen mening uden rangering;
  - afvisning af ubesvarbare spørgsmål er en egenskab ved det færdige svar, ikke ved
    dokumentudvælgelsen.
- *Tærskler under 1 med statistisk usikkerhed.* Fravalgt. Fuldstændighed og autorisation er ikke
  estimater, og én udeladt eller fremmed version er en fejl.
- *Én samlet godkendelse af retrieval, svar og beta.* Fravalgt. Den ville lade en godkendt
  dokumentudvælgelse fremstå som valideret svarkvalitet.

**Begrundelse:** metoden leverer et deterministisk grundlag pr. produkt og dato. Det, der kan gå
galt, er udeladelse, afkortning, forkert version, forkert produkt og manglende adgangskontrol. Det
måles direkte og uden tolerance. Svarkvaliteten afhænger af modellen og afgøres først med den
rigtige model og et menneskes faglige validering.

**Udledt (til bekræftelse):**
1. **En dokumentgate gør aldrig en kørsel "uncertain".** Wilson-intervallet rapporteres, men
   pilot-reglen om accept af usikkerhed (B-030) gælder ikke en invariant. Tier pilot afgrænser
   stadig godkendelsen til det evaluerede område.
2. **En gyldig version, brugeren må læse, som mangler helt, er også et H6-brud.** Den er altså ikke
   kun en D4/D6-mangel. I regression suspenderer den straks.
3. **Undtagelser og afvisninger har nul tolerance.** Fejl i håndteringen af undtagelser og
   begrænsninger og manglende eller uberettigede afvisninger tolereres ikke. Det kommer oven i kravet
   om 95 % fuldt korrekte svar.
4. **Hvem må hvad i E2E-kontrollen:**
   - en person med `knowledge.version.publish` validerer svarkvaliteten (faglig godkendelse);
   - registrering af bedømmelser og godkendelse af betaen kræver `system.settings.manage`.
5. **En betagodkendelse gælder kun, mens dens retrieval-konfiguration er den aktive og klar til
   drift.** Svarvalideringen skal gælde netop den konfiguration.
6. **Minimum pr. type i retrieval-sættet er det samme som i 8B** (mindst 36 spørgsmål), og hvert
   spørgsmål skal angive netop ét produkt.

---

## B-035 — Fast beta uden AWS med fire kernemoduler

**Dato:** 12. oktober 2026
**Område:** `docs/beta.md` (betaens scope, arkitektur og leverancer), `CLAUDE.md` §1–§4,
`docs/roadmap.md`, `docs/07-knowledge-engine.md` (publicering og retrieval),
`docs/08b-production-foundation.md` (§21.16)

**Beslutning:**
- **Ny udviklingsstrategi.** Målet er en professionel, fungerende beta med fire obligatoriske
  moduler: Copilot, Learn, Practice og Assessment. Alle fire bygger på den samme autoritative,
  versionsstyrede forsikringsviden. Prioriteten er hurtig levering, lav kompleksitet, høj
  forsikringsfaglig kvalitet og sikkerhed. Der gås ikke på kompromis med:
  - kundedatabeskyttelse;
  - adgangskontrol;
  - dokumentversioner;
  - kildekorrekthed;
  - prøvesikkerhed.
- **Advise udskydes.** Kundepolice-analyse, sammenligning af kundens dækning, AI på identificerbare
  sagsdata og sagsbaseret AI-dialog er uden for betaen. Koden bevares. Modulet skjules i betaens
  brugerflade, og spærren mod kundesagsdata bevares.
- **K1 — embedding-fri retrieval-konfiguration.** Godkendt. Betaen får en retrieval-konfiguration
  uden embedding-model og reranker, som kan blive beta-godkendt efter reel evaluering.
  - Ingen generel fjernelse af sikkerhedsgates.
  - Ingen automatisk production-evidens.
  - Ingen adgang til ikke-godkendte dokumenter.
  - RLS og dokumentrettigheder tilsidesættes aldrig.
  - P1/P2 og H6 tilpasses kun eksplicit for den nye retrieval-type. P3–P9 og de øvrige relevante
    hårde gates gælder uændret.
  - Evalueringen verificerer den faktiske metode og det autoriserede produktscope.
  - Versionsstyring, konfliktmarkering, historiske betingelser og kildeproveniens bevares.
- **Copilot-retrieval: strategi B, "produktdokumenter i fuld længde"** (`product_documents`).
  Sammenligningen med produktfiltreret leksikalsk retrieval står i `docs/beta.md` §4. Brugeren
  vælger produkt. Databasen udvælger de adgangsgodkendte, publicerede og gyldige dokumentversioner
  for produktet inden for profilens dokumenttyper, og modellen modtager dem i fuld længde. Et
  grundlag over budgettet (`maxChars`, del af fingeraftrykket) afvises og afkortes aldrig.
- **K2 — publicering uden embeddings.** Godkendt, når den godkendte beta-retrievaltype ikke kræver
  dem. Dokumenter skal fortsat igennem:
  - kontrolleret import;
  - karantæne;
  - PDF-validering;
  - malwarekontrol og godkendt scan-verdict;
  - tekstudtræk og versionsregistrering;
  - faglig menneskelig godkendelse;
  - rettighedstildeling.

  Ingen automatisk publicering.
- **K3 — AWS fjernes fra betaen.** Den aktive beta må ikke afhænge af:
  - Bedrock og Cohere;
  - Fargate/ECS og ECR;
  - NAT/VPC;
  - AWS IAM/OIDC;
  - Secrets Manager;
  - CloudWatch.

  AWS-kode og dependencies fjernes, når den nye vej er bygget og testet (L2). Historiske
  migrations og Git-historik bevares. Ingen destruktive databaseændringer.
- **K4 — faserækkefølge.** Godkendt som eksplicit undtagelse til den hidtidige
  implementeringsrækkefølge. Betaen må implementere de nødvendige dele af 8C, 9, 10 og 12 tidligere
  end den oprindelige masterrækkefølge. Master-roadmap 1–21 ændres ikke. CLAUDE.md §2 ændres kun i
  det omfang, der dokumenterer undtagelsen.
- **K5 — demo og beta adskilt.** Den offentlige demo må ikke forveksles med betaen og bevares om
  nødvendigt kun som beskyttet development/preview uden rigtige kundedata. Betaen:
  - kræver login;
  - bruger Supabase;
  - viser ikke mock-data som virkelige resultater;
  - tillader kun inviterede, autoriserede brugere.
- **K6 — permissions.** Separate, mindst mulige permissions:
  - `learning.content.manage`;
  - `practice.scenarios.manage`;
  - `assessment.content.manage`;
  - `assessment.content.approve`.

  Eksisterende permissions genbruges til brugeradgang og Knowledge Engine-administration. Ret til
  at redigere læringsmateriale giver aldrig ret til at godkende prøvespørgsmål. Roller, scope, RLS
  og audit står i `docs/beta.md` §8. Permissions implementeres i den leverance, der først bruger dem.
- **K7 — Claude API direkte.** Godkendt som teknisk beta-retning. Det er **ikke** en påstand om
  behandling udelukkende i EU.
  - Før rigtige fortrolige dokumenter eller personoplysninger sendes til modellen, skal DPA,
    dokumentlicenser, behandlingsgrundlag, sikkerhed og datatransfers være vurderet og godkendt.
  - Udvikling bruger syntetiske eller særskilt godkendte testdata.
  - Den private Claude Code-konto må aldrig blive platformens produktionskonto.
- **Dokumentimport:** kontrolleret administratorimport som engangskørsel i Docker på en betroet
  maskine. Den genbruger den eksisterende worker og ClamAV-kæde. Dokumenter uploades ikke til
  GitHub Actions som standard.
- **E2E-svarevaluering** (exit-krav for den første begrænsede beta):
  - mindst 40 repræsentative spørgsmål;
  - mindst 95 % fuldt korrekte;
  - 0 kritiske fejl om dækning, undtagelser, gyldighed eller dokumentrettigheder;
  - ingen opdigtede kilder;
  - alle væsentlige konklusioner dokumenteret;
  - tydelig afvisning ved utilstrækkeligt grundlag.

  Kategorierne står i `docs/beta.md` §5.2. Evalueringen erstatter ikke automatisk retrieval-gates
  Q1–Q7. Usikkerheden ved et lille sæt rapporteres og accepteres eksplicit.
- **Databeskyttelse for fritekst:** proveniens og egress-autorisation pr. profil og handling, aldrig
  en generel tilladelse til at sende brugertekst til Anthropic. Ukendt eller kundebundet indhold
  fejler lukket. Der er ingen administratoroverstyring (`docs/beta.md` §7).
- **Supabase:** det eksisterende projekt "IPA" (EU) er udpeget som beta-staging og må kun inspiceres
  read-only. Migrations, tabeller, Auth/RLS, uploads og betalbare ressourcer kræver særskilt
  godkendelse. En separat production-database oprettes senere.
- **Git og rollback:**
  - arbejdet sker på `beta/fast-beta-without-aws` og ændrer `main` via pull requests med grøn CI;
  - rollback-punktet er `5461546` (`docs/beta.md` §10);
  - ingen force-push og ingen sletning af historik.
- **Udførelse:** L0–L9 i `docs/beta.md` §9. Hver leverance godkendes særskilt.

**Overvejede alternativer:**
- *Strategi A, produktfiltreret leksikalsk retrieval.* Fravalgt som production-metode. Uden
  embeddings og reranker findes undtagelser og fravær af dækning ikke pålideligt, og exit-kravet om 0
  kritiske fejl kan ikke forventes nået.
- *En kombination af A og B i runtime.* Fravalgt: den giver ikke en klar fordel, der opvejer den
  ekstra kompleksitet. Et for stort grundlag afgrænses af brugeren til de relevante dokumenter.
- *Behandling af dokumenter på GitHub-hostede runners.* Fravalgt som standard: forsikringsdokumenter
  må ikke nødvendigvis behandles der.
- *Bevare AWS-stakken i betaen.* Fravalgt: den kræver deployment og drift, som betaen ikke har
  brug for. Den mulige EU-regionsvej, Bedrock gav, opgives bevidst. Det skal oplyses sandfærdigt.

**Begrundelse:** den hurtigste vej til fire fungerende moduler er den eksisterende platform med
Supabase, Vercel og Claude API. Den genbruger Knowledge Engine, AI Gateway, egress-grænsen,
upload-sikkerheden og registret over konfigurationer uden AWS. De låste sikkerhedsgrænser bevares.
Kun de valg, der binder løsningen til embeddings og AWS, tilpasses eksplicit.

**Fund under L0, til afgørelse:** kvalitetsgates Q1–Q7 passer ikke til en ikke-rangerende metode
(`docs/beta.md` §5.1). Q1–Q7 er ikke ændret. Indtil et gate-sæt for `product_documents` er besluttet,
kan betaens konfiguration ikke godkendes (fail-closed).

**Udledt (til bekræftelse):**
1. Publicering kræver embeddings, netop når en embedding-model er aktiv (implementeret i L1).
   - Uden aktiv model kan ingen søgning bruge vektorer, så kravet bortfalder.
   - Ellers kunne betaens dokumenter ikke publiceres og evalueres, før en konfiguration var
     godkendt.
   - Med en aktiv model kræves embeddings som hidtil, også når konfigurationen i drift er
     embedding-fri. Det er strengere end K2 tillader, men enklere og uden huller.
   - En hybrid konfiguration kan kun aktiveres, når dens model dækker alle chunks.
2. Administratorrollen får de fire nye permissions som standard. Firøjneprincippet i databasen
   adskiller redigering og godkendelse af prøvespørgsmål.
3. At tage en prøve kræver en aktiv bruger og en tildelt prøve, ikke en ny permission.

---

## B-034 — 8B-I8: Final Implementation Closure (C1–C7)

**Dato:** 12. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.12, §21.14 og §21.15, `src/lib/knowledge/providers/`,
`src/lib/knowledge/core/control-set.ts`, `workers/ingestion/`, `evals/engine/`, `workers/evaluation/`,
`src/lib/knowledge/operations-*.ts`, `supabase/migrations/20261009000200_h6_regression_and_replay.sql`,
`deploy/application/`, `deploy/monitoring/`, `.github/workflows/ci.yml`

**Beslutning:**
- **8B-I8 lukker kodehullerne C1–C7** fra afslutningsauditten. C7 blev fundet, da I8 begyndte,
  godkendt som et reelt fund og implementeret først.
  - **C7:** én udbydervej fra modelrække til katalog til runtimens transport og embedder i appen,
    workeren og evalueringen. Der er intet fallback.
  - **C1:** appen får AWS-credentials via Vercel OIDC → STS → kortlivede credentials. Hver
    runtime har netop én credential-vej:
    - Vercel: OIDC;
    - ECS: taskrollen;
    - evalueringsjobbet: GitHub OIDC;
    - lokalt: udviklingskæden.

    Ingen statiske nøgler.
  - **C2:** et minimalt område, Drift af retrieval, i Admin over de eksisterende
    livscyklusfunktioner. Der er ingen publisher-funktion i applikationen.
  - **C3:** udbyderens fejltype pr. kald (`provider_call`).
  - **C4:** H6 i drift suspenderer gennem den rigtige publiceringsvej. H6 skal kunne bevises af
    rapporten, og publiceringen er idempotent.
  - **C5:** et CI-workflow uden production-credentials.
  - **C6:** et versioneret kontrolsæt af embedding-vektorer, der sammenlignes med en godkendt
    reference.
- **B-033's minimum er godkendt (version 1):** rate- og p95-alarmer vurderes kun med mindst 20
  relevante forsøg i vinduet. Minimummet er versioneret i `deploy/monitoring/aggregate-alarms.json`.
  Enkelthændelser er undtaget: hård regression, suspendering, ugyldig evaluering, utilgængelig
  scanner, malware, utilgængelig retrieval, konfigurationsafvigelse og ændret embedding-model.
- **Vercel OIDC:** audience er `sts.amazonaws.com` som standard og kan konfigureres
  (`IPA_AWS_OIDC_AUDIENCE`), hvis trust-politikken kræver en anden. Rollens ARN er konfiguration.
  STS kaldes i `eu-central-1`. At udvekslingen og trust-politikken passer, verificeres ved første
  deployment.
- **Kandidatmodellens række** (Embed v4) og dens partielle HNSW-indeks oprettes fortsat med en
  migration, når modellen indføres i et miljø (§21.2). Det er en deployment-forudsætning. En
  global migration nu ville få hver lokal worker og testworker til at kalde Bedrock.
- **Kontrolsættets reference** er VALIDATION PENDING:
  - Den optages med den rigtige udbyder og kalibreres ud fra gentagne optagelser.
  - Den godkendes med en ny beslutning og lægges i koden.
  - Der er ikke opfundet en tolerance.
  - Uden reference logges kontrollen som ikke verificeret.

**Overvejede alternativer:**
- *Workerens credentials via SDK'ens standardkæde (C7/C1).* Fravalgt: den læser statiske nøgler,
  profiler og filer stiltiende. Hver runtime får sin ene kilde, og resten fejler lukket.
- *Lade publiceringstrinnet afvise H6 som før (C4).* Fravalgt: §4.4 kræver suspendering af
  konfigurationen i drift. Afgørelsen hører til databasen, som genberegner fingeraftrykkene.
- *Fjerne `record_evaluation_run` fra publisherens API (C4).* Fravalgt: H6-beviset ligger i
  selve registreringen, så begge indgange er dækket uden at ændre rettighederne.
- *Gemme kontrolreferencen i databasen med en Admin-godkendelse (C6).* Fravalgt i I8: det
  kræver nyt skema og en ny godkendelsesflade. En gennemset kodeændring med en beslutning er
  enklere og lige så sporbar.
- *Køre ClamAV i CI (C5).* Fravalgt: signaturerne hentes eksternt, så kørslen er ikke
  reproducerbar. EICAR mod 1.4.6 er dækket af scannerens egne workflows.

**Begrundelse:** hver lukning holder de eksisterende grænser:
- egress-autorisationen går forud for hvert kald;
- workeren har mindst mulige rettigheder og aldrig service_role;
- publisheren er isoleret, og en administrator kan ikke fabrikere et resultat;
- P1–P9 er uændrede.

Det, der kun kan bevises i det rigtige miljø, er markeret som en ekstern forudsætning frem for
at blive antaget.

**Udledt (til bekræftelse):**
1. En gentaget publicering sender alarmen igen, markeret som gentagelse. En dublet er bedre end
   en mistet kritisk alarm.
2. Ved afvigelse i kontrolsættet stopper workeren med at embedde med modellen (fail-closed),
   frem for at fortsætte og blande vektorer fra to modelversioner i indekset.
3. Uden godkendt reference skrives en loglinje, ikke en alarm. Ellers ville alarmen gentage sig
   dagligt, indtil kalibreringen er sket.
4. Kontrollen kører dagligt som standard og kan ikke slås fra i produktion.
5. En H6-kørsels performance-måling registreres ikke, fordi tiderne ikke måler konfigurationen.

---

## B-033 — Kanonisk klassifikation af evalueringskørsler (8B-I7.1); B-032 afgjort; 8B-I7 lukket

**Dato:** 9. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.13–§21.14,
`supabase/migrations/20261009000100_canonical_run_classification.sql`, `evals/engine/regression.ts`,
`evals/engine/publication.ts`, `workers/evaluation/publish-run.ts`, `src/lib/observability/`,
`deploy/monitoring/aggregate-alarms.md`

**Beslutning:**
- **8B-I7 er godkendt** i grundarkitektur og implementering. Det gælder evalueringsdrift,
  regressionskontrol, observability, `AlertSink`, performance-måling og arkitekturen for
  evalueringsmiljøet (B-032). B-032's udledte punkter 1, 2, 3, 5 og 6 er godkendt. Punkt 4 er
  præciseret nedenfor og implementeret som 8B-I7.1.
- **Kanonisk klassifikation (8B-I7.1):**
  - Databasen er source of truth for, hvad en registreret kørsel er:
    - `baseline`;
    - `regression` (bestået);
    - `hard_gate_regression`;
    - `quality_regression`.
  - Klassifikationen afledes af konfigurationens status i databasen i det øjeblik, kørslen
    registreres (`registered_while`), og af kørslens gates og udfald. Kalderen kan ikke sætte
    den. Én regel bruges af audit, systemstatus og publicering:
    `knowledge.evaluation_run_classification`.
  - En ugyldig kørsel (H7, eller H6 uden for drift) registreres aldrig. Den afvises med
    `invalid_run` og giver alarmen `evaluation_invalid`. Den kan hverken blive en baseline eller
    en bestået kørsel.
  - CI-jobbets mode gemmes kun som diagnostik (`requested_mode`). Den vises ved siden af
    klassifikationen sammen med en markering af, om de to stemmer overens, og afgør hverken
    alvor, suspendering, klassifikation, alarmkode eller production-tilstand.
  - Publiceringen sker med `knowledge.publish_evaluation_run(rapport, ønsket tilstand)`, som
    returnerer databasens hændelse. Publisherens API har dermed fire funktioner.
  - **8B-I7 er implementeret og godkendt** og lukket med I7.1.
- **Performance uden måling:**
  - Et performance-kriterium, der ikke er målt, er `not demonstrated` og dermed en afvigelse. Det
    behandles aldrig som bestået.
  - I et afgrænset pilotmiljø kan en administrator udtrykkeligt acceptere afvigelsen med en
    skriftlig begrundelse (`knowledge.accept_performance_deviation`). Målet i §12 ændres ikke.
- **Performance-miljø:** det reproducerbare performance-bevis laves i evalueringsmiljøet.
  Production- og pilot-runtime skal stadig sende de nødvendige strukturerede latency- og
  fejlmålinger.
- **Rate- og latency-alarmer:**
  - Aggregerede alarmer som fejlrate og p95-latency bygges i den valgte deployment- og
    logplatform, ikke i et eget metrics-system i applikationen.
  - De er en forudsætning **før** den kontrollerede Copilot-pilot.
  - `deploy/monitoring/aggregate-alarms.md` beskriver for hver alarm metric-navn, dimensioner,
    tærskel, vindue og alvor.
  - Tærsklerne er dem i §14. Vinduet er 15 minutter, og alle alarmerne er `warning`.
  - Hvem der modtager alarmerne, og via hvilken tjeneste (Å-5), er fortsat åbent.
- **Stabile produkt-id'er:** pilot- og evalueringsmanifester bruger de stabile produkt-id'er fra
  den autoritative produktmodel. Produktnavne er kun øjebliksbilleder til visning og audit
  (B-031).

**Overvejede alternativer:**
- *Lade CI-jobbets mode afgøre alarmen (I7).* Fravalgt: et label, som kalderen styrer, kan ikke
  bestemme alvor eller suspendering. Databasen kender konfigurationens status, og det gør
  kalderen ikke.
- *Gemme klassifikationen som et frit felt, kalderen sætter.* Fravalgt af samme grund. Den
  ønskede tilstand gemmes, men kun som diagnostik.
- *Udlede klassifikationen af konfigurationens nuværende status.* Fravalgt: efter en hård
  regression er konfigurationen suspenderet, så den nuværende status ville klassificere
  kørslen forkert. Det er statussen ved registreringen, der tæller.
- *Et metrics-system i appen til rate-alarmerne.* Fravalgt: aggregering hører til
  deployment-platformen, §14 udelukker en ny observability-leverandør, og loglinjerne indeholder
  allerede grundlaget.

**Begrundelse:** en alarm, der kan styres af den, der starter kørslen, er ikke en sikkerhedsgrænse.
Når klassifikationen ligger i databasen, følger alvor, suspendering og alarm den samme regel som
selve registreringen. Uoverensstemmelser forbliver synlige.

**Udledt (til bekræftelse):** en aggregeret alarm vurderes kun, når vinduet indeholder mindst
20 forsøg. Ved pilotens trafik ville én fejl ellers give 100 % (`deploy/monitoring/aggregate-alarms.md`).

---

## B-032 — Evaluation Operations, Monitoring & Regression Guardrails (8B-I7)

**Dato:** 8. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.12,
`supabase/migrations/20261008000100_evaluation_operations.sql`, `evals/engine/`,
`workers/evaluation/`, `src/lib/observability/`, `workers/ingestion/health-monitor.ts`,
`.github/workflows/retrieval-evaluation.yml`, `deploy/evaluation/`

**Beslutning:**
- **8B-I6.2 er godkendt, og 8B-I7 er påbegyndt** efter din eksplicitte godkendelse. Indholdet
  følger definitionen i §21.10.
- **Evalueringsmiljøet** er et eget Supabase-projekt med samme migrationer. Databasen siger selv,
  hvad den er (`ops.environment`). Kun databasens ejer sætter arten (`ops.set_environment_kind`),
  og ændringen auditeres. Uden en angivet art er miljøet `unset`. Motoren nægter at provisionere
  eller køre, før der læses eller skrives noget, medmindre databasen siger `evaluation`.
  Credentials kommer kun fra `IPA_EVAL_*` og aldrig fra applikationens variabler.
- **Retrieval i evalueringen** er den rigtige `runRetrieval`, kørt som hver evalueringsbruger
  gennem RLS. Identiteten tæller kun, når databasen selv bekræfter den (H7). Korpussets checksum
  læses igen ved integritetskontrollen, så en ændring under kørslen fanges (H7).
- **Korpusset** provisioneres idempotent fra manifestet:
  - produkterne oprettes med manifestets produkt-id'er (B-031);
  - evalueringsbrugerne får ingen roller og præcis manifestets tildelinger;
  - offentlige kilder skal matche deres SHA-256.
- **Publicering er et særskilt trin og et særskilt CI-job.**
  - Evalueringsjobbet har ingen production-credential.
  - Publiceringsjobbet har kun `evaluation_publisher_login`, hentet gennem en kortlivet
    OIDC-rolle, der kun kan læse den ene secret. Det bruger TLS med certifikatverifikation og
    nægter at starte, hvis en applikationsnøgle er sat.
  - Filerne efterprøves mod deres SHA-256-liste, før noget registreres.
- **Regression** er en registreret kørsel af konfigurationen i drift. Hændelsen auditeres
  (`knowledge.evaluation_run.regression`) med evalueringssæt, gate-sæt, runtime-fingeraftryk,
  fejlede gates og udfald:
  - Et hårdt gate-brud suspenderer i samme transaktion (D-8, uændret) og giver den kritiske
    alarm `hard_gate_regression`. Der er ingen fallback.
  - Et fejlet kvalitetsgate giver alarmen `quality_regression` til faglig og teknisk vurdering.
    Konfigurationen forbliver aktiv.
  - En ugyldig kørsel (H6 uden for drift, H7) afvises ved registreringen og giver alarmen
    `publication_refused`.
- **Kørsler:** manuelt (baseline eller regression), ugentligt og ved hver ændring af model,
  reranker, chunker, algoritme, parametre eller migrationer. Rapporterne er versionerede og
  gemmes i 400 dage som artefakt:
  - rapport;
  - Markdown;
  - performance-måling;
  - SHA-256-liste.
- **Performance (§12, §17 pkt. 10):**
  - Målene i §12 er versioneret som `performance-targets-v1`. De ændres kun med en ny version og
    en beslutning her.
  - Målingen indeholder de rå målinger. Databasen genberegner percentilerne (nearest rank, samme
    formel som motoren) og resultaterne og afviser en måling, der ikke stemmer.
  - Målingen registreres af `evaluation_publisher` med konfigurationens fingeraftryk og den
    kørsel, den stammer fra.
  - Et mål, der ikke er nået eller ikke er målt, er en afvigelse.
  - En afvigelse kræver en dokumenteret godkendelse
    (`knowledge.accept_performance_deviation`, `system.settings.manage`, begrundelse på mindst
    20 tegn, én gang). Godkendelsen er append-only.
- **Alarmer (D-15):** `AlertSink` med `log`, som altid kører, og `webhook` (JSON over HTTPS) som
  første kanal.
  - Kataloget har 12 faste koder med faste danske resuméer.
  - Detaljer er kun tal og korte tokens: id'er, checksums og koder. Alt andet fjernes og tælles.
  - Modtager og tjeneste afgøres stadig ved deployment (Å-5). URL'en ligger i
    secret-håndteringen.
- **Sundhedskontrol (§14):**
  - Workeren læser hvert 5. minut `knowledge.worker_system_health()`. Det er en del af
    worker-API'et.
  - En vedvarende tilstand giver én alarm, når den opstår, ikke én pr. kontrol. Dead-letter
    giver én alarm pr. job.
  - En CloudWatch-alarm melder, hvis kontrollen er tavs i 15 minutter.
- **Retrieval-telemetri i appen:** én loglinje pr. retrieval med udfald, grad, uopfyldte
  betingelser og varighed pr. trin, aldrig forespørgsel eller indhold. Alarmerne er retrieval
  utilgængelig og runtime-fingeraftryk ≠ aktiv konfiguration. Hver alarmkode sendes højst én gang
  pr. 10 minutter pr. proces.
- **Admin:** afsnittet "Systemstatus" under Indstillinger viser kø, fejl, scanner, aktiv
  konfiguration og suspendering, seneste evaluering og regression samt performance. Det kræver
  `system.settings.manage`.
- **Ikke i I7:** rate limiting, samtalelagring og retention (8C) samt enterprise-dashboards.

**Overvejede alternativer:**
- *Evaluere mod produktionsdatabasen med en særlig rolle.* Fravalgt: evalueringsdokumenter må
  aldrig blandes med produktionsviden (§4.5), og evalueringsjobbet ville få en
  production-credential.
- *Lade motoren publicere i samme job.* Fravalgt: ét job ville holde både evalueringsprojektets
  service-role og produktionens publisher-credential. Desuden er en direkte databaseforbindelse
  kun tilladt i `workers/` (D-19).
- *Percentiler kun i motoren.* Fravalgt: databasen skal kunne efterprøve målingen på samme måde,
  som den genberegner gates.
- *En bestemt alarmtjeneste (SNS, Slack, PagerDuty) nu.* Fravalgt: Å-5 er åben. En webhook passer
  til e-mail-relæer, chatværktøjer og incident-værktøjer.
- *Alarm ved hver kontrol, så længe tilstanden varer.* Fravalgt: støj gør, at alarmer ignoreres.
- *En ny observability-leverandør.* Fravalgt: §14 siger logs hos hostingudbyderen og ingen ny
  leverandør.

**Begrundelse:** I6 gjorde det muligt at registrere en kørsel. I7 gør det muligt at frembringe
den sikkert, gentage den og opdage, når noget går tilbage. Det sker uden, at en evaluering kan
røre produktionsdata, og uden, at en alarm kan bære indhold ud af systemet.

**Udledt (til bekræftelse):**
1. *Ikke målt tæller som en afvigelse* (fail-closed). Et pilotkorpus under 2.000 sider kan
   derfor ikke måle korpusmålet, og målet skal godkendes som afvigelse.
2. *Performance måles i evalueringsmiljøet.* Netværksvejen dér kan afvige fra produktionens. I
   drift ses tallene i retrieval-loglinjen.
3. *Rate- og latency-alarmerne fra forslagskolonnen i §14 er ikke implementeret som alarmer.* Det
   gælder fejlrate over 5 % over 15 minutter, reranking p95 over 1 s og retrieval p95 over
   1,5 s. Grundlaget logges pr. kald, men tærsklerne kræver aggregering i logplatformen. Det er en
   deploymentbeslutning sammen med Å-5.
4. *Alarmens art følger kørslens erklærede tilstand* (`--mode`). Databasen afgør selv, om
   kørslen er en regression af konfigurationen i drift, og suspenderer og auditerer derefter.
   *Ændret i B-033 (8B-I7.1): alarmen følger databasens klassifikation. CI-jobbets mode er kun
   diagnostik.*
5. *Evalueringsmiljøets korpus bruger manifestets produkt-id'er*, som B-031 forudsatte. Pilotens
   manifest skal derfor bære produktionens id'er.
6. *Et blindt punkt i egress-arkitekturtesten er lukket.* Mønstret `options.fetch ?? fetch`
   blev ikke set som et netværkskald. Det gjaldt også den eksisterende
   `workers/ingestion/originals.ts`, som nu er eksplicit tilladt med begrundelse.

---

## B-031 — Stabil produktidentitet i pilot-scope (8B-I6.2); 8B-I6 lukket

**Dato:** 7. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.11,
`supabase/migrations/20261007000300_stable_pilot_scope.sql`,
`src/lib/knowledge/core/production-conditions.ts`, `evals/engine/runner.ts`

**Beslutning:**
- **8B-I6.1 er godkendt** (B-030).
- **Identitet:** pilot-scope binder til produktets stabile id (`knowledge.products.id`) og
  dokumenttypen, ikke til produktets navn.
- **Scope-element:** et element er `{ productId, productName, documentType }` (`reportSchema` 5).
  Kun `productId` og `documentType` afgør P3 og scope-hullerne. `productName` er navnet på
  evalueringstidspunktet og findes, så rapporten kan læses senere.
- **Omdøbning:** et omdøbt, evalueret produkt forbliver i området. Et nyt produkt med samme navn
  har et andet id og arver aldrig production-grad.
- **Historik:** kørslen (`evaluated_scope` og hele rapporten) og accepten er append-only og
  bevarer id og navn fra evalueringen. En omdøbning omskriver dem ikke.
- **Ikke ændret:** pilotreglen for usikkerhed, Q-tærskler, H1–H7, P1–P9, beslutningen om den
  tidlige pilot og definitionen af I7.
- **8B-I6 er lukket** med I6.1 og I6.2, når denne beslutning godkendes. Masterfase 8B er fortsat
  under implementering, fordi I7 mangler.

**Overvejede alternativer:**
- *Navnet som identitet (I6.1).* Fravalgt: det er fail-closed, men skrøbeligt. En omdøbning
  fjerner godkendelsen, og et genbrugt navn er kun spærret, så længe navnet er unikt.
- *En ny forretningsnøgle på produkter.* Fravalgt: id'et findes allerede og er stabilt. En ny
  nøgle ville kræve ændringer i den låste domænemodel.
- *Opdatere gamle kørsler til id'er.* Fravalgt: kørslerne er append-only, og en oversættelse fra
  navn til id ville være et gæt. Migrationen stopper i stedet, hvis sådanne kørsler findes. Der
  findes ingen uden for lokale tests.

**Begrundelse:** et produkts identitet må ikke afhænge af en tekst, som en administrator kan
ændre. Med id'et følger godkendelsen netop det produkt, der blev evalueret, og rapporten kan
stadig forklare, hvad det hed dengang.

**Udledt (til bekræftelse):** evalueringsmiljøets korpus skal bære produktionens produkt-id'er,
for eksempel som en kopi med samme id'er. Ellers er intet indhold i scope (fail-closed, P3).
Bindingen hører til evalueringsmiljøet i I7.

---

## B-030 — Pilot-usikkerhed, pilot-scope, tidlig Copilot-pilot, hostet pilotmiljø og definitionen af 8B-I7 (8B-I6.1)

**Dato:** 7. oktober 2026
**Område:** `docs/08b-production-foundation.md` §4.4 og §21.9–§21.10, `docs/roadmap.md` (fase 8,
8C, 18 og 21), `supabase/migrations/20261007000200_pilot_evaluation_policy.sql`,
`src/lib/knowledge/core/production-conditions.ts`, `evals/engine/runner.ts`

**Beslutning:**
- **8B-I6 er godkendt** i grundarkitektur og implementering (B-029). Fortolkningerne i §21.9 er
  godkendt: H6 bedømmer implementering og udbyderkvalitet, ikke P1–P9. En kandidat oprettes ved
  registreringen. `activate_embedding_model` kræver en godkendt konfiguration. CI-transporten fra
  evalueringsmotoren til `evaluation_publisher` hører til I7.
- **Hårde gates H1–H7** har nul tolerance i alle tiers og kan aldrig accepteres manuelt.
- **Tier pilot:** kvalitetsgates afgøres på punktestimatet mod de låste tærskler. Wilson-
  intervallerne beregnes, vises, gemmes og markeres fortsat. Består punktestimatet, men er et
  interval usikkert, får kørslen udfaldet `pass_with_uncertainty`. Den kan først bære en
  godkendelse og dermed aktiveres, når et menneske med `system.settings.manage` eksplicit har
  accepteret usikkerheden med en skriftlig begrundelse. Accepten sker aldrig automatisk.
  Accepten registrerer:
  - hvem og hvornår;
  - kørslen og konfigurationen;
  - det evaluerede område;
  - de usikre gates med værdi, tærskel og interval;
  - begrundelsen.

  Accepten er append-only og auditeres.
- **Tier standard er uændret:** Q1 forbliver 0,95. En usikker standard-kørsel
  (`insufficient_certainty`) kan hverken godkendes eller accepteres. Der er ingen manuel vej. Målet
  er fortsat mindst 100 spørgsmål med holdout før masterfase 18.
- **Pilot-scope:** en pilot-godkendelse gælder kun de par af produkt og dokumenttype, som
  evalueringskorpusset indeholdt.
  - Produktet identificeres ved sit eksakte, unikke navn. En omdøbning falder derfor ud af
    området (fail-closed). *Ændret i B-031: identiteten er produktets stabile id, og navnet er
    et øjebliksbillede.*
  - Der bindes ikke til chunk-id'er.
  - Hvert element i et EvidenceSet skal ligge inden for området (P3). Ellers er hele sættet
    `development`.
  - En produktfamilie, der aldrig er evalueret, arver derfor aldrig pilot-godkendelsen, heller
    ikke med samme dokumenttype.
  - Tier standard binder fortsat dokumenttyperne (§9).
  - Indhold uden for området blokerer ikke aktiveringen, men vises i Admin.
- **Kontrolleret Copilot-pilot:** den kommer efter 8C og er **ikke** masterfase 18. Den må kun
  bruge:
  - godkendt pilot-scope;
  - godkendte dokumenter;
  - navngivne autoriserede brugere;
  - tæt monitorering;
  - guardrails fra 8B og 8C.

  Masterfase 18 (Pilotversion) er uændret.
- **Hostet pilot-/staging-miljø:** et isoleret, hostet pilotmiljø må etableres før masterfase 21.
  Det er en forudsætning for den kontrollerede Copilot-pilot og for masterfase 18. Masterfase 21
  betyder den endelige produktion og go-live.
- **8B-I7 = "Evaluation Operations, Monitoring & Regression Guardrails"** er defineret i
  `docs/08b` §21.10, men ikke påbegyndt. Rate limiting, samtalelagring og retention hører
  fortsat til 8C, ikke I7.
- **Roadmap 1–21 er uændret** (B-019). Intet omnummereres, og der indsættes ingen masterfase.

**Overvejede alternativer:**
- *Sænke Q1 for pilot.* Fravalgt: tærsklerne er låst (D-6). Usikkerheden skal ses, ikke skjules.
- *Automatisk godkendelse af `uncertain` for pilot.* Fravalgt: usikkerheden skal være en bevidst
  menneskelig beslutning.
- *Binde scope til chunk-id'er eller dokument-id'er.* Fravalgt: det er for skrøbeligt, fordi hver
  ny version ville bryde det. Produkt og dokumenttype er den enkleste robuste model.
- *Afvise aktivering, når korpusset indeholder noget uden for området.* Fravalgt: det låser en
  afgrænset pilot, så snart der ligger andre produkter i korpusset. Håndhævelsen pr. element
  giver samme sikkerhed: indhold uden for området bliver aldrig production.
- *Lade den tidlige pilot være masterfase 18.* Fravalgt: roadmappen er låst (B-019).

**Begrundelse:** en lille pilot kan aldrig blive statistisk sikker med de låste tærskler (35 af
35 giver et nedre interval på 0,901). Beslutningen gør det muligt at starte en afgrænset pilot
uden at sænke standarden. Det sker kun med en navngiven menneskelig accept og kun på det område,
der faktisk er evalueret.

---

## B-029 — Register over retrieval-konfigurationer, evaluation_publisher og P1–P9 (8B-I6)

**Dato:** 7. oktober 2026
**Område:** `docs/08b-production-foundation.md` §9–§11 og §21.9,
`supabase/migrations/20261007000100_retrieval_configuration_registry.sql`,
`src/lib/knowledge/core/production-conditions.ts`, `src/lib/knowledge/core/evidence.ts`,
`evals/engine/publication.ts`

**Beslutning:**
- **Register:** materialet er konfigurationens eneste definerende kilde. De beskrivende kolonner
  er genereret af det. Konfigurationer, kørsler, gate-sæt og statushistorik ændres og slettes
  aldrig. Status ændres kun gennem funktioner efter en streng tilstandsmaskine, med højst én
  konfiguration i drift.
- **Publicering (D-18):** kun `evaluation_publisher_login`, med medlemskab af gruppen
  `evaluation_publisher`, kan registrere. Både TypeScript-publisheren og databasen genberegner
  rapporten fra observationerne. Databasen bruger samme kanoniske JSON.
- **Menneskelig beslutning:** godkendelse, aktivering, suspendering og udfasning kræver
  `system.settings.manage`. Der er ingen nye permissions. En godkendelse kræver afgørelsen
  `pass` (`uncertain` er ikke `pass`) og en årsagsnote for hver fejl.
- **P1–P9:** graden afledes ved hvert retrieval af de faktisk konstruerede implementeringer (med
  et runtime-bevis for production-implementeringer), databasens retrieval-kontekst og de
  faktiske parametre og elementer. EvidenceSet schemaVersion 2 (D-14).
- **Fortolkninger (§21.9):** scope på dokumenttyper, H6 bedømmer implementeringerne, krav om ny
  kørsel ved genaktivering, og chunker-bevis via P7.

**Overvejede alternativer:**
- *Genberegning kun i TypeScript.* Fravalgt: en kompromitteret eller fejlbehæftet klient ville
  kunne registrere et forkert resultat.
- *Graden som kolonne eller indstilling.* Fravalgt: forbudt af §9.
- *Automatisk fallback til en tidligere konfiguration ved suspendering.* Fravalgt: §10.2 og
  brugerens krav.
- *Ny permission til registret.* Fravalgt: `system.settings.manage` er den, specifikationen
  nævner.

**Begrundelse:** en administrator kan kun gøre evidens production gennem en bestået, registreret
kørsel og en godkendelse (exit-kriterium 12). Alt kan forklares bagefter med id'er, checksums og
fingeraftryk.

**Åbent:** en pilot på 30–50 spørgsmål er altid `uncertain` med de låste tærskler (§21.9). —
*Afgjort i B-030.*

---

## B-028 — ClamAV 1.4.6 i production, godkendte engine-versioner og adskilt engine-opgradering (8B-I5.6)

**Dato:** 6. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.8, `deploy/clamav/engine.json`, `deploy/clamav/Dockerfile`,
`.github/workflows/clamav-signatures.yml`, `.github/workflows/clamav-engine-candidate.yml`,
`supabase/migrations/20261006000200_approved_scanner_engines.sql`

**Beslutning:**
- **Version:** ClamAV 1.4 forbliver den valgte LTS-linje. Production opdateres fra 1.4.3 til
  1.4.6, den nyere security patch med rettelser af parser- og memory-safety-fejl i ældre 1.4.x.
- **Én versionsstyret kilde:** `deploy/clamav/engine.json` angiver LTS-linjen, production-version,
  godkendte versioner og base-imagets godkendte digest.
- **Guardrail:** databasen kender de godkendte engine-versioner i en tabel, som kun migrationer
  ændrer. Et verdict fra en ikke-godkendt eller tilbagetrukket ClamAV-engine bliver teknisk
  scanfejl og aldrig `safe`.
- **Adskillelse:** signaturopdateringen (automatisk hver 6. time) bygger altid den godkendte
  engine og kan ikke ændre den. En engine-opgradering er en manuel kandidat. Den skal bestå
  scanner-, EICAR-, clean-file- og PDF-/sikkerhedsfixtures og få et godkendt digest, før den kan
  udrulles.
- **Patch-politik:** ingen automatisk opgradering. En ny 1.4.x reviewes, bygges som kandidat,
  testes og godkendes som en ændring af `engine.json`, Dockerfilens default og en migrationsrække.

**Overvejede alternativer:**
- *Altid nyeste 1.4.x ved hver signaturbygning.* Fravalgt: en ny engine ville komme i production
  uden kandidattest.
- *1.4.6 hardkodet i workflowet.* Fravalgt: versionen skal være eksplicit, versionsstyret og
  kunne afløses uden kodeændringer i workflowet.
- *Engine-tjek kun i workeren.* Fravalgt: databasen afleder `safe` og skal derfor selv kende de
  godkendte engines.

**Begrundelse:** Scanneren læser fjendtligt input og skal køre den nyeste godkendte security
patch. Engine-opgraderinger må alligevel aldrig ske utestet eller ubemærket. Signaturer
opdateres ofte; engines skifter kun efter godkendelse.

---

## B-027 — ClamAV som separat service uden taskrolle, Cloud Map-endpoint og planlagt signaturimage (8B-I5.5)

**Dato:** 6. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.7, `deploy/clamav/`, `deploy/ingestion-worker/`,
`.github/workflows/clamav-signatures.yml`, `scripts/verify-clamav-scanner.ts`, `workers/ingestion/config.ts`,
`supabase/migrations/20261006000100_scanner_revision.sql`, `docs/07` (konsistensrettelse)

**Beslutning:**
- **ClamAV kører som egen ECS-service** (`ipa-clamav`), ikke som sidecar. Den har ingen
  taskrolle, ingen secrets, intet miljø, ingen offentlig IP, ingen ECS Exec og ingen
  internetadgang. Execution-rollen (ECS' egen) kan kun hente scanner-imaget og skrive dets logs.
- **Netværk:** kun workerens security group må forbinde, og kun på TCP 3310. Udgående trafik
  går kun via HTTPS til VPC-endpoints for ECR, logs og S3.
- **Service discovery:** Cloud Map med privat DNS `clamav.ipa-worker.internal`, hvor kun sunde
  tasks registreres. Workeren accepterer i produktion kun dette faste endpoint.
- **Signaturforsyning:** et planlagt workflow hver 6. time. Det bygger imaget med officielle
  signaturer (pinned ClamAV 1.4.3; opdateret til 1.4.6 i B-028) og verificerer kandidaten: frisk (højst 8 t), EICAR findes, en
  ren fil er ren. Derefter pushes det med et uforanderligt tag lig scanner-revisionen, og der
  udrulles med digest. Den kørende scanner henter intet.
- **Fejlet opdatering:** den gamle scanner bliver, alarmerne udløses (workflow,
  `SERVICE_DEPLOYMENT_FAILED`, signaturalder over 18 t, tekniske scanfejl), og 24-timersgrænsen
  stopper `safe` af sig selv. Der findes intet flag til at ignorere forældede signaturer.
- **Sporbarhed:** `security_verdicts.scanner_revision` afledes af engine og signaturversion og er
  lig med ECR-tagget.
- **`docs/07`** er rettet snævert, så upload/storage-flowet viser intake → sikkerhedskontrol →
  originals. Fase 7 er ikke genåbnet.

**Overvejede alternativer:**
- *Sidecar (B-026).* Fravalgt: en ECS-taskrolle gælder hele tasken.
- *ECS Service Connect.* Fravalgt: proxy-container i begge tasks.
- *Intern NLB.* Fravalgt: flere dele og omkostninger uden ny sikkerhed.
- *freshclam i den kørende container, også via et privat spejl.* Fravalgt: kræver udgående
  trafik fra den komponent, der parser fjendtligt input.
- *Opdatering hver 12. time.* Fravalgt: én mislykket kørsel kunne efterlade over 24 timer gamle
  signaturer. Seks timer tåler én fejl.
- *Scanner-revision fra workerens miljø.* Fravalgt: workeren og scanneren udrulles uafhængigt.
  Revisionen afledes i stedet af det, scanneren selv rapporterer.

**Begrundelse:** Den komponent, der læser fjendtlige filer, har nu ingen AWS-credentials og ingen
vej ud. Signaturernes friskhed sikres af en kontrolleret pipeline og håndhæves stadig af
24-timersgrænsen i worker og database.

---

## B-026 — Upload-sikkerhed: karantæne-bucket, verdict afledt i databasen, checksum-binding og ClamAV som sidecar (8B-I5)

**Dato:** 5. oktober 2026
**Område:** `docs/08b-production-foundation.md` §7 og §21.6, `supabase/migrations/20261005000100_upload_security.sql`,
`workers/ingestion/security/`, `workers/ingestion/scan-job.ts`, `supabase/functions/worker-storage/`, `deploy/clamav/`

**Beslutning:**
- **Tre buckets:** `knowledge-intake` (karantæne, kun upload), `knowledge-originals` (kun
  frigivne filer) og `knowledge-quarantine` (afviste, ingen politikker). Kun lagerfunktionen
  flytter, på en engangsbillet.
- **Tilstandsmaskine i databasen** (`security_state`), håndhævet af en trigger for alle roller.
  Kun databasens egne funktioner ændrer den. `processed`/`published` kræver `released`.
- **Workeren måler, databasen afgør.** `safe` afledes i `worker_record_security_verdict` ud fra
  strengt validerede målinger. Et verdict er uforanderligt og bundet til version, sti, checksum
  og politikversion.
- **Checksum-binding hele vejen:** frigivelsen bekræftes med checksummen af de flyttede bytes, og
  release-gaten spørges med checksummen af de hentede bytes. Afvigelse afløser verdict og sender
  versionen tilbage i karantæne.
- **Rækkefølge:** byteniveau-validering → ClamAV → strukturinspektion med egen læser i en isoleret
  børneproces. pdfjs ser først bytes efter `safe`, og krydstjekker da sit eget syn.
- **ClamAV som sidecar** med signaturer bygget ind i imaget (ingen netværksafhængighed i
  containeren). Signaturer ældre end 24 timer giver intet nyt `safe`.
- **Lokal udvikling** bruger samme gate; en udviklingsscanner accepteres kun via en seed-række.
- Versioner fra før I5 er `legacy_unscanned` og kan ikke behandles eller re-embeddes uden
  genscanning.

**Overvejede alternativer:**
- *Statusfelt sat af workeren.* Fravalgt: en kompromitteret eller fejlbehæftet worker kunne
  erklære en fil sikker. Databasen afleder nu verdict og kontrollerer målingerne igen.
- *pdfjs som inspektionslag før verdict.* Fravalgt: strider mod reglen om, at ingen bytes når
  pdfjs før `safe`.
- *Én bucket med statusflag.* Fravalgt: en læsepolitik-fejl ville eksponere ufrigivne filer.
  Separate buckets gør grænsen fysisk.
- *Signaturopdatering i containeren (freshclam mod internettet).* Fravalgt: kræver udgående
  trafik fra den komponent, der parser fjendtligt input.
- *ClamAV som separat ECS-task uden rolle og uden udgående trafik.* Stærkere isolation, men bytes
  ville gå over VPC-netværket (clamd har ingen TLS), og du angav sidecar. **Åben konflikt:** en
  ECS-taskrolle gælder hele tasken, så sidecaren deler workerens taskrolle (i dag kun
  `bedrock:InvokeModel` på Embed v4) og taskens udgående 443. Kravet "ingen unødvendige
  task-rolle-rettigheder" kan derfor ikke opfyldes fuldt med en sidecar. **Løst i B-027:** ClamAV
  er flyttet til en separat service uden taskrolle.

**Begrundelse:** En fil når kun parser, chunker og embedder, hvis databasen har frigivet netop de
bytes, der blev scannet, under den aktive politik. Hver beslutning, der kan gøre en fil sikker,
ligger dér, hvor ingen klient og ingen worker kan ændre den.

---

## B-025 — Workerens runtime: specifikation uden IaC-framework, streamet billetindløsning og standby bag I5-gaten (8B-I4)

**Dato:** 5. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.5, `workers/ingestion/`, `deploy/ingestion-worker/`,
`supabase/functions/worker-storage/`

**Beslutning:**
- **Deployment:** en versionsstyret specifikation i `deploy/ingestion-worker/` (Dockerfile,
  ECS-task og -service, security group, IAM og runbook) i stedet for et IaC-framework, som
  projektet ikke har valgt.
- **Secrets:** ECS' indbyggede secret-injektion fra AWS Secrets Manager. Den aktive blue/green-
  rolle er den, som secretens aktuelle version peger på.
- **Database:** postgres.js mod Supavisor i transaktionstilstand med TLS, `prepare: false`,
  `fetch_types: false` og en pulje på 2.
- **Edge Function `worker-storage`:** streamer bytes fra det ene objekt, billetten giver adgang
  til. Den returnerer ingen signeret URL.
- **Produktion med lukket gate:** workeren forbinder, kontrollerer sin identitet og står standby.
  Den tager ingen jobs, indtil 8B-I5 er godkendt. Pipelinen afviser derudover ethvert job før
  download og alle bytes før parsing.
- **Image:** eget dependency-manifest (`postgres`, `pdfjs-dist`) uden valgfrie pakker, kørt som
  ikke-root på et skrivebeskyttet rodfilsystem.

**Overvejede alternativer:**
- *Terraform, CDK eller Pulumi.* Fravalgt uden særskilt godkendelse: det ville være et nyt
  arkitekturvalg.
- *Egen Secrets Manager-klient i workeren.* Fravalgt: kræver mere kode og en bredere task-rolle.
  ECS-injektion er enklere og holder secreten ude af task-rollen.
- *Signeret URL fra funktionen.* Fravalgt: den kan bruges af alle, der har den, så længe den
  gælder. Streaming lader intet genbrugeligt forlade funktionen.
- *Fejle hvert job i produktion før I5.* Fravalgt: rigtige dokumenter ville blive markeret som
  "kunne ikke behandles". Standby lader køen være urørt.
- *Fuld rod-`node_modules` i imaget.* Fravalgt: Next.js, React og Supabase-SDK'en hører ikke
  hjemme i workeren.
- *`@napi-rs/canvas` i imaget.* Fravalgt: 63 MB native kode uden betydning for tekstudtrækket,
  som er verificeret identisk.

**Begrundelse:** Runtime, identitet og nedlukning er klar og testet, uden at rigtige dokumenter
kan nå parser eller embedder før I5. Ingen credential ligger i repo, image eller logs.

---

## B-024 — Workerens databaseidentitet realiseres med lease-token og driftsfunktioner (8B-I3)

**Dato:** 3. oktober 2026
**Område:** `docs/08b-production-foundation.md` §6.1.1 og §21.4, migration
`20261003000200_ingestion_worker_identity.sql`, `supabase/seed.sql`, `workers/ingestion/`

**Beslutning:** D-10 og D-20 realiseres på databasesiden sådan:
- Rollerne er gruppen `ingestion_worker` og login-rollerne `ingestion_worker_login_blue` og
  `ingestion_worker_login_green` (navnene fra §6.1.1). Migrationen opretter dem NOLOGIN, uden
  password og uden medlemskab. Kun runbookens driftsfunktioner (`ops.ingestion_worker_*`)
  aktiverer og deaktiverer dem.
- Hver `worker_*`-funktion kontrollerer den faktiske databaseidentitet (session_user eller den
  aktive SET ROLE) og medlemskab af `ingestion_worker` ved hvert kald.
- Workerens kald på et job kræver en lease-token fra `worker_claim_job`. Kun en hash, bundet til
  jobbet, gemmes. Parameteren `p_worker` er kun en etiket.
- service_role har ikke længere EXECUTE på worker-API'et. Lokalt får den medlemskab af
  `ingestion_worker` fra `supabase/seed.sql` (development-only), og workeren nægter at starte med
  service-rolle-nøglen uden for local/test.
- En deaktiveret rolles password fjernes (`password null`) i stedet for at blive erstattet af en
  tilfældig værdi.
- Der er ingen særskilt release-funktion. `worker_fail_job` med genforsøg frigiver et job, og en
  lease, der ikke fornyes, udløber og overtages.

**Overvejede alternativer:**
- *Job-id og worker-etiket som bevis (fase 7).* Fravalgt: etiketten er en parameter, som enhver
  kalder kan angive.
- *Et særskilt udviklingsflag i en tabel for service_role.* Fravalgt: medlemskab af gruppen er
  den samme kontrol som i produktion og kan ses i `ops.ingestion_worker_status()`.
- *Standardrettigheder uden PUBLIC EXECUTE for migrationsrollen.* Fravalgt: det kan kun gøres
  globalt og ville ændre adfærden for alle senere migrationer og eksisterende pgTAP-hjælpere.
  pgTAP kontrollerer i stedet, at workeren kan køre præcis det godkendte API, og at ingen
  funktion i `knowledge`, `public` eller `ops` er eksekverbar for PUBLIC.
- *Et tilfældigt password ved deaktivering.* Fravalgt: `password null` gør login umuligt uden en
  værdi, nogen kunne gemme, og ingen password passerer gennem SQL.

**Implementeringsnote (8B-I4, B-025):** Klientsiden er realiseret med postgres.js
(`workers/ingestion/db.ts`) og Edge Function `worker-storage`. API'et og rollerne er uændrede.

**Begrundelse:** Databasen håndhæver selv, hvem der er workeren, og hvilket job der må røres.
Nødspærring virker ved næste kald, også på en forbindelse, som pooleren har holdt åben. Ingen
production-credentials ligger i repoet.

---

## B-023 — Admin-værktøjet "Afprøv retrieval" redigerer ikke forespørgslen (låst for 8B)

**Dato:** 3. oktober 2026
**Område:** `docs/08b-production-foundation.md` §21.3 pkt. 8, `src/lib/knowledge/admin-actions.ts`

**Beslutning:** Dette er den låste beslutning for fase 8B:
- Værktøjet redigerer ikke administratorens forespørgsel automatisk for at gøre den egnet til
  ekstern behandling. Den oprindelige forespørgsel bevares uændret.
- Værktøjet virker fortsat med in-process-, lokal- og test-retrieval.
- Bruger retrieval en ekstern embedding- eller reranking-udbyder, gælder den normale
  egress-politik. En forespørgsel uden tilladt proveniens eller datakategori afvises
  (fail-closed).
- Der er ingen "send alligevel", "markér som sikker" eller tilsvarende tilsidesættelse.
- Automatisk redaction må ikke blive en skjult vej til ekstern AI-behandling.
- Evaluering af production-providere sker først med kontrolleret evalueringsmateriale, ikke med
  vilkårlige forespørgsler fra Admin.

**Overvejede alternativer:**
- *Automatisk redaction af forespørgslen.* Fravalgt: den ville gøre vilkårlig fri tekst egnet til
  ekstern behandling uden en godkendt politik for det.
- *En tilsidesættelse for administratorer.* Fravalgt: den ville omgå egress-politikken.

**Begrundelse:** Grænsen fra B-022 skal gælde uden undtagelser. Kvaliteten af production-providere
måles med det kontrollerede evalueringsmateriale (§4, §5).

---

## B-022 — Kundedata-spærren gælder alle eksterne AI-kald (ekstern AI-datagrænse)

**Dato:** 3. oktober 2026
**Område:** `docs/08b-production-foundation.md` §8 og §21.3, `docs/08-ai-gateway.md` §5.2,
`src/lib/egress/`, migration `20261003000100_external_ai_boundary.sql`

**Beslutning:**
- Kundeidentificerbare data må ikke forlade platformens godkendte trust boundary til en ekstern
  AI-udbyder uden en senere, eksplicit godkendt politik.
- D-13/K-9 gælder derfor alle eksterne AI-kald: modelgenerering, forespørgsels-embedding,
  dokument-embedding og reranking. Det håndhæves af én central egress-policy, som alle eksterne
  provider-kald skal passere før transmission, og som transporten kontrollerer igen.
- Altid afvist:
  - fri tekst fra kundesager og sagsbunden tekst, også efter redaction
  - `customer_identifiable`, `audit_access` og `unknown`
  - manglende proveniens og brugertekst uden redaction
- Databasen tillader kun `deny` for `customer_identifiable` (lag L4).
- EU-hosting, administratorkonfiguration og provider-descriptors kan ikke ændre det.

**Overvejede alternativer:**
- *En invariant pr. adapter.* Fravalgt: en ny adapter kunne glemme den. Én central policy, en
  transport, der kræver autorisationen, og arkitekturtests gør det svært at komme uden om.
- *Redaction som adgang for kundedata til embedding.* Fravalgt: redaction finder ikke navne i fri
  tekst og er ikke valideret mod et testsæt (§8.3).

**Begrundelse:** Hullet blev fundet i 8B-I2: forespørgsels-embedding og reranking sender
brugerens tekst til en ekstern udbyder, og invarianten i `invokeModel` dækkede kun selve modelkaldet.
Ændringen er en sikkerhedsstramning og ikke en åbning for kundedata.

---

## B-021 — Passage Recall bruger de påkrævede passager som et sæt

**Dato:** 3. oktober 2026
**Område:** `docs/08b-production-foundation.md` §4.2 og §21.1, `evals/engine/`, `evals/retrieval/README.md`

**Beslutning:** Passage Recall@K tæller et spørgsmål, når alle påkrævede passager (grad 3) er dækket
inden for K. Rækkefølgen af passager i facit har ingen betydning. Det præciserer "den primære
forventede passage (grad 3)" i §4.2 og afløser I1's fortolkning "den første passage med grad 3".
Der er intet nyt felt i spørgsmålsformatet, så eksisterende fixtures er uændrede, og rapportskemaet
er hævet til 2.

**Overvejede alternativer:**
- *Et eksplicit felt `primary: true` på én passage.* Fravalgt: endnu et felt, som forfatteren kan
  glemme. Et spørgsmål med flere lige vigtige passager kan ikke udtrykkes. Graden udtrykker allerede,
  hvad der er påkrævet.

**Begrundelse:** Resultatet afhænger ikke af en tilfældig rækkefølge i facit, og en test viser, at
omvendt rækkefølge giver identiske tal. For spørgsmål med én passage med grad 3 er tallet det samme
som før.

---

## B-020 — 8B-specifikationen er godkendt og låst

**Dato:** 3. oktober 2026
**Område:** `docs/08b-production-foundation.md` (hele dokumentet), `docs/roadmap.md`, `CLAUDE.md`,
`README.md`

**Beslutning:** Specifikationen for 8B — Produktionsgrundlag er godkendt og låst. Det gælder
specifikationen, ikke implementeringen, som kræver en særskilt godkendelse. Alle beslutninger
D-1–D-20 i specifikationens §19 er godkendt. De sidste, der blev godkendt, er:

- **D-6 — gates:** H1–H7 er hårde sikkerhedsgates med nul tolerance. Q1–Q7 er de initiale
  kvalitetstærskler. De ligger i et versionsstyret gate-sæt og kan kun rekalibreres gennem en ny,
  versionsstyret og eksplicit godkendt evalueringsbaseline. De hårdkodes ikke som uforanderlige
  domæneregler. Under 100 evalueringsspørgsmål er en godkendelse `tier: pilot`.
- **D-10 — workerens identitet:**
  - AWS ECS Fargate med direkte Postgres-forbindelse via Supavisor.
  - Dedikeret LOGIN-rolle `ingestion_worker_login`, uden tabelrettigheder og med kun `EXECUTE` på
    godkendte `knowledge.worker_*`.
  - Workeren kan ikke godkende eller publicere.
  - Netværksbegrænsning til NAT'ens faste IP og credentials i AWS Secrets Manager.
  - Ingen production-service-rolle i workeren.
- **D-15 — alarmer:** en abstrakt `AlertSink`. Domænemodellen bindes ikke til en konkret kanal.
- **D-18 — `evaluation_publisher`:** administratorer kan ikke fremstille eller rette en
  evalueringskørsel.
- **D-19 — dependency:** `postgres` (postgres.js) er den specificerede dependency i workeren ved
  implementeringen. Den er ikke installeret endnu.
- **D-20 — rotation:**
  - En planlagt rotationscyklus på højst 90 dage i V1.
  - Rotationen sker blue/green mellem to dedikerede login-roller: klargør, flyt kontrolleret,
    verificér og deaktivér den gamle. Skiftet afhænger derfor ikke af, at Supavisor holder op
    med at cache den gamle credential.
  - Nødspærring sker straks med fjernet medlemskab, `NOLOGIN` og afbrudte sessioner.
- **K-9 — kundedata:** de fem lag L1–L5 er godkendt som en tilladt sikkerhedsstramning af 8A.
  - Fri tekst fra kundesager når ikke en ekstern model.
  - Et fejlende eller manglende redaction-trin fører aldrig til et modelkald.
  - Almindelig administratorkonfiguration kan ikke slå guardrailen fra.

**P1–P9** (§9) er source of truth for, hvornår et EvidenceSet får `grade = production`:
- `production` er aldrig et manuelt flag.
- Graden beregnes ud fra den aktive, godkendte retrieval-konfiguration og dens fingeraftryk og
  evalueringsstatus.
- Runtime skal matche den evaluerede konfiguration.
- En betingelse, der ikke kan afgøres, giver `development`.
- En hård gate, der fejler i regression, suspenderer konfigurationen.

De åbne spørgsmål Å-1–Å-6 forbliver åbne og blokerer ikke specifikationen. Å-2
(databehandleraftaler) er fortsat et exit-kriterium før reel produktionsbrug.

**Overvejede alternativer:**
- *Service-rollen i workeren, eller egne roller via JWT.* Fravalgt, fordi blast radius bliver hele
  projektet, og den, der kan signere, også kan udstede `service_role` (§6.1.1).
- *Kvalitetstærskler som faste konstanter.* Fravalgt, fordi de skal kunne kalibreres mod en
  voksende baseline uden at gå på kompromis med sporbarheden.
- *Rotation ved at skifte password på den aktive rolle.* Fravalgt, fordi poolerens cache gør
  skiftet uforudsigeligt.

**Begrundelse:** Hver beslutning kan efterprøves med tests og exit-kriterier (§16–§17).
Ingen vej til `grade = production` går uden om en bestået, registreret evaluering og en
menneskelig godkendelse.

---

## B-019 — Master-roadmappen med 21 faser er låst; fase 8 opdeles i 8A, 8B og 8C

**Dato:** 3. oktober 2026
**Område:** `docs/roadmap.md`, `CLAUDE.md` §1–§5, `docs/07` §20.6, `docs/08`, `docs/03` §10,
`docs/06` §6, `README.md`

**Beslutning:**
- Den oprindelige roadmap med 21 faser er projektets permanente master-roadmap og er låst:
  1 Produktdefinition, 2 Informationsarkitektur, 3 Teknisk arkitektur, 4 UI/UX-design,
  5 Grundplatform, 6 Identity, database og adgangskontrol, 7 Knowledge Engine, 8 AI Copilot,
  9 Learn, 10 Practice, 11 Advise, 12 Assessment, 13 Personlig AI og læringsprofil, 14 Admin,
  15 Analytics, 16 Kvalitet og guardrails, 17 Test, 18 Pilotversion, 19 Feedback,
  20 Enterprise-version og 21 Produktion.
- Masterfase 8 — AI Copilot opdeles i underfaser:
  - **8A — AI Gateway** (det, der hed fase 8): gennemført og låst.
  - **8B — Produktionsgrundlag** (det, der hed fase 9): ikke specificeret eller godkendt.
  - **8C — Copilot klar til brug** (det, der hed den foreslåede fase 10, "Copilot i
    produktion"): ikke specificeret eller godkendt. Navnet er ændret, så det ikke forveksles
    med masterfase 21 Produktion.
- **Roadmap-regel:** underfaser må foreslås under en masterfase, når den tekniske kompleksitet
  kræver det. Uden eksplicit godkendelse må ingen masterfase fjernes, omnummereres eller
  erstattes, der må ikke indsættes en ny masterfase mellem de eksisterende, og et oprindeligt
  hovedområde må ikke flyttes til et andet nummer. Reglen står i `docs/roadmap.md` og
  `CLAUDE.md` §2.
- Fasehenvisningerne i de låste `docs/07` og `docs/08` er rettet fra fase 9/10 til 8B/8C. De
  seks uoverensstemmelser fra roadmap-auditten er rettet. Det genåbner ingen faglige eller
  tekniske beslutninger i de låste faser.

**Baggrund:** Roadmap-auditten (2026-10-03) viste, at den 21-fasede roadmap aldrig havde
stået i repoet. Roadmappen viste kun de faser, der var besluttet, og derefter "N+ Ikke
fastlagt". Faserne 9–21 var derfor fraværende uden en beslutning, og det indsatte
produktionsgrundlag og Copilot-trin skubbede nummereringen.

**Overvejede alternativer:**
- *A) Ny nummerering med indsatte faser.* Fravalgt: de oprindelige faser 8–21 ville flytte
  mindst to pladser og miste forbindelsen til planen.
- *B) Produktionsgrundlaget som en del af fase 7/8.* Fravalgt: det ville genåbne godkendte og
  låste faser som ufærdige.

**Begrundelse:** Underfaser bevarer de oprindelige numre og alt låst indhold. De viser, at
gateway og produktionsgrundlag er forudsætninger for en rigtig Copilot.

---

## B-018 — Fase 8 godkendt; rettelsen af retrieveEvidence bekræftet

**Dato:** 3. oktober 2026
**Område:** `docs/08-ai-gateway.md` §18; `docs/07-knowledge-engine.md` §4.1; `docs/roadmap.md`

**Beslutning:** Fase 8 — AI Gateway er godkendt og låst. Rettelsen i `docs/08` §18.2 pkt. 1 er
bekræftet som den er: `retrieveEvidence` kræver en aktiv session og ikke rollerettigheden
`knowledge.document.read`. Databasen afgør adgangen pr. version og kører som den kaldende
bruger, og inaktive brugere får ingen session. Tre punkter uden for fase 8 skrives ind i
roadmap: forudsætningen om redaction og kundedata i fase 9, samtalelagring og rate limiting i
den foreslåede fase 10.

**Overvejede alternativer:**
- *At beholde rollekravet.* Fravalgt: det ville have afvist alle andre end administratorer,
  hver gang en AI-funktion søgte på en brugers vegne, i strid med `docs/07` §4.1.

**Begrundelse:** Rettelsen bringer koden i overensstemmelse med den låste specifikation frem
for at omgå den.

**Bemærkning (B-019):** "Fase 8" er nu 8A, "fase 9" er 8B, og "den foreslåede fase 10" er 8C.

---

## B-017 — Matricen i databasen, profilerne i repoet

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §4, §5.2

**Beslutning:** Datakategori-matricen ligger i databasen, og workflow-profilerne ligger i
repoet. Enhver ændring i matricen auditeres med hvem, hvad og hvornår. Matricen er fail-closed:
hvad der ikke står, er forbudt.

**Overvejede alternativer:**
- *Begge i repoet.* Fravalgt: en politikændring ville kræve en udrulning og kunne ikke
  revideres som en handling i systemet.
- *Begge i databasen.* Fravalgt: prompts og output-kontrakter hører sammen med koden, der
  validerer dem, og skal gennemgås som kode.

**Begrundelse:** Matricen styrer, hvilke data der forlader platformen. Den er politik og skal
kunne ændres og revideres. Profilerne er kode.

---

## B-016 — Et svar, der ikke kan kontrolleres mod kilderne, vises aldrig

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §4.3, §4.4

**Beslutning:** Bryder modellens svar output-kontrakten, vises det ikke, heller ikke med en
advarsel. Brugeren får at vide, at systemet ikke kunne give et svar, der kan dokumenteres, og
ser de kilder, der blev fundet. Det er en fjerde tilstand med egen formulering og eget
udseende, adskilt fra "utilstrækkelig dokumentation" og fra systemfejl. Den logges, fordi
gentagelser betyder, at noget er galt med prompten eller modellen.

**Overvejede alternativer:**
- *At vise svaret med en advarsel.* Fravalgt: folk læser svaret og overser advarslen.
- *At vise det som "utilstrækkelig dokumentation".* Fravalgt: dokumentationen fandtes. Modellen
  brugte den ikke rigtigt.
- *At vise det som systemfejl.* Fravalgt: systemet virkede, og kilderne kan bruges.

**Begrundelse:** Et fagligt svar, der ikke kan dokumenteres, må ikke nå en bruger, der handler
på det. Kilderne er stadig nyttige.

---

## B-015 — Under et AI-rollespil låses AI, ikke moduler

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §9.1

**Beslutning:** Under et aktivt AI-rollespil låses al brugerrettet AI undtagen rollespillet
selv. Det omfatter Copilot, AI i Learn (forklaringer og eksempelgenerering), Advise-AI og
Practice-feedback. Learn og Advise forbliver tilgængelige som moduler.

**Overvejede alternativer:**
- *Kun Copilot låses* (ordlyden i `docs/02` §5). Fravalgt: AI i Learn svarer også for brugeren.
- *Learn og Advise låses som moduler.* Fravalgt: at læse op i Learn er læring, ikke snyd, og man
  kan alligevel ikke forhindre nogen i at slå op i en bog. Advise er en anden arbejdsopgave.

**Begrundelse:** Copilot er en genvej, fordi den svarer for brugeren. Det gælder al AI, der
svarer, ikke at læse.

---

## B-014 — AI-loggen deler indhold fra metadata

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §11; `docs/03` §11 og §13

**Beslutning:** Modstriden mellem `docs/03` §11 ("AI-samtaledata: Egen") og §13 (kvalitetsanalyse)
afgøres ved at skelne:
- **Indhold** (spørgsmål og svar i fri tekst): kun brugeren selv. En samtale ført inde i en
  kundecase følger kundecasens adgangsregler, ikke AI-domænets.
- **Metadata** (dokumenter, chunks, evidensgrad, svartid, fejl, utilstrækkeligt grundlag): kan
  læses af administratorer til kvalitetsarbejde.
- **Videnshuller:** spørgsmålsteksten må nå administratorer, men aldrig fra en samtale bundet
  til en kundecase. Derfra kommer kun det nøgne faktum, at grundlaget manglede.

Skemaet bygges med opdelingen nu. Administratorers læseadgang er slået fra i fase 8 og kan slås
til før produktion uden en migration. Enhver administrators læsning af AI-data logges i audit,
ligesom individniveau i Analytics. Til læsningen indføres permissionen `ai.quality.read`
(udledt: adgang styres af permissions, ikke rollenavne. `docs/03` §17 pkt. 6).

**Overvejede alternativer:**
- *Kun brugeren selv for alt.* Fravalgt: ingen kan da arbejde med kvaliteten eller med
  videnshuller.
- *Administratorer læser alt.* Fravalgt: indholdet kan indeholde kundedata, og
  administratorrettigheder giver ingen adgang til kundecases (`docs/03` §10).

**Begrundelse:** Dataminimering anvendt på loggen selv. Kvalitetsarbejde kræver maskineriet,
ikke indholdet. Fejlen var i `docs/03`, som er låst. Afgørelsen står her og i `docs/08`.

---

## B-013 — Minimale tilstandstabeller til gating oprettes i fase 8

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §9.2; `docs/03` §4

**Beslutning:** `assessment.assessment_attempts` og `practice.roleplay_sessions` oprettes i fase
8 med kun de felter, gatingen har brug for: id, bruger, status, start, slut og tidsgrænse.
Ingen spørgsmål, besvarelser eller bedømmelse. De dokumenteres som et bevidst minimum, så den
senere fase udvider tabellerne frem for at bygge dem om.

**Overvejede alternativer:**
- *En låsetabel i `ai`.* Fravalgt: en anden sandhed om, hvorvidt et forsøg er i gang.
- *Gating uden datakilde, testet med stubbet tilstand.* Fravalgt: håndhævelsen ville ikke være
  verificeret mod databasen.

**Begrundelse:** Gating er en del af fase 8 og kan ikke virke uden at kunne læse, om et forsøg
eller et rollespil er i gang. Det er at bygge det, fase 8 kræver, ikke at bygge forud.

---

## B-012 — En production-model må kun tage imod production-evidens

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9.1 pkt. 4 og §20.6; `docs/08-ai-gateway.md` §3.3

**Beslutning:** `docs/07` §9.1 er genåbnet for én sætning. "Senere AI-moduler og AI Gateway må
kun tage imod `ProductionEvidenceSet`" er præciseret til "En production-model må kun tage imod
`ProductionEvidenceSet`". En udviklingsmodel (kun `local`/`test`) må tage imod
udviklingsevidens. Kravet: ændringen må ikke kun stå i dokumentationen. Det skal være umuligt i
koden for en production-model at modtage udviklingsevidens. Registret er fail-closed, så et
ukendt miljø tælles som produktion. Det dækkes af både en test og en mutationstest, samme
standard som den eksisterende guardrail. Samtidig er henvisningen i `docs/07` §20.6 rettet fra
fase 8 til fase 9. Resten af `docs/07` er urørt.

**Overvejede alternativer:**
- *Reglen ordret.* Fravalgt: gatewayen kunne ikke køre en eneste forespørgsel med evidens, før
  der findes production-evidens (fase 9).

**Begrundelse:** Formålet med reglen er at forhindre, at svagt kildegrundlag når frem til en
bruger, der handler på det. Det er parringen production-model og udviklingsevidens, der er
farlig. Udviklingsmodel og udviklingsevidens ser ingen bruger.


**Bemærkning (B-019):** "Fase 8" i denne beslutning er nu 8A, og "fase 9" er 8B.

---

## B-011 — Fase 8 bliver AI Gateway; udbydervalget udskydes til fase 9

**Dato:** 2. oktober 2026
**Område:** `docs/roadmap.md`, `docs/08-ai-gateway.md`

**Beslutning:** Fase 8 er AI Gateway uden ekstern AI-udbyder. Det tidligere forslag til fase 8
(embedding- og reranking-udbyder, evalueringssæt, virusscanning, worker i produktion) flyttes
uændret til fase 9. Analysen af udbydere og brugerens svar om EU-krav, omfang og volumen
gemmes i fase 9's beskrivelse i roadmap. I fase 8 kaldes ingen rigtig model. Der bruges en
stub-model efter mønstret fra test-embedderen. Specifikationen skal godkendes før
implementering.

**Overvejede alternativer:**
- *At vælge udbydere først (det oprindelige forslag til fase 8).* Udskudt: gatewayen skal
  bygges uanset udbyder og kan testes uden en.

**Begrundelse:** Gatewayen afgør, hvilke kundedata der forlader platformen. Politikken skal
ligge fast og være testet, før en ekstern model kobles på.

**Bemærkning:** Henvisningen til "fase 8" i `docs/07` §20.6 er rettet til fase 9 ved B-012.
Ved B-019 blev fase 8 til 8A og fase 9 til 8B, og henvisningen peger nu på 8B.

---

## B-010 — Konfliktkandidater vises i bekræftelsesdialogen

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §3.2, §11.2 og §20.2; `docs/04` §14.2

**Beslutning:** Skaber en godkendelse en konflikt med en allerede autoritativ kilde, står det i
dialogen "Godkend som autoritativ" som en konsekvens af godkendelsen. Fremstillingen er den
samme neutrale som i konfliktkøen: begge kilder nævnes, og der anbefales ingen af dem.
Konflikten blokerer ikke godkendelsen (B-11). Den oplyses kun tydeligt.

**Overvejede alternativer:**
- *Kun at vise kandidaten i kvalitetsrapporten.* Fravalgt: dialogen skal opsummere
  konsekvensen, og en ny konflikt er netop en konsekvens.
- *At blokere godkendelsen.* Fravalgt: i strid med B-11. Konflikter afgøres af et menneske
  bagefter.

**Begrundelse:** Efter godkendelsen viser platformen rådgivere to forskellige svar om samme
regel. Det skal den godkendende vide i det øjeblik, beslutningen træffes.

---

## B-009 — Ingen nøgleordsregel; "utilstrækkeligt grundlag" kan fremtvinges i udvikling

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9 og §20.4

**Beslutning:** `none`-rerankeren ændres ikke, og der indføres intet krav om leksikalsk træf.
I stedet findes udviklingsværktøjet "Fremtving utilstrækkeligt grundlag" i "Afprøv
retrieval". Det udsteder et tomt, markeret EvidenceSet uden at køre retrieval og uden at røre
scoringen. Det kan kun bruges, når `IPA_RUNTIME_ENV` udtrykkeligt er `local` eller `test`. Det
er et valg pr. kald og ikke en indstilling, og resultatet kan aldrig blive production-evidens.
I udvikling kan tilstanden kun fremtvinges og ikke opstå af sig selv, før en rigtig reranker
er på plads.

**Overvejede alternativer:**
- *At sende RRF-scorerne urørt videre.* Fravalgt: RRF er rangbaseret, og den bedste kandidat
  får altid samme score. Tærsklen ville stadig ikke kunne tømme resultatet.
- *Et krav om mindst ét leksikalsk træf.* Fravalgt: det ændrer retrieval-semantikken
  permanent for at løse et udviklerproblem og risikerer på dansk, med sammensatte ord og
  bøjninger, at afvise spørgsmål, der kan besvares. Relevans er rerankerens opgave.

**Begrundelse:** Brugerfladen for "Der findes ikke tilstrækkelig dokumentation" skal kunne
ses og bygges, før der findes en rigtig reranker, uden at udviklingsmiljøet opfører sig
anderledes end produktion på scoringen.

---

## B-008 — Retrieval-tallene skal valideres, før production-evidens må bruges

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9, §8.3 og §20.4

**Beslutning:** Tallene for reranking og evidensudvælgelse er ikke validerede. Test-embedderen
giver altid træffere uden reel lighed, og med `none`-rerankeren er tærsklen virkningsløs.
Tallene vurderes først med et evalueringssæt samt en rigtig embedder og reranker. Det er en
forudsætning, før AI-modulerne må bruge production-evidens. Stien "Der findes ikke tilstrækkelig
dokumentation" testes deterministisk uden embedder.

**Overvejede alternativer:**
- *At nøjes med en note i implementeringsstatus.* Fravalgt: begrænsningen rammer den sti, der
  forhindrer svar uden dokumentation, og må ikke kunne overses.
- *At tune tallene med test-embedderen.* Fravalgt: test-embedderen har ingen semantik, så tal
  tunet med den ville give falsk sikkerhed.

**Begrundelse:** "Utilstrækkeligt grundlag" er det vigtigste svar, systemet kan give
(`docs/04` §16, KRAV-AI-004). Under test med test-implementeringerne udløses det næsten aldrig.

---

## B-007 — Utilgængelig retrieval er en systemfejl; ingen mock-videnshuller i Admin

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9.1, §12 og §20.2; `docs/04` §16

**Beslutning:**
1. Om retrieval kan køre, er en tilstand, som resten af systemet kan læse, og ikke kun en
   linje i serverloggen. Når retrieval er utilgængelig, får brugeren en systemfejl ("Retrieval
   er utilgængelig"), aldrig "Der findes ikke tilstrækkelig dokumentation". Administratoren
   ser tilstanden i Admin, og tests fastholder, at de to tilstande ikke kan forveksles.
2. Videnshuller vises som tom tilstand overalt i Admin, også på forsiden, indtil de kan opstå
   af AI-forespørgsler. Mock-videnshullerne fra fase 5 er fjernet. §12 i `docs/07` er rettet,
   så den ikke længere modsiger §19.

**Overvejede alternativer:**
- *Kun at logge ved opstart.* Fravalgt: en tilstand, der kun står i en log, kan ikke vises
  korrekt, og et tomt resultat kunne forveksles med manglende dokumentation.
- *At beholde mock-tal på forsiden.* Fravalgt: falske tal ved siden af rigtige på samme side
  kan forveksles med produktionsdata (`CLAUDE.md` §2).

**Begrundelse:** `docs/04` §16: "Insufficient" er et kompetent svar, "Error" er et
systemsvigt. Forveksles de, lærer brugerne at ignorere det vigtigste svar, systemet kan give.

---

## B-006 — Et hul i gyldigheden forbliver et hul, men må ikke være tyst

**Dato:** 1. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §3.5 og §12

**Beslutning:** Deaktiveres en version, der har erstattet en forgænger, får forgængeren ikke
sin gyldighed tilbage. Systemet ændrer aldrig selv gyldighed ud over afkortningen ved
erstatning. Et hul i gyldigheden vises i Admin som en tilstand, der kræver opmærksomhed, på
samme måde som dokumentkonflikter flages. Hullet lukkes kun ved en menneskelig handling, nemlig
at publicere en ny version. Systemet foreslår ikke selv en løsning.

**Overvejede alternativer:**
- *Genoplive forgængerens gyldighed automatisk.* Fravalgt: så ville systemet selv afgøre, hvad
  der er gældende viden.
- *Lade hullet være uden markering.* Fravalgt: et tyst hul ville først opdages, når en rådgiver
  ikke får svar.

**Begrundelse:** At systemet selv afgør, hvad der er gældende viden, er forbudt i hele
arkitekturen. Deaktiveringen af efterfølgeren kan netop skyldes, at den var forkert, og så er
en genoplivet forgænger det værste udfald. Et hul giver i stedet "ingen tilstrækkelig
dokumentation", som er et ærligt og korrekt svar (KRAV-AI-004).

---

## B-005 — Gentaget indledning (`lead_in`) for delte lister og tabeller

**Dato:** 1. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §1.2, §6 og §10

**Beslutning:** Når en lang liste eller tabel deles, gemmes den gentagne listeindledning eller
overskriftsrække i feltet `lead_in` på chunket, uden for chunkets `[char_start, char_end)`.
`text` er fortsat præcis udsnittet af den normaliserede tekst. `lead_in` indgår i leksikalsk
søgning og embedding. Når chunket optræder som kilde, vises `lead_in` i kildekortet som
kontekst, visuelt adskilt fra den citerede passage.

**Overvejede alternativer:**
- *Indledningen i selve teksten.* Fravalgt: så er chunkets tekst ikke længere et præcist udsnit
  af dokumentet, og en citation kan ikke verificeres mod dokumentet.
- *Ingen gentagelse.* Fravalgt: en undtagelse ville kunne søges og vises uden sin overskrift.

**Begrundelse:** De to krav i §6 kan ikke opfyldes samtidig i ét felt. Løsningen bevarer det
væsentlige i begge: chunkets tekst er et præcist udsnit, så en citation kan verificeres mod
dokumentet, og indledningen følger med i søgning og embedding, så en undtagelse ikke står uden
sin overskrift. I kildekortet skal det være tydeligt, hvad der er citeret, og hvad der er
kontekst. Et menneske, der læser "undtagelse 7", skal kunne se, hvilken liste den hører til.

---

## B-004 — Demo-noten i `docs/05` §12 beskriver den nuværende tilstand

**Dato:** 1. oktober 2026
**Område:** `docs/05-foundation-implementation.md` §12 (låst dokument, åbnet eksplicit på
dette ene punkt efter beslutning fra projektejeren)

**Beslutning:** Demo-noten i §12 er rettet. Den nævnte miljøvariablen
`NEXT_PUBLIC_IPA_DEV_TOOLS=true` og den aktive rolle-switcher, som begge blev fjernet i fase 6.
Noten beskriver nu, at platformen kræver login via Supabase Auth, og at appen uden
databaseforbindelse kører som demo uden login (B-003). Resten af `docs/05` er uændret.

**Overvejede alternativer:**
- *Lade noten stå som historisk beskrivelse af fase 5.* Fravalgt, fordi noten beskriver en
  kørende demo og en miljøvariabel, der ikke længere virker, og derfor kan misforstås som
  gældende vejledning.
- *Flytte demo-oplysningen til `docs/06` og slette noten i `docs/05`.* Fravalgt, fordi
  CLAUDE.md §5 siger, at det dokument, der ejer emnet, rettes frem for at dublere. Demo-adressen
  blev dokumenteret i `docs/05`.

**Begrundelse:** Statusoverblikket den 1. oktober 2026 viste, at noten modsagde koden og
`docs/06`. Et låst dokument, der beskriver noget, som ikke findes, er værre end en rettelse.

---

## B-003 — Midlertidig demo uden login, indtil projektet er færdigt

**Dato:** 29. september 2026
**Område:** `docs/06-identity-database-access-control.md` §3 (låst dokument, åbnet eksplicit
på dette ene punkt efter beslutning fra projektejeren)

**Beslutning:** Den offentlige Vercel-demo kører uden login, indtil projektet er færdigt. Så
kobles demoen på Supabase, og demo-tilstanden fjernes. Demo-tilstanden gælder kun på fiktive
udviklingsdata og har et tydeligt markeret rolleskift ("Demo uden login · vis som"), der
ikke er adgangskontrol.

**Sikring:** Demo-tilstanden er kun aktiv, når der **ikke** er forbundet nogen database
(`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` mangler). Så snart en database er
koblet på, lokalt, i tests eller i Vercel, gælder login og server-side autorisation præcis
som i `docs/06`. Demoen kan derfor aldrig vise rigtige data uden login. Rollerne viser stadig
kun det, deres permissions giver. Fx får Rådgiveren ikke Admin, og Administratoren får ikke
Analytics. Det er dækket af tests.

**Overvejede alternativer:**
- *Koble demoen på et hostet Supabase-projekt nu.* Fravalgt af projektejeren for nu og
  planlagt til sidst.
- *Lade demoen stå med login-siden uden database.* Fravalgt, fordi demoen så ikke kan ses.

**Begrundelse:** Projektejeren vil kunne se og vise platformen undervejs uden at oprette en
database, før projektet er færdigt.

**Skal fjernes igen (påmindelse):** Når projektet er færdigt: opret Supabase-projektet (EU),
kør migrationerne, sæt de to miljøvariabler i Vercel, sæt `DEMO_WITHOUT_LOGIN_ENABLED` til
`false` og slet `src/dev/demo/`, `src/mocks/demo.ts` og `isDemoMode()`-grenene. Punktet står
også i `docs/roadmap.md` og `CLAUDE.md` §1.

---

## B-002 — Skitsen for "Bed AI om forslag" får fast ramme

**Dato:** 28. september 2026
**Område:** `docs/04-ui-ux-design.md` §10.4 (låst dokument, åbnet eksplicit på dette ene punkt)

**Beslutning:** ASCII-skitsen i §10.4 tegnede knappen "Bed AI om forslag" med stiplet ramme.
Skitsen er rettet, så knappen har fast ramme. Resten af dokumentet er uændret.

**Overvejede alternativer:**
- *Lade skitsen stå og behandle den som illustrativ.* Fravalgt, fordi en låst specifikation,
  der modsiger sig selv, kan læses begge veje.
- *Ændre reglen, så stiplet kant også må bruges på AI-indgange.* Fravalgt, fordi signaturen
  kun virker, så længe den aldrig betyder andet end "AI-indhold, der afventer vurdering".

**Begrundelse:** §3.4 fastslår, at stiplet kant udelukkende bruges på AI-genereret indhold,
der afventer menneskelig vurdering, og at reglen er absolut. Knappen er en handling, ikke
indhold. Skitsen var fejlen, og implementeringen i fase 5 fulgte allerede reglen.

---

## B-001 — Adgang til kundecases er `own` for alle roller, også Administrator

**Dato:** 28. september 2026
**Område:** `docs/03-technical-architecture.md` §10 (låst dokument, åbnet eksplicit på dette
ene punkt)

**Beslutning:** I permission-tabellen er `advise.case.read` og `advise.case.write` rettet fra
"—" til `own` for Administrator, så de er `own` for alle tre roller. Teksten under tabellen
og afsnittet "Kundecases" er gjort konsistente med rettelsen.

**Overvejede alternativer:**
- *Beholde "—" for Administrator.* Fravalgt, fordi en administrator så aldrig kunne tildeles
  en sag — heller ikke som sagsansvarlig — selv om `docs/02` §10 og `docs/04` §21 giver
  administratoren adgang til Advise.
- *Give Administrator bredere scope (`all`).* Fravalgt, fordi det ville give adgang til
  kundedata gennem en rolle, hvilket strider mod princippet om adgang pr. case.

**Begrundelse:** Uoverensstemmelsen var en intern selvmodsigelse i `docs/03`, ikke en uenighed
mellem dokumenterne. `docs/02` og `docs/04` havde ret. Adgang til en kundecase gives pr. case
gennem `case_participants`, aldrig gennem en rolle. `own` betyder "kun egne og tildelte
sager" og gælder derfor ens for alle roller. En administrator er også rådgiver, ligesom en
leder er det.

**Konsekvens i koden:** Administratorens mock-session har fået `advise.case.read` og
`advise.case.write` med scope `own`. Sagsoversigten viser for alle roller kun egne og
tildelte sager.

Afdækket under fase 5 og dokumenteret i `docs/05-foundation-implementation.md` §11.
