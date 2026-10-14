# Fast beta uden AWS — Insurance Partners (IPA)

**Beslutning:** B-035 (`docs/decisions.md`), 12. oktober 2026; B-036, 13. oktober 2026; B-038 og
B-039, 14. oktober 2026.
**Status:** L0 og L1 er godkendt (B-036). L1.1 (§13) og L2 (§14, B-037) er godkendt (B-038). L3
(sikker dokumentimport, §15) er godkendt (B-039). L4 (Claude-adapter, egress pr. profil, budget og
forbrugsgrænser, §16) er gennemført på branchen `beta/fast-beta-without-aws` med fake transport og
afventer godkendelse. L4b–L9 er ikke påbegyndt.

Dokumentet beskriver betaens scope, arkitektur og leverancer. Det erstatter ikke de låste
fasedokumenter. Hvor betaen afviger fra dem, står det her og i B-035. Den historiske tekst i
fasedokumenterne og i beslutningsloggen omskrives ikke.

---

## 1. Formål og scope

En professionel, fungerende betaversion med fire obligatoriske moduler, som alle bygger på den
samme autoritative, versionsstyrede forsikringsviden (Knowledge Engine):

| Modul | Betaens indhold |
|---|---|
| Copilot | Rigtige AI-svar på spørgsmål om ét valgt produkt, med dokumenterede kilder, dækning, undtagelser og begrænsninger, og en tydelig afvisning, når grundlaget er utilstrækkeligt |
| Learn | Rigtigt undervisningsindhold, AI-forklaringer, små øvelser og gemt progression |
| Practice | AI-rollespil med fiktive kunder, gemte samtaler og feedback efter en fast rubric |
| Assessment | Spørgsmålsbank, menneskegodkendte facit, deterministisk scoring, sikre prøveforsøg og resultathistorik |

**Advise er udskudt.** Behandling af kundepolicer, sammenligning af en kundes dækning, AI på
identificerbare sagsdata og sagsbaseret AI-dialog er uden for betaen. Eksisterende kode og
datamodeller bevares. Modulet skjules i betaens brugerflade (L2), og gatewayens spærre mod
kundesagsdata bevares uændret.

**Masterfaser.** Betaen implementerer de nødvendige dele af 8C, 9, 10 og 12 før den oprindelige
rækkefølge. Det er en eksplicit undtagelse (B-035, K4). Master-roadmap 1–21 er uændret, og faserne
beholder deres identitet.

---

## 2. Arkitektur

```
Browser ─► Vercel (Next.js, alt AI og al retrieval server-side)
             runAiRequest → gating → matrix → retrieval → invokeModel → egress → Claude API
             ▼
        Supabase (EU): Postgres + RLS · Auth (kun inviterede) · Storage · Edge Function worker-storage
             ▲
  Dokumentimport: administratorens engangskørsel (Docker) på en betroet maskine
    ClamAV 1.4.6 + den eksisterende ingestion-worker i --once-tilstand, least-privilege-rolle
```

- **Ingen AWS i den aktive runtime.** Bedrock, Cohere, ECS/Fargate, ECR, NAT/VPC, AWS IAM/OIDC,
  Secrets Manager og CloudWatch er fjernet i L2 (§14). Koden kan gendannes fra Git-historikken og
  rollback-punktet (§10).
- **Claude API direkte** (Anthropic), kaldt server-side gennem den eksisterende AI Gateway.
  - Platformen bruger en separat API-organisation. Den private Claude Code-konto må aldrig blive
    platformens produktionskonto. I betaen er det projektejerens egen Anthropic
    Console-organisation med en dedikeret server-side API-nøgle, som IPA senere udskifter med sin
    egen uden ændring af forretningslogik (B-039).
  - Det indebærer **ikke** behandling udelukkende i EU. Prompts og svar behandles hos Anthropic
    efter deres vilkår og DPA. Det direkte API har efter de kilder, B-035 bygger på, ikke et
    EU-only-valg.
- **Ingen embeddings og ingen reranker.** Retrieval-metoden er "produktdokumenter i fuld længde"
  (§4). Embedding-koden bliver i repoet, men er ikke en del af betaens runtime.

### 2.1 Hvad B-035 erstatter fra 8B

8B-specifikationen og dens implementering er historik og står uændret i `docs/08b`. For betaen
gælder:

| 8B-valg | I betaen |
|---|---|
| Cohere Embed v4 og Rerank 3.5 på Bedrock (D-1, D-2, §2–§3) | Bruges ikke. Retrieval-metoden `product_documents` har hverken embedding eller reranker |
| P1/P2: production-embedder og production-reranker | Gælder uændret for hybride konfigurationer. For `product_documents` er P1/P2 tilpasset eksplicit (§5.1) |
| H6: evidensen skal komme fra production-implementeringer | Tilpasset eksplicit for `product_documents` (§5.1); uændret for hybride |
| Embeddings som krav for publicering (docs/07) | Kræves kun, når en embedding-model er aktiv (L1, §12). Betaen har ingen |
| Ingestion-worker på ECS/Fargate med ClamAV som ECS-service (I4, I5.5) | Samme worker og scanner som engangskørsel i Docker på en betroet maskine. Containerspecifikationen er `deploy/import/compose.yaml` (L2, L3); runbooken er `docs/import-runbook.md` (L3, §15) |
| Credentials via Vercel OIDC / ECS-taskrolle / GitHub OIDC → AWS (C1) | Ingen AWS-credentials. Claude-nøglen i Vercels servermiljø; workerens databaserolle i operatørens miljø |
| Evaluering i en AWS-evalueringskonto (I7) | Evalueringsmiljøet uden AWS (L9). Workflowet og IAM er fjernet i L2 |
| Alarmer som CloudWatch-specs (B-033) | Log- og webhook-alarmerne (`AlertSink`) bevares. De aggregerede alarmer er version 2 uden Bedrock- og CloudWatch-delene (L2, B-037) |
| Kontrolsæt af embedding-vektorer (C6) | Uden betydning uden embeddings. Koden og testene bliver (L2) |
| Egress for generering: én regel for alle kald (spørgsmål og kontekst = `user_question`, evidens = `knowledge`; §21.3) | Én række pr. formål (L4, §16.17): Copilot, Learn og Practice-feedback som før, rollespillet kun brugerens replik og fiktivt scenarie (`training_fictional`). Advise og Assessment sender intet |

P3–P9, H1–H5, H7, egress-grænsen, RLS, workerens least-privilege-identitet, upload-sikkerheden og
publisherens isolation gælder uændret.

---

## 3. Miljøer

| Miljø | Formål | Status |
|---|---|---|
| Lokalt | Udvikling og tests (Supabase CLI) | I brug |
| CI | Lint, typecheck, unit, pgTAP, integration, build på en frisk database | I brug |
| Beta-staging | Supabase-projektet "IPA" (EU, eu-west-1) | Udpeget. **Kun read-only.** Migrations, tabeller, Auth/RLS, uploads og betalbare ressourcer kræver særskilt godkendelse |
| Beta-production | Separat Supabase-projekt | Oprettes senere |
| Offentlig demo (B-003) | Fiktive data uden login | Må ikke forveksles med betaen; bevares om nødvendigt som beskyttet development/preview |

**Betaen (K5):** kræver login, bruger Supabase, tillader kun inviterede og autoriserede brugere og
viser aldrig mock-data som virkelige resultater. Demo-tilstanden er allerede slået fra, når en
database er konfigureret (`src/dev/demo/demo-mode.ts`).

---

## 4. Copilot-retrieval: strategi A og B

Sammenligningen er foretaget før designet låses (B-035, punkt 2). Tallene bygger på oplyste
rammer: 40–100 dokumenter, 20–40 sider pr. dokument, typisk ét produkt pr. spørgsmål. Hvor intet er
oplyst, er der antaget og markeret **[antagelse]**. Ingen tal er målt med det rigtige API (ingen
betalte kald).

**Strategi A — produktfiltreret leksikalsk retrieval.** Brugeren vælger produkt. PostgreSQL
full-text-søgning (dansk + simple) finder de bedst matchende tekstpassager (topK, fx 8–20), og kun de
sendes til Claude.

**Strategi B — produktdokumenter i fuld længde.** Brugeren vælger produkt. Databasen udvælger alle
adgangsgodkendte, publicerede og gyldige dokumentversioner for produktet, inden for profilens
dokumenttyper, og Claude modtager dem i fuld længde som ordnede uddrag med side og afsnit. Er
grundlaget større end budgettet, afvises kaldet (fail-closed) frem for at blive afkortet.

**Størrelse [antagelse]:** en side forsikringsbetingelser er 2.500–4.000 tegn, og dansk tekst er ca.
3 tegn pr. token. Et dokument på 20–40 sider er 20.000–50.000 tokens. Et produkts dokumenter i
Copilots scope (betingelser, produktbeskrivelse, tillæg) er typisk 25.000–80.000 tokens. Det kan
rummes i de aktuelle Claude-modellers kontekstvindue, som verificeres ved modelvalget i L4.

| Kriterium | A — leksikalsk | B — fuld længde |
|---|---|---|
| Faglig korrekthed | Afhænger af, at de rigtige 8–20 passager findes | Claude ser hele betingelsessættet |
| Undtagelser | **Hovedrisikoen.** Undtagelser står ofte i et andet afsnit og med andre ord end spørgsmålet (danske sammensatte ord, synonymer, generelle undtagelser). Uden embeddings og reranker bliver de let ikke fundet | Alle undtagelser, definitioner og begrænsninger er med |
| Manglende dækning | Kan ikke dokumentere fravær: at noget ikke står i 8 passager beviser ikke, at det ikke er dækket | Kan dokumenteres ud fra det fulde dokument |
| Sammenhæng mellem klausuler | Kun hvis alle relevante klausuler rammes | God |
| Kildepræcision | Uddrag med side og afsnit | Samme uddrag med side og afsnit. Flere kandidater gør en forkert men gyldig henvisning mulig; kontrakten og E2E-evalueringen måler det |
| Versionskontrol | Samme databasefilter | Samme databasefilter: kun publicerede versioner, der gælder på datoen, og én version pr. dokument |
| Brugerrettigheder | RLS og adgangsfilter | Samme RLS og adgangsfilter. Kun det valgte produkt |
| Svartid | Kortest | Længere, fordi flere input-tokens skal læses (måles i L4/L9) |
| Tokens pr. spørgsmål [antagelse] | 5.000–15.000 input | 25.000–80.000 input, typisk ca. 40.000 |
| Omkostning [antagelse] | Lavest | 3–6 gange A uden cache. Med prompt-caching af dokumentdelen falder gentagne spørgsmål om samme produkt markant |
| Kompleksitet | Rangering, tærskler og afvisning skal tunes. Leksikalsk søgning uden kalibreret score kan ikke afvise pålideligt | Enklest i runtime: ingen rangering, intet query-afhængigt udvalg, deterministisk sæt pr. produkt og dato. Kræver et budget |

**Valg: strategi B** (`product_documents`), uden kombination i runtime. Betaens exit-krav (0
kritiske fejl om dækning, undtagelser og gyldighed, §5.2) kan efter analysen ikke nås pålideligt med
leksikalsk topK uden embeddings og reranker, fordi både undtagelser og "ikke dækket" kræver hele
dokumentet. B er samtidig den enkleste runtime.

**Afgrænsning:**
- Profilen afgrænser dokumenttyperne. Copilot bruger fx ikke salgsmateriale eller interne noter.
- Budgettet er en parameter i konfigurationen (`maxChars`) og indgår i fingeraftrykket. Et
  produkt, der overskrider det, giver en tydelig fejl, og brugeren afgrænser til de relevante
  dokumenter (L5). Der sker aldrig en stiltiende afkortning.
- Strategi A bliver ikke en production-metode. Den eksisterende hybride kode kører som i dag
  uden embedder (development) og kan evalueres senere, hvis målinger viser et behov.

**Konsekvens for evalueringen:** retrieval-gates Q1–Q7 er bygget til en rangerende søgning med
topK = 8 og en reranker med absolut relevansscore. Metoden har derfor sit eget gate-sæt, D1–D6
(B-036, §5.1).

---

## 5. Evaluering og kvalitet

### 5.1 Retrieval-evaluering af `product_documents`

**Uændret:**
- **H1** adgang;
- **H2** metadata-lækage;
- **H3** gyldighed og versioner;
- **H4** filtre og produktscope;
- **H5** skjulte konflikter;
- **H7** isolation og integritet;
- **P3–P9.** En konfiguration kan kun give production-evidens, når den er aktiv og har en
  registreret, godkendt evaluering, hvis område dækker hvert element.

**Eksplicit tilpasset (K1, implementeret i L1, §12):**
- **P1:** konfigurationen er `product_documents`, metoden, der faktisk kørte, er
  `product_documents`, ingen embedder er konstrueret, og konfigurationen har ingen embedding-model.
- **P2:** ingen reranker kørte, og konfigurationen har ingen reranker. For hybride konfigurationer
  gælder det tidligere krav (production-reranker, aldrig "none") uændret.
- **H6:** evidensen kommer fra netop den evaluerede metode uden embedder og reranker. Hver
  medtaget dokumentversion er komplet. Chunker-versionerne er dækket. Der er ingen
  udviklingsoverstyring.

