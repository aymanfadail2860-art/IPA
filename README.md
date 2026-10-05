# Insurance Partners (IPA)

AI-baseret platform til erhvervsforsikringsrådgivere. Projektets styrende instruktioner står i
`CLAUDE.md`, specifikationen i `docs/` og faseoversigten i `docs/roadmap.md`.

**Status:** Fase 1–7 og underfase 8A — AI Gateway er gennemført og låst
(`docs/08-ai-gateway.md`). Masterfase 8 — AI Copilot fortsætter med 8B. Specifikationen er godkendt og
låst (`docs/08b-production-foundation.md`). Deltrin 8B-I1 (evalueringsframework og gates) er
gennemført, og det samme er 8B-I2 (production embedding og reranking på AWS Bedrock, ikke koblet
ind i appen) og 8B-I2.5 (ekstern AI-datagrænse: kundedata forlader aldrig platformen til en ekstern
AI-udbyder) og 8B-I3 (workerens databaseidentitet: blue/green-roller, worker-API med lease-token og
billetkontrakt). 8B-I4 (workerens runtime til AWS ECS Fargate, `deploy/ingestion-worker/`) er
implementeret og afventer godkendelse. Produktionsbehandling af rigtige dokumenter er spærret
indtil 8B-I5. 8C er ikke påbegyndt. Master-roadmappen med de 21 låste faser står i `docs/roadmap.md`. Moduler fra senere faser viser stadig fiktive
udviklingsdata. Vercel-demoen kører uden database (B-003) og viser derfor ikke Knowledge
Engine-administrationen.

## Kom i gang

Kræver Node.js 22+ (workeren kører TypeScript direkte) og Docker (til den lokale Supabase).

```bash
npm install
npx supabase start          # lokal database, Auth, API og Storage; migrationerne køres
npx supabase status         # URL og nøgler til .env.local
cp .env.example .env.local  # udfyld værdierne — aldrig commit .env.local
npm run db:seed             # fiktive testbrugere, produkter og test-embedding-model (kun lokalt)
npm run dev                 # http://localhost:3000
npm run worker:ingestion    # i en anden terminal: behandler uploadede PDF'er
```

I `.env.local` skal `IPA_RUNTIME_ENV=local` være sat. Ellers afviser registret
test-embedderen og `none`-rerankeren, og retrieval vises som utilgængelig (`docs/07` §9.1).
`SUPABASE_SERVICE_ROLE_KEY` bruges kun af seedet og den lokale worker. Workeren starter kun med
den, når `IPA_RUNTIME_ENV` er `local` eller `test`. Den lokale worker kan kalde workerens
databasefunktioner, fordi `supabase/seed.sql` (development-only, køres af `supabase start` og
`supabase db reset`) giver service-rollen medlemskab af rollen `ingestion_worker`. I produktion
bruger workeren sin egen login-rolle (`docs/08b` §21.4).

### Knowledge Engine i browseren (lokalt)

Log ind som `admin@ipa.test` med adgangskoden fra `IPA_DEV_SEED_PASSWORD`. Gå derefter til Admin:

1. **Dokumenter → Upload dokument:** vælg en PDF med tekstlag, produkt, type og gyldig fra.
2. Workeren behandler filen. Versionen står derefter under fanen **Klar til review**.
3. Åbn versionen: strukturen til venstre, **kvalitetsrapporten** til højre.
4. **Påbegynd review → Godkend som autoritativ**, med bekræftelsesdialog.
5. **Dokumentkonflikter:** upload et andet dokument med samme produkt og dokumenttype og
   overlappende gyldighed, og godkend det. Konflikten står i **Knowledge Base → Konfliktkø**.
6. **Knowledge Base → Afprøv retrieval** viser evidensen for den indloggede bruger.

### Copilot på AI Gateway (lokalt, 8A)

Med en database går hvert spørgsmål i **Copilot** gennem AI Gateway (`docs/08`). Svaret dannes
af en stub-model uden AI ud fra det godkendte vidensgrundlag og er markeret "Udviklingssvar —
ingen AI-model". Rådgivere ser kun svar fra dokumenter, de er tildelt.
**Udviklingsværktøjet** øverst i Copilot (kun med `IPA_RUNTIME_ENV=local`/`test`) kan starte og
aflevere en prøve og starte og afslutte et rollespil, så den låste tilstand kan ses. Det kan også
fremtvinge "kan ikke dokumenteres" og "utilstrækkeligt grundlag". Kør migrationen
`20261002000100_ai_gateway.sql`. Skemaerne `ai`, `assessment` og `practice` er eksponeret i
`supabase/config.toml`.

| Script | Formål |
|--------|--------|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (strict) |
| `npm test` | Enhedstests (Vitest) |
| `npm run test:db` | pgTAP-tests mod lokal database |
| `npm run test:integration` | RLS- og rutetests mod lokal Supabase + seed |
| `npm run build` | Produktionsbuild |
| `npm run check` | Lint, typecheck, enhedstests og build |
| `IPA_RUNTIME_ENV=test npm run eval:retrieval` | Retrieval-evaluering mod det fiktive fixture-korpus (8B-I1, `evals/retrieval/README.md`). Med `-- --providers bedrock` evalueres Bedrock-adapterne (kræver AWS-credentials). Kan aldrig give production-grad |

Testbrugere og teamstruktur er beskrevet i `docs/06` §11.
