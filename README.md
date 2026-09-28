# Insurance Partners (IPA)

AI-baseret platform til erhvervsforsikringsrådgivere. Projektets styrende instruktioner står i
`CLAUDE.md`, specifikationen i `docs/` og faseoversigten i `docs/roadmap.md`.

**Status:** Fase 5 — Grundplatform. Alt indhold er fiktive udviklingsdata; der er endnu ingen
AI-integration, database eller login. Se `docs/05-foundation-implementation.md`.

## Kom i gang

Kræver Node.js 20.9 eller nyere.

```bash
npm install
npm run dev      # http://localhost:3000
```

| Script | Formål |
|--------|--------|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (strict) |
| `npm test` | Vitest |
| `npm run build` | Produktionsbuild |
| `npm run check` | Alle ovenstående |

Den development-only rolle-switcher (Rådgiver, Leder, Administrator) vises under `npm run dev`
eller i et build med `NEXT_PUBLIC_IPA_DEV_TOOLS=true`. Den er ikke adgangskontrol.
