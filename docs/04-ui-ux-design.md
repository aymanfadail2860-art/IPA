# 04 — UI/UX-design

**Fase:** 4 — UI/UX-design
**Status:** Gennemført og låst
**Sprog:** Dansk
**Bygger på:** `docs/01-product-definition.md`, `docs/02-information-architecture.md` og
`docs/03-technical-architecture.md`, som alle er låst og behandles som autoritative krav.

Dette dokument beskriver, hvordan Insurance Partners skal se ud og opleves. Det er design,
ikke implementering. Ingen kode er skrevet, ingen afhængigheder installeret.

---

## 1. UX-principper

Fem principper styrer alle beslutninger i dokumentet. Hvor de er i konflikt med hinanden,
vinder det med lavest nummer.

**1. Grundlaget skal altid være synligt.** Brugeren skal aldrig være i tvivl om, hvad et
udsagn hviler på: er det AI-genereret, er det fagligt godkendt, er det gældende, er det
historisk, er det rådgiverens egen note. Dette er produktets vigtigste UX-opgave, fordi
det er den eneste, hvor en fejl kan ramme en kunde. Al øvrig elegance er underordnet den.

**2. Handling frem for information.** Skærme skal lede til næste skridt, ikke præsentere
alt, systemet ved. Home er ikke et dashboard, der viser tilstand — det er et cockpit, der
foreslår handling.

**3. Kontekst bevares.** At stille et spørgsmål må ikke koste brugeren sin plads i
arbejdet. Copilot åbner ved siden af opgaven, ikke i stedet for den.

**4. Ro frem for tæthed.** Luft, hvidrum og få elementer pr. skærm. En rådgiver, der
arbejder i platformen otte timer om dagen, skal kunne læse en betingelsestekst uden
visuel støj omkring sig.

**5. Ærlighed om systemets grænser.** Når AI'en ikke har grundlag, siger den det tydeligt,
og brugerfladen understøtter det i stedet for at skjule det. "Jeg fandt ikke dokumentation
for det" skal se ud som et kompetent svar, ikke som en fejl.

---

## 2. Designprincipper

Insurance Partners skal opleves som et moderne premium enterprise-produkt med AI som en
naturlig del — ikke som forsikringssoftware med en chatbot sat på.

| Vi går efter | Vi undgår |
|--------------|-----------|
| Rolige flader med meget luft | Tætpakkede skærme med paneler i paneler |
| Typografi som primært hierarki | Farvede bannere og bokse som primært hierarki |
| Diskrete borders og næsten usynlige skygger | Kraftige kanter, gradienter, dyb skyggeeffekt |
| Få, velvalgte farver med tydelig betydning | Dekorativ farve uden mening |
| Cards med indhold, der kan skimmes | Cards, der blot er rammer om mere ramme |
| Hurtig, forudsigelig navigation | Dybe menutræer og mange klik |
| Tydelige tilstande | Tilstande, der først opdages ved at klikke |

**Referencerammen er moderne fagværktøj**, ikke LMS, intranetportal eller dokumentarkiv.
Det betyder konkret: ingen "kursuskataloger" med store farvede miniaturer, ingen
mappe-i-mappe-navigation af dokumenter, ingen fremskridtsbjælker som primær motivation.

**AI er indbygget, ikke påklistret.** Copilot har en fast plads i app shell'et og en
konsistent visuel identitet på tværs af moduler. Den optræder aldrig som et flydende
ikon i hjørnet.

---

## 3. Designsystem

Designsystemet defineres som **semantiske tokens**. Konkrete værdier — hex, px, font —
fastlægges ved implementering, så en visuel justering ikke kræver ændringer i komponenter.
Undtagelsen er de faglige statusfarver, hvor betydningen er så vigtig, at rollen låses her,
selv om nuancen ikke er det.

### 3.1 Typografi

Ét typografisk sæt. Hierarkiet bæres af størrelse og vægt, ikke af farve.

| Token | Anvendelse | Karakter |
|-------|------------|----------|
| `text.display` | Sideoverskrift på Home og modulforsider | Stor, let, meget luft over |
| `text.heading.1` | Sideoverskrift | Markant |
| `text.heading.2` | Sektionsoverskrift | Tydelig |
| `text.heading.3` | Kortoverskrift, gruppetitel | Rolig |
| `text.body` | Brødtekst i grænsefladen | Læsbar |
| `text.body.reading` | Fagligt læsestof i Learn og dokumentvisning | Større, øget linjeafstand, begrænset linjelængde |
| `text.label` | Labels, tabelhoveder | Mindre, svagt forhøjet vægt |
| `text.caption` | Metadata, tidsstempler, kildeangivelser | Mindst, dæmpet |
| `text.mono` | Versionsnumre, id'er, tekniske værdier | Monospace |

**`text.body.reading` er ikke en detalje.** Learn og dokumentvisning indeholder lange
juridiske tekster. Linjelængden begrænses (omkring 65–75 tegn), og linjeafstanden er
større end i resten af grænsefladen. Det er forskellen på et akademi og en PDF-fremviser.

### 3.2 Spacing

Én skala, baseret på 4 px-trin: `space.1` til `space.16`. Regler:

- Sektioner adskilles af `space.10` eller mere. Luft er den primære adskiller — ikke linjer
- Indhold i cards har mindst `space.6` indvendigt
- Beslægtede elementer står tættere end ubeslægtede; afstand er information
- Sidens indhold har en maksimal bredde, også på brede skærme. Faglig tekst skal ikke
  strække sig over 2000 px

### 3.3 Farveroller

Ingen hex låses her. Rollerne låses.

**Visuel identitet.** Insurance Partners har sin egen selvstændige identitet og efterligner
ikke noget forsikringsselskabs brand. Retningen er premium enterprise AI/SaaS: professionel,
moderne, rolig og med høj informationsklarhed.

| Token | Retning |
|-------|---------|
| `brand.primary` | Mørk marineblå — produktets primære brandfarverolle |
| `brand.primary.subtle` | Lys marinetone til valgte tilstande og markeringer |
| `surface.base` | Off-white — ikke rent hvidt |
| `surface.raised` | Lys neutral, en anelse lysere end basen |
| Neutrale gråtoner | Kølige, afstemt mod marineblå |
| Accentfarver | Begrænset brug; ingen dekorativ farve |

Lys brugerflade er standard. Konkrete farveværdier fastlægges ved implementering og
design refinement.

**Dark mode er ikke en del af V1**, men designsystemet skal ikke gøre det unødigt svært
senere. Derfor: komponenter refererer udelukkende til semantiske tokens, aldrig til konkrete
farver; ingen farveværdi er hårdkodet i en komponent; og hver token navngives efter rolle
(`surface.raised`), ikke efter udseende (`white`). Så er dark mode et nyt sæt værdier, ikke
en ombygning.

**Flader og struktur**

| Token | Rolle |
|-------|-------|
| `surface.base` | Sidens baggrund |
| `surface.raised` | Cards, paneler |
| `surface.sunken` | Inputfelter, kodeblokke, indlejret indhold |
| `surface.overlay` | Drawers, dialoger |
| `border.subtle` | Standardkant — næsten usynlig |
| `border.strong` | Aktiv afgrænsning, fokus, valgt tilstand |

**Tekst**

`text.primary`, `text.secondary`, `text.tertiary`, `text.inverse`, `text.link`.

**Interaktion**

`accent.primary` (den ene handlingsfarve), `accent.hover`, `accent.subtle` (baggrund for
valgt tilstand), `focus.ring`.

**Feedback**

`status.success`, `status.warning`, `status.error`, `status.info` — hver med en `.subtle`
baggrundsvariant.

**Faglige statusroller — produktets vigtigste farvebeslutning**

| Token | Betydning | Hvor |
|-------|-----------|------|
| `knowledge.authoritative` | Gældende, fagligt godkendt viden | Kildekort, dokumenter, dækninger |
| `knowledge.historical` | Ikke længere gældende | Historiske dokumenter og svar |
| `knowledge.conflict` | Modstridende kilder | Copilot, Advise, Admin |
| `knowledge.insufficient` | Utilstrækkeligt grundlag | Copilot-svar, Advise-forslag |
| `ai.suggestion` | AI-genereret, ikke vurderet | Advise, Learn, Practice |
| `ai.validated` | Menneskeligt tiltrådt | Advise |
| `note.personal` | Rådgiverens egen arbejdsnote | Advise |

Disse syv roller optræder ens overalt i produktet. En bruger, der har lært, hvordan et
AI-forslag ser ud i Advise, genkender det i Learn.

**Farve bærer aldrig betydning alene.** Hver rolle har en fast trio: farve + ikon + tekstlabel.
Se afsnit 20.

### 3.4 Borders, radius og shadows

| Token | Værdi (retning) |
|-------|------------------|
| `radius.sm` | Badges, chips, inputs |
| `radius.md` | Knapper, mindre cards |
| `radius.lg` | Cards, paneler |
| `radius.full` | Avatarer, statusprikker |
| `border.width.default` | 1 px |
| `shadow.none` | Standard — fladen bæres af border, ikke af skygge |
| `shadow.sm` | Hover på interaktive cards |
| `shadow.md` | Drawers, popovers, dialoger |

