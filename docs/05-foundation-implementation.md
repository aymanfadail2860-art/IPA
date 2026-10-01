# 05 — Grundplatform (implementering)

**Fase:** 5 — Grundplatform
**Status:** Gennemført og låst. Fase 6 har siden erstattet den development-only
rolle-switcher og mock-sessionen med rigtig authentication og adgangskontrol — se
`docs/06-identity-database-access-control.md`.
**Sprog:** Dansk (kode på engelsk, brugerflade på dansk)
**Bygger på:** `docs/01`–`docs/04`, som er låst og behandles som autoritative krav.

Dokumentet beskriver, hvad der er bygget i fase 5, hvilke konkrete værdier der er valgt,
hvor de ligger, og hvad der bevidst ikke er bygget endnu.

---

## 1. Hvad der er implementeret

| Område | Indhold |
|--------|---------|
| Applikationsfundament | Next.js 16 (App Router), TypeScript (strict), Tailwind CSS 4, shadcn/ui (Radix), Lucide Icons |
| Design system | Semantiske tokens med konkrete V1-værdier, skrifttyper via `next/font`, fælles statussystem |
| App shell | Sidebar (kan foldes til ikoner), topbar, breadcrumbs, brugermenu, notifikationer, global søgning, mobilskuffe |
| Global Copilot | Skubbende sidepanel på desktop, overlay/fuldskærm på mindre skærme, kontekstchip, mock-samtale med kilder |
| Routes | `/home`, `/learn`, `/copilot`, `/practice`, `/advise`, `/assessment`, `/analytics`, `/profile`, `/admin` + undersider |
| Statussystem | De syv faglige statusser samt feedback- og domænestatusser — altid farve + ikon + tekst |
| AI- og vidensskomponenter | Kildemarkør, kildekort, dokumentvisning, grundlagslinje, retrieval-trin, AI-forslag, valideret konklusion, arbejdsnote, konflikt, historisk markering, utilstrækkeligt grundlag, låst tilstand, kvalitetssignal |
| Rollebaseret UI | Navigation og sektioner styres af permissions med scope — aldrig af rollenavn |
| Development-only rolle-switcher | Rådgiver, Leder, Administrator. Styrer kun mock-UI |
| Mock-data | Samlet i `src/mocks/`, tydeligt markeret, isoleret fra genbrugelig kode |
| Tilgængelighed | Skip-link, synlig fokusring, semantisk markup, labels, live regions, reduced motion, `lang="da"` |
| Tests | 40 automatiserede tests (Vitest) af permissions, sagsadgang i oversigt og søgning, Advise pr. enhed, genveje, statussystem, kontrast og guardrails |

---

## 2. Fil- og mappestruktur

```
src/
├── app/
│   ├── layout.tsx, globals.css, fonts.ts   Rod: html lang="da", tokens, skrifttyper
│   ├── page.tsx                            / → /home
│   ├── not-found.tsx                       Dansk 404
│   └── (platform)/                         Alt med app shell
│       ├── layout.tsx                      Shell + DEV-session (læser rolle-cookie)
│       ├── loading.tsx, error.tsx          Skeletons og sidefejl
│       ├── home/                           Cockpit
│       ├── learn/ [product]/ [module]/     Bibliotek → produkt → modul/lektion
│       ├── copilot/                        Fuld Copilot-visning
│       ├── practice/                       Træningsformer og feedback
│       ├── advise/ [caseId]/               Sagsoversigt og case-workspace
│       ├── assessment/                     Prøver, resultater, kompetencer
│       ├── analytics/                      Teamoversigt og medarbejdervisning
│       ├── profile/                        Overblik, Kompetencer, Historik, Synlighed
│       └── admin/ [section]/               Oversigt + ni undersektioner
├── components/
│   ├── ui/          shadcn/ui-primitiver tilpasset tokens (button, card, dialog, sheet …)
│   ├── status/      StatusBadge, StatusText
│   ├── knowledge/   Viden- og AI-komponenterne (designsystemets kerne)
│   ├── copilot/     CopilotPanel, CopilotAnswer, CopilotInput, ContextChip …
│   ├── shell/       AppShell, Sidebar, Topbar, Breadcrumbs, GlobalSearch …
│   ├── data/        DataTable, KeyMetric, LineChart, ProgressIndicator, StepRail …
│   ├── states/      EmptyState, ErrorState, LoadingState
│   ├── common/      PageHeader, Section, Chip, DisabledReason, RequirePermission …
│   ├── learn/       CalloutBox
│   └── admin/       PipelineStatus
├── config/          navigation, shortcuts, status, domain-status, visibility, admin-sections
├── lib/             auth/permissions, auth/session, format, utils
├── hooks/           use-shortcut, use-media-query
├── types/           domain.ts — view models
├── dev/             ⚠ DEVELOPMENT ONLY: mock-session og rolle-switcher
├── mocks/           ⚠ DEVELOPMENT ONLY: fiktive data
└── tests/           Vitest
```

