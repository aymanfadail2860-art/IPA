# Aggregerede alarmer: fejlrate, throttling og latency (B-033)

Specifikation: `docs/08b-production-foundation.md` §14, §21.13 og §21.15 (C3),
`docs/decisions.md` B-033. Den maskinlæsbare udgave er `aggregate-alarms.json`, version 1. En
test holder de to filer og felterne i koden i overensstemmelse.

**Status:** loglinjerne bærer nu alle de felter, alarmerne kræver, også udbyderens fejltype
(8B-I8 C3). Selve alarmerne bygges i den valgte log- og monitoreringsplatform: Vercels logs
eller en log-drain for appen og CloudWatch for workeren. Applikationen skal ikke have sit eget
metrics-system (B-033). **Alarmerne skal være i drift før den kontrollerede Copilot-pilot**
(B-030, B-033). Hvem der modtager dem, og via hvilken tjeneste, er stadig åbent (Å-5).

De alarmer, som platformen allerede selv rejser, findes under [Allerede implementeret](#allerede-implementeret-ikke-aggregeret).
Denne fil beskriver kun de alarmer, der kræver aggregering over et tidsvindue.

## Kilder

| Kilde | Hvor | Loglinje | Felter |
|---|---|---|---|
| Appens retrieval | Vercel (appens funktioner) | `event = "retrieval"`, én pr. retrieval (`src/lib/observability/retrieval-telemetry.ts`) | `request_id`; `outcome` (`evidence`, `insufficient`, `error`); `error_code` (kun ved `error`); `failed_steps` (`query_embedding`, `search`, `rerank`, `total`); `steps_ms.total`, `steps_ms.query_embedding`, `steps_ms.search`, `steps_ms.rerank` (hele ms); `configuration_id`; `provider_errors` (trinnet, hvor udbyderen fejlede: `step`, `provider`, `provider_error_kind`, `throttled`, `timeout`, `retryable`, `http_status`, `error_class`, `attempts`) |
| Udbyderkald | Vercel og CloudWatch `/ipa/ingestion-worker` | `event = "provider_call"`, én pr. kald til udbyderen, også hvert genforsøg (`src/lib/knowledge/providers/provider-metrics.ts`) | `runtime` (`application`, `worker`); `provider`; `operation` (`embed_query`, `embed_document`, `rerank`); `model`; `outcome` (`ok`, `error`); `duration_ms`; `provider_error_kind` (`throttled`, `timeout`, `unavailable`, `access_denied`, …); `throttled`; `timeout`; `retryable`; `http_status`; `error_class`; `correlation_id`; i appen også `request_id`, `configuration_id` og `configuration_fingerprint` |
| Workerens behandlingstrin | CloudWatch `/ipa/ingestion-worker` | `event = "job_step"` med `step` og `ms` (et gennemført trin) | `step`, `ms` |
| Workerens fejlede job | CloudWatch `/ipa/ingestion-worker` | `event = "job_step"` med `outcome` (`retry` eller `failed`) | `step` (trinnet, der fejlede), `ms`, `error`; ved udbyderfejl også `provider`, `operation`, `provider_error_kind`, `throttled`, `timeout`, `http_status`, `attempts` |

Loglinjerne indeholder aldrig forespørgsler, titler, dokumenttekst, udbyderens fejltekst,
credentials eller bruger-id'er. Det må dimensionerne heller ikke.

## Dimensioner (labels)

| Dimension | Værdi | Kilde |
|---|---|---|
| `environment` | `production` eller `pilot`/`staging` | Deploymentet (Vercel-projekt/-miljø, CloudWatch-loggruppe), ikke loglinjen |
| `runtime` | `application` eller `worker` | `provider_call` |
| `operation` | `embed_query`, `embed_document`, `rerank` | `provider_call` |
| `configuration_id` | Retrieval-konfigurationen i drift, eller tom | `retrieval` og `provider_call` (appen) |
| `step` | `total`, `query_embedding`, `search`, `rerank` | `steps_ms`/`failed_steps` |
| `provider_error_kind` | Udbyderfejlens type | `provider_call`, `provider_errors`, `job_step` |
| `error_code` | RetrievalError-koden | `retrieval` (kun ved `outcome = "error"`) |

## Metrics

| Metric | Definition | Enhed |
|---|---|---|
| `ipa_retrieval_requests` | Antal `event = "retrieval"` | antal |
| `ipa_retrieval_step_attempts{step}` | Antal `event = "retrieval"`, hvor `steps_ms.<step>` findes, eller hvor `failed_steps` indeholder `<step>` | antal |
| `ipa_retrieval_step_failures{step}` | Antal `event = "retrieval"`, hvor `failed_steps` indeholder `<step>` | antal |
| `ipa_retrieval_latency_ms{step}` | `steps_ms.<step>` | ms (fordeling: p50 og p95) |
| `ipa_provider_calls{runtime,operation}` | Antal `event = "provider_call"` | antal |
| `ipa_provider_errors{runtime,operation,provider_error_kind}` | Antal `provider_call` med `outcome = "error"` | antal |
| `ipa_provider_throttled{runtime,operation}` | Antal `provider_call` med `throttled = true` | antal |
| `ipa_provider_timeouts{runtime,operation}` | Antal `provider_call` med `timeout = true` | antal |
| `ipa_provider_latency_ms{runtime,operation}` | `duration_ms` | ms (fordeling) |

Raterne er forholdet mellem to tællinger i samme vindue: udbyderens fejlrate
(`ipa_provider_errors` / `ipa_provider_calls`), 429-raten (`ipa_provider_throttled` /
`ipa_provider_calls`) og timeout-raten (`ipa_provider_timeouts` / `ipa_provider_calls`).

## Alarmer

| # | Alarm | Betingelse | Tærskel | Vindue | Alvor | Grundlag |
|---|---|---|---|---|---|---|
| A1 | Embedding-fejlrate, forespørgsler | `step_failures{query_embedding}` / `step_attempts{query_embedding}` | > 5 % | 15 min | warning | §14 |
| A2 | Embedding-fejlrate, ingestion | `provider_errors` / `provider_calls` for `runtime = worker`, `operation = embed_document` | > 5 % | 15 min | warning | §14 |
| A3 | Reranking-fejlrate | `step_failures{rerank}` / `step_attempts{rerank}` | > 1 % | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A4 | Reranking-latency | p95 af `latency_ms{rerank}` | > 1.000 ms | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A5 | Retrieval-latency, hele kæden | p95 af `latency_ms{total}` | > 1.500 ms | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A6 | 429-rate (throttling), embedding | `provider_throttled` / `provider_calls` for `embed_query` og `embed_document`, pr. `runtime` | > 5 % | 15 min | warning | §14 |

Timeout-raten og udbyderens fejlrate pr. operation kan beregnes og vises, men §14 fastsætter
ingen særskilt tærskel for dem. Der er derfor ingen alarm (ingen opfundet tærskel).

**Fælles regler (B-033, version 1):**
- **Minimum 20 relevante forsøg.** En rate- eller p95-alarm vurderes kun, hvis vinduet
  indeholder mindst 20 relevante forsøg (`minimumSamples` i `aggregate-alarms.json`). Ved lav
  trafik, som i en pilot med ca. 10 brugere, giver én fejl ellers 100 %. Minimummet er
  versioneret konfiguration og ændres kun med en ny version.
- **Minimummet gælder ikke enkelthændelser.** Hård regression, suspendering, ugyldig evaluering,
  utilgængelig scanner, fund af malware, utilgængelig retrieval, konfigurationsafvigelse og de
  øvrige kritiske invarianter (`singleEventAlarms`) rejses ved første hændelse.
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
| Embedding-modellen svarer ikke som sin godkendte reference (kontrolsættet, §2.5) | Workerens kontrol ved start og dagligt (`embedding_model_changed`, kritisk) og `deploy/ingestion-worker/alarms.json` (8B-I8 C6) |