Skygger bruges kun til at markere, at noget ligger **over** noget andet. Et almindeligt
card har ingen skygge.

**Stiplet kant er reserveret til AI.** `border.style.dashed` må udelukkende anvendes på
AI-genereret indhold, der afventer menneskelig vurdering. Den bruges ikke på almindelige
cards, dropzones, pladsholdere, tomme tilstande eller andre ikke-AI-elementer — heller ikke
hvor det ville være en almindelig konvention. En upload-dropzone får en fast kant. Reglen er
absolut, fordi signaturen kun virker, så længe den aldrig betyder noget andet.

### 3.5 Ikonografi

**Lucide Icons** er det primære ikonbibliotek. Linjebaseret, konsistent stregtykkelse,
ingen fyldte ikoner undtagen hvor fyld markerer aktiv tilstand.

**Et ikon kommunikerer aldrig kritisk status alene.** Hvor forståelsen ellers kan blive
tvetydig, ledsages ikonet af en label eller tekst.

Faste betydninger. Ikonerne i tabellen genbruges ikke til andre formål:

| Betydning | Lucide-ikon (vejledende) |
|-----------|---------------------------|
| AI-forslag / AI-output | `sparkles` |
| Copilot | `sparkles` (i Copilot-kontekst) |
| Valideret konklusion | `badge-check` |
| Arbejdsnote | `notebook-pen` |
| Kilde / citation | `quote` |
| Dokument | `file-text` |
| Gældende viden | `shield-check` |
| Historisk | `history` |
| Konflikt | `git-compare` |
| Utilstrækkeligt grundlag | `search-x` |
| Låst / slået fra | `lock` |
| Succes | `circle-check` |
| Advarsel | `triangle-alert` |
| Fejl | `circle-x` |
| Information | `info` |
| Tidsgrænse | `timer` |

Ikonnavnene er vejledende. Lucide omdøber lejlighedsvis ikoner mellem versioner, så de
konkrete navne verificeres ved implementering. Betydningerne er låst, navnene er det ikke.

### 3.6 Kernekomponenter

**Cards.** `surface.raised`, `radius.lg`, `border.subtle`, ingen skygge i hvile. Tre
varianter: statisk (indhold), interaktiv (hele kortet er et link, hover hæver let), og
statusbærende (venstre kant i en faglig statusfarve).

**Buttons.** Fire varianter: primær (én pr. skærm), sekundær, tertiær/ghost, destruktiv.
Tre størrelser. Alle har hvile-, hover-, aktiv-, fokus-, disabled- og loading-tilstand. En
disabled knap skal altid forklare hvorfor via tooltip — ellers gætter brugeren.

**Inputs.** Label over feltet, ikke placeholder som label. Hjælpetekst under. Fejl vises
under feltet med ikon og tekst, og feltet får `status.error`-kant. Påkrævede felter
markeres, valgfrie ikke.

**Tables.** Til lister med mange rækker: brugere, dokumenter, cases, testresultater.
Sticky header, zebra fravælges til fordel for luft og fine skillelinjer, kolonner kan
sorteres, rækkehøjde i to tætheder: **Comfortable**, som er standard, og **Compact**, som er
velegnet til Admin og Analytics. Brugerens præference kan senere gemmes på profilen. Handlinger pr. række samles i en menu
til højre. Tabeller har altid en tom tilstand.

**Badges og chips.** Badge = status (læsestof). Chip = valg eller filter (klikbar).
Statusbadges følger farve + ikon + tekst.

**Statusindikatorer.** Bruges til dokumentpipeline, casestatus, assessmentstatus og
læringsprogression. Altid med tekst.

**Charts.** Kun i Analytics og progression. Rolige, ingen 3D, ingen gradienter. Maks. fire
serier. Hver graf har en overskrift, der siger hvad man ser, og en tilgængelig
tabelrepræsentation bag en "vis data"-knap.

### 3.7 Tilstande

Alle datavisende komponenter har fem tilstande, og de designes samtidig — ikke som
eftertanke:

| Tilstand | Princip |
|----------|---------|
| **Loading** | Skeletons, der ligner det kommende indhold. Ingen spinnere til sideindhold |
| **Empty** | Forklaring + én konkret handling. Aldrig blot "Ingen data" |
| **Error** | Hvad gik galt, hvad kan brugeren gøre, og en vej videre |
| **Success** | Diskret bekræftelse. Ingen konfetti i et fagværktøj |
| **Partial** | Noget lykkedes, noget ikke — vises eksplicit frem for at se komplet ud |

`Partial` er medtaget, fordi den optræder reelt: retrieval kan finde nogle kilder men ikke
tilstrækkelige, og en dokumentbehandling kan lykkes for 8 af 10 sider.

---

## 4. App shell

Desktop-first. Fast venstre sidebar, topbar, indholdsområde og et kontekstpanel til højre,
der bruges af Copilot og kildevisning.

```
┌──────────┬────────────────────────────────────────────┬───────────────┐
│          │  TOPBAR                                    │               │
│ SIDEBAR  │  breadcrumb · søg · notifikationer · bruger│  KONTEKST-    │
│          ├────────────────────────────────────────────┤  PANEL        │
│ Home     │                                            │               │
│ Learn    │                                            │  Copilot      │
│ Copilot  │           INDHOLD                          │  eller        │
│ Practice │                                            │  kildevisning │
│ Advise   │                                            │               │
│ Assess.  │                                            │  (kan lukkes) │
│ ─────    │                                            │               │
│ Analytics│                                            │               │
│ ─────    │                                            │               │
│ Min profil                                            │               │
│ Admin    │                                            │               │
└──────────┴────────────────────────────────────────────┴───────────────┘
```

**Sidebar** er inddelt i tre grupper adskilt af luft: arbejdsområderne (Home, Learn,
Copilot, Practice, Advise, Assessment), indsigt (Analytics), og personligt/forvaltning
(Min profil, Admin). Den kan foldes til ikoner. Aktivt punkt markeres med
`accent.subtle`-baggrund og en tydelig venstremarkør — ikke med farvet tekst alene.

**Punkter, brugeren ikke har adgang til, vises ikke.** Ingen grå, låste menupunkter. En
rådgiver skal ikke navigere i en menu, der konstant minder om, hvad vedkommende ikke må.

**Topbar** indeholder breadcrumb til venstre og global søgning, notifikationer og
brugermenu til højre. Topbaren er lav og diskret; den er orientering, ikke identitet.

**Breadcrumbs** vises, hvor hierarkiet er reelt: Learn (bibliotek → produkt → forløb →
modul → lektion), Admin og Analytics' drill-down. Ikke på Home, Copilot eller Assessment.

**Global søgning** (⌘K / Ctrl+K) søger på tværs af produkter, dokumenter, læringsmoduler,
egne cases og handlinger. Resultater grupperes efter type og respekterer permissions.
Søgning er ikke Copilot: den finder ting, den besvarer ikke spørgsmål. Fra ethvert resultat
kan man dog sende spørgsmålet videre til Copilot.

**Kontekstpanel til højre** er Copilots plads, når den åbnes fra en anden side, og
kildevisningens plads, når et dokument åbnes fra et svar. Det kan udvides til halv skærm og
lukkes helt. Bredden huskes pr. bruger.

---

## 5. Navigation

**Navigationsmodellen er flad på første niveau og dyb inde i moduler.** Man er aldrig mere
end ét klik fra et hovedområde.

| Mønster | Anvendes i |
|---------|------------|
| Sidebar | Skift mellem hovedområder |
| Sekundær venstrenavigation i indholdsområdet | Learn (moduloversigt), Admin (undersektioner) |
| Trin-rail | Advise (arbejdsområder), Practice (sessionstrin) |
| Faner | Min profil, Analytics, produktforsider |
| Drawer | Copilot, kildevisning, detaljer uden at forlade listen |
| Fuldskærmstilstand | Aktiv Assessment, AI-rollespil |

**Fuldskærmstilstand** bruges kun, hvor afbrydelse skader opgaven. Den fjerner sidebar og
topbar og erstatter dem med en minimal ramme: hvad laver jeg, hvor langt er jeg, hvordan
kommer jeg ud. Det er det visuelle udtryk for, at Copilot er slået fra.

**Tilbage-adfærd** er forudsigelig: browserens tilbageknap virker altid, drawers lukkes med
Esc, og et afbrudt forløb kan genoptages fra Home.

---

## 6. Home

Home er et cockpit, ikke et dashboard. Prioriteringen er: **hvad skal jeg gøre nu** før
**hvordan går det** før **hvad er nyt**.