**Afhængighedsregel:** `components/`, `config/`, `lib/` og `hooks/` importerer aldrig fra
`mocks/`. Kun sider (`app/`) og udviklingsværktøjer (`dev/`) gør. Reglen håndhæves af en
test.

---

## 3. Design tokens (V1)

Alle tokens ligger i `src/app/globals.css` som CSS-variabler på `:root` og er navngivet
efter rolle, ikke udseende. Komponenter bruger dem via Tailwind-utilities
(`bg-surface-raised`, `text-fg-secondary`, `text-knowledge-historical` …). Ingen komponent
indeholder en hårdkodet farveværdi. Dark mode er et nyt værdisæt under en anden selector —
ikke en ombygning.

### 3.1 Farver

| Token (spec) | CSS-variabel | Værdi | Tailwind |
|--------------|--------------|-------|----------|
| `brand.primary` | `--brand-primary` | `#13294B` | `bg-brand` |
| `brand.primary.subtle` | `--brand-primary-subtle` | `#E7ECF4` | `bg-brand-subtle` |
| `surface.base` | `--surface-base` | `#F6F7F9` (off-white) | `bg-surface-base` |
| `surface.raised` | `--surface-raised` | `#FFFFFF` | `bg-surface-raised` |
| `surface.sunken` | `--surface-sunken` | `#EEF1F5` | `bg-surface-sunken` |
| `surface.overlay` | `--surface-overlay` | `#FFFFFF` | `bg-surface-overlay` |
| `border.subtle` | `--border-subtle` | `#E2E6EC` | `border-border-subtle` |
| `border.strong` | `--border-strong` | `#7C889B` | `border-border-strong` |
| `text.primary` | `--text-primary` | `#0F1B2D` | `text-fg-primary` |
| `text.secondary` | `--text-secondary` | `#46526A` | `text-fg-secondary` |
| `text.tertiary` | `--text-tertiary` | `#5D687C` | `text-fg-tertiary` |
| `text.inverse` | `--text-inverse` | `#FFFFFF` | `text-fg-inverse` |
| `text.link` | `--text-link` | `#1F4B99` | `text-fg-link` |
| `accent.primary` | `--accent-primary` | `#13294B` | `bg-accent-primary` |
| `accent.hover` | `--accent-hover` | `#0C1D38` | `bg-accent-hover` |
| `accent.subtle` | `--accent-subtle` | `#E7ECF4` | `bg-accent-subtle` |
| `focus.ring` | `--focus-ring` | `#2F6BDB` | `ring-focus-ring` |

Tekstfarverne hedder `fg-*` i Tailwind, fordi `text-text-primary` ville være tvetydigt.
Den ene handlingsfarve (`accent.primary`) er den samme mørke marineblå som brandrollen.

### 3.2 Feedback og faglige statusroller

