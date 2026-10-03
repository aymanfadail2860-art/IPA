# Evaluering af retrieval

Versionsstyret evalueringssæt og gate-sæt for Knowledge Engines retrieval. Specifikationen står i
`docs/08b-production-foundation.md` §4–§5 (låst, B-020). Motoren ligger i `evals/engine/`.

Evalueringen måler **retrieval, ikke svar**. Hver kørsel tager én retrieval-konfiguration og ét
evalueringssæt. Alle spørgsmål køres gennem den rigtige `runRetrieval` som den angivne
evalueringsbruger og sammenlignes med facit. Resultatet er en rapport.

> **Status (8B-I1):** Motoren, formaterne og gates er implementeret. Der findes endnu ikke et
> evalueringsmiljø, rigtige udbydere, et register over konfigurationer eller en
> `evaluation_publisher`. En kørsel kan derfor kun foretages mod fixture-retrieval, og **en
> rapport kan ikke godkende, registrere eller aktivere en konfiguration eller gøre evidens
> production**.

## Struktur

```
evals/retrieval/
  README.md                         denne fil: metode og regler
  schema/case.schema.json           JSON Schema for ét spørgsmål (skema v1)
  schema/manifest.schema.json       JSON Schema for et manifest
  schema/gates.schema.json          JSON Schema for et gate-sæt
  manifests/<sæt>.json              sæt-id, version, dokumenter, evalueringsbrugere, konflikter
  cases/<sæt>.jsonl                 ét spørgsmål pr. linje
  gates/gates-v1.json               tærsklerne for Q1–Q7 (B-020)
  configurations/<navn>.json        den konfiguration, der evalueres (udbyder og model er data)
  fixtures/                         fiktive dokumenter, som må ligge i repoet
  reports/                          output fra kørsler (ignoreres af git)
```

Der findes i dag ét sæt: **`example-v1`**. Det er syntetisk og findes kun for at afprøve motoren.
Det opfylder bevidst ikke minimum pr. type. **Pilot-evalueringssættet** med 30–50 rigtige
spørgsmål om offentlige betingelser oprettes senere som `manifests/terms-v1.json` og
`cases/terms-v1.jsonl`.

## Kør

```bash
IPA_RUNTIME_ENV=test npm run eval:retrieval
IPA_RUNTIME_ENV=test npm run eval:retrieval -- --set example-v1 --gates gates-v1 --configuration fixture-development
```

Fixture-retrieval bruger test-embedderen og rerankeren "none" fra registret. Registret afviser
dem, medmindre `IPA_RUNTIME_ENV` udtrykkeligt er `local` eller `test`. Kørslen skriver
`reports/<kørsels-id>.json` (maskinlæsbar) og `.md` (til mennesker).

Exitkoder: 0 = bestået, 1 = ikke bestået eller usikker, 2 = ugyldigt input.

## Regler for indholdet

- **Ingen fortrolige kundedata.** Kun offentlige forsikringsbetingelser, syntetiske eller
  fiktive tilfælde og godkendt testmateriale.
- En test (`src/tests/eval-retrieval-data.test.ts`) kører 8A's redaction-detektorer (CPR, CVR med
  kontekst, e-mail, telefon og konto) over alle sæt og fixtures og fejler ved fund.
- Fixtures skal være markeret `"fictional": true` og have en `notice`.
- **Offentlige betingelser** ligger kun i repoet, hvis licensen tillader det. Ellers peger
  manifestet på kilde-URL og SHA-256 (`"source": { "kind": "public", … }`), og dokumentet
  indlæses kun i evalueringsmiljøet.
- Spørgsmål slettes aldrig. Et forkert spørgsmål markeres `"retired": true` med
  `retiredReason`.
- Under ca. 100 spørgsmål er alt `split: "dev"`. Holdout begynder ved ca. 100.

## Spørgsmålsformat (skema v1)

Hvert spørgsmål angiver:

- id og skemaversion
- spørgsmål og sprog
- type
- evalueringsbruger (`actor`)
- `mode` (`current` eller `as_of` med `asOf`)
- filtre (produkter, dokumenter, dokumenttyper)
- facit (`expected`)
- split, forfatter, dato og noter

Facit indeholder:

- `outcome`: `evidence` eller `insufficient`.
- `passages`: dokument + version + **ankertekst** + grad. Ankret er en kort, ordret tekst fra
  kilden, aldrig et chunk-id.
  - Et evidenselement dækker en passage, når ankret (normaliseret: NFC og samlet whitespace)
    findes i elementets uddrag eller indledning i den rigtige version.
  - Graden er 3 for direkte svar, 2 for nødvendig kontekst og 1 for relevant, men ikke nødvendig.
- `mustNotInclude`: versioner, der er ugyldige for spørgsmålet, fx den gældende version i et
  historisk spørgsmål. Et fund er et brud på H3.
- `conflict`: de to dokumenter i en åben konflikt.
- `permissions.forbiddenDocuments`: dokumenter, brugeren ikke må se. Kontrolleres mod
  manifestet.
- `distractors`: dokumenter, der ligner, men ikke gælder. Måles i Q6.

Ankre valideres før kørslen. Et anker, der ikke findes præcis én gang i den angivne version, er en
fejl i sættet, ikke i retrieval, og kørslen afbrydes. Et facit, som brugeren ikke har adgang
til, er også en fejl i sættet.

