# 03 — Teknisk arkitektur

**Fase:** 3 — Teknisk arkitektur
**Status:** Gennemført og låst
**Sprog:** Dansk
**Bygger på:** `docs/01-product-definition.md` og `docs/02-information-architecture.md`,
som er låst og behandles som autoritative krav.

Dette dokument beskriver, hvordan Insurance Partners skal bygges. Det er design, ikke
implementering. Ingen kode er skrevet, ingen afhængigheder installeret.

---

## 1. Arkitekturoverblik

Arkitekturen hviler på syv bærende beslutninger. Alt andet i dokumentet følger af dem.

**1. Ét videnslag, flere workflows.** Learn, Copilot, Practice og Advise deler den samme
Knowledge Engine. De adskilles gennem prompts, retrieval-profiler, tilladte handlinger og
output-kontrakter — ikke gennem separate vidensbaser. Fire vidensbaser ville betyde fire
sandheder om samme dækning.

**2. Al AI-adgang og al retrieval sker server-side.** Klienten kalder aldrig Claude API
eller vektorsøgning direkte. Det er en forudsætning for at kunne håndhæve
adgangskontrol, logge retrieval, gate AI under Assessment og holde API-nøgler ude af
browseren.

**3. Ingestion er en asynkron worker-arkitektur, adskilt fra applikationen.** Dokumenter
behandles i baggrundsjobs, aldrig i en almindelig request. Applikationsarkitekturen må
ikke være afhængig af, at ingestion kan gennemføres inden for en Vercel-requests levetid.
Retrieval-laget kender ikke kilden; det ser kun færdigbehandlede dokumentversioner.

**4. Teknisk behandling og faglig godkendelse er to forskellige ting.** Ingestion er
teknisk behandling. Aktivering er faglig godkendelse. Hverken upload eller fuldført
ingestion gør et dokument autoritativt — kun en menneskelig godkendelse gør.

**5. Faglig viden er versioneret og tidsbestemt.** Et dokument er ikke ét objekt, men en
kæde af versioner med gyldighedsperioder. Retrieval har altid et tidsfilter. Det er
forudsætningen for at kunne svare både på "hvad gælder nu?" og "hvad gjaldt dengang?".

**6. Rolle er ikke det samme som rettighed — og gælder også dokumenter.** Roller tildeler
sæt af permissions; permissions med scope er det, systemet kontrollerer på. Det gælder
også adgang til fagligt indhold: et dokument knyttes til permissions, ikke til et fast
antal hårdkodede niveauer.

**7. AI Gateway er policy-punktet.** Alle AI-kald går server-side gennem ét lag, der ejer
dataminimering, redaction, permission-tjek, modelvalg, logging og policy enforcement pr.
modul. Arkitekturen antager ikke, at identificerbare eller fortrolige kundedata frit må
sendes til en ekstern AI-leverandør.

### Lagdeling

```
┌─────────────────────────────────────────────────────────────┐
│  KLIENTLAG        Next.js App Router · TypeScript           │
│                   Tailwind CSS · shadcn/ui                  │
│                   Ingen AI-kald · ingen direkte vektorsøgning│
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  APPLIKATIONSLAG  Next.js server-side (route handlers,       │
│                   server actions)                            │
│                   Authn · Authz · validering · rate limiting │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  DOMÆNETJENESTER  Learn · Practice · Advise · Assessment     │
│                   Analytics · Admin · Identity              │
└──────────┬────────────────────────────────┬─────────────────┘
           │                                │
┌──────────▼───────────────┐   ┌────────────▼─────────────────┐
│  KNOWLEDGE ENGINE        │   │  AI-GATEWAY                   │
│  Retrieval · grounding   │◄──┤  Claude API · workflow-profiler│
│  citations · temporal    │   │  prompt-styring · guardrails  │
└──────────┬───────────────┘   └────────────┬─────────────────┘
           │                                │
┌──────────▼────────────────────────────────▼─────────────────┐
│  DATALAG   PostgreSQL (Supabase) · pgvector · Supabase       │
│            Storage · Supabase Auth · RLS                     │
└──────────────────────────────────────────────────────────────┘
           ▲
┌──────────┴───────────────────────────────────────────────────┐
│  INGESTION-LAG (asynkront, adskilt)                          │
│  Upload-adapter (v1) · senere connectors                     │
│  Parsing · strukturering · chunking · embeddings             │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Valgt stack og begrundelser

| Lag | Valg | Begrundelse | Konsekvens |
|-----|------|-------------|------------|
| Frontend | Next.js + TypeScript | Server-side rendering og server actions gør det muligt at holde AI-kald og retrieval på serveren uden en separat backend | Applikations- og præsentationslag deler runtime; grænsen skal håndhæves i kode, ikke af infrastrukturen |
| UI | Tailwind CSS + shadcn/ui | Komponenter ejes i repoet frem for at være et eksternt designsystem, hvilket gør dem tilpasselige til fagligt indhold | Designsystemet skal vedligeholdes selv |
| Applikationslag | Next.js server-side API | Ét deployment, én autorisationsvej | Langvarige opgaver hører ikke til her — se dokumentpipelinen |
| Database | PostgreSQL via Supabase | Relationel model passer til domænet; RLS giver adgangskontrol tæt på data | Bindingen til Supabase er reel og behandlet under risici |
| Vektorsøgning | pgvector i samme database | Viden og metadata ligger samme sted, så temporale filtre og adgangskontrol gælder samme forespørgsel | Skalering skal overvåges; se risici |
| Auth | Supabase Auth | Integreret med RLS via brugerens identitet i databasen | Rollemodellen bygges ovenpå, ikke ind i, Supabase Auth |
| Storage | Supabase Storage | Originaldokumenter opbevares adskilt fra afledte chunks | Adgang til råfiler skal styres selvstændigt |
| AI | Claude API | Kaldes udelukkende server-side gennem AI-gateway | Leverandørbinding isoleres i gateway-laget |
| Reranking | Del af Knowledge Engine fra V1 | Præcision vejer tungere end latency, når svaret angår en acceptregel | Leverandør ikke låst |
| Ingestion | Asynkron worker/job-arkitektur | Dokumentbehandling kan ikke rummes i en request | Leverandør ikke låst; applikationen må ikke afhænge af én |
| Hosting | Vercel + Supabase, EU-region hvor muligt | Databehandling holdes i EU hvor det kan lade sig gøre | AI-inferens' geografi er et åbent punkt, se afsnit 11 og 17 |
| Versionsstyring | Git + GitHub | — | — |

**Bevidst ikke låst:** modelversioner, embedding-model, reranking-leverandør,
worker-leverandør og andre hurtigt foranderlige leverandørdetaljer. De behandles som konfiguration, ikke som arkitektur.
Arkitekturen skal kunne skifte dem uden ændringer i domænelaget — hvilket omvendt stiller
et krav: enhver embedding skal bære navnet på den model, der frembragte den, da et
modelskifte ellers gør eksisterende vektorer ubrugelige uden at nogen opdager det.

---

## 3. Systemdiagram

```
   RÅDGIVER / LEDER / ADMINISTRATOR
              │
              ▼
   ┌──────────────────────┐
   │  Next.js klient      │   Home · Learn · Copilot · Practice
   │  (browser)           │   Advise · Assessment · Min profil
   └──────────┬───────────┘   Analytics · Admin
              │ HTTPS, session fra Supabase Auth
              ▼
   ┌──────────────────────────────────────────────────┐
   │  Next.js server-side lag                         │
   │  ┌────────────────────────────────────────────┐  │
   │  │ Authn → Authz (permissions + scope)        │  │
   │  └────────────────────────────────────────────┘  │
   │  ┌──────────┬──────────┬──────────┬───────────┐  │
   │  │ Learn    │ Practice │ Advise   │ Assessment│  │
   │  │ service  │ service  │ service  │ service   │  │
   │  └────┬─────┴────┬─────┴────┬─────┴─────┬─────┘  │
   │       │          │          │           │        │
   │  ┌────▼──────────▼──────────▼───────────▼─────┐  │
   │  │  AI-GATEWAY                                │  │
   │  │  workflow-profil · prompt · tool-allowlist │  │
   │  │  grounding-policy · gating · logging       │  │
   │  └────┬───────────────────────────────┬───────┘  │
   │       │                               │          │
   │  ┌────▼──────────────────┐            │          │
   │  │  KNOWLEDGE ENGINE     │            │          │
   │  │  retrieval-profil     │            │          │
   │  │  temporalt filter     │            │          │
   │  │  access-filter        │            │          │
   │  │  reranking (V1)       │            │          │
   │  │  citation-builder     │            │          │
   │  └────┬──────────────────┘            │          │
   └───────┼───────────────────────────────┼──────────┘
           │                               │
           ▼                               ▼
   ┌───────────────────────┐      ┌──────────────────┐
   │ PostgreSQL + pgvector │      │  Claude API      │
   │ (Supabase, EU)        │      │  (server-side)   │
   │ · identity            │      └──────────────────┘
   │ · knowledge           │
   │ · learning            │      ┌──────────────────┐
   │ · practice            │      │ Supabase Storage │
   │ · assessment          │      │ originalfiler    │
   │ · advise              │      └────────▲─────────┘
   │ · ai                  │               │
   │ · analytics           │      ┌────────┴─────────┐
   │ · audit               │◄─────┤ INGESTION-WORKER │
   └───────────────────────┘      │ parsing→chunking │
                                  │ →embeddings      │
                                  └────────▲─────────┘
                                           │
                                  ┌────────┴─────────┐
                                  │ Admin-upload (v1)│
                                  │ Connectors (v2+) │
                                  └──────────────────┘
