# 08B — Produktionsgrundlag

**Fase:** 8B — Produktionsgrundlag (underfase af masterfase 8 — AI Copilot, B-019)
**Status:** 🔒 **GODKENDT OG LÅST — specifikation (2026-10-03, B-020).** Alle beslutninger D-1–D-20
og tekstændringerne K-1, K-2, K-4, K-6 og K-9 er godkendt (§19). **Intet er implementeret.**
Implementeringen af 8B er det næste arbejde og kræver en særskilt, eksplicit godkendelse.
Specifikationen ændres kun ved en eksplicit beslutning om at genåbne den. De åbne spørgsmål
Å-1–Å-6 forbliver åbne og blokerer ikke specifikationen.
**Sprog:** Dansk (kode på engelsk, brugerflade på dansk)
**Bygger på:** `docs/01`–`docs/08` (låst: fase 1–7 og 8A) og `docs/decisions.md` (til og med
B-019). Udbyderanalysen fra 2026-10-02 står i `docs/roadmap.md` under 8B.

Dokumentet er implementeringsspecifikationen for 8B. Den bygger videre på Knowledge Engine
(`docs/07`) og AI Gateway (`docs/08`) uden at ændre deres arkitektur. Hvor specifikationen
fortolker eller udbygger et låst dokument, er det markeret **(udledt)**. Punkter, der rører et
låst dokument, står i §18. Hvert forslag er markeret som enten **anbefaling** (mit forslag),
**beslutning** (allerede truffet og låst) eller **åbent spørgsmål**. Beslutningslisten står i §19.
Ingen leverandør er låst, før du godkender den.

Oplysninger om leverandører er fra 2026-10-02 og 2026-10-03 og skal efterprøves, før der
underskrives aftaler.

---

## 0. Formål

**Et formål:** at gøre Knowledge Engine i stand til at producere evidens i produktionskvalitet,
så `ProductionEvidenceSet` sikkert kan bruges af 8C og de efterfølgende AI-moduler.

I dag kan en production-model ikke modtage noget (`docs/07` §9.1, B-012), fordi al evidens er
`development`. Den er dannet med test-embedderen og `none`-rerankeren, og ingen har målt, om
retrieval rammer rigtigt (B-008). 8B skaffer tre ting:

1. rigtige implementeringer (embedding og reranking),
2. en målbar dokumentation af, at de rammer rigtigt (evaluering med gates),
3. en driftssikker vej for dokumenter ind i systemet (production worker og upload-sikkerhed).

Først når alle tre er på plads, og en konkret konfiguration har bestået evalueringen, må et
EvidenceSet få `grade = production` (§10).

---

## 1. Scope og grænser

### 1.1 Hører til 8B

| Område | Afsnit |
|--------|--------|
| Production-embedder bag `Embedder`-interfacet og en ny aktiv embedding-model | §2 |
| Production-reranker bag `Reranker`-interfacet | §3 |
| Retrieval-evalueringssystem med metrics og gates | §4 |
| Formatet for evalueringssættet og dets infrastruktur | §5 |
| Production-ingestion-worker med least-privilege adgang | §6 |
| Upload-sikkerhed og virusscanning (B-26, åbent siden fase 7) | §7 |
| Teknisk spærre for kundedata, indtil forudsætningen er opfyldt | §8 |
| Betingelserne for `grade = production` og et register over godkendte konfigurationer | §9, §10 |
| Versionering og reproducerbarhed af retrieval | §11 |
| Performance-mål, omkostningsmodel og teknisk observability | §12–§14 |
| Security, tests og exit-kriterier | §15–§17 |
| Eventuelt testisolation og en browserbaseret upload-test (`docs/07` §20.5) | §16 |

### 1.2 Hører eksplicit IKKE til 8B

| Område | Hører til |
|--------|-----------|
| En rigtig LLM eller generativ model (Claude API eller anden) | 8C |
| Validering af Copilot-prompterne mod en rigtig model | 8C |
| Samtalelagring og -historik | 8C |
| Rate limiting og omkostningsstyring af AI-kald | 8C |
| Retentionsperioder og -mekanisme for AI-loggen | 8C |
| Persistering af retrieval-sporet pr. AI-svar (citations og `case_sources`) | 8C og 11 |
| Åbning for kundedata til en model | Besluttes separat (§8). Ikke i 8B |
| OCR, DOCX og andre filformater | Ikke planlagt. 8B understøtter kun PDF med tekstlag |
| Learn, Practice, Advise og Assessment som moduler | 9–12 |
| Supabase i produktion og koblingen af Vercel-demoen (B-003) | 21 |
| Bruger- og AI-analytics (dashboards over brug og læring) | 15 |

### 1.3 Skellet mellem 8B og 8C

- **8B leverer evidens og intet andet.** Når 8B er færdig, kan `retrieveEvidence` udstede et
  `ProductionEvidenceSet`. Ingen model genererer tekst.
- **8C bruger evidensen:** en rigtig model bag gatewayen, validerede prompter, samtaler, rate
  limiting og retention.
- Copilot kører i 8B fortsat på stub-modellen. Den kan modtage production-evidens, fordi
  B-012 kun forbyder parringen "production-model med udviklingsevidens". Svaret er stadig
  `development`, fordi modellen er det.

---

## 2. Embeddings

### 2.1 Krav

| Krav | Kilde |
|------|-------|
| Behandling i EU og en databehandleraftale med udbyderen | Brugerens krav (`docs/roadmap.md` 8B) |
| Dansk som eneste sprog i V1, flersproget klar | `docs/03` §6 |
| Søgning inden for én model; vektorer fra flere modeller sammenlignes aldrig | `docs/07` §7 |
| Kolonnen `embedding` er `vector` uden fast dimension; HNSW-indeks pr. model | `docs/07` §7 |
| Dimension højst 2000 (pgvectors grænse for HNSW på `vector`; constraint i `embedding_models`) | Fase 7-skema |
| Hele chunket med overskriftskæde og `lead_in` skal kunne embeddes uden afkortning | `docs/07` §6 |

### 2.2 Sammenligning

Alle tre mulige kandidater findes hos AWS Bedrock, så de kan prøves i samme evaluering under
samme aftale.

| | **Cohere Embed v4** (Bedrock) | **Cohere embed-multilingual-v3** (Bedrock) | **Azure OpenAI text-embedding-3-large** |
|---|---|---|---|
| Hvor data behandles | **EU-geografisk.** Kaldet sendes til Frankfurt (kilderegion), men Bedrock kan rute det til en anden destinationsregion inden for EU-profilen. **Ikke kun Frankfurt** | Kun Frankfurt (in-region) | EU-region (skal verificeres ved valg; ikke valgt) |
| Databehandleraftale | AWS' GDPR-databehandleraftale | Samme | Microsofts databehandleraftale |
| Kontekst pr. tekst | Ca. 128.000 tokens | **512 tokens (ca. 2.048 tegn)** | 8.191 tokens |
| Dimension | 256, 512, 1024 eller 1536 (valgfri) | 1024 | 3072, kan reduceres |
| Adskiller dokument- og forespørgselsinput | Ja (`input_type`) | Ja (`input_type`) | Nej |
| Dansk kvalitet | Ukendt. Ingen offentlige danske tal | Lå nær toppen i det skandinaviske benchmark (SEB, 2024) | Bedste offentlige skandinaviske resultat (SEB, 2024) |
| Samme leverandør som rerankeren (§3) | Ja | Ja | Nej (Azure) |

**Det afgørende tekniske fund:** v3 kan højst embedde 512 tokens pr. tekst. Fase 7's chunker har
et udgangspunkt på 300–500 tokens og højst ca. 800 (`docs/07` §6). Embedding-input indeholder
desuden overskriftskæden og `lead_in`. Med v3 skal chunkstørrelsen sænkes til højst ca. 400
tokens inklusive overskrift og `lead_in`. Det giver flere og kortere chunks og øger risikoen
for, at en undtagelse skilles fra sin sammenhæng. Det er netop den fejl, `docs/07` §6 advarer
mod. Danske sammensatte ord giver desuden flere tokens pr. tegn end engelsk.

### 2.3 Anbefaling

**Cohere Embed v4 på AWS Bedrock med den EU-geografiske inferensprofil og dimension 1024**
(D-1, godkendt). Embed-multilingual-v3 i Frankfurt og andre modeller kan evalueres
mod samme sæt (§4.5).

- Begrundelse: hele chunket kan embeddes uden at ændre chunkingen. Data forlader ikke EU, og
  embedding, reranking og worker kan ligge hos samme leverandør under én aftale.
- Udbyder og model er data (`embedding_models`) og konfiguration, aldrig en fast værdi i
  domænemodellen. Et senere skifte er en ny model med eget indeks, evaluering og godkendelse.
- 1024 dimensioner holder indekset lille og ligger langt under pgvectors grænse på 2000. Et
  skift til 1536 er en ny model med eget indeks, ikke en ændring.
- **EU-residency (præcis):**
  - Behandlingen af embeddings er **EU-geografisk, ikke kun Frankfurt.**
  - Kilderegionen, som appen og workeren kalder, er eu-central-1 (Frankfurt). Bedrock kan
    rute et Embed v4-kald videre til en anden destinationsregion inden for EU-profilen.
  - Dokumentationen må ikke beskrive det som "Frankfurt-only".
  - Rerank 3.5 kører derimod in-region i Frankfurt.
  - Det afviger fra roadmappens oprindelige anbefaling (v3, kun Frankfurt), og afvigelsen er
    godkendt med D-1.
- Den endelige model vælges af evalueringen (§4), ikke af denne tabel. Det er fremgangsmåden fra
  roadmappen: vælg én, prøv den mod evalueringssættet, og skift, hvis den ikke rammer.

### 2.4 Interface og forespørgsler (udledt)

- `Embedder` udvides med inputtype: `embed(texts, { inputType: "document" | "query" })`.
  Cohere-modellerne giver dårligere resultater, hvis dokument og forespørgsel embeddes ens. Se
  §18 K-2.
- Chunks embeddes i workeren (`document`). Forespørgsler embeddes i appen ved retrieval
  (`query`), med samme model (`docs/07` §7).
- **Uden afkortning:** udbyderens truncate sættes til `NONE`. Er et input for langt, fejler
  trinnet med fejlkoden `embedding_input_too_long`. Der embeddes aldrig stiltiende et afkortet
  chunk.

### 2.5 Versionsstyring og modelskifte

Mekanismen fra `docs/07` §7 bruges uændret:

1. Den nye model registreres som `candidate` i `knowledge.embedding_models` (udbyder,
   modelnavn, modelversion og dimension) med eget partielt HNSW-indeks via migration.
2. `reembed`-jobs embedder alle chunks i publicerede, ikke-deaktiverede versioner og i
   versioner under behandling.
3. Evalueringen kører med kandidaten (§4).
4. Skiftet sker i én transaktion, og kun ved 100 % dækning og bestået evaluering. Den gamle
   model bliver `retired`, og dens vektorer bevares (`docs/07` §7, B-25).

- **Modelversion:** `model_version` er udbyderens version eller modellens id-suffiks. Udbyderen
  kan ændre modellen bag et uændret id. Derfor køres et lille fast kontrolsæt af tekster mod
  modellen. Ændrer vektorerne sig ud over en tolerance, er det en ny version. Det sker ved
  opstart af workeren og dagligt. **(udledt)**
- **Ved modelskifte:** vektorerne er ikke sammenlignelige på tværs. Der sker fuld re-embedding,
  og den godkendte retrieval-konfiguration (§10) gælder ikke den nye model. En ny konfiguration
  skal evalueres og godkendes.

### 2.6 Re-embedding, batch og fejl

| Emne | Anbefaling |
|------|------------|
| Batchstørrelse | Op til 96 tekster pr. kald (udbyderens grænse for Cohere på Bedrock), konfiguration |
| Parallelitet | Højst 2 samtidige kald pr. worker, konfiguration |
| Genforsøg | Ved 429 og 5xx: eksponentiel backoff med jitter, højst 5 forsøg pr. batch. Derefter fejler trinnet og jobbet med sin backoff (fase 7: 30 s × 2^n, højst 3 jobforsøg) |
| Ikke-genforsøgbare fejl | 400 (fx for langt input) fejler versionen med årsag, uden genforsøg |
| Idempotens | `input_hash` pr. chunk og model. Kun chunks uden embedding for modellen embeddes (`worker_chunks_to_embed`). En genkørsel giver ingen dubletter |
| Omfang ved re-embedding | Ca. 2.000 sider er ca. 5.000–8.000 chunks og 1,5–3 mio. tokens. Minutter, ikke timer |

### 2.7 Udvikling eller produktion

- Graden er en egenskab ved implementeringen (`docs/07` §9.1). Bedrock-embedderen er
  `production`, og test-embedderen er `development`.
- Databasen nægter allerede at aktivere test-udbyderen. 8B tilføjer, at en model kun kan blive
  `active`, hvis der findes en godkendt retrieval-konfiguration for den (§10), eller hvis den
  aktiveres i `local`/`test`. **(udledt)**
- Hver embedding peger på sin model, så det kan altid ses, hvilken model og dermed hvilken grad
  en vektor stammer fra.

---

## 3. Reranking

### 3.1 Krav

| Krav | Mål |
|------|-----|
| Kvalitet | Skal forbedre rækkefølgen målbart i forhold til fusion alene (gate i §4.4) |
| Latency | p95 ≤ 500 ms for 30 kandidater |
| EU og databehandleraftale | Som embeddings |
| Score | Normaliseret til [0, 1] og sammenlignelig inden for én forespørgsel (`docs/07` §9) |
| Omkostning | Lineær i antal forespørgsler. Den dominerende driftsudgift (§13) |

### 3.2 Sammenligning

