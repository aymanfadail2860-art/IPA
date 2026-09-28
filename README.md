# Insurance Partners (IPA)

AI-baseret platform til erhvervsforsikringsrådgivere. Projektets styrende instruktioner står i
`CLAUDE.md`, specifikationen i `docs/` og faseoversigten i `docs/roadmap.md`.

**Status:** Fase 6 — Identity, database og adgangskontrol. Login, roller, teams, permissions
og RLS er bygget på Supabase (`docs/06-identity-database-access-control.md`). Moduler fra
senere faser viser stadig fiktive udviklingsdata.

## Kom i gang

Kræver Node.js 20.9+ og Docker (til den lokale Supabase).

```bash
npm install
npx supabase start          # lokal database, Auth og API
npx supabase status         # URL og nøgler til .env.local
cp .env.example .env.local  # udfyld værdierne — aldrig commit .env.local
npm run db:seed             # fiktive testbrugere (kun lokalt)
npm run dev                 # http://localhost:3000
```

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