```
┌───────────────────────────────────────────────────────────────┐
│  God morgen, [navn]                                           │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Spørg Copilot om et produkt, en dækning eller en regel  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  NÆSTE SKRIDT                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐          │
│  │ Fortsæt læring       │  │ Anbefalet aktivitet  │          │
│  │ Erhvervsansvar       │  │ Træn objections på   │          │
│  │ Modul 4 af 11        │  │ Erhvervsansvar       │          │
│  └──────────────────────┘  └──────────────────────┘          │
│                                                               │
│  MIT ARBEJDE                                                  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Aktive kundecases (3)                    se alle →      │  │
│  │ · Nordjysk Entreprise · Risikoanalyse                   │  │
│  │ · Bagerhuset ApS · Manglende oplysninger                │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────┐  ┌──────────────────────┐          │
│  │ Seneste træning      │  │ Assessment           │          │
│  │ Behovsafdækning      │  │ 1 klar til at tage   │          │
│  └──────────────────────┘  └──────────────────────┘          │
│                                                               │
│  MIN UDVIKLING            NYT SIDEN SIDST                     │
│  [progression, kompakt]   · Erhvervsansvar: nye betingelser   │
│                             gældende 1. okt  →                │
└───────────────────────────────────────────────────────────────┘
```

**Copilot-feltet øverst** er ikke en søgebar. Det er et spørgsmålsfelt, og det sender
brugeren til Copilot med spørgsmålet stillet.

**"Nyt siden sidst"** er den eneste plads, hvor faglige ændringer når brugeren uopfordret.
Hvert punkt angiver produkt, hvad der ændrede sig, og fra hvornår det gælder — og linker
til den nye version med ændringen markeret. Ændringer, der berører brugerens aktive cases,
står øverst og markeres.

**Progression vises kompakt.** Ikke tre ringdiagrammer. Én linje med det, der er i gang, og
et link til Min profil.

**Tom tilstand for en ny bruger:** Home viser i stedet en kort introduktion og ét tydeligt
første skridt — det tildelte læringsforløb.

---

## 7. Learn

Målet er et moderne interaktivt akademi. Fagligt tungt indhold, roligt præsenteret.

### 7.1 Flow

```
Learn (forside)
  → Produktbibliotek        kort i grid, filtrering på kategori og status
    → Produkt               forside med forløb, dokumenter, hurtige svar
      → Produktforløb       11 moduler, tydelig sekvens, egen progression
        → Modul             oversigt over lektioner
          → Lektion         læseoplevelsen
          → Quiz            selvtest undervejs
          → Afsluttende case  anvendelse
```

### 7.2 Produktkort

Kortet viser produktnavn, kategori, en linje om hvad produktet dækker, brugerens status
(ikke påbegyndt / i gang med modulangivelse / gennemført), og en markering hvis produktets
grundlag er ændret siden brugeren sidst var der. Ingen dekorative billeder — typografi og
luft bærer kortet.

### 7.3 Lektionsvisningen

```
┌────────────┬──────────────────────────────────┬──────────────┐
│ FORLØB     │  Modul 3 · Dækninger             │  PÅ DENNE    │
│            │  Lektion 2 af 4                  │  SIDE        │
│ 1 Introduk.│                                  │              │
│ 2 Produktf.│  [læsetekst, begrænset bredde]   │  · Afsnit 1  │
│ 3 Dækninger│                                  │  · Afsnit 2  │
│   ● L1 ✓   │  ┌────────────────────────────┐  │              │
│   ● L2     │  │ FAGLIG CALLOUT             │  │  KILDER      │
│   ○ L3     │  │ Undtagelse værd at bemærke │  │  · Betingel- │
│ 4 Undtagel.│  └────────────────────────────┘  │    ser §4.2  │
│ …          │                                  │    [gældende]│
│            │  [ eksempel · video · figur ]    │              │
│            │                                  │  Spørg om    │
│            │  ← forrige      næste →          │  denne side  │
└────────────┴──────────────────────────────────┴──────────────┘
```

**Venstre rail** viser hele forløbet med afkrydsning. Sekvensen er synlig, men brugeren kan
springe — det er et akademi, ikke en tvangsrute.

**Midten** er læseoplevelsen: `text.body.reading`, begrænset linjelængde, generøs
afstand mellem afsnit.

**Indholdstyper** blandes bevidst, så en lektion ikke er en tekstmur: brødtekst, faglige
callouts, eksempler, figurer, video, tabeller og indlejrede mikro-quizzer. Video og figurer
har altid tekstalternativ.

**Faglige callouts** har fire varianter med fast betydning: *Vigtigt*, *Undtagelse*,
*Eksempel*, *Almindelig fejl*. De er indrammede med venstre kant i statusfarve, ikon og
label — aldrig farve alene.

**Kilder i højre panel** er det, der binder Learn til Knowledge Engine: hver lektion viser,
hvilke dokumentversioner indholdet hviler på, med gældende/historisk-markering. Et klik
åbner dokumentvisningen i kontekstpanelet.

**"Spørg om denne side"** åbner Copilot med lektionens kontekst allerede sat.

### 7.4 Quiz og afsluttende case

Quiz er lavintensiv selvtest: ét spørgsmål ad gangen, øjeblikkelig feedback, forklaring med
kildehenvisning ved forkert svar, mulighed for at prøve igen. Quiz tæller ikke som
Assessment og skal visuelt ikke ligne en prøve.

Den afsluttende case er en anvendelsesopgave: en kundesituation, brugerens vurdering, og
derefter en gennemgang, der sammenholder svaret med det faglige grundlag.

### 7.5 Completion

Når et modul afsluttes, vises en rolig bekræftelse med tre ting: hvad der er opnået, hvad
det betyder for kompetenceprofilen, og næste skridt — ofte en træning i Practice. Ingen
badges, ingen pointsystemer. Målgruppen er professionelle.

---

## 8. Copilot

Copilot er et centralt arbejdsredskab. Som hovedområde får den hele skærmen; som globalt lag
lever den i kontekstpanelet (afsnit 15). Samtaleoplevelsen er den samme begge steder.

### 8.1 Layout

```
┌──────────────┬─────────────────────────────────────┬──────────────────┐
│ SAMTALER     │                                     │ KILDER           │
│              │  Spørgsmål                          │                  │
│ + Ny samtale │  ─────────────────────────────────  │ ┌──────────────┐ │
│              │  Svar                               │ │ [1] Betingel-│ │
│ I dag        │  Tekst med kildemarkører [1] [2]    │ │ ser Erhvervs-│ │
│ · Erhvervs-  │  i løbende tekst.                   │ │ ansvar v3    │ │
│   ansvar …   │                                     │ │ §4.2 · s. 12 │ │
│ · Accept …   │  ┌───────────────────────────────┐  │ │ ● Gældende   │ │
│              │  │ GRUNDLAG                      │  │ └──────────────┘ │
│ Tidligere    │  │ 2 kilder · gældende · ingen   │  │ ┌──────────────┐ │
│ · …          │  │ konflikter                    │  │ │ [2] Accept-  │ │
│              │  └───────────────────────────────┘  │ │ regler v2 …  │ │
│ Fra kunde-   │                                     │ └──────────────┘ │
│ cases        │  Forslag til opfølgning:            │                  │
│ · Nordjysk … │  [chip] [chip] [chip]               │ [ Åbn dokument ] │
│              │  ─────────────────────────────────  │                  │
│              │  [ Stil et opfølgende spørgsmål   ] │                  │
└──────────────┴─────────────────────────────────────┴──────────────────┘
```

**Venstre:** ny samtale og historik, grupperet efter tid og efter kontekst. Samtaler ført
inde i en kundecase står under "Fra kundecases", så de kan genfindes derfra.

**Midten:** samtalen. Svar er skrevet som fagtekst, ikke som chatbobler. Brugerens spørgsmål
står som en rolig overskrift over svaret; det giver et dokumentagtigt forløb, der er
nemmere at skimme bagud end boble-på-boble.

**Højre:** kildepanelet. Kilder er ikke en fodnoteliste under svaret — de har deres egen
kolonne og er altid synlige, når der er et svar. Se afsnit 17.

### 8.2 Svarets anatomi

Hvert fagligt svar har samme opbygning:

1. **Svaret** med inline kildemarkører
2. **Grundlagslinjen** — én linje, der opsummerer hvad svaret hviler på: antal kilder,
   gældende eller historisk, konflikter ja/nej
3. **Opfølgende spørgsmål** som chips
4. **Handlinger**: kopiér, feedback (tommel op/ned med valgfri begrundelse), åbn i
   kontekst

Grundlagslinjen er det element, der gør, at brugeren kan vurdere svarets pålidelighed på to
sekunder uden at læse kilderne. Den er altid til stede, også når alt er i orden — fraværet
af en advarsel er selv information.

### 8.3 Særlige svartilstande

Tre tilstande er designet som ligeværdige svar, ikke som fejl:

**Utilstrækkeligt kildegrundlag.** Svaret siger tydeligt, at der ikke findes dokumentation,
der dækker spørgsmålet, viser hvad der blev fundet (hvis noget), og tilbyder: omformulér,
søg i et bestemt produkt, eller kontakt fagligt ansvarlig. Markeres med
`knowledge.insufficient`. Svaret indeholder ingen faglige påstande.