**Gate-sættet `product-documents-gates` v1 (B-036).** Q1–Q7 måler en rangerende søgning: topK, MRR,
rerankerens løft og afvisning i retrieval-laget. De har ingen faglig fortolkning for en metode, der
leverer hele produktets grundlag, og bruges ikke på den. De er uændrede for den hybride metode
(`gates-v1`).

D1–D6 måler metodens faktiske opgave. Hver gate er en **invariant**: andelen af spørgsmål, der
opfylder kravet, skal være 1. Metrik, retning og tærskel er låst i `evals/engine/gates.ts` og i
databasen.

| Gate | Metrik | Krav pr. spørgsmål | Spørgsmål |
|---|---|---|---|
| D1 | Required Document Coverage | Hver kildeversion i facit er leveret | Besvarbare |
| D2 | Required Passage Coverage | Hver påkrævet passage (grad 3) er leveret et sted i grundlaget | Besvarbare |
| D3 | Full Document Integrity | Hver leveret version er hel, sammenhængende, i chunk-rækkefølge og uforkortet | Alle |
| D4 | Valid Version Coverage | Præcis de gyldige versioner (current/as_of): ingen mangler, ingen uventede | Alle |
| D5 | Correct Product Scope | Retrieval blev spurgt om netop spørgsmålets produkt, og intet element er fra et andet | Alle |
| D6 | Authorized Document Coverage | Præcis de dokumenter, brugeren må læse: ingen mangler, ingen andre | Alle |

- **Det forventede grundlag** udledes af manifestet, aldrig af retrieval:
  - spørgsmålets produkt, sprog, dokumenttyper og dokumenter;
  - de dokumenter, brugeren har tildelinger til;
  - den version, der gælder på datoen.

  En historisk version kræver historisk læseret.
- **En fejlet retrieval opfylder intet krav**, og kørslen er ugyldig. Et tomt eller ufuldstændigt
  grundlag kan ikke bestå.
- **Ingen dokumentgate gør kørslen "uncertain".** Én mangel fejler gaten, og Wilson-intervallet
  rapporteres kun (udledt i B-036). Tier pilot afgrænser fortsat godkendelsen til det evaluerede
  område.
- **Minimum pr. type er som i 8B** (mindst 36 spørgsmål). Hvert aktivt spørgsmål skal angive netop
  ét produkt fra manifestet; ellers afvises sættet, før noget køres.

**Hårde gates (nul tolerance).** H1–H7 gælder. H4 og H6 er tilpasset eksplicit for metoden (B-036).

| Krav (B-036, del A) | Håndhæves af |
|---|---|
| 1. Ingen dokumenter eller metadata uden for brugerens rettigheder | H1, H2; D6 |
| 2. Kun det valgte stabile produkt-id | H4 (også forespørgslens produkt); D5 |
| 3. Publicerede og gyldige versioner, `current`/`as_of` | H3; D4 |
| 4. Ingen ufuldstændige versioner | H6 (antal chunks fra korpusset); D3 |
| 5. Alle krævede chunks, i korrekt rækkefølge | H6 (hver chunk præcis én gang, sammenhængende, stigende indeks, tekstens sha256 lig korpussets; en manglende gyldig version er også et brud); D3, D4 |
| 6. Ingen skjulte konflikter | H5 |
| 7. Konfiguration, fingeraftryk og metode matcher | H6 (fingeraftryk, metode, ingen embedder/reranker); gate-sættets metode ved registrering, godkendelse og i retrieval-konteksten |
| 8. Evalueringsmiljø, brugeridentiteter og rapportintegritet | H7, checksums, databasens genberegning |
| 9. Budgettet overskrides aldrig ved stiltiende afkortning | H6 (grundlaget ≤ `maxChars`, uforkortede chunks); retrieval afviser over budget (54000) |
| 10. Uden manifest, versionsidentitet eller proveniens ingen godkendelse | Validering af sæt og manifest, H1 (ukendt dokument), H6, D-gates |

**Konfigurationen bestemmes server-side.** `retrieveEvidence` vælger metoden ud fra den aktive
konfiguration i registret, aldrig ud fra forespørgslen. Det er uændret fra L1.

**Bindingen mellem gate-sæt og metode** håndhæves i fire lag:
1. motoren afviser kombinationen, før noget køres;
2. publisheren efterprøver den;
3. `record_evaluation_run` afviser den (`gate_set`);
4. `retrieval_configuration_problems` og `retrieval_context` efterprøver den igen.

**Kan en korrekt, evalueret `product_documents`-konfiguration godkendes?** Ja. Følgende er vist i
pgTAP og integration:
- en bestået D1–D6-kørsel registreres;
- et menneske med `system.settings.manage` godkender og aktiverer;
- konfigurationen giver production-evidens inden for det evaluerede område.

En uevalueret, fejlet eller ugyldig konfiguration blokeres stadig: kandidat uden kørsel, D4-fejl,
H-brud, fixture-miljø, forkert gate-sæt eller forfalsket rapport.

### 5.2 E2E-svarevaluering (exit-krav for den første begrænsede beta)

En separat evaluering af de færdige svar, som ikke automatisk erstatter retrieval-gates:

- mindst 40 repræsentative forsikringsspørgsmål;
- mindst 95 % fuldt korrekte svar efter faglig bedømmelse;
- 0 kritiske fejl om dækning, undtagelser, gyldighed eller dokumentrettigheder;
- ingen opdigtede kildehenvisninger;
- alle væsentlige faglige konklusioner er dokumenteret;
- utilstrækkeligt grundlag giver en tydelig afvisning.

Spørgsmålene dækker:
- direkte spørgsmål;
- undtagelser;
- sammenhæng mellem flere klausuler;
- manglende dækning;
- lignende produkter;
- historiske vilkår;
- konflikt mellem dokumenter;
- spørgsmål uden dokumenteret svar;
- permissions.

Nås kriterierne ikke, forbedres kvaliteten, før betabrugere får adgang.

**Kontrollen (B-036): `beta-answer-acceptance` v1** (`evals/acceptance/`, `evals/engine/acceptance.ts`,
`ai.record_answer_quality`).
- **Bedømmelsen.** Svarene bedømmes af mennesker, spørgsmål for spørgsmål:
  - korrekthed: fuld, delvis eller forkert;
  - kritisk fejl;
  - opdigtet kilde;
  - undtagelser: korrekt, forkert eller ikke relevant;
  - afvisning: korrekt, manglende, uberettiget eller ikke relevant.

  Et spørgsmål om undtagelser skal bedømmes på undtagelserne, og et ubesvarbart spørgsmål eller et
  permission-spørgsmål på afvisningen.
- **Fuldt korrekt** betyder rigtigt svar uden kritisk fejl, opdigtet kilde, fejl i undtagelser eller
  fejl i afvisning.
- **Låste kriterier:**
  - mindst 40 spørgsmål og alle ni kategorier;
  - mindst 95 % fuldt korrekte (punktestimat; den nedre Wilson-grænse gemmes);
  - 0 kritiske fejl og 0 opdigtede kilder;
  - 0 fejl i undtagelser og 0 manglende eller uberettigede afvisninger (udledt i B-036);
  - en rigtig Claude-model (`claude-…`). Stub- og testmodellen kan aldrig bestå.
- **Opfyldte kriterier er ikke en validering.** En person med `knowledge.version.publish` validerer
  fagligt (`ai.validate_answer_quality`) med en begrundelse og en eksplicit accept af den
  statistiske usikkerhed.

**Tre adskilte godkendelser (B-036).** `ai.beta_status()` viser dem hver for sig, og ingen medfører
en anden:

| Godkendelse | Hvor | Hvem |
|---|---|---|
| Godkendt retrieval-konfiguration | `knowledge.retrieval_configurations` (aktiv og klar til drift) | `system.settings.manage`, efter bestået evaluering |
| Valideret AI-svarkvalitet | `ai.answer_quality_validations` | registreres af `system.settings.manage`, valideres af `knowledge.version.publish` |
| Betaversion godkendt til rådgivere | `ai.beta_release_approvals` | `system.settings.manage`. Kræver en aktiv konfiguration og en valideret svarkvalitet for netop den. Kan trækkes tilbage |

En suspenderet eller skiftet retrieval-konfiguration tager betagodkendelsen med sig, men ikke
valideringen. Tabellerne kan kun skrives gennem funktionerne, og alle handlinger auditeres.

### 5.3 Dokumentbudget og manipulation

- **Budgettet er midlertidigt.** 360.000 tegn (`product-documents-structure-1`) er et
  udviklingsloft, ikke dokumenteret API-kapacitet. Før rigtige Claude-kald (L4) skal disse ting
  kontrolleres:
  - det faktiske tokenantal for de rigtige dokumenter;
  - den valgte models kontekstgrænse;
  - de reserverede outputtokens;
  - metadata og systemprompt;
  - antal dokumenter pr. produkt;
  - pris og svartid.
- **Hele grundlaget eller intet.** Kan hele grundlaget ikke være med, afvises kaldet sikkert.
  - Databasen afviser over `maxChars` (54000).
  - Gatewayen afviser et `product_documents`-grundlag, der ikke kan sendes samlet inden for
    profilens grænser (`document_basis_too_large`), før modellen kaldes.
  - Der sker ingen afkortning af chunks og ingen udeladelse af dokumenter.

  Copilot-profilens nuværende grænser (8 uddrag à 2.000 tegn) er lavet til den hybride top-8 og
  afviser derfor rigtige produktgrundlag, indtil L4 erstatter dem med et tokenbaseret budget for
  metoden. Det er fail-closed og ønsket. **L4 har erstattet dem** for `product_documents`: hele
  grundlaget sendes uafkortet, og tokenbudgettet afgør (§16.18).
- **Dokumenter med instruktioner.** Dokumentindhold er kildedata, aldrig systeminstruktioner.
  - Systemprompten er profilens og fastlagt i koden.
  - Dokumenttekst sendes kun som en `evidence`-del med kategori `knowledge` og evidens-id.
  - Et svar, der følger en indlejret instruktion uden kilde eller med en opdigtet kilde, afvises af
    outputkontrakten (`src/tests/beta-document-injection.test.ts`).
  - Den rigtige models modstandskraft måles i E2E-evalueringen (§5.2), før rådgivere får adgang.

**Statistisk usikkerhed:** 40 spørgsmål er et lille sæt. 95 % svarer til mindst 38 af 40. Det
nedre 95 %-Wilson-interval er da ca. 0,83 (40 af 40 giver ca. 0,91). Usikkerheden rapporteres og
accepteres eksplicit for en begrænset pilot. Den fremstilles ikke som endeligt kvalitetsbevis.

---

## 6. Dokumentimport

**Valgt:** kontrolleret administratorimport som engangskørsel i Docker på en betroet maskine (L3).
Den eksisterende worker og ClamAV-sikkerhedskæde genbruges uændret i indhold:
- karantæne;
- strukturvalidering;
- PDF-inspektion;
- ClamAV 1.4.6 med friske officielle signaturer;
- verdict afledt i databasen;
- frigivelse;
- tekstudtræk og chunking;
- versionsregistrering.

Derefter følger faglig menneskelig godkendelse og rettighedstildeling i Admin. Intet publiceres
automatisk. Dokumenter uploades ikke til GitHub Actions eller andre hostede runners som standard.

Workeren forbinder som sin least-privilege login-rolle (8B-I3) og aldrig som service_role.
Rollens credential findes kun i operatørens lokale miljø og aldrig i repoet. Operatørmaskinen er en
del af sikkerhedsgrænsen. Kravene til den står i runbooken (`docs/import-runbook.md`):
- krypteret disk og en personlig konto;
- adgangskoderne spørges om ved hver kørsel og gemmes ikke;
- PDF'erne slettes, når versionerne er publiceret.

Importen selv er bygget i L3 (§15). **[AFKLARES]** Hvem der er betroet operatør, og hvilken maskine
der bruges.

---

## 7. Databeskyttelse: brugerindtastet fritekst

Forenklingen må ikke blive en bagdør for kundedata. Det gælder for alle moduler (design; L4–L7
implementerer det):

1. **Proveniens ved indgangen.** Al fritekst klassificeres af gatewayen som brugertekst (`userText`)
   med `caseBound` og `redacted`. Tekst uden proveniens, ukendt indhold og kundebundet indhold
   fejler lukket (eksisterende `authorizeEgress`).
2. **Redaction før afsendelse.** CPR, CVR, e-mail, telefon og kontonumre erstattes, før noget forlader
   platformen. Restrisikoen er navne og adresser, som ikke kendes fra konteksten (docs/08 §7.2).
   Brugerfladen advarer derfor tydeligt mod at indtaste kundeoplysninger.
3. **Ingen sagsbinding i betaen.** Et kald med en kundesagsreference afvises. Advise er udskudt, og
   `customer_identifiable` forbliver `NEVER_EXTERNAL` i koden. Ingen administratorindstilling kan
   ændre det.
