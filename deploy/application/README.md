# Appen på Vercel — AWS-adgang (8B-I8 C1)

Appens server-retrieval kalder Bedrock (forespørgsels-embedding med Embed v4 og reranking med
Rerank 3.5) med **Vercel OIDC → AWS STS → kortlivede credentials**
(`docs/08b` D-11 og §21.15). Der ligger aldrig en AWS-nøgle i Vercel.

| Fil | Indhold |
|-----|---------|
| `iam/vercel-oidc-trust-policy.json` | Kun Vercel-projektets production-miljø kan påtage sig rollen, og kun med audience `sts.amazonaws.com` |
| `iam/bedrock-policy.json` | Kun `bedrock:InvokeModel` på Embed v4 via EU-inferensprofilen og på Rerank 3.5 i `eu-central-1` |

## Opsætning (når produktionskontoen findes)

1. **OIDC-provider i IAM:** issuer `https://oidc.vercel.com/${VERCEL_TEAM_SLUG}` (Vercels
   team-issuer) med client-id (audience) `sts.amazonaws.com`.
2. **Rollen `ipa-application`** med `iam/vercel-oidc-trust-policy.json` og
   `iam/bedrock-policy.json`. Pladsholdere står som `${NAVN}`.
3. **Vercel-projektet:** OIDC Federation slået til (team-issuer). Miljøvariabler i
   production-miljøet:
   - `IPA_AWS_ROLE_ARN` — rollens ARN (konfiguration, ikke en hemmelighed);
   - `IPA_AWS_OIDC_AUDIENCE` — kun hvis trust-politikken kræver en anden audience end
     `sts.amazonaws.com`.

   Vercel må **ikke** have `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`,
   `AWS_PROFILE`, `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE` eller credential-filer. Appen gør
   retrieval utilgængelig, hvis en af dem er sat (fail-closed), og falder aldrig tilbage til dem.

## Verificeres ved første deployment [AFKLARES]

Koden er testet uden en AWS-konto. Følgende kan kun bekræftes i det rigtige miljø og er en del af
den eksterne validering:

- at Vercels token-udveksling til audience `sts.amazonaws.com` accepteres af IAM-provideren og
  trust-politikken (ellers sættes `IPA_AWS_OIDC_AUDIENCE` til den audience, politikken angiver);
- at `sub` har formatet `owner:<team>:project:<projekt>:environment:production`;
- at STS-kaldet sker i `eu-central-1` og giver credentials, som Bedrock accepterer;
- at preview- og development-miljøer ikke kan påtage sig rollen.