**Modstridende kilder.** Svaret præsenterer ikke én fortolkning. Det viser, at kilderne er
uenige, stiller dem op side om side med de relevante passager fremhævet, og oplyser, at
konflikten er meldt til fagligt ansvarlig. Markeres med `knowledge.conflict`.

**Historisk opslag.** Når brugeren eksplicit spørger om, hvad der gjaldt på en dato, bærer
hele svaret en fast markering øverst: *Historisk svar — gældende pr. [dato]. Ikke
nødvendigvis gældende i dag.* Kildekortene er markeret historiske. Markeringen kan ikke
skjules eller foldes sammen.

### 8.4 Retrieval-tilstand

Mens svaret dannes, vises tre trin i stedet for en spinner:

```
✓ Søger i vidensgrundlaget
✓ Fandt 7 relevante afsnit i 3 dokumenter
● Vurderer grundlaget …
```

Det tager ikke længere tid end en spinner, men fortæller brugeren, at svaret hviler på et
opslag — og gør tilstanden "fandt intet" forståelig, når den kommer.

---

## 9. Practice

### 9.1 Træningsoversigt

Forsiden viser de fem træningsformer som sideordnede kort — Kundecases, AI-rollespil,
Behovsafdækning, Objection Training, Produkttræning — hver med en linje om hvad den træner og
brugerens seneste aktivitet i den. Under dem: anbefalet næste træning og seneste feedback.

### 9.2 Flow

```
Vælg træning
  → Konfiguration      produkt · sværhedsgrad · kundetype · varighed
  → Træningssession    fokuseret interface
  → Afslutning         bekræft at du er færdig
  → Feedback           hvad gik godt, hvad kan forbedres, konkrete eksempler fra samtalen
  → Faglig gennemgang  kildebaseret gennemgang af de faglige punkter — Copilot tilgængelig igen
  → Anbefalet næste    træning eller læringsmodul
```

### 9.3 AI-rollespil — fokuseret samtaleinterface

Rollespillet kører i **fuldskærmstilstand**. Sidebar, topbar og kontekstpanel forsvinder.

```
┌───────────────────────────────────────────────────────────────┐
│  Rollespil · Behovsafdækning · Erhvervsansvar   12:40  [Afslut]│
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌─────────────────────────────┐                             │
│   │ KUNDE · Mette, ejer af      │                             │
│   │ Bagerhuset ApS, 14 ansatte  │                             │
│   └─────────────────────────────┘                             │
│                                                               │
│   Mette: "Vi har jo allerede en forsikring. Hvorfor …"        │
│                                                               │
│                              Dig: "Hvad dækker den i dag …"   │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  🔒 Copilot er slået fra under rollespillet                    │
│  [ Skriv dit svar …                                    ]      │
└───────────────────────────────────────────────────────────────┘
```

Her *er* samtalen boblebaseret — det er en samtale mellem to parter, i modsætning til
Copilot, der er et opslagsværktøj. Forskellen i form understøtter forskellen i funktion.

**Copilot-låsen vises, den skjules ikke.** En diskret linje over inputfeltet forklarer, at
Copilot er slået fra. Et Copilot-punkt, der blot forsvinder, efterlader brugeren i tvivl om
noget er gået i stykker; en forklaring gør reglen forståelig.

Kundepersonaen er tydeligt markeret som fiktiv på konfigurationsskærmen. Under selve
spillet gentages det ikke, for det bryder immersionen.

### 9.4 Feedback

Feedback er sektionens egentlige produkt og får derfor sin egen fulde skærm:

- **Samlet vurdering** i ord, ikke en score alene
- **Styrker** med citat fra brugerens egne replikker
- **Forbedringspunkter** med citat og et konkret alternativ
- **Faglige punkter**, hvor brugeren sagde noget fagligt forkert eller upræcist, med kilde
- **Hvad dette betyder** for udviklingsområderne i Min profil

Feedback er AI-genereret og markeres som sådan med `ai.suggestion`-behandlingen.

---

## 10. Advise

Advise er et professionelt case-workspace. Det er den skærm, hvor designets vigtigste
opgave — at gøre grundlaget synligt — har de største konsekvenser.

### 10.1 Workspace-layout

```
┌──────────────┬──────────────────────────────────────┬─────────────────┐
│ Nordjysk     │  Risikoanalyse                       │ SAGEN           │
│ Entreprise   │                                      │                 │
│ ● Aktiv      │  [indhold for arbejdsområdet]        │ Ejer: Dig       │
│              │                                      │ Delt med: 2     │
│ ARBEJDSOMR.  │                                      │ Status: Aktiv   │
│ ✓ Virksomh.  │                                      │                 │
│ ● Risiko-    │                                      │ KILDER I SAGEN  │
│   analyse    │                                      │ · 4 dokumenter  │
│ ◐ Manglende  │                                      │                 │
│   oplysn. 3  │                                      │ HISTORIK        │
│ ○ Forsikr.   │                                      │ · …             │
│   behov      │                                      │                 │
│ ○ Dækninger  │                                      │ [Copilot]       │
│ ○ Accept     │                                      │                 │
│ ○ Opsumm.    │                                      │                 │
└──────────────┴──────────────────────────────────────┴─────────────────┘
```

**Venstre trin-rail** viser de syv arbejdsområder. Navigation er fri: brugeren kan klikke
på et hvilket som helst område. Ikonet angiver tilstand — ikke påbegyndt, i gang, udfyldt,
kræver opmærksomhed — og ved "Manglende oplysninger" vises antallet af åbne punkter. Railen
viser **fuldstændighed**, ikke en lineær fremdriftsbjælke, fordi arbejdet ikke er lineært.

**Midten** er det aktive arbejdsområde.

**Højre** er sagens metadata: ejer, delte brugere, status, kilder, historik og Copilot med
sagens kontekst.

### 10.2 Fire former for indhold — visuelt umiskendelige

Dette er Advise' kernedesign. Fire slags indhold optræder side om side, og de må aldrig
kunne forveksles:

| | AI-forslag | Arbejdsnote | Valideret konklusion | Autoritativt kildegrundlag |
|--|------------|-------------|----------------------|---------------------------|
| **Token** | `ai.suggestion` | `note.personal` | `ai.validated` | `knowledge.authoritative` |
| **Flade** | Tonet baggrund | `surface.sunken` | `surface.raised`, fuld styrke | Kildekort-komponent |
| **Kant** | Stiplet venstrekant | Ingen | Fast, tyk venstrekant | Tynd fast kant |
| **Ikon** | AI-ikon | Blyant | Flueben i cirkel | Dokument |
| **Label** | "AI-forslag · ikke vurderet" | "Din note" | "Valideret af [navn] · [dato]" | "Kilde · [dokument] v[x] · Gældende" |
| **Typografi** | Normal; AI-label øverst | Normal | Normal, fed overskrift | Caption-metadata |
| **Handlinger** | Acceptér · Redigér og acceptér · Forkast | Redigér · Slet | Fortryd validering | Åbn kilde |

**Stiplet kant er AI'ens signatur.** Et AI-forslag har altid stiplet kant, og intet andet i
Advise har det. Det er den ene visuelle egenskab, der gør et forslag genkendeligt, selv for
en bruger, der ikke skelner farverne.

**Et forslag kan ikke glide over i en konklusion.** Overgangen kræver en eksplicit handling
("Acceptér"), og efter accept skifter elementet både visuel og semantisk tilstand: stiplet
bliver fast, tonet flade bliver fuld, AI-ikonet erstattes af valideringsikonet, og labelen
ændres fra "AI-forslag" til "Valideret af [navn]". Der findes ingen mellemtilstand, der
ligner begge.

Kursiv bruges ikke som AI-markør. AI-forslag kommunikeres gennem label, struktur og
signaturen — stiplet kant og tonet baggrund.

**Forkastede forslag forsvinder fra sagen.** De flyttes til en sammenklappet sektion,
"Forkastede forslag", som kun er synlig for sagens deltagere og ikke indgår i
opsummeringen. Det afspejler arkitekturbeslutningen om, at forkastede forslag ikke er en
del af den autoritative sag.

### 10.3 Arbejdsområderne

Alle syv følger samme mønster: autoritativ sagsinformation øverst, validerede konklusioner
derefter, en sektion til AI-forslag, og arbejdsnoter som et fritekstfelt i bunden.

**Manglende oplysninger** er en tjekliste, hvor rådgiveren kan bede AI'en om forslag til
spørgsmål til kunden og afkrydser dem som besvaret eller irrelevant. Åbne punkter tælles i
trin-railen.

**Dækninger** og **Accept** viser hvert AI-forslag med sine kilder direkte under sig. Et
dækningsforslag uden kilde vises ikke — det er arkitekturens grounding-regel gjort synlig.

**Opsummering** indeholder kun validerede konklusioner og autoritativ sagsinformation.
AI-forslag og arbejdsnoter kan ikke komme med. Opsummeringen viser, hvilke
dokumentversioner sagen hviler på.

### 10.4 AI på anmodning — kvalitetssignaler proaktivt

