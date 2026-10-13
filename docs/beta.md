# Fast beta uden AWS — Insurance Partners (IPA)

**Beslutning:** B-035 (`docs/decisions.md`), 12. oktober 2026.
**Status:** L0 og L1 gennemført på branchen `beta/fast-beta-without-aws` og afventer godkendelse
(§12). L2–L9 er ikke påbegyndt.

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
  Secrets Manager og CloudWatch fjernes i L2, når den nye vej er bygget og testet. Koden kan
  gendannes fra Git-historikken og rollback-punktet (§10).
- **Claude API direkte** (Anthropic), kaldt server-side gennem den eksisterende AI Gateway.
  - Platformen bruger en separat API-organisation. Den private Claude Code-konto må aldrig blive
    platformens produktionskonto.
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
| Ingestion-worker på ECS/Fargate med ClamAV som ECS-service (I4, I5.5) | Samme worker og scanner som engangskørsel i Docker på en betroet maskine (L3) |
| Credentials via Vercel OIDC / ECS-taskrolle / GitHub OIDC → AWS (C1) | Ingen AWS-credentials. Claude-nøglen i Vercels servermiljø; workerens databaserolle i operatørens miljø |
| Evaluering i en AWS-evalueringskonto (I7) | Evalueringsmiljøet uden AWS (L9) |
| Alarmer som CloudWatch-specs (B-033) | Log- og webhook-alarmerne (`AlertSink`) bevares; CloudWatch-specs udgår i L2 |
| Kontrolsæt af embedding-vektorer (C6) | Uden betydning uden embeddings; koden bliver |

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

**Konsekvens for evalueringen (fund, kræver beslutning):** retrieval-gates Q1–Q7 er bygget til en
rangerende søgning med topK = 8 og en reranker med absolut relevansscore (§5.1).

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

**Fund — kvalitetsgates Q1–Q7 passer ikke til en ikke-rangerende metode.** Q1–Q7 er ikke ændret.
Gennemføres evalueringen med `gates-v1`, gælder:

| Gate | Hvorfor den ikke passer til `product_documents` |
|---|---|
| Q1–Q3 | Måler rangeringen inden for de første K = 8 elementer. B sender hele dokumentet i dokumentrækkefølge, så de første 8 elementer er dokumentets begyndelse |
| Q4–Q5 | Måler, at retrieval selv afviser ubesvarbare spørgsmål. B sender produktets dokumenter, også når de ikke besvarer spørgsmålet; kun manglende adgang giver et tomt sæt. Afvisningen er modellens (E2E) |
| Q6 | Meningsfuld, når K = hele sættet |
| Q7 | Måler rerankerens løft. B har ingen reranker |

Strategi A har samme problem med Q4 (ingen kalibreret score uden reranker) og Q7.

**Forslag til beslutning:** et separat, versioneret gate-sæt for `product_documents`:
- K er hele sættet;
- Q1 og Q2 med de låste tærskler;
- Q6 bevares;
- Q3 og Q7 markeres "ikke relevant for metoden";
- Q4 og Q5 måles i E2E-evalueringen.

Det kræver en udvidelse af gate-motoren og databasens genberegning og implementeres først efter din
godkendelse. **Indtil da kan en `product_documents`-konfiguration ikke godkendes.** Det er fail-closed
og ønsket.

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
del af sikkerhedsgrænsen; kravene til den (diskkryptering, adgang, sletning efter kørsel) fastlægges
i runbooken i L3. **[AFKLARES]** Hvem der er betroet operatør, og hvilken maskine der bruges.

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

---

## 9. Leverancer

Hver leverance har egne tests, grøn CI og et commit og godkendes, før den næste begynder.

| # | Leverance | Status |
|---|---|---|
| L0 | B-035, dette dokument, rollback-punkt, beta-branch | Gennemført |
| L1 | Retrieval-metoden `product_documents` og publicering uden embeddings | Gennemført, afventer godkendelse (§12) |
| L2 | AWS-kode og -dependencies fjernes. Advise, Analytics og mock-sider skjules server-side | Ikke påbegyndt |
| L3 | Dokumentimport uden AWS (Docker-engangskørsel, runbook) | Ikke påbegyndt |
| L4 | Claude-adapter, egress-rækker pr. profil, budget og forbrugsgrænser (uden betalte kald) | Ikke påbegyndt |
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
slettes historik. Databasen rulles aldrig tilbage ved at slette migrations. En rollback af skema
sker med en ny, fremadrettet migration.

---

## 11. Åbne punkter

- **[AFKLARES]** Beslutning om et separat gate-sæt for `product_documents` (§5.1). Uden den kan
  betaens konfiguration ikke godkendes.
- **[AFKLARES]** DPA, dokumentlicenser, behandlingsgrundlag, sikkerhed og overførsler for Claude API
  (K7). Skal være vurderet og godkendt, før rigtige fortrolige dokumenter eller personoplysninger
  sendes til modellen.
- **[AFKLARES]** Betroet operatør og maskine for dokumentimport (§6).
- **[AFKLARES]** Bekræftelse af de udledte permission-regler (§8).
- **[AFKLARES]** Det faktiske tegn- og tokenomfang af de rigtige dokumenter. Det måles ved import
  (L3) og med tokentælling (L4) og afgør budgettet (`maxChars`).
- **[AFKLARES]** Evalueringssættet for betaen skal angive produktet pr. spørgsmål (§12.4).

---

## 12. L1 — retrieval-metoden `product_documents` (gennemført, afventer godkendelse)

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

   Beslutningen i §5.1 er nødvendig, før betaens konfiguration kan godkendes.
2. **Evalueringssættet skal angive produktet pr. spørgsmål.** Eksempelsættet `example-v1` gør det
   ikke. Med metoden fejler hvert spørgsmål uden produkt lukket ("Vælg ét produkt."). Betaens
   sæt (L9) skal derfor have produkt pr. spørgsmål.
3. **Fejl rettet: en kontekst uden aktiv embedding-model blev læst som "kunne ikke læses".** Det
   gjorde retrieval utilgængelig. Den mangel fandtes allerede i 8B (`retrieval.ts`). Nu betyder
   ingen aktiv model "ingen" (`activeModelFromContext`), som Admin og enhedstestene altid har
   forudsat. Det er nødvendigt for betaen, der ingen embedding-model har.
4. **Mutationstest.**
   - TypeScript: 21 af 22 fanget. Den ene er ækvivalent: genkontrollen i
     `requireProductionEvidence` kan ikke nås, fordi et udstedt sæt er frosset og allerede
     vurderet af P1–P9.
   - SQL: 11 af 13 fanget. Adgangsfiltret og statusfiltret i `product_document_chunks` er hver for
     sig redundante med RLS, der kræver det samme. Fjernes begge, fanges det (S13).

### 12.5 Verifikation (lokalt, frisk database)

- lint, typecheck (app og workers) og build bestået;
- 948 enhedstests: 944 bestået (51 nye), 4 sprunget over;
- pgTAP: 915 bestået (45 nye);
- integration: 161 bestået og 2 sprunget over (7 nye);
- alle migrations er afspillet fra bunden.

