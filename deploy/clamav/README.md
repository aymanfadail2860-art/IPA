# ClamAV-scanneren (8B-I5.5; beta B-035 L2)

Workerens malware-scanner kører i **sin egen container**, aldrig i workerens (`docs/08b` §21.7,
B-027). Den læser fjendtlige filer og har derfor ingen credentials, intet miljø og ingen vej ud.
I betaen kører den sammen med workeren som engangsimport på en betroet maskine
(`deploy/import/compose.yaml`, `docs/beta.md` §6). AWS-specifikationerne fra 8B (ECS, Cloud Map,
security groups, IAM og CloudWatch) er fjernet i L2 og kan gendannes fra Git-historikken.

| Fil | Indhold |
|-----|---------|
| `engine.json` | Den godkendte engine (8B-I5.6): LTS-linje 1.4, production 1.4.6, base-image og dets godkendte digest. Ændres kun ved godkendt engine-opgradering (`clamav-engine-candidate.yml`) |
| `Dockerfile` | Den godkendte engine (via `CLAMAV_BASE`) med officielle signaturer bygget ind ved byggetid; ikke-root; byggeregistrering i `/usr/share/ipa/scanner-build.txt` |
| `clamd.conf` | TCP 3310, ingen signaturopdatering ved kørsel, grænser over 50 MB, fund ved overskredne grænser |

**Isolation** (`deploy/import/compose.yaml`, testet i `src/tests/scanner-isolation.test.ts`):
- egen container;
- uprivilegeret bruger, skrivebeskyttet rodfilsystem, ingen capabilities og ingen
  rettighedsforøgelse;
- intet miljø og ingen credentials;
- kun det interne netværk `scan`, som ingen andre end workeren er på, og ingen internetadgang;
- workeren når den kun på det faste endpoint `clamav:3310`.

**Signaturer:** imaget bygges lige før hver import med friske officielle signaturer. Workeren
afviser signaturer, der er ældre end 24 timer, og fejler lukket, hvis scanneren ikke svarer.
Runbooken følger i L3.