**AI-forslag er brugerinitierede.** Når et arbejdsområde åbnes, er AI-sektionen tom og
viser én handling: "Bed om analyse" eller "Bed om forslag". Rådgiveren skal aktivt bede om
det. Det bevarer rådgiverens aktive faglige rolle: man tænker selv først og bruger AI'en som
sparring, i stedet for at vurdere noget, der allerede ligger klar.

**Kvalitetssignaler vises proaktivt.** Systemet må uopfordret vise signaler, der forhindrer
oversete problemer:

- manglende kritiske oplysninger
- dokumentkonflikter
- utilstrækkeligt kildegrundlag
- mulig inkonsistens i sagens oplysninger
- relevante advarsler

**Et signal er ikke et forslag, og det ser ikke ud som et.** Kvalitetssignaler bruger
status-behandlingen — advarsels- eller informationsfarve, ikon og tekst — og aldrig den
stiplede AI-signatur. De peger på et problem; de anbefaler ikke en løsning. Et signal kan
føre til en handling ("Se konflikten", "Gå til Manglende oplysninger"), men aldrig til en
færdig rådgivningskonklusion.

```
┌───────────────────────────────────────────────────────┐
│ ⚠  2 kritiske oplysninger mangler                     │  ← kvalitetssignal
│    Omsætning · Antal ansatte        Gå til →          │     (proaktivt)
└───────────────────────────────────────────────────────┘

  FORSLAG TIL VURDERING
┌───────────────────────────────────────────────────────┐
│ ✦  Bed AI om forslag til dækninger                    │  ← on demand
└───────────────────────────────────────────────────────┘
```

Kvalitetssignalerne placeres øverst i arbejdsområdet og samles desuden i højrepanelet under
"Opmærksomhedspunkter". Trin-railen markerer et arbejdsområde med et åbent signal.

### 10.5 Ejerskab, deling og status

| Element | Design |
|---------|--------|
| **Ejer** | Avatar og navn øverst i højrepanelet |
| **Delte brugere** | Avatarrække med adgangstype ved hover. "Del sag" åbner dialog med søgning og valg af adgangstype |
| **Casestatus** | Badge: Kladde · Aktiv · Afventer kunde · Afsluttet |
| **Overdragelse** | Dialog der viser ny ejer, forklarer hvad der overføres, og kræver bekræftelse. Registreres i historikken |
| **Review/four-eyes** | Reserveret plads i højrepanelet og statusværdien "Til review", som ikke er aktiv i V1 |
| **Historik** | Tidslinje over handlinger: oprettet, delt, forslag accepteret, overdraget |

Når en sag er delt, vises på hvert valideret element, hvem der validerede det.

---

## 11. Assessment

### 11.1 Skærme

**Assessment-bibliotek:** tilgængelige prøver som kort med produkt, type (test eller case),
varighed, forudsætninger og brugerens status. Låste prøver viser, hvilket læringsforløb der
skal gennemføres først.

**Startside:** hvad prøven dækker, hvor lang tid den tager, hvad der måles, hvordan
resultatet bruges — og en tydelig besked om, at Copilot og AI-hjælp er slået fra under
prøven. Brugeren starter aktivt.

### 11.2 Aktiv prøve

Fuldskærmstilstand. Den mest fokuserede skærm i produktet.

```
┌───────────────────────────────────────────────────────────────┐
│  Assessment · Erhvervsansvar         Spørgsmål 7 af 20   24:13│
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   [spørgsmål]                                                 │
│                                                               │
│   ○ Svarmulighed A                                            │
│   ○ Svarmulighed B                                            │
│   ○ Svarmulighed C                                            │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  🔒 Copilot og AI-hjælp er slået fra   [markér til senere]    │
│  ← forrige                                          næste →   │
└───────────────────────────────────────────────────────────────┘
```

Skjult under prøven: sidebar, topbar, global søgning, Copilot, kildepaneler, "Spørg om
denne side" og alle andre AI-indgange. Synligt: spørgsmål, fremdrift, tid (hvis relevant),
markér til senere, navigation.

Cases i Assessment har samme fokuserede ramme med et bredere indholdsområde til
kundebeskrivelsen og et tekstfelt til besvarelsen.

### 11.3 Enhedspolitik

Assessment må som udgangspunkt gennemføres på mobil. Hver prøve kan markeres med en
enhedspolitik:

| Politik | Adfærd |
|---------|--------|
| **Mobile allowed** | Standard. Prøven kan tages på alle enheder |
| **Desktop recommended** | Startsiden anbefaler desktop på mindre skærme, men tillader at fortsætte |
| **Desktop required** | Startsiden forklarer på mindre skærme, at prøven kræver desktop, og tilbyder at huske den til senere |

Politikken vises på prøvekortet i biblioteket, så brugeren ved det, før prøven åbnes.

### 11.4 Tidsbegrænsning

Prøver kan være uden eller med tidsgrænse. Har en prøve tidsgrænse:

- **Resterende tid er synlig under hele prøven** i den faste ramme øverst — aldrig skjult
  bag et klik
- Startsiden oplyser tidsgrænsen, før prøven begyndes
- Advarsler vises ved tærskler, fx 10, 5 og 1 minut tilbage. Tærsklerne er konfiguration
- Advarslen er en diskret, men tydelig besked i rammen med ikon og tekst — ikke en dialog,
  der afbryder besvarelsen
- Det sidste minut markeres med advarselsfarve, ikon og tekst, ikke farve alene
- Ved udløb afleveres besvarelsen automatisk, og brugeren får at vide, at det skete, og at
  alle besvarelser er gemt

Prøver uden tidsgrænse viser ingen timer, kun fremdrift.

### 11.5 Aflevering og resultat

**Aflevering:** oversigt over besvarede, ubesvarede og markerede spørgsmål før endelig
aflevering. Afleveringen er uigenkaldelig og siger det.

**Resultat:** bestået/ikke bestået i ord, ikke kun farve. Derefter pr. spørgsmål: dit svar,
korrekt svar, forklaring med kilde.

**Kompetencepåvirkning:** hvilke kompetencer resultatet har påvirket, og hvordan.

**Efter prøven er Copilot tilbage.** På resultatsiden står den fremme med kontekst: "Gennemgå
dine fejl med Copilot". Overgangen fra låst til tilgængelig er synlig og bevidst — det er
det øjeblik, situationen skifter fra præstation til læring.

---

## 12. Analytics

Lederens cockpit. Desktop-optimeret.

### 12.1 Teamoversigt

```
┌───────────────────────────────────────────────────────────────┐
│  Analytics · Erhverv Nord              [Team ▾]  [Periode ▾]  │
│                                                               │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │
│  │ Læring    │ │ Assessment│ │ Kompetence│ │ Aktivitet │     │
│  │ 68 %      │ │ 12 bestået│ │ 4 områder │ │ ↑ 12 %    │     │
│  │ gennemf.  │ │ 3 ikke    │ │ under mål │ │ ift. sidst│     │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘     │
│                                                               │
│  UDVIKLINGSOMRÅDER I TEAMET        TENDENS                    │
│  [liste, sorteret efter antal]     [linjegraf]                │
│                                                               │
│  MEDARBEJDERE                                                 │
│  Navn         Læring   Assessment   Kompetencer   Seneste     │
│  ─────────────────────────────────────────────────────────    │
│  …                                                   →        │
└───────────────────────────────────────────────────────────────┘
```

**Teamvælgeren** viser kun de teams, lederen har scope til, som et hierarki. Er
`include_descendants` sat, kan lederen vælge et overordnet team og se underteams samlet.

**Nøgletal** har altid en forklarende tekst — "68 % gennemført" siger mere end "68".

**Drill-down:** team → medarbejder → område. Medarbejdervisningen viser samme kategorier som
rådgiverens egen Min profil, så leder og medarbejder taler ud fra samme billede.

**Adgangsmarkering.** Øverst i medarbejdervisningen står diskret, at visningen er
registreret. Det er ikke en advarsel, men en konsekvens af, at adgangen logges.

**Kundecases vises ikke i Analytics**, heller ikke som titler. Lederens indsigt gælder
læring og kompetence, ikke kundeoplysninger.

---

## 13. Min profil

Faner: **Overblik**, **Kompetencer**, **Historik**, **Synlighed**.

**Overblik:** personlig progression, styrker og udviklingsområder, anbefalet læring.

**Kompetencer:** kompetenceprofilen med niveau pr. område og hvilke resultater der ligger
bag hvert niveau. Visningen er her; opgørelsen sker i Assessment.

**Historik:** gennemførte forløb, Assessment-resultater, træningssessioner — kronologisk og
filtrerbart.

### 13.1 Fanen "Synlighed" — hvad din leder kan se

Den fane, der gør lederens adgang på individniveau acceptabel. Den besvarer tre spørgsmål i
klart sprog:

