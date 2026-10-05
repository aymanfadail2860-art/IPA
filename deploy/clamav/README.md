# ClamAV-tjenesten — deployment-specifikation (8B-I5.5)

Workerens malware-scanner som **egen ECS Fargate-service** (`docs/08b` §21.7, B-027). Den
læser fjendtlige filer og har derfor ingen AWS-credentials, ingen secrets og ingen vej ud.

| Fil | Indhold |
|-----|---------|
| `Dockerfile` | ClamAV 1.4.3 (pinned) med de officielle signaturer bygget ind ved byggetid; ikke-root; byggeregistrering i `/usr/share/ipa/scanner-build.txt` |
| `clamd.conf` | TCP 3310, ingen signaturopdatering ved kørsel, grænser over 50 MB, fund ved overskredne grænser |
| `task-definition.json` | Fargate 1 vCPU/3 GB, **ingen taskrolle**, intet miljø, ingen secrets, skrivebeskyttet rodfilsystem, `/tmp`-volumen, image refereret med digest |
| `service.json` | Private subnets, ingen offentlig IP, ingen ECS Exec, Cloud Map-registrering, rullende udskiftning (100/200 %) med circuit breaker og rollback |
| `service-discovery.json` | Cloud Map: privat namespace `ipa-worker.internal`, service `clamav`, A-record (TTL 10 s), kun sunde tasks |
| `security-group.json` | Indgående kun TCP 3310 fra workerens security group. Udgående kun 443 til VPC-endpoints (ECR, logs) og S3-gatewayen |
| `iam/execution-role-policy.json` | Execution-rollen (ECS' egen): hente `ipa-clamav`-imaget og skrive `/ipa/clamav` — intet andet |
| `iam/ci-publisher-*.json` | Den planlagte pipelines rolle (GitHub OIDC, kun `main`): pushe `ipa-clamav`, udrulle `ipa-clamav`, videregive kun scannerens execution-rolle |
| `alarms.json` | Metric filters og alarmer: signaturalder over 18 t, tekniske scanfejl, mislykket udrulning |

## Roller

- **Taskrolle:** ingen. Processerne i containeren får ingen AWS-credentials, så de kan hverken
  kalde Bedrock eller nogen anden AWS-tjeneste.
- **Execution-rolle** (`ipa-clamav-execution`): bruges kun af ECS/Fargate-agenten til at hente
  imaget og sende logs. Den er ikke tilgængelig for containerens processer.
- Workerens taskrolle (Embed v4) hører kun til worker-tasken.

## Netværk

```
worker-task (SG ipa-ingestion-worker) ── TCP 3310 ──► ClamAV-task (SG ipa-clamav, private subnets)
                                                        └─ 443 kun til VPC-endpoints: ecr.api, ecr.dkr, logs; S3-gateway
```

- Ingen 0.0.0.0/0, ingen NAT-rute og ingen offentlig IP. Port 3310 er ikke åben for VPC'en, kun
  for workerens security group.
- Workeren finder tjenesten via Cloud Map-DNS. Kun tasks, hvis healthcheck (`clamdscan --ping`)
  består, registreres.

## Signaturer og udrulning

Planlagt workflow `.github/workflows/clamav-signatures.yml` (hver 6. time):

1. Byg imaget. `freshclam` henter de officielle signaturer ved byggetid.
2. Start kandidaten skrivebeskyttet og uprivilegeret.
3. Verificér med `scripts/verify-clamav-scanner.ts`:
   - engine 1.4.3;
   - signaturversion og -tid kendt, ikke i fremtiden og højst 8 timer gamle;
   - EICAR findes;
   - en ren fil er ren.
4. Push med det uforanderlige tag `<engine>-<signaturversion>`. Det er scanner-revisionen, som
   står i `security_verdicts.scanner_revision`.
5. Registrér en taskrevision med image-digest, udrul og vent, til servicen er stabil.

**Hvis noget fejler:**

- Intet nyt udrulles, og den kørende scanner bliver.
- Alarmerne udløses: workflowfejl, `SERVICE_DEPLOYMENT_FAILED`, signaturalder over 18 timer og
  tekniske scanfejl.
- Når signaturerne passerer 24 timer, giver ingen scanning `safe`. Filerne venter som "Teknisk
  scanfejl" og frigives ved genforsøg, når en frisk revision kører.
- Der findes intet flag, der ignorerer forældede signaturer.

**Manuel kørsel:** `workflow_dispatch` på workflowet. Byg aldrig et produktionsimage i hånden.

## Forudsætninger (når produktionskontoen findes)

- ECR-repositoriet `ipa-clamav` (uforanderlige tags).
- Private subnets til scanneren og VPC-endpoints for ECR api/dkr, CloudWatch Logs og
  S3-gatewayen.
- Cloud Map-namespacet `ipa-worker.internal` (`service-discovery.json`).
- Rollerne `ipa-clamav-execution` og `ipa-clamav-publisher` med GitHub OIDC-provider.
- Repository-variablerne `IPA_AWS_ACCOUNT_ID` og `IPA_ECS_CLUSTER`. Indtil de er sat, gør
  workflowet ingenting.
- Alarmtopic (`${ALARM_TOPIC_ARN}`, åbent spørgsmål Å-5).