```

---

## 4. Domænearkitektur

Domænerne holdes adskilt i hvert sit databaseskema. Adskillelsen er ikke kosmetisk: den
gør det muligt at give kundedata i Advise en anden adgangsprofil end læringsdata, og at se
på et skema og vide, hvilke regler der gælder for indholdet.

| Domæne | Ansvar | Ejer af sandheden om |
|--------|--------|----------------------|
| `identity` | Brugere, roller, permissions, teams, medlemskaber | Hvem nogen er, og hvad de må |
| `knowledge` | Produkter, dokumenter, versioner, chunks, embeddings, kilder | Hvad der fagligt er sandt, og hvornår |
| `learning` | Læringsforløb, moduler, lektioner, quizzer, progression | Hvad brugeren har lært |
| `practice` | Træningsscenarier, sessioner, rollespil, feedback | Hvad brugeren har trænet |
| `assessment` | Prøver, forsøg, resultater, kompetencer | Hvad brugeren kan dokumentere |
| `advise` | Kundecases, virksomhedsprofiler, risikoanalyser, behov, anbefalinger, kilder | Hvad der er rådgivet, og på hvilket grundlag |
| `ai` | Samtaler, beskeder, citations, retrieval-hændelser | Hvad AI'en har svaret og hvorfor |
| `analytics` | Læringshændelser, brugshændelser, teammålinger | Hvordan platformen anvendes |
| `audit` | Administrative ændringer, dokumentændringer, adgangshændelser | Hvem gjorde hvad hvornår |

### Regler for grænserne mellem domæner

**Ét domæne ejer et begreb.** Kompetence defineres i `assessment` og *vises* i Min profil;
den opgøres ikke to steder. Progression opgøres ét sted og vises tre steder.

**Krydsreferencer sker via id, ikke via kopier.** Analytics kopierer ikke
Assessment-resultater ind i sig selv; det refererer til dem. En kopi ville blive en
selvstændig sandhed, der langsomt skred fra originalen.

**Kundedata forlader ikke `advise`.** Analytics og læringsdomænet må referere til, at en
kundecase findes, og til dens tilstand, men ikke til dens indhold. Det er den vigtigste
grænse i hele modellen, fordi det er den eneste, hvor overtrædelse rammer en tredjepart,
der ikke selv er bruger af platformen.

**`audit` skrives til, aldrig rettes i.** Indholdet er append-only.

### Konceptuel datamodel

Ikke en endelig SQL-model. Formålet er at fastlægge domæner, relationer og ansvar.

**identity**

| Entitet | Centrale felter | Relationer |
|---------|-----------------|------------|
| `users` | id, auth_id, navn, status, oprettet | → team_memberships |
| `roles` | id, navn (rådgiver/leder/administrator), beskrivelse | → role_permissions |
| `permissions` | id, nøgle, beskrivelse, scope-type | ← role_permissions |
| `role_permissions` | role_id, permission_id | koblingstabel |
| `user_roles` | user_id, role_id, scope | en bruger kan have flere roller |
| `teams` | id, navn, parent_team_id | hierarki muligt |
| `team_memberships` | user_id, team_id | en bruger kan være medlem af flere teams |
| `leader_scopes` | user_id, team_id, include_descendants | eksplicit lederscope — udledes aldrig af jobtitel |

**knowledge**

| Entitet | Centrale felter | Relationer |
|---------|-----------------|------------|
| `products` | id, navn, kategori, status | ← documents |
| `documents` | id, product_id, document_type, title, source, status | logisk dokument, uden indhold |
| `document_access_grants` | document_id, permission_key, scope | adgang knyttes til permissions, ikke til faste niveauer |
| `document_versions` | id, document_id, version, language, valid_from, valid_to, status, recorded_at, superseded_by, storage_ref, checksum, approved_by, approved_at | indholdet og godkendelsen hører til versionen |
| `ingestion_jobs` | id, document_version_id, trin, status, forsøg, fejl, kvalitetsrapport | teknisk behandling, adskilt fra faglig godkendelse |
| `document_chunks` | id, document_version_id, page, section, heading, chunk_index, text, token_count | → embeddings |
| `embeddings` | id, chunk_id, vector, embedding_model, genereret_at | modelnavn er obligatorisk |
| `sources` | id, navn, type (manuel upload / connector), konfiguration | → documents |

**learning / practice / assessment**

| Entitet | Bemærkning |
|---------|------------|
| `learning_paths`, `modules`, `lessons`, `quizzes` | Indhold, forvaltet i Admin |
| `learning_progress` | Én kilde til progression, refereret af Home og Min profil |
| `training_scenarios`, `training_sessions`, `roleplay_sessions`, `feedback` | Session-tilstand afgør AI-gating |
| `assessments`, `assessment_attempts`, `assessment_results`, `competencies` | Forsøg er immutable efter afslutning |

**advise**

| Entitet | Bemærkning |
|---------|------------|
| `customer_cases` | Bærer den strammeste adgangsprofil i systemet. Har én primær ejer |
| `case_participants` | Delt adgang pr. case: bruger, adgangstype, tildelt af, tidspunkt |
| `case_ownership_transfers` | Overdragelse af ejerskab, med spor |
| `company_profiles`, `risk_analyses`, `identified_needs`, `recommendations` | Arbejdsområderne fra IA'en |
| `case_content_items` | Indhold i sagen med eksplicit status: AI-forslag, arbejdsnote, valideret konklusion, autoritativ sagsinformation |
| `case_sources` | Hvilke vidensversioner en anbefaling hvilede på |

`case_sources` er væsentlig: den binder en rådgivning til de *versioner* af betingelser og
acceptregler, der gjaldt, da den blev givet. Uden den kan en rådgivning ikke rekonstrueres
senere.

**ai / analytics / audit**

| Entitet | Bemærkning |
|---------|------------|
| `conversations`, `messages` | Bundet til den kontekst, samtalen fandt sted i |
| `citations` | Kobler et svar til chunk og dokumentversion |
| `retrieval_events` | Hvad blev søgt, hvad blev fundet, hvad blev brugt |
| `learning_events`, `usage_events`, `team_metrics` | Aggregeringsgrundlag |
| `audit_log` | Append-only |

---

## 5. Dataflow

### Flow A — Fagligt spørgsmål i Copilot

```
Bruger stiller spørgsmål
   → applikationslag: authn + authz + gating-check
   → AI-gateway vælger workflow-profil (copilot)
   → Knowledge Engine: retrieval med access-filter + temporalt filter
   → tilstrækkelig dækning? ─ nej → svar der oplyser manglende grundlag
   │                         └ ja  ↓
   → kontekst samles med kildereferencer
   → Claude API (server-side)
   → svar valideres mod citations-kontrakt
   → svar + kilder returneres
   → retrieval_event, citations, usage_event skrives