```
┌───────────────────────────────────────────────────────────────┐
│  HVEM KAN SE DINE DATA                                        │
│                                                               │
│  Anne Holm (leder, Erhverv Nord) kan se:                      │
│                                                               │
│  ✓ Din læringsprogression                                     │
│  ✓ Gennemførte læringsforløb                                  │
│  ✓ Assessment-resultater                                      │
│  ✓ Kompetencer                                                │
│  ✓ Udviklingsområder                                          │
│                                                               │
│  Kan ikke se:                                                 │
│  ✗ Dine Copilot-samtaler                                      │
│  ✗ Indholdet af dine kundecases                               │
│  ✗ Dine arbejdsnoter                                          │
│  ✗ Dine svar i øvelser og rollespil, ud over den samlede      │
│    feedback                                                   │
└───────────────────────────────────────────────────────────────┘
```

Listen genereres fra de faktiske permissions — ikke fra en statisk tekst — så den altid er
sand. Både "kan se" og "kan ikke se" vises, fordi den anden liste er den, der skaber
tryghed.

**Transparens om adgang, ikke om visninger.** Fanen forklarer, hvilke *kategorier* af
brugerens data en autoriseret leder kan se. Den viser ikke, hvornår eller hvor ofte lederen
har set dem. Formålet er at gøre adgangen forståelig — ikke at skabe en brugerflade, der
opleves som overvågning i nogen retning. Adgangen logges fortsat i audit, jf. den tekniske
arkitektur, men det er et kontrolspor, ikke en brugerfunktion.

---

## 14. Admin

Desktop-optimeret. Sekundær venstrenavigation: Produkter, Dokumenter, Knowledge Base,
Læringsindhold, Brugere, Teams, Permissions, Versioner, Systemindstillinger.

### 14.1 Dokumentpipeline

Den centrale Admin-skærm. Pipelinen visualiseres som en statuskæde, hvor der er et **tydeligt
brud** mellem teknisk behandling og faglig godkendelse:

```
  TEKNISK BEHANDLING                  ║  FAGLIG GODKENDELSE
                                      ║
  Uploadet → Behandles → Klar til ─────╫──→ Godkendt → Aktiv
                         review        ║
                                      ║
  automatisk                          ║  kræver menneske
```

Bruddet er visuelt markeret med en lodret skillelinje og to forskellige overskrifter. Det
gør arkitekturens vigtigste regel synlig: at ingen del af den automatiske behandling kan
gøre et dokument autoritativt.

**Dokumentlisten** er en tabel med faner pr. status. Fanen "Klar til review" har et tal og
er det, en fagligt ansvarlig åbner først.

### 14.2 Review-skærmen

```
┌─────────────────────────────────┬──────────────────────────────┐
│ DOKUMENT                        │ KVALITETSRAPPORT             │
│                                 │ ✓ 42 af 42 sider læst        │
│ [preview med struktur markeret] │ ✓ Struktur genkendt          │
│                                 │ ⚠ 3 afsnit uden overskrift   │
│                                 │ ✓ Metadata udfyldt           │
│                                 │ ⚠ Overlapper gyldighed med v2│
│                                 │                              │
│                                 │ METADATA                     │
│                                 │ Produkt · Type · Version     │
│                                 │ Gyldig fra · til · Sprog     │
│                                 │ Adgang                       │
│                                 │                              │
│                                 │ ┌──────────────────────────┐ │
│                                 │ │ Godkend som autoritativ  │ │
│                                 │ └──────────────────────────┘ │
│                                 │ Afvis                        │
└─────────────────────────────────┴──────────────────────────────┘
```

**"Godkend som autoritativ" er en bevidst handling.** Knappen åbner en bekræftelsesdialog,
der opsummerer konsekvensen: dokumentet bliver gældende grundlag for Copilot, Learn,
Practice og Advise fra den angivne dato, og en eventuel tidligere version bliver
erstattet. Dialogen viser advarsler fra kvalitetsrapporten igen. Knapteksten siger "Godkend
som autoritativ", ikke "Gem" eller "OK".

**Ingestion-handlinger og godkendelseshandlinger ser forskellige ud.** Upload og genbehandl
er almindelige sekundære knapper. Godkend er den eneste primære knap på skærmen og har sin
egen bekræftelse.

### 14.3 Fejl og konflikter

| Tilstand | Visning |
|----------|---------|
| Kunne ikke læses | Rød status i listen, årsag i klartekst, handling: upload igen |
| Manglende metadata | Advarsel, godkend-knappen deaktiveret med forklaring |
| Dublet | Dialog ved upload: ny version, erstat eller afvis |
| Delvist behandlet | `Partial`-tilstand: "8 af 10 sider behandlet" med detaljer |
| Dokumentkonflikt | Egen kø under Knowledge Base med begge dokumenter side om side og de modstridende passager fremhævet |
| Erstattet | Vises i versionshistorik med link til efterfølger |
| Deaktiveret | Grå status, fortsat synlig i historik, ikke i retrieval |

### 14.4 Øvrige Admin-skærme

**Produkter:** liste og redigering, med oversigt over tilknyttede dokumenter og forløb.
**Knowledge Base:** videnshuller (spørgsmål uden tilstrækkelig dokumentation, samlet og
sorteret efter hyppighed), konfliktkø og dækningsoversigt pr. produkt. **Læringsindhold:**
forløb, moduler, lektioner, quizzer, cases. **Brugere og Teams:** tabel med roller og
teammedlemskab; teams som redigerbart træ. **Permissions:** roller som samlinger af
permissions, og lederscopes pr. bruger. **Versioner:** tidslinje pr. dokument.

Videnshul-oversigten er den skærm, der forvandler Copilots "jeg fandt ikke dokumentation"
fra en brugerfrustration til en arbejdsopgave for de fagligt ansvarlige.

---

## 15. Global Copilot

Copilot kan åbnes fra enhver skærm uden at forlade den.

### 15.1 Indgange

| Indgang | Adfærd |
|---------|--------|
| Sidebar-punktet "Copilot" | Åbner hovedområdet i fuld visning |
| Tastaturgenvej (⌘J / Ctrl+J) | Åbner kontekstpanelet på den aktuelle side |
| "Spørg om denne side" i Learn | Åbner panelet med lektionens kontekst |
| Copilot-knap i Advise' højrepanel | Åbner panelet med sagens kontekst og aktuelle arbejdsområde |
| Markér tekst → "Spørg Copilot" | Åbner panelet med den markerede tekst som udgangspunkt |
| Copilot-feltet på Home | Åbner hovedområdet med spørgsmålet stillet |

### 15.2 Kontekstpanelet

Panelet åbner i højre side og skubber indholdet til side frem for at lægge sig over det, så
brugeren kan se begge dele. Øverst i panelet står **konteksten** som en chip: "Kontekst:
Erhvervsansvar · Modul 3 · Dækninger". Brugeren kan fjerne den og stille et generelt
spørgsmål.

Samtalen kan udvides til fuld Copilot-visning med ét klik og fortsætter der.

**På desktop** åbner Copilot som et sidepanel, der skubber arbejdsområdet til side, så den
aktuelle kontekst forbliver synlig. **På mindre skærme** åbner Copilot som overlay (tablet)
eller i fuldskærmsvisning (mobil), med kontekstchippen bevaret øverst.

### 15.3 Når Copilot er låst

Under aktiv Assessment og under AI-rollespil er Copilot ikke tilgængelig. Da begge kører i
fuldskærmstilstand, er de normale indgange allerede væk. Tastaturgenvejen giver en kort
besked: "Copilot er slået fra under [prøven/rollespillet]." Låsen håndhæves på serveren; UI'et
forklarer den blot.

### 15.4 Tastaturgenveje

| Genvej | Funktion |
|--------|----------|
| Cmd/Ctrl + K | Global søgning |
| Cmd/Ctrl + J | Global Copilot |

Genvejene gælder desktop. De defineres ét sted som konfiguration frem for at være bundet
ind i komponenterne, så de senere kan ændres eller slås fra — organisationsbredt eller af
den enkelte bruger — hvis de kolliderer med andre værktøjer. En genvej, der er slået fra,
fjernes også fra tooltips og hjælpetekster.

---

## 16. AI-states

Alle AI-elementer i produktet deler et fast sæt tilstande:

| Tilstand | Visning |
|----------|---------|
| **Idle** | Inputfelt med kontekstchip |
| **Retrieving** | Trinvis fremdrift: søger → fandt → vurderer |
| **Generating** | Tekst strømmer ind; kildemarkører vises, når de er bekræftet |
| **Complete** | Svar + grundlagslinje + kilder + opfølgning |
| **Insufficient** | Tydeligt svar om manglende grundlag, ingen faglige påstande |
| **Conflict** | Kilder side om side, ingen afgørelse |
| **Historical** | Fast markering over hele svaret |
| **Error** | Systemfejl — adskilt fra "insufficient" — med genforsøg |
| **Locked** | Forklaring på hvorfor AI ikke er tilgængelig her |
| **Suggestion** | AI-output, der afventer menneskelig vurdering (Advise, feedback) |

