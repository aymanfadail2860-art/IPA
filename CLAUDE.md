# CLAUDE.md — Insurance Partners (IPA)

Overordnede instruktioner for projektet. Denne fil er styrende. Hvis noget i en samtale,
en prompt eller et andet dokument modsiger den, gælder denne fil, indtil den bliver
ændret eksplicit.

---

## 1. Status

**Fase 1–7 er gennemført og låst.** Fase 7 — Knowledge Engine blev godkendt 2026-10-02
(`docs/07-knowledge-engine.md`). **Fase 8 — AI Gateway: specifikation godkendt — under
implementering** (`docs/08-ai-gateway.md`). Fase 9 — Produktionsgrundlag for Knowledge Engine er foreslået (`docs/roadmap.md`).

**Husk til sidst (B-003):** Vercel-demoen kører midlertidigt uden login på fiktive data. Når
projektet er færdigt, kobles den på Supabase, og demo-tilstanden fjernes (`docs/decisions.md`
B-003).

Låst betyder, at dokumenterne fra fase 1–7 er projektets autoritative specifikation. De ændres ikke som led i implementeringen, men kun
ved en eksplicit beslutning om at genåbne dem.

Se `docs/roadmap.md` for den aktuelle status. Produktdefinitionen ligger i
`docs/01-product-definition.md` og informationsarkitekturen i
`docs/02-information-architecture.md`.

---

## 2. Ufravigelige regler

Det her er ikke udgangspunkter, der kan afvejes mod andre hensyn. De gælder, indtil den
fase, der ophæver dem, er nået.

1. **Teknologivalget og arkitekturen er låst i fase 3** og dokumenteret i
   `docs/03-technical-architecture.md`. Ændringer sker ved eksplicit beslutning om at
   genåbne dokumentet. Modelversioner, embedding-model og reranker er bevidst
   ikke låst og behandles som konfiguration.
2. **Implementering er tilladt fra fase 5.** Insurance Partners må implementeres inden for
   rammerne af de låste dokumenter fra fase 1–4. Hver fase implementerer kun det, fasen
   omfatter; senere fasers funktionalitet bygges ikke forud.
3. **Ingen opfundne krav.** Er en produktdetalje ikke oplyst, er den ukendt. Marker den,
   udfyld den ikke.
4. **Teknologineutral formulering i fase 1 og 2.** Produktdefinitionen og
   informationsarkitekturen beskriver adfærd, brugere, regler og resultater — aldrig
   implementering. Teknologi hører til i `docs/03-technical-architecture.md`.
5. **Spørg frem for at antage.** Er et krav tvetydigt, rejses det som et åbent spørgsmål
   i stedet for at blive afgjort stiltiende i teksten.
6. **Låste krav tilsidesættes aldrig i koden.** Afslører implementeringen en konflikt med
   produktkrav, informationsarkitektur, teknisk arkitektur eller design: **stop ved den
   konkrete konflikt og forklar den.** Et låst krav ændres ikke stiltiende for at få koden
   til at virke.

### Konventioner for implementering

- **Kode på engelsk, brugerflade på dansk.** Komponenter, filer, variabler og kommentarer
  skrives på engelsk. Al tekst, brugeren ser, er dansk.
- **Mock-data er udviklingsdata.** Den ligger adskilt fra applikationskoden, er tydeligt
  markeret som mock, og må aldrig kunne forveksles med eller blandes ind i produktionsdata.
- **Udviklingsværktøjer fremstår ikke som rigtig funktionalitet.** En rolle-switcher til
  test er ikke authorization og markeres tydeligt som development-only.
- **Ingen secrets i repoet.** API-nøgler og credentials hører til i miljøets
  secret-håndtering.
- **Dependencies holdes på et nødvendigt minimum.**
- **En fase markeres først som gennemført, når lint, typecheck og build består.**

---

## 3. Faser

| Fase | Navn | Status |
|------|------|--------|
| 1 | Produktdefinition | **Gennemført og låst** |
| 2 | Informationsarkitektur | **Gennemført og låst** |
| 3 | Teknisk arkitektur | **Gennemført og låst** |
| 4 | UI/UX-design | **Gennemført og låst** |
| 5 | Grundplatform | **Gennemført og låst** |
| 6 | Identity, database og adgangskontrol | **Gennemført og låst** |
| 7 | Knowledge Engine | **Gennemført og låst** |
| 8 | AI Gateway | **Specifikation godkendt — under implementering** |
| 9 | Produktionsgrundlag for Knowledge Engine | **Foreslået — afventer godkendelse** |
| 10+ | *Ikke fastlagt* | Ikke påbegyndt |

