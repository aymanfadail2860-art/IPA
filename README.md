# Insurance Partners (IPA)

AI-baseret platform til erhvervsforsikringsrådgivere. Projektets styrende instruktioner står i
`CLAUDE.md`, specifikationen i `docs/` og faseoversigten i `docs/roadmap.md`.

**Status:** Fase 7 — Knowledge Engine er gennemført og låst (`docs/07-knowledge-engine.md`).
Fase 8 — AI Gateway er specificeret og afventer godkendelse (`docs/08-ai-gateway.md`).
Fase 9 er foreslået (`docs/roadmap.md`). Moduler fra senere faser viser stadig fiktive
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
`SUPABASE_SERVICE_ROLE_KEY` bruges kun af seedet og den lokale worker.

### Knowledge Engine i browseren (lokalt)

Log ind som `admin@ipa.test` med adgangskoden fra `IPA_DEV_SEED_PASSWORD`. Gå derefter til Admin:

1. **Dokumenter → Upload dokument:** vælg en PDF med tekstlag, produkt, type og gyldig fra.
2. Workeren behandler filen. Versionen står derefter under fanen **Klar til review**.
3. Åbn versionen: strukturen til venstre, **kvalitetsrapporten** til højre.
4. **Påbegynd review → Godkend som autoritativ**, med bekræftelsesdialog.
5. **Dokumentkonflikter:** upload et andet dokument med samme produkt og dokumenttype og
   overlappende gyldighed, og godkend det. Konflikten står i **Knowledge Base → Konfliktkø**.
6. **Knowledge Base → Afprøv retrieval** viser evidensen for den indloggede bruger.

| Script | Formål |
|--------|--------|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (strict) |
| `npm test` | Enhedstests (Vitest) |
| `npm run test:db` | pgTAP-tests mod lokal database |
| `npm run test:integration` | RLS- og rutetests mod lokal Supabase + seed |
| `npm run build` | Produktionsbuild |
| `npm run check` | Lint, typecheck, enhedstests og build |

Testbrugere og teamstruktur er beskrevet i `docs/06` §11.