| Token | Farve | Tonet flade (`.subtle`) | Ikon (Lucide) | Label |
|-------|-------|-------------------------|---------------|-------|
| `status.success` | `#1B7A47` | `#E6F4EC` | `circle-check` | Gennemført |
| `status.warning` | `#8F4E00` | `#FDF3E1` | `triangle-alert` | Advarsel |
| `status.error` | `#B42318` | `#FDECEA` | `circle-x` | Fejl |
| `status.info` | `#1F5FAD` | `#E8F0FB` | `info` | Information |
| `knowledge.authoritative` | `#0B6E5F` | `#E4F3EF` | `shield-check` | Gældende |
| `knowledge.historical` | `#7A5C14` | `#F6F0E1` | `history` | Historisk |
| `knowledge.conflict` | `#A3245A` | `#FBE9EF` | `git-compare` | Konflikt mellem kilder |
| `knowledge.insufficient` | `#4A5A8A` | `#ECEFF8` | `search-x` | Utilstrækkeligt grundlag |
| `ai.suggestion` | `#5B3FC4` | `#F3F0FD` | `sparkles` | AI-forslag |
| `ai.validated` | `#1D6B3F` | `#E6F3EB` | `badge-check` | Valideret konklusion |
| `note.personal` | `#56607A` | `#EEF1F5` | `notebook-pen` | Arbejdsnote |

Definitionerne (label, ikon, klasser) ligger ét sted: `src/config/status.ts`. Alle
kombinationer er kontrastkontrolleret automatisk (afsnit 8).

### 3.3 Typografi

**Skrifttyper:** **Inter** til grænseflade og læsestof, **JetBrains Mono** til versioner,
id'er og tekniske værdier. Begge hentes af `next/font/google` ved build og serveres fra
applikationens eget domæne — brugerens browser kontakter ikke Google.

*Begrundelse:* Inter er udviklet til skærm-UI, har tabulære tal (tabeller, nøgletal),
fuld dækning af æ/ø/å og god læsbarhed i både små labels og lange læsetekster. Den giver et
neutralt, moderne enterprise-udtryk uden at låne et forsikringsselskabs identitet.

| Token | Tailwind | Størrelse / linjehøjde | Vægt |
|-------|----------|------------------------|------|
| `text.display` | `text-display` | 36 / 44 px, −0,022 em | 500 |
| `text.heading.1` | `text-heading-1` | 28 / 36 px | 600 |
| `text.heading.2` | `text-heading-2` | 20 / 28 px | 600 |
| `text.heading.3` | `text-heading-3` | 16 / 24 px | 600 |
| `text.body` | `text-body` | 14 / 22 px | 400 |
| `text.body.reading` | `text-reading` + `measure` | 17 / 28,8 px, maks. 68 tegn | 400 |
| `text.label` | `text-label` | 13 / 18 px | 500 |
| `text.caption` | `text-caption` | 12 / 16 px | 400 |
| `text.mono` | `text-mono` + `font-mono` | 13 / 20 px | 400 |

### 3.4 Spacing, radius, skygger, layout

| Token | Værdi |
|-------|-------|
| `space.1`–`space.16` | Tailwinds 4 px-skala (`space.N` = `N × 4 px`) |
| Sektionsafstand | `space.10` (40 px) mellem sektioner |
| Card-padding | `space.6` (24 px) |
| `radius.sm` / `md` / `lg` / `full` | 6 px / 8 px / 12 px / 9999 px |
| `shadow.none` | Standard for cards |
| `shadow.sm` | `0 1px 2px rgb(15 27 45 / .06), 0 2px 6px rgb(15 27 45 / .04)` — hover på interaktive cards |
| `shadow.md` | `0 12px 32px rgb(15 27 45 / .12), 0 2px 8px rgb(15 27 45 / .06)` — drawers, popovers, dialoger |
| Sidebar | 240 px, foldet 64 px |
| Topbar | 56 px |
| Kontekstpanel (Copilot) | 416 px, udvidet 50 % af skærmen |
| Maks. indholdsbredde | 1280 px |

