# Ingestion-workeren — deployment-specifikation (8B-I4)

Versionsstyret specifikation for ingestion-workeren som AWS ECS Fargate-workload
(`docs/08b-production-foundation.md` §6.1 og §21.5). Projektet har ikke valgt et
IaC-framework (Terraform, CDK eller Pulumi). Filerne her er derfor de præcise definitioner, som
driften anvender med AWS CLI, når produktionskontoen findes. Pladsholdere står som `${NAVN}`.

> **Release-gate (8B-I5):** Hver upload undersøges i karantæne (scan-job: byteniveau-validering,
> ClamAV i sidecaren, PDF-inspektion). Workeren behandler kun en fil, når databasen har frigivet
> netop de scannede bytes (`workers/ingestion/gate.ts`, `docs/08b` §21.6).

| Fil | Indhold |
|-----|---------|
| `Dockerfile` | Image i flere trin, kun runtime-dependencies, ikke-root, ingen build-argumenter eller hemmeligheder |
| `package.json`, `package-lock.json` | Imagets eneste dependencies: `postgres` og `pdfjs-dist` (samme versioner som rodens lockfil) |
| `task-definition.json` | ECS-taskdefinition: Fargate, 1 vCPU/4 GB, workeren (2 GB) og ClamAV-sidecaren `clamav` (2 GB), skrivebeskyttede rodfilsystemer, `/tmp`-volumener, miljø, secrets (kun workeren), healthchecks, logs |
| `../clamav/` | ClamAV-sidecarens image (signaturer bygget ind ved byggetid) og `clamd.conf` (kun `127.0.0.1:3310`) |
| `service.json` | ECS-service: 1 task, rullende deployment med circuit breaker, private subnets, ingen offentlig IP |
| `security-group.json` | Ingen indgående trafik. Udgående kun 443 og 6543 |
| `iam/execution-role-policy.json` | Execution-rollen: image-pull, logs, injektion af den ene secret |
| `iam/task-role-policy.json` | Task-rollen: forberedt Bedrock Embed v4 via EU-inferensprofilen, intet andet |
| `iam/ecs-tasks-trust-policy.json` | Kun ECS-tasks i kontoen kan påtage sig rollerne |
| `certs/` | Supabases CA (offentligt certifikat), som lægges her, før imaget bygges |

## Byg og registrér

```bash
docker build -f deploy/ingestion-worker/Dockerfile -t ipa-ingestion-worker:$(git rev-parse --short HEAD) .
# push til ECR-repositoriet ipa-ingestion-worker, og udfyld derefter pladsholderne:
envsubst < deploy/ingestion-worker/task-definition.json > /tmp/task.json
aws ecs register-task-definition --cli-input-json file:///tmp/task.json
envsubst < deploy/ingestion-worker/service.json > /tmp/service.json
aws ecs create-service --cli-input-json file:///tmp/service.json   # første gang
```

## Netværk

```
Fargate-task (privat subnet, ingen offentlig IP, ingen indgående trafik)
  → NAT-gateway med Elastic IP (offentligt subnet)
  → Supavisor :6543 (transaktionstilstand, TLS)  → Supabase Postgres
  → HTTPS :443  → Edge Function worker-storage, Bedrock, ECR, CloudWatch, Secrets Manager
```

- Supabase Network Restrictions skal tillade **NAT-gatewayens Elastic IP (/32)** samt
  driftens egne IP'er til migrationer. Begrænsningen gælder Postgres og pooleren.
- Network Restrictions beskytter **ikke** Supabases HTTPS-API'er (Edge Functions, Storage,
  PostgREST). Det er engangsbilletten, der er sikkerhedsgrænsen for `worker-storage`.
- VPC-endpoints (ECR api/dkr, S3-gateway, CloudWatch Logs, Secrets Manager, bedrock-runtime) er
  valgfrie. De holder AWS-trafik væk fra NAT'en.
- `${PRIVATE_SUBNET_A/B}`, `${WORKER_SECURITY_GROUP_ID}` og NAT-gatewayen oprettes, når kontoen
  findes [AFKLARES].

## Secret og blue/green

- **Secret:** `ipa/production/ingestion-worker/db` i Secrets Manager, krypteret med en
  KMS-nøgle (`${WORKER_SECRET_KMS_KEY_ARN}`). Værdien er JSON: `{"username":
  "ingestion_worker_login_<farve>.<projekt-ref>", "password": "…"}`.
- **Injektion:** ECS henter `username` og `password` fra den aktuelle version (`AWSCURRENT`), når
  en task starter. Det sker via `secrets` i taskdefinitionen og execution-rollen, og værdierne
  sættes som `IPA_WORKER_DB_USER` og `IPA_WORKER_DB_PASSWORD`. Workeren læser aldrig Secrets
  Manager selv.
