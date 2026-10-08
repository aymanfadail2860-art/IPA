# Aggregerede alarmer: fejlrate og latency (B-033)

Specifikation: `docs/08b-production-foundation.md` §14 og §21.13, `docs/decisions.md` B-033.

**Status:** specifikationen er skrevet, men ikke implementeret. Alarmerne bygges i den valgte log- og
monitoreringsplatform: Vercels logs eller en log-drain for appen og CloudWatch for workeren.
Applikationen skal ikke have sit eget metrics-system (B-033). **Alarmerne skal være i drift før
den kontrollerede Copilot-pilot** (B-030, B-033). Hvem der modtager dem, og via hvilken
tjeneste, er stadig åbent (Å-5).

De alarmer, som platformen allerede selv rejser, findes under [Allerede implementeret](#allerede-implementeret-ikke-aggregeret).
Denne fil beskriver kun de alarmer, der kræver aggregering over et tidsvindue.

## Kilder

| Kilde | Hvor | Loglinje | Felter, der bruges |
|---|---|---|---|
| Appens retrieval | Vercel (appens funktioner) | `event = "retrieval"` (én pr. retrieval, `src/lib/observability/retrieval-telemetry.ts`) | `outcome` (`evidence`, `insufficient`, `error`); `error_code` (kun ved `error`); `failed_steps` (liste over `query_embedding`, `search`, `rerank`, `total`); `steps_ms.total`, `steps_ms.query_embedding`, `steps_ms.search`, `steps_ms.rerank` (hele ms); `configuration_id` |
| Workerens behandlingstrin | CloudWatch `/ipa/ingestion-worker` | `event = "job_step"` med `step` og `ms` (et gennemført trin) | `step` (`embedding` og andre), `ms` |
| Workerens fejlede job | CloudWatch `/ipa/ingestion-worker` | `event = "job_step"` med `outcome` (`retry` eller `failed`) og `error` | `error = "ProviderError"`: udbyderen fejlede. I workeren kaldes en udbyder kun ved embedding |

Loglinjerne indeholder aldrig forespørgsler, titler, dokumenttekst eller bruger-id'er. Det
må dimensionerne heller ikke.

## Dimensioner (labels)

| Dimension | Værdi | Kilde |
|---|---|---|
| `environment` | `production` eller `pilot`/`staging` | Deploymentet (Vercel-projekt/-miljø, CloudWatch-loggruppe), ikke loglinjen |
| `configuration_id` | Retrieval-konfigurationen i drift, eller tom | Loglinjen |
| `step` | `total`, `query_embedding`, `search`, `rerank` | `steps_ms`/`failed_steps` |
| `error_code` | RetrievalError-koden | Loglinjen (kun ved `outcome = "error"`) |

## Metrics

| Metric | Definition | Enhed |
|---|---|---|
| `ipa_retrieval_requests` | Antal `event = "retrieval"` | antal |
| `ipa_retrieval_step_attempts{step}` | Antal `event = "retrieval"`, hvor `steps_ms.<step>` findes, eller hvor `failed_steps` indeholder `<step>` | antal |
| `ipa_retrieval_step_failures{step}` | Antal `event = "retrieval"`, hvor `failed_steps` indeholder `<step>` | antal |
| `ipa_retrieval_latency_ms{step}` | `steps_ms.<step>` | ms (fordeling: p50 og p95) |
| `ipa_ingestion_embedding_attempts` | Antal `job_step` med `step = "embedding"` plus antal fejlede job med `error = "ProviderError"` | antal |
| `ipa_ingestion_embedding_failures` | Antal fejlede job (`outcome` er `retry` eller `failed`) med `error = "ProviderError"` | antal |

## Alarmer

| # | Alarm | Betingelse | Tærskel | Vindue | Alvor | Grundlag |
|---|---|---|---|---|---|---|
| A1 | Embedding-fejlrate, forespørgsler | `step_failures{query_embedding}` / `step_attempts{query_embedding}` | > 5 % | 15 min | warning | §14 |
| A2 | Embedding-fejlrate, ingestion | `ingestion_embedding_failures` / `ingestion_embedding_attempts` | > 5 % | 15 min | warning | §14 |
| A3 | Reranking-fejlrate | `step_failures{rerank}` / `step_attempts{rerank}` | > 1 % | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A4 | Reranking-latency | p95 af `latency_ms{rerank}` | > 1.000 ms | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A5 | Retrieval-latency, hele kæden | p95 af `latency_ms{total}` | > 1.500 ms | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A6 | 429-rate (throttling), embedding | Andelen af udbyderfejl af typen `throttled` | > 5 % | 15 min | warning | §14. **Kan ikke bygges endnu:** loglinjerne bærer ikke fejltypen (B-033, auditten 2026-10-09) |

**Fælles regler (B-033):**
- En alarm vurderes kun, hvis vinduet indeholder mindst 20 forsøg. Ved lav trafik, som i en pilot
  med ca. 10 brugere, giver én fejl ellers 100 %. *Udledt; til bekræftelse.*
- Uden data i vinduet rejses ingen rate- eller latency-alarm. Tavshed overvåges et andet sted:
  appen rejser `retrieval_unavailable`, og workeren har alarmen `ipa-health-check-silent`.
- Alvoren følger `AlertSink`-kataloget: alle aggregerede alarmer er `warning`. Retrieval, der er
  helt utilgængelig, er allerede `critical` (`retrieval_unavailable`).
- Alarmen sendes til samme modtager som `AlertSink`-alarmerne (Å-5). Den skal indeholde alarmens
  nummer (A1–A6), `environment`, vinduet og den målte værdi, aldrig indhold.

## Allerede implementeret (ikke aggregeret)

| Signal (§14) | Hvor |
|---|---|
| Kø og ældste ventende job, dead-letter, versioner under behandling, scanner-fejl og fund, suspenderet konfiguration og kvalitetsregression | Workerens sundhedskontrol hvert 5. minut (`AlertSink`) og `deploy/ingestion-worker/alarms.json` |
| Retrieval utilgængelig, runtime-fingeraftryk ≠ aktiv konfiguration | Appens retrieval-telemetri (`AlertSink`, højst én alarm pr. kode pr. 10 min) |
| Hård regression, kvalitetsregression, ugyldig kørsel, afvist publicering | Publiceringstrinnet (`AlertSink`) efter databasens klassifikation (8B-I7.1) |
| Signaturernes alder og scannerens tilgængelighed | `deploy/clamav/alarms.json` (8B-I5.5) |