4. **Tilladelse pr. profil og handling, ikke generelt.** Egress-reglerne udvides med rækker for
   netop de handlinger, betaen bruger:
   - Copilot-spørgsmål;
   - Learn-forklaring;
   - rollespilsreplik;
   - Practice-feedback.

   Hver række angiver rolle og kategori, fx at rollespillets kontekst kun må være godkendt fiktivt
   scenarieindhold (`training_fictional`) fra databasen. Der indføres ingen generel tilladelse til
   at sende al brugertekst til Anthropic.
5. **Ingen upload af brugerfiler** i Copilot, Learn eller Practice.
6. **Prøvesikkerhed.** Under et aktivt prøveforsøg er al bruger-AI låst (G1). Under et rollespil
   er Copilot låst, men selve rollespillet er tilladt for netop den aktive session (G2).

---

## 8. Permissions (K6)

Nye permissions, mindst mulige, med scope `all`. De implementeres i den leverance, der først bruger
dem (L6–L8).

| Permission | Giver ret til | Standardrolle |
|---|---|---|
| `learning.content.manage` | Oprette, redigere og publicere Learn-moduler, emner og øvelser | Administrator |
| `practice.scenarios.manage` | Oprette, redigere og publicere fiktive scenarier og rubric-versioner | Administrator |
| `assessment.content.manage` | Oprette og redigere spørgsmål, facit og prøver, og bestille AI-udkast | Administrator |
| `assessment.content.approve` | Godkende spørgsmål og facit og frigive prøver | Administrator |

Eksisterende permissions genbruges:
- **Learn:** `learning.progress.read` (own/team/all) til progression.
- **Practice:** `practice.session.write` (own) til træningssessioner.
- **Assessment:** `assessment.result.read` (own/team/all) til resultater.
- **Knowledge Engine:** `knowledge.*` som i dag.

**Regler:**
- At kunne redigere læringsmateriale giver aldrig ret til at godkende prøvespørgsmål. Det er to
  separate permissions.
- Godkendelse håndhæves i databasen med firøjneprincippet: den, der godkender et spørgsmål og dets
  facit, må ikke være den, der senest har ændret det. Et AI-udkast er altid markeret som udkast og
  kan aldrig godkende sig selv.
- RLS på alle nye tabeller:
  - kladder ses kun af indholdsansvarlige;
  - facit kan aldrig læses af den, der tager prøven, før aflevering;
  - bedømmelsen sker i databasen.
- Audit på oprettelse, ændring, godkendelse og publicering.

**Udledt, til bekræftelse:**
1. Administratorrollen får alle fire som standard, og firøjneprincippet sikrer adskillelsen.
   Skal godkendelse begrænses til navngivne fagpersoner, kræver det enten en ny rolle eller
   individuelle tildelinger. Begge dele er en ændring af de tre låste roller (docs/01) og kræver en
   beslutning.
2. At tage en prøve kræver en aktiv bruger og en tildelt prøve. Ingen ny permission.

### 8.1 Efterprøvning mod principperne (B-036)

De godkendte principper er sammenholdt med reglerne ovenfor. Afvigelserne er ikke rettet stiltiende.
De skal afklares, før L6–L8 implementerer permissions.

| Princip | Regel ovenfor | Vurdering |
|---|---|---|
| Separat ret til at redigere Learn-indhold | `learning.content.manage` | Opfyldt |
| Separat ret til at styre Practice-scenarier | `practice.scenarios.manage` | Opfyldt |
| Separate rettigheder til at redigere og godkende Assessment-indhold | `assessment.content.manage` og `.approve` | Opfyldt |
| Ingen automatisk ret til at godkende egne spørgsmål | Firøjne: godkenderen må ikke være den, der *senest* har ændret | **Afvigelse 1** |
| Ingen eskalering fra indholdsredaktør til systemadministrator | De fire permissions gives kun til administratorrollen | **Afvigelse 2** |
| Server-side kontrol, RLS og audit | RLS på nye tabeller, bedømmelse i databasen, audit | Opfyldt som regel; implementeres i L6–L8 |
| Facit og beskyttede prøveoplysninger kan ikke læses gennem elevens normale API-adgang | Facit kan ikke læses af den, der tager prøven, *før aflevering* | **Afvigelse 3** |

**Afvigelse 1 — "senest ændret" er for svagt.** Laver A et spørgsmål og retter B en detalje, må A
godkende sit eget spørgsmål.

Forslag:
- godkenderen må hverken have oprettet eller ændret den version, der godkendes;
- den, der har bestilt eller overtaget et AI-udkast, regnes som forfatter.

Konsekvens: med kun én administrator kan intet godkendes.

**Afvigelse 2 — administratorrollen er både indholdsredaktør og systemadministrator.** Med de tre
låste roller (docs/01) findes der ingen indholdsredaktør uden `system.settings.manage` og
`identity.user.manage`. Den, der skal redigere Learn-indhold, bliver i dag systemadministrator.
Identity understøtter kun permissions gennem roller, ikke individuelle tildelinger.

Principperne kan derfor ikke opfyldes uden én af to beslutninger:
- en ny rolle "Indholdsansvarlig";
- individuelle permission-tildelinger.

Begge ændrer de låste roller og kræver en beslutning. Indtil da gælder:
- indholdsfunktionerne kontrollerer kun indholds-permissions;
- ingen indholdsfunktion kan ændre roller eller permissions.

**Afvigelse 3 — "før aflevering" er for snævert.** Facit må aldrig kunne læses gennem elevens
normale API-adgang, heller ikke efter aflevering. Ellers kan facit deles med dem, der endnu ikke
har taget prøven.

Forslag:
- ingen læsepolitik på facit for prøvetagere;
- resultatet udleveres af en funktion med score og rigtigt/forkert pr. spørgsmål;
- spørgsmålspuljen og ufrigivne eller andres forsøg er lige så beskyttede som facit.

Om det rigtige svar må vises efter aflevering, er **[AFKLARES]**.

---

## 9. Leverancer

Hver leverance har egne tests, grøn CI og et commit og godkendes, før den næste begynder.

| # | Leverance | Status |
|---|---|---|
| L0 | B-035, dette dokument, rollback-punkt, beta-branch | Gennemført |
| L1 | Retrieval-metoden `product_documents` og publicering uden embeddings | Godkendt (B-036) |
| L1.1 | Gate-sæt D1–D6, E2E-acceptkontrol, tre adskilte godkendelser | Godkendt (B-038) |
| L2 | AWS-kode og -dependencies fjernes. Advise, Analytics og mock-sider skjules server-side | Godkendt (B-038) |
| L3 | Dokumentimport uden AWS (Docker-engangskørsel, runbook) | Godkendt (B-039) |
| L4 | Claude-adapter, egress-rækker pr. profil, budget og forbrugsgrænser (uden betalte kald) | Gennemført, afventer godkendelse (§16) |
| L4b | Første rigtige Claude-kald (kun efter særskilt godkendelse) | Ikke påbegyndt |
| L5 | Copilot (produktvalg, svarkontrakt med dækning/undtagelser/begrænsninger, kildevalidering) | Ikke påbegyndt |
| L6 | Learn | Ikke påbegyndt |
| L7 | Practice | Ikke påbegyndt |
| L8 | Assessment | Ikke påbegyndt |
| L9 | Validering i isoleret staging, inkl. E2E-svarevaluering | Ikke påbegyndt |

---

## 10. Rollback

**Rollback-punktet** er commit `5461546580691e04db03343f739d7df0777216da` på `main`: 8B-I8 komplet,
CI grøn, run 38290704606.

**Verificeret 2026-10-12 i en separat worktree:**
- `npm ci`, lint og typecheck uden fejl;
- 893 enhedstests bestået (4 sprunget over);
- build bestået.

**Tag:** `rollback/pre-beta-8b-i8` (annoteret) er oprettet lokalt. Den git-proxy, sessionen bruger,
afviser at pushe tags (HTTP 403), så tagget skal oprettes på GitHub af en person med skriveadgang:

```
git tag -a rollback/pre-beta-8b-i8 5461546580691e04db03343f739d7df0777216da -m "Rollback før betaen (B-035)"
git push origin rollback/pre-beta-8b-i8
```

**Rollback:** `git checkout -b restore/pre-beta 5461546580691e04db03343f739d7df0777216da`.

Commit-id'et er uforanderligt og forbliver i historikken, fordi der hverken force-pushes eller
slettes historik. Commit `5461546` er accepteret som den dokumenterede reference (B-036). Det
manglende remote-tag blokerer ikke udviklingen, og GitHubs adgangskontrol omgås ikke. Databasen rulles aldrig tilbage ved at slette migrations. En rollback af skema
sker med en ny, fremadrettet migration.

---

## 11. Åbne punkter

- **[AFKLARES]** DPA, dokumentlicenser, behandlingsgrundlag, sikkerhed og overførsler for Claude API
  (K7). Skal være vurderet og godkendt, før rigtige fortrolige dokumenter eller personoplysninger
  sendes til modellen.
- **[AFKLARES]** Betroet operatør og maskine for dokumentimport (§6).
- **[AFKLARES]** Afvigelserne i permission-reglerne (§8.1), før L6–L8 implementerer dem.
- **[AFKLARES]** Det faktiske tegn- og tokenomfang af de rigtige dokumenter. Importens status viser
  tegnene pr. version (L3, §15.4). Tokentællingen kommer i L4, og tilsammen afgør de budgettet
  (§5.3).
- **[AFKLARES]** Selskab/udgiver for et dokument. Datamodellen har intet felt til det, og importen
  afviser en kolonne for det (§15.3). Et nyt felt kræver en beslutning og en migration.
- **[AFKLARES]** De hostede forudsætninger for den første rigtige import (§15.7). De udføres af en
  person med adgang og ikke af importen.
- **[AFKLARES]** Evalueringssættet for betaen (L9): netop ét produkt pr. spørgsmål og mindst minimum
  pr. type (§5.1).
- **[AFKLARES]** Bekræftelse af de udledte punkter i B-036 (invarianter uden usikkerhed, nul
  tolerance for undtagelser og afvisninger, hvem der validerer).
- **[AFKLARES]** Bekræftelse af de udledte punkter i B-037 (hvad der tæller som betaen, at Min
  profil skjules, rutetestene for de skjulte områder).
- **[AFKLARES]** Home og kernemodulerne viser stadig udviklingsdata med notits, indtil L5–L8
  erstatter dem (§14.5). Betaen kan ikke åbnes for rådgivere før da (K5).
- **[AFKLARES]** Indholdsloggen (`ai.gateway_payloads`, docs/08 §11.1) gemmer det sendte indhold,
  inkl. dokumentgrundlaget, mens L4 siger "log ikke dokumenttekst eller fulde prompts" (§16.20,
  punkt 1). Beslutning nødvendig før rigtig betadrift.
- **[AFKLARES]** Retentionsperioder for AI-logs og forbrugsrækker. Der er ingen juridisk godkendt
  periode, og ingen er opfundet (§16.19). Beslutning nødvendig før rigtig betadrift.
- **[AFKLARES]** Rigtige brugeres fritekst til Claude: restrisikoen ved indhold, redaction ikke
  finder, og databehandlingen (K7). Indtil da bruger L4b kun syntetiske testprompter (§16.20,
  punkt 2).
- **[AFKLARES]** Udledt: et HTTP-fejlsvar fra Anthropic faktureres ikke (§16.20, punkt 3).

---

## 12. L1 — retrieval-metoden `product_documents` (godkendt, B-036)

### 12.1 Database (`supabase/migrations/20261012000100_beta_document_retrieval.sql`)

Migrationen er fremadrettet. Ingen data ændres eller slettes, og hybride materialer og deres
fingeraftryk er uændrede.

- **Materialet:**

  ```
  {method: "product_documents", embedding: null, reranker: null,
   algorithmVersion: "product-documents-<n>", params: {maxChars}, chunkerVersions}
  ```

  - Valideres af `knowledge.document_retrieval_material_problem`.
  - `retrieval_material_is_development` er falsk for et gyldigt materiale og altid sand for et
    ugyldigt.
- **Registret:**
  - `embedding_model_id` er tom, netop når metoden er `product_documents` (constraint).
  - `record_evaluation_run`, `retrieval_configuration_problems`, `activate_retrieval_configuration`
    og `retrieval_context` er nye versioner af de seneste funktioner. De ændrer kun det, metoden
    kræver:
    - ingen modelopslag;
    - aktiveringen rører ingen embedding-model;
    - konteksten oplyser `method`;
    - modelkontrollen gælder kun hybride konfigurationer.
  - En kørsel, der brugte en anden metode end den erklærede, afvises. Vejen til drift er uændret:
    1. publisheren registrerer;
    2. et godkendt gate-sæt kræves;
    3. et menneske med `system.settings.manage` godkender og aktiverer.
  - En fejlet hård gate suspenderer straks.
- **`knowledge.product_document_chunks`:**
  - Kører som den indloggede bruger (security invoker), kun for `authenticated`.
  - Returnerer for ét produkt alle chunks i de publicerede versioner, der gælder på datoen og som
    brugeren må læse, inden for de valgte dokumenttyper og dokumenter, i dokumentrækkefølge.
  - `version_chunk_count` gør fuldstændigheden efterprøvelig.
  - Et grundlag over `maxChars` afvises (`54000`) og afkortes aldrig.