```

### Flow B — Dokument-ingestion

```
Admin uploader dokument
   → Supabase Storage (originalfil bevares urørt)
   → ingestion-job oprettes
   → parsing → strukturering → metadata → chunking → embeddings
   → dokumentversion sættes til aktiv efter godkendelse
   → tilgængelig for retrieval
```

Ingestion er asynkron og påvirker ikke brugerens request. Se afsnit 8.

### Flow C — Assessment

```
Bruger starter prøve
   → assessment_attempt oprettes med status "aktiv"
   → AI-gateway afviser alle Copilot-kald for denne bruger, mens forsøget er aktivt
   → besvarelse gemmes
   → forsøg afsluttes → resultat + kompetencer skrives
   → gating ophæves; Copilot må nu forklare fejl og foreslå læring
```

Gatingen sker i AI-gateway på grundlag af tilstand i databasen, ikke i brugerfladen.

### Flow D — Analytics

```
Hændelser fra learning, practice, assessment, advise (kun tilstand, ikke indhold)
   → analytics-domænet
   → aggregering pr. team
   → Leder tilgår gennem Analytics, filtreret af team_memberships
```

---

## 6. Knowledge Engine-arkitektur

Knowledge Engine er platformens autoritative faglige videnslag. Den består af fire lag med
en klar kontrakt imellem.

```
┌──────────────────────────────────────────────────────┐
│ 1. INGESTION        adaptere · parsing · chunking     │
│                     embeddings · klassifikation       │
└──────────────────────┬───────────────────────────────┘
                       │ kontrakt: dokumentversion + chunks + metadata
┌──────────────────────▼───────────────────────────────┐
│ 2. LAGRING          originaler i Storage              │
│                     tekst, metadata, vektorer i DB    │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│ 3. RETRIEVAL        hybrid søgning · temporalt filter │
│                     access-filter · reranking         │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│ 4. GROUNDING        evidensvurdering · citations      │
│                     usikkerhedshåndtering             │
└──────────────────────────────────────────────────────┘
```

**Kontrakten mellem lag 1 og 2** er det, der gør fremtidige connectors mulige: ingestion
leverer altid en normaliseret dokumentversion med chunks og metadata, uanset om kilden er
en manuel upload eller et internt system. Retrieval kender kun kontrakten.

**Retrieval (lag 3)** kombinerer vektorsøgning med leksikalsk søgning. Rent semantisk
søgning er utilstrækkelig her: forsikringstekst indeholder præcise betegnelser og
paragrafhenvisninger, hvor den eksakte streng er afgørende, og hvor to formuleringer, der
ligner hinanden semantisk, kan have modsat juridisk betydning.

**Grounding (lag 4)** er det lag, der håndhæver produktdefinitionens krav: ingen opfundne
dækninger, betingelser, acceptregler eller forretningsgange, og udtrykt usikkerhed frem for
gæt. Konkret vurderes, om den hentede evidens dækker spørgsmålet, før modellen kaldes — og
svaret afvises, hvis det indeholder faglige påstande uden citation.

### Dokumentmodellens metadata

| Felt | Formål |
|------|--------|
| `product` | Hvilket forsikringsprodukt dokumentet hører til |
| `document_type` | Policetekst, betingelser, produktbeskrivelse, acceptregler, forretningsgang, vejledning, salgsmateriale, internt fagligt dokument |
| `title` | Menneskelæsbar identifikation |
| `version` | Versionsbetegnelse |
| `valid_from` / `valid_to` | Hvornår indholdet var gældende |
| `source` | Hvor dokumentet kom fra |
| `status` | Kladde, aktiv, erstattet, deaktiveret |
| `access_policy` | Hvilke permissions og scopes der giver adgang — ikke et fast niveau |
| `language` | Indholdets sprog. Dansk i V1 |

### Chunk-metadata og sporbarhed

Hvert tekstsegment bærer `document_id`, `document_version_id`, `page`, `section`,
`heading`, `chunk_index` og en kildereference. Det er dette, der gør præcise
kildehenvisninger mulige: et svar kan pege på afsnit og side i en bestemt version af et
bestemt dokument — ikke blot på dokumentet.

**Struktur-bevidst chunking.** Forsikringsbetingelser er hierarkiske, og en undtagelse
uden sin overskrift kan læses som det modsatte af, hvad den betyder. Chunking skal derfor
følge dokumentets struktur og bevare overskriftskæden i hvert segment frem for at skære
efter en fast tegnlængde. Dette er det enkeltpunkt i RAG-designet, hvor fejl gør mest
skade.

### Dokumentadgang er permission-baseret

Adgang til et dokument afgøres ikke af et fast access-niveau og ikke af rollenavne, men af
permissions med scope. Hvert dokument knyttes til de permissions, der giver adgang til det,
gennem `document_access_grants`.

Retrieval anvender brugerens effektive permissions som filter, før der overhovedet søges.
Et dokument, brugeren ikke har adgang til, kan dermed ikke optræde i kontekst, ikke citeres
og ikke lække gennem en omformulering af spørgsmålet. Filteret hører til i
forespørgslen — ikke i efterbehandlingen af resultatet.

Modellen gør det muligt at åbne enkelte dokumenter for en afgrænset gruppe uden at indføre
en ny rolle, og at stramme adgangen til et enkelt følsomt dokument uden at ændre noget
andet.

### Multilingual-ready

Dansk er platformens sprog i V1. Datamodellen bygges alligevel flersproget fra start, fordi
sprog er dyrt at eftermontere i et RAG-system:

- `language` sættes på dokumentversion og arves af chunks
- Embeddings bærer både modelnavn og sprog
- Retrieval kan filtrere og prioritere efter sprog
- Et dokument kan have sprogvarianter som selvstændige versioner under samme logiske dokument
- Citations refererer til den sprogvariant, svaret faktisk byggede på

V1 sætter blot `language` til dansk overalt. Pointen er, at intet i kernen antager, at der
kun findes ét sprog.

---

## 7. RAG-flow

```
Query
  → metadata filtering      (permissions · sprog · produkt · dokumenttype · tid)
  → hybrid/vector retrieval (vektor + leksikalsk)
  → candidate chunks
  → reranking               (V1, obligatorisk trin)
  → evidence selection      (er grundlaget tilstrækkeligt?)
  → Claude                  (server-side, via AI Gateway)
  → svar + citations
```

Trin for trin:

```
1. Spørgsmål + workflow-kontekst (produkt, modul, case, trin)
2. Metadata-filtrering:
      · permissions og scope — hvilke dokumenter må denne bruger se?
      · sprog
      · produkt og dokumenttyper fra konteksten
      · temporalt filter: gældende nu, eller pr. dato ved eksplicit historisk opslag
