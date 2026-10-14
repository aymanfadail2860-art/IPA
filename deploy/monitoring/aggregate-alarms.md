# Aggregerede alarmer: fejlrate, throttling og latency (B-033)

Specifikation: `docs/08b-production-foundation.md` §14, §21.13 og §21.15 (C3),
`docs/decisions.md` B-033 og B-037. Den maskinlæsbare udgave er `aggregate-alarms.json`,
version 2. En test holder de to filer og felterne i koden i overensstemmelse.

**Version 2 (beta L2, B-037):** AWS er fjernet fra den aktive beta (`docs/beta.md` §14). Linjen
`provider_call` havde kun Bedrock som kilde. Den er derfor fjernet sammen med alarmerne A2 og A6
og CloudWatch-alarmerne. Numrene A2 og A6 genbruges ikke. Claude-adapteren (L4) får sine egne kald-linjer og alarmer i en ny version.

**Status:** loglinjerne bærer de felter, alarmerne kræver, også udbyderens fejltype (8B-I8 C3).
Selve alarmerne bygges i den valgte log- og monitoreringsplatform: Vercels logs eller en
log-drain for appen og importkørslens log for workeren. Applikationen skal ikke have sit eget
metrics-system (B-033). **Alarmerne skal være i drift før den kontrollerede Copilot-pilot**
(B-030, B-033). Hvem der modtager dem, og via hvilken tjeneste, er stadig åbent (Å-5).