### 3.5 Breakpoints

| Token | Værdi | Tailwind |
|-------|-------|----------|
| `bp.mobile` | < 768 px | (standard) |
| `bp.tablet` | ≥ 768 px | `md:` |
| `bp.desktop` | ≥ 1024 px | `lg:` |
| `bp.wide` | ≥ 1280 px | `xl:` |

Layouts, der deler plads med Copilot-panelet (lektionsvisning, case-workspace, topbar),
bruger **container queries** på indholdsområdet i stedet for viewport-breakpoints. Når
panelet skubber indholdet til side, folder de sig derfor korrekt sammen.

### 3.6 AI-signaturen

| Element | Behandling |
|---------|------------|
| AI-forslag (`AISuggestion`) | **Stiplet kant** + tykkere stiplet venstrekant i `ai.suggestion`, tonet flade, label "AI-forslag · ikke vurderet" med `sparkles` |
| Valideret konklusion | Fast, tyk venstrekant i `ai.validated`, fuld flade, `badge-check`, "Valideret af [navn] · [dato]" |
| Arbejdsnote | `surface.sunken`, ingen kant, `notebook-pen`, "Din note" |
| Kildegrundlag | `SourceCard` med tynd fast kant og gyldighedsbadge |

Stiplet kant bruges **kun** i `src/components/knowledge/ai-suggestion.tsx`. Kursiv bruges
ingen steder. Begge regler håndhæves af tests. `AIRequestTrigger` ("Bed om forslag") har
fast ramme: reglen i `docs/04` §3.4 forbeholder stiplet kant til AI-indhold, der afventer
vurdering, og knappen er ikke indhold. Skitsen i `docs/04` §10.4 er rettet tilsvarende
(se `docs/decisions.md`).

---

## 4. Komponentstruktur

Viden- og AI-komponenterne blev bygget først, fordi alle moduler afhænger af dem.

| Gruppe | Komponenter |
|--------|-------------|
| Status | `StatusBadge`, `StatusText` |
| Viden og AI | `SourceMarker`, `SourceCard`, `DocumentViewer`, `GroundingLine`, `RetrievalProgress`, `AISuggestion`, `ValidatedConclusion`, `WorkingNote`, `ConflictView`, `HistoricalBanner`, `InsufficientEvidence`, `LockedState`, `QualitySignal`, `AIRequestTrigger` |
| Copilot | `CopilotPanel`, `CopilotAnswer` (AIAnswer), `CopilotInput`, `ContextChip`, `FollowUpChips`, `CopilotContext`, `PendingQuestion` |
| Shell | `AppShell`, `Sidebar`, `SidebarNav`, `Topbar`, `BreadcrumbTrail`/`PageBreadcrumbs`, `GlobalSearch`, `Notifications`, `UserMenu`, `MobileNav`, `BrandMark` |
| Layout | `PageContainer`, `PageHeader`, `Section`, `Card`, `InteractiveCard`, `StatusCard` |
| Data | `DataTable` (sortering, tæthed, rækkehandlinger, kortliste på mobil), `DensityToggle`, `KeyMetric`, `LineChart` (med "Vis data"-tabel), `ProgressIndicator`, `StepRail`, `Timeline` |
| Tilstande | `EmptyState`, `ErrorState` (komponent, side, adgang), `LoadingState` (skeletons) |
| Øvrige | `Chip`, `DisabledReason`, `AvatarStack`, `RequirePermission`, `CalloutBox`, `PipelineStatus` |

Brugerens navne i opgaven er fulgt, bortset fra én: komponenten til AI-forslag hedder
`AISuggestion` som i den låste komponentliste (`docs/04` §24), ikke `AIProposal`.

---

## 5. Routes