- **Publicering (K2):** `review_state` kræver embeddings, netop når en embedding-model er aktiv
  (`knowledge.publication_requires_embeddings`). Alle andre blokeringer og
  frigivelseskravet fra upload-sikkerheden er uændrede.

### 12.2 Applikation og evidens

- `runProductDocumentRetrieval` (`src/lib/knowledge/retrieval-core.ts`):
  - kræver netop ét produkt;
  - konstruerer hverken embedder eller reranker, og spørgsmålets tekst sendes ingen steder;
  - kontrollerer, at hver version er komplet (fail-closed);
  - markerer konflikter som i den hybride søgning og slår dem op i portioner på højst 200.
- `retrieveEvidence` vælger metoden ud fra konfigurationen i drift, aldrig ud fra forespørgslen.
  Uden konfiguration kører den hybride kode som i dag (udviklingsgrad).
- **Evidensmodellen (version 3):** bærer `retrieval.method`, og `retrieval.reranker` er `null`, når
  der ikke rangeres.
- **P1 og P2 er tilpasset kun for `product_documents`** (§5.1). P3–P9 er uændrede.
  `requireProductionEvidence` efterprøver metoden igen.
- **Admin** viser metoden i retrieval-status og i "Afprøv retrieval".

### 12.3 Evaluering

- **H6 for `product_documents`** (`evals/engine/observe.ts`):
  - metoden er den evaluerede;
  - der er hverken embedder eller reranker;
  - hver version i grundlaget er medtaget i fuld længde efter korpussets antal chunks;
  - uden antallet fejler H6.
- **H1–H5 og H7 er uændrede.**
- Fixture- og evalueringsmiljø-adapteren, CLI'en og operationen understøtter metoden.
- Publisherens regel for udviklingskonfigurationer spejler databasen.
- **Konfigurationsfiler:**
  - `product-documents-fixture.json`: kun til udvikling og CI.
  - `product-documents-structure-1.json`: betaens kandidat, budget 360.000 tegn, foreløbigt.

### 12.4 Fund

1. **Kvalitetsgates (bekræftet ved kørsel).** På det fiktive korpus med produkt pr. spørgsmål:
   - H1–H6 holder (H7 fejler i fixture-miljøet, som den skal).
   - Q4 fejler: ubesvarbare spørgsmål får produktets dokumenter.
   - Q7 kan ikke beregnes (ingen reranker).

   Afgjort i B-036: metoden har sit eget gate-sæt (§5.1).
2. **Evalueringssættet skal angive produktet pr. spørgsmål.** Eksempelsættet `example-v1` gør det
   ikke. Med D1–D6 afvises et sæt uden netop ét produkt pr. spørgsmål, før noget køres (L1.1).
   Betaens sæt (L9) skal derfor have produkt pr. spørgsmål.
3. **Fejl rettet: en kontekst uden aktiv embedding-model blev læst som "kunne ikke læses".** Det
   gjorde retrieval utilgængelig. Den mangel fandtes allerede i 8B (`retrieval.ts`). Nu betyder
   ingen aktiv model "ingen" (`activeModelFromContext`), som Admin og enhedstestene altid har
   forudsat. Det er nødvendigt for betaen, der ingen embedding-model har.
4. **Mutationstest.**
   - TypeScript: 21 af 22 fanget. Den ene er ækvivalent: genkontrollen i
     `requireProductionEvidence` kan ikke nås, fordi et udstedt sæt er frosset og allerede
     vurderet af P1–P9.
   - SQL: 11 af 13 fanget. Adgangsfiltret og statusfiltret i `product_document_chunks` blev vurderet
     som redundante med RLS. Fjernes begge, fanges det (S13).
   - L1.1 har efterprøvet de tre overlevende igen (§13.4). Vurderingen af S02 var forkert: for en
     forvalter er adgangsfiltret det eneste lag, og testen er tilføjet.

### 12.5 Verifikation (lokalt, frisk database)

- lint, typecheck (app og workers) og build bestået;
- 948 enhedstests: 944 bestået (51 nye), 4 sprunget over;
- pgTAP: 915 bestået (45 nye);
- integration: 161 bestået og 2 sprunget over (7 nye);
- alle migrations er afspillet fra bunden.

---

## 13. L1.1 — gate-sæt for `product_documents` og tre adskilte godkendelser (gennemført, afventer godkendelse)

### 13.1 Database

- **`20261013000100_beta_document_gates.sql`** (fremadrettet; ingen data ændres):
  - `evaluation_gate_sets.method` er afledt af definitionen, og K er tom, netop for
    `product_documents` (constraint);
  - `gate_set_problem` validerer et dokumentgate-sæt for sig, med låst metrik, retning og
    tærskel 1. Den hybride validering er uændret;
  - `eval_document_report_problems` genberegner D1–D6, de hårde gates, minimum, tier og afgørelsen
    fra rapportens egne observationer;
  - `record_evaluation_run` (rapportformat 6) afviser et gate-sæt for en anden metode;
    `retrieval_configuration_problems` og `retrieval_context` efterprøver det igen;
  - `check_gate_set_write` ser bort fra den afledte kolonne, der endnu ikke er beregnet i en
    BEFORE-trigger. Definitionen sammenlignes stadig.
- **`20261013000200_beta_acceptance.sql`:**
  - `ai.answer_quality_validations` og `ai.beta_release_approvals`;
  - funktionerne `record_answer_quality`, `validate_answer_quality`, `approve_beta_release`,
    `revoke_beta_release` og `beta_status`;
  - RLS: kun læsning for de relevante permissions. Skrivning kun gennem funktionerne, med en
    trigger som ekstra lag. Audit på alle handlinger.

### 13.2 Evaluering og gateway

- **Motoren** (`evals/engine`):
  - `GateSet` er hybrid eller dokument;
  - den forventede basis udledes af manifestet (`expectedBasis`);
  - dokumentobservation pr. spørgsmål, D-metrikker og D-gates;
  - H4 og H6 er tilpasset for metoden;
  - binding mellem gate-sæt og metode (`assertGateSetFits`);
  - rapportformat 6 og verifikation før publicering;
  - adapterne leverer chunkenes sha256 (`chunkDigests`), så afkortning kan ses;
  - CLI'en vælger gate-sæt efter konfigurationens metode.
- **Data:**
  - `gates/product-documents-gates-v1.json` og `schema/document-gates.schema.json`;
  - eksempelsættet `example-documents-v1` med ét produkt pr. spørgsmål. CI kører det, og det
    fejler H7 i fixture-miljøet, som det skal;
  - acceptkriterierne i `evals/acceptance/beta-answer-acceptance-v1.json` og
    `evals/engine/acceptance.ts`.
- **Gatewayen** afviser et `product_documents`-grundlag, der ikke kan sendes samlet
  (`document_basis_too_large`). Den hybride top-K er uændret.

### 13.3 Hvad er bevaret

H1–H7, P1–P9, `gates-v1` (Q1–Q7) og hybride rapporters genberegning er uændrede for den hybride
metode. Registret, publisherens isolation, godkendelse og aktivering af et menneske,
suspendering ved fejlet hård gate, pilot-scope (B-030/B-031), RLS og egress-grænsen er uændrede.

### 13.4 Mutationer

**De tre overlevende fra L1:**

| | Mutation | Hvorfor den overlevede | Håndtering |
|---|---|---|---|
| T22 | Genkontrollen af metoden i `requireProductionEvidence` fjernet | Kan ikke nås med en forkert metode: P1/P2 afgjorde graden ved udstedelsen, et udstedt sæt er dybfrosset, og en kopi er ikke udstedt | **Ækvivalent.** Bevist med tests af frysningen, kopien og P1/P2 ved udstedelsen. Bevidst overlappende lag |
| S02 | Adgangsfiltret i `product_document_chunks` fjernet | L1 vurderede det redundant med RLS. **Forkert for en forvalter:** RLS lukker alle versioner igennem, og filtret er det eneste lag, der håndhæver læseretten | **Reelt hul i testene, lukket.** En redaktør uden læseret får intet. Mutationen fanges nu |
| S04 | Statusfiltret i `product_document_chunks` fjernet | `can_read_version` i adgangsfiltret kræver selv `published` for alle roller | **Ækvivalent, så længe adgangsfiltret findes.** pgTAP viser, at `can_read_version` afviser upublicerede versioner også for en forvalter, og at funktionen aldrig udleverer dem. Fjernes begge, fanges det (S13). Bevidst overlappende lag |

**L1.1:**
- TypeScript: 27 af 27 fanget. Tre overlevede først (D3 uden digests, D4's "uventede" halvdel og
  historisk læseret i den forventede basis). Testene er tilføjet.
