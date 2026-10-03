# 08B — Produktionsgrundlag

**Fase:** 8B — Produktionsgrundlag (underfase af masterfase 8 — AI Copilot, B-019)
**Status:** 📝 **Specifikation — afventer godkendelse.** Intet er implementeret.
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
| Hvor data behandles | EU-geografi: EU-profilen ruter mellem AWS' EU-regioner (fx Frankfurt, Irland, Paris). Ikke kun Frankfurt | Kun Frankfurt (in-region) | EU-region **[skal verificeres]** (`docs/roadmap.md` 8B) |
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

**Cohere Embed v4 på AWS Bedrock med EU-profilen og dimension 1024.** Embed-multilingual-v3 i
Frankfurt evalueres samtidig som kandidat.

- Begrundelse: hele chunket kan embeddes uden at ændre chunkingen. Data forlader ikke EU, og
  embedding, reranking og worker kan ligge hos samme leverandør under én aftale.
- 1024 dimensioner holder indekset lille og ligger langt under pgvectors grænse på 2000. Et
  skift til 1536 er en ny model med eget indeks, ikke en ændring.
- **Afvigelse fra den registrerede anbefaling:** roadmappen anbefaler v3, fordi alt er
  dokumenteret in-region i Frankfurt. Embed v4 behandles i EU, men ikke nødvendigvis i
  Frankfurt. Hvis kravet er "Frankfurt alene", kan v3 bruges med mindre chunks. Det er
  beslutning **D-1**.
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

### 4.4 Gates

**Hårde gates — nul tolerance.** Fejler én, kan konfigurationen ikke godkendes. Det er
korrekthed og sikkerhed, ikke statistik:

| # | Gate | Krav |
|---|------|------|
| H1 | Adgangslæk | 0 |
| H2 | Filterbrud (produkt og dokumenttype) | 0 |
| H3 | Upublicerede, deaktiverede eller tilbagetrukne versioner i resultatet | 0 |
| H4 | Temporal korrekthed (forkert version eller manglende historisk markering) | 100 % |
| H5 | Konfliktdækning, hvor brugeren har adgang til begge parter | 100 % |
| H6 | Ingen udviklingsimplementering i kørslen (embedder, reranker, `devOverride`) | Opfyldt |
| H7 | Evalueringssættet og korpusset er uændrede under kørslen (checksums) | Opfyldt |

**Kvalitetsgates — foreløbige tal.** De kalibreres på den første baseline-kørsel og godkendes af
dig (beslutning **D-6**):

| # | Gate | Foreslået minimum |
|---|------|-------------------|
| Q1 | Source Recall@8 | ≥ 0,95 |
| Q2 | Passage Recall@8 | ≥ 0,85 |
| Q3 | MRR@8 (passage) | ≥ 0,70 |
| Q4 | Korrekt afvisning (ubesvarbare) | ≥ 0,80 |
| Q5 | Falsk afvisning (besvarbare) | ≤ 0,10 |
| Q6 | Distraktor-indtrængen | ≤ 0,10 |
| Q7 | Rerankerens forbedring: Passage Recall@8 og MRR må ikke være lavere end uden reranker | Opfyldt |

**Tærsklen (`minScore`)** vælges på evalueringssættets dev-del (§5.6). Den er en del af
konfigurationen og gemmes i fingeraftrykket. Den kontrolleres på holdout-delen, når sættet er
stort nok.

### 4.5 Infrastruktur (udledt)

- **Kørsel:** et Node-script i repoet (`npm run eval`) kalder den rigtige `runRetrieval` med de
  rigtige implementeringer fra registret, som hver evalueringsbruger. Der er ingen særlig
  evalueringskode i retrieval.
- **Miljø:** et separat evalueringsmiljø (eget Supabase-projekt med samme migrationer, de
  rigtige udbydere og evalueringskorpusset). Evalueringsdokumenter må aldrig blandes ind i
  produktionsviden. Det løser også testisolationen fra `docs/07` §20.5.
- **Resultater:** hver kørsel skrives til `knowledge.evaluation_runs` i evalueringsmiljøet og som
  JSON-rapport med checksum. Rapporten indeholder metrics, gates, CI, konfigurationens
  fingeraftryk, sættets version og korpussets checksum.
