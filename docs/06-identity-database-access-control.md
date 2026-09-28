# 06 — Identity, database og adgangskontrol

**Fase:** 6 — Identity, database og adgangskontrol
**Status:** Implementeres. Implementering og checks er færdige, og adgangskontrollen er
verificeret mod en rigtig database. Afventer godkendelse.
**Sprog:** Dansk (kode på engelsk, brugerflade på dansk)
**Bygger på:** `docs/01`–`docs/05` (låst) og beslutningerne i `docs/decisions.md`.

Dokumentet beskriver den infrastruktur for brugere, roller, teams, permissions og scopes, som
alle senere moduler bygger på, og hvordan adgang håndhæves.

---

## 1. Omfang

| Bygget i fase 6 | Ikke bygget (senere faser) |
|-----------------|----------------------------|
| PostgreSQL via Supabase med versionerede migrationer | Knowledge Engine, RAG, embeddings, ingestion |
| Supabase Auth: login, logout, session, beskyttede routes | Claude API, AI Gateway, Copilot-intelligens |
| Brugere, roller, permissions, teams, hierarki, lederscopes | Indhold i Learn, Practice, Assessment og Analytics |
| RLS på alle tabeller og server-side autorisation i alle sider | Sagens indhold (profil, analyser, AI-forslag), overdragelse af sager |
| Adgangsfundamentet for kundecases (ejer og deltagere) | Brugeradministration i UI (oprette og redigere brugere) |
| Append-only audit af administrative ændringer og individadgang | Produktionsdata |
| Development-seed og integrationstests mod rigtig database | |

Rolle-switcheren fra fase 5 er **fjernet**. Sessionen og rettighederne kommer nu kun fra
Supabase Auth og databasen.

---

## 2. Databasefundament

Domænerne ligger i hver sit skema (`docs/03` §4). Fase 6 opretter kun det, adgangsfundamentet
kræver:

| Skema | Tabeller | Formål |
|-------|----------|--------|
| `identity` | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `teams`, `team_memberships`, `leader_scopes` | Hvem nogen er, og hvad de må |
| `advise` | `customer_cases`, `case_participants` | Kun adgang pr. sag: ejer og deltagere |
| `audit` | `audit_log` | Append-only spor af handlinger |

Migrationer (`supabase/migrations/`):

| Fil | Indhold |
|-----|---------|
| `20260929000100_identity_foundation.sql` | Identity-tabeller, autorisationsfunktioner, RLS |
| `20260929000200_identity_catalog.sql` | Permission-katalog og standardroller (referencedata) |
| `20260929000300_audit_and_case_access.sql` | Audit, adgangsfundament for sager, RLS |

Alle tabeller har `created_at`. Tabeller, der ændres, har `updated_at` (trigger). Ejer- og
tildelingsfelter: `customer_cases.owner_id`, `user_roles.assigned_by`,
`leader_scopes.granted_by`, `case_participants.granted_by`.

---

## 3. Authentication

- **Supabase Auth** med e-mail og adgangskode (`@supabase/ssr`). Sessionen ligger i cookies.
- **Login:** `/login` (server action). Samme fejlbesked, uanset om kontoen findes. En konto
  uden aktiv platformbruger logges straks ud igen.