3. Hybrid søgning: vektor + leksikalsk over de tilladte, tidsgyldige chunks
4. Kandidatsæt: bredt nok til at reranking har noget at vælge imellem
5. Reranking: sorterer kandidater efter faktisk relevans for spørgsmålet
6. Evidence selection: dækker de bedste kilder spørgsmålet?
        ├─ nej → svar der oplyser manglende dokumentation. Modellen kaldes ikke
        │        for at "prøve alligevel"
        └─ ja  ↓
7. Kontekstsamling med eksplicitte kilde-id'er og versionsangivelse
8. AI Gateway: dataminimering, redaction, policy-tjek, modelvalg
9. Claude-kald med workflow-profilens prompt og grounding-instruktion
10. Validering: faglige påstande skal bære citation
11. Svar + kilder til bruger
12. Logging: retrieval_event, citations, latency, evidensvurdering
```

**Reranking er ikke valgfri i V1.** Vektorsøgning finder det, der ligner; reranking finder
det, der svarer. I forsikringstekst er forskellen betydelig, fordi to afsnit om samme
dækning kan ligne hinanden semantisk, mens kun det ene angår kundens situation. Prisen er
latency, og den er accepteret.

### Retrieval-profiler pr. workflow

Samme motor, forskellig indstilling:

| Workflow | Bredde | Dokumenttyper | Temporalt | Grounding |
|----------|--------|---------------|-----------|-----------|
| Learn | Bred, pædagogisk | Produktbeskrivelser, vejledninger, materiale | Gældende | Streng på fakta, fri på formidling |
| Copilot | Præcis | Alle tilladte typer | Gældende, historisk på anmodning | Strengest |
| Practice | Scenariebundet | Produktdata til realisme | Gældende | Streng på produktfakta, fri på fiktiv kunde |
| Advise | Case-bundet | Betingelser, acceptregler, forretningsgange | Gældende på casens dato | Strengest, med case_sources |
| Assessment | Systemets egen brug | Facitgrundlag | Gældende | Streng |

Alle profiler filtrerer desuden på brugerens permissions og på sprog. Ingen profil kan
omgå adgangsfilteret.

Skellet i Practice er værd at bemærke: et rollespil kræver, at AI'en *opfinder* en
virksomhed, en indvending og en personlighed. Det er legitim generering. Men den samme
samtale må ikke opfinde en dækning. Grounding-strengheden er derfor knyttet til
indholdstypen, ikke til workflowet som helhed.

---

## 8. Dokumentpipeline

Pipelinen består af to adskilte processer: en **teknisk behandling**, der er automatisk og
asynkron, og en **faglig godkendelse**, der er manuel. Grænsen mellem dem er
arkitektonisk, ikke blot proceduremæssig.

```
  TEKNISK BEHANDLING (asynkron worker — aldrig i en request)
  ───────────────────────────────────────────────────────────
  Admin upload
    → Storage: originalfil gemmes uændret, checksum beregnes
    → ingestion job oprettes (status: i kø)
    → worker henter jobbet
        → Parsing: tekst + struktur udtrækkes
        → Strukturering: overskrifter, afsnit, sider identificeres
        → Metadata: produkt, type, version, gyldighed, sprog, adgangspolitik
        → Chunking: struktur-bevidst opdeling
        → Embeddings: genereres pr. chunk, model og sprog registreres
        → Indexing: vektorindeks og leksikalsk indeks opdateres
        → Kvalitetstjek: se nedenfor
    → status: "klar til review"
  ───────────────────────────────────────────────────────────
  FAGLIG GODKENDELSE (menneskelig)
  ───────────────────────────────────────────────────────────
    → fagligt ansvarlig gennemgår dokument, metadata og kvalitetsrapport
    → godkendelse registreres med bruger og tidspunkt
    → status: aktiv — dokumentet er nu autoritativ viden
  ───────────────────────────────────────────────────────────
    → Retrieval → Reranking → Claude → Svar → Citations