De alarmer, som platformen allerede selv rejser, findes under [Allerede implementeret](#allerede-implementeret-ikke-aggregeret).
Denne fil beskriver kun de alarmer, der kræver aggregering over et tidsvindue.

## Kilder

| Kilde | Hvor | Loglinje | Felter |
|---|---|---|---|
| Appens retrieval | Vercel (appens funktioner) | `event = "retrieval"`, én pr. retrieval (`src/lib/observability/retrieval-telemetry.ts`) | `request_id`; `outcome` (`evidence`, `insufficient`, `error`); `error_code` (kun ved `error`); `failed_steps` (`query_embedding`, `search`, `rerank`, `total`); `steps_ms.total`, `steps_ms.query_embedding`, `steps_ms.search`, `steps_ms.rerank` (hele ms); `configuration_id`; `provider_errors` (trinnet, hvor udbyderen fejlede: `step`, `provider`, `provider_error_kind`, `throttled`, `timeout`, `retryable`, `http_status`, `error_class`, `attempts`) |
| Workerens behandlingstrin | Importkørslens log (workerens stdout) | `event = "job_step"` med `step` og `ms` (et gennemført trin) | `step`, `ms` |
| Workerens fejlede job | Importkørslens log (workerens stdout) | `event = "job_step"` med `outcome` (`retry` eller `failed`) | `step` (trinnet, der fejlede), `ms`, `error`; ved udbyderfejl også `provider`, `operation`, `provider_error_kind`, `throttled`, `timeout`, `http_status`, `attempts` |

Med `product_documents` (B-035) kører retrieval uden embedding og reranking. Trinnene
`query_embedding` og `rerank` forekommer derfor ikke i betaen, og A1, A3 og A4 får ingen
forsøg at vurdere.

Loglinjerne indeholder aldrig forespørgsler, titler, dokumenttekst, udbyderens fejltekst,
credentials eller bruger-id'er. Det må dimensionerne heller ikke.

## Dimensioner (labels)

| Dimension | Værdi | Kilde |
|---|---|---|
| `environment` | `production` eller `pilot`/`staging` | Deploymentet (Vercel-projekt/-miljø, importkørslen), ikke loglinjen |
| `configuration_id` | Retrieval-konfigurationen i drift, eller tom | `retrieval` |
| `step` | `total`, `query_embedding`, `search`, `rerank` | `steps_ms`/`failed_steps` |
| `provider_error_kind` | Udbyderfejlens type | `provider_errors`, `job_step` |
| `error_code` | RetrievalError-koden | `retrieval` (kun ved `outcome = "error"`) |

## Metrics

| Metric | Definition | Enhed |
|---|---|---|
| `ipa_retrieval_requests` | Antal `event = "retrieval"` | antal |
| `ipa_retrieval_step_attempts{step}` | Antal `event = "retrieval"`, hvor `steps_ms.<step>` findes, eller hvor `failed_steps` indeholder `<step>` | antal |
| `ipa_retrieval_step_failures{step}` | Antal `event = "retrieval"`, hvor `failed_steps` indeholder `<step>` | antal |
| `ipa_retrieval_latency_ms{step}` | `steps_ms.<step>` | ms (fordeling: p50 og p95) |

Raterne er forholdet mellem to tællinger i samme vindue (`step_failures` / `step_attempts`).

## Alarmer

| # | Alarm | Betingelse | Tærskel | Vindue | Alvor | Grundlag |
|---|---|---|---|---|---|---|
| A1 | Embedding-fejlrate, forespørgsler | `step_failures{query_embedding}` / `step_attempts{query_embedding}` | > 5 % | 15 min | warning | §14 |
| A3 | Reranking-fejlrate | `step_failures{rerank}` / `step_attempts{rerank}` | > 1 % | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A4 | Reranking-latency | p95 af `latency_ms{rerank}` | > 1.000 ms | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |
| A5 | Retrieval-latency, hele kæden | p95 af `latency_ms{total}` | > 1.500 ms | 15 min | warning | §14 (tærskel), B-033 (vindue og alvor) |

**Fælles regler (B-033, version 1):**
- **Minimum 20 relevante forsøg.** En rate- eller p95-alarm vurderes kun, hvis vinduet
  indeholder mindst 20 relevante forsøg (`minimumSamples` i `aggregate-alarms.json`). Ved lav
  trafik, som i en pilot med ca. 10 brugere, giver én fejl ellers 100 %. Minimummet er
  versioneret konfiguration og ændres kun med en ny version.
- **Minimummet gælder ikke enkelthændelser.** Hård regression, suspendering, ugyldig evaluering,
  utilgængelig scanner, fund af malware, utilgængelig retrieval, konfigurationsafvigelse og de
  øvrige kritiske invarianter (`singleEventAlarms`) rejses ved første hændelse.
- Uden data i vinduet rejses ingen rate- eller latency-alarm. Tavshed overvåges et andet sted:
  appen rejser `retrieval_unavailable`. Workeren kører i betaen som en enkelt importkørsel
  (`--once`), hvor operatøren ser resultatet direkte. En alarm for en tavs, kørende worker
  (`ipa-health-check-silent`) fandtes kun i ECS-udrulningen og er fjernet med den (B-037).
- Alvoren følger `AlertSink`-kataloget: alle aggregerede alarmer er `warning`. Retrieval, der er
  helt utilgængelig, er allerede `critical` (`retrieval_unavailable`).
- Alarmen sendes til samme modtager som `AlertSink`-alarmerne (Å-5). Den skal indeholde alarmens
  nummer (A1, A3–A5), `environment`, vinduet og den målte værdi, aldrig indhold.

## Allerede implementeret (ikke aggregeret)

| Signal (§14) | Hvor |
|---|---|
| Kø og ældste ventende job, dead-letter, versioner under behandling, scanner-fejl og fund, suspenderet konfiguration og kvalitetsregression | Workerens sundhedskontrol (`AlertSink`) og Systemstatus i Admin |
| Retrieval utilgængelig, runtime-fingeraftryk ≠ aktiv konfiguration | Appens retrieval-telemetri (`AlertSink`, højst én alarm pr. kode pr. 10 min) |
| Hård regression, kvalitetsregression, ugyldig kørsel, afvist publicering | Publiceringstrinnet (`AlertSink`) efter databasens klassifikation (8B-I7.1) |
| Embedding-modellen svarer ikke som sin godkendte reference (kontrolsættet, §2.5) | Workerens kontrol ved start og dagligt (`embedding_model_changed`, kritisk; 8B-I8 C6). Betaen har ingen embedding-model, så kontrollen har intet at måle |
| Signaturernes alder og scannerens tilgængelighed | Hver scanning afviser signaturer over 24 timer og en utilgængelig scanner (fail-closed); fejlene tælles i `scanner_failures` og Systemstatus. Workeren logger scannerens tilstand ved start (`scanner_status`). |