- **Logout:** brugermenuen → "Log ud".
- **Beskyttede routes:** `src/proxy.ts` (Next.js 16's "middleware") fornyer sessionen og sender
  ikke-indloggede til `/login?next=…`. Proxyen er kun første, optimistiske tjek (§7).
- **Ingen selvregistrering:** konti oprettes af en administrator (`enable_signup = false`).
- **Adgangskoder:** mindst 12 tegn.
- **Uden konfiguration:** mangler `NEXT_PUBLIC_SUPABASE_URL` eller
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, viser login-siden, at platformen ikke er forbundet. Der
  findes ingen mock-fallback.

---

## 4. Brugermodel

`identity.users` er platformens bruger og er knyttet 1:1 til `auth.users` via `auth_id`. Når
en Auth-bruger oprettes, opretter en trigger platformbrugeren uden roller. Roller tildeles af
en administrator.

| Felt | Betydning |
|------|-----------|
| `id` | Platformens bruger-id. Bruges i alle relationer |
| `auth_id` | Supabase Auth-bruger. `on delete set null`, så audit-sporet består |
| `display_name`, `job_title` | Visning |
| `status` | `active` / `inactive`. Inaktive brugere har ingen permissions |

E-mail ejes af `auth.users` og kopieres ikke.

---

## 5. Roller

De tre låste roller er **Rådgiver** (`advisor`), **Leder** (`leader`) og **Administrator**
(`administrator`). En rolle er kun en navngiven samling standardpermissions med scope
(`role_permissions`). Systemet kontrollerer altid permission og scope, aldrig rollenavnet.
En bruger kan have flere roller; lederen har typisk både Rådgiver og Leder.

---

## 6. Permissions

Kataloget er præcis de tolv permissions i `docs/03` §10. Der er ikke opfundet nye.

| Permission | Rådgiver | Leder | Administrator |
|------------|----------|-------|---------------|
| `learning.progress.read` | own | own + team | own |
| `practice.session.write` | own | own | own |
| `assessment.result.read` | own | own + team | own |
| `advise.case.read` | own | own | own |
| `advise.case.write` | own | own | own |
| `analytics.team.read` | — | team | — (§14, punkt 2) |
| `knowledge.document.read` | — (§14, punkt 3) | — (§14, punkt 3) | all |
| `knowledge.document.read_historical` | — (§14, punkt 3) | — (§14, punkt 3) | all |
| `knowledge.document.write` | — | — | all |
| `knowledge.version.publish` | — | — | all |
| `identity.user.manage` | — | — | all |
| `system.settings.manage` | — | — | all |

Hver permission angiver, hvilke scopes den giver mening med (`allowed_scopes`). En trigger
afviser en rolletildeling med et scope, permissionen ikke understøtter. Kataloget kan
udvides med nye rækker uden ændring af kontrollogikken.

---

## 7. Teams og scopes

- **Hierarki:** `teams.parent_team_id`. En trigger afviser cykler.
- **Flere medlemskaber:** en bruger kan være i flere teams (`team_memberships`).
- **Lederscope:** kun eksplicitte rækker i `leader_scopes` giver teamadgang, aldrig jobtitel
  eller rollenavn. `include_descendants` afgør, om underteams er med.
- **Scopes:**

| Scope | Betyder |
|-------|---------|
| `own` | Kun brugerens egne data |
| `team` | Data om medarbejdere, der er medlem af mindst ét team i lederens scope |
| `all` | Hele organisationen |

En leder får altså kun adgang til de teams, lederen er tildelt: eget team, underteams hvis
`include_descendants` er sat, eller bestemte teams. Rollen alene giver ingen teamadgang.

---

## 8. Autorisationsflow

```
Browser ──► proxy.ts ─────────────► Side (server) ─────────────► Supabase (som brugeren)
            ikke logget ind?         requireSession()/authorize()     RLS på hver tabel
            → /login                 mangler permission?              SECURITY DEFINER-
                                     → adgangsbesked, ingen            funktioner for
                                       beskyttede data hentes          permission og scope
```

1. **Proxy:** optimistisk tjek og fornyelse af sessionen.
2. **Server-side i hver side:** hver side under `(platform)` kalder `requireSession()` eller
   `authorize()`. Admin og Analytics afviser uden permission, før der hentes data.
   Autorisationen ligger **i siden, ikke kun i layoutet**: i App Router renderes et layout
   parallelt med sin side og kan ikke forhindre, at sidens output sendes (fundet af
   rutetestene, se §12). En test sikrer, at ingen platformside mangler tjekket.
3. **Database:** alle forespørgsler kører som den indloggede bruger. RLS afgør, hvilke rækker
   der kan læses og skrives. Det gælder også, hvis nogen kalder API'et direkte.

Den session, klienten får (`useSession()`), bruges kun til at vise UI. Skjult UI er aldrig
adgangskontrol.

**Autorisationsfunktioner** (`identity`-skemaet):

| Funktion | Svarer på |
|----------|-----------|
| `current_user_id()` | Den aktive platformbruger for sessionen |
| `has_permission(key, scope?)` | Har jeg permissionen (med scopet)? |
| `can_access_user_data(key, subject)` | Må jeg se subjects data under permissionen (own/team/all)? |
| `my_permissions()` | Mine effektive permissions (til UI) |
| `my_scoped_team_ids()` | Teams i mit lederscope inkl. underteams |
| `my_visibility()` | Hvilke ledere kan se mine data, og under hvilke permissions |
| `log_individual_access(subject, key)` | Logger lederens individvisning — afvises uden for scope |

Funktioner, der tager et vilkårligt bruger-id (`permission_scopes`, `scoped_team_ids`,
`is_in_leader_scope`), kan ikke kaldes direkte af brugere.

---

## 9. Row Level Security

RLS er slået til på alle tabeller i `identity` og `advise` (testet). `anon` har ingen adgang
til skemaerne.

| Tabel | Læse | Skrive |
|-------|------|--------|
| `users` | Sig selv; brugere i lederscope (via `learning.progress.read`/`assessment.result.read` med team); `identity.user.manage` | `identity.user.manage` (kun `display_name`, `job_title`, `status`) |
| `roles`, `permissions`, `role_permissions` | Alle indloggede (transparens) | Kun via migrationer |
| `user_roles` | Egne; `identity.user.manage` | `identity.user.manage` |
| `teams` | Egne teams; teams i lederscope; `identity.user.manage` | `identity.user.manage` |
| `team_memberships` | Egne; medlemskaber i lederscope; `identity.user.manage` | `identity.user.manage` |
| `leader_scopes` | Egne; `identity.user.manage` | `identity.user.manage` |
| `customer_cases` | `advise.case.read` + ejer eller deltager | Opret: `advise.case.write` og kun sig selv som ejer. Redigér: ejer eller `editor` (`company_name`, `status`) |
| `case_participants` | Deltagere i sagen | Kun ejeren deler (`editor`/`viewer`) og fjerner deling. Ejerrollen kan ikke tildeles |
| `audit.audit_log` | Ingen via API | Kun via triggere og funktioner. Append-only |

**Ingen "admin ser alt"-genvej:** administratoren ser kun egne og tildelte sager (B-001), og
lederen får ikke adgang til teamets sager gennem rollen.

---

## 10. Sikkerhedsmodel

- **Secrets:** kun i miljøvariabler (`.env.local` lokalt, Vercel/Supabase i drift). `.env*` er
  git-ignoreret; kun `.env.example` med tomme pladsholdere er committet.
- **Service-role-nøglen bruges aldrig af appen.** Kun development-seedet bruger den, og en test
  sikrer, at den ikke optræder i `src/`.
- **Anon-nøglen er offentlig af design.** Adgang afgøres af RLS, ikke af nøglen.
- **SECURITY DEFINER-funktioner** har `search_path = ''` og fuldt kvalificerede navne.
- **Audit:** ændringer i `users`, `user_roles`, `teams`, `team_memberships`, `leader_scopes` og
  `case_participants` logges af triggere. Lederens individvisning logges. Loggen gemmer
  nøgler og struktur, ikke navne eller andet fritekstindhold. Den kan hverken opdateres,
  slettes eller trunkeres, heller ikke af tabellens ejer.
- **Ejerskab af sager** kan ikke ændres ved redigering. Overdragelse er et eget flow (senere).

---

## 11. Udviklingsdata (seed)

`scripts/seed-dev.mjs` opretter fiktive testbrugere, teams, lederscopes og sager.

- Kører **kun mod en lokal Supabase** (`localhost`/`127.0.0.1`), ellers afvises det.
- Der ligger **intet password i repoet**. Alle testbrugere får adgangskoden fra
  `IPA_DEV_SEED_PASSWORD`, som du selv vælger.
- Scriptet kan køres flere gange. Data ligner tydeligt ikke produktionsdata: `.test`-domæne,
  "Test …"-navne og "Testvirksomhed …".

```
Testafdeling Erhverv
├── Testteam Nord                 ← Test Leder Nord (scope inkl. underteams)
│   └── Testteam Nord · Hold A
└── Testteam Syd                  ← Test Leder Syd (begrænset: kun Syd)
    └── Testteam Syd · Hold B
Testafdeling Produkt
```

| Bruger | Roller | Teams | Tester |
|--------|--------|-------|--------|
| `raadgiver.a@ipa.test` | Rådgiver | Nord · Hold A, Syd | Flere medlemskaber, synlig for begge ledere |
| `raadgiver.b@ipa.test` | Rådgiver | Syd | Kun Leder Syd |
| `raadgiver.c@ipa.test` | Rådgiver | Nord, Syd · Hold B | Leder Syd ser ikke C (underteams ekskluderet) |
| `leder.nord@ipa.test` | Rådgiver + Leder | Nord | Scope inkl. underteams |
| `leder.syd@ipa.test` | Rådgiver + Leder | Syd | Begrænset scope |
| `admin@ipa.test` | Administrator | Produkt | Administration uden sags- eller Analytics-genvej |

Sager: **Alfa** (ejer A, delt med B som læser), **Beta** (ejer B) og **Gamma** (ejer
administrator, delt med A som redaktør). Kun Alfa har Fase 5's eksempelindhold i
arbejdsområderne (`src/mocks/advise.ts`). Rigtige sager viser tomme arbejdsområder.

---

## 12. Teststrategi

| Lag | Værktøj | Antal | Dækker |
|-----|---------|-------|--------|
| Enhed | Vitest (`npm test`) | 44 | Permission-logik, navigation pr. rollebundt, at kataloget i migrationen er præcis `docs/03` §10, statussystem, kontrast, guardrails (secrets, service-role-nøglen, stiplet kant, mock-isolation, server-tjek i hver side) |
| Database | pgTAP (`npm run test:db`) | 9 | Scope-validering, cyklusforbud, audit-logning, append-only, ingen adgang for anon, RLS slået til overalt |
| RLS via API | Vitest (`npm run test:integration`) | 24 | Logget ind som hver testbruger mod rigtig Supabase Auth og PostgREST: uden login, rådgiver, leder, administrator, team- og underteam-scope, flere medlemskaber, sager og deling, rettighedseskalering, transparens |
| Ruter i appen | Vitest (`npm run test:integration`) | 21 | Den kørende app med rigtige sessions: beskyttede routes, adgang via URL til Admin, Analytics og andres sager, navigation, login-redirect |

**Mutationstest:** da RLS-policies midlertidigt blev svækket, fejlede 8 af integrationstestene.
Testene fanger altså reelle huller og består ikke blot tomt.

**Fundet og rettet undervejs:** rutetestene viste, at Admin-oversigtens indhold blev sendt
med til en rådgiver, fordi afvisningen kun lå i layoutet (§8). Autorisationen ligger nu i
hver side, og en guardrail-test fastholder det.

Login, fejlbesked, navigation pr. rolle og logout er desuden kørt igennem i en rigtig
browser (Chromium).

---

## 13. UI-integration

| Område | Datakilde i fase 6 |
|--------|--------------------|
| Session, navigation, brugermenu | Supabase Auth + `identity` |
| Home: aktive kundecases | `advise` (RLS) |
| Advise: sagsoversigt, sag og deltagere | `advise` (RLS). Arbejdsområdernes indhold: senere fase |
| Global søgning: egne kundecases | `advise` (RLS) |
| Analytics: teamvælger og medarbejdere | Lederens scope i `identity`. Nøgletal er markerede eksempeltal |
| Min profil → Synlighed | `identity.my_visibility()` |
| Admin → Brugere, Teams, Permissions | `identity` (kræver `identity.user.manage`) |
| Learn, Practice, Copilot, Assessment, øvrige Admin-sektioner | Fase 5's mock-data (senere faser) |

---

## 14. Non-blocking implementeringsbeslutninger (til bekræftelse)

Truffet inden for de låste rammer. De er udledt, ikke oplyst, og lægges frem til bekræftelse:

1. **Scope ligger på `role_permissions`, ikke på `user_roles`.** `docs/03` §4 nævner et scope på
   `user_roles`, mens §10 angiver scope pr. rolle og permission. Teamafgrænsningen ligger i
   `leader_scopes`.
2. **Administratorens Analytics ("efter rettigheder")** gives ikke af administratorrollen. En
   administrator, der skal se Analytics, tildeles også Leder-rollen og et lederscope. Der er
   ikke opfundet en ny rolle eller permission. Dermed er fase 5's mock-antagelse om `all`
   (docs/05 §11, punkt 3) erstattet.
3. **`knowledge.document.read` for Rådgiver og Leder ("efter grants")** gives pr. dokument i
   Knowledge-domænet (`document_access_grants`, senere fase), ikke gennem rollen.
4. **Ingen selvregistrering** og minimum 12 tegn i adgangskoder.
5. **Læseadgang til audit-loggen via API** er ikke fastlagt i `docs/03`. Indtil videre kan kun
   databasens ejer og service-role læse den.
6. **Synlighedskategorier → permissions** (`src/config/visibility.ts`) er stadig den udledte
   kobling fra fase 5. Den erstattes, når det fulde permission-katalog skrives.

---

## 15. Kendte begrænsninger

- **Der er ikke oprettet et hostet Supabase-projekt endnu.** Den deployede Vercel-version viser
  derfor login-siden med beskeden om, at platformen ikke er forbundet. Det kræver et
  Supabase-projekt i EU-region, `npx supabase link` + `npx supabase db push` og de to
  `NEXT_PUBLIC_SUPABASE_*`-variabler i Vercel.
- **Første administrator** i et hostet projekt oprettes manuelt: opret brugeren under
  Authentication i Supabase, og tildel rollen med SQL (`insert into identity.user_roles …`).
  Brugeradministration i UI er ikke bygget.
- Ingen nulstilling af adgangskode, MFA eller SSO endnu.
- Oprettelse og overdragelse af sager samt sagens indhold er ikke bygget. Kun adgangsfundamentet
  er.
- Database-typer er ikke genereret (`supabase gen types`). Forespørgslerne er utypede i
  datalaget (`src/lib/data/`).
- **Testmiljøet i Claude Code-containeren:** her kunne Supabase CLI'ens fulde lokale stack ikke
  hentes (Docker Hub-grænse og blokeret registry). Testene er derfor kørt mod Supabase' egne
  images for Postgres (17.6) og Auth (GoTrue 2.197) plus PostgREST 14.1 bag en lille lokal
  gateway i stedet for Kong. Migrationer, seed og tests er de samme som med
  `npx supabase start`. pgTAP-filen er kørt med `psql` i stedet for `supabase test db`.

---

## 16. Kom i gang lokalt

Kræver Docker og Node.js 20.9+.

```bash
npm install
npx supabase start                  # lokal Postgres, Auth og API (første gang tager det tid)
npx supabase status                 # viser API URL, anon key og service_role key
cp .env.example .env.local          # udfyld URL, anon key, service_role key og et seed-password
npm run db:seed                     # opretter testbrugere, teams, scopes og sager
npm run dev                         # http://localhost:3000 → log ind som fx raadgiver.a@ipa.test
```

Tests:

```bash
npm test                            # enhedstests
npm run test:db                     # pgTAP mod den lokale database
npm run build && npm start &        # appen skal køre til rutetestene (IPA_APP_URL)
npm run test:integration            # RLS- og rutetests mod lokal Supabase + seed
```

`npx supabase db reset` genskaber databasen fra migrationerne. Kør derefter `npm run db:seed`
igen.