```

**Ingestion er teknisk behandling. Aktivering er faglig godkendelse.** De to processer
holdes adskilt, og hverken upload eller fuldført ingestion gør et dokument autoritativt.
Automatisk aktivering ville betyde, at en fejlagtig upload øjeblikkeligt kunne ændre, hvad
platformen fortæller rådgivere om en acceptregel.

### Worker-arkitektur

Ingestion afvikles som jobs i en kø, behandlet af en worker uden for applikationens
request-cyklus. Applikationsarkitekturen må ikke være afhængig af, at dokumentbehandling
kan gennemføres inden for en almindelig Vercel-requests levetid.

Krav til worker-laget, uafhængigt af hvilken leverandør der senere vælges:

| Krav | Begrundelse |
|------|-------------|
| Jobs er persistente | En genstart må ikke tabe et påbegyndt dokument |
| Trinvis tilstand | Et job, der fejler ved embeddings, parses ikke forfra |
| Idempotens | Samme job kørt to gange giver samme resultat, ikke dubletter |
| Kontrolleret genforsøg | Med grænse, så et uløseligt dokument ikke kører i ring |
| Synlig fejltilstand i Admin | En stille fejl er værre end en åbenlys |
| Ingen deling af runtime med brugerrequests | Et stort dokument må ikke påvirke svartider |

Leverandøren er ikke låst. Den kan skiftes, så længe kravene ovenfor holdes, fordi
applikationen kun kender jobbets tilstand — ikke hvordan det afvikles.

### Kvalitetstjek før review

Før et dokument når "klar til review", produceres en kvalitetsrapport, som mennesket
gennemgår sammen med dokumentet:

- Blev hele dokumentet læst, eller er sider sprunget over?
- Er strukturen genkendt, eller er alt endt som én blok tekst?
- Er der chunks uden overskriftskæde?
- Er obligatorisk metadata udfyldt?
- Findes der allerede et dokument med samme checksum?
- Overlapper gyldighedsperioden med en eksisterende aktiv version?

Rapporten træffer ingen afgørelser. Den giver den fagligt ansvarlige grundlag for at
afvise eller godkende.

### Fejltilstande

| Fejltilstand | Håndtering |
|--------------|------------|
| PDF kan ikke læses | Job fejler synligt i Admin med årsag. Ingen delvis indeksering — et halvt indlæst betingelsessæt er farligere end intet |
| Manglende metadata | Dokumentet kan uploades og behandles, men kan ikke godkendes. Retrieval ser det aldrig |
| Kvalitetstjek fejler | Dokumentet når "klar til review" med rapporten vedhæftet. Mennesket afgør; systemet aktiverer aldrig selv |
| Dublet dokument | Checksum-match opdages ved upload; administrator vælger: ny version, erstatning eller afvisning |
| Modstridende dokumenter | Kan ikke afgøres automatisk. Retrieval returnerer begge, svaret skal oplyse uenigheden og vise begge kilder, og konflikten flages til Admin |
| Gammel version | Udelukkes af det temporale filter, medmindre historisk forespørgsel er eksplicit |
| Retrieval finder ingen tilstrækkelig kilde | Modellen kaldes ikke. Brugeren får oplyst, at grundlaget mangler. Hændelsen logges som videnshul |
| Dokument erstattet | Ny version aktiveres, gammel sættes til erstattet med `superseded_by`. Eksisterende citations peger fortsat på den version, der blev brugt |
| Dokument deaktiveret | Fjernes fra retrieval straks. Historiske citations bevares og markeres som deaktiveret grundlag |

De to vigtigste linjer i tabellen er "modstridende dokumenter" og "ingen tilstrækkelig
kilde". Begge er tilstande, hvor et sprogmodelbaseret system af natur vil producere et
flydende og overbevisende svar, hvis det får lov. Arkitekturen skal gøre det umuligt at
komme dertil.

---

## 9. AI-arkitektur

Alle AI-funktioner går gennem ét centralt AI Gateway-lag mellem applikationen og eksterne
AI-modeller. Det er ikke et abstraktionslag for dets egen skyld: det er det eneste sted,
hvor gating, dataminimering, policy og leverandørbinding kan håndhæves ét sted i stedet for
fem.

### AI Gateway — ansvar

| Ansvar | Hvad laget gør |
|--------|----------------|
| **Dataminimering** | Kun det nødvendige sendes med. En hel kundecase hører ikke i en prompt, fordi spørgsmålet angår ét dækningsforhold |
| **Redaction og anonymisering** | Identificerbare oplysninger fjernes eller erstattes, før de forlader platformen, hvor politikken kræver det |
| **Permission checks** | Brugerens effektive rettigheder verificeres igen her — ikke kun i applikationslaget |
| **Modelvalg** | Hvilken model og leverandør der må anvendes, afgøres af datakategori og modul, ikke af kaldstedet |
| **Logging** | Hvad blev sendt, hvad kom retur, hvilke kilder, hvor lang tid, hvilke fejl |
| **Policy enforcement** | Gating under Assessment og rollespil, grounding-krav, rate limiting, omkostningsstyring |
| **Regler pr. modul** | Learn, Copilot, Practice, Advise og Assessment har hver deres profil |

Fordi laget ligger mellem applikationen og leverandøren, kan en ændret politik — strammere
redaction, en anden model til kundedata, en ny leverandør — gennemføres ét sted uden at
røre de fem moduler.

### Datakategorier og modeladgang

Arkitekturen antager **ikke**, at identificerbare eller fortrolige kundedata frit må sendes
til en ekstern AI-leverandør. Hvilke datakategorier der må sendes til hvilken
model eller leverandør, er konfiguration i AI Gateway:

| Datakategori | Udgangspunkt |
|--------------|--------------|
| Godkendt faglig viden fra Knowledge Engine | Må sendes |
| Brugerens eget spørgsmål | Må sendes |
| Læringsdata og træningsdata | Må sendes i det omfang, det er nødvendigt |
| Fiktive træningscases | Må sendes |
| **Identificerbare kunde- og virksomhedsdata** | **Kræver eksplicit policy. Ikke tilladt som standard** |
| Audit- og adgangsdata | Sendes ikke |

Matricen er data, ikke kode i modulerne. Den endelige compliancebeslutning om konkrete
kundedata træffes senere ud fra organisationens krav, databehandleraftaler og gældende
regler — og ændrer da konfigurationen, ikke arkitekturen.

### Advise er privacy-first

Advise designes efter, at kundedata som udgangspunkt ikke forlader platformen i
identificerbar form. Konkret betyder det:

- Retrieval mod Knowledge Engine sker på det faglige spørgsmål, ikke på kundens identitet
- Virksomheds- og personoplysninger minimeres og anonymiseres af AI Gateway, før de indgår
  i en prompt, hvor politikken kræver det
- Hvad der faktisk blev sendt, logges, så en senere gennemgang kan fastslå det
- Strammes politikken senere, rammer ændringen gateway-konfigurationen — ikke
  Advise-modulets design

### Status på indhold i en kundesag

AI'ens output bliver ikke til sagens indhold, fordi det blev genereret. Hvert element i en
sag bærer en eksplicit status:

| Status | Betydning | Del af den autoritative sag |
|--------|-----------|------------------------------|
| **AI-genereret forslag** | Systemets bud, ikke vurderet | Nej |
| **Rådgiverens arbejdsnote** | Menneskets egne overvejelser undervejs | Nej |
| **Accepteret/valideret konklusion** | Rådgiveren har taget stilling og tiltrådt | Ja |
| **Autoritativ sagsinformation** | Oplysninger sagen hviler på | Ja |

Et forkastet AI-forslag bliver **ikke** automatisk en del af den autoritative sag. Det kan
logges som AI- og audit-hændelse, underlagt permissions, privacy og retention — adskilt fra
sagens indhold. Forskellen er væsentlig, hvis en sag senere skal gennemgås: en liste over
alt, systemet nogensinde foreslog, er ikke det samme som det, rådgiveren faktisk lagde til
grund.

### Hvad der deles, og hvad der holdes adskilt

| Deles på tværs af workflows | Adskilt pr. workflow |
|-----------------------------|----------------------|
| Knowledge Engine og vidensgrundlag | Prompt og systeminstruktion |
| Retrieval-motor og citation-format | Retrieval-profil |
| Model-adgang og fejlhåndtering | Tilladte handlinger (tool allowlist) |
| Logging, audit og observability | Output-kontrakt |
| Grounding-politik for produktfakta | Samtalelagring og kontekst |
| Rate limiting og omkostningsstyring | Gating-regler |

Det er dermed konfiguration og politik, der adskiller workflows — ikke separat
infrastruktur. Sammenblanding forhindres af, at en workflow-profil aldrig kan tilgå et
andet workflows handlinger eller samtalekontekst.

### Workflow-profiler

| Workflow | AI-funktion | Tilladte handlinger | Særlige regler |
|----------|-------------|---------------------|----------------|
| **Learn** | Forklaringer, pædagogik, eksempler, forståelsesstøtte | Retrieval, forklaring, eksempelgenerering | Eksempler må være opdigtede; produktfakta i dem må ikke |
| **Copilot** | Faglige spørgsmål, dokumentopslag, sammenligning, kildebaserede svar | Retrieval, sammenligning, kildevisning | Strengest grounding. Deaktiveret under aktiv Assessment og under rollespil |
| **Practice** | Cases, rollespil, behovsafdækning, objection training, produkttræning, feedback | Persona-generering, scenariegenerering, samtale, feedback | Må generere fiktiv kunde; må ikke generere produktfakta. Ingen Copilot-adgang under rollespil |
| **Advise** | Caseanalyse, manglende oplysninger, risikostrukturering, behov, dækninger, acceptregler, sparring | Retrieval, analyse, forslag | Alt fagligt skal bære citation og skrives til `case_sources`. AI foreslår, rådgiveren afgør |
| **Assessment** | Systemets egen evaluering hvor det giver mening | Bedømmelse mod facitgrundlag | Ingen brugerrettet AI under aktivt forsøg |

### Gating — håndhævet på serveren

To regler fra informationsarkitekturen er absolutte:

1. Copilot er utilgængelig under en aktiv Assessment.
2. Copilot er utilgængelig under et aktivt AI-rollespil.

Begge håndhæves i AI-gateway ved opslag i sessionstilstanden, ikke ved at skjule en knap i
brugerfladen. En skjult knap er ikke en adgangskontrol. Efter afslutning ophæves gatingen,
og Copilot skifter rolle fra forbudt til efterbehandler: forklare fejl, gennemgå faglige
områder, finde kilder og foreslå relevant læring.

### Grænsen mod modellens egen viden

Modellens generelle forsikringsviden må ikke behandles som autoritativ, når spørgsmålet
angår virksomhedens konkrete produkter, dækninger, undtagelser, betingelser, acceptregler,
forretningsgange eller interne procedurer. Arkitekturen håndhæver det tre steder:

- **Før kaldet:** evidensvurderingen stopper flowet, hvis grundlaget mangler
- **I kaldet:** systeminstruktionen binder faglige udsagn til den leverede kontekst
- **Efter kaldet:** svar med faglige påstande uden citation afvises eller markeres

Ingen af de tre er tilstrækkelig alene. Det er en restrisiko, ikke et løst problem — se
afsnit 16.

---

## 10. Roller og permissions

**Rolle er ikke rettighed.** Roller er navngivne samlinger af permissions. Systemet
kontrollerer altid på permission og scope, aldrig på rollenavn. Det er det, der gør det
muligt at tilføje en fjerde rolle uden at ændre kontrollogikken.

```
Bruger ──< user_roles >── Rolle ──< role_permissions >── Permission
   │                                                          │
   └──< team_memberships >── Team ────────────────────────────┘
                                   scope afgør hvilke rækker
