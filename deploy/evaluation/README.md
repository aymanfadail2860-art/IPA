# Evalueringsdrift — evalueringsmiljø, publicering og regression (8B-I7)

Specifikation: `docs/08b-production-foundation.md` §4.5, §10.2, §12, §14 og §21.12 (B-032).
Workflow: `.github/workflows/retrieval-evaluation.yml`.

## Hvad der kører hvor

| Del | Miljø | Identitet | Credential |
|---|---|---|---|
| Provisionering og evalueringskørsel (`npm run eval:retrieval -- --adapter evaluation`) | Evalueringsmiljøet: eget Supabase-projekt, egen worker og scanner, rigtige udbydere | Evalueringsoperatør og evalueringsbrugere (oprettes af kørslen) | Evalueringsprojektets URL, anon- og service-role-nøgle i `ipa/evaluation/supabase` (evalueringskontoen) |
| Publicering (`npm run eval:publish`) | Produktionsdatabasen | `evaluation_publisher_login` (kun fire funktioner, fra 8B-I7.1) | `ipa/production/evaluation-publisher/db` (produktionskontoen) |
| Sundhedskontrol hvert 5. minut | Produktionens worker | `ingestion_worker_login_*` (`knowledge.worker_system_health`) | Workerens eksisterende |

Ingen af de to CI-jobs ser den andens credential. Publiceringsjobbet afviser at starte, hvis en
applikationsnøgle er sat (`workers/evaluation/publish.ts`).

## Opsætning (når kontiene findes)

1. **Evalueringsprojekt i Supabase** (EU), adskilt fra produktion. Samme migrationer. Derefter,
   som projektets ejer:

   ```sql
   select ops.set_environment_kind('evaluation');
   ```

   Produktionsprojektet markeres tilsvarende med `'production'`. Evalueringen nægter at køre mod
   en database, der ikke siger `evaluation` — før der læses eller skrives noget.
2. **Evalueringsmiljøets worker og scanner** udrulles som i produktion
   (`deploy/ingestion-worker/`, `deploy/clamav/`) mod evalueringsprojektet, med Bedrock i
   evalueringskontoen.
3. **Secret `ipa/evaluation/supabase`** (evalueringskontoen):
   `{"url": "...", "anon_key": "...", "service_role_key": "..."}`.
4. **IAM i evalueringskontoen:** rollen `ipa-evaluation-runner` med
   `iam/runner-trust-policy.json` (GitHub-environment `evaluation`) og `iam/runner-policy.json`
   (kun den secret og Bedrock-modellerne under evaluering).
5. **IAM i produktionskontoen:** rollen `ipa-evaluation-publisher` med
   `iam/publisher-trust-policy.json` (GitHub-environment `evaluation-publication`) og
   `iam/publisher-policy.json` (kun publisher-secretten).
6. **Publisher-identiteten i produktion** (en gang, som databasens ejer):

   ```sql
   select ops.evaluation_publisher_prepare();
   alter role evaluation_publisher_login password '<tilfældig, mindst 32 tegn>' valid until '<dato om højst 90 dage>';
   ```

   Passwordet lægges i `ipa/production/evaluation-publisher/db` som
   `{"host": "db.<ref>.supabase.co", "port": 5432, "username": "evaluation_publisher_login", "password": "..."}`.
   `valid until` gør credentialet tidsbegrænset i databasen selv. Rotation: nyt password med ny
   udløbsdato, derefter secretten. Nødspærring: `select ops.evaluation_publisher_deactivate('emergency_revoked');`.
7. **Supabases CA** i `deploy/ingestion-worker/certs/supabase-ca.crt` (samme fil som workeren).
8. **GitHub:** environments `evaluation` og `evaluation-publication` (kun `main`); variablerne
   `IPA_EVAL_AWS_ACCOUNT_ID`, `IPA_AWS_ACCOUNT_ID`, `IPA_EVAL_SET`, `IPA_EVAL_GATES` og
   `IPA_EVAL_ACTIVE_CONFIGURATION` (filnavnet under `evals/retrieval/configurations/` for
   konfigurationen i drift). Valgfrit: secretten `IPA_ALERT_WEBHOOK_URL` (Å-5).

## Kørsler

`mode` er CI-jobbets ønske og kun diagnostik (8B-I7.1, B-033). Databasen klassificerer den
registrerede kørsel ud fra konfigurationens status ved registreringen. Alarmerne følger
databasens klassifikation, ikke `mode`. En ugyldig kørsel (H7, eller H6 uden for drift) afvises
og giver alarmen `evaluation_invalid`.

- **Baseline** (manuel, `mode: baseline`): en kandidatkonfiguration evalueres og registreres som
  kandidat. Godkendelse og aktivering sker derefter af et menneske i produktion.
- **Regression** (ugentlig, ved hver ændring af model, reranker, chunker, algoritme eller
  parametre, eller manuel): konfigurationen i drift evalueres igen. Registreringen:
  - hårdt gate-brud → konfigurationen suspenderes i samme transaktion, al evidens er straks
    `development`, ingen fallback; alarm `hard_gate_regression` (kritisk);
  - fejlet kvalitetsgate → alarm `quality_regression` til vurdering; konfigurationen forbliver
    aktiv;
  - hændelsen auditeres (`knowledge.evaluation_run.regression`) med evalueringssæt, gate-sæt og
    runtime-fingeraftryk.
- **Reproducerbarhed:** samme sæt (id, version, checksum), gate-sæt (version, checksum),
  konfiguration (fingeraftryk) og korpus (checksum før og efter) giver en sammenlignelig kørsel.
  Provisioneringen er idempotent, så korpusset er det samme fra kørsel til kørsel.
- **Versionerede rapporter:** artefaktet `retrieval-evaluation-<run>` (400 dage) indeholder
  rapporten (`reportSchema`, motorversion, egne checksums), Markdown, performance-målingen og
  en SHA-256-liste, som publiceringen efterprøver. Den registrerede kørsel gemmer hele rapporten.

## Performance (§12, §17 pkt. 10)

Hver kørsel måler p50/p95 for hele kæden, embedding af forespørgsel, databasesøgning og
reranking, og provisioneringen måler ingestion pr. dokument. Målingen registreres med
konfigurationens fingeraftryk. Mål, der ikke er nået eller ikke er målt, er afvigelser; de
godkendes dokumenteret med `knowledge.accept_performance_deviation` (system.settings.manage).

## Alarmer

`AlertSink` (D-15): `log` altid; `webhook` når `IPA_ALERT_SINK=webhook` og
`IPA_ALERT_WEBHOOK_URL` er sat. Hvilken tjeneste og hvem der modtager, er Å-5 — en
deploymentbeslutning. Workerens alarmlinjer bliver desuden CloudWatch-alarmer
(`deploy/ingestion-worker/alarms.json`) på alarmtopic'en.