- **Godkendelse i produktion (§10.3):** konfigurationen registreres i produktionsdatabasen med
  rapportens checksum og metrics. Databasen kontrollerer, at alle gates i rapporten er bestået,
  før den kan godkendes. Det er beslutning **D-7**.
- **Regression:** evalueringen køres igen ved hver ændring af model, reranker, chunker,
  retrieval-algoritme eller parametre, og planmæssigt hver uge. En kørsel, der falder under et
  gate, giver en alarm (§14). Hvad der derefter sker med den godkendte konfiguration, er
  beslutning **D-8**.

---

## 5. Evalueringssættet

### 5.1 Placering og vækst

- **Spørgsmål og facit ligger i repoet** som tekst under `evaluation/sets/<sæt-id>/`. De kan
  gennemgås i review og versioneres i git. **(udledt)**
- **Dokumenterne ligger ikke i repoet.** Manifestet peger på dem med checksum, og de indlæses i
  evalueringsmiljøet. Offentlige betingelser kan være ophavsretligt beskyttede, og store
  PDF'er hører ikke i git.
- **Formatet er JSON Lines:** ét spørgsmål pr. linje, så tusindvis af spørgsmål kan diffes,
  flettes og filtreres uden en stor fil.

```
evaluation/sets/terms-v1/
  manifest.json        sæt-id, version, skemaversion, dokumenter (nøgle, titel, version, gyldighed, checksum),
                       evalueringsbrugere og deres tildelinger
  questions.jsonl      ét spørgsmål pr. linje
  README.md            hvordan sættet er lavet, og hvem der vedligeholder det
```

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

### 6.1 Anbefalet arkitektur

```
                       AWS eu-central-1 (Frankfurt)
┌───────────────────────────────────────────────────────────┐
│ ECS Fargate-task (1 stk., kan skaleres)                   │
│  ┌──────────────────────┐   ┌───────────────────────────┐ │
│  │ ingestion-worker     │──▶│ clamd (ClamAV, sidecar)   │ │
│  │ Node 22, ikke-root   │   │ signaturer opdateres      │ │
│  └──────┬───────┬───────┘   └───────────────────────────┘ │
│         │       │ IAM-taskrolle (ingen nøgler)            │
│         │       └────────────▶ Bedrock (embeddings)       │
└─────────┼─────────────────────────────────────────────────┘
          │ HTTPS: PostgREST + Storage med rollen ingestion_worker
          ▼
   Supabase (EU): knowledge.ingestion_jobs · worker_*-funktioner · Storage
```

| Emne | Anbefaling | Begrundelse |
|------|------------|-------------|
| **Kørselsmiljø** | En container på **AWS ECS Fargate i eu-central-1**, langtlevende poll-løkke som i dag | Samme region og aftale som Bedrock. IAM-rollen giver Bedrock-adgang uden statiske nøgler. Ingen tidsgrænse pr. job |
| Fravalgt | Supabase Edge Functions (tids- og hukommelsesgrænser passer ikke til PDF-parsing), Vercel (`docs/03` §1 pkt. 3: ingestion må ikke afhænge af en requests levetid), en anden container-host i EU (muligt, men kræver statiske AWS-nøgler til Bedrock) | |
| **Kø** | Den eksisterende Postgres-kø (`knowledge.ingestion_jobs`, `FOR UPDATE SKIP LOCKED`, lease og heartbeat). Ingen ny kø-tjeneste | Virker og er testet. Volumen er lav |
| **Databaseadgang** | En dedikeret Postgres-rolle `ingestion_worker`, der kun må køre `worker_*`-funktionerne. Den bruges gennem PostgREST og Storage med et JWT, der bærer rollen. Service-role-nøglen forlader ikke Supabase | Mindste rettigheder. Rollen kan spærres øjeblikkeligt (`revoke ingestion_worker from authenticator`) |
| **Storage** | Læsning kun i `knowledge-originals` og skrivning kun i en ny `knowledge-quarantine` (§7) via politikker for rollen | |
| **Hemmeligheder** | JWT'et i AWS Secrets Manager med udløb efter 90 dage og en rotationsprocedure. Ingen hemmeligheder i image eller repo | |