| Route | Indhold |
|-------|---------|
| `/` | Viderestiller til `/home` |
| `/home` | Velkomst, Copilot-felt, fortsæt læring, anbefalet aktivitet, aktive kundecases, seneste Practice, Assessment-status, progression, Nyt siden sidst. Leder: teamstatus. Administrator: review, konflikter, videnshuller |
| `/learn` | Mine læringsforløb, produktbibliotek med filtre, progression |
| `/learn/[product]` | Produktforside med de elleve moduler og dokumenterne bag forløbet |
| `/learn/[product]/[module]` | Lektionsvisning (eksempel: `erhvervsansvar/daekninger`) eller moduloversigt |
| `/copilot` | Samtalehistorik (I dag, Tidligere, Fra kundecases), samtale, kildekolonne, dokumentvisning. `?q=` stiller et spørgsmål |
| `/practice` | Fem træningsformer, anbefalet træning, seneste træning, AI-feedback |
| `/advise` | Sagsoversigt (tabel) |
| `/advise/[caseId]` | Case-workspace med syv arbejdsområder (`?area=`), kvalitetssignaler, AI-forslag on demand |
| `/assessment` | Prøvebibliotek med enhedspolitik og tidsgrænse, resultater, kompetencer |
| `/analytics` | Teamvælger, nøgletal, udviklingsområder, tendens, medarbejdere, medarbejdervisning |
| `/profile` | Overblik, Kompetencer, Historik, Synlighed |
| `/admin` | Dokumentpipeline med brud mellem teknisk behandling og faglig godkendelse, review-kø, fejl og konflikter, videnshuller |
| `/admin/[section]` | `products`, `documents`, `knowledge-base`, `learning-content`, `users`, `teams`, `permissions`, `versions`, `settings` |