| | **Cohere Rerank 3.5** (Bedrock, Frankfurt) | **Cohere Rerank 4** (Microsoft Foundry) | **Voyage rerank-3** (MongoDB Atlas, EØS) |
|---|---|---|---|
| Hvor data behandles | Frankfurt (in-region) | EU-region, fx Sweden Central | EØS |
| Databehandleraftale | AWS | Microsoft (Marketplace-vilkår **[skal verificeres]**) | MongoDB (dækning af API'et **[skal verificeres]**) |
| Kontekst pr. kandidat | 4.096 tokens inkl. forespørgsel | 32.000 | Høj |
| Pris pr. 1.000 forespørgsler | ca. $2 (op til 100 kandidater) | ca. $2–2,50 | Afregnes pr. token, ca. $0,05 pr. mio. |
| Latency | ca. 80–370 ms afhængigt af mængden (tredjepartsmåling) | Ukendt | Ukendt |
| Samme leverandør som embedding | Ja | Nej | Nej |

### 3.3 Anbefaling

**Cohere Rerank 3.5 på AWS Bedrock i Frankfurt.**

- Begrundelse: den behandler data in-region, ligger hos samme leverandør og under samme aftale
  som embedding, og prisen er kendt. Rerank 4 og Voyage er nyere, men kræver en leverandør mere.
  Skuffer 3.5 i evalueringen, er Rerank 4 næste kandidat.
- Kontekstgrænsen på 4.096 tokens rummer chunks på op til ca. 800 tokens med forespørgsel og
  overskrift.

### 3.4 Version, sporing og håndhævelse

- `Reranker.id` er fx `bedrock:cohere.rerank-v3-5:0`, og `version` er udbyderens modelversion.
  Begge står allerede i hvert EvidenceSet (`retrieval.reranker`, `docs/07` §10) og indgår i
  konfigurationens fingeraftryk (§10.2).
- **`none` er fortsat kun tilladt i `local`/`test`.** Det håndhæves fire steder:
  - registret er fail-closed (`docs/07` §9.1);
  - `requireProductionEvidence` afviser `none`;
  - en retrieval-konfiguration med `none` kan ikke godkendes (constraint, §10);
  - en evalueringskørsel med en udviklingsimplementering kan ikke bestå (hård gate, §4.4).
- Registret får en ny implementering. `IPA_RERANKER=bedrock-cohere-rerank-3-5` vælger den.
  Et ukendt id fejler som i dag.

### 3.5 Fejl ved reranking

- Fejler rerankeren ved en forespørgsel (timeout 2 s, højst 1 genforsøg ved 429/5xx), er
  retrieval **utilgængelig**. Det er en systemfejl og aldrig "utilstrækkeligt grundlag" (B-007).
- Der faldes **ikke** tilbage til `none` eller fusionsrækkefølgen i produktion. Det ville give
  evidens af ukendt kvalitet med production-grad.

---

## 4. Evaluering

### 4.1 Formål og princip

Evalueringen måler retrieval, ikke svar. Hver kørsel tager én retrieval-konfiguration (§10) og
ét evalueringssæt (§5), kører alle spørgsmål gennem den rigtige `runRetrieval` som den angivne
evalueringsbruger og sammenligner med facit. Resultatet er en rapport med metrics, gates og
detaljer pr. spørgsmål.

### 4.2 Hvad der måles

| Område | Metric | Definition |
|--------|--------|------------|
| Korrekt kilde | **Source Recall@K** | Andel af besvarbare spørgsmål, hvor mindst én forventet dokumentversion er blandt de K evidenselementer |
| Korrekt chunk | **Passage Recall@K** | Andel af besvarbare spørgsmål, hvor den primære forventede passage (grad 3) er dækket af et evidenselement |
| Svar på tværs af chunks | **Full Coverage@K** | Gennemsnitlig andel af de påkrævede passager, der er dækket |
| Rækkefølge | **MRR@K** | Gennemsnit af 1/rang for den første grad 3-passage |
| Rækkefølge, graderet | **nDCG@K** | Med graderne 3, 2 og 1 (§5.4) |
| Historisk og gældende | **Temporal korrekthed** | `current` returnerer aldrig en ikke-gældende version. `as_of` returnerer den rigtige version, markeret historisk |
| Spørgsmål uden svar | **Korrekt afvisning** | Andel af ubesvarbare spørgsmål, der giver et tomt EvidenceSet ("utilstrækkeligt") |
| Falsk afvisning | **Falsk afvisning** | Andel af besvarbare spørgsmål, der fejlagtigt giver tomt resultat |
| Konflikter | **Konfliktdækning** | Begge parter returneres og markeres, når brugeren har adgang til begge. Ellers den neutrale indikator (B-20) |
| Dokumentadgang | **Adgangslæk** | Antal evidenselementer eller metadata fra dokumenter, evalueringsbrugeren ikke har adgang til |
| Produktfiltre | **Filterbrud** | Antal elementer uden for de anmodede produkter og dokumenttyper |
| Falske positive | **Distraktor-indtrængen** | Andel af returnerede elementer over tærsklen, der er markeret irrelevante eller stammer fra et distraktor-dokument |

K er konfigurationens `topK` (i dag 8). Recall@1 og Recall@3 rapporteres desuden.

### 4.3 Hvilke metrics vi bruger, og hvorfor

- **Recall@K for kilde og passage er de vigtigste.** Hvad retrieval ikke finder, kan ingen model
  bruge, og et forkert svar på en dækning er værre end et langsomt.
- **Korrekt afvisning og falsk afvisning** måler tærsklen for "utilstrækkeligt grundlag", som
  B-008 kræver valideret. De kalibrerer `minScore`.
- **MRR** måler, om det bedste kommer først. Det betyder noget, fordi modellen i 8C ser
  kandidaterne i rækkefølge.
- **nDCG rapporteres, men gates ikke fra start.** Det kræver omhyggelig gradering, og med 30–50

  spørgsmål er tallet ustabilt.
- **Små tal kræver ærlighed:** med 40 spørgsmål er én fejl 2,5 procentpoint. Rapporten viser
  antal og et 95 %-konfidensinterval (Wilson) for hver andel. Et kvalitetsgate afgøres på
  punktestimatet, men rapporten markerer, når intervallet krydser grænsen.

### 4.4 Gates (D-6)

**Princip.** Hårde gates beskytter sikkerhed og isolation og har nul tolerance. Kvalitetsgates
måler, hvor godt retrieval rammer, og har statistiske tærskler. **Et godt gennemsnit kan aldrig
kompensere for et sikkerhedsbrud.** Fejler én hård gate, er kørslen dumpet, uanset alle andre tal.

#### Hårde gates (safety/security) — nul tolerance

| # | Metric | Tærskel | Hvorfor | Ved fejl ved godkendelse | Ved fejl i regression |
|---|--------|---------|---------|--------------------------|-----------------------|
| **H1** | **Uautoriseret retrieval:** antal evidenselementer fra dokumenter, evalueringsbrugeren ikke har læseadgang til (inkl. `read_historical` ved `as_of`) | **0** | Én læk er et brud på `docs/07` §4 og på KRAV-ROL-003. Det kan ikke opvejes af kvalitet | Konfigurationen kan ikke godkendes | Konfigurationen suspenderes automatisk. Al evidens bliver `development` (D-8) |
| **H2** | **Metadatalæk:** forekomster i det serialiserede EvidenceSet og i retrieval-funktionens rå resultat af id, titel, dokumenttype, version, kilde, sider, afsnit, overskrifter, uddrag, konflikt-id, regel, beskrivelse eller note fra et utilgængeligt dokument. Den neutrale konfliktindikator er den eneste tilladte spor (B-20) | **0** | Eksistensen af et dokument eller en konflikt er i sig selv information (`docs/07` §14, §15 "Konfliktlæk") | Som H1 | Som H1 |
| **H3** | **Gyldighedsbrud:** i `current` en ikke-gældende, fremtidig, upubliceret, deaktiveret eller tilbagetrukket version; i `as_of` en anden version end den gyldige på datoen; en historisk version uden historisk markering; to versioner af samme dokument i ét resultat | **0** | Et historisk svar uden markering er et forkert svar (`docs/03` §12). Versioner blandes aldrig (`docs/07` §8.2) | Som H1 | Som H1 |
| **H4** | **Filterbrud:** elementer uden for de anmodede produkter, dokumenter eller dokumenttyper | **0** | Filtre må kun snævre ind (`docs/07` §8.2). Et brud er en logikfejl, der også kan blive en adgangsfejl | Som H1 | Som H1 |
| **H5** | **Skjult konflikt:** et returneret element i en åben konflikt uden konfliktmarkering, eller hvor brugeren har adgang til begge parter, men kun får den ene | **0** | En bruger, der kun ser den ene side af en konflikt, handler på et ufuldstændigt grundlag (`docs/03` §16, B-20) | Som H1 | Som H1 |
| **H6** | **Udviklingsevidens:** kørslen bruger en udviklingsimplementering (test-embedder, `none`), `devOverride`, et fingeraftryk, der ikke matcher den konfiguration, der evalueres, eller elementer fra en chunker-version uden for konfigurationen | **0** | Rapporten skal dokumentere præcis den konfiguration, der godkendes, og intet andet | Kørslen er ugyldig og kan ikke registreres | Konfigurationen suspenderes automatisk |
| **H7** | **Isolation og integritet:** kørslen er ikke foretaget i evalueringsmiljøet, bruger andre identiteter end evalueringsbrugerne, eller sættets eller korpussets checksums ændrer sig under kørslen | **0** | Evaluering må aldrig røre produktionsdata, og et resultat skal kunne reproduceres | Kørslen er ugyldig og kan ikke registreres | Kørslen er ugyldig (alarm) |

#### Kvalitetsgates — statistiske tærskler

Q1–Q7 er de **initiale** tærskler (D-6). De er ikke uforanderlige domæneregler og er ikke
hårdkodet i koden:

- Tærsklerne ligger i et versionsstyret **gate-sæt** (`evals/retrieval/gates/gates-v1.json`, §5.1).
  Hver evalueringskørsel og hver godkendt konfiguration henviser til gate-sættets version og
  checksum. `record_evaluation_run` genberegner gates mod netop det gate-sæt.
- Et gate-sæt kan kun tages i brug, når det er registreret i produktion af `evaluation_publisher`
  og godkendt eksplicit af et menneske med `system.settings.manage` (samme mønster som
  konfigurationerne, §10). Administratoren kan ikke rette et registreret gate-sæt.
- **Rekalibrering** sker kun gennem en ny version af gate-sættet, en ny versionsstyret
  evalueringsbaseline og en eksplicit godkendt beslutning i `docs/decisions.md`. En konfiguration,
  der er godkendt mod et ældre gate-sæt, beholder sin godkendelse, indtil den evalueres igen.
- **H1–H7 er ikke en del af gate-sættet.** Nul tolerance er en invariant i koden og i
  `record_evaluation_run`. Den kan ikke rekalibreres.

| # | Metric | Tærskel | Hvorfor | Ved fejl ved godkendelse | Ved fejl i regression |
|---|--------|---------|---------|--------------------------|-----------------------|
| **Q1** | **Source Recall@8** (besvarbare spørgsmål) | **≥ 0,95** | Det rigtige dokument skal næsten altid findes. Hvad retrieval ikke finder, kan ingen model bruge. Ved ca. 35 besvarbare spørgsmål tillader det én fejl | Kan ikke godkendes | Alarm og faglig/teknisk vurdering (D-8) |
| **Q2** | **Passage Recall@8** (grad 3-passagen dækket) | **≥ 0,85** | Det rigtige dokument er ikke nok. Undtagelsen skal med. Lavere end Q1, fordi chunk-grænser kan splitte en passage | Kan ikke godkendes | Alarm og vurdering |
| **Q3** | **MRR@8** (første grad 3-passage) | **≥ 0,70** | Det bedste skal i gennemsnit stå på plads 1–2. Det er det, modellen i 8C læser først | Kan ikke godkendes | Alarm og vurdering |
| **Q4** | **Korrekt afvisning** (ubesvarbare og adgangsspørgsmål giver tomt resultat). Komplementet er falsk-positiv retrieval | **≥ 0,80** | "Der findes ikke tilstrækkelig dokumentation" skal faktisk komme, når grundlaget mangler (KRAV-AI-004, B-008). Ved ca. 6 ubesvarbare tillader det én fejl | Kan ikke godkendes | Alarm og vurdering |
| **Q5** | **Falsk afvisning** (besvarbare giver tomt resultat) | **≤ 0,10** | En for høj tærskel gør systemet ubrugeligt. Q4 og Q5 balancerer `minScore` | Kan ikke godkendes | Alarm og vurdering |
| **Q6** | **Distraktor-indtrængen:** andel af returnerede elementer over tærsklen i distraktor-spørgsmål, der stammer fra distraktor-dokumentet | **≤ 0,10** | Et dokument, der ligner, men gælder et andet produkt eller emne, er den mest sandsynlige kilde til et forkert, velbegrundet udseende svar | Kan ikke godkendes | Alarm og vurdering |
| **Q7** | **Rerankerens bidrag:** Passage Recall@8 og MRR@8 med reranker sammenlignet med den samme kørsel uden reranker | **Ikke lavere** | Reranking er et obligatorisk trin (`docs/03` §7). Det skal betale for sin latency og pris | Kan ikke godkendes | Alarm og vurdering |

nDCG@8 og Recall@1/@3 rapporteres, men gates ikke (D-5).

#### Små stikprøver uden falsk sikkerhed (pilot-evaluering)

Det første sæt på 30–50 spørgsmål er en **pilot-evaluering**. Det bruges sådan:

1. **Hårde gates kræver ingen statistik.** Ét brud er ét brud. De gælder fuldt ud fra første
   spørgsmål, og de er derfor også testet deterministisk i pgTAP og integrationstests.
2. **Minimum pr. type.** En kørsel er kun gyldig med mindst 20 besvarbare (`direct` og
   `multi_chunk`), 5 ubesvarbare, 3 historiske, 2 konflikt-, 3 distraktor- og 3 adgangs- eller
   filterspørgsmål. Ellers er der ikke noget at måle på.
3. **Hver fejl forklares.** Ethvert spørgsmål, der fejler et kvalitetsgate, får en skriftlig
   årsagsnote i rapporten, før konfigurationen kan godkendes. Fejlene læses én for én. De
   gennemsnitliggøres ikke væk.
4. **Usikkerheden vises.** Rapporten viser Wilson 95 %-intervallet for hver andel. Gatet
   afgøres på punktestimatet, men et nedre interval under tærsklen markeres som "usikker" i
   rapporten. *Præciseret i B-030:* en pilot-kørsel, der består på punktestimatet med usikre
   intervaller (`pass_with_uncertainty`), kan kun godkendes efter en eksplicit, registreret
   menneskelig accept af usikkerheden. Tier standard er uændret, og hårde gates kan aldrig
   accepteres (§21.10).
5. **Godkendelsen er en pilot-godkendelse.** Under 100 spørgsmål (`tier: pilot`) står det i
   konfigurationen og i Admin. Den gælder det korpus, der blev evalueret (offentlige
   betingelser). Når korpusset udvides med nye dokumenttyper (fx acceptregler), kræves en ny
   kørsel med spørgsmål til dem. *Præciseret i B-030:* området er de evaluerede par af produkt og
   dokumenttype, så et produkt, der ikke er evalueret, arver ikke godkendelsen (§21.10).
6. **Ingen tilpasning til sættet.** Tærsklen kalibreres efter en fast procedure, der skrives i
   evalueringens README før baseline. Fra ca. 100 spørgsmål bruges holdout (§5.6).
7. **Sættet skal vokse.** Målet er mindst 100 spørgsmål med holdout, før masterfase 18
   (Pilotversion), og nye spørgsmål fra hvert videnshul og hver fejlrapport.

### 4.5 Infrastruktur (udledt)

- **Kørsel:** et Node-script i repoet (`npm run eval:retrieval`). Det kalder den rigtige
  `runRetrieval` med implementeringerne fra registret, som hver evalueringsbruger. Der findes
  ingen særlig evalueringskode i retrieval.
- **Miljø:** et separat evalueringsmiljø, dvs. et eget Supabase-projekt med samme migrationer,
  de rigtige udbydere og evalueringskorpusset. Evalueringsdokumenter blandes aldrig ind i
  produktionsviden. Det løser også testisolationen fra `docs/07` §20.5.
- **Flere kandidater:** én kørsel kan evaluere flere konfigurationer mod samme sæt og korpus,
  fx Embed v4 med 1024 og 1536 dimensioner, v3 og andre rerankere. Hver kandidatmodel har sin
  egen række i `embedding_models` og sit eget indeks i evalueringsmiljøet. Rapporterne
  sammenlignes side om side. Udbyder og model er data (`embedding_models`, konfigurationen) og
  aldrig en fast værdi i domænemodellen. Registret oversætter et udbyder-id til en
  implementering.
- **Rapport:** hver kørsel giver en JSON-rapport med checksum. Den indeholder metrics, gates,
  konfidensintervaller, minimum pr. type, årsagsnoter, konfigurationens fingeraftryk, sættets
  version og korpussets checksum.
- **Registrering i produktion — adskilte identiteter (D-7, D-18):** rapporten skrives til
  produktionsdatabasen af en særskilt identitet, `evaluation_publisher`. Det er en LOGIN-rolle,
  der kun bruges af evalueringskørslen i CI, og som kun må kalde
  `knowledge.record_evaluation_run`. Funktionen genberegner gate-resultaterne fra rapportens
  metrics og afviser en rapport, der ikke stemmer. **En administrator kan ikke indsætte eller
  rette en evalueringskørsel.** En administrator kan kun godkende en konfiguration, der
  henviser til en kørsel, som publisheren har registreret, og som har bestået. En forfalsket
  rapport kræver derfor, at publisherens credential kompromitteres. Det er ikke nok at være
  administrator.
- **Regression:** evalueringen køres ved hver ændring af model, reranker, chunker,
  retrieval-algoritme eller parametre, og planmæssigt hver uge. Udfaldet følger tabellerne i
  §4.4.

---

## 5. Evalueringssættet

### 5.1 Placering og struktur (D-16)

Evalueringssættet ligger versionsstyret i repoet:

```
evals/retrieval/
  README.md                       metode: metrics, gates, kalibreringsprocedure, hvordan sættet laves
  schema/case.schema.json         JSON Schema for ét spørgsmål (skema v1, §5.2)
  schema/manifest.schema.json     JSON Schema for et manifest
  manifests/terms-v1.json         sæt-id, version, dokumenter (nøgle, titel, version, gyldighed,
                                  kilde-URL, checksum, licens/tilladelse), evalueringsbrugere
                                  og tildelinger
  cases/terms-v1.jsonl            ét spørgsmål pr. linje
  gates/gates-v1.json             versionsstyret gate-sæt med tærsklerne for Q1–Q7 (§4.4)
  fixtures/                       kun materiale, vi må have i repoet: fiktive tillæg og versioner
                                  til konflikt-, historik- og adgangsspørgsmål
```

- **JSON Lines:** ét spørgsmål pr. linje, så tusindvis af spørgsmål kan diffes, flettes og
  filtreres.
- **Offentlige betingelser** ligger kun i repoet, hvis licensen tillader det. Ellers peger
  manifestet på kilde-URL og checksum, og dokumentet indlæses kun i evalueringsmiljøet.
- **Ingen fortrolige kundedata.** Tilladt er offentlige forsikringsbetingelser,
  syntetiske/fiktive tilfælde og godkendt testmateriale. En CI-kontrol kører 8A's
  redaction-detektorer (CPR, CVR med kontekst, e-mail, telefon og konto) over `cases/` og
  `fixtures/` og fejler ved fund. Kun syntetiske værdier i en eksplicit tilladelsesliste
  undtages.
- Skemaerne valideres i en enhedstest, så et ugyldigt spørgsmål ikke kan committes.

### 5.2 Spørgsmål (skema v1)

```jsonc
{
  "id": "terms-0007",                 // stabilt, ændres aldrig
  "schema": 1,
  "type": "direct",                   // se §5.3
  "question": "Dækker erhvervsansvaret skade på ting, sikrede har til reparation?",
  "language": "da",
  "actor": "reader_terms",            // evalueringsbruger fra manifestet (§5.5)
  "mode": "current",                  // eller "as_of" med "as_of": "2024-03-01"
  "filters": { "products": ["erhvervsansvar"], "documentTypes": ["terms"] },
  "expected": {
    "outcome": "evidence",            // eller "insufficient"
    "passages": [                     // facit — se §5.4
      { "document": "ea-terms", "version": "3", "anchor": "har til bearbejdning, reparation", "grade": 3 },
      { "document": "ea-terms", "version": "3", "anchor": "Tillægget skal fremgå af policen", "grade": 2 }
    ],
    "temporalStatus": "current",
    "mustNotInclude": [ { "document": "ea-terms", "version": "2" } ],
    "conflict": null                  // eller { "documents": ["ea-accept", "ea-accept-tillaeg"] }
  },
  "split": "dev",                     // "dev" eller "holdout"
  "tags": ["undtagelse", "behandlingsskade"],
  "author": "…", "created": "2026-10-10", "notes": "…"
}
```

### 5.3 Spørgsmålstyper

| `type` | Formål | Facit |
|--------|--------|-------|
| `direct` | Ét klart svar i én passage | 1 passage grad 3 |
| `multi_chunk` | Svaret ligger på tværs af flere chunks (fx undtagelse og tillæg) | ≥ 2 passager grad 3 |
| `historical` | En regel, der gjaldt på en dato (`mode: as_of`) | Passage i den historiske version og `mustNotInclude` for den gældende |
| `conflict` | To autoritative kilder er uenige | Begge dokumenter i `conflict` |
| `unanswerable` | Svaret findes ikke i korpusset | `outcome: insufficient` |
| `distractor` | Ligner et relevant emne, men står i et irrelevant dokument eller produkt | `mustNotInclude` for distraktoren |
| `permission` | Svaret står i et dokument, evalueringsbrugeren ikke har adgang til | `outcome: insufficient` og ingen metadata fra dokumentet |
| `filter` | Svaret findes i flere produkter, men forespørgslen er filtreret | Kun det filtrerede produkts passager |

**Første sæt (30–50 spørgsmål), foreslået fordeling:** ca. 40 % `direct`, 15 % `multi_chunk`, 10 %
`historical`, 5–10 % `conflict`, 15 % `unanswerable`, 10 % `distractor` og 5 % `permission`/`filter`.
Konflikt-, historik- og adgangstilfælde kræver fiktive tillæg eller versioner ved siden af de
offentlige betingelser. De markeres som fiktive i manifestet.

### 5.4 Facit: passager registreres som ankre, ikke som chunk-id'er

- Et chunk-id ændrer sig, når chunkeren eller dokumentversionen ændres. Facit peger derfor på
  **dokument + version + ankertekst**: en kort, ordret tekst fra kilden (normaliseret som i
  `docs/07` §5).
- Et evidenselement **dækker** en passage, når ankret findes i dets `excerpt.text` eller
  `leadIn` inden for den rigtige version.
- **Grad:** 3 = besvarer spørgsmålet direkte, 2 = nødvendig kontekst, 1 = relevant, men ikke
  nødvendig.
- Ankre valideres ved indlæsning. Et anker, der ikke findes præcis én gang i den angivne
  version, er en fejl i sættet, ikke en retrieval-fejl. Kørslen afbrydes. Så kan sættet ikke
  stille og roligt rådne, når et dokument udskiftes.

### 5.5 Evalueringsbrugere

Manifestet definerer fiktive evalueringsbrugere og deres dokumenttildelinger, fx:

- `reader_all`: alle evalueringsdokumenter,
- `reader_terms`: kun betingelser,
- `reader_none`: ingen tildelinger.

Evalueringsscriptet opretter dem i evalueringsmiljøet. Adgangsspørgsmål kører som den bruger,
der ikke har adgang.

### 5.6 Opdeling og vedligeholdelse

- `dev` bruges til at kalibrere tærskel og parametre. `holdout` bruges kun til at bekræfte, så
  vi ikke tilpasser os sættet. Under 100 spørgsmål er alt `dev`, og opdelingen begynder ved
  ca. 100.
- Spørgsmål slettes ikke. Et forkert spørgsmål markeres `"retired": true` med en note, så
  resultater over tid kan sammenlignes.
- Det nye skema valideres i en enhedstest, så et ugyldigt spørgsmål ikke kan committes.

---

## 6. Production worker

Development-løsningen fra fase 7, hvor workeren bruger service-role-nøglen, bliver **ikke**
produktionsløsningen (`docs/07` §14.1, B-16).

### 6.1 Anbefalet arkitektur (D-9, D-10)

```
                           AWS eu-central-1 (Frankfurt)
┌──────────────────────────────────────────────────────────────────┐
│ ECS Fargate-task (privat subnet, udgående via NAT med fast IP)  │
│  ┌──────────────────────┐   ┌───────────────────────────┐        │
│  │ ingestion-worker     │──▶│ clamd (ClamAV, sidecar)   │        │
│  │ Node 22, ikke-root   │   └───────────────────────────┘        │
│  └──┬────────┬──────────┘                                        │
│     │        │ IAM-taskrolle (ingen nøgler) ──▶ Bedrock          │
│     │        └── Secrets Manager: DB-password for worker-rollen  │
└─────┼────────────────────────────────────────────────────────────┘
      │ (1) Postgres/TLS via Supavisor, bruger ingestion_worker_login.<projekt>
      │     må kun: EXECUTE på knowledge.worker_*            ┌──────────────────────┐
      │ (2) HTTPS med engangsbillet ────────────────────────▶│ Edge Function        │
      ▼                                                      │ worker-storage       │
 Supabase (EU): ingestion_jobs · worker_*-funktioner          │ (service-rolle bliver│
               · Storage (originaler, karantæne)  ◀──────────│  inde i Supabase)    │
                                                             └──────────────────────┘
```

| Emne | Anbefaling | Begrundelse |
|------|------------|-------------|
| **Kørselsmiljø** | En container på **AWS ECS Fargate i eu-central-1** med en langtlevende poll-løkke som i dag og ClamAV som sidecar (D-9) | Samme region og aftale som Bedrock. IAM-rollen giver adgang til Bedrock uden statiske nøgler. Ingen tidsgrænse pr. job |
| **Kø** | Den eksisterende Postgres-kø (`knowledge.ingestion_jobs`, `FOR UPDATE SKIP LOCKED`, lease og heartbeat). Ingen ny kø-tjeneste | Virker og er testet. Volumen er lav |
| **Databaseidentitet (D-10)** | Se §6.1.1 | |

#### 6.1.1 Workerens databaseidentitet (D-10)

**Muligheder:**

| | Mulighed | Mindste rettigheder | Blast radius ved kompromittering | Rotation | Vurdering |
|---|---|---|---|---|---|
| A | Service-rolle i workeren (fase 7) | Nej | Hele databasen og al Storage | Kun ved projektrotation | **Udelukket** af kravet |
| B | JWT med egen rolle via PostgREST og Storage | Rollen selv, ja | **Den, der kan signere, kan også udstede `service_role`.** Signerer workeren eller en KMS-nøgle, den har adgang til, er blast radius hele projektet | Nøglerotation påvirker alle | **Fravalgt.** Supabase har desuden åbne fejlrapporter om egne roller med egne nøgler (#38611, #38911) |
| C | Hele workeren bag en Edge Function, der bruger service-rollen | Kun de operationer, funktionen udstiller | Begrænset til funktionens operationer | Funktionens nøgle kan roteres | Mulig, men store payloads (chunks og vektorer) gennem en funktion med tids- og størrelsesgrænser. Mere kode i et miljø med færre tests |
| **D** | **Direkte Postgres-forbindelse med en LOGIN-rolle via Supavisor + en lille Edge Function kun til filer** | **Databasen håndhæver det: kun `EXECUTE` på `worker_*`** | Kun ingestion-operationer på jobs, der kan tages. Ingen tabeladgang, ingen publicering, ingen filer uden billet | Password i Secrets Manager. Blue/green-rotation mellem to login-roller. Øjeblikkelig spærring med medlemskab, `nologin` og afbrudte sessioner | **Godkendt (D-10)** |

**Beslutning: D (godkendt, D-10).**

1. **Roller:**
   - `ingestion_worker` (NOLOGIN, gruppe) ejer ingen objekter og har kun `EXECUTE` på
     funktionerne `knowledge.worker_*` og `knowledge.worker_issue_storage_ticket`.
   - Ingen tabelrettigheder. Ingen medlemskab i `authenticated`, `service_role` eller
     `postgres`.
   - `ingestion_worker_login` (LOGIN, medlem af `ingestion_worker`)
     har password, `connection limit` 5 og `statement_timeout`. Af hensyn til rotationen
     (pkt. 4) findes den som to roller, `ingestion_worker_login_blue` og
     `ingestion_worker_login_green`. Kun den ene er aktiv ad gangen. Den anden er `NOLOGIN` og
     ikke medlem af `ingestion_worker`.
   - `worker_*`-funktionerne (security definer) kontrollerer selv lease og versionsstatus og kan
     aldrig publicere (fase 7). 8B tilføjer, at de kun kan kaldes af medlemmer af
     `ingestion_worker` (`pg_has_role`), så service-rollens kald fra fase 7 kun virker lokalt.
2. **Forbindelse:** gennem Supavisor (`ingestion_worker_login.<projekt-ref>`) med TLS. Supabases
   netværksbegrænsning tillader kun NAT-gatewayens faste IP. Det begrænser blast radius, hvis
   passwordet lækker.
3. **Filer (originaler og karantæne):** workeren kalder `knowledge.worker_issue_storage_ticket(job,
   formål)`. Funktionen kontrollerer, at workeren har leasen, og at formålet passer til
   versionens tilstand. Den udsteder en engangsbillet: tilfældig værdi, gemt som hash, bundet til
   job, version, sti og formål, og gyldig i 60 sekunder.
   - Edge Function `worker-storage` indløser billetten gennem en definer-funktion og bruger
     derefter service-rollen inde i Supabase til præcis én operation: download af originalen
     eller flytning til karantæne.
   - Service-rollen forlader aldrig Supabase.
   - En kompromitteret worker kan kun hente originaler til versioner, der står i kø eller er
     under behandling.
4. **Hemmeligheder og rotation (D-20):** brugernavn og password ligger i AWS Secrets Manager og
   læses af taskrollen. Ingen hemmeligheder i image, repo eller miljøvariabler i
   task-definitionen. Rotationen følger en runbook:
   - **Cyklus:** planlagt rotation mindst hver 90. dag i V1, og straks ved mistanke om læk.
     Automatisk rotation fravælges for nu, fordi den kræver en administrativ databaseidentitet i
     AWS.
   - **Blue/green frem for at skifte password på den aktive rolle.** Supavisor kan midlertidigt
     cache credentials og holde forbindelser åbne efter et passwordskift. Et skift på den aktive
     rolle kan derfor både lade det gamle password virke lidt endnu og afvise det nye. Rotationen
     skifter i stedet mellem de to roller, som Supavisor ser som to forskellige brugere:
     1. *Klargør:* den inaktive rolle (fx green) får et nyt, tilfældigt password, `LOGIN` og
        medlemskab af `ingestion_worker`.
     2. *Gem:* den nye credential (brugernavn og password) lægges i Secrets Manager som en ny
        version.
     3. *Flyt kontrolleret:* ECS-servicen rulles, så nye tasks bruger den nye version.
        Igangværende jobs fortsætter på den gamle rolle, indtil tasken stopper. Et afbrudt job
        genoptages via lease (§6.3).
     4. *Verificér:* de nye tasks forbinder som green (`pg_stat_activity`), et kontroljob
        behandles, og der er ingen forbindelsesfejl i loggene.
     5. *Deaktivér:* den gamle rolle (blue) mister medlemskab af `ingestion_worker`, sættes til
        `NOLOGIN`, dens tilbageværende sessioner afbrydes (`pg_terminate_backend`), og dens
        password erstattes med en tilfældig værdi, som ingen gemmer. Den gamle version i Secrets
        Manager udfases.
     6. *Bekræft:* ingen sessioner for blue i `pg_stat_activity`. Rotationen auditeres.
   - **Nødspærring:** kan udføres straks og i denne rækkefølge: `revoke ingestion_worker from
     <rolle>` (virker ved næste funktionskald, også på en forbindelse, som pooleren allerede har
     åbnet, fordi `worker_*` kontrollerer `pg_has_role` ved hvert kald), `alter role … nologin`,
     og afbrydelse af rollens sessioner. Spærringen afhænger derfor ikke af, at pooleren glemmer
     en cachet credential. Derefter klargøres den anden rolle som i trin 1–4.
5. **Ny dependency (D-19):** en Postgres-klient til workeren. Anbefaling: **`postgres`**
   (postgres.js).
   - Ingen transitive dependencies.
   - TLS.
   - Kan slå prepared statements fra (`prepare: false`), som Supavisors transaktionstilstand
     kræver.
   - Kun i `workers/`, aldrig i `src/` (guardrail-test). Alternativet `pg` har flere moduler.
6. **Lokalt og i test** bruger workeren fortsat service-rollen (fase 7, development-only), men
   kun med `IPA_RUNTIME_ENV=local/test`. Et production-image nægter at starte med en
   service-rolle-nøgle i miljøet.

### 6.2 Job-model og statusmaskine

Dokumentversionens statusser og jobstatusserne fra fase 7 bevares (`docs/07` §2, §5). 8B
tilføjer trinnet **scanning** først i behandlingen og markeringen **karantæne**:

```
Job:     queued → running → succeeded
                     │
                     ├→ (fejl, kan genforsøges) → queued (backoff) … → failed efter max_attempts
                     └→ (fejl, kan ikke genforsøges) → failed

Trin i et process-job:
  hent original → kontroller checksum → virusscanning → validering → tekstudtræk → normalisering
  → strukturering → chunking → embedding → kvalitetsrapport → processed

Version: uploaded → processing → processed → (review, godkendelse som i fase 7)
                       └→ processing_failed (årsag)
                       └→ processing_failed + quarantined_at (malware_detected) — kan ikke behandles igen
```

### 6.3 Genforsøg, idempotens og fejl halvvejs

| Emne | Specifikation |
|------|---------------|
| **Genforsøg** | Job: højst 3 forsøg med 30 s × 2^n (fase 7). Udbyderkald: højst 5 forsøg med jitter inden for et forsøg (§2.6) |
| **Kan genforsøges** | Netværk, 429, 5xx, scanneren utilgængelig, forældede signaturer, timeout |
| **Kan ikke genforsøges** | Malware fundet, ugyldig PDF, krypteret PDF, ingen tekstlag, input for langt til embedding |
| **Idempotens** | `step_state` pr. job. Hvert trin skriver sit resultat i én transaktion. Chunks erstattes samlet for en version under behandling. Embeddings har primærnøglen (chunk, model) og `input_hash`. Et genoptaget job fortsætter fra sidste fuldførte trin |
| **Fejl halvvejs** | Versionen forbliver `processing`, indtil jobbet lykkes eller fejler endeligt. Delvise data er usynlige, fordi retrieval kun ser publicerede versioner. Ved endelig fejl bliver versionen `processing_failed` med årsag. Delvise chunks og embeddings ryddes ved næste genbehandling (fase 7-adfærd) |
| **Dead-letter** | Jobs med status `failed` er dead-letter. De vises under "Behandlingsfejl" i Admin, giver en alarm (§14) og kan behandles igen med "Behandl igen" (fase 7). Intet slettes automatisk |
| **Dobbeltbehandling** | Lease med heartbeat. Funktionerne afviser skrivning fra en worker, der ikke har leasen. Et unikt indeks tillader ét aktivt job pr. (version, type) |

### 6.4 Concurrency, timeouts og store dokumenter

| Emne | Anbefaling |
|------|------------|
| Concurrency | 1 job pr. task til at begynde med. Flere tasks kan køre samtidig, fordi køen er SKIP LOCKED |
| Lease | 300 s med heartbeat hvert 60. sekund (fase 7) |
| Timeouts pr. trin | Download 60 s, scanning 120 s, udtræk 10 min, embedding-batch 60 s. Hele jobbet højst 30 min, derefter genforsøg |
| Store dokumenter | Højst 50 MB og 2.000 sider (fase 7). Filen streames til midlertidig disk, ikke ind i hukommelsen. Containeren har en hukommelsesgrænse (fx 2 GB). Udtrukket tekst højst 20 mio. tegn, ellers afvises versionen |

### 6.5 Observability og sikkerhed for workeren

- Strukturerede JSON-logs uden dokumentindhold med job-id, version-id, trin, varighed og
  fejlkode. Metrics står i §14.
- Containeren:
  - kører som ikke-root med skrivebeskyttet filsystem undtagen `/tmp`,
  - har ingen indgående porte,
  - har kun udgående adgang til Supabase, Bedrock og ClamAV's signaturkilde.
- Imaget bygges i CI fra repoet med låste versioner og scannes for sårbarheder.

---

## 7. Upload-sikkerhed og virusscanning

8B understøtter fortsat **kun PDF med tekstlag**. Ingen OCR og ingen andre formater
(`docs/07` B-14).

### 7.1 Kontroller (i rækkefølge)

| # | Kontrol | Hvor | Ved fejl |
|---|---------|------|----------|
| 1 | Filendelse og angivet MIME `application/pdf` | Klient (kun brugeroplevelse) og server ved udstedelse af upload-URL | Afvist før upload |
| 2 | Størrelse ≤ 50 MB | Storage-bucket (hård grænse) og worker | Afvist |
| 3 | Checksum: filen er den, der blev registreret | Worker | Fejl, kan ikke genforsøges |
| 4 | **Virusscanning** (§7.2) | Worker, **før** filen åbnes af en parser | Karantæne |
| 5 | Magic bytes `%PDF-` og gyldig struktur (parseren kan åbne filen inden for timeout) | Worker | "Filen er ikke en gyldig PDF" |
| 6 | Kryptering og adgangskode | Worker | Afvist (fase 7) |
| 7 | Aktivt indhold: `/JavaScript`, `/Launch`, `/OpenAction` med handlinger, indlejrede filer | Worker | Beslutning **D-12**: anbefaling er afvisning med årsagen "Filen indeholder aktivt indhold" |
| 8 | Sidetal ≤ 2.000 og tekstlag på siderne | Worker | Afvist eller advarsel i kvalitetsrapporten (fase 7) |
| 9 | Grænser for udtræk: tid pr. side, samlet tekst ≤ 20 mio. tegn | Worker | Afvist |

PDF-indhold eksekveres aldrig. Tekstudtrækket kører uden scripts, og indlejrede filer ignoreres
(fase 7). Parseren kører i en børneproces med hukommelses- og tidsgrænse, så en ondsindet fil
ikke kan tage workeren ned. **(udledt)**

### 7.2 Virusscanning

**Anbefaling: ClamAV som sidecar i worker-tasken.**

- Begrundelse: filen forlader ikke vores infrastruktur, det er open source, og der er ingen ny
  databehandler.
- Fravalgt: en cloud-scanningstjeneste, der uploader filen til tredjepart, fordi det er en ny
  databehandler. Malware-scanning bundet til S3 passer ikke, fordi filerne ligger i Supabase
  Storage.

Regler:

- **Fail-closed.** Er scanneren utilgængelig, eller er signaturerne ældre end 24 timer, behandles
  filen ikke. Jobbet genforsøges senere, og Admin får en advarsel. En fil passerer aldrig uden
  scanning.
- **Fund → karantæne.**
  - Originalen flyttes til bucket'en `knowledge-quarantine`. Den har ingen læsepolitikker,
    så ingen kan downloade filen gennem appen.
  - Versionen bliver `processing_failed` med `error_code = malware_detected` og `quarantined_at`.
  - Versionen kan hverken behandles igen eller godkendes.
- **Restrisiko:** ClamAV finder kendt malware og ikke alt. Derfor står kontrollerne i §7.1 og
  isolationen i §6.5 ved siden af. Scanningen er ét lag, ikke garantien.

### 7.3 Hvad brugeren ser

| Situation | Tekst (dansk, i versionens status og kvalitetsrapport) |
|-----------|--------------------------------------------------------|
| Under scanning | "Filen kontrolleres for virus" (trin i behandlingen) |
| Malware fundet | "Filen blev afvist af virusscanningen og er sat i karantæne. Den kan ikke behandles eller hentes. Kontakt en systemadministrator." |
| Scanner utilgængelig | "Virusscanningen er midlertidigt utilgængelig. Behandlingen fortsætter automatisk." |
| Aktivt indhold | "Filen indeholder aktivt indhold (fx scripts) og kan ikke bruges." |

### 7.4 Hvad der logges

- Audit (`knowledge.version.quarantined`): aktør `ingestion_worker`, version, checksum,
  scannerens navn og signaturversion, og fundets navn. Intet dokumentindhold.
- Teknisk log: scanningens varighed og resultat. Signaturernes alder overvåges (§14).

---

## 8. Redaction og kundedata (D-13)

### 8.1 Udgangspunkt

**Princip (skærpet i 8B-I2.5, B-022):** Kundeidentificerbare data må ikke forlade platformens
godkendte trust boundary til en ekstern AI-udbyder uden en senere, eksplicit godkendt politik.

- Princippet gælder **ethvert** eksternt AI-kald: modelgenerering, forespørgsels-embedding,
  dokument-embedding og reranking (både forespørgsel og passager). Det er ikke kun et krav til
  `invokeModel`.
- EU-hosting ændrer ikke princippet, og det gør redaction heller ikke.
- Det er en sikkerhedsstramning af D-13/K-9, ikke en åbning for kundedata.

**8B åbner ikke for kundedata til ekstern AI.** Roadmappen kræver, at kundedata ikke kan
godkendes til modelbrug, før enten:

- (A) redaction kan finde navne i fri tekst målt mod et testsæt, eller
- (B) gatewayen teknisk forhindrer, at fri tekst fra kundesager sendes til modellen.

Indtil en senere eksplicit beslutning og en valideret redaction findes, håndhæver platformen
fire egenskaber:

1. Fri tekst fra kundesager sendes ikke til en ekstern model.
2. Bruger- eller administratorkonfiguration alene kan ikke omgå spærren.
3. Et fejlende eller manglende redaction-trin fører aldrig til et modelkald.
4. Tests beviser egenskaberne.

**Begreber:**
- **Ekstern model:** enhver model, hvis grad ikke er præcis `development`. Det svarer til
  parringsreglen (B-012, fail-closed). Stub-modellen kører kun lokalt og i test og er ikke
  ekstern.
- **Ekstern AI-udbyder (8B-I2.5):** enhver ekstern model og enhver embedding- eller
  reranking-udbyder, der behandler tekst uden for platformens proces, fx Bedrock.
  Test-embedderen, "none" og stub-modellen sender intet ud og ligger uden for grænsen.
- **Fri tekst fra en kundesag:** alt brugerinput og al kontekst i et kald med kundesags-reference
  (`caseId`), og ethvert felt fra en kundesag.

### 8.2 Hvor guardrailen håndhæves — fem uafhængige lag

Spærren hviler ikke på én kontrol i brugerfladen eller én boolean, der kan ændres. Hvert lag
alene stopper kaldet:

| Lag | Hvor | Hvad | Kan ændres af |
|-----|------|------|---------------|
| **L1 — Proveniens** | Gatewayens konstruktører af `SentPart` (8A) | Hver del bærer uforanderlig proveniens: `caseBound` (sat, når kaldet har en kundesags-reference) og `redacted` (sat kun af redactoren, når den har kørt uden fejl). Delene er frosne | Kun kode |
| **L2 — Central egress-policy (8B-I2.5)** | `src/lib/egress/policy.ts`, kaldt af `invokeModel` for en ekstern model, af embedding- og reranking-adapterne før hvert kald og kontrolleret igen i transporten (`assertTransmittable`) | Hvert eksternt kald autoriseres samlet, før noget sendes. Én del, der ikke må ud, afviser hele kaldet, og intet sendes. Afvises: `caseBound`, `customer_identifiable`, `audit_access`, `unknown`, manglende proveniens og brugertekst uden `redacted`. Hver operation har en fast tabel over tilladte kategorier pr. rolle. Der er ingen parameter, konfiguration, databaserække, miljøvariabel eller descriptor, der slår kontrollen fra | Kun kode (med review, arkitekturtest og mutationstest) |
| **L3 — Klassificering** | Gatewayens pipeline | Er kaldet sagsbundet, klassificeres brugerens tekst og kontekst som `customer_identifiable`, ikke `user_question`. Matricen afviser kategorien (L4) | Kun kode |
| **L4 — Matricen** | Databasen: constraint på `ai.data_category_policy` | `customer_identifiable` kan kun være `deny`, som `audit_access`. Hverken funktionen, administratoren eller service-rollen kan ændre det. Kun en migration kan | Kun migration (review og eksplicit beslutning) |
| **L5 — Profilerne** | Repoet | Ingen profil har `customer_identifiable` i sine kategorier. Enhedstest | Kun kode |

**Fejl i redaction:** kaster redactoren en fejl, afbrydes kaldet før retrieval og model, og
udfaldet er `unavailable`. Det er allerede 8A-adfærd. Mangler redaction-markeringen på en
fritekstdel, afviser L2 kaldet til en ekstern model. Et manglende eller fejlende trin kan
derfor ikke føre til et modelkald.

**Udfald for brugeren:** `blocked_policy` med "Oplysninger fra en kundesag sendes ikke til
AI-modellen". Det er en klar tilstand og ikke en systemfejl.

**Konsekvens:** med en ekstern model (8C) kan Copilot ikke bruges med kundesags-kontekst, før
spærren ophæves ved en senere beslutning. Uden sags-kontekst fungerer Copilot. Med
stub-modellen lokalt og i test virker sagsbundne kald som i 8A, så mekanikken fortsat kan
testes.

**Proveniens følger teksten (8B-I2.5):**
- Gatewayen klassificerer brugerens tekst én gang.
- Klassifikationen følger forespørgslen uændret gennem retrieval til forespørgsels-embedding og
  reranking og følger hver del til modellen.
- Mangler proveniensen, sendes intet eksternt.
- Detaljerne står i §21.3.

### 8.3 Ophævelse kræver en dokumenteret beslutning

Spærren kan kun ophæves ved en migration (L4) og en kodeændring (L2 og L3), begge med
henvisning til en beslutning i `docs/decisions.md`, der dokumenterer forudsætning A (målt
navnegenkendelse) eller B (fri tekst fra sager sendes aldrig). 8B forbereder A uden at bygge
den: formatet for et testsæt til navnegenkendelse (fiktive tekster med markerede navne og
adresser, JSONL som §5) og de metrics, en løsning skal måles på (recall på person- og
virksomhedsnavne). Ingen NER-model og ingen ny redaction i 8B.

### 8.4 Tests

| Test | Forventet |
|------|-----------|
| Ekstern model (test-double med grad `production`) og sagsbundet kald | `blocked_policy`. Modellen kaldes ikke |
| Ekstern model og fritekstdel uden `redacted` (konstrueret direkte) | `invokeModel` kaster. Modellen kaldes ikke |
| Redactoren kaster | `unavailable`. Hverken retrieval eller model kaldes |
| Ukendt grad (fx `"Production"`, `""`) behandles som ekstern | Som første række |
| `set_data_category_rule(…, 'customer_identifiable', 'allow')` som administrator | Afvist af constraint |
| Direkte `insert`/`update` med `allow`/`allow_redacted`, også som service-rolle | Afvist af constraint |
| En profil med `customer_identifiable` | Enhedstesten fejler |
| Stub-model og sagsbundet kald | Virker som i 8A (regressionstest) |
| Sagsbunden forespørgsel og ekstern embedding eller reranking (8B-I2.5) | Ingen embedding- og ingen rerank-request. Nul eksterne kald |
| Rerank med én ulovlig passage (8B-I2.5) | Hele kaldet afvises, og intet sendes |
| Transporten kaldt direkte uden gyldig autorisation (8B-I2.5) | Afvist. Intet sendes |
| **Mutationer:** L2(a) fjernet, L2(b) fjernet, L3 fjernet, constraint fjernet, fail-open ved ukendt grad | Hver fanges af mindst én test |

---

## 9. ProductionEvidenceSet — endelig logik

**Godkendt (B-020):** P1–P9 er source of truth for, hvornår et EvidenceSet får
`grade = production`. Graden beregnes ud fra den aktive, godkendte retrieval-konfiguration, dens
fingeraftryk og dens evalueringsstatus. Runtime skal matche den evaluerede konfiguration. En
betingelse, der ikke kan afgøres, giver `development`. En hård gate, der fejler i regression,
suspenderer den relevante konfiguration (§10.2).

**`grade = production` er aldrig et manuelt flag.** Graden afledes ved hvert retrieval-kald i
`issueEvidenceSet`. Den kan ikke sættes i requesten, i brugerfladen, i databasen eller af en
administrator. Der findes ingen kolonne, indstilling eller UI-kontakt for den. En
administrator kan kun godkende en konfiguration, der har bestået en registreret evaluering.
Selv da afgøres graden for hvert enkelt sæt af betingelserne nedenfor.

```
grade = production  ⇔  P1 ∧ P2 ∧ P3 ∧ P4 ∧ P5 ∧ P6 ∧ P7 ∧ P8 ∧ P9
ellers               development   (fail-closed: en betingelse, der ikke kan afgøres, er falsk)
```

| # | Betingelse | Hvordan det afgøres |
|---|------------|---------------------|
| **P1** | Forespørgslen er embedded med en production-embedder, hvis model er den aktive model | Registret (implementeringens grad) og `embedding_models.status = active` |
| **P2** | Rerankeren er production og ikke `none` | Registret og `requireProductionEvidence` (fase 7) |
| **P3** | Der findes præcis én retrieval-konfiguration med status `active`. Dens evaluering er bestået og registreret af `evaluation_publisher`, og den er ikke suspenderet af en hård gate i en senere regressionskørsel | Opslag i `knowledge.retrieval_configurations` ved retrieval. Status `suspended` sættes automatisk af `record_evaluation_run` ved en fejlet hård gate (D-8) |
| **P4** | Runtime-fingeraftrykket er identisk med den aktive konfigurations fingeraftryk: model, reranker, algoritmeversion og parametre | Beregnes fra de faktisk konstruerede implementeringer og den faktiske konfiguration. Kan ikke angives |
| **P5** | Alle elementer stammer fra publicerede, ikke-tilbagetrukne versioner, gyldige for tilstanden | Retrieval-funktionen (fase 7). Kontrolleres igen i evidensen |
| **P6** | Søgningen er udført som den kaldende bruger med adgangsfiltret | `security invoker`, RLS og adgangsfilter før søgning (fase 7). Ingen service-rolle i retrieval (guardrail-test) |
| **P7** | Hvert elements `chunker_version` er blandt konfigurationens evaluerede chunker-versioner | Ny kontrol. Ét element uden for gør hele sættet `development` |
| **P8** | Sættet er ikke fremtvunget af et udviklingsværktøj, og det er udstedt af retrieval-laget og frosset | `devOverride`, WeakSet og frysning (fase 7) |
| **P9** | Sættet bærer konfigurationens id, fingeraftryk og algoritmeversion (`retrieval.configuration`, schemaVersion 2) | Sættes af retrieval-laget |

`requireProductionEvidence` kontrollerer desuden P2, P8 og P9 igen og afviser et sæt uden
`retrieval.configuration`.

**Granularitet:** pr. retrieval-konfiguration, ikke globalt, ikke pr. model og ikke pr. indeks.

- Kvaliteten er en egenskab ved kombinationen af model, reranker, algoritme, parametre og
  chunker.
- Et globalt flag ville overleve et modelskifte.
- Kvalitet pr. model ville ignorere, at en anden reranker eller tærskel ændrer resultatet.
- Nye dokumenter kræver ingen ny godkendelse, men fanges af regressionen (§4.5). Nye
  dokumenttyper kræver en ny kørsel (§4.4, pilot-evaluering pkt. 5).

---

## 10. Register over retrieval-konfigurationer

### 10.1 Model (udledt)

`knowledge.retrieval_configurations`:

| Felt | Indhold |
|------|---------|
| `id` | |
| `fingerprint` | SHA-256 over de øvrige definerende felter i kanonisk form |
| `embedding_model_id` | Til `knowledge.embedding_models`. Udbyder og model er data, ikke kode |
| `reranker_id`, `reranker_version` | Fx `bedrock:cohere.rerank-v3-5` og `0` |
| `algorithm_version` | Retrieval-algoritmens version (fx `hybrid-rrf-1`). Hæves, når kode i retrieval-kæden ændres |
| `params` | `candidateK`, `rerankN`, `topK`, `maxPerVersion`, `minScore`, `rrfK` |
| `chunker_versions` | De chunker-versioner, evalueringen dækkede |
| `status` | `candidate`, `approved`, `active`, `suspended` eller `retired`. Højst én `active` |
| `tier` | `pilot` (under 100 spørgsmål) eller `standard` |
| `approved_by`, `approved_at` | Kræver `system.settings.manage`. Auditeres |

`knowledge.evaluation_runs` (kun skrevet af `evaluation_publisher` via
`record_evaluation_run`): konfiguration, sæt-id og -version, korpus-checksum, rapport-checksum,
metrics, gate-resultater, antal pr. type, `passed`, start og slut.

### 10.2 Regler

- **Ingen kan skrive direkte i tabellerne.** Ændringer sker kun gennem funktioner.
- **Godkendelse** (`approve_retrieval_configuration`) kræver `system.settings.manage` og en
  registreret kørsel for netop den konfiguration, der har bestået alle hårde gates og alle
  godkendte kvalitetsgates, har opfyldt minimum pr. type og har årsagsnoter for alle fejl.
  Funktionen afviser `none` og test-udbydere.
- **Aktivering** sker i én transaktion: den nye bliver `active`, og den forrige `retired`. Ved et
  modelskifte sker det sammen med skiftet af embedding-model (§2.5).
- **Suspendering:** en registreret regressionskørsel med en fejlet hård gate sætter den aktive
  konfiguration til `suspended` i samme transaktion. Al evidens bliver straks `development`
  (P3). Genaktivering kræver en ny bestået kørsel og en ny godkendelse.
- **Konfigurationer ændres aldrig.** En ændring er en ny konfiguration.
- Matcher runtime-fingeraftrykket ikke den aktive konfiguration, viser retrieval-tilstanden
  (B-007) i Admin "Konfigurationen er ikke godkendt", og evidensen er `development`.

### 10.3 Flow

```
ny model/reranker/parametre
 → evalueringskørsel i evalueringsmiljøet (flere kandidater muligt)
 → rapport (JSON + checksum)
 → evaluation_publisher registrerer kørslen og konfigurationen i produktion (candidate)
 → godkendelse af et menneske med system.settings.manage
 → aktivering i én transaktion
```

---

## 11. Versionering og reproducerbarhed

Et retrieval-resultat skal kunne forklares bagefter. Det, der logisk skal kunne spores, og
hvor det findes:

| Hvad | Hvor | Status |
|------|------|--------|
| Dokumentversion | `evidence.items[].documentVersionId`. Versioner ændres aldrig efter publicering | Fase 7 |
| Chunk og chunk-version | `chunkIds` og `char_start`/`char_end`. Chunks ændres aldrig. `chunker_version` pr. version | Fase 7 |
| Embedding-model og version | `retrieval.embeddingModel` og `embedding_models` | Fase 7 |
| Reranker og version | `retrieval.reranker` | Fase 7 |
| Retrieval-algoritme og parametre | **Nyt:** `retrieval.configuration = { id, fingerprint, algorithmVersion }` i EvidenceSet | 8B (§18 K-4) |
| Metadatafiltre og tilstand | `query` (mode, asOf, filters) | Fase 7 |
| Scores | `relevance` (rerank, fused, vector, lexical, rank, begrundelser) | Fase 7 |

**Afgrænsning:** 8B gør hvert EvidenceSet selvforklarende og registret uforanderligt. At gemme
EvidenceSet'et eller dets fingeraftryk pr. AI-svar er AI-logning og hører til 8C. 8A's log gemmer
allerede kilder og scores pr. kald i `ai.gateway_call_sources`. Konfigurationens id føjes til
gatewayens log i 8C.

---

## 12. Performance

Foreløbige mål. De måles i evalueringskørslen og i drift:

| Mål | Værdi |
|-----|-------|
| Retrieval, hele kæden (embedding af forespørgsel, søgning, reranking, evidens) | p50 ≤ 800 ms, p95 ≤ 1,5 s |
| Heraf embedding af forespørgsel | p95 ≤ 300 ms |
| Heraf databasesøgning | p95 ≤ 300 ms |
| Heraf reranking af 30 kandidater | p95 ≤ 500 ms |
| Ingestion: et dokument på 50 sider fra upload til `processed` | ≤ 5 min |
| Ingestion: første korpus på ca. 2.000 sider | ≤ 4 timer med én worker |
| Dokumentstørrelse | ≤ 50 MB og ≤ 2.000 sider (fase 7) |

| Skala | Sider | Chunks (ca. 3 pr. side) | Bemærkning |
|-------|-------|-------------------------|------------|
| Pilot | 2.000 | ca. 6.000 | HNSW er trivielt |
| Mellem | 20.000 | ca. 60.000 | Uden ændringer |
| Stor | 200.000 | ca. 600.000 | HNSW virker. Overvåg hukommelse og iterative scans. Partitionering er ikke nødvendig |

**Ingen tidlig optimering.** Én worker, ingen cache og ingen særskilt vektordatabase
(`docs/03` §16). De åbenlyse flaskehalse er udbyderkvoter (anmodninger og tokens pr. minut) og
kontekst pr. kald. Begge håndteres med batch og backoff, og kvoterne afklares før produktion.

---

## 13. Omkostninger

**Priserne er fra 2026-10 og ikke en arkitektonisk sandhed.** Beslutningsmodellen er, hvad der
driver omkostningen:

| Driver | Afhænger af | Karakter |
|--------|-------------|----------|
| Embedding af korpus | Tokens i nye versioner og ved modelskifte | Engangsbeløb, meget lille |
| Embedding af forespørgsler | Antal forespørgsler × ca. 30 tokens | Ubetydelig |
| **Reranking** | **Antal forespørgsler** (ca. $2 pr. 1.000 ved ≤ 100 kandidater) | **Dominerende og lineær** |
| Worker | Altid kørende container med ClamAV (Fargate 0,5–1 vCPU, 2 GB) | Fast, ca. $20–40 pr. måned pr. task |
| Evaluering | Spørgsmål × kørsler | Lille |

Antagelse: 20 forespørgsler pr. aktiv bruger pr. arbejdsdag og 21 arbejdsdage.

| Scenarie | Brugere | Forespørgsler/md. | Reranking | Embeddings | Worker | **I alt ca.** |
|----------|---------|-------------------|-----------|------------|--------|---------------|
| Lille pilot | 10 | 4.200 | ca. $8 | < $1 | ca. $25 | **ca. $35/md.** |
| Mellemstor | 100 | 42.000 | ca. $85 | ca. $1 (+ engang ca. $1 for 20.000 sider) | ca. $30 | **ca. $120/md.** |
| Større | 1.000 | 420.000 | ca. $840 | ca. $5 (+ engang ca. $10) | ca. $60 (2 tasks) | **ca. $900/md.** |

Supabase, Vercel og en generativ model (8C) er ikke med. Reranking kan halveres ved at reranke
færre kandidater (`rerankN`), men det er en kvalitetsbeslutning, der skal evalueres.

---

## 14. Observability

**Teknisk observability (8B):** driftens sundhed. Ingen indhold og ingen brugeranalyse.

| Signal | Kilde | Alarm (forslag) |
|--------|-------|-----------------|
| Kølængde og ældste ventende job | `knowledge.ingestion_jobs` | Ældste > 30 min |
| Fejlede jobs (dead-letter) efter fejlkode | `ingestion_jobs.error_code` | Ethvert nyt `failed` |
| Embedding-fejl, 429-rate og latency | Worker-log og app-log | Fejlrate > 5 % over 15 min |
| Reranking-fejl og latency (p50/p95) | App-log (retrieval) | p95 > 1 s eller fejl > 1 % |
| Retrieval utilgængelig | Retrieval-tilstanden (B-007) | Enhver |
| Retrieval-latency pr. trin | Tidsmålingerne i evidensen og gatewayen (8A) | p95 > 1,5 s |
| Dokumentstatus | Antal versioner pr. status | Versioner i `processing` > 1 time |
| Virusscanning | Signaturernes alder, fund | Alder > 24 t, ethvert fund |
| Kvalitetsregression | Planlagt evalueringskørsel | Ethvert gate fejler |
| Uoverensstemmelse i konfigurationen | Runtime-fingeraftryk ≠ aktiv konfiguration | Enhver |

- **Alarmer (D-15):** signalerne vurderes af en lille, planlagt kontrol (hvert 5. minut i
  workeren og efter hver evalueringskørsel). Alarmer sendes gennem et abstrakt interface:

  ```ts
  interface AlertSink {
    send(alert: { code: string; severity: "warning" | "critical"; summary: string;
                  details: Record<string, string | number>; occurredAt: string }): Promise<void>;
  }
  ```

  Alarmer indeholder aldrig dokumentindhold, forespørgsler eller persondata. Implementeringen
  vælges med konfiguration (fx `IPA_ALERT_SINK`), og den første kanal vælges ved
  implementeringen (Å-5). `log` findes altid som standard, så en alarm aldrig forsvinder.
  Domænemodellen kender kun interfacet. **Hvor:** et lille "Systemstatus"-afsnit i Admin læser
  kø, fejl, status og retrieval-tilstand fra databasen. Logs ligger hos hostingudbyderen
  (CloudWatch for workeren, Vercel for appen). Ingen ny observability-leverandør.
- **Hører senere til:** bruger- og AI-analytics (brug, videnshuller, kvalitet af svar) hører til
  masterfase 15 og til 8C (B-014).

---

## 15. Security — trusselsmodel light

| Trussel | Konsekvens | Mitigation |
|---------|------------|------------|
| **Ondsindet PDF** | Kodeudførelse i workeren, nedbrud eller ressourceudtømning | Virusscanning før parsing (§7.2); afvisning af aktivt indhold (§7.1); parser i børneproces med tids- og hukommelsesgrænse; ikke-root, skrivebeskyttet container uden indgående porte; ingen eksekvering af PDF-indhold |
| **Uautoriseret retrieval** | Brugeren ser dokumenter uden tildeling | Søgning som brugeren (`security invoker`, RLS, adgangsfilter før søgning). Hård gate H1. Integrationstests fra fase 7 |
| **Lækage af metadata** | Titler, ids eller konflikter afslører dokumenter | Neutral konfliktindikator (B-20); "findes ikke" frem for "ingen adgang"; gate H1 omfatter metadata; evalueringsrapporter indeholder ingen produktionsdata |
| **Privilegieeskalering** | Workeren publicerer eller læser mere end nødvendigt | Rollen `ingestion_worker` må kun køre `worker_*`-funktioner og kun som medlem af rollen (`pg_has_role`). Funktionerne kan ikke publicere (fase 7). Ingen service-rolle i workeren. Service-rollen bruges kun inde i Edge Function `worker-storage` og kun til én operation pr. billet |
| **Kompromitteret worker-credential** | En angriber kan skrive behandlingsresultater | Rollen har kun `EXECUTE` på `worker_*` og ingen tabeladgang. Den kan ikke publicere: alt kræver en menneskelig godkendelse (`docs/03` §1 pkt. 4). Filer kun via billet for jobs, workeren har lease på. Netværksbegrænsning til fast IP. Øjeblikkelig spærring (medlemskab, `nologin`, afbrudte sessioner). Blue/green-rotation mindst hver 90. dag. IAM-rolle til Bedrock (ingen nøgle at stjæle) |
| **Forgiftet videnskilde** | Forkert eller manipuleret indhold bliver "autoritativt" | Kun mennesker med `knowledge.version.publish` aktiverer viden (fase 7); kvalitetsrapport og review; konfliktdetektion; audit af upload og godkendelse; checksum på originalen |
| **Replay og dobbeltbehandling** | Dubletter eller to workers på samme version | Lease, unikt aktivt job pr. (version, type), idempotente trin, (chunk, model) som nøgle, checksum |
| **Utilsigtet brug af udviklingsevidens** | Svag evidens når en bruger, der handler på den | Fail-closed register, `ProductionEvidenceSet` og parringsreglen (B-012); P3/P6 (godkendt konfiguration); gates H6; mutationstests |
| **Forfalsket evalueringsrapport** | En konfiguration bliver production uden at have bestået | Kun `evaluation_publisher` kan registrere kørsler. Funktionen genberegner gates fra metrics. En administrator kan kun godkende en bestået, registreret kørsel (D-18) |
| **Kompromitteret publisher-credential** | Forfalskede kørsler | Credentialen findes kun i CI's secret-håndtering. Rollen kan kun kalde én funktion. En godkendelse kræver stadig et menneske. Rotation og spærring som workeren |
| **Kundedata sendes til en ekstern model** | Brud på D-13 og kundens fortrolighed | De fem lag i §8.2. Ingen konfiguration kan omgå dem |
| **Udbyderen ændrer modellen bag samme id** | Stille kvalitetsfald | Kontrolsæt af vektorer (§2.5) og planlagt regression (§4.5) |
| **Data forlader EU** | Brud på kravet | Udbydere og regioner låses i konfigurationen. Endpoint og region kontrolleres ved opstart. Kun EU-endpoints er tilladt |

---

## 16. Tests

| Lag | Hvad |
|-----|------|
| **Enhed** | Bedrock-embedder og -reranker med optagne svar (ingen netværk): batch, genforsøg, 429, for langt input, inputtype. Fingeraftryk (kanonisk og stabilt). P1–P9 i `issueEvidenceSet`. Metrics-beregning med kendte tal. Valideringen af sættets skema og ankre. Klassifikation af workerfejl som (ikke) genforsøgbare |
| **DB/RLS (pgTAP)** | `retrieval_configurations`: kan ikke godkendes med fejlede gates, manglende minimum pr. type eller `none`; højst én aktiv; uforanderlig; godkendelse kræver `system.settings.manage` og auditeres; en fejlet hård gate suspenderer. `evaluation_runs` kan kun skrives af `evaluation_publisher`, og administratoren kan hverken indsætte eller rette. Rollen `ingestion_worker` kan kun køre `worker_*`, ingen tabeller, og billetter kun med lease, engangsbrug og 60 sekunder. Karantæne: kan ikke læses, ikke genbehandles, ikke godkendes. Kundedataspærren (§8.4) |
| **Integration** | Hele kæden mod den lokale database med optagne udbydersvar. Workeren som `ingestion_worker` uden service-rolle. Production-grad opnås kun med en aktiv godkendt konfiguration og falder til `development` ved et andet fingeraftryk |
| **Worker** | Afbrudt job genoptages. Dobbelt claim afvises. Genforsøg ved 429. Endelig fejl giver `processing_failed`. Timeout pr. trin. Stor PDF inden for hukommelsesgrænsen |
| **Security** | EICAR-testfilen sættes i karantæne. PDF'er med JavaScript, Launch-handling, indlejrede filer, ødelagt struktur, dekomprimeringsbombe, krypteret, uden tekstlag. Scanner utilgængelig giver ingen behandling |
| **Evaluering** | Evalueringsmotoren testes med et lille fiktivt sæt, hvor facit er kendt. Hver metric og hvert gate har en test, der får det til at fejle |
| **Kontrakttest mod udbyderen** | Planlagt kørsel mod den rigtige Bedrock i evalueringsmiljøet. Ikke i CI |
| **Mutation og adversariel** | Hver af P1–P9 svækket; H1–H7 svækket; suspendering fjernet; publisher-kontrollen fjernet; billetkontrollen (lease, engangsbrug, udløb) svækket; karantænepolitik fjernet; scanning fjernet; fail-open ved forældede signaturer; hvert af lagene L2–L4 i §8.2 fjernet; fallback til `none`. Hver skal fanges. Samme standard som fase 7 og 8A |
| **Browser** | Upload i browseren med Playwright mod riggen (`docs/07` §20.5) |

---

## 17. Exit-kriterier (Definition of Done)

8B kan låses, når **alle** punkter kan afkrydses objektivt:

1. Lint, typecheck, build, enhedstests, pgTAP, integrations-, worker- og security-tests består.
2. Mutationstestene i §16 fanges alle.
3. Der findes en evalueringsrapport for den anbefalede konfiguration på evalueringssættet (30–50
   spørgsmål, alle typer i §5.3) med alle hårde gates bestået og alle godkendte kvalitetsgates
   bestået.
4. Kørslen er registreret af `evaluation_publisher`, og konfigurationen er godkendt og aktiv i et
   miljø med de rigtige udbydere.
   `retrieveEvidence` udsteder dér et `ProductionEvidenceSet`, som `requireProductionEvidence`
   accepterer.
5. Med et andet fingeraftryk, `none`, test-embedderen eller en uevalueret chunker-version er
   evidensen påviseligt `development`.
6. Workeren kører i det valgte produktionsmiljø som `ingestion_worker_login` uden service-rolle,
   henter filer via billet og behandler en rigtig PDF fra upload til `processed` inden for målet
   i §12. En test bekræfter, at rollen ikke kan læse tabeller, publicere eller hente en fil uden
   gyldig billet.
7. Virusscanning med EICAR giver karantæne. Scanner nede eller forældede signaturer giver ingen
   behandling.
8. Kundedataspærren holder i alle fem lag (§8.2), og testene i §8.4 og deres mutationer består.
9. Signalerne i §14 kan ses, og mindst alarmerne for dead-letter, retrieval utilgængelig og
   kvalitetsregression er afprøvet.
10. Performance-målene i §12 er målt og dokumenteret, eller afvigelser er godkendt.
11. Databehandleraftaler for de valgte udbydere er bekræftet (af dig. Det er ikke en teknisk
    opgave).
12. En administrator kan påviseligt ikke gøre evidens `production` ad andre veje end en bestået,
    registreret kørsel og en godkendelse (P1–P9, D-18).
13. Dette dokument har en implementeringsstatus (§21, oprettes ved implementering), og roadmap,
    CLAUDE.md og README er opdateret.

---

## 18. Berøring af låste dokumenter

Ingen af punkterne ændrer arkitektur eller trufne beslutninger. Alle er udbygninger eller
stramninger, der kræver din godkendelse, fordi de rører tekst i låste dokumenter:

**Status (B-020):** K-1, K-2, K-4, K-6 og K-9 er godkendt som tekstændringer (D-17). K-5, K-7 og K-8
følger af de godkendte D-10, D-2/D-9 og D-11. K-3 gælder kun, hvis Embed v3 vælges efter
baseline (§20 trin 5), og kræver i så fald en ny beslutning. Teksten i `docs/07` og `docs/08`
rettes samtidig med den implementering, punktet hører til, ikke før.

| # | Låst dokument | Hvad | Type |
|---|---------------|------|------|
| K-1 | `docs/07` §9.1 pkt. 3 | Graden er i dag "production kun hvis både embedder og reranker er production". 8B tilføjer flere nødvendige betingelser (P3, P6). "Kun hvis" gælder fortsat. Teksten bør nævne, at betingelserne er udvidet (B-008) | Stramning, ikke modstrid |
| K-2 | `docs/07` §7 | `Embedder`-interfacet beskrives som `embed(texts, {model})`. 8B tilføjer `inputType` (dokument eller forespørgsel) | Udbygning |
| K-3 | `docs/07` §6 | Chunkstørrelsen er konfiguration, højst ca. 800 tokens. Vælges v3 (D-1), skal maksimum sænkes til ca. 400 tokens inklusive overskrift og `lead_in`. Med Embed v4 ændres intet | Kun ved valg af v3 |
| K-4 | `docs/07` §10 | Evidensmodellen får `retrieval.configuration` (additivt). Forslag: `schemaVersion` hæves til 2 | Udbygning (D-14) |
| K-5 | `docs/07` §14.1, B-16 | Workerens produktionsadgang fastlægges (D-10). `worker_*`-funktionerne begrænses til medlemmer af `ingestion_worker`. Det var planlagt | Planlagt |
| K-6 | `docs/08` §5.2 | Kundedata spærres med constraint i stedet for standardværdi. Strammer 8A | Stramning (D-13) |
| K-7 | `docs/03` §2 og §14 | AWS bliver en ny leverandør (Bedrock og Fargate) ud over Vercel og Supabase. Embedding, reranker og worker-leverandør er bevidst ikke låst (`docs/03` §17 pkt. 1–3), så det er inden for arkitekturen | Ny leverandør (D-2, D-9) |
| K-8 | `docs/07` §7 ("forespørgselsembedding laves server-side i appen") | Appen på Vercel skal kalde Bedrock. Anbefaling: Vercels OIDC-federering til en AWS IAM-rolle (ingen statiske nøgler), og appens funktioner i Vercels EU-region | Udbygning (D-11) |
| K-9 | `docs/08` §5, §7 og §6 (8A-kode) | D-13 som præciseret af dig: lagene L1–L3 i §8.2. Proveniens på `SentPart`, en invariant i `invokeModel` og klassificering af sagsbunden tekst som `customer_identifiable`. Med en ekstern model blokeres sagsbundne kald. Med stub-modellen er adfærden uændret | Stramning (D-13) |

---

## 19. Beslutninger

**Status:** Alle beslutninger er godkendt 2026-10-03, og specifikationen er låst (B-020).
Godkendelsen dækker specifikationen. Implementeringen kræver en særskilt godkendelse.

| # | Beslutning | Status |
|---|------------|--------|
| **D-1** | Cohere Embed v4 via Bedrocks **EU-geografiske** inferensprofil, 1024 dimensioner som udgangspunkt. Behandlingen er EU-geografisk og ikke kun Frankfurt (§2.3). Alternative modeller kan evalueres mod samme sæt (§4.5) | Godkendt |
| **D-2** | AWS Bedrock som udbyder af production-embeddings og -reranking | Godkendt |
| **D-3** | Cohere Rerank 3.5 in-region i eu-central-1 (Frankfurt) | Godkendt |
| **D-4** | Ingen fallback til `none` i produktion. En reranker-fejl er fail-closed, og production-retrieval er utilgængelig | Godkendt |
| **D-5** | Metric-familien i §4.2 og §4.3 | Godkendt |
| **D-6** | Gates: hårde H1–H7 med nul tolerance, kvalitetsgates Q1–Q7 med tærsklerne i §4.4 som initiale tærskler, og reglerne for pilot-evaluering. Q1–Q7 ligger i et versionsstyret gate-sæt og kan kun rekalibreres gennem en ny godkendt baseline. Under 100 spørgsmål er godkendelsen `tier: pilot` | Godkendt |
| **D-7** | Separat evalueringsmiljø og en versions- og checksumbaseret godkendelsesrapport | Godkendt (udmøntet med D-18) |
| **D-8** | En fejlet hård gate i regression fjerner automatisk production-grad (suspendering). En kvalitetsregression giver alarm og kræver faglig/teknisk vurdering | Godkendt |
| **D-9** | AWS ECS Fargate som production worker og ClamAV som ét lag i upload-sikkerheden | Godkendt |
| **D-10** | Workerens identitet: AWS ECS Fargate, direkte Postgres-forbindelse via Supavisor med en dedikeret LOGIN-rolle (`ingestion_worker_login`, blue/green), ingen tabelrettigheder, kun `EXECUTE` på godkendte `knowledge.worker_*`, ingen godkendelse eller publicering, netværksbegrænsning til NAT'ens faste IP, credentials i AWS Secrets Manager, filer via engangsbillet og Edge Function `worker-storage`, og ingen production-service-rolle i workeren (§6.1.1) | Godkendt |
| **D-11** | OIDC-federering mellem Vercel og AWS frem for statiske AWS-nøgler | Godkendt |
| **D-12** | PDF'er med aktivt indhold afvises | Godkendt |
| **D-13** | Kundedata og fri tekst fra kundesager er teknisk spærret for eksterne modeller, med de fem lag i §8.2 | Godkendt, inkl. K-9 (L1–L5 som tilladt sikkerhedsstramning af 8A) |
| **D-14** | Evidensmodellens schemaVersion 2 med `retrieval.configuration` | Godkendt |
| **D-15** | Alarmer via en abstrakt `AlertSink`. Den første kanal vælges ved implementeringen og låses ikke i domænemodellen (§14) | Godkendt |
| **D-16** | Evalueringssættet versionsstyret i `evals/retrieval/` (§5.1), uden fortrolige kundedata og med CI-kontrol | Godkendt |
| **D-17** | Tilladelse til tekstændringerne i K-1, K-2, K-4, K-6 og K-9 (§18) | Godkendt |
| **D-18** | Særskilt identitet `evaluation_publisher`, så en administrator ikke kan registrere eller rette en evalueringskørsel (§4.5) | Godkendt |
| **D-19** | Ny dependency `postgres` (postgres.js) kun i `workers/` (§6.1.1) | Godkendt |
| **D-20** | Rotation af workerens credential: planlagt cyklus på højst 90 dage, blue/green mellem to login-roller, så Supavisors cache ikke afgør skiftet, og nødspærring straks via medlemskab, `NOLOGIN` og afbrudte sessioner (§6.1.1 pkt. 4). Automatisk rotation fravælges for nu | Godkendt |

**Åbne spørgsmål — ikke [AFKLARES]. De forbliver åbne efter låsningen og blokerer ikke
specifikationen. Å-2 er fortsat exit-kriterium 11 og skal være opfyldt før reel
produktionsbrug:**

| # | Spørgsmål | Hvornår |
|---|-----------|---------|
| Å-1 | Bedrocks kvoter for modellerne i eu-central-1 og EU-profilen | Trin 1 i implementeringen. Kvoteforhøjelse er en driftshandling |
| Å-2 | Databehandleraftalerne bekræftes af dig eller juridisk ansvarlig | Før rigtige dokumenter indlæses og før reel produktionsbrug. Exit-kriterium 11 |
| Å-3 | Hvem vedligeholder evalueringssættet, og hvor ofte tilføjes spørgsmål | Før baseline |
| Å-4 | Retningslinjer for fiktive dokumenter i sættet | Skrives i `evals/retrieval/README.md` før baseline |
| Å-5 | Første alarmkanal (e-mail, webhook eller andet) og modtager | Ved implementeringen af §14 |
| Å-6 | Om offentlige betingelser må ligge i repoet (licens) eller kun peges på med checksum | Pr. dokument ved indlæsning |

---

## 20. Implementeringsrækkefølge (når implementeringen er godkendt)

1. Udbyderadgang: AWS-konto og -region, databehandleraftale, kvoter og OIDC-federering.
   Kontrakttest mod Bedrock.
2. Embedder og reranker bag interfacene, registret og optagne svar til tests.
3. Register over retrieval-konfigurationer og evalueringskørsler, rollen
   `evaluation_publisher`, fingeraftryk og P1–P9 i evidensen. pgTAP og mutationstests.
4. Evalueringsmotor, sættets skema, metrics og gates. Evalueringsmiljø.
5. Baseline-kørsel. Du kalibrerer og godkender kvalitetsgates. Valg af model (v4 eller v3).
6. Worker: rollerne `ingestion_worker` og `ingestion_worker_login`, billetter og Edge Function
   `worker-storage`, scanning, karantæne, timeouts og container. Udrulning til Fargate.
7. Kundedataspærren (§8.2, alle fem lag).
8. Observability og alarmer.
9. Godkendelse og aktivering af konfigurationen. Exit-kriterierne i §17. Dokumentation.

---

## 21. Implementeringsstatus

Specifikationen ovenfor er låst (B-020). Afsnittet her registrerer, hvad der er implementeret.
8B implementeres i deltrin, og hvert deltrin kræver din godkendelse. **8B er ikke fuldt
implementeret.**

| Deltrin | Indhold | Status |
|---------|---------|--------|
| **8B-I1** | Evalueringsframework og gates (§4, §5; dele af §20 trin 4) | ✅ Gennemført og godkendt 2026-10-03 (rettet i 8B-I2: påkrævede passager som sæt, B-021) |
| **8B-I2** | Production embedding og reranking: provider-kontrakt og Bedrock-adaptere (§2, §3; dele af §20 trin 1–2) | ✅ Gennemført og godkendt 2026-10-03. Ikke koblet på applikationen |
| **8B-I2.5** | Ekstern AI-datagrænse: central egress-policy for alle eksterne AI-kald (§8; dele af §20 trin 7) | ✅ Gennemført og godkendt 2026-10-03 (B-022). Admin-værktøjets forespørgsel er afgjort (B-023) |
| **8B-I3** | Workerens databaseidentitet og databasefunktioner: roller, worker-API med lease-token, billetkontrakt, rotation og nødspærring på databasesiden (§6.1.1 D-10/D-20; dele af §20 trin 6) | ✅ Gennemført og godkendt 2026-10-05 (B-024) |
| **8B-I4** | Workerens runtime: postgres.js via Supavisor, job-løkke, heartbeat, nedlukning, Secrets Manager-grænse, IAM, Fargate-specifikation, Edge Function `worker-storage` og I5-gaten (§6.1, §6.1.1; dele af §20 trin 6) | ✅ Gennemført og godkendt 2026-10-05 (B-025). Gaten blev erstattet af I5's release-gate |
| **8B-I5** | Upload-sikkerhed, karantæne og malware-scanning: karantæne-bucket, tilstandsmaskine, byteniveau-validering, ClamAV, PDF-inspektion, verdict afledt i databasen, checksum-binding og release-gate (§7, D-11, D-12) | ✅ Gennemført og godkendt 2026-10-06 (B-026), fuldt lukket med 8B-I5.5 og 8B-I5.6 |
| **8B-I5.5** | Scanner-isolation og signaturforsyning: ClamAV som egen ECS-service uden taskrolle og internet, privat endpoint via Cloud Map, planlagt signaturimage med verifikation, scanner-revision på verdicts (§21.7) | ✅ Gennemført og godkendt 2026-10-06 (B-027) |
| **8B-I5.6** | ClamAV-patchversion: production på ClamAV 1.4.6 (LTS 1.4), godkendte engine-versioner i databasen, signaturopdatering adskilt fra engine-opgradering (§21.8) | ✅ Gennemført og godkendt 2026-10-07 (B-028). I5, I5.5 og I5.6 er fuldt lukket. Kandidatkørslen mod 1.4.6 er en deploymentforudsætning |
| **8B-I6** | Register over retrieval-konfigurationer, `evaluation_publisher`, ProductionEvidenceSet (P1–P9), schemaVersion 2 (§9–§11, §20 trin 3) | ✅ Gennemført og godkendt 2026-10-07 (B-029, B-030) |
| **8B-I6.1** | Pilot-politik for statistisk usikkerhed med menneskelig accept, pilot-scope på produkt og dokumenttype (§21.10) | ✅ Gennemført 2026-10-07 (B-030). Venter på din godkendelse |
| **8B-I7** | Evaluation Operations, Monitoring & Regression Guardrails (definition i §21.10) | Defineret (B-030). Ikke påbegyndt — kræver din eksplicitte godkendelse |
| Øvrige | Baseline med et rigtigt pilotsæt, aktivering i et miljø med de rigtige udbydere | Ikke påbegyndt |

### 21.1 8B-I1 — Evalueringsframework og gates

**Leveret:**

- **Motoren** ligger i `evals/engine/`, uden for applikationen. Den importeres aldrig af `src/`
  (guardrail-test). Den skriver aldrig til en database og udsteder eller opgraderer aldrig
  evidens. Modulerne er:
  - `schema.ts`: skema v1 for spørgsmål, manifest, gate-sæt og erklæret konfiguration.
  - `checksum.ts`: kanonisk JSON, checksums og fingeraftryk.
  - `observe.ts`: facit med ankre og H1–H6 pr. spørgsmål.
  - `metrics.ts`: metrikker og Wilson-intervaller.
  - `gates.ts`: H1–H7, Q1–Q7, minimum pr. type, tier og afgørelse.
  - `runner.ts`: selve kørslen, H6/H7 på kørselsniveau og rapporten.
  - `report.ts`: rapporten i Markdown.
  - `publication.ts`: kontrakten for publicering og genberegningen.
  - `fixture-retrieval.ts`: retrieval over det fiktive korpus.
  - `loader.ts` og `cli.ts`: indlæsning og kommandolinjen.
- **Data** ligger i `evals/retrieval/`:
  - README med metoden
  - JSON Schemas for spørgsmål, manifest og gate-sæt
  - `gates/gates-v1.json` med Q1–Q7 (B-020)
  - konfigurationen `fixture-development`
  - det syntetiske eksempelsæt `example-v1`
  - fiktive fixtures
- **Kørsel:** `IPA_RUNTIME_ENV=test npm run eval:retrieval`. Fixture-retrieval kører den
  rigtige `runRetrieval` (fusion, reranking, udvælgelse, konflikter og EvidenceSet) med
  udviklingsimplementeringerne fra registret over en emuleret database.
  - Emuleringen anvender manifestets tildelinger, gyldighed og filtre, som SQL-funktionerne
    gør.
  - En fixture-kørsel består aldrig: evidensen er `development` (H6), og miljøet er ikke
    evalueringsmiljøet (H7).
- **Tests:** 122 nye enhedstests i `src/tests/eval-retrieval-*.test.ts`. En mutationskørsel
  over motoren gav 45/45 fangede mutationer.

**Udledt (fortolkninger af den låste tekst):**

1. **Passage Recall:** de påkrævede passager (grad 3) er et sæt. Et spørgsmål tæller først, når alle
   er dækket inden for K, og rækkefølgen i facit har ingen betydning. Det afløser I1's oprindelige
   fortolkning ("den første passage med grad 3") efter din godkendelse (B-021).
2. **"Usikker":** for "≤"-gates (Q5, Q6) afgøres usikkerheden af den *øvre* grænse. Et ellers
   bestået resultat med et usikkert gate får den samlede afgørelse `uncertain`.
3. **Distraktor-indtrængen** uden returnerede elementer er 0. Et tomt resultat fanges af Q5.
4. **En retrieval-fejl** tæller som det værst mulige udfald og gør kørslen ugyldig.
5. **`mustNotInclude`** dækker versioner, der er ugyldige for spørgsmålet, og et fund er et brud
   på H3. Distraktorer har deres eget felt (`distractors`, Q6).
6. **Tier:** fra 100 aktive spørgsmål er tier `standard` (§10.1). Det er kun en betegnelse i
   rapporten, ikke en certificering.
7. **Redaction-kontrollen (§5.1)** er en Vitest-test, så den kører i `npm test` og
   `npm run check`.
8. **Udvidet struktur:** `schema/gates.schema.json` og `configurations/` er tilføjet til
   strukturen i §5.1. Begge er additive.

**Udskudt (hører til senere deltrin, §20):**

- **`evaluation_publisher`** (D-18): databaserollen, `knowledge.evaluation_runs`,
  `knowledge.record_evaluation_run` og registrering og godkendelse af gate-sæt hører til
  registret (§10, §20 trin 3).
  - 8B-I1 leverer kontrakten (`EvaluationPublisher`) og genberegningen (`verifyReport`), som
    SQL-funktionen skal spejle.
  - Den eneste publisher, `unavailablePublisher`, afviser alt.
  - Der findes ingen vej til et `PublishedEvaluationRun`.
- **Evalueringsmiljøet** (§4.5): et separat Supabase-projekt med en adapter, der kører
  `runRetrieval` mod rigtige data og identiteter. Indtil da erklærer adapteren selv sit miljø,
  og kun "evaluation" opfylder H7.
- **Chunker-version i evidensen (P7):** `EvidenceItem` bærer ikke `chunker_version`.
  Fixture-adapteren leverer den pr. chunk. Retrieval-laget skal levere den sammen med P1–P9.
- **Algoritmeversionen** (`hybrid-rrf-1`) står som konstant i fixture-adapteren, indtil den
  flytter ind i retrieval-laget med registret (§10.1, P9).
- **Pilot-evalueringssættet** `terms-v1` med 30–50 rigtige spørgsmål tilføjes af dig.
  Kalibreringsproceduren og retningslinjerne for fiktive dokumenter skal skrives i README før
  baseline (Å-3, Å-4).

**Afvigelser fra den låste specifikation:** ingen i indhold.

- **Rækkefølgen** følger din opdeling i deltrin og ikke §20.
- **Ingen dependencies, migrationer eller produktionskode:** I1 tilføjer ingen dependency og
  ingen migration og ændrer ingen kode i `src/` eller `workers/`.
- **Alias-hook:** CLI'en bruger et lille Node-modul-hook (`evals/engine/node-hooks.mjs`) til
  stialiasset `@/`.

**Ingen production-grad:** en rapport fra 8B-I1 har altid `production.eligible: false`. Den kan
hverken godkende, registrere eller aktivere en konfiguration, og P1–P9 er ikke implementeret.

### 21.2 8B-I2 — Production embedding og reranking

**Leveret:**

- **Provider-kontrakten** (`src/lib/knowledge/core/provider.ts`): hver implementering har en
  descriptor, der erklærer:
  - udbyder og model
  - vores egen versionsetiket (`modelVersion`)
  - grad
  - behandlingsprofil: `in_process`, `in_region` eller `geographic`
  - indstillinger
  - grænser
  - for embedding desuden dimension og om input-typerne er symmetriske

  Kontrakten indeholder også de typede fejl (`ProviderError` med `kind` og `retryable`), en
  provider-uafhængig retry-politik (timeout pr. forsøg, eksponentiel backoff med fuld jitter, kun
  genforsøg ved `unavailable`, `throttled` og `timeout`) og fingerprint-materialet (§10.1).
  - `Embedder.embed` tager nu `{ inputType: "document" | "query" }` (K-2).
  - Test-embedderen og "none" har descriptors med grad `development` og `in_process` og virker
    som før.
- **Cohere Embed v4** (`providers/bedrock/cohere-embed-v4.ts`):
  - EU-geografisk via inferensprofilen `eu.cohere.embed-v4:0` med kilderegion `eu-central-1`.
    Bedrock kan route til andre EU-regioner, så behandlingen er ikke Frankfurt-only.
  - 1024 dimensioner, float og `truncate: "NONE"`.
  - `search_document` for dokumenter og `search_query` for forespørgsler.
  - Højst 96 tekster og 400.000 tegn pr. kald, og højst 8.000 tegn pr. tekst.
  - Alle tekster valideres før første kald. En defekt tekst navngives med sit indeks, og intet
    sendes.
  - Svaret valideres: antal, dimension, endelige tal og ingen nulvektor.
- **Cohere Rerank 3.5** (`providers/bedrock/cohere-rerank-3-5.ts`):
  - In-region i `eu-central-1`, med `top_n` lig med alle kandidater og `api_version: 2`.
  - Svaret skal give præcis én score i [0, 1] pr. kandidat og hvert indeks én gang. Ellers fejler
    kaldet (fail-closed).
  - Rækkefølgen bestemmes af scoren. Ved lighed gælder kandidatens oprindelige rækkefølge, og
    udbyderens egen rækkefølge bruges aldrig.
  - Rerankeren kan kun omrangere de kandidater, den får.
- **Transport og credentials:**
  - `@aws-sdk/client-bedrock-runtime` (InvokeModel) bruges kun i `sdk-transport.ts`.
  - Credentials kommer fra SDK'ens standardkæde (OIDC/web identity, task-rolle) eller fra en
    injiceret provider.
  - Statiske nøgler uden session-token afvises i produktion.
  - SDK'ens egne genforsøg er slået fra.
- **Kataloget** (`providers/catalog.ts`) vælger en implementering ud fra modelrækken eller
  reranker-id'et. Ukendte kombinationer fejler, og der er intet fallback til test-embedderen eller
  "none".
- **Fingerprint:** materialet består af:
  - embedding: udbyder, model, version, dimension, behandlingsprofil og indstillinger
  - reranker: det samme plus id og version
  - algoritmeversion (`RETRIEVAL_ALGORITHM_VERSION` i retrieval-core)
  - parametre
  - chunker-versioner (som sæt)

  Timeouts, genforsøg, transport, credentials og grænser indgår ikke.
- **Eval-integration:**
  - Konfigurationsformatet i `evals/` er nu fingerprint-materialet (skema 2).
  - `configurations/bedrock-embed-v4-eu-1024-rerank-3-5.json` er I2's kandidatkonfiguration.
  - `npm run eval:retrieval -- --providers bedrock` evaluerer adapterne, når der findes AWS-adgang.
    Uden credentials fejler kørslen lukket og er ugyldig.
- **Tests:** 65 nye tests mod en falsk Bedrock-transport, uden AWS-konto og uden netværk. En
  mutationskørsel over I2-koden gav 30/30 fangede mutationer.

**Hvorfor I2 alene ikke kan give production-grad:**

- Providerne er bevidst ikke koblet ind i applikationens register (`core/registry.ts`).
  `createEmbedder` og `createReranker` afviser fortsat Bedrock, så hverken retrieval, AI-gatewayen
  eller workeren kan konstruere dem.
- En guardrail-test sikrer, at intet applikationsmodul importerer `providers/`.
- AWS SDK'en indgår hverken i klient- eller server-bundlen. Det er kontrolleret efter build.
- I evalueringsværktøjet kan et EvidenceSet fra Bedrock-adapterne få graden `production` efter
  fase 7-reglen. Det er nødvendigt for at kunne evaluere en kandidat (H6). Sættet forlader aldrig
  evalueringsprocessen, og rapporten er altid `production.eligible: false`.
- At koble providerne ind i registret hører til P1–P9 og registret (§9, §10).

**Database:** ingen migration.

- `chunk_embeddings.embedding` er `vector` uden fast dimension, og `embedding_models.dimensions`
  tillader 1–2000. 1024 dimensioner kan derfor lagres uden ændringer, og testembeddings berøres ikke.
- Modelrækken (`aws-bedrock` / `cohere.embed-v4:0` / `eu-1024-v1` / 1024) og dens partielle
  HNSW-indeks oprettes med deres egen migration i det deltrin, der indfører modellen i et miljø.
- Den rækkefølge er bevidst. En kandidatrække får workeren til at embedde med modellen, og det
  kræver workerens produktionsadgang.

**Udledt:**

1. **Versionsetiketter:** `modelVersion` er vores egen etiket, fordi Bedrock ikke giver en
   uforanderlig modelversion. Den er `eu-1024-v1` for Embed v4 og `euc1-v1` for Rerank 3.5.
2. **Reranker-id:** id'et er `aws-bedrock:cohere.rerank-v3-5:0`.
3. **Rerank-dokumentet:** teksten, der sendes til rerankeren, er overskriftskæden plus chunkens
   tekst. Det svarer til embedding-input uden indledning.
4. **Grænser:** grænserne er vores egne og konservative. Udbyderens faktiske grænser og kvoter
   efterprøves i trin 1 (Å-1).
5. **Baseline for Q7:** med Bedrock er sammenligningsgrundlaget den samme kørsel med "none", altså
   fusionsrækkefølgen.

**Lukket i 8B-I2.5:** forespørgsels-embedding og reranking sender brugerens forespørgsel til
Bedrock. Kundedataspærren gælder nu alle eksterne AI-kald gennem den centrale egress-policy, ikke
kun `invokeModel` (§8.2 L2, §21.3).

**Ikke implementeret:** Fargate, production worker, workerens DB-login, ClamAV, karantæne,
registret og P1–P9, automatisk aktivering, 8C og enhver LLM/Copilot-model.

### 21.3 8B-I2.5 — Ekstern AI-datagrænse

**Princip:** Kundeidentificerbare data må ikke forlade platformens godkendte trust boundary til en
ekstern AI-udbyder uden en senere, eksplicit godkendt politik. Det gælder modelgenerering,
forespørgsels-embedding, dokument-embedding og reranking (B-022, §8.1).

**Arkitektur:**

```
anvendelse/domæne (gateway, retrieval, worker, eval)
  → klassificeret tekst (ClassifiedText: tekst + proveniens, uadskillelige)
  → authorizeEgress (central policy, src/lib/egress/policy.ts) → AuthorizedEgress
  → provider-transport (assertTransmittable) → ekstern tjeneste
```

- **Klassifikation** (`src/lib/egress/classification.ts`):
  - 8A's datakategorier, udvidet med to egress-værdier: `evaluation_synthetic` og `unknown`. Der
    er én model, og `ai/core/types.ts` re-eksporterer `DATA_CATEGORIES` herfra.
  - Proveniens består af kategori, kilde, `caseBound` og `redacted`.
  - Klassificeret tekst laves kun af konstruktører. Den fryses og registreres, så en kopi eller et
    håndbygget objekt aldrig tæller som klassificeret.
  - `narrowed` kan kun give proveniens videre til en del af den oprindelige tekst.
  - Den syntetiske konstruktør ligger i `synthetic.ts` og må kun importeres af `evals/` og tests.
- **Policy** (`src/lib/egress/policy.ts`):
  - Hvert eksternt kald autoriseres samlet, før noget sendes.
  - Altid afvist: `caseBound` (også efter redaction), `customer_identifiable`, `audit_access` og
    `unknown`, manglende eller håndbygget proveniens, tom tekst og brugertekst uden `redacted`.
  - Tilladt pr. operation og rolle:
    - `embed_document`: dokument = `knowledge` eller `evaluation_synthetic`.
    - `embed_query`: forespørgsel = `user_question` eller `evaluation_synthetic`.
    - `rerank`: forespørgsel som `embed_query` og passager som `embed_document`.
    - `generate`: spørgsmål og kontekst = `user_question`, evidens = `knowledge`.
  - Kundedokumenter får aldrig samme ret som Knowledge Engine-dokumenter.
  - Policyen læser hverken database, miljø, indstillinger eller descriptor.
- **Transporten** (`assertTransmittable`): en request sendes kun med en ægte autorisation til den
  pågældende udbyder. Hver streng i requesten skal være en autoriseret tekst eller en reviewet
  protokolkonstant, og model-id'et skal være et maskin-id.
- **Logning:** en afvisning logges som teknisk metadata: hændelse, tidspunkt, korrelations-id,
  modul, udbyder, operation, årsag, kategori, rolle og del-indeks. Selve teksten, PII og den rå
  forespørgsel logges aldrig.

**Hvor proveniensen opstår, og hvordan den følger forespørgslen:**

1. **Gatewayen** (`gateway-core.ts`) redigerer brugerens tekst og laver `userText(question,
   { caseBound: caseId !== null, redacted: true })`. I et sagsbundet kald er teksten
   `customer_identifiable`, uanset redaction.
2. **Retrieval** får forespørgslen som `ClassifiedText`, og `retrieveEvidence` kræver det i typen.
   - `normalizeRequest` trimmer med `narrowed`, så proveniensen bevares.
   - En almindelig streng markeres som manglende proveniens og sendes aldrig eksternt.
3. **Forespørgsels-embedding:** `embedder.embed([query], { inputType: "query" })` med den samme
   klassificerede værdi.
4. **Reranking:** `reranker.rerank({ query, candidates })`. Hver kandidats `document` klassificeres
   som `knowledge` af retrieval-laget, og kun rækker, databasen allerede har givet brugeren adgang
   til, kommer med.
5. **Model:** hver `SentPart` bærer `content` med samme tekst. `invokeModel` autoriserer alle dele
   for en ekstern model og giver autorisationen videre til `generate`.
6. **Worker:** chunks af en Knowledge Engine-dokumentversion klassificeres som `knowledge`.
7. **Eval:** fixtures og spørgsmål er `evaluation_synthetic`.
8. **Admin-værktøjet "Afprøv retrieval"** klassificerer administratorens tekst som ikke redigeret
   og bevarer den uændret. Det virker in-process. Beslutningen er låst for 8B (B-023):
   - Værktøjet redigerer ikke forespørgslen for at gøre den egnet til ekstern behandling.
   - Bruger retrieval en ekstern embedding- eller reranking-udbyder, gælder egress-politikken, og
     forespørgslen afvises (fail-closed).
   - Der er ingen "send alligevel", "markér som sikker" eller anden tilsidesættelse.
   - Production-providere evalueres med kontrolleret evalueringsmateriale, ikke med vilkårlige
     forespørgsler fra Admin.
   - En arkitekturtest sikrer, at værktøjet hverken bruger redaction-modulet eller markerer teksten
     som redigeret.

**Lag:**

| Lag | Status efter 8B-I2.5 |
|-----|----------------------|
| L1 Proveniens | ✅ `ClassifiedText` på forespørgsel, passager, chunks og hver `SentPart` |
| L2 Central egress-policy | ✅ Generering, embedding og reranking, kontrolleret igen i transporten |
| L3 Klassificering | ✅ Sagsbunden tekst er `customer_identifiable` ved grænsen. Matricen bruger fortsat 8A's kategori, så stub-modellen virker som i 8A |
| L4 Matricen | ✅ Migration `20261003000100_external_ai_boundary.sql`: constraint `customer_identifiable_always_denied` |
| L5 Profilerne | ✅ Uændret (ingen profil har `customer_identifiable`) |

**Tests:**

- 43 tests i `egress-boundary.test.ts` og 13 i `egress-architecture.test.ts`. Hver afvisning
  beviser nul eksterne kald.
- 9 pgTAP-tests i `external_ai_boundary.test.sql`.
- Mutationer: 27/28 fanget. Den sidste er ækvivalent: den sender de samme, allerede autoriserede
  strenge, og transporten kontrollerer indholdet uanset.
- Parringsreglen (B-012) og alle 8A-tests består uændret.

**Ikke implementeret:** Fargate, workerens DB-identitet, ClamAV, karantæne, registret og P1–P9,
aktivering af providerne, 8C, godkendelse af redaction til kundedata og en rigtig Copilot-model.
Bedrock-providerne er fortsat ikke koblet ind i applikationens register.

### 21.4 8B-I3 — Workerens databaseidentitet og databasefunktioner

Realiserer databasesiden af D-10 og D-20 (§6.1.1, B-024). Migration
`20261003000200_ingestion_worker_identity.sql`. Workerens kørselsmiljø er ikke en del af deltrinnet.

**Roller:**

| Rolle | Type | Rettigheder |
|-------|------|-------------|
| `ingestion_worker` | Gruppe, NOLOGIN, ejer intet | `USAGE` på skemaet `knowledge` og `EXECUTE` på præcis de 12 funktioner i `ops.ingestion_worker_api()`. Ingen tabel-, kolonne- eller sekvensrettigheder |
| `ingestion_worker_login_blue` / `_green` | Login-roller (D-20) | Kun medlemskab af gruppen (`INHERIT TRUE, SET FALSE`). Ingen superuser, `CREATEROLE`, `CREATEDB`, replikering eller `BYPASSRLS`. `connection limit 5`, `statement_timeout 60s`, `lock_timeout 10s`, `idle_in_transaction_session_timeout 30s` og tom `search_path` |

- Migrationen opretter login-rollerne **NOLOGIN, uden password og uden medlemskab**. Først
  runbooken aktiverer en rolle. Under en kontrolleret rotation er begge aktive med de samme
  snævre rettigheder (via gruppen).
- Rollerne er ikke medlem af `authenticated`, `service_role`, `postgres` eller nogen anden rolle.
  PostgREST (`authenticator`) kan ikke skifte til dem.
- Rollerne er klyngebrede. Migrationen er idempotent og stopper, hvis en eksisterende rolle har
  for brede attributter.

**Worker-API'et** (security definer, `search_path = ''`, identitetskontrol først i hver funktion):

| Funktion | Formål |
|----------|--------|
| `worker_claim_job(p_worker, p_lease_seconds)` | Tag næste job. Returnerer metadata, `lease_token` og `lease_expires_at` |
| `worker_heartbeat(job, token, sekunder)` | Forlæng en gyldig lease. Returnerer ny udløbstid |
| `worker_checkpoint(job, token, trin, tilstand)` | Gem et gennemført trin |
| `worker_store_pages(job, token, sider, …)` | Sider og filens tekniske data (kun behandlingsjob) |
| `worker_store_chunks(job, token, chunks, version)` | Chunks samlet og idempotent (kun behandlingsjob) |
| `worker_embedding_models()` | Aktiv model og kandidater |
| `worker_chunks_to_embed(job, token, model)` | Chunks, der mangler en embedding |
| `worker_store_embeddings(job, token, model, rækker)` | Embeddings for jobbets egne chunks. Idempotent |
| `worker_verify_index(job, token)` | Integritetskontrol af embeddings |
| `worker_complete_job(job, token, rapport)` | Afslut: `processed` (behandlingsjob) |
| `worker_fail_job(job, token, kode, besked, genforsøg)` | Fejl med eller uden genforsøg. Frigiver også et job |
| `worker_issue_storage_ticket(job, token, formål)` | Engangsbillet til originalen |

- Ingen funktion kan godkende, publicere, deaktivere, ændre adgang, ændre autoritativ status,
  aktivere en model eller konfiguration eller publicere evalueringsresultater. Ingen funktion
  udfører dynamisk SQL.
- Der er ingen release-funktion: `worker_fail_job` med genforsøg frigiver et job, og en lease, der
  ikke fornyes, udløber og overtages af næste claim.
- Inputtet valideres i databasen: lease-varighed 30–900 sekunder, worker-etiket, trinnavn,
  fejlkode, JSON-typer og -størrelser, filtype (PDF), antal sider, chunks og embeddings. Statusovergange
  håndhæves af den eksisterende statusmaskine (trigger) for alle roller.
- Fejlkoder: `42501` identitet, `55P03` ingen gyldig lease, `22023` ugyldigt input, `23514` forkert
  tilstand eller version, `P0002` ukendt eller udfaset model, `54000` billetgrænse.

**Identitet:** hver funktion bestemmer den faktiske rolle bag kaldet: den aktive `SET ROLE`
(indstillingen `role`, som et security definer-skift ikke ændrer, og som kun kan sættes til en
rolle, man er medlem af), ellers `session_user`. Rollen skal være blue, green eller — kun lokalt —
`service_role`, **og** have medlemskab af `ingestion_worker` lige nu. Ejeren (`postgres`), en
bruger, et fejlagtigt medlem af gruppen og en rolle med direkte `EXECUTE` uden medlemskab afvises.

**Lease-capability:**

- `worker_claim_job` udsteder et uforudsigeligt token: 64 hex-tegn fra to v4-UUID'er
  (`pg_strong_random`, 244 tilfældige bit, ingen ny extension).
- Kun `sha256(job_id || ':' || token)` gemmes i `ingestion_jobs.lease_token_hash`. Hashen er
  bundet til jobbet, og tokenet gemmes aldrig.
- Hvert kald på et job kræver: job i gang, hash-match og `locked_until > now()`. Job-id alene er
  aldrig nok, og etiketten `p_worker` er kun til drift.
- En udløbet lease kan ikke genoplives. Næste claim overtager jobbet med et nyt token, og det
  gamle virker ikke længere.
- Når jobbet forlader `running`, fjerner en trigger hashen. En constraint kræver hash, præcis når
  jobbet kører, så en gentagen afslutning, en fejl efter afslutning og en genafspilning afvises
  deterministisk (`55P03`).
- Jobs i gang fra før deltrinnet sættes i kø igen ved migrationen. Forsøgstallet bevares.
- Workerklienten (`workers/ingestion/db.ts`) holder tokenet i processen pr. job. Pipelinen ser
  det aldrig.

**Billetkontrakten** (D-10 pkt. 3; kun databasen, ingen Edge Function og ingen download):

- Tabellen `knowledge.worker_storage_tickets` har RLS og ingen rettigheder for nogen rolle.
- En billet er bundet til job, version, bucket (`knowledge-originals`), sti, formål, workerens
  lease (lease-hashen) og udløb (højst 60 sekunder). Billetten gemmes som SHA-256-hash.
- Formål: kun `download_original`, og kun for et behandlingsjob, hvis version er under
  behandling. Karantæne kommer med sit eget deltrin.
- Højst 3 ubrugte, gyldige billetter pr. job.
- `knowledge.redeem_worker_storage_ticket(billet)` kan kun køres af `service_role` (den kommende
  Edge Function) og kontrollerer den faktiske rolle. Billetten indløses én gang, inden udløb og kun,
  mens leasen, den blev udstedt under, stadig gælder. Den returnerer bucket, sti, formål og
  checksum. Andre fejl giver `28000`.

**Drift — skemaet `ops`** (ingen rettigheder for app-roller; funktionerne kører som kalderen, så
kun migrationsrollen `postgres`, der har ADMIN på rollerne, kan bruge dem; alle handlinger
auditeres i `audit.audit_log`):

| Funktion | Virkning |
|----------|----------|
| `ops.ingestion_worker_prepare(rolle)` | `LOGIN` og medlemskab af gruppen |
| `ops.ingestion_worker_retire(rolle)` | Rotationens deaktivering (se nedenfor) |
| `ops.ingestion_worker_emergency_revoke(rolle)` | Nødspærring: medlemskab væk, `NOLOGIN`, `password null`, sessioner afbrudt. Ændrer ingen domænedata |
| `ops.ingestion_worker_set_api(false/true)` | Global nødbremse: gruppens `EXECUTE` på hele API'et fjernes, eller den gives tilbage præcist |
| `ops.ingestion_worker_status()` | Roller, sessioner, API-rettigheder og overtrædelser (skal være en tom liste i produktion) |

Der passerer aldrig et password gennem funktionerne.

**Rotation (D-20), runbook:**

1. *Klargør* den inaktive rolle (fx green): generér et password (`openssl rand -base64 48`), og
   sæt det med `\password ingestion_worker_login_green` i psql som `postgres`. psql beregner
   SCRAM-verifieren klientside, så klarteksten hverken sendes til serveren eller logges. Kør
   `select ops.ingestion_worker_prepare('ingestion_worker_login_green');`.
2. *Gem* brugernavn (`ingestion_worker_login_green.<projekt-ref>`) og password som en ny version
   af workerens secret i AWS Secrets Manager (`aws secretsmanager put-secret-value`) fra en
   driftsmaskine. Passwordet skrives aldrig i repoet, i `.env`, i task-definitionen eller i en
   migration.
3. *Flyt* ECS-servicen kontrolleret til den nye version. Først når kørselsmiljøet findes (senere
   deltrin).
4. *Verificér:* `select ops.ingestion_worker_status();` viser sessioner for green og ingen
   overtrædelser, og et kontroljob behandles.
5. *Deaktivér* den gamle rolle: `select ops.ingestion_worker_retire('ingestion_worker_login_blue');`.
6. *Bekræft:* status viser blue med `login: false`, `member: false` og 0 sessioner. Den gamle
   secret-version udfases.

**Nødspærring:**

- `select ops.ingestion_worker_emergency_revoke('<rolle>');` virker ved næste funktionskald,
  også på en forbindelse, som pooleren holder åben, fordi identiteten kontrolleres ved hvert kald.
- Kør status bagefter. Viser den stadig sessioner, køres funktionen igen.
- `select ops.ingestion_worker_set_api(false);` stopper begge roller på én gang.
- Domænedata ændres ikke. Rollens leases udløber og overtages, når en anden rolle er klargjort.

**Supavisor:**

- Forbindelsen går til Supavisor i **transaktionstilstand** (port 6543) med brugeren
  `ingestion_worker_login_<farve>.<projekt-ref>`. Pooleren har serverforbindelser pr. bruger, så
  rollens indstillinger gælder.
- TLS er påkrævet (`sslmode=verify-full` med Supabases CA). Netværksbegrænsningen tillader kun
  NAT-gatewayens faste IP (D-10 pkt. 2, senere deltrin).
- API'et kræver ingen sessionstilstand. Hvert kald er en selvstændig transaktion, og tokenet følger
  med i kaldet. Der bruges ingen `SET`, temp-tabeller, advisory locks, `LISTEN` eller prepared
  statements (postgres.js `prepare: false`, D-19). Sessionstilstand er derfor ikke nødvendig.
- `connection limit 5` gælder pr. rolle. Workerens pulje skal være mindre, og under en rotation har
  hver rolle sin egen grænse.

**Lokalt og i test:**

- `supabase/seed.sql` (development-only) giver `service_role` medlemskab af gruppen. Det er den
  eneste vej for den lokale worker, som stadig bruger service-rollen (§6.1.1 pkt. 6).
- `workers/ingestion/main.ts` nægter at starte med service-rolle-nøglen uden
  `IPA_RUNTIME_ENV=local/test`.
- `ops.ingestion_worker_status()` melder `service_role_is_worker` som en overtrædelse. Det er
  forventet lokalt og forbudt i produktion.
- Lokale værktøjer sætter ikke passwords på login-rollerne. Til en manuel test sættes et password
  med `\password` og fjernes igen med `retire`.

**Tests:**

- pgTAP:
  - `ingestion_worker_identity.test.sql` (82): roller, mindste rettigheder for blue og green,
    rigtige forsøg, identitet, service_role, nødspærring og værn mod PUBLIC.
  - `ingestion_worker_lease.test.sql` (98): hele API'et som blue og som green, angreb på leasen,
    inputvalidering og billetter.
  - `knowledge_ingestion.test.sql` kører nu som blue.
- Integration: `ingestion-worker-lease.integration.test.ts` med parallelle claims og parallelle
  afslutninger gennem PostgREST. Den rigtige worker kører ende til ende med lease-tokens.
- Enhedstests: `worker-identity-guardrail.test.ts` (ingen credentials i migrationer eller seed,
  ingen worker-adgang for service_role uden for seedet, identitetskontrol i hver funktion og
  workerens startspærre) samt arkitekturtesten for B-023.
- Mutationer i SQL: 38/40 fanget. De to tilbageværende er ækvivalente:
  - `status = 'running'` i lease-kontrollen håndhæves også af trigger og constraint.
  - Formatkontrollen af tokenet: et forkert format giver aldrig et hash-match.
- Frisk database: alle migrationer og seedet er kørt mod en ny container fra samme image (efter
  Storage-API'ets egne migrationer). Rolleblokken kan køres igen.

**Kendte grænser i PostgreSQL** (ikke en adgang til data):

- Via PUBLIC kan en login-rolle oprette temp-tabeller og large objects og læse systemkataloget
  (metadata, også funktionernes kildetekst).
- En rolle kan ændre sine egne sessionsstandarder og sit eget password (`ALTER ROLE` på sig
  selv). `statement_timeout` m.fl. er derfor forsvar i dybden og ikke en sikkerhedsgrænse.
- Rotationens deaktivering fjerner password, login og medlemskab, så et ændret password ikke
  overlever den.

**Afvigelser og realiseringsvalg** (B-024):

- Deaktivering sætter `password null` i stedet for et tilfældigt password, som ingen gemmer.
- Der er ingen release-funktion.
- Billetformålet er kun `download_original`, fordi karantæne hører til et senere deltrin.
- Lease-tokenet er en skærpelse af "kontrollerer selv lease" (§6.1.1 pkt. 1). Fase 7's
  `p_worker` er erstattet af `p_lease_token` i alle funktioner undtagen claim.
- Driftsfunktionerne ligger i et nyt skema, `ops`.

**Status:** gennemført og godkendt 2026-10-05. Klientsiden (postgres.js, kørselsmiljø, billetindløsning) er realiseret i 8B-I4 (§21.5).

**Ikke implementeret i I3:** Fargate-container og -runtime, AWS Secrets Manager-integration,
NAT-gateway, deployment af workeren, Edge Function `worker-storage` og download, postgres.js
(D-19), Bedrock-aktivering i appen, ClamAV, karantæne, registret og P1–P9, aktivering af
production-retrieval og 8C. Workeren bruger lokalt fortsat service-rollen gennem PostgREST.

### 21.5 8B-I4 — Workerens runtime

Gør `workers/ingestion` klar til at køre som en kontrolleret ECS Fargate-workload med I3's
identitet og capability-model (§6.1, §6.1.1, B-025). Godkendt 2026-10-05. **Status efter I5:**
den lukkede I5-gate og standby er erstattet af release-gaten (§21.6).

**Kendt flaky-test-observation (2026-10-05):** én isoleret fejl i en AI Gateway-test i den
fulde testkørsel ved I4, som ikke kunne genskabes. Fejler samme test igen i et senere deltrin,
skal årsagen undersøges før pilot/produktion. Status ved I5: se §21.6 og rapporten.

**Arkitektur** (`workers/ingestion/`):

```
main.ts      konfiguration → forbindelse → identitetskontrol → løkke (eller standby, når gaten er lukket)
config.ts    validering af runtime-konfigurationen; fejl nævner variabler, aldrig værdier
db.ts        postgres.js-adapter: KUN knowledge.worker_* (I3), ét statement = én transaktion
runtime.ts   løkken (claim → behandling → complete/fail), backoff, nedlukning, standby
lease.ts     uafhængig heartbeat, tab af lease og stall-vagt
pipeline.ts  behandlingen (fase 7) + gate og afbrydelse
gate.ts      I5-gaten
originals.ts originaler via engangsbillet
log.ts       struktureret JSON-log med redigering
liveness.ts, healthcheck.ts   liveness uden HTTP-server
dev-service-role.ts           ⚠ kun lokalt/test (fase 7, B-16); ikke i production-imaget
```

**postgres.js** (den godkendte dependency `postgres` 3.4.9, uden transitive dependencies):

- Supavisor i transaktionstilstand (port 6543) og TLS med `verify-full` mod Supabases CA.
- `prepare: false` (transaktionstilstanden bevarer ikke prepared statements) og
  `fetch_types: false`, så der ikke køres en katalogforespørgsel ved forbindelse.
- Pulje `max: 2`: én forbindelse til jobbet og én til heartbeat. Rollens `CONNECTION LIMIT 5` er
  et sikkerhedsnet, ikke et mål.
- `connect_timeout` 10 s, `idle_timeout` 30 s, `max_lifetime` 15 min og
  `application_name ipa-ingestion-worker`.
- Hvert kald annulleres klientside efter højst 60 s. Rollens `statement_timeout` er serversiden.
- Workeren afhænger ikke af sessionstilstand mellem transaktioner. Lease-tokenet holdes i
  processen og sendes med hvert kald.
- jsonb-parametre sendes med `sql.json`, og `text[]`-kolonner returneres som jsonb, fordi
  postgres.js uden `fetch_types` ikke parser array-typer. Begge fejl blev fundet af
  integrationstestene.
- Konfigurationen afviser i produktion:
  - `service_role` og ejer- eller gruppe-roller som bruger: kun
    `ingestion_worker_login_(blue|green).<projekt-ref>` accepteres;
  - service-rolle-nøglen;
  - en port, der ikke er 6543;
  - en forbindelse uden TLS;
  - en manglende CA-fil.

**Secrets Manager og blue/green:**

- ECS' indbyggede secret-injektion. Execution-rollen henter `username` og `password` fra
  secreten `ipa/production/ingestion-worker/db` (`AWSCURRENT`), når en task starter, og ECS
  sætter dem som `IPA_WORKER_DB_USER` og `IPA_WORKER_DB_PASSWORD`. Der er ingen egen
  secret-klient.
- Den aktive farve er den, som secretens aktuelle version peger på. Skiftet kræver ingen
  kodeændring:
  1. Klargør den anden rolle (§21.4).
  2. Læg en ny secret-version.
  3. Kør `update-service --force-new-deployment`.
  4. Gamle tasks får SIGTERM.
  5. Verificér.
  6. Deaktivér den gamle rolle.
- Hemmeligheden er aldrig i image, repo, build-argumenter, almindelige miljøvariabler eller logs.
  Runbook: `deploy/ingestion-worker/README.md`.

**IAM** (`deploy/ingestion-worker/iam/`):

- **Execution-rollen:**
  - `ecr:GetAuthorizationToken` (kan ikke afgrænses);
  - image-pull fra repositoriet `ipa-ingestion-worker`;
  - logs til `/ipa/ingestion-worker`;
  - `secretsmanager:GetSecretValue` på den ene secret;
  - `kms:Decrypt` via Secrets Manager.
- **Task-rollen:** kun den forberedte `bedrock:InvokeModel` for Embed v4 gennem
  EU-inferensprofilen. Foundation-modellen er kun tilladt gennem profilen (condition). Der er
  ingen reranker, secrets eller wildcard-handling.
- Begge roller kan kun påtages af ECS-tasks i kontoen.
- Bedrock bruges ikke af workeren, før gaten åbnes og en model aktiveres.

**Fargate** (`deploy/ingestion-worker/`):

- **Image** (`Dockerfile`):
  - to trin;
  - kun `postgres` og `pdfjs-dist` (eget manifest, samme versioner som rodens lockfil, uden
    valgfrie pakker);
  - kode ejet af root og læsbar for brugeren `node` (uid 1000);
  - ingen `ARG` og ingen hemmeligheder;
  - `.dockerignore` udelukker `.env*` og udviklingsadapteren.
- **Taskdefinition:**
  - 1 vCPU og 2 GB;
  - skrivebeskyttet rodfilsystem og kun `/tmp` som skrivbar volumen;
  - `capabilities drop ALL`, `initProcessEnabled` og `stopTimeout` 120 s (længere end workerens
    nedlukningsfrist på 90 s);
  - healthcheck med liveness-filen;
  - `awslogs` i non-blocking mode.
- **Service:**
  - desiredCount 1;
  - deployment med 100/200 % og circuit breaker med rollback;
  - private subnets uden offentlig IP;
  - ingen ECS Exec.
- **Security group:** ingen indgående trafik, udgående kun 443 og 6543.

**Netværk:**

```
privat subnet → NAT (Elastic IP) → Supavisor :6543 → Supabase Postgres
                                 → HTTPS :443 → worker-storage, Bedrock, ECR, CloudWatch, Secrets Manager
```

- Supabase Network Restrictions skal tillade NAT'ens Elastic IP (/32).
- Begrænsningen beskytter Postgres og pooleren, **ikke** Supabases HTTPS-API'er. For
  `worker-storage` er engangsbilletten sikkerhedsgrænsen.
- Kontoen, VPC'en og NAT'en findes ikke endnu [AFKLARES]. Specifikationen deployes, når de
  gør.

**Job-løkken:** claim → behandling → complete/fail → næste job.

- **Tom kø:** eksponentiel backoff med ±20 % jitter fra 2 til 30 s.
- **Fejl i database eller netværk:** backoff fra 1 til 60 s.
- **Afvist identitet** (`28P01`, `28000`, `42501`, fx efter nødspærring): processen afslutter
  med kode 2, og ECS erstatter tasken.

**Heartbeat:**

- Kører på egen timer og egen poolforbindelse: hvert 60. sekund ved en lease på 300 s.
- Afviser databasen en heartbeat (`55P03`), eller udløber leasen lokalt uden en vellykket
  heartbeat, afbrydes jobbet straks. Alle videre databasekald afvises i workeren, og databasen
  afviser dem under alle omstændigheder.
- **Stall-vagt:** er der ingen fremdrift i 10 minutter (et hængende kald), stopper heartbeat, og
  jobbet opgives. Leasen udløber, og en anden worker overtager. Liveness opdateres ikke længere,
  så tasken erstattes, hvis løkken hænger.

**Nedlukning (SIGTERM):**

- Ingen nye claims.
- Det igangværende job får 90 s. Derefter opgives det: det completes eller fejles aldrig, leasen
  udløber, og næste worker fortsætter fra sidste checkpoint.
- Exit 0.

**Billetindløsning** (Edge Function `supabase/functions/worker-storage/`):

1. Workeren beder om en billet under sin lease (`worker_issue_storage_ticket`).
2. Den sender kun `{"ticket": "…"}` til funktionen.
3. Funktionen indløser billetten med service-rollen, som kun findes server-side i funktionen.
4. Den streamer bytes fra præcis det ene objekt tilbage, med checksum i en header.

Funktionens grænser:

- Ingen signeret URL og ingen credential i svaret. Funktionen kan ikke liste objekter.
- Felter som sti eller bucket afvises (400). Ugyldige, brugte, udløbne og overtagne billetter
  får et ensartet 403.
- Billetten logges aldrig.
- `verify_jwt = false`, fordi kalderen ikke har en JWT. Billetten er den eneste adgang.
- Logikken ligger i `handler.ts` (Web-standard), og Deno-indgangen er `index.ts`. Lokalt testes
  den samme handler mod den rigtige database og Storage.

**I5-gaten** (`gate.ts`):

- **Produktion:** gaten er altid lukket. Der findes ingen variabel eller flag, der åbner den.
  - **Lag 1:** workeren står standby og tager ingen jobs. Den kontrollerer sin identitet
    periodisk.
  - **Lag 2:** pipelinen afviser ethvert job før download, også re-embedding.
  - **Lag 3:** downloadede bytes går gennem `gate.inspect` før enhver parsing.
- Når gaten afviser, fejles jobbet uden genforsøg med koden `security_scan_unavailable`. Intet
  parses, chunkes eller embeddes.
- **Lokalt og i test:** en udviklingsgate lukker fiktive fixtures igennem.
- Gaten må kun ændres som del af et godkendt 8B-I5.

**Tests:**

- **Enhedstests:**
  - `worker-runtime.test.ts` (43): konfiguration, postgres.js-optioner, gate, løkke, backoff,
    identitetsfejl, heartbeat, tab af lease, stall, nedlukning, standby, logredigering,
    billet-download, og at pipelinen aldrig completer eller fejler et afbrudt job.
  - `worker-gate.test.ts` (3): parser og chunker kaldes ikke ved lukket gate, og fixtures går
    igennem lokalt.
  - `worker-storage-handler.test.ts` (16).
  - `worker-runtime-architecture.test.ts` (19):
    - importgrafen;
    - kun `worker_*` i adapteren;
    - Dockerfile, taskdefinition, IAM og netværk;
    - ingen credentials;
    - Bedrock er ikke i appens register.
- **Integration:** `worker-runtime.integration.test.ts` (15) mod den lokale database som blue og
  green:
  - rigtigt login via adapteren;
  - credential- og forbindelsesfejl;
  - billetter: gyldig, genafspillet, forfalsket, ekstra felter, udløbet og overtaget lease;
  - crash efter claim, efter sider, efter chunks, midt i embedding og efter embeddings før
    complete. I hvert tilfælde udløber leasen, en anden worker gør jobbet færdigt, og den gamle
    worker afvises (`55P03`), mens data er uændrede;
  - dobbelt levering;
  - rigtige heartbeats;
  - tab af lease midt i et job;
  - den rigtige proces (`main.ts`) ende til ende, ved SIGTERM og efter nødspærring (exit 2).

  Testene kræver `IPA_TEST_DB_ADMIN_URL` (lokal). Den lokale database stoler på
  loopback-forbindelser, så et forkert password kan ikke testes lokalt. Credential-fejlen testes
  i stedet med en rolle, der ikke kan logge ind (`28000`).
- **Mutationer:** 27/27 fanget. Mutationerne dækker gate, pipeline, lease-keeper, løkke,
  konfiguration, postgres.js-optioner, logredigering, størrelsesgrænse og Edge Function. To
  mutationer overlevede første kørsel (afbrydelse før complete og en lease, der er tabt under
  fail), og der er tilføjet tests for begge.
- **Image:** `docker build` kunne ikke køres i dette miljø, fordi registrene afviste at hente
  base-imaget (rate limit / forbidden). Imagets filer blev i stedet samlet præcis som i
  Dockerfilen, og afhængighederne blev installeret fra imagets manifest. Resultat:
  - start i produktion uden konfiguration og med service-rolle-nøgle afvises (exit 1);
  - healthcheck virker;
  - tekstudtrækket er identisk med og uden `@napi-rs/canvas`;
  - der er ingen credentials i træet.

**Afvigelser og realiseringsvalg** (B-025):

- Ingen IaC-framework. Specifikationen er versionsstyret JSON plus runbook.
- Funktionen streamer objektet i stedet for at returnere en signeret URL.
- Produktionsworkeren står standby, mens gaten er lukket.
- Imaget har eget dependency-manifest.
- Valgfrie pdfjs-pakker er udeladt.
- `heading_path` hentes som jsonb.

**Ikke implementeret:** ClamAV, karantæne, filvalidering og aktivt indhold (I5), registret og
P1–P9, `evaluation_publisher`, aktivering af production-retrieval og Bedrock i appen, 8C og
rigtige cloud-ressourcer (konto, VPC, NAT, ECR, secret og deployment).

### 21.6 8B-I5 — Upload-sikkerhed, karantæne og malware-scanning

Efter I5 kan et produktionsdokument kun nå parsing, chunking og embedding, hvis det **eksplicit
har bestået hele filsikkerhedskæden**, og databasen har frigivet netop de bytes, der blev
scannet (§7, D-11, D-12, B-026). I5 erstatter I4's lukkede gate med en rigtig release-gate.

**Tilstandsmaskine** (`document_versions.security_state`, håndhævet af triggeren
`check_version_security` for alle roller):

```
upload ──► quarantined (knowledge-intake) ──claim af scan-job──► scanning
scanning ──verdict safe──► (stadig scanning) ──flytning bekræftet med checksum──► released (knowledge-originals) ──► behandlingsjob
scanning ──verdict rejected──► rejected ──flytning──► knowledge-quarantine (endestation)
scanning ──teknisk fejl──► scan_failed ──genforsøg──► scanning
released ──bytes ændret / genscanning──► quarantined
legacy_unscanned (versioner fra før I5) ──genscanning──► quarantined
```

- En ny version oprettes altid som `quarantined` i `knowledge-intake` — også af tabellens ejer.
- Sikkerhedskolonnerne kan kun ændres af databasens egne funktioner (tabellens ejer). En klient,
  `service_role` og workeren kan ikke opdatere dem.
- `processed` og `published` kræver `released` — for alle roller.
- `released` kræver et verdict og `knowledge-originals` (constraint).
- Højst én aktiv scanning pr. version (unikt partielt indeks).

**Buckets (lagergrænsen):**

| Bucket | Indhold | Politikker |
|--------|---------|------------|
| `knowledge-intake` | Nye uploads (karantæne) | Kun `INSERT` for `knowledge.document.write` i den faste sti. Ingen kan læse, ændre eller slette |
| `knowledge-originals` | Kun frigivne originaler | Kun læsning for forvaltere, og kun for `released` (eller versioner fra før I5). Ingen upload fra klienter |
| `knowledge-quarantine` | Afviste filer | Ingen politikker. Ingen kan læse dem gennem API'et |

Kun Edge Function `worker-storage` (service_role, server-side) flytter filer, og kun på en
engangsbillet, som databasen har udstedt til netop den flytning.

**Kontroller i rækkefølge** (`workers/ingestion/security/`):

1. **Strukturel validering på byteniveau** (`file-checks.ts`, ingen parser): størrelse,
   SHA-256 og størrelse = de registrerede, magic bytes `%PDF-1.0–1.7/2.0` på byte 0 (andre
   signaturer genkendes: ZIP, EXE, ELF, PNG, JPEG, GIF, OLE, RAR, 7z, gzip, HTML), filendelsen
   `.pdf`, upload-MIME `application/pdf`, `%%EOF` i de sidste 4 KB og kun whitespace efter det
   sidste `%%EOF` (ellers polyglot). Endelse eller MIME alene er aldrig nok.
2. **ClamAV** (`scanner.ts`): clamd-protokollen over TCP til ClamAV-tjenesten på `clamav.ipa-worker.internal:3310` (§21.7)
   (`zVERSION`, `zINSTREAM` i bidder på 64 KB). Alle filer under størrelsesgrænsen scannes —
   også en fil, der allerede er strukturelt ugyldig.
3. **PDF-sikkerhedsinspektion** (`pdf-structure.ts`, `pdf-inspect.ts`) — kun for en strukturelt
   gyldig fil, som ClamAV fandt ren. Den læser PDF'ens **struktur** (alle dictionaries, også i
   komprimerede objektstrømme, navne med `#xx` afkodet), aldrig en bytesøgning, og den bruger
   **ikke pdfjs**. Den kører i en børneproces (`inspector.ts`) med tom miljøvariabel-liste,
   begrænset heap og hård tidsgrænse (SIGKILL), og bytes går over stdin — ingen midlertidige
   filer.

**PDF-politik V1 (`pdf-v1`)** — afvises:

- JavaScript: `/JS`, `/JavaScript` (nøgler, navnetræer, `/S /JavaScript`).
- Handlinger, der åbner eller sender noget: `/Launch`, `/SubmitForm`, `/ImportData`, `/GoToR`,
  `/GoToE`.
- `/AA` (additional actions) overalt.
- `/OpenAction`, der er andet end en sidedestination eller en `/GoTo` uden `/Next`.
- Indlejrede filer og vedhæftninger: `/EmbeddedFiles`, `/EF`, `/Type /EmbeddedFile`,
  `/FileAttachment`. De pakkes aldrig ud.
- RichMedia og multimedier: `/RichMedia*`, `/Screen`, `/Movie`, `/Sound`, `/3D`, `/Rendition`.
- XFA (`/XFA`).
- Kryptering (`/Encrypt`). Der prøves aldrig en adgangskode, og der er intet password-flow.
- Defekte PDF'er og alt, læseren ikke kan læse pålideligt: ukendt syntaks, uafsluttede
  strenge, ugyldige navne, objektstrømme med andre filtre end FlateDecode, intet katalog eller
  ingen sider, og krydsreferencer, der ikke peger præcis på det objekt, de nævner (forhindrer at
  en anden læser ledes til et objekt gemt i en stream).

Tilladt: almindelige links inklusive `/URI` (de åbner intet af sig selv) og navigation
(`/GoTo`, `/Named`, `/Thread`).

**Grænser** (serverens politik, begrænset af hårde lofter i `limits.ts`, som hverken politik,
Admin eller miljø kan hæve):

| Grænse | V1 | Begrundelse |
|--------|----|-------------|
| Filstørrelse (upload og efter download) | 50 MB | Bucket-grænsen fra fase 7 |
| Sider | 2.000 | Fase 7's grænse |
| Objekter | 200.000 | Langt over normale betingelser; stopper objektbomber |
| Udpakket objektstrøm (én / i alt) | 20 MB / 100 MB | Dekomprimeringsbomber |
| Udpakningsforhold | 200:1 | Typisk tekst-PDF ligger langt under |
| Indlejringsdybde | 64 | Rekursion |
| Inspektion: tid / heap | 60 s / 512 MB | Børneprocessen dræbes ved overskridelse |
| ClamAV pr. fil | 120 s | §6.4 |

**Verdict** (`knowledge.security_verdicts`, uforanderligt bortset fra frigivelse/afløsning):
version, job, politikversion, checksum, filstørrelse, fundet MIME, bucket og sti, strukturelt
resultat og kode, malwareresultat, fundets navn og fejlkode, scanner, scannerversion,
signaturversion og -tid, PDF-sikkerhedsresultat og kode, aktivt indhold og fund, endeligt
verdict, fejlkode, tidspunkt, frigivelse og afløsning (med årsag).

**`safe` afledes i databasen** (`worker_record_security_verdict`). Workeren indberetter kun
målinger, i et strengt valideret format uden fri tekst. Rækkefølgen er politikken:

1. fund → afvist `malware_detected`;
2. strukturel fejl → afvist (koden);
3. checksum eller størrelse ≠ versionens → afvist `checksum_mismatch`;
4. scannerfejl → teknisk scanfejl (koden);
5. scanner er hverken ClamAV eller en tilladt udviklingsscanner → `scanner_not_allowed`;
6. signaturtid ukendt, i fremtiden eller ældre end politikkens maksimum (24 t) →
   `stale_signatures`;
7. målt under en anden politik → `policy_outdated`;
8. PDF-fejl → afvist (koden);
9. aktivt indhold → afvist `active_content` (`embedded_file`, hvis fundet kun er filer);
10. noget ikke kørt → `inspection_incomplete`;
11. ellers `safe`.

**Checksum-binding:** scannede bytes X → verdict for X → frigivelsen flytter X og bekræftes
med checksummen af de flyttede bytes → behandlingen henter X og spørger gaten med checksummen
af de hentede bytes.

- Andre bytes ved frigivelsen: funktionen skriver intet, databasen afløser verdict
  (`checksum_changed`), versionen går tilbage i karantæne, og scan-jobbet scanner igen.
- Andre bytes ved behandlingen: gaten afviser (`bytes_changed`) før parsing, verdict afløses,
  versionen går i karantæne, og en ny scanning sættes i kø.

**Release-gaten** (`security_block_reason` via `worker_security_clearance`, `gate.ts`):
versionen er `released`; verdict findes, hører til versionen, er `safe`, ikke afløst, frigivet,
under den aktive politik og med alle dele bestået; verdict-checksum = versionens checksum (=
de hentede bytes); sti = versionens sti i `knowledge-originals`. Gaten spørges før download og
igen med bytes før første parserkald. Der findes ingen miljøvariabel, Admin-indstilling eller
almindelig opdatering, der åbner den. Claim annullerer behandlings- og re-embedding-jobs for
ufrigivne versioner (`security_not_released`).

**Absolut regel, bevist statisk:** scan-jobbets importgraf og inspektionsbarnet når hverken
pdfjs, chunkeren, normalisering, strukturering eller embedderne (arkitekturtest). Efter
frigivelsen krydstjekker udtrækket desuden pdfjs' eget syn (JS-handlinger, vedhæftninger,
open action, XFA, annotationer) mod samme politik (`parser-crosscheck.ts`) og stopper jobbet
før chunking, hvis to læsere ser forskelligt.

**Politikversion:** verdicts bærer `policy_version`. En ny politik gør ældre verdicts
forældede for gaten (`policy_outdated`). Der er ingen automatisk genscanning af korpus i I5.

**ClamAV-arkitektur:** I I5 var ClamAV en sidecar i worker-tasken. Det er erstattet i 8B-I5.5
af en separat ECS-service uden taskrolle og uden internetadgang, med signaturer bygget ind i
imaget af en planlagt pipeline (§21.7, B-027).

**Fejltilstande:**

| Situation | Resultat |
|-----------|----------|
| clamd utilgængelig, timeout, `ERROR`, ukendt svar, for langt svar | Teknisk scanfejl; genforsøg med backoff; aldrig frigivet |
| Signaturer ukendte eller ældre end 24 t | Teknisk scanfejl (`signature_unknown`/`stale_signatures`) |
| Inspektionen timer ud, crasher eller svarer ulæseligt | `inspection_timeout`/`inspection_failed` → afvist (fail closed) |
| Flytningen fejler eller bekræftes ikke | Genforsøg; kilden slettes først efter bekræftelse |
| Udtømte forsøg | Versionen `processing_failed`, sikkerhed `scan_failed`; genbehandling scanner igen |

**Admin-statusser** (`SECURITY_STATUS`, kun kategori og kode fra `version_security_status` —
aldrig filen eller fundets detaljer): **I karantæne**, **Scanner**, **Godkendt
sikkerhedskontrol**, **Afvist: ugyldig PDF**, **Afvist: aktivt indhold**, **Afvist: malware**,
**Teknisk scanfejl**. Versioner fra før I5 vises som "Ikke sikkerhedsscannet". "Genbehandl"
vises ikke for en afvist fil.

**Kontrolleret genscanning:** `knowledge.request_security_rescan` (kræver
`system.settings.manage`, server-side): kun for `uploaded`/`processing_failed` uden aktivt job.
Alle verdicts afløses (`rescan_requested`), frigivelsen ophæves (karantæne), et scan-job sættes
i kø, og det auditeres. Ingen UI-knap i I5.

**Lokal udvikling:** samme gate og samme database. Uden `IPA_CLAMD_HOST` bruges
udviklingsscanneren (`development-fixture`), som kun kan oprettes lokalt/i test og kun
accepteres, når det lokale seed har indsat rækken i `security_development_scanners`. I
produktion er tabellen tom, og `ops.ingestion_worker_status()` melder en række som
overtrædelse.

**Tests:**

- **pgTAP** `upload_security.test.sql` (115): buckets og politikker, rettigheder, tilstandsmaskinen,
  spoofet `safe` fra klient, `service_role` og ejer, afledningen (malware, scannerfejl, forældede
  og ukendte signaturer, ukendt scanner, udviklingsscanner uden seed, politik, ufuldstændig
  inspektion, aktivt indhold, indlejrede filer, kryptering, polyglot, checksum), strengt input,
  frigivelse med checksum, parallel flytning, genbrug af bekræftelse, verdict-replay på tværs af
  versioner, gammelt verdict på ny fil, anden sti, politikskifte, bytes ændret efter frigivelse,
  re-embedding-omgåelse, genscanning og Admin-adgang. De eksisterende pgTAP-filer frigiver nu
  deres fixtures med en sessionslokal hjælper.
- **Enhedstests:** `worker-security-pdf.test.ts` (47) med syntetiske fixtures,
  `worker-security-scan.test.ts` (37) med en falsk clamd over TCP, `worker-gate.test.ts` (6) og
  opdaterede arkitekturtests (scanstiens importgraf, ingen midlertidige filer, ingen
  udviklingsgenvej i gaten, ClamAV-sidecaren).
- **Integration** `upload-security.integration.test.ts` (7): hele flowet med den rigtige
  worker; afvisning af aktivt indhold, indlejrede filer, kryptering, polyglot, ikke-PDF og forkert
  endelse; bytes byttet før scanning og efter frigivelse; klientforsøg på at frigive; **ClamAV med
  EICAR** (fundet og sat i karantæne) og ukendte signaturer og nedlagt clamd (aldrig frigivet).
- **Mutationer:** 34/34 fanget — 12 i SQL (verdict-checksum, hentede bytes, politikversion,
  verdict tilhører versionen, malware vinder, forældede signaturer, scanner-allowlist, aktivt
  indhold, politik ved afledning, checksum ved flytning, ejerkravet og `processed` kræver
  `released`) og 22 i TypeScript (gatens eksplicitte pass og egen checksum, gaten før og efter
  download, scanner fail-closed ved ukendt svar og timeout, forældede signaturer, inspektion kun
  af rene filer, checksum, JavaScript, OpenAction, indlejrede filer, `#xx`-navne, objektstrømme,
  kryptering, krydsreferencer, inspektionstimeout, clamd kun på loopback, lagerfunktionen skriver
  aldrig andre bytes og sletter kun efter bekræftelse, udviklingsscanneren kun lokalt og
  ugyldiggjort frigivelse). JavaScript-mutationen overlevede første kørsel; der er tilføjet
  fixtures med en bar `/JS` og et utypet navnetræ.

**Afvigelser og realiseringsvalg** (B-026):

- Rækkefølgen i §7.1 er realiseret som byteniveau-validering → ClamAV → strukturinspektion.
  §7.1 nr. 5 ("parseren kan åbne filen") udføres af inspektionens egen læser — ikke pdfjs — for
  at overholde reglen om, at ingen bytes når pdfjs før `safe`. pdfjs' syn krydstjekkes efter
  frigivelsen.
- Brugerteksterne i §7.3 er erstattet af de syv Admin-statusser, du angav for I5.
- Afviste filer flyttes til `knowledge-quarantine` uanset årsag (ikke kun malware).
- Inspektionstimeout og ressourcegrænser giver afvisning (ikke genforsøg).
- ClamAV som sidecar delte taskrollen. Løst i 8B-I5.5 (§21.7).

**Ikke implementeret:** andre formater, OCR, P1–P9, registret og `evaluation_publisher`,
aktivering af production-retrieval, 8C, en rigtig Copilot-model, Learn/Practice/Advise,
automatisk korpusgenscanning, UI til genscanning og rigtige cloud-ressourcer (ECR, VPC,
NAT/EIP).

### 21.7 8B-I5.5 — Scanner-isolation og signaturforsyning

I5 er funktionelt godkendt (B-026). I5.5 lukker de to åbne punkter: ClamAV delte workerens
taskrolle, og signaturforsyningen var ikke fastlagt (B-027).

**Arkitektur:**

```
ipa-ingestion-worker (ECS-service)            ipa-clamav (ECS-service, egne private subnets)
  taskrolle: Embed v4 (forberedt)               INGEN taskrolle
  SG: udgående 443, 6543 og ─── TCP 3310 ───►   SG: indgående KUN fra workerens SG på 3310
      3310 kun til ClamAV-SG                         udgående KUN 443 til VPC-endpoints (ECR, logs, S3)
  clamav.ipa-worker.internal:3310  ◄── Cloud Map (privat DNS, A-record, TTL 10 s, kun sunde tasks)
```

- `deploy/clamav/`: `task-definition.json`, `service.json`, `service-discovery.json`,
  `security-group.json`, `iam/` (execution-rolle, CI-publisher), `alarms.json`, `Dockerfile`,
  `clamd.conf`. Workerens task har nu kun worker-containeren.
- ClamAV-tasken: ingen taskrolle, ingen secrets, intet miljø, ikke-root (10001), skrivebeskyttet
  rodfilsystem, `capabilities drop ALL`, kun `/tmp`, ingen offentlig IP, ingen ECS Exec. Imaget
  refereres med digest.
- **Execution-rolle vs. taskrolle:**
  - *Execution-rollen* bruges af ECS selv (Fargate-agenten) til at starte tasken: hente imaget
    og skrive logs. Containerens processer kan ikke få dens credentials. `ipa-clamav-execution`
    kan kun hente `ipa-clamav`-imaget og skrive til `/ipa/clamav`.
  - *Taskrollen* er de credentials, processerne i containeren får. ClamAV har ingen, så clamd
    kan hverken kalde Bedrock eller nogen anden AWS-tjeneste. Workerens taskrolle (Embed v4)
    gælder kun worker-tasken.
- **Netværk:** ClamAV-SG accepterer kun TCP 3310 fra workerens SG — aldrig en CIDR, VPC'en
  eller internettet. Udgående kun HTTPS til VPC-endpoints (ECR api/dkr, CloudWatch Logs og
  S3-gateway), som ECS skal bruge til imaget og logs. Ingen 0.0.0.0/0 og ingen NAT.
- **Service discovery:** Cloud Map (ECS service discovery) med privat DNS
  `clamav.ipa-worker.internal`.
  - *Valgt*, fordi den kræver ingen ekstra container eller load balancer, og ECS registrerer
    kun sunde tasks.
  - *ECS Service Connect* er fravalgt, fordi den indsætter en proxy-container i både worker- og
    ClamAV-tasken.
  - *En intern NLB* er fravalgt, fordi den koster mere og giver flere dele uden ny sikkerhed.
- **Workeren** scanner i produktion kun gennem `PRODUCTION_SCANNER`
  (`clamav.ipa-worker.internal:3310`). Endpointet er fastlagt i koden og i taskdefinitionen.
  Enhver anden vært eller port afvises ved start. Lokalt og i test kan en lokal clamd bruges.
- **Fail closed:** DNS uden svar (også midlertidigt), afvist forbindelse, ingen rute, nulstillet
  forbindelse, timeout, et ugyldigt svar eller en usund tjeneste (afregistreret i Cloud Map) giver
  teknisk scanfejl. Der er da intet `safe`, ingen frigivelse og ingen parser.

**Signaturforsyning** (`.github/workflows/clamav-signatures.yml`):

```
hver 6. time (cron) → docker build (den godkendte engine fra deploy/clamav/engine.json — §21.8 —, officielle signaturer via freshclam ved byggetid)
→ start kandidaten skrivebeskyttet og uprivilegeret
→ scripts/verify-clamav-scanner.ts: engine = den godkendte, signaturversion og -tid kendt, ikke i
  fremtiden, højst 8 t gamle; EICAR findes; en ren fil er ren
→ push til ECR med uforanderligt tag = scanner-revision (ipa-clamav:<engine>-<signaturversion>)
→ ny taskrevision med image-digest → update-service → vent på stabil, kræv COMPLETED
```

- Seks timer frem for tolv: en mislykket kørsel efterlader stadig en frisk scanner inden for 24
  timer (byggealder ≤ 8 t + 6 t + 6 t = 20 t).
- Containeren henter intet ved kørsel. Der bruges ingen tredjepartssignaturer.
- CI'en logger ind med GitHub OIDC uden lagrede credentials, i en rolle, der kun kan pushe
  `ipa-clamav`, opdatere servicen `ipa-clamav` og videregive dens execution-rolle.
- Workflowet er inaktivt, indtil repository-variablen `IPA_AWS_ACCOUNT_ID` er sat.

**Hvis opdateringen fejler:**

1. **Bygning eller verifikation fejler:** intet pushes eller udrulles, og workflowfejlen er
   alarmen.
2. **Udrulningen fejler:** ECS beholder den kørende scanner (minimumHealthyPercent 100), og
   circuit breakeren ruller tilbage. EventBridge-reglen `SERVICE_DEPLOYMENT_FAILED` alarmerer.
3. **Signaturerne ældes:** alarmen `ipa-scanner-signatures-ageing` udløses over 18 timer, og
   `ipa-scanner-technical-failures` udløses ved tekniske scanfejl.
4. **Ved 24 timer:** den gamle scanner bliver ubrugelig af sig selv. Workeren og databasen
   udsteder intet nyt `safe`, og filerne venter som "Teknisk scanfejl".
5. **Når en frisk revision kører:** genforsøgene frigiver filerne.

Der findes intet flag, der ignorerer forældede signaturer.

**Scanner-identitet i verdict:**

- `scanner_engine`, `scanner_version` (engine), `signature_version` og `signature_time` som i I5.
- Ny genereret kolonne `scanner_revision` = `ipa-clamav:<engine>-<signaturversion>`. Den er lig
  med det uforanderlige ECR-tag, og ECR giver digest og byggeregistrering
  (`/usr/share/ipa/scanner-build.txt` i imaget).
- Kolonnen afledes og kan ikke sættes. Verdict er fortsat uforanderligt.
- Workerens log ved hvert verdict har engine, signaturversion og signaturalder. Ingen
  dokumentbytes.

**Tests:**

- `scanner-isolation.test.ts` (16): ClamAV er ikke i worker-tasken; ingen taskrolle, intet
  Bedrock og ingen secrets; execution-rollen kun ECR og logs; non-root, skrivebeskyttet, ingen
  offentlig IP og ingen ECS Exec; SG kun fra workerens SG på 3310 og ingen internet-egress;
  Cloud Map-navnet = workerens faste endpoint; workflowets rækkefølge, plan og OIDC; CI-rollens
  rækkevidde; pinned version og kun officielle signaturer; alarmer; intet "ignorér
  forældede"-flag.
- Samme fil, adfærd mod en scannertjeneste over TCP: DNS uden svar giver ikke `clean`; en gammel
  scanner virker ved 23,5 t og er ubrugelig ved 24,5 t; en frisk revision genopretter;
  byggeverifikationen afviser forældede, ukendte og fremtidige datoer, ikke-pinned engine, en
  "blind" scanner og nedlagt tjeneste.
- `worker-runtime.test.ts`: produktion accepterer kun det faste endpoint.
- `worker-runtime-architecture.test.ts`: worker-tasken har én container og 3310 kun mod
  ClamAV-SG.
- pgTAP `upload_security` (117): scanner-revisionen afledes og kan ikke sættes.
- Integration: workeren scanner gennem en privat tjeneste mod den rigtige database. Frisk
  revision frigiver med `scanner_revision`; forældet giver `stale_signatures` og intet job;
  udskiftning frigiver ved genforsøg; nedlagt tjeneste giver `scanner_unavailable`. Desuden
  rigtig clamd med EICAR.

**Afvigelser og realiseringsvalg** (B-027):

- §7.2 anbefalede "ClamAV som sidecar i worker-tasken". Efter din beslutning er det realiseret
  som en separat service. Begrundelsen og reglerne i §7.2 (fail-closed, karantæne,
  24-timersgrænse) er uændrede.
- Repoet havde ingen CI. Workflowet er projektets første GitHub Actions-workflow og gør kun
  dette ene.
- Byggegrænsen er 8 timer (strammere end 24), så den enkelte revision har margin.

**Deploymentforudsætninger** (kræver produktionskontoen): ECR-repositoriet `ipa-clamav`, VPC,
private subnets til scanneren, VPC-endpoints, Cloud Map-namespace, rollerne
`ipa-clamav-execution` og `ipa-clamav-publisher` med GitHub OIDC-provider, alarmtopic (Å-5),
VPC/NAT/EIP til workeren.

### 21.8 8B-I5.6 — ClamAV-patchversion

Production-scanneren kørte på ClamAV 1.4.3. Den er opdateret til **ClamAV 1.4.6**, den nyere
security patch i den valgte **1.4 LTS-linje**, med rettelser af blandt andet parser- og
memory-safety-fejl i ældre 1.4.x (B-028). Scanneren læser fjendtlige filer, så en kendt ældre
security patch må ikke køre.

**Én versionsstyret kilde:** `deploy/clamav/engine.json` (`lts_line` 1.4, `production` 1.4.6,
`approved`, `base_image` og dens godkendte `base_image_digest`).

- Dockerfilens `CLAMAV_BASE` peger på samme release.
- Verifikationsscriptet forventer `production`.
- Databasen har tabellen `knowledge.security_approved_scanner_engines`. Kun en migration kan
  ændre den; klient, worker og service_role har ingen rettigheder.

**Guardrail i databasen:** `worker_record_security_verdict` giver kun `safe` for en ClamAV-engine
med en godkendt, ikke tilbagetrukket række. Alt andet bliver teknisk scanfejl
`engine_not_approved`:

- den ældre 1.4.3;
- en nyere, endnu ikke godkendt patch som 1.4.7;
- en engine, der er trukket tilbage.

Domænemodellen er uændret: en ny godkendt patch er en ny række.

**Engine og signaturer håndteres hver for sig:**

| | A. Signaturopdatering | B. Engine-opgradering |
|---|---|---|
| Workflow | `clamav-signatures.yml` | `clamav-engine-candidate.yml` |
| Udløses | Automatisk hver 6. time | Manuelt, med en version i 1.4-linjen |
| Engine | Fast. Læses fra `engine.json`, bygges fra base-imaget med det godkendte digest, og verifikationen fejler ved enhver anden version | Kandidatens version |
| Gates | Frisk signatur, EICAR og ren fil | Scanner-tjek, EICAR, ren fil og PDF-/sikkerhedsfixtures (`clamav-candidate.test.ts` mod den kørende kandidat plus scanner-suiterne) |
| Resultat | Udrullet scanner med ny signatur-revision | Kandidat-image i ECR og base-digest til godkendelse. **Udruller aldrig** |

**Patch-politik:**

1. En ny 1.4.x security- eller patch-release opdages og reviewes.
2. Den bygges som kandidat (B).
3. Kandidaten består scanner-tests, EICAR-test, clean-file-test og PDF-/sikkerhedsfixtures.
4. Kandidatens base-digest godkendes, og ændringen bliver en reviewet ændring af `engine.json`,
   Dockerfilens default og en migrationsrække.
5. Først derefter bygger og udruller A den nye engine.

Den ældre version trækkes tilbage (`revoked_at`), når den nye kører. Intet er hardkodet som
"sidste version", og der findes ingen automatisk opgradering.

**Scanner-revision:** `scanner_revision` binder fortsat engine og signaturversion
(`ipa-clamav:1.4.6-<signaturversion>`). Udrulning sker stadig med det uforanderlige image-digest.

**Tests:**

- `scanner-isolation.test.ts`: én kilde; image, database og verifikation enige; refresh kan ikke
  ændre engine (ingen versionslitteral, digest påkrævet); kandidat-workflowet er manuelt, kun for
  LTS-linjen, kører alle gates og udruller aldrig; verifikationen afviser 1.4.3.
- pgTAP `upload_security` (122): 1.4.6 er den eneste godkendte engine; 1.4.3, 1.4.7 og en
  tilbagetrukket engine giver `engine_not_approved`; ingen klient eller worker kan godkende en
  engine.
- Integration: en scannertjeneste på 1.4.3 med friske signaturer frigiver aldrig.
- `clamav-candidate.test.ts` er kørt mod den lokale rigtige clamd.

**Base-digest:** det officielle `clamav/clamav:1.4.6_base` (indeks-digest
`sha256:90effb79…`) blev slået op i registret 2026-10-06. Kandidat-workflowet (B) køres mod
1.4.6, før den første production-bygning udrulles. Det kræver kontoen (deploymentforudsætning).

### 21.9 8B-I6 — Register over retrieval-konfigurationer og ProductionEvidenceSet

**Leveret (B-029):** migrationen `20261007000100_retrieval_configuration_registry.sql`, evidensmodellen
schemaVersion 2 med P1–P9 og publisheren i `evals/engine/publication.ts`.

**Registret (§10.1):**

- `knowledge.retrieval_configurations`. Det fingeraftrykte materiale (`material`) er den eneste
  definerende kilde. Embedding-udbyder, model, versionsetiket, dimension, indstillinger og
  behandlingsprofil, reranker-id og -version, algoritmeversion, parametre og de tilladte
  chunker-versioner er genererede kolonner af materialet og kan derfor ikke afvige. Desuden:
  `label` og `version`, `embedding_model_id`, status, godkendelsens kørsel, gate-sæt og tier,
  samt tidspunkter og aktører for oprettelse, godkendelse, aktivering, suspendering og udfasning.
- `knowledge.evaluation_runs`: append-only. Gemmer rapport-, resultat-, sæt- og
  gate-sæt-checksum, erklæret og runtime-fingeraftryk, korpus-checksum, de evaluerede
  dokumenttyper, rapportformat (`report_schema`) og motorversion, metrics, hårde og
  kvalitetsgates, minimum pr. type, tier, afgørelse, gyldighed og hele rapporten.
- `knowledge.evaluation_gate_sets`: registreres af publisheren, godkendes af et menneske og
  ændres aldrig.
- `knowledge.retrieval_configuration_transitions`: append-only statushistorik med aktør, kørsel,
  begrundelse og årsagsnoter.
- Ingen app-rolle, administrator eller service_role har skriverettigheder. Triggere kræver
  funktionernes markering, holder materialet uforanderligt, håndhæver tilstandsmaskinen og
  forbyder sletning og tømning, også for ejeren.

**Tilstandsmaskine:** candidate → approved → active → suspended/retired; suspended → retired;
suspended og retired → approved (kun med en ny bestået kørsel, registreret efter statusskiftet).
Et partielt unikt indeks tillader højst én konfiguration i drift (active eller suspended).
Aktivering sker under en advisory lock i én transaktion, med modelskifte ved behov (§2.5) og
udfasning af den hidtidige konfiguration.

**evaluation_publisher (D-18):** gruppen `evaluation_publisher` (NOLOGIN, kun EXECUTE på
`record_evaluation_run` og `register_evaluation_gate_set`) og login-rollen
`evaluation_publisher_login` (oprettes NOLOGIN uden password; `ops.evaluation_publisher_prepare`,
`_deactivate`, `_status`, `_set_api`).

`record_evaluation_run` genberegner i SQL og afviser alt, der ikke stemmer:
- rapportens og resultaternes checksum (kanonisk JSON identisk med TypeScript);
- begge fingeraftryk fra materialet;
- metrics fra observationerne, Wilson-intervaller, H1–H7, Q1–Q7 mod det godkendte gate-sæt,
  minimum pr. type, tier og afgørelse;
- formatet (`reportSchema` 3, fra I6.1 4), `production.eligible = false`, H7, test-embedder eller `none` og en
  ukendt embedding-model.

Konfigurationen oprettes som kandidat. En fejlet hård gate for den aktive konfiguration
suspenderer den i samme transaktion (D-8).

**Menneskelige beslutninger (system.settings.manage):** `approve_evaluation_gate_set`,
`approve_retrieval_configuration`, `activate_retrieval_configuration`,
`suspend_retrieval_configuration` og `retire_retrieval_configuration`.

Godkendelse og aktivering efterprøver:
- kørslen tilhører netop konfigurationen og er dens seneste;
- fingeraftrykket er identisk;
- hårde gates og kvalitetsgates er bestået, minimum pr. type er opfyldt, og afgørelsen er
  `pass`;
- miljøet er evalueringsmiljøet, og gate-sættet er godkendt;
- udbyderne er ikke udviklingsimplementeringer, og modellen findes;
- der er en årsagsnote (mindst 10 tegn) for hver fejl i rapporten;
- scope og chunker-versioner (se nedenfor).

Ingen ny permission er indført. `activate_embedding_model` kræver nu en godkendt konfiguration
for modellen (§2.7).

**P1–P9 (§9)** afgøres i `src/lib/knowledge/core/production-conditions.ts` ved hvert
`issueEvidenceSet`. Graden er aldrig et input.

| | Afgøres af |
|---|---|
| P1 | Embedderen er en rigtig production-implementering (runtime-bevis: kun Bedrock-adapterne registrerer sig), dens beskrivelse er den aktive model, og den aktive model er konfigurationens |
| P2 | Rerankeren er en rigtig production-implementering, ikke `none`, og er konfigurationens |
| P3 | `knowledge.retrieval_context()`: status `active`, præcis én aktiv, bestået registreret kørsel, godkendt gate-sæt, modellen og de evaluerede dokumenttyper |
| P4 | Runtime-fingeraftrykket beregnes fra de konstruerede implementeringers beskrivelser, kodens algoritmeversion og de faktisk brugte parametre (inkl. et topK fra requesten). Det skal være identisk med konfigurationens |
| P5 | Hvert element er publiceret, ikke tilbagetrukket, gyldigt på datoen og for tilstanden, og der er én version pr. dokument |
| P6 | Konteksten læses med samme klient som søgningen, og databasen melder rollen `authenticated` og en bruger |
| P7 | Hvert elements `chunkerVersion` (fra `search_chunks`/`evidence_chunks`) er blandt konfigurationens |
| P8 | Ingen `devOverride`. Sættet er udstedt og frosset |
| P9 | `retrieval.configuration = { id, fingerprint, algorithmVersion }`, schemaVersion 2, og algoritmeversionen er kodens |

- Et tjek, der ikke kan afgøres, er falsk.
- `requireProductionEvidence` kræver den registrerede vurdering (WeakMap) med alle ni opfyldt og
  efterprøver P2, P7, P8 og P9 på sættet.
- Konteksten læses efter søgningen, så en suspendering eller udskiftning undervejs kun kan sænke
  graden.

**Udbydere:** `providers/configured.ts` vælger implementeringerne ud fra konfigurationen i drift.

- En kandidat eller en godkendt, men ikke aktiv konfiguration vælger aldrig en udbyder.
- En suspenderet konfiguration beholder sine udbydere uden fallback. Evidensen bliver
  `development`, og retrieval kører videre.
- Uden konfiguration bruges det fail-closed register som før. `IPA_RERANKER` kan ikke vælge
  Bedrock.

Admin viser konfigurationen og årsagen, når production-evidens er utilgængelig ("Konfigurationen
er ikke godkendt", suspenderet). Indhold uden for det godkendte område vises fra I6.1 (§21.10).

**Udledt (fortolkninger, godkendt i B-030):**

1. **Scope for godkendelsen (pilot-regel 5, §9).** *Erstattet i 8B-I6.1 (§21.10):* scope er nu
   par af produkt og dokumenttype for pilot og håndhæves pr. element i P3 i stedet for ved
   aktiveringen. I I6 bar rapporten (`reportSchema` 3) kun dokumenttyperne, og et korpus med en
   anden dokumenttype blokerede aktiveringen.
2. **H6 bedømmer implementeringerne, ikke P1–P9-graden.** En konfiguration under evaluering er
   per definition ikke aktiv, så dens evidens kan aldrig opfylde P3. I1's H6-tjek af det samlede
   sæts grad er erstattet af tjek af implementeringernes grad, `devOverride`, model, reranker,
   fingeraftryk og chunker-version. Det svarer til H6's tekst i §4.4.
3. **H6 og H7 ved registrering.** H7 afvises altid. H6 kan kun registreres for den aktive
   konfiguration (som regression, der suspenderer).
4. **Genaktivering** af en suspenderet eller udfaset konfiguration kræver en ny bestået kørsel,
   registreret efter statusskiftet, og en ny godkendelse.
5. **Chunker-versioner i P4:** retrieval chunker ikke selv. Runtime-materialet bruger derfor
   konfigurationens chunker-sæt, og beviset pr. element er P7 (§9 nævner chunker under P7, ikke
   P4).
6. **Den evaluerede kørsel skal være konfigurationens seneste**, så en nyere kørsel ikke kan
   springes over. Der er ingen tidsbaseret forældelse; specifikationen har ingen.

**Åbent spørgsmål før baseline (§20 trin 5) — afgjort i B-030 (§21.10):**
- Med de låste tærskler (gates-v1) og Wilson-reglen er en pilot på 30–50 spørgsmål altid
  `uncertain` på Q1, også ved 100 %. 35 af 35 giver et nedre interval på 0,901, under 0,95.
- Fordi `uncertain` ikke er `pass`, kan en pilot på den størrelse ikke godkendes. Det kræver
  mindst ca. 73 besvarbare spørgsmål. Den beståede fixture-rapport har 99 spørgsmål (83
  besvarbare, 16 afvisende).
- Mulige veje var et større pilotsæt eller en eksplicit beslutning om, hvordan `uncertain`
  håndteres for en pilot. Den sidste blev valgt i B-030.

**Tests:**

| Lag | Hvad |
|---|---|
| pgTAP | `retrieval_configuration_registry` (117): roller og mindste rettigheder, TypeScript/SQL-lighed, gate-sæt, genberegning og afvisninger, direkte skrivning, godkendelse, aktivering med modelskifte og scope, udskiftning, suspendering, genaktivering, chunker, I5-invarianten |
| Enhed | `production-evidence` (47): positiv end-to-end-fixture og negativer for hver af P1–P9 samt adversarielle tilfælde. `evaluation-publisher` (14). Opdaterede guardrail-tests |
| Integration | `retrieval-configuration` (12) mod den lokale database. Publisheren logger ind med egen rolle. Bruger, administrator og service_role kan ikke publicere. Usikker kørsel og manglende årsagsnoter afvises. Godkendelse og aktivering, P1–P9 end to end som indlogget bruger, P4 og P6 negativt, samtidige aktiveringer, suspendering og regression-suspendering samt audit uden dokumenttekst |
| Mutation | 39/39 fanget: 18 i TypeScript, 19 i SQL og 2 via integration |

**Housekeeping:** testkørsler sætter `IPA_RUNTIME_ENV=test` eksplicit i begge Vitest-konfigurationer.
En test, der kræver et andet eller manglende miljø, sætter det selv (`fixtures/runtime-env.ts`).

**Ikke implementeret (bevidst):**
- I7: evalueringsdrift, observability og regression (defineret i §21.10). Rate limiting hører
  til 8C, ikke I7.
- 8C og en rigtig Copilot-model.
- Lagring af EvidenceSet pr. svar.

Publiceringens CI-transport er heller ikke koblet på. Kontrakten og `sqlPublisherConnection`
findes, men `postgres` må kun bruges i `workers/` (D-19), og evalueringsmiljøet er §20 trin 4.

**Ingen rigtig konfiguration er aktiveret:** ingen AWS, ingen Bedrock og ingen
produktionsdatabase. Testene opretter en production-grad fixture-konfiguration, som altid ruller
tilbage eller bliver udfaset.

**Fortsat åbne forudsætninger:** AWS-konto og -ressourcer, VPC/NAT/EIP, kandidatkørsel af ClamAV
1.4.6, Å-1 (kvoter), Å-2 (databehandleraftaler), et rigtigt pilotsæt (30–50 spørgsmål, B-030)
samt Å-3 til Å-6.


### 21.10 8B-I6.1 — Pilot-politik, pilot-scope og definitionen af 8B-I7

**Leveret (B-030):**
- migrationen `20261007000200_pilot_evaluation_policy.sql`;
- rapportformat `reportSchema` 4 med `corpus.scope` (`evals/engine/runner.ts`);
- scope-tjekket pr. element i P3 (`production-conditions.ts`);
- visningen i Admin.

**Udfaldet af en kørsel** (`evaluation_runs.outcome`) er en genereret kolonne. Den afledes af den
genberegnede afgørelse og kan ikke sættes:

| Udfald | Hvornår | Kan bære en godkendelse |
|---|---|---|
| `pass` | Alle hårde gates og kvalitetsgates bestået med sikre intervaller, minimum opfyldt | Ja |
| `pass_with_uncertainty` | Tier pilot: alle gates bestået på punktestimatet, mindst ét interval usikkert | Kun efter menneskelig accept |
| `insufficient_certainty` | Tier standard: samme situation | Nej. Q1 forbliver 0,95, og der er ingen manuel vej |
| `fail` | Et hårdt brud, en fejlet kvalitetsgate, manglende minimum eller en ugyldig kørsel | Nej. H1–H7 kan aldrig accepteres |

- De usikre gates gemmes på kørslen (`uncertain_gates`). Wilson-intervallerne gemmes fortsat i
  metrics.
- `knowledge.evaluation_run_approvable(run)` er den ene regel, som godkendelse,
  skrivetriggeren og retrieval-konteksten bruger.

**Menneskelig accept:** `knowledge.accept_evaluation_uncertainty(run, begrundelse)`.
- Kræver `system.settings.manage` og en begrundelse på 20–2.000 tegn.
- Virker kun for `pass_with_uncertainty` og kun én gang pr. kørsel.
- Tabellen `knowledge.evaluation_uncertainty_acceptances` gemmer:
  - kørsel og konfiguration;
  - tier;
  - det evaluerede område;
  - de usikre gates med metric, sammenligning, tærskel, værdi og interval;
  - begrundelsen;
  - hvem og hvornår.
- Tabellen er append-only, også for ejeren, og kan ikke tømmes. Accepten auditeres
  (`knowledge.evaluation_run.uncertainty_accepted`).
- Accepten gør kun kørslen godkendelsesbar. Godkendelse og aktivering er fortsat to særskilte
  menneskelige handlinger.
- Exit-kriterium 3 (§17) læses for en pilot sådan, at kvalitetsgates er bestået på
  punktestimatet, og at usikkerheden er accepteret.

**Pilot-scope:**
- Rapporten bærer `corpus.scope`: de unikke par `{ product, documentType }` fra
  evalueringskorpusset. Produktet angives ved sit eksakte, unikke navn.
- `record_evaluation_run` afviser et tomt område, et navn med omgivende mellemrum, en ukendt
  dokumenttype og dubletter. Den afviser også dokumenttyper, der ikke svarer til området.
- Området gemmes på kørslen (`evaluated_scope`).
- P3 kræver, at **hvert** element ligger inden for det godkendte område:
  - for pilot: elementets produktnavn og dokumenttype er et evalueret par;
  - for standard: dokumenttypen er evalueret (§9).

  Ét element udenfor gør hele sættet `development`, også når det kommer med som modpart i en
  konflikt.
- En produktfamilie, der aldrig er evalueret, arver derfor aldrig pilot-godkendelsen. Det samme
  gælder et omdøbt produkt (fail-closed).
- Der bindes ikke til chunk-id'er.
- Aktiveringen afvises ikke længere på grund af indhold uden for området (ændret fra §21.9
  fortolkning 1). Konteksten viser det i `scopeGaps`, og Admin viser "Uden for det godkendte
  område (giver aldrig produktionsevidens)".

**Tidlig Copilot-pilot og miljøer (B-030):**
- Den kontrollerede Copilot-pilot kommer efter 8C og er ikke masterfase 18. Den bruger kun:
  - godkendt pilot-scope;
  - godkendte dokumenter;
  - navngivne autoriserede brugere;
  - tæt monitorering;
  - guardrails fra 8B og 8C.
- Et isoleret, hostet pilot-/staging-miljø må etableres før masterfase 21. Det er en
  forudsætning for den kontrollerede pilot og for masterfase 18. Masterfase 21 er den endelige
  produktion og go-live.
- Roadmappen 1–21 er uændret.

**Tests:**

| Lag | Hvad |
|---|---|
| pgTAP | `retrieval_configuration_registry` (148). Udfald, usikre gates og intervaller. Accept med rettigheder, begrundelse, én gang, append-only og audit. Godkendelse og aktivering efter accept. Direkte skrivning afvist uden accept. Konteksten falder uden accept. Standard-usikkerhed og hårde brud kan ikke accepteres. Validering af området. Scope-huller som produkt/type |
| Enhed | `production-evidence` (54): accept/ikke-accept, standard, nyt produkt, anden dokumenttype, inden for området, standard på tværs af produkter, tomt område og ingen tier. `evaluation-publisher` (15): område mangler eller passer ikke, og fixtures uden drift mod pgTAP |
| Integration | `retrieval-configuration` (14): accept → godkendelse → aktivering. Standard-usikkerhed afvist. Et uevalueret produkt med samme dokumenttype giver `unmet: ["P3"]`, alene og blandet; det evaluerede produkt forbliver production |
| Mutation | 60/60 fanget: 26 i TypeScript, 32 i SQL og 2 via integration |

**Ikke implementeret (bevidst):**
- I7 (nedenfor);
- 8C, rate limiting, samtalehistorik og en rigtig LLM;
- Learn, Practice og Advise;
- en Admin-knap til accept.

Godkendelse sker også i I6 via databasefunktionerne.

#### 8B-I7 — Evaluation Operations, Monitoring & Regression Guardrails (definition, ikke påbegyndt)

Defineret i B-030. Påbegyndes kun efter din eksplicitte godkendelse. Uden for I7: rate limiting,
samtalelagring og retention (8C) samt enterprise-dashboards.

1. **Evalueringsdrift (§20 trin 4):**
   - et separat evalueringsmiljø;
   - sikker transport fra I1-motoren til `evaluation_publisher` (`evaluation_publisher_login`
     med en kortlivet credential fra secret-håndteringen), uden almindelige
     applikationscredentials;
   - reproducerbare baseline- og regressionskørsler: samme sæt, gate-sæt, konfiguration og
     korpus-checksum;
   - versionerede rapporter med checksums;
   - manuel og planlagt regression.
2. **Regressionskontrol (§10.2, D-8):**
   - En regression med et hårdt gate-brud suspenderer automatisk, uden fallback. Mekanismen i
     `record_evaluation_run` findes allerede.
   - En kvalitetsregression giver alarm og vurdering.
   - Hændelsen indeholder evalueringssæt (id, version, checksum), gate-sæt (id, version,
     checksum) og runtime-fingeraftrykket.
3. **Observability (§14), mindst:**
   - retrieval-latency pr. trin;
   - fejl hos udbyder, embedding, reranking, retrieval, ingestion og scanner;
   - kø- og job-sundhed;
   - den aktive konfiguration og suspenderingsstatus;
   - evaluerings- og regressionsstatus;
   - performance-metrics.
4. **Alarmer (D-15):** `AlertSink` implementeres med `log` og én enkel første kanal. Valget af
   kanal og modtager (Å-5) forbliver en deploymentbeslutning.
5. **Målbare performance-exit-kriterier (§12, §17 pkt. 10):**
   - p50 og p95 måles pr. trin over en defineret kørsel: hele kæden, embedding af forespørgsel,
     databasesøgning, reranking af 30 kandidater og ingestion af et dokument på 50 sider;
   - målingen sammenholdes med målene i §12 og registreres med konfigurationens fingeraftryk;
   - en afvigelse kræver en dokumenteret godkendelse.