En fase skifter kun, når det siges eksplicit. At et dokument bliver færdigt, rykker ikke
fasen, og der arbejdes ikke forud på senere faser.

---

## 4. Dokumentation

Fasedokumenter navngives med fasens nummer. Hver fil oprettes først, når der er reelt
indhold til den; der laves ikke tomme skabeloner på forhånd.

| Fil | Fase | Status |
|-----|------|--------|
| `docs/roadmap.md` | — | Oprettet |
| `docs/01-product-definition.md` | 1 | Oprettet |
| `docs/02-information-architecture.md` | 2 | Oprettet |
| `docs/03-technical-architecture.md` | 3 | Oprettet |
| `docs/04-ui-ux-design.md` | 4 | Oprettet |
| `docs/05-foundation-implementation.md` | 5 | Oprettet |
| `docs/06-identity-database-access-control.md` | 6 | Oprettet |
| `docs/07-knowledge-engine.md` | 7 | Oprettet — gennemført og låst |
| `docs/08-ai-gateway.md` | 8 | Oprettet — specifikation godkendt |
| `docs/decisions.md` | Løbende | Oprettet |
| `docs/open-questions.md` | Løbende | Ikke oprettet |

Udestående punkter dokumenteres i det dokument, de vedrører, og gentages i
`docs/roadmap.md`. Der oprettes ikke en separat fil til åbne spørgsmål.

Fil- og mappenavne er på engelsk efter almindelig repo-konvention; alt indhold skrives på
dansk. Sig til, hvis navnene også skal være danske.

---

## 5. Konventioner for dokumentationen

**Sproget er dansk.** Al dokumentation skrives på dansk. Hvor et engelsk fagudtryk er
det, der reelt bruges i branchen, angives det i parentes første gang i ordlisten.

**Det ukendte markeres, det gættes ikke.** Brug `[AFKLARES]` inline, og opret samtidig et
punkt i `docs/open-questions.md`. Et dokument med synlige huller er mere brugbart end et,
der fremstår færdigt, men delvist er opdigtet.

**Krav nummereres og holdes atomare.** Formatet er `KRAV-<område>-<nnn>`, én testbar
udsagn pr. krav, formuleret som noget en bruger eller forretningen kan konstatere. Intet
krav beskriver, hvordan det løses teknisk.

**Ordlisten er eneste kilde til domænesproget.** Forsikringsterminologi er præcis og
flertydig på samme tid — *police*, *dækning*, *skade*, *præmie*, *partner*, *mægler*,
*forsikringstager* har alle en bestemt betydning her. Et begreb defineres én gang i
ordlisten, bruges derefter konsekvent, og der indføres aldrig et synonym for det.

**Beslutninger skrives ned, de huskes ikke.** Hvert punkt i `docs/decisions.md`
indeholder dato, beslutning, overvejede alternativer og begrundelse.

**Dokumenter rettes, de dubleres ikke.** Ændrer noget sig, opdateres det dokument, der
ejer emnet, frem for at der tilføjes en rettelse et andet sted.

---

## 6. Samarbejdsform

- Sig fra over for krav, der strider mod hinanden, mod en tidligere beslutning eller mod
  noget, der allerede står i ordlisten. At påpege konflikten er mere værd end at
  absorbere den elegant.
- Skeln mellem det, der er oplyst, og det, der er udledt. Udledninger markeres som
  sådan og lægges frem til bekræftelse.
- Et kort og præcist dokument er at foretrække frem for et langt og udfyldt.
- Når en samtale fører til en holdbar beslutning, skrives den ind i det relevante
  dokument — en chatlog er ikke projektdokumentation.

---

## 7. Produktet kort

**Insurance Partners (IPA)** er en AI-baseret platform til erhvervsforsikringsrådgivere med
to formål: at uddanne og udvikle medarbejdere, og at fungere som AI-baseret arbejds- og
sparringsværktøj i det daglige arbejde.

Fire centrale moduler: **Learn**, **Copilot**, **Practice**, **Advise**. Dertil Assessment,
Min profil, Analytics, Admin og **Knowledge Engine** — det fælles autoritative videnslag,
som alle centrale AI-funktioner bygger på.

Tre roller: **Rådgiver**, **Leder**, **Administrator**. Lederadgang og administratoradgang
er adskilte rettigheder, og adgang styres af permissions med scope — ikke af rollenavne.

Den fulde definition står i `docs/01-product-definition.md` og må ikke gentages her.

---

## 8. Vedligeholdelse af denne fil

Filen opdateres, når fasen skifter, når en ufravigelig regel tilføjes eller ophæves,
eller når dokumentationsstrukturen ændres. Afsnit 2 ændres kun efter eksplicit besked om
det.