**[AFKLARES] D-10:** Det skal verificeres, at Supabase-projektet kan udstede et JWT med en
egen rolle under de aktuelle signeringsnøgler. Ellers er alternativet en direkte
Postgres-forbindelse med en LOGIN-rolle. Det kræver en ny dependency (en Postgres-klient) og en
anden vej til originalfilerne.

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

## 8. Redaction og kundedata

### 8.1 Udgangspunkt

Roadmappen kræver, at kundedata ikke kan godkendes til modelbrug, før enten (A) redaction kan
finde navne i fri tekst målt mod et testsæt, eller (B) gatewayen teknisk forhindrer, at fri
tekst fra kundesager sendes til modellen. **8B åbner ikke for kundedata.** 8B sørger for, at det
ikke kan ske ved en fejl.

### 8.2 Hvad 8B gør

1. **Hård spærre i databasen.** Matricen får samme type constraint som `audit_access`:
   `customer_identifiable` kan kun være `deny`. I dag er det et standardvalg, der kan ændres
   med en funktion. Med constraint kræver det en migration, altså en kodeændring med review og
   en eksplicit beslutning. Det er beslutning **D-13**. Det strammer 8A uden at ændre
   arkitekturen. Se §18 K-6.
2. **Profilerne.** Ingen profil må have `customer_identifiable` i sine kategorier. Det er allerede
   en test (8A). Testen udvides til at fejle, hvis kategorien tilføjes i kode.
3. **Spærren dokumenteres der, hvor den ophæves:** i migrationen og i `docs/08` §5.2. Den, der
   ophæver den, skal pege på dokumentationen for forudsætning A eller B.
4. **Forberedelse af forudsætning A uden at bygge den:** formatet for et testsæt til
   navnegenkendelse (fiktive tekster med markerede navne og adresser i JSONL, som §5) og de
   metrics, en fremtidig løsning skal måles på (recall på personnavne og virksomhedsnavne).
   Ingen NER-model og ingen ny redaction i 8B.

### 8.3 Tests og gates

| Test | Forventet |
|------|-----------|
| `set_data_category_rule(..., 'customer_identifiable', 'allow')` | Afvist af constraint, også for administrator og service-rolle |
| Direkte `update`/`insert` af matricen med `allow`/`allow_redacted` for kundedata | Afvist |
| En profil med `customer_identifiable` (mutationstest) | Enhedstesten fejler |
| Mutationstest: constraint fjernet | pgTAP-testen fejler |

---

## 9. ProductionEvidenceSet — betingelser

Et EvidenceSet får `grade = production`, **kun hvis alle** betingelser er opfyldt. Mangler én,
er graden `development` (fail-closed):

| # | Betingelse | Hvordan det kontrolleres |
|---|------------|--------------------------|
| P1 | Forespørgslen er embedded med en production-embedder, og modellen er den aktive | Registret og `retrieval.embeddingModel.grade` (fase 7) |
| P2 | Rerankeren er production og ikke `none` | Registret og `requireProductionEvidence` (fase 7) |
| P3 | Der findes en **aktiv, godkendt retrieval-konfiguration** (§10), og runtime-fingeraftrykket matcher den præcist | Ny kontrol i `issueEvidenceSet` |
| P4 | Alle elementer stammer fra publicerede, ikke-tilbagetrukne versioner | Retrieval-funktionen (fase 7). Kontrolleres igen i evidensen |
| P5 | Adgangsfiltret er anvendt som den kaldende bruger | `security invoker`-søgning (fase 7). Ingen service-rolle i retrieval |
| P6 | Hvert elements `chunker_version` er dækket af konfigurationens evaluering | Ny kontrol. Et element fra en uevalueret chunker gør hele sættet `development` |
| P7 | Sættet er ikke fremtvunget af et udviklingsværktøj | `devOverride` (fase 7) |
| P8 | Sættet er udstedt af retrieval-laget og frosset | WeakSet og frysning (fase 7) |
| P9 | Sættet bærer konfigurationens id og fingeraftryk (§11) | Feltet sættes af retrieval-laget |

**Granularitet: pr. retrieval-konfiguration**, ikke globalt, ikke pr. model og ikke pr. indeks.