- SQL: 22 af 22 fanget. To overlevede først (D4's "uventede" halvdel i SQL og afvisning i "fuldt
  korrekt"). Testene er tilføjet.

### 13.5 Verifikation (lokalt, frisk database)

- lint, typecheck (app og workers) og build bestået;
- enhedstests: 1000 bestået (56 nye), 4 sprunget over;
- pgTAP: 1005 bestået (90 nye);
- integration: 163 bestået, 2 sprunget over;
- evalueringsdata: datavagten består. Fixture-kørslerne af `example-v1` (hybrid) og
  `example-documents-v1` (D1–D6 bestået, H7 fejler i fixture-miljøet) slutter begge med kode 1, som
  CI tillader;
- alle migrations er afspillet fra bunden.

---

## 14. L2 — AWS fjernet fra den aktive beta og skjulte områder (gennemført, afventer godkendelse)

Beslutning: B-037. Ingen migration, ingen ændring i hosted Supabase og ingen betalbare ressourcer.

### 14.1 Fjernet

- **Kode:**
  - `src/lib/knowledge/providers/bedrock/*` (Embed v4, Rerank 3.5, transport og SDK-transport);
  - credential-vejene (`aws-credentials.ts` og `credentials-{vercel,container,environment}.ts`);
  - `catalog.ts`, `runtime.ts` og `provider-metrics.ts`;
  - workerens falske Bedrock-transport;
  - evaluerings-CLI'ens `--providers bedrock` og `--capture-control-reference`;
  - registrets undtagelse `createEvaluationBaselineReranker` ("none" i enhver runtime, kun til
    Bedrock-evalueringen).
- **Afhængigheder:**
  - `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/credential-provider-env`,
    `@smithy/credential-provider-imds` og `@vercel/oidc-aws-credentials-provider`. 46 pakker er ude
    af lockfilen;
  - workerens image har kun `postgres` og `pdfjs-dist`.
- **Udrulning:**
  - `deploy/application`, `deploy/evaluation`, ECS-taskdefinitioner, services, security groups,
    Cloud Map, IAM-politikker og CloudWatch-alarmer for ClamAV og workeren;
  - workflows `clamav-signatures.yml` og `retrieval-evaluation.yml`;
  - ECR-push og OIDC i `clamav-engine-candidate.yml`.
- **Konfiguration:**
  - `IPA_DEV_FAKE_BEDROCK`;
  - AWS-afsnittene i `.env.example`;
  - Bedrock-konfigurationerne i `evals/retrieval/configurations`;
  - de Cohere-specifikke protokolkonstanter i egress-politikken.

Den hybride metode findes stadig i koden, men kan ikke give production-evidens. En hybrid
konfiguration med en production-udbyder afvises af registret (fail-closed).

### 14.2 Bevaret

- **Upload-sikkerhed:**
  - karantæne;
  - strukturvalidering og PDF-inspektion;
  - ClamAV 1.4.6 med friske officielle signaturer, verdict i databasen og frigivelse.

  Scanneren kører nu som egen container i `deploy/import/compose.yaml`. Den har intet miljø, ingen
  credential og intet internet: den er kun på det interne net `scan`. Den bygges på den godkendte
  motor efter digest. Workeren når den kun på `clamav:3310`.
- **Workeren:**
  - least-privilege-rollen og blue/green-login;
  - service-role-nøglen afvises i produktion;
  - kontrollen af embedding-modeller ved start;
  - kontrolsættet (C6);
  - sundhedskontrollen.
- **Uændret i øvrigt:**
  - RLS og permissions;
  - faglig dokumentgodkendelse;
  - AI Gateway og egress-grænsen. Allowlisterne er tomme, indtil Claude-adapteren (L4) tilføjes;
  - registret, godkendelse og suspendering af evalueringer;
  - historiske versioner og alle migrations.
- **De aggregerede alarmer (B-033)** er version 2: retrieval-alarmerne A1 og A3–A5 og
  enkelthændelserne.

### 14.3 Leverandøruafhængige krav flyttet før sletning

| Fjernet eller ændret test | Leverandøruafhængigt krav | Nu testet i |
|---|---|---|
| `knowledge-providers.test.ts` | Implementeringer erklærer sig selv; fejltyper, timeouts og genforsøg; ingen fallback ved udbyderfejl; fingeraftrykkets materiale | `provider-contract.test.ts` |
| `knowledge-providers-boundary.test.ts` | Kun forespørgslens tekst og passagernes overskriftskæde og tekst gives til en udbyder; ingen id'er, titler, produkter eller kilder; workerens dokumentembedding | `provider-contract.test.ts` |
| `provider-metrics.test.ts` | Fejltypen når log-linjerne uden udbyderens besked; retrieval- og worker-linjen; alarmspecifikationen bruger felter, koden skriver | `provider-contract.test.ts` |
| `worker-production-embedder.test.ts` | Workeren starter ikke med en model uden implementering, en udviklingsmodel i produktion eller en forkert dimension; aldrig testembedderen i stedet | `provider-contract.test.ts` |
| `application-aws-credentials.test.ts` | Ingen klientkomponent når udbyder-, registry-, retrieval- eller egress-koden; ingen nøgle i `NEXT_PUBLIC_`-variabler | `provider-contract.test.ts` |
| `embedding-control-set.test.ts` | Kontrolsættet (C6) | Samme fil, med en udbyderdobbelt i stedet for Bedrock-adapteren |
| `egress-boundary.test.ts` | Nul eksterne kald ved afvisning; proveniens fra retrieval til embedding og reranking; ingen vej uden om grænsen | Samme fil, med en ekstern udbyder, der følger adapterkontrakten |
| `egress-architecture.test.ts` | Kun tilladte transporter; autorisation før kald; ingen AI- eller cloud-SDK | Samme fil. Allowlisterne er tomme |
| `scanner-isolation.test.ts` | Egen container; intet miljø eller credential; internt net uden udgang; fast endpoint; godkendt motor efter digest; friske officielle signaturer | Samme fil, mod `deploy/import/compose.yaml` |
| `worker-runtime-architecture.test.ts` | Non-root, read-only, ingen capabilities, kun `/tmp`; ingen indgående trafik; credential kun fra operatørens miljø; stop-frist længere end workerens | Samme fil, mod `deploy/import/compose.yaml` |
| `production-evidence.test.ts`, `knowledge-evidence-guardrail.test.ts` | P1–P9 hver for sig, kopier og forfalskninger | Samme filer. Den positive vej bruger `product_documents`. Hybride sæt med erklærede doubler fejler netop P1 og P2 |
| `evaluation-operations.test.ts` | Evalueringen og publiceringen deler aldrig credential | Samme fil, i koden (miljøvariabler) frem for workflow og IAM |
| `evaluation-operations.integration.test.ts` (C7) | Indlæsning, retrieval og evaluering er enige om konfigurationen, og alle hårde gates består | Samme fil, med `product_documents` ende til ende: metoden bruger ingen embeddings, og H1–H7 og D1–D6 består |
| `retrieval-configuration.integration.test.ts` | Registret og P3–P9 mod den rigtige database | Samme fil. Hybrid fejler netop P1 og P2 |

Krav, der kun gjaldt AWS, er fjernet med AWS. Det gælder IAM-rollernes indhold, OIDC-tillid,
statiske AWS-nøgler, ECS-deployment og CloudWatch-alarmernes navne.

### 14.4 Skjulte områder i betaen

`src/config/beta-surface.ts` (`BETA_HIDDEN_AREAS`) skjuler Advise, Analytics og Min profil for
alle roller, uanset permissions:

- proxyen svarer 404 på områdernes stier, før noget gengives, eller en server-action kører;
- siderne svarer 404 igen på serveren (`requireArea`), før der indlæses data;
- server-actions afviser (`sessionInArea`);
- de optræder ikke i navigationen, søgningen, brugermenuen eller på Home;
- layoutet og Home indlæser ingen kundecases.

Copilot, Learn, Practice, Assessment, Home og Admin er uændrede. Demoen uden login (B-003) er ikke
betaen og beholder alle områder. Gatewayens spærre mod kundesagsdata er uændret.

### 14.5 Fund

1. **Kontrolsættet var fjernet ved en fejl og er genskabt.** B-035 §2.1 siger, at koden bliver, og
   koden er leverandøruafhængig.
2. **Overvågningsspecifikationen var fjernet ved en fejl og er genskabt som version 2.** Retrieval-
   alarmerne er leverandøruafhængige og kræves før piloten (B-033).
3. **Hybride positive P1–P9-tests kan ikke længere skrives** uden at registrere en testdobbelt som
   production-implementering. Det er bevidst fravalgt (B-037). P3–P9 vises med `unmet = [P1, P2]`.
4. **Udviklingsdata i betaen:** Home, Learn, Practice, Assessment og Admins afsnit om
   undervisningsindhold viser stadig udviklingsdata med notits, til L5–L8 erstatter dem. Betaen kan
   ikke åbnes for rådgivere før da (K5, §11).
5. **Scanneren verificeres før import** med `scripts/verify-clamav-scanner.ts` (EICAR, motor og
   signaturalder) som et trin i runbooken. Uafhængigt heraf afviser hver scanning signaturer over
   24 timer, og databasen registrerer kun verdicts fra en godkendt motor. *Lukket i L3 (§15.5).*
6. **Workerens base-image** skal låses efter digest før den første rigtige import. *Lukket i L3:
   låst efter digest (§15.5).*

### 14.6 Mutationer

TypeScript og specifikation: **35 af 35 fanget.** De dækker:
- de skjulte områder (19): overflade og stier, proxy, sider, server-action, søgning, layout, Home,
  navigation og brugermenu;
- registrets fail-closed for production-udbydere og "none" (4), herunder at `product_documents`
  ikke får udbydere, og at kun registrerede implementeringer er production;
- workerens scanner-endpoint og kontrollen af embedding-modellen (2);
- compose-specifikationens isolation (8): internt net, ingen udgang og ingen offentliggjort port
  for scanneren, intet miljø, motoren efter digest, ingen bogstavelig credential, ingen
  privilegier og en stop-frist længere end workerens;
- kontrolsættets krav til reference og egress-politikkens protokolkonstanter (2).

To huller blev fundet ved planlægningen og lukket før kørslen: et skjult link med forespørgsel
eller fragment (`/profile?…`), og Homes egne indgange til de skjulte områder.

L2 ændrer ingen SQL. pgTAP er kørt uændret.

### 14.7 Verifikation (lokalt, frisk database)

- lint, typecheck (app og workers) og build bestået;
- enhedstests: 931 bestået, 4 sprunget over. Der var 1000 i L1.1. Forskellen er de fjernede
  AWS-tests, hvis leverandøruafhængige krav nu står i nye eller ændrede tests (§14.3);
- pgTAP: 1005 bestået (uændret);
- integration: 161 bestået, 2 sprunget over. Rutetestene viser 404 for de skjulte områder, og
  `product_documents` er kørt ende til ende i evalueringsmiljøet;
- evalueringsdata: datavagten og kontrolsættet består. Fixture-kørslerne af `example-v1` og
  `example-documents-v1` slutter med kode 1, som CI tillader;
- `docker compose -f deploy/import/compose.yaml config` validerer specifikationen. Den afviser at
  starte uden workerens credentials i operatørens miljø;
- ingen migration, ingen ændring i hosted Supabase, ingen betalbare ressourcer og ingen
  Claude-kald.


---

## 15. L3 — sikker dokumentimport uden AWS (godkendt, B-039)

Importen er den enklest mulige administratorimport til 40–100 PDF'er. Den genbruger den eksisterende
sikkerhedskæde uændret og bygger ikke en parallel pipeline. Runbooken for administratoren er
`docs/import-runbook.md`.

### 15.1 Hvad er bygget

| Del | Fil | Indhold |
|---|---|---|
| Importen | `workers/import/` | Importliste, kontrol, upload og registrering, status og bevis for fuldstændighed. Ingen dependencies |
| Containerspecifikationen | `deploy/import/compose.yaml` | Ny tjeneste `import`. Scanner og worker er uændrede i isolation |
| Operatørens script | `deploy/import/ipa-import.sh` | Trinene `forbered`, `produkter`, `kontroller`, `importer`, `status` og `stop` |
| Indstillinger | `deploy/import/ipa-import.env.example` | Skabelon uden adgangskoder |
| Image | `deploy/ingestion-worker/Dockerfile` | Samme image til worker, import og scannerkontrol. Base-image låst efter digest |
| Scanner | `deploy/clamav/clamd.conf` | `TCPAddr 0.0.0.0`, så sundhedskontrollen virker uden IPv6 (§15.8) |
| CI | `.github/workflows/ci.yml` | Jobbet `import-scanner` bygger den rigtige scanner og kontrollerer den (signaturer op til 24 timer i CI; importen kræver 8 timer, §15.5) |

### 15.2 Kæden

PDF → karantæne (`knowledge-intake`) → validering → ClamAV → sikkerhedsvurdering i databasen →
frigivelse (samme SHA-256) → tekstudtræk → registrering → faglig godkendelse i Admin → publicering.

Importen er en ny klient af den eksisterende uploadvej:
- **Importen** logger ind som operatørens egen administratorkonto gennem platformens offentlige API.
  Den uploader til karantænen og kalder `knowledge.register_upload` som Admin-uploaden. Bucket-
  politikkerne, RLS og databasefunktionerne afgør adgangen, og auditloggen navngiver operatøren.
  Importen afviser en service-role- eller hemmelig nøgle.
- **Importen læser aldrig dokumenternes tekst og parser aldrig en PDF.** Den beregner kun SHA-256
  og uploader. Indholdet behandles først i workeren efter frigivelsen og er data, aldrig
  instruktioner.
- **Workeren** scanner, frigiver og udtrækker uændret som sin least-privilege login-rolle.
- **Intet godkendes eller publiceres automatisk.** Importen kalder kun `register_upload` som
  skrivende funktion. En arkitekturtest håndhæver det.

Ingen migration, ingen ny databasefunktion og ingen ændring af sikkerhedskæden.

### 15.3 Importliste, idempotens og genoptagelse

**Importlisten** (`importliste.csv`) har én række pr. PDF. Kolonnerne er beskrevet i runbookens
trin 3. Hver række valideres to gange:
- med Admin-uploadens egen validering (`src/lib/knowledge/upload-validation.ts`);
- mod datamodellen: produktet findes og er aktivt, dokumenttypen er en af de otte, og et angivet
  dokument findes.

Importen gætter aldrig. Et produkt angives med id, og en dokumenttype med nøgle eller præcist navn.
Ukendte kolonner afvises. **Selskab/udgiver** har intet felt i datamodellen. En kolonne for det
afvises i stedet for at blive ignoreret stiltiende **[AFKLARES]**.

`version` og `gyldig_fra` er påkrævede, fordi godkendelsen kræver dem (`knowledge.review_state`).

**Idempotens:** en fil, hvis SHA-256 allerede findes som version, sendes aldrig igen
(`knowledge.find_versions_by_checksum`). En gentaget import opretter derfor ingen ny version, heller
ikke fra en anden maskine eller uden journal.

**Genoptagelse:** journalen (`import-journal.json` i rapportmappen) skrives atomisk, før noget
sendes. Den holder kun id'er, SHA-256 og filnavne. En import, der afbrydes efter upload og før
registrering, fortsætter med samme id'er. Afbrydes den efter registrering, findes filen på sin
SHA-256. En worker, der stoppes midt i et job, mister sin lease, og næste kørsel tager jobbet over
(8B-I4). Ingen afbrydelse fører til publicering.

### 15.4 Bevis for fuldstændighed

`status` beviser for hver frigivet version (`workers/import/completeness.ts`):
- **Originalen** i `knowledge-originals` har samme SHA-256 som filen i importmappen og som den
  registrerede version. Downloaden er auditeret.
- **Siderne** er præcis 1..N, hvor N er PDF'ens sideantal. Hver side har tekstlag, og N svarer til
  `sider` i importlisten, når kolonnen er udfyldt.
- **Rækkefølgen:** sider og tekstsegmenter følger dokumentets rækkefølge, og hver side med tekst er
  dækket af et segment.
- **Identiteten:** produkt, dokumenttype, titel, version, gyldighed, sprog og filnavn er dem i
  importlisten.

En version, der fejler et af punkterne, vises som "Ufuldstændig – kan ikke godkendes". Databasen
blokerer uafhængigt godkendelsen af ulæste sider (`pages_unread`). Status viser også tegnene pr.
version til betaens budget (§5.3) og adgangstildelingerne.

### 15.5 Docker og isolation

- **Scanneren** er uændret: egen container, kun på det interne net `scan`, ingen miljøvariabler,
  ingen credentials, ingen offentliggjort port, read-only, uden capabilities. Kun workeren når den.
- **Scannerkontrollen** kører i workerens tjeneste, som er den eneste, der når scanneren
  (`scripts/verify-clamav-scanner.ts`). Den kræver:
  - den godkendte motor 1.4.6;
  - signaturer under 8 timer;
  - at EICAR bliver fundet, og at en ren fil er ren.

  Den kører ved `forbered` og igen før hver `importer`. Importen angiver ingen grænse, så kontrollens
  standard på 8 timer gælder. CI-jobbet `import-scanner` kører den samme kontrol med
  `--max-age-hours 24`. Det er ren testkonfiguration, som beviser, at den rigtige scanner bygges,
  starter og scanner. Det påvirker aldrig importen eller runtime (præcisering af B-038, 14. oktober
  2026; `src/tests/import-signature-age.test.ts`).
- **Scanneren bygges uden cache** før hver import. Et cachet `freshclam`-lag ville ellers genbruge
  gamle signaturer (§15.8).
- **Importen** kører som tjenesten `import`:
  - kun på `egress`, uden databasecredential;
  - som operatørens bruger-id;
  - read-only med importmappen skrivebeskyttet;
  - den skriver kun rapporter og journal.
- **Adgangskoder** spørges om af scriptet og findes kun i kørslens containere. De står aldrig i
  indstillingsfilen, og scriptet afviser en fil med en adgangskode. De står heller aldrig i repoet,
  i et image eller i en log.
- **Workerens base-image** er låst efter digest (lukker §14.5 pkt. 6). `.dockerignore` udelukker
  PDF'er og importlister fra enhver build.

### 15.6 De ni sikkerhedstests

Alle filer er syntetiske. Ingen rigtige forsikringsvilkår er brugt.

| # | Krav | Test |
|---|---|---|
| 1 | Ren PDF scannes og når faglig godkendelse | Docker, stand-in med friske signaturer: frigivet, komplet, godkendt af en person og læst tilbage. Integration: det samme med udviklingsscanneren. Den rigtige motor med friske officielle signaturer: CI-jobbet `import-scanner` (ren fil ren, EICAR fundet) |
| 2 | EICAR afvises | Docker, rigtig ClamAV 1.4.6 med officielle signaturer: EICAR i et arkiv kaldet `.pdf` afvises som malware. Verdict fra ClamAV 1.4.6 |
| 3 | Scanner utilgængelig → blokeret | Docker, rigtig ClamAV: scanneren stoppes, `scan_failed`/`scanner_unavailable`, ingen sider |
| 4 | Signaturer for gamle → blokeret | Docker, rigtig ClamAV med officielle signaturer ældre end 24 timer: scannerkontrollen afviser, og en ren fil frigives ikke (`stale_signatures`) |
| 5 | Fil ændret efter scanning → frigivelse afvises | Docker og integration: bytes udskiftes mellem verdict og frigivelse. Verdict ugyldiggøres (`checksum_changed`), ny scanning afviser (`checksum_mismatch`) |
| 6 | Ødelagt PDF afvises | Docker og integration: afkortet PDF afvises eller kan ikke behandles. Ingen sider |
| 7 | Krypteret PDF afvises | Docker og integration: afvist som ugyldig PDF efter politik `pdf-v1` |
| 8 | Gentaget import → ingen dobbeltpublicering | Integration og Docker: intet sendes igen, ingen ny version. Enhed: også uden journal |
| 9 | Delvist fejlet import → sikker genoptagelse | Integration: afbrudt efter upload og efter registrering. Docker: workeren dræbes midt i en scanning. Ingen ny kopi, intet publiceret |

**Hvorfor en stand-in.** Sandkassen kan ikke nå `database.clamav.net`, fordi netværkspolitikken
afviser værten. Docker-testen bruger derfor de officielle signaturer fra det officielle image
`clamav/clamav:1.4.6`, som var omkring 3 døgn gamle. Det giver de rigtige test 2–4. Hvor friske
signaturer er nødvendige, bruger testen en tydeligt markeret clamd-protokol-stand-in
(`src/tests/fixtures/clamd-stand-in.mjs`) på samme endpoint. Den rigtige motor med friske officielle
signaturer kontrolleres i CI-jobbet `import-scanner` og af operatøren før hver import.

### 15.7 Hostede forudsætninger (ikke udført)

Hosted Supabase "IPA" er ikke ændret. Før den første rigtige import skal en person med adgang:
1. anvende migrationerne på projektet;
2. deploye Edge Function `worker-storage` med dens hemmeligheder;
3. sætte en adgangskode på workerens login-rolle og forberede den (`ops.ingestion_worker_prepare`);
4. lægge Supabases CA-certifikat i `deploy/ingestion-worker/certs/`;
5. oprette operatørens administratorkonto med `knowledge.document.write`;
6. oprette produkterne i Admin;
7. sikre, at operatørmaskinen kan nå projektet og `database.clamav.net`.

### 15.8 Fund

1. **Scannerens sundhedskontrol virkede ikke uden IPv6.** `clamdscan --ping` forsøgte IPv6
   "localhost", og scanneren blev aldrig "healthy". Rettet med `TCPAddr 0.0.0.0` i `clamd.conf`.
   Scanneren er stadig kun på det interne net. Det officielle `clamdcheck.sh` kræver `nc`, som
   imaget ikke har.
2. **`docker compose build` gav ikke nødvendigvis friske signaturer.** Lagcachen genbruger
   `freshclam`-laget. Scriptet bygger scanneren med `--no-cache`, og scannerkontrollen afviser
   signaturer over 8 timer.
3. **`docker compose` kræver alle tjenesters indstillinger,** også i trin, der ikke starter
   workeren. Scriptet giver de trin en pladsholder, som workeren ville afvise, så workerens
   adgangskode kun spørges om, hvor workeren kører.
4. **En separat scannerkontrol-tjeneste uden credentials blev overvejet og fravalgt.** Den ville
   gøre en anden container til medlem af `scan` og dermed ændre reglen fra L2 om, at kun workeren
   når scanneren.

### 15.9 Mutationer

**49 af 49 fanget.** De dækker:
- importlisten (7): ukendte kolonner, en selskabskolonne, der ignoreres, upræcis dokumenttype,
  valgfri version og gyldighed, filnavne med mappe og dokument samtidig med produkt;
- upload og genoptagelse (8): ingen dubletkontrol, journalen skrevet for sent, ingen genoptagelse,
  overskrivning, en ændret fil, et udgået produkt, godkendelse efter registrering og upload til
  `knowledge-originals`;
- API-klienten (4): service-role-nøgle, http i produktion, serverens tekst i loginfejlen og ingen
  logout;
- beviset (7): manglende sider, sider uden tekst, originalen ikke sammenlignet, sideantallet
  ignoreret, segmenternes rækkefølge, udækkede sider og produktet;
- journal og importmappe (4): ødelagt journal brugt, journal læsbar for andre, links fulgt og
  filer uden for mappen;
- containerspecifikationen og imaget (10): importen på `scan`, importmappen skrivbar, workerens
  adgangskode til importen, bogstavelig adgangskode, offentliggjort port, en anden container på
  `scan`, base-image uden digest, PDF'er i build-konteksten, ingen IPv4-binding og en ekstra
  netværksklient;
- operatørens script (6): scanner bygget med cache, ingen scannerkontrol før upload, læsbar eller
  adgangskodeholdig indstillingsfil og fortsat kørsel efter en fejlet kontrol eller import;
- status mod den lokale stak (3): ufuldstændig vist som klar, originalen ikke læst tilbage og
  afvist vist som ventende.

To huller blev fundet og lukket før den endelige kørsel:
- status kunne springe downloaden af originalen over uden at blive opdaget. Lukket med en test,
  der ændrer den gemte original;
- base-imagets digest var ikke kontrolleret. Lukket med en assertion.

### 15.10 Verifikation (lokalt)

- **lint, typecheck og build:** bestået, også typecheck af workers.
- **Enhedstests:** 965 bestået og 4 sprunget over. Der var 931 i L2. De fire er
  motorkandidat-testene, som kræver en kørende clamd. De er kørt særskilt mod den rigtige ClamAV
  1.4.6-container: 4 bestået.
- **pgTAP:** 1005 bestået, uændret, for L3 ændrer ingen SQL. Kørt på en frisk database og igen efter
  alle integrations- og Docker-tests.
- **Integration:** 168 bestået og 6 sprunget over. Der var 161 og 2 i L2. De seks er:
  - de fire Docker-tests, som kører på opfordring;
  - de to upload-sikkerhedstests mod en rigtig clamd.

  Begge grupper er kørt særskilt: Docker 4 af 4 bestået, og upload-sikkerhed mod den rigtige
  ClamAV 1.4.6 8 af 8 bestået.
- **Docker ende til ende:** 4 af 4 bestået med images bygget fra repoets Dockerfiles. To afvigelser
  er nødvendige i sandkassen:
  - workerens deps-trin stoler på sandkassens proxy-CA under `npm ci`. Runtime-trinnet er uændret,
    og det endelige image er kontrolleret uden CA'en;
  - scannerens signaturtrin tager de officielle signaturer fra det officielle image, fordi
    `database.clamav.net` er blokeret.
- **Ikke kørt her:** scannerens build med `freshclam`, fordi værten er blokeret. Den køres af
  CI-jobbet `import-scanner` og af operatøren med `forbered`.
- Ingen migration, ingen ændring i hosted Supabase, ingen betalbare ressourcer og ingen
  Claude-kald.

---

## 16. L4 — Claude-adapter, egress pr. profil, budget og forbrugsgrænser (gennemført, afventer godkendelse; B-039)

Specifikationen er godkendt til implementering 14. oktober 2026 (B-039). Den gengives her, så
repoet og ikke en chatlog er kilden. Implementeringen står i §16.14 ff.

L4 etablerer den fælles, sikre AI-infrastruktur for Copilot, Learn, Practice og Assessment. Advise
er udskudt. L4 bygger AI-infrastrukturen, men ikke de fire modulers funktionalitet (L5–L8). Målet er
en rigtig Anthropic Claude API-adapter, der virker gennem den eksisterende AI Gateway og kan
afprøves fuldt ud med fake transport.

**Ingen rigtige betalbare Claude-kald før L4b.** L4b kræver særskilt godkendelse.

### 16.1 Godkendelser og forudsætninger

- **L3 er godkendt** med grøn CI på commit `628430e`.
- **B-039:** betaen bruger projektejerens egen Anthropic Console-organisation med en dedikeret
  API-nøgle, som kun bruges af Insurance Partners. Det er hverken projektejerens Claude
  Code-session eller Claude-abonnement. Når IPA overtager platformen, udskiftes API-nøglen og den
  relevante model- og budgetkonfiguration uden ændring af forretningslogik.
- Betademonstrationer bruger kun syntetiske eller særskilt godkendte dokumenter og oplysninger,
  indtil dokumentrettigheder og databehandling er afklaret (§11, K7).
- Der bygges hverken et selvbetjeningssystem til API-nøgler eller understøttelse af flere
  AI-leverandører i betaen.

### 16.2 Teknologi og afgrænsning

- Next.js og TypeScript, Supabase Auth, PostgreSQL og RLS, Vercel, Anthropic Messages API, den
  eksisterende AI Gateway og retrieval-metoden `product_documents`.
- Ingen AWS, Bedrock, Fargate eller Cohere.
- Ingen implementering af L5–L8. Den faglige svarkontrakt og den endelige visning af citater hører
  til L5.

### 16.3 Adapteren

- Server-only adapter til Anthropics Messages API i det aktuelle, officielle API-format.
- **Model-id** er eksplicit konfigureret og verificeret mod officiel dokumentation. Intet modelvalg
  er hardcoded i forretningslogikken, og kun godkendte model-id'er kan bruges.
- Ingen automatisk fallback til en anden AI-model og ingen production-fallback til stubben.
- **API-nøglen** kommer fra servermiljøets secrets. Den findes aldrig i browserbundlen, Git,
  almindelige tabeller eller logs.
- **Timeout, fejlklassifikation og kontrollerede retries:**
  - 401, 403, 429, 5xx og netværksfejl håndteres hver for sig;
  - providerens `retry-after` respekteres;
  - der stoppes ved budgetfejl.
- Ingen rigtige API-kald i L4. Tests bruger fake transport.
- Adapteren genbruges af Copilot, Learn og Practice gennem de eksisterende gateway-profiler.
  Assessment følger fortsat sine særskilte prøveregler.

### 16.4 Gatewayen bevares

Al ekstern AI-kommunikation passerer:
- AI Gateway og permissions;
- profil- og matrixpolitik;
- `ClassifiedText`, `authorizeEgress`, `AuthorizedEgress` og `assertTransmittable`;
- dokumentrettigheder;
- budget og rate limiting;
- logging og audit.

Der findes ingen alternativ vej fra en route eller en UI-komponent direkte til Anthropic API.
Parringsreglen (B-012) bevares: en production-model får kun production-evidens. Copilot bruger den
aktive, godkendte `product_documents`-konfiguration og ikke et selvoplyst production-flag.

### 16.5 Data-egress og fritekst

- **Eksplicitte rækker** pr. profil og handling:
  - Copilot-produktspørgsmål;
  - Learn-forklaringer;
  - Practice-rollespil med fiktive scenarier;
  - Practice-feedback.
- **Ingen generel tilladelse** til al brugerindtastet fritekst.
- Sendes aldrig: kundesagsdata, konkrete kundepolicer, identificerbare kundeoplysninger,
  fortrolige samtalenoter og tekst med ukendt eller uautoriseret proveniens.
- Et regex-filter eller en afkrydsning af "ingen persondata" er ikke tilstrækkelig sikkerhed. Kan
  arkitekturen ikke sikre den nødvendige proveniens for fri tekst, afvises den konkrete overførsel.
  L4b begrænses derfor til kontrollerede, syntetiske testprompter, hvis den generelle
  fritekstproblematik ikke er løst.
- Ingen administrator-override kan ophæve spærren for kundedata.
- Dokumenttekst fra PDF'er er ubetroet kildemateriale og får aldrig systeminstruktionens autoritet.

### 16.6 Dokumentgrundlag og citationer

- Brugeren vælger et produkt. Systemet finder de komplette, publicerede, gyldige og
  adgangsgodkendte dokumentversioner. Claude modtager kun materiale, brugeren må anvende. Der sker
  ingen skjult afkortning.
- Metadata bevares: produkt-id, dokument-id, versions-id, titel, side, afsnit og kildeindhold.
- Anthropics officielle citationsfunktion bruges. De native citationsdata bevares i adapterens
  output og knyttes til de faktiske, udsendte dokumentversioner.
- Native citationer og streng JSON-struktureret output kan ikke kombineres i samme kald. Der vælges
  en dokumenteret, kompatibel strategi (§16.16).

### 16.7 Godkendte startgrænser

Grænserne er konfigurerbare startværdier til demo. De ændres via godkendt konfiguration uden at
ændre AI-forretningslogikken. Alle perioder beregnes i UTC.

| Grænse | Startværdi |
|---|---|
| Inputbudget pr. kald (systemprompt, dokumenter, samtalehistorik og metadata tæller med) | 100.000 tokens |
| Outputbudget pr. kald | 3.000 tokens |
| AI-kald pr. bruger pr. minut | 3 |
| AI-kald pr. bruger pr. døgn | 20 |
| AI-kald globalt pr. minut | 10 |
| Aktive AI-kald pr. bruger | 1 |
| Samtidige AI-kald globalt | 3 |
| Budget globalt pr. døgn | 10 USD |
| Budget globalt pr. kalendermåned | 30 USD |
| Budget pr. bruger pr. døgn | 2 USD |

- Overstiger et kald modellens reelle kapacitet eller vores eget loft, afvises det sikkert.
- **Udviklingsloftet på 360.000 tegn** (§5.3) erstattes som autoritativ kontrol af en tokenbaseret
  budgetmekanisme. Modelafhængig tokenoptælling bruges, når den rigtige API-forbindelse aktiveres.
  En lokal tokenestimator må bruges til foreløbige kontroller, men fremstilles aldrig som nøjagtig
  provideroptælling.

### 16.8 Budgetmekanismen

- Databasebaseret og transaktionel, så den virker på tværs af samtidige Vercel-instanser.
- Den konservativt estimerede maksimale omkostning reserveres før modelkaldet og afstemmes efter
  den kendte, faktiske usage.
- Der tages højde for inputtokens, outputtokens, cache read, cache creation, retries, samtidige
  kald og fejlede og afbrudte kald.
- Ukendt modelpris eller ukendt maksimal omkostning fejler lukket.
- En reservation frigives ikke ukritisk efter en netværksfejl, hvis provideren muligvis har
  behandlet kaldet.
- Retries giver hverken dobbeltbetaling eller dobbeltregistrering.
- En manglende eller fejlende budgetdatabase fører aldrig til ubegrænset AI-forbrug.
- Konkurrente kald og budgetgrænser testes med fake transport.
- **L4b-forudsætning:** projektets månedlige grænse sættes også uafhængigt i Anthropic Console.

### 16.9 Prompt caching

Caching er kun tilladt, hvis:
- versionen er korrekt;
- RLS kontrolleres igen ved hvert kald;
- en ændret version ikke genbruger en forkert cache;
- forskellige brugeres rettigheder respekteres;
- usage og omkostning registreres korrekt.

Det er acceptabelt at gøre adapteren cache-klar uden at aktivere caching i L4. Ingen ekstra kompleks
cache-infrastruktur.

### 16.10 Profiler

- **Copilot:** kun autoriserede, godkendte vilkår og godkendt evidens. Citater, undtagelser og
  forbehold kommer i L5.
- **Learn:** forklaringer med grundlag i kilderne.
- **Practice:** fiktivt rollespil og feedback. Den server-side spærring af Copilot under rollespil
  består, men den autoriserede Practice-profil skal kunne virke under en aktiv rollespilssession.
- **Assessment:** spærringen af AI-hjælp under prøver bevares. Resultatgivende scoring overlades
  ikke til frie Claude-vurderinger.

### 16.11 Logging og retention

- **Struktureret log:**
  - request-id og en brugerreference uden direkte persondata;
  - AI-profil, model-id, udfald og latency;
  - tokenforbrug og cache-usage;
  - estimerede og faktiske omkostninger;
  - budgetstatus, rate-limit-status og fejlkategori.
- **Logges ikke:** dokumenttekst, rå brugerforespørgsler, fulde prompts, API-nøgler, kundedata og
  fortrolige fejlbeskeder fra provideren.
- Logopbevaring og sletningsmekanisme dokumenteres. Er en konkret retentionsperiode ikke juridisk
  godkendt, opfindes der ingen virksomhedspolitik. Dataopsamlingen begrænses, og beslutningen
  markeres som nødvendig før rigtig betadrift.

### 16.12 Testkrav (fake transport)

1. En godkendt Copilot-request kan passere gatewayen.
2. Kundesagsdata blokeres før transport.
3. Ukendt proveniens blokeres.
4. Ikke-godkendt evidens blokeres.
5. Ikke-autoriserede dokumenter blokeres.
6. Et forkert model-id afvises.
7. En manglende API-nøgle afvises.
8. API-nøglen findes ikke i browserbundlen.
9. Brugerens rate limit håndhæves.
10. Den globale rate limit håndhæves.
11. De daglige budgetter håndhæves.
12. Det månedlige budget håndhæves.
13. Samtidige kald kan ikke omgå budgetterne.
14. Tokenbudgettet håndhæves uden stille afkortning.
15. Timeouts og 429/5xx håndteres korrekt.
16. Retries kan ikke omgå reservationer.
17. Prompt injection kan ikke ændre autorisationsbeslutningen.
18. Native citationer kan knyttes til udsendt evidens.
19. Assessment-låsen bevares.
20. Practice-profilen kan senere virke under rollespil uden at åbne Copilot.
21. Ingen følsomme oplysninger i logs.
22. Ingen stub-model som production-fallback.
23. Ingen faktiske betalbare Anthropic-kald.

Dertil mutationstests af egress, modelvalg, budget og rate limiting. Lint, typecheck, build, unit,
pgTAP, integration og CI køres.

### 16.13 Leverance og stop

- Arbejdet sker på `beta/fast-beta-without-aws`. Ingen direkte merge til `main`.
- Ingen hostede Supabase-migrations, ingen rigtige Claude API-kald, ingen rigtige
  forsikringsdokumenter og ingen betalte cloudressourcer.
- Commit og push med grønne tests. Der stoppes efter L4.

### 16.14 Hvad er bygget

| Del | Fil | Indhold |
|---|---|---|
| Adapter | `src/lib/ai/providers/anthropic/model.ts` | Claude-modellen (grad production): reservation, tokenoptælling, forsøg, afstemning. Ingen fallback |
| Transport | `src/lib/ai/providers/anthropic/transport.ts` | Det eneste modul, der taler med Anthropic. Officielt SDK, fast host, ingen SDK-retries, ingen SDK-log. `assertTransmittable` før hvert kald |
| Request og svar | `request.ts`, `response.ts`, `api-types.ts`, `errors.ts` | Dokumentblokke med citationer, deterministisk konvertering til outputkontrakten, normaliserede fejl |
| Konfiguration | `config.ts`, `server.ts` | Model-id fra `IPA_AI_MODEL`, nøglen fra servermiljøet (server-only), valgfri `IPA_AI_EFFORT` |
| Instruktioner | `src/lib/ai/core/instructions.ts` | Alle faste instruktionstekster, der må forlade platformen (reviewet kode) |
| Egress | `src/lib/egress/policy.ts` | Rækker pr. formål (`GENERATE_PURPOSES`), Anthropics protokolkonstanter |
| Gateway | `gateway-core.ts`, `invoke.ts`, `registry.ts`, `gateway.ts` | Ledger og formål ind i kaldet, tokenbudget for `product_documents`, struktureret log |
| Forbrug | `src/lib/ai/core/usage.ts`, `src/lib/ai/usage-ledger.ts` | Ledger-interface, faste brugerbeskeder, lokal estimator |
| Database | `supabase/migrations/20261014000100_ai_usage_limits.sql` | `ai.usage_limits`, `ai.model_prices`, `ai.usage_reservations` og funktionerne. Kun lokalt; ingen hostet migration |
| Bundle-kontrol | `scripts/check-client-bundle.ts`, CI | Builden med en sentinel-nøgle scannes for nøgle, variabelnavn, SDK og API-host |
| Dependency | `@anthropic-ai/sdk` 0.131.0 | Låst version (to uger gammel ved valget). Kun transporten importerer den |

### 16.15 Kæden for ét kald

```
runAiRequest (server-only) → authn → profil/handling → permissions → gating (G1/G2)
  → redaction og proveniens (userText) → registry (IPA_AI_MODEL; ingen fallback)
  → retrieval som brugeren (RLS, product_documents) → evidenskrav
  → minimering: hele grundlaget eller intet; lokal estimering mod tokenloftet
  → matricen (model × kategori) → invokeModel: parringsregel (kun production-evidens),
    authorizeEgress for formålet <profil>.<handling> inkl. dokumenttitler
  → adapter: request bygges → assertTransmittable (før reservation)
    → ai.reserve_usage (rate limits, samtidighed, budgetter, én global lås)
    → count_tokens (udbyderens optælling) → over loftet: frigiv og afvis
    → ai.begin_attempt → messages (højst max_attempts forsøg)
    → ai.settle_usage / release_usage / mark_usage_uncertain
  → outputkontrakt (uændret) → re-identifikation → ai.record_call → struktureret log
```

- Der er ingen anden vej til Anthropic. Arkitekturtesten tillader netværk og SDK i præcis ét
  modul, transporten, og kræver kontrollen før hvert kald.
- **Modelvalg er konfiguration.** `IPA_AI_MODEL` vælger modellen. Den kan kun bruges, når databasen
  har godkendt den med en verificeret pris (`ai.model_prices`, med kilde og dato), og
  datakategori-matricen har regler for den. Migrationen indsætter ingen modeller. Uden godkendt
  pris afviser databasen kaldet, før noget sendes.
- **Ingen fallback.** En ufuldstændig konfiguration, fx en manglende nøgle, gør gatewayen
  utilgængelig. Den bliver aldrig til stubben eller en anden model.
- **Nøglen** læses kun i `server.ts` (`import "server-only"`). Den gives kun til transporten.
  Host, nøgle og auth er faste i transporten, så `ANTHROPIC_*`-miljøvariabler ikke kan omdirigere
  dem. I `IPA_RUNTIME_ENV=test` afviser transporten den rigtige `fetch`.

### 16.16 Citationsstrategi

Anthropics native citationer og streng JSON-output kan ikke kombineres i samme kald (officiel
dokumentation: 400-fejl). Valgt strategi:

- **Én dokumentblok pr. dokumentversion** med `source.type = "content"` og `citations.enabled`.
  Hvert sendt uddrag (chunk) er én indholdsblok. Titlen er dokumentets titel og version; den
  faste kontekst siger, om versionen er gældende, historisk eller fremtidig, og om den har
  konflikter.
- Claude svarer i **almindelig tekst med native citationer**. En citation peger på
  (dokumentindeks, blokinterval) og knyttes til præcis de evidens-id'er, der blev sendt i de
  blokke, og til dokumentversionen.
- **Konverteringen er deterministisk** (`response.ts`) til den eksisterende outputkontrakt.
  En citation efter tekst bliver et `cite`-segment, og en tom linje starter et nyt afsnit. Copilot
  markerer svartype og historik på første linje. Learn markerer fiktive eksempler.
- **Kontrakttjekket er uændret.** En citation uden for de sendte dokumenter, et afsnit uden kilde,
  en manglende historikmarkering eller en uflagget konflikt gør svaret "kan ikke dokumenteres".
- **Native citationsdata bevares** i adapterens output. Med svaret logges placeringer og
  evidens-id'er, men ikke udbyderens kopi af den citerede tekst.
- Konverteringen er foreløbig. Den endelige svarkontrakt og visningen af citater hører til L5.
- Rollespilsreplikken har ingen dokumenter og ingen citationer.

### 16.17 Egress pr. profil og handling

Generering er tilladt pr. formål, aldrig generelt (`GENERATE_PURPOSES`):

| Formål | Spørgsmål | Kontekst (sidens etiket) | Evidens | Scenarie |
|---|---|---|---|---|
| `copilot.answer_question` | `user_question` | `user_question` | `knowledge` | — |
| `learn.explain` | `user_question` | `user_question` | `knowledge` | — |
| `practice.roleplay_turn` | `user_question` | — | — | `training_fictional` |
| `practice.feedback` | `user_question` | `user_question` | `knowledge` | — |

- Advise og Assessment har ingen række og intet eksternt format. De sender intet.
  Resultatgivende scoring overlades aldrig til Claude.
- Brugerens tekst er kun tilladt redigeret og aldrig sagsbundet. Et kald med en
  kundesagsreference afvises før transporten, og ingen matrix- eller administratorindstilling kan
  ændre det.
- Rollespillets fiktive scenarier (`training_fictional`) kommer fra databasen i L7. Rækken findes,
  men der er endnu ingen kilde til den.
- Systemprompten, formatinstruktionen og dokumentkonteksten er reviewede konstanter
  (`instructions.ts`). Dokumenttekst sendes kun som dokumentindhold og får aldrig systemprompten.

### 16.18 Budget og rate limits

- **Konfiguration** (`ai.usage_limits`, én række) har de godkendte startværdier fra §16.7. Den
  ændres med `ai.set_usage_limits` (kræver `system.settings.manage`). Priser og godkendte modeller
  ligger i `ai.model_prices` og ændres med `ai.set_model_price`. Hver ændring auditeres af en
  trigger, også en ændring direkte i SQL.
- **Reservation før afsendelse** (`ai.reserve_usage`) sker i én transaktion under én global
  advisory-lås, så samtidige Vercel-instanser ikke kan omgå grænserne. Rækkefølgen er:
  1. model og pris;
  2. outputloft;
  3. rate limits (de seneste 60 sekunder og UTC-døgnet);
  4. aktive kald (åbne, ikke udløbne reservationer);
  5. budgetter: bruger pr. UTC-døgn, globalt pr. UTC-døgn og globalt pr. UTC-kalendermåned.
- **Den reserverede omkostning** er inputloftet × inputprisen + outputloftet × outputprisen. Med
  prompt caching bruges cache-skriveprisen. Inputloftet er det mindste af vores loft, prisens
  gyldighed (fx en dyrere pris for lange prompts) og kontekstvinduet minus output.
- **Et budget tæller:**
  - afstemte kald med den faktiske omkostning (input, output, cache creation og cache read til
    priserne på reservationstidspunktet);
  - åbne og usikre kald med den fulde reserverede omkostning;
  - frigivne kald med 0.
- **Frigivelse** sker kun, når udbyderen beviseligt ikke behandlede kaldet:
  - et HTTP-fejlsvar;
  - en afvisning før afsendelse;
  - tokenoptællingen over loftet.
- **Netværksfejl og timeout** markerer reservationen som usikker. Den tæller fuldt, frigives
  aldrig og gentages ikke. Et afbrudt kald, der aldrig afsluttes, tæller også fuldt.
- **Retries:** 429, 529 og 5xx gentages efter udbyderens `retry-after` (højst 20 sekunder) eller en
  kort backoff. Det sker under samme reservation og højst `max_attempts` gange, hvilket databasen
  håndhæver (`ai.begin_attempt`). Andre HTTP-fejl stopper kaldet: 401/403 som konfiguration, 402 som
  budget og 400/404/413/422 som afvist. Ét request-id giver én reservation, så der sker ingen
  dobbeltregistrering.
- **Tokenbudget:** udbyderens egen tokenoptælling (`count_tokens`, gratis) afgør loftet, før
  beskeden sendes. Gatewayens lokale estimat (4 tegn pr. token, bevidst optimistisk) afviser kun
  et grundlag, der klart er for stort, før noget forlader platformen. Estimatet fremstilles aldrig
  som udbyderens optælling. Udviklingsloftet på 360.000 tegn (§5.3) er ikke længere den
  autoritative kontrol. Der afkortes eller udelades aldrig noget.
- **Fail-closed:** kan grænserne ikke læses, eller fejler reservationen, sendes intet. Fejler
  afstemningen, forbliver reservationen åben og tæller fuldt.
- **Ejerskab:** reservationens hemmelige token returneres kun til gatewayen og gemmes som SHA-256.
  En bruger kan hverken læse reservationerne, afslutte en andens reservation eller ændre
  grænserne. Kalder en bruger funktionerne direkte, bruger han kun af sine egne grænser.

### 16.19 Logging og retention

- **Struktureret log:** én JSON-linje pr. kald (`AiCallLogEntry`, `console.info` i Vercels
  runtime-log) med:
  - request-id og brugerreference (platformens bruger-id, intet navn eller e-mail);
  - profil, handling, model-id, udfald, årsagskode og fejlkategori;
  - latency;
  - tokens (optalt, input, output, cache creation og cache read);
  - reserveret og faktisk omkostning;
  - reservationens status, forsøg, udbyderens request-id og stop-årsag;
  - budget- og rate-limit-status.

  Den indeholder aldrig spørgsmålet, dokumenttekst, prompts, nøglen, kundedata eller udbyderens
  fejltekst. Transporten bevarer kun en fejlkode.
- **Forbrugsrækkerne** (`ai.usage_reservations`) har ingen tekst. Brugerne kan ikke læse dem.
- **Retention:** der slettes intet automatisk. Sletning af en bruger sætter rækkens bruger-id til
  null, så forbruget stadig tæller globalt. Runtime-loggens opbevaring følger Vercels plan.
  **[AFKLARES]** En retentionsperiode er ikke juridisk godkendt, og der er ikke opfundet en. Det
  skal besluttes før rigtig betadrift (§11).
- **Indholdsloggen** (`ai.gateway_payloads`) er uændret efter den låste docs/08 §11.1. Se §16.20,
  punkt 1.

### 16.20 Fund og afvigelser

1. **Konflikt med en låst beslutning (ikke ændret).** docs/08 §11.1 (B-014) kræver, at
   `ai.gateway_payloads` gemmer det, der blev sendt, og modellens rå svar. Med `product_documents`
   omfatter det:
   - hele dokumentgrundlaget;
   - systemprompten;
   - det redigerede spørgsmål.

   L4-specifikationen siger "log ikke dokumenttekst eller fulde prompts". Indholdsloggen er ikke
   ændret stiltiende. Den nye strukturerede log følger L4. **Beslutning nødvendig før rigtig
   betadrift.** Mulighederne er:
   - beholde §11.1;
   - gemme referencer (chunk- og versions-id'er er uforanderlige) i stedet for dokumenttekst;
   - ikke gemme indhold, før retention er besluttet.
2. **Fri tekst fra rigtige brugere er ikke løst** i den forstand, specifikationen kræver.
   Proveniensen er kendt: brugerens egen tekst, uden kundesag og redigeret. Men indholdet kan
   stadig rumme oplysninger, som redaction ikke finder, fx navne og adresser. Derfor:
   - L4b begrænses til kontrollerede, syntetiske testprompter (§16.5);
   - rigtige rådgiveres fritekst må først sendes til Claude efter en beslutning om restrisiko og
     databehandling (K7, §11).
3. **Udledt, til bekræftelse:** et HTTP-fejlsvar (429, 5xx, 529) betyder, at udbyderen ikke
   behandlede kaldet og ikke fakturerer det. Derfor frigives reservationen, og 429/5xx kan
   gentages. Ved netværksfejl og timeout antages det modsatte.
4. **Outputloftet og thinking.** Nogle modeller tænker altid, og tænketokens tæller i
   outputloftet på 3.000. Et svar, der rammer loftet, vises ikke (det er afstemt og betalt). L4b
   måler det. `IPA_AI_EFFORT` kan sænkes uden kodeændring.
5. **Varighed på Vercel.** Et forsøg har højst 120 sekunder, og der er op til tre forsøg.
   Funktionens maksimale varighed på Vercel skal passe til det; ellers afbrydes kaldet, og
   reservationen tæller fuldt. Det er en L4b-forudsætning.
6. **Rate limits gælder kun eksterne modeller.** Stubben (kun lokalt og i test) reserverer intet.
7. **`count_tokens` sender indholdet til Anthropic** (gratis, men det forlader platformen). Kaldet
   logges derfor som sendt, også når beskeden aldrig sendes.

### 16.21 De 23 testkrav

| # | Krav | Bevis |
|---|---|---|
| 1 | Godkendt Copilot-request | `claude-adapter.test.ts` §1 |
| 2 | Kundesagsdata blokeres | §2–5 og `egress-boundary.test.ts` |
| 3 | Ukendt proveniens | §2–5: policyen, og transporten for en uautoriseret streng |
| 4 | Ikke-godkendt evidens | §2–5: udviklings- og fremtvunget evidens |
| 5 | Ikke-autoriserede dokumenter | §2–5: afvist retrieval og smuglet dokumentdel. RLS i `beta-document-retrieval.integration.test.ts` |
| 6 | Forkert model-id | §6: format, ikke godkendt i databasen, transportens model. Databasen i pgTAP og integration |
| 7 | Manglende API-nøgle | §7 |
| 8 | Nøglen ikke i browserbundle | §8, `scripts/check-client-bundle.ts` og CI-trinnet med sentinel-nøgle |
| 9 | Brugerens rate limit | §9–13, pgTAP og `ai-usage.integration.test.ts` |
| 10 | Global rate limit | Samme |
| 11 | Daglige budgetter | Samme |
| 12 | Månedligt budget | pgTAP og §9–13 |
| 13 | Samtidige kald | `ai-usage.integration.test.ts`: parallelle reservationer mod den rigtige database |
| 14 | Tokenbudget uden afkortning | §14, `beta-document-injection.test.ts` og integration |
| 15 | Timeouts og 429/5xx | §15–16 og integration |
| 16 | Retries og reservationer | §15–16, pgTAP (`begin_attempt`) og integration |
| 17 | Prompt injection | §17 og `beta-document-injection.test.ts` |
| 18 | Native citationer | §18 |
| 19 | Assessment-låsen | §19–20 og `ai-gateway.test.ts` |
| 20 | Practice under rollespil | §19–20 og integration (rollespilsreplik gennem hele kæden) |
| 21 | Ingen følsomme oplysninger i logs | §21 |
| 22 | Ingen stub som production-fallback | §6–7, 22 |
| 23 | Ingen betalbare kald | §23: transporten afviser rigtig `fetch` i test, og den globale `fetch` overvåges |

### 16.22 Mutationer

41 mutationer, alle dræbt. Hver er anvendt alene og derefter rullet tilbage:

- **TypeScript (25):**
  - **egress (9):** formål for Assessment; formålet ignoreret; ukendt formål ikke afvist;
    transportens strengkontrol fjernet; fast formål i `invokeModel`; titler ikke autoriseret;
    `create` uden kontrol; dokumenttekst i systemprompten; chunks afkortet igen;
  - **modelvalg (5):** fallback til stubben; ethvert model-id; manglende nøgle accepteret; rigtig
    `fetch` i test; en udviklingsmodel under et Claude-id;
  - **budget og forsøg (9):** timeout frigivet; timeout gentaget; kald uden reservation; tokenloft
    ikke håndhævet; `retry-after` ignoreret; forsøg uden databasen; ingen afstemning; ingen ledger
    fra gatewayen; intet tokenestimat;
  - **logning (2):** spørgsmålet i loggen; udbyderens fejltekst bevaret.

  Fire overlevede i første omgang: ukendt formål, manglende nøgle, kald uden reservation og
  udbyderens fejltekst. De blev afvist af et andet lag, men årsagen blev ikke kontrolleret.
  Testene er skærpet, og alle fire er nu dræbt.
- **SQL (16):**
  - frigivet talt som reserveret;
  - usikker talt som 0;
  - minutgrænsen forskudt med én;
  - den globale minutgrænse talt pr. bruger;
  - ingen forsøgsgrænse;
  - intet token- eller ejertjek;
  - ingen global lås (fanget af integrationstesten med parallelle reservationer);
  - brugerbudgettet ser kun afstemte kald (fanget af integration);
  - månedsbudgettet over døgnet;
  - afstemning uden grænser;
  - grænser uden permission;
  - inaktiv model brugbar;
  - cache-skrivning til inputpris;
  - inputloft uden prisens gyldighed;
  - dublet-request tilladt.

### 16.23 Verifikation (lokalt)

- **lint, typecheck og build:** bestået. Builden er kørt med en sentinel-nøgle, og
  bundle-kontrollen finder hverken værdien, variabelnavnet, SDK'et eller API-hosten i browserens
  filer. Værdien findes heller ikke i serverbuilden. En negativ kontrol med en plantet værdi bliver
  fanget.
- **Enhedstests:** 1030 bestået og 4 sprunget over (de fire motorkandidat-tests fra L3). Der var
  965 i L3. Heraf er 7 fra præciseringen af B-038 (§15.5).
- **pgTAP:** 1059 bestået (1005 + 54 nye). Kørt før og igen efter alle integrationstests.
- **Integration:** 178 bestået og 6 sprunget over (de samme seks som i L3). Der var 168 i L3.
- Ingen rigtige Anthropic-kald, ingen API-nøgle, ingen hostet migration, ingen rigtige dokumenter
  og ingen betalte ressourcer.

### 16.24 L4b — forudsætninger (ikke udført)

1. En dedikeret API-nøgle i projektejerens Anthropic Console-organisation, kun til Insurance
   Partners, med en uafhængig månedlig forbrugsgrænse sat i Console.
2. Nøglen som server-side secret i det relevante Vercel-miljø (`IPA_ANTHROPIC_API_KEY`, aldrig
   `NEXT_PUBLIC_`). `IPA_AI_MODEL` sat til den valgte model.
3. Migrationen fra L4 anvendt i det miljø, L4b kører i. Det kræver særskilt godkendelse for hostet
   Supabase.
4. Den valgte model godkendt med verificerede priser (`ai.set_model_price`, med kilde og dato) og
   regler i datakategori-matricen for modellen.
5. Funktionens maksimale varighed på Vercel passer til timeouts og forsøg (§16.20, punkt 5).
6. Kun et syntetisk dokument og kontrollerede, syntetiske testprompter (§16.20, punkt 2).