Analytics og Admin er skjult i navigationen uden adgang og viser en adgangsbesked ved
direkte URL. Admin viser under desktop-bredde en ærlig besked ("Admin er designet til
desktop").

---

## 6. Rollebaseret UI og development-only rolle-switcher

UI'et beslutter ud fra **permissions med scope** (`src/lib/auth/permissions.ts`), aldrig
ud fra rollenavnet. Navigationspunkter erklærer et krav (`requires`) i
`src/config/navigation.ts`; punkter uden adgang vises ikke.

Rolle-switcheren (`src/dev/`) skifter mellem tre mock-sessioner med permissions efter
eksempeltabellen i `docs/03` §10. Alle tre roller har `advise.case.read` og
`advise.case.write` med scope `own`. Adgang til en kundecase afgøres pr. sag af
sagsdeltagerne (`src/lib/auth/case-access.ts`): sagsoversigt, Home og global søgning viser
kun egne og tildelte sager, og en direkte URL til en anden sag giver en adgangsbesked. I mock-data er
lederen tildelt Bagerhuset ApS og administratoren Vestkyst Logistik ApS. Rolle-switcheren er:

- markeret "DEV · ikke adgangskontrol" i UI og som `DEVELOPMENT ONLY` i koden
- kun synlig under `next dev`, eller når et build startes med `NEXT_PUBLIC_IPA_DEV_TOOLS=true`
- adskilt fra komponenterne: de kender kun `useSession()`-interfacet i `src/lib/auth/session.tsx`

### Advise pr. enhed

Advise følger `docs/04` §19. Reglen er defineret ét sted i `src/config/advise-capabilities.ts`
og afgøres af viewport-bredden, så et åbent Copilot-panel ikke ændrer den:

| Enhed | Bredde | Kan |
|-------|--------|-----|
| Mobil | < 768 px | Kun læsning |
| Tablet | 768–1023 px | Læsning og arbejdsnoter — ikke bede om, acceptere eller forkaste AI-forslag |
| Desktop | ≥ 1024 px | Fuld funktionalitet |

Deaktiverede handlinger vises som deaktiverede knapper med en synlig forklaring ("Kan kun
redigeres på desktop" / "Noter kan kun redigeres på tablet eller desktop"). Forklaringen er
synlig tekst og ikke et tooltip, fordi touch-enheder ikke har hover.

**Erstatning:** `DevSessionProvider` erstattes af en server-side session fra Supabase Auth
med brugerens effektive permissions. Skjult UI er ikke en adgangskontrol — den rigtige
kontrol sker server-side og i RLS i en senere fase.

---

## 7. Mock-data-strategi

- Alt ligger i `src/mocks/` med én advarsel øverst i hver fil og en `README.md`.
- Alle eksporter er præfikset `mock`. Personer, virksomheder, produkter, betingelser og
  citater er opdigtede og ikke fagligt grundlag.
- Topbaren viser altid "Fiktive data", og Copilot-visningerne siger, at samtalerne er
  eksempler, og at Copilot ikke er forbundet.
- Genbrugelige komponenter modtager data som props. Kun sider og `dev/` importerer
  `@/mocks` (testet).
- Når rigtige data kommer, erstattes importen i sidefilerne af server-side dataadgang, og
  `src/mocks/` slettes.

---

## 8. Kvalitet og verifikation

| Check | Resultat |
|-------|----------|
| `npm run lint` (ESLint, next/core-web-vitals + TypeScript) | Består, 0 fejl, 0 advarsler |
| `npm run typecheck` (`next typegen` + `tsc --noEmit`, strict) | Består |
| `npm test` (Vitest) | 40 af 40 tests består |
| `npm run build` | Består |
| Routes | Alle 24 routes og undersider svarer 200 i produktionsbuild, `/` viderestiller til `/home`, ukendte slugs viser dansk 404-side |
| Responsivt grundlayout | Kontrolleret i Chromium ved 390, 820, 1280 og 1440 px. Ingen vandret scroll på mobil |
| Interaktion | Ctrl+J åbner panel med fokus i feltet, Esc lukker; Ctrl+K søger og navigerer; accept/forkast i Advise; Advise skrivebeskyttet på mobil og uden accept/forkast på tablet |
| Secrets | Ingen nøgler, `.env`-filer eller klient-AI-kald i repoet (testet); `.env*` er git-ignoreret |

**Automatiserede tests (`src/tests/`):**

- `permissions.test.ts` — permission-logik, navigation pr. rolle, lederen får aldrig Admin (KRAV-ROL-002), rådgiveren har kun `own`-scope (KRAV-ROL-003)
- `shortcuts.test.ts` — ⌘ på macOS, Ctrl ellers; slåede-fra genveje virker ikke og vises ikke
- `status.test.ts` — præcis syv faglige statusser, hver med farve + ikon + tekst, unikke ikoner; Synlighed dannes af lederens permissions
- `design-tokens.test.ts` — WCAG-kontrast: tekst ≥ 4,5:1 på alle flader, statusfarver på egen tone, fokusring og stærk kant ≥ 3:1
- `guardrails.test.ts` — stiplet kant kun i AI-forslag, ingen kursiv, mock-isolation, ingen secrets
- `search-access.test.ts` — global søgning viser kun egne og tildelte sager for alle tre roller, samme resultat som sagsoversigten
- `advise-access.test.ts` — Advise pr. enhed (mobil kun læsning, tablet læsning og noter, desktop alt), reglen er koblet i case-workspace; `advise.case.*` er `own` for alle roller, og hver bruger ser kun egne og tildelte sager

Testene fangede undervejs én reel fejl: `border.strong` havde kun 2,7:1 kontrast og er
rettet til `#7C889B`.

---

## 9. Kendte begrænsninger

- Kun én lektion (Erhvervsansvar · Dækninger) og ét case-workspace (Nordjysk Entreprise)
  er fuldt udfyldt. Øvrige moduler viser en ærlig tom tilstand.
- Intet gemmes. Accept, forkast, noter, feedback og filtre lever kun i browserens hukommelse.
- Foldet sidebar og panelbredde huskes i browserens `localStorage` — ikke pr. bruger. Tabeltæthed huskes ikke.
- Ukendte slugs viser 404-siden med HTTP-status 200, fordi `loading.tsx` streamer svaret,
  før siden afgør, at indholdet ikke findes. Siden får `noindex`.
- Grafer er simple SVG'er uden grafbibliotek.
- Toast-komponenten og Del/Overdrag-dialogerne i Advise er ikke bygget.

---

## 10. Bevidst ikke implementeret (senere faser)

Claude API-integration og AI Gateway · RAG, embeddings, vector retrieval og reranking ·
dokument-ingestion og worker · Knowledge Engine-logik · database, migrationer og RLS ·
rigtig authentication (Supabase Auth) og server-side permission checks · kundedata ·
AI-generering · fuldskærmstilstand for aktiv Assessment og AI-rollespil · Practice- og
Assessment-sessioner · upload og godkendelsesflow i Admin · audit-log · notifikationer
fra rigtige versionsændringer.

Knapper, der peger på noget af det ovenstående, er deaktiveret og forklarer hvorfor via
tooltip, som `docs/04` §3.6 kræver.

---

## 11. Observationer og antagelser

### Afgjort

1. **Administratorens adgang til Advise** — *afgjort 28. september 2026.* Eksempeltabellen i
   `docs/03` §10 angav "—" for administratorens `advise.case.read` og `advise.case.write`,
   hvilket modsagde dokumentets egen regel om adgang pr. case samt `docs/02` og `docs/04`.
   `docs/03` er rettet, så begge permissions er `own` for alle tre roller, og koden følger
   det. Se `docs/decisions.md`.

### Bekræftede antagelser

Følgende er bekræftet som bevidste antagelser i fase 5. De er ikke krav:

2. **Synlighed — kobling mellem kategori og permission** (`src/config/visibility.ts`).
   Læringsprogression og gennemførte forløb er koblet til `learning.progress.read`.
   Assessment-resultater, kompetencer og udviklingsområder er koblet til
   `assessment.result.read`. Koblingen er udledt og **erstattes, når det fulde
   permission-katalog skrives**.
3. **Administratorens Analytics-scope** er "efter rettigheder" i spec'en. Mock-sessionen
   giver `analytics.team.read` med scope `all`, så skærmen kan vurderes. Det er **en
   mock-antagelse**, ikke en beslutning om administratorens rettigheder.

---

## 12. Kom i gang lokalt

**Demo:** https://ipa-alpha-self.vercel.app — Vercel-projektet `ipa`, koblet til `main`, så
hvert push til `main` deployes automatisk. Rolle-switcheren og `NEXT_PUBLIC_IPA_DEV_TOOLS` fra
fase 5 findes ikke længere. Siden fase 6 kræver platformen login via Supabase Auth
(`docs/06-identity-database-access-control.md`). Er der ingen database koblet på, som i
Vercel-demoen indtil videre, kører appen midlertidigt som demo uden login på fiktive
udviklingsdata med et markeret rolleskift ("Demo uden login · vis som"). Det er beslutning
B-003 i `docs/decisions.md`. Rettelsen af denne note er B-004.


Kræver Node.js 20.9 eller nyere (udviklet på Node 22).

```bash
npm install
npm run dev          # http://localhost:3000 — rolle-switcher nederst til venstre
```

Øvrige scripts:

```bash
npm run lint
npm run typecheck
npm test
npm run build && npm start                                    # produktion, uden dev-værktøjer
NEXT_PUBLIC_IPA_DEV_TOOLS=true npm run build && npm start     # produktion med rolle-switcher
npm run check                                                 # lint + typecheck + test + build
```

Der skal ikke bruges miljøvariabler eller nøgler i fase 5.