- Kvaliteten er en egenskab ved kombinationen af model, reranker, algoritme, parametre og
  chunker.
- Et globalt flag ville overleve et modelskifte.
- Kvalitet pr. model ville ignorere, at en anden reranker eller tærskel ændrer resultatet.
- Nye dokumenter i korpusset kræver ingen ny godkendelse, men fanges af den planlagte
  regressionskørsel (§4.5).

---

## 10. Register over retrieval-konfigurationer

### 10.1 Model (udledt)

`knowledge.retrieval_configurations`:

| Felt | Indhold |
|------|---------|
| `id` | |
| `fingerprint` | SHA-256 over de øvrige felter i kanonisk form |
| `embedding_model_id` | Til `knowledge.embedding_models` |
| `reranker_id`, `reranker_version` | Fx `bedrock:cohere.rerank-v3-5`, `0` |
| `algorithm_version` | Retrieval-algoritmens version (fx `hybrid-rrf-1`). Hæves, når kode i retrieval-kæden ændres |
| `params` | `candidateK`, `rerankN`, `topK`, `maxPerVersion`, `minScore`, `rrfK` |
| `chunker_versions` | De chunker-versioner, evalueringen dækkede |
| `status` | `candidate`, `approved`, `active` eller `retired`. Højst én `active` |
| `evaluation` | Rapportens checksum, sæt-id og -version, metrics og gate-resultater |
| `approved_by`, `approved_at` | Kræver `system.settings.manage`. Auditeres |

### 10.2 Regler

- Konfigurationen kan kun godkendes, hvis alle hårde gates og alle godkendte kvalitetsgates er
  bestået i den vedlagte rapport (constraint og funktion), og den ikke indeholder
  udviklingsimplementeringer.
- Runtime beregner sit fingeraftryk fra de faktisk konstruerede implementeringer og den
  faktiske konfiguration. Matcher det ikke den aktive konfiguration, er al evidens
  `development`. Retrieval-tilstanden (B-007) viser det i Admin som "Konfigurationen er ikke
  godkendt".
- Konfigurationer ændres aldrig. En ændring er en ny konfiguration.

### 10.3 Flow

