# Beslutninger — Insurance Partners (IPA)

Beslutningslog efter `CLAUDE.md` §5. Hvert punkt indeholder dato, beslutning, overvejede
alternativer og begrundelse. Nyeste øverst.

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
