# Beslutninger — Insurance Partners (IPA)

Beslutningslog efter `CLAUDE.md` §5. Hvert punkt indeholder dato, beslutning, overvejede
alternativer og begrundelse. Nyeste øverst.

---

## B-004 — Demo-noten i `docs/05` §12 beskriver den nuværende tilstand

**Dato:** 1. oktober 2026
**Område:** `docs/05-foundation-implementation.md` §12 (låst dokument, åbnet eksplicit på
dette ene punkt efter beslutning fra projektejeren)

**Beslutning:** Demo-noten i §12 er rettet. Den nævnte miljøvariablen
`NEXT_PUBLIC_IPA_DEV_TOOLS=true` og den aktive rolle-switcher, som begge blev fjernet i fase 6.
Noten beskriver nu, at platformen kræver login via Supabase Auth, og at appen uden
databaseforbindelse kører som demo uden login (B-003). Resten af `docs/05` er uændret.

**Overvejede alternativer:**
- *Lade noten stå som historisk beskrivelse af fase 5.* Fravalgt, fordi noten beskriver en
  kørende demo og en miljøvariabel, der ikke længere virker, og derfor kan misforstås som
  gældende vejledning.
- *Flytte demo-oplysningen til `docs/06` og slette noten i `docs/05`.* Fravalgt, fordi
  CLAUDE.md §5 siger, at det dokument, der ejer emnet, rettes frem for at dublere. Demo-adressen
  blev dokumenteret i `docs/05`.

**Begrundelse:** Statusoverblikket den 1. oktober 2026 viste, at noten modsagde koden og
`docs/06`. Et låst dokument, der beskriver noget, som ikke findes, er værre end en rettelse.

---

## B-003 — Midlertidig demo uden login, indtil projektet er færdigt

**Dato:** 29. september 2026
**Område:** `docs/06-identity-database-access-control.md` §3 (låst dokument, åbnet eksplicit
på dette ene punkt efter beslutning fra projektejeren)

**Beslutning:** Den offentlige Vercel-demo kører uden login, indtil projektet er færdigt. Så
kobles demoen på Supabase, og demo-tilstanden fjernes. Demo-tilstanden gælder kun på fiktive
udviklingsdata og har et tydeligt markeret rolleskift ("Demo uden login · vis som"), der
ikke er adgangskontrol.

**Sikring:** Demo-tilstanden er kun aktiv, når der **ikke** er forbundet nogen database
(`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` mangler). Så snart en database er
koblet på, lokalt, i tests eller i Vercel, gælder login og server-side autorisation præcis
som i `docs/06`. Demoen kan derfor aldrig vise rigtige data uden login. Rollerne viser stadig
kun det, deres permissions giver. Fx får Rådgiveren ikke Admin, og Administratoren får ikke
Analytics. Det er dækket af tests.

**Overvejede alternativer:**
- *Koble demoen på et hostet Supabase-projekt nu.* Fravalgt af projektejeren for nu og
  planlagt til sidst.
- *Lade demoen stå med login-siden uden database.* Fravalgt, fordi demoen så ikke kan ses.

**Begrundelse:** Projektejeren vil kunne se og vise platformen undervejs uden at oprette en
database, før projektet er færdigt.

**Skal fjernes igen (påmindelse):** Når projektet er færdigt: opret Supabase-projektet (EU),
kør migrationerne, sæt de to miljøvariabler i Vercel, sæt `DEMO_WITHOUT_LOGIN_ENABLED` til
`false` og slet `src/dev/demo/`, `src/mocks/demo.ts` og `isDemoMode()`-grenene. Punktet står
også i `docs/roadmap.md` og `CLAUDE.md` §1.

---

## B-002 — Skitsen for "Bed AI om forslag" får fast ramme

**Dato:** 28. september 2026
**Område:** `docs/04-ui-ux-design.md` §10.4 (låst dokument, åbnet eksplicit på dette ene punkt)

**Beslutning:** ASCII-skitsen i §10.4 tegnede knappen "Bed AI om forslag" med stiplet ramme.
Skitsen er rettet, så knappen har fast ramme. Resten af dokumentet er uændret.

**Overvejede alternativer:**
- *Lade skitsen stå og behandle den som illustrativ.* Fravalgt, fordi en låst specifikation,
  der modsiger sig selv, kan læses begge veje.
- *Ændre reglen, så stiplet kant også må bruges på AI-indgange.* Fravalgt, fordi signaturen
  kun virker, så længe den aldrig betyder andet end "AI-indhold, der afventer vurdering".

**Begrundelse:** §3.4 fastslår, at stiplet kant udelukkende bruges på AI-genereret indhold,
der afventer menneskelig vurdering, og at reglen er absolut. Knappen er en handling, ikke
indhold. Skitsen var fejlen, og implementeringen i fase 5 fulgte allerede reglen.

---

## B-001 — Adgang til kundecases er `own` for alle roller, også Administrator

**Dato:** 28. september 2026
**Område:** `docs/03-technical-architecture.md` §10 (låst dokument, åbnet eksplicit på dette
ene punkt)

**Beslutning:** I permission-tabellen er `advise.case.read` og `advise.case.write` rettet fra
"—" til `own` for Administrator, så de er `own` for alle tre roller. Teksten under tabellen
og afsnittet "Kundecases" er gjort konsistente med rettelsen.

**Overvejede alternativer:**
- *Beholde "—" for Administrator.* Fravalgt, fordi en administrator så aldrig kunne tildeles
  en sag — heller ikke som sagsansvarlig — selv om `docs/02` §10 og `docs/04` §21 giver
  administratoren adgang til Advise.
- *Give Administrator bredere scope (`all`).* Fravalgt, fordi det ville give adgang til
  kundedata gennem en rolle, hvilket strider mod princippet om adgang pr. case.

**Begrundelse:** Uoverensstemmelsen var en intern selvmodsigelse i `docs/03`, ikke en uenighed
mellem dokumenterne. `docs/02` og `docs/04` havde ret. Adgang til en kundecase gives pr. case
gennem `case_participants`, aldrig gennem en rolle. `own` betyder "kun egne og tildelte
sager" og gælder derfor ens for alle roller. En administrator er også rådgiver, ligesom en
leder er det.

**Konsekvens i koden:** Administratorens mock-session har fået `advise.case.read` og
`advise.case.write` med scope `own`. Sagsoversigten viser for alle roller kun egne og
tildelte sager.

Afdækket under fase 5 og dokumenteret i `docs/05-foundation-implementation.md` §11.