```

### Permission-model

En permission har tre dele: **ressource**, **handling** og **scope**.

| Scope | Betydning |
|-------|-----------|
| `own` | Kun brugerens egne rækker |
| `team` | Rækker for teams brugeren er leder af |
| `all` | Hele organisationen |

### Eksempler på permissions

| Permission | Rådgiver | Leder | Administrator |
|------------|----------|-------|---------------|
| `learning.progress.read` | own | own + team | own |
| `practice.session.write` | own | own | own |
| `assessment.result.read` | own | own + team | own |
| `advise.case.write` | own | own | own |
| `advise.case.read` | own | own | own |
| `analytics.team.read` | — | team | efter rettigheder |
| `knowledge.document.read` | efter grants | efter grants | all |
| `knowledge.document.read_historical` | efter grants | efter grants | all |
| `knowledge.document.write` | — | — | all |
| `knowledge.version.publish` | — | — | all |
| `identity.user.manage` | — | — | all |
| `system.settings.manage` | — | — | all |

Lederen har altså ikke en bredere version af administratorens rettigheder, men en anden
akse: **lederen ser mennesker, administratoren forvalter indhold.** Ingen af dem arver den
andens adgang.

Bemærk, at `advise.case.read` og `advise.case.write` er `own` for alle tre roller. Adgang til
en kundecase gives pr. case gennem `case_participants`, aldrig gennem en rolle. `own` betyder
"kun egne og tildelte sager" og gælder derfor ens for rådgiver, leder og administrator. Et "—"
ville betyde, at en administrator aldrig kan tildeles en sag, heller ikke som sagsansvarlig —
og en administrator er også rådgiver, ligesom en leder er det. Hverken leder- eller
administratorrollen giver adgang til andres sager; se "Kundecases" nedenfor.

### Teams

Teammodellen er hierarkisk og understøtter:

- **Parent/child-relationer**, så et team kan indeholde underteams
- **Flere medlemskaber**, så en bruger kan tilhøre flere teams samtidig
- **Eksplicit leader scope** i `leader_scopes` — hvilke teams en given bruger er leder for
- **Adgang til underliggende teams**, når `include_descendants` er sat, og permissionen
  tillader det

**Adgang udledes aldrig af jobtitel eller rollenavn.** At være "leder" i organisationen
giver ingen adgang i systemet. Adgangen kommer af et eksplicit scope, tildelt og
sporbart. Det er det, der gør det muligt at have en leder uden dataadgang, en faglig
ansvarlig med adgang til ét team, og en afdelingschef med adgang til hele grenen — uden at
opfinde tre nye roller.

### Lederens indsigt

Lederen ser **både aggregerede teamdata og individniveau** for de medarbejdere, der ligger
inden for vedkommendes autoriserede scope: progression, gennemførte læringsforløb,
Assessment-resultater, kompetencer og udviklingsområder.

Adgangen er permission- og scope-baseret. Hver visning kontrolleres mod den konkrete
permission og det konkrete scope — ikke mod rollenavnet "leder". Udvides en leders scope,
ændres data, ikke kode.

Indsigt på individniveau logges som adgangshændelse i `audit`. Det er ikke mistillid til
lederen, men en konsekvens af, at data om en medarbejders præstationer er persondata, og
at det skal kunne oplyses, hvem der har set dem.

### Kundecases

Adgang til en kundecase styres pr. case, ikke gennem rolle eller team:

| Egenskab | Design |
|----------|--------|
| **Én primær ejer** | Den sagsansvarlige rådgiver |
| **Deling** | Andre autoriserede brugere kan tilføjes i `case_participants` med en adgangstype |
| **Overdragelse** | Ejerskab kan overdrages; både gammel og ny ejer registreres |
| **Adgangskontrol pr. case** | Adgang findes ikke, før den er tildelt — heller ikke for en leder eller en administrator |
| **Four-eyes senere** | Deltagerrollerne skal rumme en reviewer-type, så et review-workflow kan tilføjes uden ændring af adgangsmodellen |

En leder får ikke automatisk adgang til sit teams kundesager. Lederens indsigt gælder
medarbejderens læring og kompetence, ikke kundens oplysninger. Skal en leder ind i en sag,
sker det ved eksplicit tildeling, som enhver anden deling — og det logges.

Det samme gælder administratoren: administratorrettigheder til indhold, brugere og
indstillinger giver ingen adgang til kundecases. En administrator har adgang til de sager,
vedkommende selv ejer eller er tildelt, på samme måde som enhver anden bruger.

### Håndhævelse i to lag

**Applikationslaget** er den primære kontrol: hver serverhandling verificerer permission og
scope, før den rører data.

**Row Level Security** er andet lag. RLS er ikke primærkontrollen — den er beskyttelsen
mod, at en fejl i applikationslaget bliver til et datalæk. De to lag skal være enige, og
uenighed mellem dem skal opdages i test, ikke i produktion.

---

## 11. Datasikkerhed og privacy

Arkitekturkrav, ikke juridisk rådgivning.

### Dataklassifikation

| Kategori | Indhold | Følsomhed | Adgangsprincip |
|----------|---------|-----------|----------------|
| Knowledge Engine-data | Fagligt indhold | Lav–middel (forretningsfortroligt) | Efter permissions og grants |
| Medarbejderdata | Identitet, rolle, team | Middel (persondata) | Egen + administrator |
| Læringsdata | Progression, gennemførelse | Middel (præstationsdata) | Egen + leder for team |
| Kundecasedata | Virksomheds- og kundeoplysninger | **Høj** | Ejer og eksplicit tildelte deltagere |
| AI-samtaledata | Spørgsmål, svar, citations | Middel–høj (kan indeholde kundedata) | Egen |
| Analytics | Aggregeret anvendelse og resultater | Middel | Leder for eget team |
| Audit | Hvem gjorde hvad | Høj integritet | Administrator, append-only |

AI-samtaledata er den kategori, der let undervurderes: en samtale ført inde i en kundecase
indeholder kundedata, uanset at den ligger i `ai`-domænet. Den skal arve kundecasens
adgangs- og sletteregler, ikke sit eget domænes.

### Principper

**Dataminimering.** Kun det, der er nødvendigt for retrieval, sendes til modellen. En hel
kundecase hører ikke i en prompt, hvis spørgsmålet angår ét dækningsforhold.

**Server-side AI-kald.** Ingen AI-kald fra klienten. API-nøgler eksisterer kun som secrets
i servermiljøet og aldrig i klientkode, i repoet eller i miljøvariabler med klient-prefix.

**Adgangskontrol i to lag.** Applikationslag plus RLS, som beskrevet i afsnit 10.

**Separation mellem brugere og teams.** Håndhæves gennem scope og RLS, ikke gennem
UI-filtrering.

**Logging med omtanke.** Audit-log registrerer handlinger, ikke indhold. Et logget
spørgsmål kan indeholde kundedata; derfor skal logning af promptindhold behandles som
kundedata og ikke som driftslog.

**Retention og sletning er konfigurerbar pr. datakategori.** Der findes ingen global
retentionsperiode i systemet. Hver kategori har sin egen politik, sat som konfiguration:

| Datakategori | Egen retention-policy |
|--------------|------------------------|
| AI-samtaler | Ja |
| Retrieval-logs | Ja |
| Kundecases | Ja |
| Læringsdata | Ja |
| Assessment-data | Ja |
| Analytics-hændelser | Ja |
| Audit-logs | Ja |

Perioderne er ikke fastlagt her og skal kunne ændres uden kodeændring. Sletning af en
bruger må ikke ødelægge audit-sporet — den skal anonymisere, hvor sporet skal bevares.
Kundecasedata skal kunne slettes selvstændigt, og en samtale ført inde i en kundecase følger
kundecasens politik, ikke AI-domænets.

**Auditability.** Administrative ændringer, dokumentændringer og adgangshændelser på
følsomme data logges. Audit-log kan ikke rettes.

**EU-region.** Vercel og Supabase konfigureres til EU-region. For AI-inferens gælder, at
arkitekturen ikke antager, at identificerbare eller fortrolige kundedata må sendes til en
ekstern leverandør: datakategori-matricen i AI Gateway afgør det, og kundedata er ikke
tilladt som standard. Den endelige compliancebeslutning træffes senere ud fra
organisationens krav, databehandleraftaler og gældende regler, og ændrer da konfiguration
frem for arkitektur.

---

## 12. Versionsstyring af faglig viden

Dette er arkitekturens mest domænespecifikke del. En forsikringsbetingelse er ikke et
dokument, der opdateres — det er en række af versioner, der hver har været gældende i en
periode, og som alle kan blive relevante igen, fordi en police tegnet i 2024 fortsat
reguleres af 2024-betingelserne.

### To tidsakser

| Akse | Spørgsmål | Felter |
|------|-----------|--------|
| **Gyldighedstid** | Hvornår gjaldt reglen i virkeligheden? | `valid_from`, `valid_to` |
| **Registreringstid** | Hvornår vidste systemet det? | `recorded_at` |

De to er ikke ens. Et betingelsessæt med virkning fra 1. januar kan være uploadet i
marts. Skelnen gør det muligt både at svare på, hvad der gjaldt, og at forklare, hvorfor
systemet svarede noget andet i februar.

### Versionskæden

```
documents (logisk dokument, uden indhold)
   │
   ├── document_version v1   valid_from 2023-01-01  valid_to 2024-01-01  status: superseded
   │      └── chunks → embeddings                    superseded_by → v2
   │
   ├── document_version v2   valid_from 2024-01-01  valid_to 2025-07-01  status: superseded
   │      └── chunks → embeddings                    superseded_by → v3
   │
   └── document_version v3   valid_from 2025-07-01  valid_to NULL        status: active
          └── chunks → embeddings
