# Ingestion-workeren (8B-I4; beta B-035 L2)

Workeren kører som en selvstændig Node-proces uden for Next.js-appen (`docs/08b` §6.1 og
§21.5). I betaen kører den som **administratorens engangsimport på en betroet maskine**
(`--once`, `deploy/import/compose.yaml`, `docs/beta.md` §6). Runbooken og den første rigtige
import hører til L3. AWS-specifikationerne fra 8B er fjernet i L2 og kan gendannes fra
Git-historikken:
- ECS-task og -service, security group og IAM-roller;
- Bedrock-embedder og credentials;
- CloudWatch-alarmer.

> **Release-gate (8B-I5):** hver upload undersøges i karantæne, i scan-jobbet:
> - validering på byteniveau;
> - ClamAV i egen container (`deploy/clamav/`);
> - PDF-inspektion i en børneproces uden miljø.
>
> Workeren behandler kun en fil, når databasen har frigivet netop de scannede bytes
> (`workers/ingestion/gate.ts`, `docs/08b` §21.6).

| Fil | Indhold |
|-----|---------|
| `Dockerfile` | Image i flere trin, kun runtime-dependencies (`postgres`, `pdfjs-dist`), ikke-root, ingen build-argumenter eller hemmeligheder, ingen cloud-SDK |
| `package.json`, `package-lock.json` | Imagets eneste dependencies (samme versioner som rodens lockfil) |
| `certs/` | Supabases CA (offentligt certifikat), som lægges her, før imaget bygges |

**Identitet:** workeren forbinder som sin least-privilege login-rolle (blue/green, 8B-I3) gennem
Supavisor med TLS (verify-full). Den bruger aldrig service_role, og service-rollens nøgle afvises
i produktion. Rollens credential sættes i operatørens miljø ved kørslen og findes aldrig i repoet
eller i et image.

**Embeddings:** betaen har ingen embedding-model (`product_documents`, B-035). Workeren bygger kun
den lokale test-embedder i local/test. En aktiv production-model kan ikke bygges, og så nægter
workeren at starte.