```
ny model/reranker/parametre → evalueringskørsel i evalueringsmiljøet → rapport (JSON + checksum)
 → registrering i produktion som candidate → godkendelse (menneske, system.settings.manage)
 → aktivering i én transaktion (sammen med modelskiftet, hvis modellen er ny)
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

- **Hvor:** et lille "Systemstatus"-afsnit i Admin læser kø, fejl, status og retrieval-tilstand
  fra databasen. Logs ligger hos hostingudbyderen (CloudWatch for workeren, Vercel for appen).
  Ingen ny observability-leverandør. Alarmkanal (e-mail eller andet) er beslutning **D-15**.
- **Hører senere til:** bruger- og AI-analytics (brug, videnshuller, kvalitet af svar) hører til
  masterfase 15 og til 8C (B-014).

---

## 15. Security — trusselsmodel light

| Trussel | Konsekvens | Mitigation |
|---------|------------|------------|
| **Ondsindet PDF** | Kodeudførelse i workeren, nedbrud eller ressourceudtømning | Virusscanning før parsing (§7.2); afvisning af aktivt indhold (§7.1); parser i børneproces med tids- og hukommelsesgrænse; ikke-root, skrivebeskyttet container uden indgående porte; ingen eksekvering af PDF-indhold |
| **Uautoriseret retrieval** | Brugeren ser dokumenter uden tildeling | Søgning som brugeren (`security invoker`, RLS, adgangsfilter før søgning). Hård gate H1. Integrationstests fra fase 7 |
| **Lækage af metadata** | Titler, ids eller konflikter afslører dokumenter | Neutral konfliktindikator (B-20); "findes ikke" frem for "ingen adgang"; gate H1 omfatter metadata; evalueringsrapporter indeholder ingen produktionsdata |
| **Privilegieeskalering** | Workeren publicerer eller læser mere end nødvendigt | Rollen `ingestion_worker` må kun køre `worker_*`-funktioner. Funktionerne kan ikke publicere (fase 7). Ingen service-rolle i workeren |
| **Kompromitteret worker-credential** | En angriber kan skrive behandlingsresultater | Rollen kan ikke publicere: alt kræver en menneskelig godkendelse (`docs/03` §1 pkt. 4). Øjeblikkelig spærring. Rotation hver 90. dag. IAM-rolle til Bedrock (ingen nøgle at stjæle) |
| **Forgiftet videnskilde** | Forkert eller manipuleret indhold bliver "autoritativt" | Kun mennesker med `knowledge.version.publish` aktiverer viden (fase 7); kvalitetsrapport og review; konfliktdetektion; audit af upload og godkendelse; checksum på originalen |
| **Replay og dobbeltbehandling** | Dubletter eller to workers på samme version | Lease, unikt aktivt job pr. (version, type), idempotente trin, (chunk, model) som nøgle, checksum |
| **Utilsigtet brug af udviklingsevidens** | Svag evidens når en bruger, der handler på den | Fail-closed register, `ProductionEvidenceSet` og parringsreglen (B-012); P3/P6 (godkendt konfiguration); gates H6; mutationstests |
| **Udbyderen ændrer modellen bag samme id** | Stille kvalitetsfald | Kontrolsæt af vektorer (§2.5) og planlagt regression (§4.5) |
| **Data forlader EU** | Brud på kravet | Udbydere og regioner låses i konfigurationen. Endpoint og region kontrolleres ved opstart. Kun EU-endpoints er tilladt |

---

## 16. Tests

| Lag | Hvad |
|-----|------|
| **Enhed** | Bedrock-embedder og -reranker med optagne svar (ingen netværk): batch, genforsøg, 429, for langt input, inputtype. Fingeraftryk (kanonisk og stabilt). P1–P9 i `issueEvidenceSet`. Metrics-beregning med kendte tal. Valideringen af sættets skema og ankre. Klassifikation af workerfejl som (ikke) genforsøgbare |
| **DB/RLS (pgTAP)** | `retrieval_configurations`: kan ikke godkendes med fejlede gates eller `none`; højst én aktiv; uforanderlig; godkendelse kræver `system.settings.manage` og auditeres. Rollen `ingestion_worker` kan kun køre `worker_*` og kun læse originaler. Karantæne: kan ikke læses, ikke genbehandles, ikke godkendes. Kundedataspærren (§8.3) |
| **Integration** | Hele kæden mod den lokale database med optagne udbydersvar. Workeren som `ingestion_worker` uden service-rolle. Production-grad opnås kun med en aktiv godkendt konfiguration og falder til `development` ved et andet fingeraftryk |
| **Worker** | Afbrudt job genoptages. Dobbelt claim afvises. Genforsøg ved 429. Endelig fejl giver `processing_failed`. Timeout pr. trin. Stor PDF inden for hukommelsesgrænsen |
| **Security** | EICAR-testfilen sættes i karantæne. PDF'er med JavaScript, Launch-handling, indlejrede filer, ødelagt struktur, dekomprimeringsbombe, krypteret, uden tekstlag. Scanner utilgængelig giver ingen behandling |
| **Evaluering** | Evalueringsmotoren testes med et lille fiktivt sæt, hvor facit er kendt. Hver metric og hvert gate har en test, der får det til at fejle |
| **Kontrakttest mod udbyderen** | Planlagt kørsel mod den rigtige Bedrock i evalueringsmiljøet. Ikke i CI |
| **Mutation og adversariel** | Svækket P3, P6 eller H1–H7, fjernet karantænepolitik, fjernet scanning, fail-open ved forældede signaturer, kundedataspærren fjernet, fallback til `none`. Hver skal fanges. Samme standard som fase 7 og 8A |
| **Browser** | Upload i browseren med Playwright mod riggen (`docs/07` §20.5) |

---

## 17. Exit-kriterier (Definition of Done)

8B kan låses, når **alle** punkter kan afkrydses objektivt:

1. Lint, typecheck, build, enhedstests, pgTAP, integrations-, worker- og security-tests består.
2. Mutationstestene i §16 fanges alle.
3. Der findes en evalueringsrapport for den anbefalede konfiguration på evalueringssættet (30–50
   spørgsmål, alle typer i §5.3) med alle hårde gates bestået og alle godkendte kvalitetsgates
   bestået.
4. Konfigurationen er registreret, godkendt og aktiv i et miljø med de rigtige udbydere.
   `retrieveEvidence` udsteder dér et `ProductionEvidenceSet`, som `requireProductionEvidence`
   accepterer.
5. Med et andet fingeraftryk, `none`, test-embedderen eller en uevalueret chunker-version er
   evidensen påviseligt `development`.
6. Workeren kører i det valgte produktionsmiljø uden service-rolle og behandler en rigtig PDF
   fra upload til `processed` inden for målet i §12.
7. Virusscanning med EICAR giver karantæne. Scanner nede eller forældede signaturer giver ingen
   behandling.
8. Kundedataspærren kan ikke omgås uden en migration.
9. Signalerne i §14 kan ses, og mindst alarmerne for dead-letter, retrieval utilgængelig og
   kvalitetsregression er afprøvet.
10. Performance-målene i §12 er målt og dokumenteret, eller afvigelser er godkendt.
11. Databehandleraftaler for de valgte udbydere er bekræftet (af dig. Det er ikke en teknisk
    opgave).
12. Dette dokument har en implementeringsstatus (§21, oprettes ved implementering), og roadmap,
    CLAUDE.md og README er opdateret.

---

## 18. Berøring af låste dokumenter

Ingen af punkterne ændrer arkitektur eller trufne beslutninger. Alle er udbygninger eller
stramninger, der kræver din godkendelse, fordi de rører tekst i låste dokumenter:

| # | Låst dokument | Hvad | Type |
|---|---------------|------|------|
| K-1 | `docs/07` §9.1 pkt. 3 | Graden er i dag "production kun hvis både embedder og reranker er production". 8B tilføjer flere nødvendige betingelser (P3, P6). "Kun hvis" gælder fortsat. Teksten bør nævne, at betingelserne er udvidet (B-008) | Stramning, ikke modstrid |
| K-2 | `docs/07` §7 | `Embedder`-interfacet beskrives som `embed(texts, {model})`. 8B tilføjer `inputType` (dokument eller forespørgsel) | Udbygning |
| K-3 | `docs/07` §6 | Chunkstørrelsen er konfiguration, højst ca. 800 tokens. Vælges v3 (D-1), skal maksimum sænkes til ca. 400 tokens inklusive overskrift og `lead_in`. Med Embed v4 ændres intet | Kun ved valg af v3 |
| K-4 | `docs/07` §10 | Evidensmodellen får `retrieval.configuration` (additivt). Forslag: `schemaVersion` hæves til 2 | Udbygning (D-14) |
| K-5 | `docs/07` §14.1, B-16 | Workerens produktionsadgang fastlægges. Det var planlagt | Planlagt |
| K-6 | `docs/08` §5.2 | Kundedata spærres med constraint i stedet for standardværdi. Strammer 8A | Stramning (D-13) |
| K-7 | `docs/03` §2 og §14 | AWS bliver en ny leverandør (Bedrock og Fargate) ud over Vercel og Supabase. Embedding, reranker og worker-leverandør er bevidst ikke låst (`docs/03` §17 pkt. 1–3), så det er inden for arkitekturen | Ny leverandør (D-2, D-9) |
| K-8 | `docs/07` §7 ("forespørgselsembedding laves server-side i appen") | Appen på Vercel skal kalde Bedrock. Anbefaling: Vercels OIDC-federering til en AWS IAM-rolle (ingen statiske nøgler), og appens funktioner i Vercels EU-region | Udbygning (D-11) |

---

## 19. Beslutninger til godkendelse

| # | Beslutning | Anbefaling |
|---|------------|------------|
| **D-1** | Embedding-model | Cohere Embed v4 på Bedrock med EU-profil og 1024 dimensioner. v3 i Frankfurt evalueres som kandidat. **Afviger fra roadmappens anbefaling (v3 in-region):** EU-geografi frem for kun Frankfurt, men intet indgreb i chunkingen |
| **D-2** | Leverandør til embedding og reranking | AWS Bedrock i eu-central-1 (ny leverandør, K-7) |
| **D-3** | Reranker | Cohere Rerank 3.5 på Bedrock i Frankfurt. Rerank 4 (Microsoft Foundry) som næste kandidat |
| **D-4** | Ingen fallback til `none` eller fusion i produktion; reranker-fejl er "utilgængelig" | Ja |
| **D-5** | Metrics: Source/Passage Recall@K, MRR, korrekt og falsk afvisning, distraktor-indtrængen, temporale og adgangsmæssige gates; nDCG rapporteres, men gates ikke | Ja |
| **D-6** | Gates: hårde H1–H7 og foreløbige kvalitetsgates Q1–Q7 (§4.4), som kalibreres på baseline og godkendes af dig | Ja, tallene som foreslået |
| **D-7** | Evaluering i et separat evalueringsmiljø; godkendelse i produktion via rapport med checksum, som databasen kontrollerer | Ja |
| **D-8** | Når en planlagt regressionskørsel fejler et gate | Hårde gates: konfigurationen deaktiveres automatisk, og evidensen bliver `development` (fail-closed). Kvalitetsgates: alarm, og du afgør inden for en aftalt frist |
| **D-9** | Workerens kørselsmiljø | AWS ECS Fargate i eu-central-1 med ClamAV som sidecar. Postgres-køen bevares |
| **D-10** | Workerens databaseadgang | Rollen `ingestion_worker` via PostgREST og Storage med et JWT med rollen. **[AFKLARES]** om Supabase understøtter det med de aktuelle signeringsnøgler. Alternativt en direkte Postgres-forbindelse (ny dependency) |
| **D-11** | Appens adgang til Bedrock | Vercels OIDC-federering til en AWS IAM-rolle og funktioner i Vercels EU-region (K-8) |
| **D-12** | PDF'er med aktivt indhold (JavaScript, Launch, OpenAction med handlinger, indlejrede filer) | Afvis |
| **D-13** | Kundedata spærres med constraint (K-6) | Ja |
| **D-14** | Evidensmodellen udvides med `retrieval.configuration`, og `schemaVersion` hæves til 2 (K-4) | Ja |
| **D-15** | Alarmkanal for tekniske signaler | E-mail til en driftsansvarlig. Kanal og modtager **[AFKLARES]** |
| **D-16** | Evalueringssættets placering: spørgsmål i repoet (JSONL), dokumenter kun i evalueringsmiljøet med checksum | Ja |
| **D-17** | Tilladelse til de tekstændringer i låste dokumenter, som K-1, K-2, K-4 og K-6 kræver, når 8B implementeres | Ja |

**Åbne spørgsmål, der ikke blokerer specifikationen:**

| # | Spørgsmål |
|---|-----------|
| Å-1 | Bedrocks kvoter for de valgte modeller i eu-central-1 (anmodninger og tokens pr. minut) skal afklares før produktion |
| Å-2 | Databehandleraftalerne skal bekræftes af dig eller juridisk ansvarlig, ikke af koden |
| Å-3 | Hvem vedligeholder evalueringssættet, og hvor ofte skal der tilføjes spørgsmål? |
| Å-4 | Retningslinjen for fiktive dokumenter i evalueringssættet (tillæg og versioner til konflikt- og historikspørgsmål) |

---

## 20. Implementeringsrækkefølge (når specifikationen er godkendt)

1. Udbyderadgang: AWS-konto og -region, databehandleraftale, kvoter og OIDC-federering.
   Kontrakttest mod Bedrock.
2. Embedder og reranker bag interfacene, registret og optagne svar til tests.
3. Register over retrieval-konfigurationer, fingeraftryk og P1–P9 i evidensen. pgTAP og
   mutationstests.
4. Evalueringsmotor, sættets skema, metrics og gates. Evalueringsmiljø.
5. Baseline-kørsel. Du kalibrerer og godkender kvalitetsgates. Valg af model (v4 eller v3).
6. Worker: rollen `ingestion_worker`, scanning, karantæne, timeouts og container. Udrulning til
   Fargate.
7. Kundedataspærren.
8. Observability og alarmer.
9. Godkendelse og aktivering af konfigurationen. Exit-kriterierne i §17. Dokumentation.