```

Chunks og embeddings hører til **versionen**, ikke til dokumentet. Det er det, der gør
historisk retrieval muligt: gamle vektorer bevares og kan søges i, når det eksplicit
ønskes.

### Retrieval-regler

**Standard er gældende viden.** Enhver forespørgsel har et temporalt filter. Uden
eksplicit angivelse er det `valid_from <= nu AND (valid_to > nu OR valid_to IS NULL) AND
status = active`.

**Historisk opslag er en eksplicit tilstand.** "Hvad var reglen den 1. marts 2024?" sætter
filteret til den dato. Svaret skal oplyse, at der svares på historisk grundlag, og hvilken
version der blev brugt.

**Historiske dokumenter er tilgængelige for autoriserede faglige brugere** gennem
permissionen `knowledge.document.read_historical`. De markeres altid tydeligt som
historiske og ikke-gældende — i retrieval-resultatet, i svaret og i kildehenvisningen.
Markeringen er ikke en formatteringsdetalje: et historisk svar uden markering er et forkert
svar.

**Versioner blandes aldrig implicit.** To versioner af samme dokument må ikke optræde i
samme kontekst uden at det er tilsigtet og oplyst. Det er den fejl, der ville producere
selvmodsigende faglige svar, som samtidig ser velunderbyggede ud.

**Citations peger på version.** En kildehenvisning uden versionsangivelse er ubrugelig
til det formål, den findes for.

**Advise fastfryser sit grundlag.** Når en rådgivning gives, skrives de anvendte
dokumentversioner til `case_sources`. En sag kan derefter rekonstrueres, også efter at
betingelserne er ændret.

### Livscyklus for en version

```
kladde → behandlet → klar til review → (faglig godkendelse) → aktiv
                                              │
                                              └─ afvist → tilbage til kladde