**"Insufficient" og "Error" må ikke ligne hinanden.** Det første er et kompetent svar — der
findes ingen dokumentation. Det andet er et systemsvigt. Forveksles de, lærer brugerne at
ignorere det vigtigste svar, systemet kan give.

**Streaming respekterer reduced motion.** Er reduceret bevægelse slået til, vises svaret i
blokke frem for ord for ord.

---

## 17. Source/citation UX

Kilder er first-class UI-elementer. Brugeren skal altid kunne besvare fire spørgsmål uden at
åbne et dokument: *hvad bygger svaret på, hvilke dokumenter, er det gældende, er AI'en
usikker?*

### 17.1 Tre niveauer

**Niveau 1 — Kildemarkør.** Et lille nummereret mærke i teksten, `[1]`. Hover eller fokus
viser et popover-kort med dokument og afsnit. Klik fremhæver kildekortet i panelet.

**Niveau 2 — Kildekort.** Den centrale komponent:

```
┌───────────────────────────────────┐
│ [1]  Betingelser for Erhvervs-    │
│      ansvar                       │
│      Version 3 · §4.2 · side 12   │
│                                   │
│      "…uddrag af den passage,     │
│      svaret bygger på…"           │
│                                   │
│  ● Gældende fra 1. juli 2025      │
│                          Åbn →    │
└───────────────────────────────────┘
```

Kortet viser altid: nummer, dokumenttitel, version, afsnit og side, et kort uddrag og
gyldighedsstatus med ikon og tekst.

**Niveau 3 — Dokumentvisning.** Åbner i kontekstpanelet med dokumentet scrollet til den
citerede passage, der er fremhævet. Øverst: titel, version, gyldighedsperiode, status, og
en genvej til versionshistorikken.

### 17.2 Statusvarianter af kildekortet

| Status | Behandling |
|--------|------------|
| **Gældende** | Standardkort med `knowledge.authoritative`-markør |
| **Historisk** | Tonet flade, `knowledge.historical`-markør, label "Historisk — gjaldt [periode]", link til gældende version |
| **I konflikt** | `knowledge.conflict`-kant, label "Modstrider kilde [2]", parret visning |
| **Deaktiveret** | Vises kun i gamle samtaler og sager, med label "Ikke længere del af vidensgrundlaget" |

Et historisk kildekort i et aktuelt svar må ikke forekomme — arkitekturen forhindrer det.
Kommer det alligevel, er det en fejl, og kortets markering gør den synlig.

---

## 18. Loading, error og empty states

### 18.1 Loading

| Situation | Behandling |
|-----------|------------|
| Sideindlæsning | Skeletons i indholdets form |
| AI-svar | Trinvis retrieval-fremdrift (afsnit 8.4) |
| Dokumentbehandling | Status i pipelinen; brugeren venter ikke på skærmen |
| Handling (gem, del) | Knappen går i loading-tilstand; resten af skærmen forbliver brugbar |

### 18.2 Error

Hver fejl svarer på: hvad skete, er mit arbejde i sikkerhed, hvad kan jeg gøre nu.

| Type | Eksempel |
|------|----------|
| Inline | Valideringsfejl ved et felt |
| Komponent | "Kunne ikke hente seneste træning" — resten af siden virker |
| Side | Siden kunne ikke indlæses, med genforsøg og vej tilbage |
| Adgang | "Du har ikke adgang til denne sag" — uden at afsløre sagens indhold |
| AI | Adskilt fra "insufficient", se afsnit 16 |

Arbejde i Advise og i en aktiv Assessment gemmes løbende. En fejlbesked i de to områder skal
altid oplyse, om besvarelsen eller sagen er gemt.

### 18.3 Empty

| Skærm | Tom tilstand |
|-------|--------------|
| Home, ny bruger | Velkomst + første tildelte læringsforløb |
| Aktive kundecases | "Ingen aktive sager" + Opret kundecase |
| Copilot-historik | Eksempler på spørgsmål, man kan stille |
| Practice, ingen historik | Anbefalet første træning |
| Analytics, intet scope | "Du er ikke leder for et team endnu" — kontakt administrator |
| Admin, ingen til review | "Intet afventer faglig godkendelse" |
| Knowledge Base, ingen videnshuller | Rolig bekræftelse |

### 18.4 Success

Diskret toast for mindre handlinger. For større handlinger — godkendelse af dokument,
aflevering af prøve, afslutning af forløb — en bekræftelse i selve skærmen, der forklarer
konsekvensen.

---

## 19. Responsive design

Desktop er den primære arbejdsflade. Arkitekturen er responsiv fra start, men ambitionsniveauet
varierer pr. område.

| Område | Desktop | Tablet | Mobil |
|--------|---------|--------|-------|
| Home | Fuld | Fuld | Fuld, én kolonne |
| Learn | Fuld | Fuld — velegnet til læsning | Fuld læsning, kildepanel som bundark |
| Copilot | Skubbende sidepanel | Overlay | Fuldskærm, kilder som bundark |
| Practice | Fuld | Fuld | Rollespil ja; konfiguration forenklet |
| Assessment | Fuld | Fuld | Fuld, medmindre prøven kræver desktop |
| Min profil | Fuld | Fuld | Fuld, faner som liste |
| Advise | Fuld | Læsning og noter | Kun læsning |
| Analytics | Fuld | Oversigt | Kun nøgletal |
| Admin | Fuld | Ikke understøttet | Ikke understøttet |

**Breakpoints** defineres som tokens: `bp.mobile`, `bp.tablet`, `bp.desktop`, `bp.wide`.

**Tilpasninger:** sidebar bliver til en skuffe under `bp.desktop`; kontekstpanelet bliver et
bundark på mobil; tabeller bliver til kortlister; trin-rail i Advise bliver til en
rullemenu.

Ikke-understøttede kombinationer viser en ærlig besked — "Admin er designet til desktop" —
frem for en ødelagt visning.

---

## 20. Accessibility

Målet er WCAG 2.2 AA som minimum.

**Status kommunikeres aldrig gennem farve alene.** Hver status har farve + ikon + tekst. For
Advise' fire indholdsformer er der desuden et fjerde signal: stiplet kant for AI-forslag.
Designet skal fungere i gråtoner.

**Keyboard.** Alt kan betjenes med tastatur. Logisk tabrækkefølge. Drawers og dialoger
fanger fokus og returnerer det ved lukning. Esc lukker overlays. Genveje er dokumenterede
og kan slås fra.

**Fokus.** Synlig fokusring på alle interaktive elementer via `focus.ring`, med
tilstrækkelig kontrast mod både `surface.base` og `surface.raised`.

**Kontrast.** Tekst mindst 4.5:1, stor tekst og UI-elementer mindst 3:1. Gælder også
tonede flader som AI-forslag og historiske kildekort.

**Skærmlæsere.**
- Kildemarkører læses som "Kilde 1: Betingelser for Erhvervsansvar, version 3"
- Streamede AI-svar annonceres, når de er færdige — ikke ord for ord
- Retrieval-trin annonceres via en live region
- Advise-elementer bærer deres status i den tilgængelige tekst: "AI-forslag, ikke vurderet"
- Grafer har en tabelrepræsentation

**Reduced motion.** Ingen animation, der bærer betydning. Streaming, overgange og
skeleton-shimmer respekterer brugerens indstilling.

**Labels.** Alle felter har synlige labels. Ikonknapper har tilgængelige navne.

**Tidsgrænser.** Timeradvarsler annonceres for skærmlæsere via en live region ved hver
tærskel — ikke hvert sekund. Timeren er ikke animeret, når reduceret bevægelse er slået til.
Tidsgrænser i Assessment skal kunne forlænges administrativt, hvor en bruger har behov for
det.

**Sprog.** Sidens sprog er angivet som dansk, så skærmlæsere udtaler korrekt.

---

## 21. Rollebaserede UI-forskelle

UI'et tilpasser sig brugerens **permissions**, ikke rollenavnet. Tabellen viser
udgangspunktet for de tre roller.

| Element | Rådgiver | Leder | Administrator |
|---------|----------|-------|---------------|
| Sidebar: arbejdsområder | ✓ | ✓ | ✓ |
| Sidebar: Analytics | — | ✓ | Efter rettigheder |
| Sidebar: Admin | — | — | ✓ |
| Home: teamsektion | — | Kompakt teamstatus | — |
| Home: Admin-opgaver | — | — | "Til review", konflikter |
| Min profil: Synlighed | ✓ | ✓ (egen) | ✓ (egen) |
| Advise: delte sager | Tildelte | Tildelte | Tildelte |
| Global søgning | Egne data + viden | + teammedlemmer | + admin-objekter |
| Copilot: historiske dokumenter | Efter permission | Efter permission | ✓ |

**Principper:**

- Utilgængelige områder vises ikke, frem for at blive vist låst
- En leder ser ikke automatisk teamets kundesager
- En leder er også rådgiver og har sin egen Home, Learn og Min profil
- Der findes ingen "leder-version" af skærmene — lederen har de samme skærme plus Analytics

---

## 22. Centrale user flows