| Type | Krav til facit |
|------|----------------|
| `direct` | `evidence`, mindst én passage med grad 3 |
| `multi_chunk` | mindst to passager med grad 3 |
| `historical` | `as_of`, `temporalStatus: historical`, den gældende version i `mustNotInclude` |
| `conflict` | `conflict` med to dokumenter, erklæret åben i manifestet |
| `unanswerable` | `insufficient`, ingen passager |
| `distractor` | `evidence` og mindst én distraktor |
| `permission` | `insufficient` og `forbiddenDocuments` |
| `filter` | `evidence` og mindst ét filter |

## Metrikker

K er 8 (konfigurationens `topK`). "Besvarbare" er spørgsmål med `outcome: evidence`.

| Metrik | Definition |
|--------|------------|
| Source Recall@K | Andel besvarbare, hvor en forventet dokumentversion er blandt de K første elementer |
| Passage Recall@K | Andel besvarbare, hvor den **primære** passage (første passage med grad 3) er dækket blandt de K første |
| MRR@K | Gennemsnit af 1/rang for det første element, der dækker en passage med grad 3 (0, hvis ingen) |
| Korrekt afvisning | Andel `insufficient`-spørgsmål (`unanswerable` og `permission`), der giver et tomt resultat |
| Falsk afvisning | Andel besvarbare, der giver et tomt resultat |
| Distraktor-indtrængen | Andel af elementerne blandt de K første i distraktor-spørgsmål, der kommer fra en distraktor |
| Rerankerens bidrag | Passage Recall@K og MRR@K med reranker sammenlignet med samme kørsel uden reranker |

Source Recall@1 og @3, Full Coverage@K og nDCG@K rapporteres, men gates ikke (D-5).

Et spørgsmål, hvor retrieval fejler, tæller som det værst mulige udfald: intet fundet ved et
besvarbart spørgsmål, ingen afvisning ved et ubesvarbart. Kørslen bliver samtidig ugyldig.

## Gates

**Hårde gates H1–H7 har nul tolerance.** De er invarianter i koden
(`evals/engine/observe.ts`, `gates.ts`) og står aldrig i et gate-sæt. Ét brud dumper kørslen,
uanset kvalitetstallene.

| | Hvad tælles som brud |
|---|---|
| H1 | Elementer fra dokumenter uden tildeling, historiske versioner uden historisk adgang, og elementer, der ikke kan henføres til manifestet |
| H2 | Id, titel eller konflikt-id fra et utilgængeligt dokument i evidensen eller i det rå resultat; et uddrag, der ikke findes i den version, det tilskrives; en neutral konfliktindikator med andet end den faste tekst |
| H3 | Forkert tilstand eller dato, ugyldig eller tilbagetrukket version, forkert historisk markering, to versioner af samme dokument, fund i `mustNotInclude` |
| H4 | Elementer uden for de anmodede produkter, dokumenter eller dokumenttyper |
| H5 | Et element i en åben konflikt uden markering, kun den ene part, når brugeren har adgang til begge, eller manglende neutral indikator |
| H6 | Udviklingsevidens, test-embedder, "none", `devOverride`, anden model eller reranker end den evaluerede, fingeraftryk, der ikke matcher, eller chunker-versioner uden for konfigurationen |
| H7 | Kørslen er ikke i evalueringsmiljøet, retrieval kørte som en anden bruger, eller sæt, gate-sæt, korpus eller inputfiler ændrede sig under kørslen |

H6 og H7 gør desuden kørslen **ugyldig**.

**Kvalitetsgates Q1–Q7** læses fra gate-sættet (`gates/gates-v1.json`). Kun tærsklerne er data.
Metrik og retning er låst i koden, så et gate ikke kan løsnes ved at vende sammenligningen. En
metrik, der ikke kan beregnes, dumper sit gate.

**Rekalibrering** sker kun med:
1. en ny version af gate-sættet,
2. en ny versionsstyret baseline og
3. en eksplicit godkendt beslutning i `docs/decisions.md`.

## Pilot-regler

1. Hårde gates kræver ingen statistik.
2. **Minimum pr. type** for en gyldig kørsel:
   - 20 besvarbare (`direct` og `multi_chunk`)
   - 5 `unanswerable`
   - 3 `historical`
   - 2 `conflict`
   - 3 `distractor`
   - 3 `permission` eller `filter`
3. **Hver fejl forklares.** Rapporten lister hver fejl med spørgsmål og forklaring.
   Årsagsnoten skrives af et menneske, før en konfiguration kan godkendes.
4. **Wilson 95 %-intervaller** vises for hver andel. Gatet afgøres på punktestimatet, men
   resultatet markeres **usikkert**, når intervallet krydser tærsklen. For "≥"-gates gælder det,
   når den nedre grænse ligger under tærsklen, og for "≤"-gates, når den øvre grænse ligger over.
   Et ellers bestået resultat med et usikkert gate er `uncertain`.
5. **Tier:**
   - Under 100 aktive spørgsmål er tier altid `pilot`.
   - Fra 100 spørgsmål er tier `standard`. Det er kun en betegnelse i rapporten, ikke en
     certificering (masterfase 18).

**Samlet afgørelse:**
- `fail`, hvis et hårdt gate fejler, kørslen er ugyldig, eller et kvalitetsgate fejler.
- Ellers `uncertain`, hvis et gate er usikkert.
- Ellers `pass`.

## Kalibreringsprocedure og retningslinjer for fiktive dokumenter

Begge skal skrives her **før baseline-kørslen** (docs/08b §4.4 pkt. 6, Å-3, Å-4). De er endnu
ikke fastlagt.