aktiv → erstattet → (evt.) deaktiveret
```

"Behandlet" og "klar til review" er ingestion-workerens tilstande. Overgangen til "aktiv"
er den eneste, et menneske foretager, og den eneste, der gør viden autoritativ.

Kun aktive versioner indgår i standard-retrieval. Erstattede versioner bevares og er
søgbare historisk. Deaktiverede versioner fjernes fra al retrieval, men slettes ikke,
fordi eksisterende citations peger på dem.

### Skift af embedding-model

Skifter embedding-modellen, er eksisterende vektorer ikke sammenlignelige med nye. Derfor:
hver embedding bærer sit modelnavn, søgning sker inden for én model ad gangen, og et
modelskifte kræver re-embedding af hele grundlaget, før den nye model tages i brug. Dette
er en planlagt, kostbar operation — ikke en konfigurationsændring.

---

## 13. Observability og kvalitet

Formålet er at kunne besvare: hvorfor svarede systemet, som det gjorde?

### Hvad der registreres pr. AI-interaktion

| Data | Formål |
|------|--------|
| Spørgsmålet | Udgangspunkt for analyse |
| Workflow og kontekst | Hvilken profil var i brug |
| Retrieval-forespørgsel og filtre | Hvad blev der søgt efter |
| Hentede chunks med score | Hvad fandt systemet |
| Anvendte chunks | Hvad kom i konteksten |
| Dokumentversioner | Hvilket grundlag gjaldt |
| Evidensvurdering | Var grundlaget tilstrækkeligt |
| Citations i svaret | Hvad svaret hviler på |
| Brugerfeedback | Var svaret brugbart |
| Latency pr. trin | Hvor tiden går |
| Fejl | Hvad gik galt |

**Videnshuller er det vigtigste signal.** Hver gang retrieval ikke finder tilstrækkelig
dokumentation, er det en konkret oplysning om, hvad Knowledge Engine mangler. Disse
hændelser skal aggregeres og vises i Admin, så vidensbasen kan udbygges målrettet frem
for efter fornemmelse.

**Et fast evalueringssæt.** Da modelversioner bevidst ikke er låst, skal kvalitet kunne
måles ved skift. Et sæt faglige spørgsmål med kendte korrekte kilder køres før og efter
enhver ændring i model, prompt, chunking eller retrieval. Uden det er "vi opgraderede
modellen" en ukontrolleret ændring i et system, der rådgiver om forsikring.

---

## 14. Deployment-arkitektur

```
GitHub repo
   │
   ├── main ──────────► Vercel Production ──► Supabase Production (EU)
   ├── staging ───────► Vercel Preview ─────► Supabase Staging (EU)
   └── feature/* ─────► Vercel Preview ─────► Supabase Staging (EU)
```

**Adskilte Supabase-projekter pr. miljø.** Ikke adskilte skemaer i samme projekt. Produktion
indeholder kundedata; staging må aldrig gøre det.

**Migrationer er versionerede og kører i pipeline**, ikke manuelt mod produktion.

**Secrets** opbevares i Vercels og Supabases secret-håndtering. Ingen nøgler i repoet.
Claude API-nøglen eksisterer kun i servermiljøet.

**Ingestion-workeren afvikles adskilt fra applikationen.** Dokumentbehandling — parsing af
store PDF'er, chunking, embedding af hundredvis af segmenter — er langvarigt arbejde, der
ikke kan rummes i en request-baseret funktion med tidsgrænse. Det er besluttet, at det
afvikles som jobs i en separat worker, jf. afsnit 8. Den konkrete leverandør er ikke låst,
og applikationsarkitekturen må ikke afhænge af, hvilken der vælges: applikationen opretter
jobs og læser deres tilstand, intet andet.

---

## 15. Fremtidige integrationer

Første version bruger manuel upload gennem Admin. Arkitekturen skal kunne tilføje
connectors uden ombygning af Knowledge Engine.

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Manuel upload   │  │ Dokumentsystem  │  │ Forsikrings-    │
│ (v1)            │  │ (senere)        │  │ system (senere) │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         └────────────────────┼────────────────────┘
                              ▼
                   ┌──────────────────────┐
                   │  SOURCE-ADAPTER      │
                   │  normaliserer til    │
                   │  fælles kontrakt     │
                   └──────────┬───────────┘
                              ▼
                   ┌──────────────────────┐
                   │  INGESTION-PIPELINE  │  uændret
                   └──────────┬───────────┘
                              ▼
                   ┌──────────────────────┐
                   │  RETRIEVAL           │  kender ikke kilden
                   └──────────────────────┘
```

Enhver fremtidig connector skal kunne levere: dokumentidentitet, indhold, dokumenttype,
produkt, version, gyldighedsperiode og kildereference. Derudover skal
connector-arkitekturen på forhånd tage højde for tre ting, som manuel upload ikke rejser:
**inkrementel synkronisering** (hvad er ændret siden sidst), **sletning i kilden** (et
dokument fjernet i kildesystemet skal deaktiveres her) og **kildesystemets egne
adgangsrettigheder** (et dokument, der er begrænset i kilden, må ikke blive frit
tilgængeligt gennem et AI-svar).

Det sidste punkt er det, der oftest overses, og det er svært at tilføje bagefter.

---

## 16. Tekniske risici og tradeoffs

| Risiko | Konsekvens | Håndtering |
|--------|------------|------------|
| **Serverless-tidsgrænser vs. ingestion** | Dokumentbehandling kan ikke gennemføres i en request | Løst: asynkron worker-arkitektur adskilt fra applikationen. Leverandør ikke låst |
| **Reranking koster latency** | Svartider stiger i alle workflows | Accepteret. Præcision vejer tungere end hastighed, når svaret angår en acceptregel. Måles fra V1 |
| **Flersproget indhold i samme indeks** | Søgning på tværs af sprog giver støj | `language` på version, chunk og embedding; retrieval filtrerer på sprog. Dansk er eneste sprog i V1 |
| **Redaction kan fjerne for meget** | Anonymisering fjerner kontekst, AI'en havde brug for, og svarkvaliteten falder uden at nogen opdager det | Måles med evalueringssættet. Redaktionsniveau er konfiguration pr. datakategori, ikke en fast regel |
| **Chunking ødelægger juridisk kontekst** | En undtagelse læses uden sin overskrift og betyder det modsatte | Struktur-bevidst chunking, overskriftskæde i hvert segment, evalueringssæt med netop denne fejltype |
| **Restrisiko for ugrundede svar** | Et fagligt forkert svar bruges over for en kunde | Tre lag af kontrol (afsnit 9). Ikke elimineret. Brugerfladen skal vise, at AI-svar er beslutningsstøtte, ikke afgørelse |
| **Modstridende kilder** | Systemet vælger vilkårligt hvilken der gælder | Ingen automatisk afgørelse. Begge vises, konflikten flages til Admin |
| **Modeldrift ved opgradering** | Adfærd ændrer sig usynligt | Fast evalueringssæt køres ved enhver ændring |
| **Skift af embedding-model** | Alle eksisterende vektorer bliver ubrugelige | Modelnavn på hver embedding; re-embedding som planlagt operation |
| **pgvector ved voksende volumen** | Søgetider stiger | Acceptabelt tradeoff i v1 mod at have viden, metadata og adgangskontrol ét sted. Overvåges; dedikeret vektordatabase er en senere mulighed |
| **Leverandørbinding til Supabase** | Auth, RLS, storage og database er sammenvævet | Accepteret. Domænelogik holdes uafhængig af leverandørspecifikke konstruktioner hvor det er praktisk muligt |
| **Kompleksitet i RLS** | Politikker bliver svære at overskue og fejl bliver stille | RLS som andet lag, ikke eneste. Adgangskontrol skal testes eksplicit |
| **Applikations- og præsentationslag i samme runtime** | Grænsen kan udviskes, og serverlogik kan ved uagtsomhed havne i klientbundles | Konvention og review. Ingen AI- eller retrieval-kode i klientmoduler |
| **AI-omkostninger** | Uforudsigelige driftsudgifter ved stigende brug | Måling pr. workflow fra start, rate limiting, caching af retrieval hvor det er forsvarligt |
| **Lederindsigt påvirker adfærd** | Rådgivere øver sig anderledes, hvis hver fejl er synlig for chefen | Besluttet: lederen ser individniveau inden for sit scope. Teknisk håndteret med logning af adgangshændelser; den adfærdsmæssige effekt håndteres i fase 4 gennem gennemsigtighed om, hvad der er synligt for hvem |

---

## 17. Non-blocking beslutninger

Alle blokerende arkitekturbeslutninger er truffet og låst. Punkterne nedenfor er bevidst
udskudt. Ingen af dem blokerer fase 4, og ingen af dem kræver ændringer i arkitekturen,
når de senere afgøres — de er valg af leverandør, tal eller indhold inden for rammer, der
allerede ligger fast.

| # | Beslutning | Hvornår | Hvorfor den ikke blokerer |
|---|------------|---------|----------------------------|
| 1 | Konkret worker-leverandør til ingestion | Ved implementeringsstart | Applikationen kender kun jobbets tilstand, ikke afviklingen |
| 2 | Konkret reranking-leverandør | Ved implementeringsstart | Reranking er et fast trin i flowet; udbyderen er udskiftelig |
| 3 | Embedding-model og modelversioner | Løbende | Behandles som konfiguration. Modelnavn ligger på hver embedding |
| 4 | Endelig compliancebeslutning om kundedata til ekstern AI-leverandør | Før Advise tages i brug på reelle kunder | Kundedata er ikke tilladt som standard. Beslutningen ændrer konfiguration i AI Gateway |
| 5 | Konkrete retentionsperioder pr. datakategori | Før produktion | Modellen er konfigurerbar pr. kategori; kun værdierne mangler |
| 6 | Det fulde permission-katalog | Under implementering | Modellen ligger fast; listen udbygges uden ændring af kontrollogikken |
| 7 | Detaljeret four-eyes/review-workflow | Efter V1 | Deltagerrollerne på en case rummer allerede en reviewer-type |
| 8 | Hvilke sprog der tilføjes efter dansk | Efter V1 | Datamodellen er multilingual-ready fra start |
| 9 | Grænseværdier i kvalitetstjekket ved ingestion | Under implementering | Rapporten er rådgivende; mennesket godkender |
| 10 | Konkrete aggregeringsniveauer i Analytics | Fase 4 | Afhænger af, hvad der faktisk skal vises, og hører til i UI-designet |

### Hvad der bør besluttes tidligt i fase 4

To ting hører formelt til i UI/UX-fasen, men har konsekvenser for tilliden til platformen
og bør tages op med det samme:

**Synlighed skal være synlig.** Rådgiveren bør kunne se, hvad lederen kan se om
vedkommende. Det er billigt at designe ind fra start og ubehageligt at tilføje senere.

**AI-svar skal fremstå som beslutningsstøtte.** Grænsen mellem forslag, arbejdsnote og
valideret konklusion er modelleret i data. Den skal være lige så tydelig i brugerfladen,
ellers gør modelleringen ingen forskel i praksis.