**Flow 1 — Spørgsmål midt i en lektion**
Learn-lektion → "Spørg om denne side" → Copilot-panel med kontekst → svar med kilder → åbn
kilde i panelet → luk panel → fortsæt lektionen, samme sted.

**Flow 2 — Fra læring til træning**
Gennemført modul → completion-skærm → "Træn det nu" → Practice-konfiguration forudfyldt →
rollespil i fuldskærm → feedback → faglig gennemgang med Copilot → anbefalet næste.

**Flow 3 — Rådgivning af ny kunde**
Home → Opret kundecase → Virksomhedsprofil → Risikoanalyse → AI-forslag vurderes: to
accepteres, ét forkastes → Manglende oplysninger: tre spørgsmål til kunden → sagen sættes til
"Afventer kunde" → senere retur via Home → Dækninger → Accept → Opsummering med kun validerede
konklusioner.

**Flow 4 — Assessment med efterfølgende gennemgang**
Assessment-bibliotek → startside med besked om låst Copilot → fuldskærm → aflevering →
resultat → "Gennemgå fejl med Copilot" → forklaring med kilder → anbefalet læringsmodul.

**Flow 5 — Ny betingelse bliver gældende**
Admin uploader → pipeline: behandles → klar til review → fagligt ansvarlig åbner
review-skærmen → gennemgår kvalitetsrapport → godkender som autoritativ med bekræftelse →
rådgivere ser ændringen i "Nyt siden sidst" → rådgiver med aktiv sag på produktet ser den
markeret øverst.

**Flow 6 — Leder følger op**
Analytics → teamoversigt → udviklingsområde med flest medarbejdere → drill-down til
medarbejder → samme kategorier som medarbejderens Min profil → udviklingssamtale ud fra
fælles billede.

**Flow 7 — Rådgiver tjekker synlighed**
Min profil → Synlighed → ser præcist hvad lederen kan og ikke kan se.

**Flow 8 — Copilot finder ikke grundlag**
Spørgsmål → retrieval → "Fandt ingen tilstrækkelig dokumentation" → forslag til
omformulering eller kontakt → hændelsen dukker op i Admin → Knowledge Base → Videnshuller.

---

## 23. Nødvendige skærme

**Shell og fælles** (6): App shell · Global søgning · Notifikationer · Brugermenu · Adgang
nægtet · Fejlside

**Home** (2): Home · Home, ny bruger

**Learn** (9): Learn-forside · Produktbibliotek · Produktforside · Produktforløb · Modul ·
Lektion · Quiz · Afsluttende case · Completion

**Copilot** (4): Copilot fuld visning · Kontekstpanel · Dokumentvisning · Samtalehistorik

**Practice** (8): Practice-forside · Træningsformens forside (×5 varianter af én skabelon) ·
Konfiguration · Træningssession · AI-rollespil (fuldskærm) · Afslutning · Feedback · Faglig
gennemgang

**Advise** (12): Sagsoversigt · Opret kundecase · Case-workspace · Virksomhedsprofil ·
Risikoanalyse · Manglende oplysninger · Forsikringsbehov · Dækninger · Accept · Opsummering ·
Del sag (dialog) · Overdrag sag (dialog)

**Assessment** (6): Assessment-bibliotek · Startside · Aktiv prøve (fuldskærm) · Aktiv case
(fuldskærm) · Aflevering · Resultat

**Analytics** (4): Teamoversigt · Medarbejdervisning · Kompetenceoversigt · Tendenser

**Min profil** (4): Overblik · Kompetencer · Historik · Synlighed

**Admin** (15): Admin-forside · Produkter · Produktredigering · Dokumentliste · Upload ·
Review-skærm · Godkendelsesdialog · Konfliktkø · Videnshuller · Læringsindhold · Brugere ·
Teams · Permissions og roller · Versionshistorik · Systemindstillinger

**I alt ca. 70 skærme**, hvoraf en del er varianter af fælles skabeloner.

---

## 24. Reusable components

**Fundament**
Button · IconButton · Input · Textarea · Select · Checkbox · Radio · Switch · Label · HelpText
· FieldError · Tooltip · Popover · Dialog · Drawer · BottomSheet · Toast · Tabs · Breadcrumb
· Avatar · AvatarStack · Badge · Chip · Divider · Skeleton · Spinner (kun i knapper)

**Layout**
AppShell · Sidebar · Topbar · ContextPanel · PageHeader · Section · Card · CardGrid ·
FullscreenFrame · EmptyState · ErrorState · StepRail

**Data**
DataTable · KeyMetric · Chart (linje, søjle) · ChartDataTable · ProgressIndicator ·
StatusIndicator · Timeline · FilterBar

**Viden og AI — produktspecifikke**
- `SourceMarker` — inline kildemarkør
- `SourceCard` — kildekort med statusvarianter
- `DocumentViewer` — dokument med fremhævet passage
- `GroundingLine` — opsummering af svarets grundlag
- `RetrievalProgress` — trinvis søgetilstand
- `AIAnswer` — svarcontainer med alle AI-states
- `AISuggestion` — stiplet, tonet, med Acceptér/Redigér/Forkast
- `ValidatedConclusion` — fast kant, valideret af
- `WorkingNote` — personlig note
- `ConflictView` — to kilder side om side
- `HistoricalBanner` — fast markering af historisk indhold
- `InsufficientEvidence` — svar ved manglende grundlag
- `CopilotInput` — med kontekstchip
- `ContextChip` — viser og fjerner Copilot-kontekst
- `LockedState` — forklaring når AI er slået fra
- `FollowUpChips` — opfølgende spørgsmål
- `AIRequestTrigger` — "Bed om analyse/forslag" til on-demand AI i Advise

**Domæne**
ProductCard · LessonNav · CalloutBox · QuizQuestion · CompletionPanel · TrainingCard ·
RoleplayChat · FeedbackReport · CaseHeader · CaseParticipants · CaseStatusBadge ·
PipelineStatus · QualityReport · ApprovalDialog · VisibilityPanel · TeamPicker ·
CompetencyProfile · QualitySignal · AssessmentTimer · DevicePolicyNotice · DensityToggle

De produktspecifikke Viden og AI-komponenter er dem, designsystemet står og falder med. De
skal bygges og godkendes først, fordi alle moduler afhænger af dem, og fordi en uoverensstemmelse
mellem modulerne i netop disse komponenter vil undergrave brugerens evne til at aflæse
grundlaget.

---

## 25. Låste beslutninger og non-blocking punkter

### 25.1 Låst i fase 4

| # | Beslutning | Afsnit |
|---|------------|--------|
| 1 | Selvstændig visuel identitet: premium enterprise AI/SaaS, lys flade, mørk marineblå som primær brandrolle, off-white baggrunde, begrænset accent | 3.3 |
| 2 | AI-signatur: stiplet kant, tonet baggrund, tydelig label. Stiplet kant udelukkende til AI. Ingen kursiv som AI-markør | 3.4, 10.2 |
| 3 | Copilot som skubbende sidepanel på desktop; overlay eller fuldskærm på mindre skærme | 15.2 |
| 4 | Transparens om hvilke datakategorier lederen kan se — ingen "senest set" | 13.1 |
| 5 | Assessment tilladt på mobil med enhedspolitik pr. prøve | 11.3 |
| 6 | Assessment med og uden tidsgrænse; resterende tid altid synlig; advarsler ved tærskler | 11.4 |
| 7 | Tabeltæthed Comfortable (standard) og Compact | 3.6 |
| 8 | Ingen dark mode i V1; tokenarkitekturen holder vejen åben | 3.3 |
| 9 | AI-forslag i Advise on demand; kvalitetssignaler proaktivt og visuelt adskilt | 10.4 |
| 10 | Lucide Icons med faste betydninger; ikon aldrig alene ved kritisk status | 3.5 |
| 11 | Cmd/Ctrl+K søgning, Cmd/Ctrl+J Copilot; konfigurerbare og deaktiverbare | 15.4 |

### 25.2 Non-blocking designbeslutninger

Punkterne nedenfor påvirker ikke strukturen og kan afgøres under implementering eller
design refinement:

| # | Punkt | Hvorfor den ikke blokerer |
|---|-------|---------------------------|
| 1 | Konkrete farveværdier, herunder den præcise marinetone | Alle komponenter refererer til tokens |
| 2 | Konkret typografi (skrifttype) | Hierarkiet er defineret via tokens |
| 3 | Konkrete tærskler for timeradvarsler | Konfiguration |
| 4 | Endelige Lucide-ikonnavne | Betydningerne er låst |
| 5 | Om tæthedspræferencen gemmes på profilen i V1 eller senere | Komponenten understøtter begge |
| 6 | Hvornår genveje kan tilpasses af den enkelte bruger | Arkitekturen tillader det |
| 7 | Endelig formulering af tekster i Synlighedsfanen og låste tilstande | Indhold, ikke struktur |
| 8 | Hvilke kvalitetssignaler der kræver bekræftelse fra rådgiveren, før en sag kan afsluttes | Signalkomponenten er den samme; kun reglen mangler |