- Hemmeligheden er aldrig i imaget, i repoet, i build-argumenter, i almindelige miljøvariabler i
  taskdefinitionen eller i logs.
- **Hvilken farve er aktiv?** Den, som secretens aktuelle version peger på. Skiftet blue → green
  kræver ingen kodeændring og ingen ny taskdefinition.

**Rotation** (D-20, `docs/08b` §21.4):

1. `\password ingestion_worker_login_green` i psql som `postgres`. Passwordet genereres med
   `openssl rand -base64 48`, og SCRAM-verifieren beregnes klientside.
2. `select ops.ingestion_worker_prepare('ingestion_worker_login_green');`
3. `aws secretsmanager put-secret-value --secret-id ipa/production/ingestion-worker/db
   --secret-string file://-` med greens brugernavn og password. Indtast det på stdin, så det ikke
   havner i shell-historikken.
4. `aws ecs update-service --cluster ${ECS_CLUSTER} --service ipa-ingestion-worker
   --force-new-deployment`
   - Nye tasks starter med green. De gamle blue-tasks får SIGTERM og stopper med at tage jobs.
   - Et igangværende job får op til 90 sekunder til at blive færdigt. Ellers opgives det, og
     leasen overtages.
   - ECS venter 120 sekunder (`stopTimeout`).
5. Verificér, at `select ops.ingestion_worker_status();` viser sessioner for green, ingen for
   blue efter deployment og ingen overtrædelser. Kontrollér også CloudWatch for `worker_start`
   med `role: ingestion_worker_login_green`.
6. `select ops.ingestion_worker_retire('ingestion_worker_login_blue');` Den gamle
   secret-version udfases.

**Nødspærring:** `select ops.ingestion_worker_emergency_revoke('<rolle>');`

- Workerens næste databasekald afvises, og processen afslutter med kode 2.
- ECS starter nye tasks, som ikke kan logge ind, indtil den anden rolle er klargjort og secreten
  opdateret (trin 1–4).
- `ops.ingestion_worker_set_api(false)` stopper begge roller på én gang.

## Kørsel, sundhed og nedlukning

- **Løkken:** claim → behandling → complete/fail. Heartbeat kører på egen timer hvert 60.
  sekund (lease 300 sekunder).
- **Tom kø:** backoff fra 2 til 30 sekunder.
- **Fejl i database eller netværk:** backoff fra 1 til 60 sekunder.
- **Afvist identitet** (`28P01`, `28000`, `42501`): exit 2.
- **Healthcheck:** `node workers/ingestion/healthcheck.ts`. Løkken og heartbeat opdaterer
  `/tmp/ipa-worker/alive`. En hængt løkke eller et job, der er gået i stå, får tasken erstattet.
- **SIGTERM:** ingen nye jobs. Det igangværende job får 90 sekunder, og ellers opgives det uden
  "fake complete".
- **Logs:** struktureret JSON i CloudWatch (`/ipa/ingestion-worker`). Der logges aldrig
  dokumenttekst, tokens, billetter, passwords eller PII.
- `pdfjs-dist` skriver ved indlæsning to linjer på stderr om den udeladte valgfrie
  `@napi-rs/canvas`. Tekstudtrækket er identisk med og uden den (verificeret).

## ClamAV-sidecar (8B-I5)

```bash
# Bygges efter en fast plan (anbefalet hver 6. time) — signaturerne hentes HER, ved byggetid:
docker build -f deploy/clamav/Dockerfile -t ipa-clamav:$(date -u +%Y%m%d%H%M) .
# push til ECR-repositoriet ipa-clamav; registrér en ny taskdefinition med ${CLAMAV_IMAGE_TAG}
# og udrul (aws ecs update-service --force-new-deployment).
```

- clamd lytter kun på `127.0.0.1:3310` i tasken. Workeren forbinder dertil (`IPA_CLAMD_HOST`,
  `IPA_CLAMD_PORT`); konfigurationen afviser enhver anden vært i produktion.
- Containeren har ingen secrets og intet miljø, henter intet ved kørsel og kører som uid 10001 på
  et skrivebeskyttet rodfilsystem. Workeren starter først, når clamd er sund.
- **Signaturernes alder:** workeren logger `scanner_status` ved start (version, signaturversion,
  alder). Er signaturerne ældre end 24 timer, giver ingen scanning `safe` — filerne venter som
  "Teknisk scanfejl" og prøves igen. Signaturimaget skal derfor udrulles mindst hver 24. time.
- CI-pipeline og spejl til `freshclam` (fx `cvdupdate` i et privat spejl) [AFKLARES].
- **Blast radius:** en kompromitteret clamd har ingen database-credential, service_role eller
  billet, men deler taskens rolle (kun Embed v4) og udgående 443 (B-026) [AFKLARES].

