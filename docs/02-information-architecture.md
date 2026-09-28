# 02 — Informationsarkitektur

**Fase:** 2 — Informationsarkitektur
**Status:** Gennemført
**Sprog:** Dansk
**Teknologi:** Ikke behandlet. Teknologivalget træffes i fase 3.
**Bygger på:** `docs/01-product-definition.md`

Dette dokument beskriver, hvordan Insurance Partners er organiseret: hvilke områder
platformen består af, hvad hvert område er til for, hvordan brugeren bevæger sig mellem
dem, og hvilke informationer der flyder imellem dem. Det beskriver ikke, hvordan noget af
det bygges.

---

## 1. Moduler og navigationsområder

Produktdefinitionen beskriver ni **moduler**. Navigationen består af ni
**hovedområder**. De to lister dækker ikke hinanden en til en, og det er tilsigtet: et
modul er en funktionel enhed i produktet, et hovedområde er et sted i menuen.

| Modul (fra fase 1) | Optræder i navigationen som |
|--------------------|------------------------------|
| Learn | Hovedområde |
| Copilot | Hovedområde **og** globalt lag i alle øvrige områder |
| Practice | Hovedområde |
| Advise | Hovedområde |
| Assessment | Hovedområde |
| Min profil | Hovedområde |
| Admin | Hovedområde |
| Analytics | Hovedområde med rollebaseret adgang |
| Knowledge Engine | Intet eget område — forvaltes via Admin → Knowledge Base |

Dertil kommer **Home**, som ikke er et modul, men brugerens indgang og samlede overblik.

**Knowledge Engine** er et centralt systemmodul, men ikke et selvstændigt hovedområde i
medarbejderens navigation. Det administreres gennem Admin → Knowledge Base.

De ni hovedområder:

| # | Område | Rolle i platformen | Adgang |
|---|--------|--------------------|--------|
| 1 | Home | Personligt cockpit og indgang | Alle roller |
| 2 | Learn | Opbygning af faglig viden | Alle roller |
| 3 | Copilot | AI-assistance, globalt tilgængelig | Alle roller |
| 4 | Practice | Træning af anvendelse i sikre rammer | Alle roller |
| 5 | Advise | Anvendelse på virkelige kundecases | Alle roller |
| 6 | Assessment | Måling og dokumentation af kompetence | Alle roller |
| 7 | Min profil | Brugerens eget billede af egen udvikling | Alle roller |
| 8 | Analytics | Data om anvendelse og resultater | Leder, Administrator |
| 9 | Admin | Forvaltning af indhold, brugere og grundlag | Administrator |

---

## 2. Komplet sitemap

```
Insurance Partners
│
├── 1. Home
│   ├── Fortsæt læring
│   ├── Hurtig adgang til Copilot
│   ├── Seneste træning
│   ├── Aktive kundecases
│   ├── Progression
│   └── Relevante opdateringer (produkter, vilkår, regler)
│
├── 2. Learn
│   ├── Mine læringsforløb
│   ├── Produktbibliotek
│   │   └── Produkt
│   │       └── Produktforløb
│   │           ├── Introduktion
│   │           ├── Produktforståelse
│   │           ├── Dækninger
│   │           ├── Undtagelser
│   │           ├── Betingelser
│   │           ├── Acceptregler
│   │           ├── Behovsafdækning
│   │           ├── Salg og rådgivning
│   │           ├── Eksempler
│   │           ├── Quiz
│   │           └── Afsluttende case
│   └── Progression
│
├── 3. Copilot                          (globalt lag — se afsnit 5)
│   ├── Ny samtale
│   ├── Samtalehistorik
│   ├── Kilder
│   └── Dokumentvisning
│
├── 4. Practice
│   ├── Kundecases            ┐
│   ├── AI-rollespil          │
│   ├── Behovsafdækning       ├─ sideordnede træningsformer
│   ├── Objection Training    │
│   ├── Produkttræning        ┘
│   └── Feedback              ← følger efter enhver træningsform
│
├── 5. Advise
│   ├── Ny kundecase
│   └── Kundecase (arbejdsområder)
│       ├── Virksomhedsprofil
│       ├── Risikoanalyse
│       ├── Manglende oplysninger
│       ├── Forsikringsbehov
│       ├── Dækninger
│       ├── Accept
│       └── Opsummering
│
├── 6. Assessment
│   ├── Tests
│   ├── Cases
│   ├── Resultater
│   └── Kompetencer
│
├── 7. Min profil
│   ├── Progression
│   ├── Kompetencer
│   ├── Styrker
│   ├── Udviklingsområder
│   └── Historik
│
├── 8. Analytics                        (Leder og Administrator)
│   ├── Læringsprogression
│   ├── Kompetenceniveauer
│   ├── Assessment-resultater
│   ├── Gennemførte læringsforløb
│   ├── Udviklingsområder
│   └── Brugsmønstre (aggregeret)
│
└── 9. Admin                            (kræver administratoradgang)
    ├── Produkter
    ├── Dokumenter
    ├── Knowledge Base                  (forvaltning af Knowledge Engine)
    ├── Læringsindhold
    ├── Brugere
    ├── Versioner
    └── Systemindstillinger
```

Analytics er flyttet ud af Admin og gjort til et selvstændigt hovedområde, fordi adgangen
til det følger lederrollen og ikke administratorrollen. Underpunkterne afspejler det, en
leder skal kunne se om sit team.

---

## 3. Formålet med hver hovedsektion

### 1. Home — det personlige cockpit

Home besvarer ét spørgsmål: *hvad er relevant for mig lige nu?* Sektionen producerer ikke
selv indhold. Den samler tilstand fra de øvrige områder og gør den handlingsbar, så
brugeren kan genoptage et afbrudt forløb eller reagere på en ændring frem for at lede
efter den.

Indholdet falder i tre typer:

- **Genoptagelse** — fortsæt læring, seneste træning, aktive kundecases
- **Overblik** — progression på tværs af læring, træning og kompetence
- **Ændringer** — opdateringer i produkter, vilkår og regler, som påvirker brugerens eget
  fagområde og igangværende arbejde

### 2. Learn — faglig viden

Learn opbygger den viden, de øvrige områder forudsætter.

**Produktbiblioteket** er indgangen til det faglige indhold. Herfra vælges et **produkt**,
og hvert produkt har et **produktforløb** bestående af elleve moduler i fast rækkefølge.
Strukturen er dermed:

```
Learn → Produktbibliotek → Produkt → Produktforløb → modul
```

Rækkefølgen i forløbet går fra forståelse over regler til anvendelse: hvad produktet er
(Introduktion, Produktforståelse), hvad det dækker og ikke dækker (Dækninger,
Undtagelser, Betingelser), hvem der kan accepteres (Acceptregler), og hvordan det bruges
over for en kunde (Behovsafdækning, Salg og rådgivning, Eksempler). Forløbet lukkes med
Quiz og Afsluttende case.

**Mine læringsforløb** er brugerens eget udsnit af det, der er tildelt eller påbegyndt —
en indgang til de samme forløb, ikke en selvstændig indholdstype. **Progression** viser
brugerens fremdrift gennem Learn.

### 3. Copilot — AI-assistance

Copilot besvarer faglige spørgsmål på grundlag af Knowledge Engine. Formålet er, at
brugeren kan få et svar i den situation, spørgsmålet opstår i, uden at forlade sin
opgave — og at svaret kan spores tilbage til den kilde og version, det stammer fra.

Kilder og dokumentvisning er derfor ikke tilbehør, men forudsætningen for, at svar kan
bruges i rådgivning. Se afsnit 5 og 6.

### 4. Practice — træning

Practice er stedet, hvor viden omsættes til adfærd uden risiko for en kunde.

Sektionen indeholder fem **sideordnede træningsformer**:

| Træningsform | Hvad den træner |
|--------------|-----------------|
| **Kundecases** | Samlet håndtering af en fiktiv kundesituation |
| **AI-rollespil** | Den frie samtale med en simuleret kunde |
| **Behovsafdækning** | At afdække kundens faktiske behov |
| **Objection Training** | At håndtere indvendinger |
| **Produkttræning** | At beherske et konkret produkt |

**AI-rollespil er både en træningsform og en mekanisme.** Som træningsform er det den
åbne samtale uden bestemt fagligt mål. Som mekanisme kan det anvendes inden i de øvrige
former — en behovsafdækningsøvelse eller en objection-træning kan gennemføres som
rollespil. Det er derfor ikke et niveau over de andre, men et middel, flere af dem kan
benytte.

**Feedback** følger efter enhver træningsform og er sektionens egentlige produkt. Uden
den er træningen en øvelse uden udbytte.

### 5. Advise — anvendelse på virkelige kunder

Advise er arbejdsværktøjet. Her oprettes en kundecase for en reel virksomhed, og
rådgiveren arbejder gennem syv arbejdsområder fra virksomhedsprofil til opsummering.

Rækkefølgen er den tilsigtede arbejdsgang, men **ikke en låst sekvens**. Rådgiveren skal
kunne navigere frem og tilbage mellem arbejdsområderne — oplysninger kommer sjældent i
den rækkefølge, en proces forudsætter, og en risiko opdaget under dækningsvalg kan kræve
en tilbagevenden til risikoanalysen.

Dette er det eneste område, der arbejder med identificerbare kunder. Datatyper,
adgangskrav, sikkerhed, GDPR og retention fastlægges i fase 3.

### 6. Assessment — måling

Assessment afgør, om kompetencen faktisk er til stede. Hvor Learn registrerer
*gennemførelse*, og Practice registrerer *øvelse*, registrerer Assessment *resultat*:
tests og cases, der er bestået eller ikke bestået, og de kompetencer, resultaterne
dokumenterer.

### 7. Min profil — brugerens eget billede

Min profil viser brugeren sin egen udvikling over tid: progression, kompetenceprofil,
styrker, udviklingsområder og historik. Sektionen er refleksiv, ikke administrativ.

### 8. Admin — forvaltning

Admin er kilden til alt det indhold, resten af platformen bygger på: produkter,
dokumenter, knowledge base og læringsindhold. Dertil brugeradministration,
versionsstyring og systemindstillinger.

**Versioner** er det centrale led: når et vilkår ændres, skal det kunne fastslås, hvilken
version et givet Copilot-svar, læringsmodul eller rådgivningsforløb byggede på.

### 8. Analytics — data om anvendelse og resultater

Analytics besvarer spørgsmål om andre end brugeren selv og er derfor adskilt fra Min
profil. Hvor Min profil er rådgiverens eget spejl, er Analytics lederens billede af sit
team: læringsprogression, kompetenceniveauer, Assessment-resultater, gennemførte forløb,
udviklingsområder og aggregerede brugsmønstre.

Området er skilt ud fra Admin, fordi adgangen hertil hører til lederrollen og ikke til
forvaltningen af fagligt indhold. En leder skal kunne følge sit team uden at kunne ændre
produkter eller vidensgrundlag.

---

## 4. Knowledge Engine som fælles grundlag

Knowledge Engine har ingen egen plads i navigationen, men er det lag alle faglige
AI-funktioner hviler på. Det er fastlagt i `docs/01-product-definition.md` afsnit 5 og har
direkte konsekvenser for arkitekturen:

```
      COPILOT        PRACTICE        ADVISE         LEARN
         │              │              │              │
         └──────────────┴──────┬───────┴──────────────┘
                               │
                      KNOWLEDGE ENGINE
            (produkter, policetekster, betingelser,
             dækninger, undtagelser, acceptregler,
             forretningsgange, vejledninger, materiale)
                               │
                        ADMIN → Knowledge Base
                          (forvaltning, versioner)
```

Tre konsekvenser for informationsarkitekturen:

1. **Ét grundlag, ikke flere.** Et AI-rollespil i Practice, et svar i Copilot og en
   dækningsanalyse i Advise trækker på samme kilde. Der findes ikke et separat
   vidensgrundlag pr. modul.
2. **Kilde og version følger svaret.** Ethvert fagligt svar skal kunne føres tilbage til
   en kilde og den version af kilden, der gjaldt. Flader til det er Copilots **Kilder** og
   **Dokumentvisning**.
3. **Usikkerhed er et gyldigt svar.** Findes dokumentationen ikke, skal det fremgå.
   Arkitekturen skal give plads til svar, der oplyser at grundlaget mangler, frem for at
   tvinge et svar frem.

---

## 5. Copilot som globalt AI-lag

Copilot optræder to steder i arkitekturen på én gang:

**Som hovedområde** har Copilot sin egen sektion med fuld samtaleflade, historik,
kildeoversigt og dokumentvisning. Det er stedet, man går hen, når spørgsmålet er
hovedopgaven.

**Som globalt lag** er Copilot til stede i alle øvrige sektioner, uden at brugeren
forlader det, vedkommende er i gang med. Det er den normale anvendelse.

### Kontekst

Det, der gør det globale lag brugbart frem for blot tilgængeligt, er, at Copilot kender
brugerens aktuelle placering. Når Copilot åbnes, medbringes:

| Fra | Kontekst der medbringes |
|-----|-------------------------|
| Learn | Produkt, produktforløb og modul brugeren er i |
| Practice | Træningsform og det scenarie, der spilles |
| Advise | Kundecase, aktuelt arbejdsområde og casens oplysninger |
| Assessment | *Ingen — Copilot er deaktiveret under aktiv prøve, se nedenfor* |
| Home / Min profil | Ingen specifik faglig kontekst |

Det betyder, at spørgsmålet "hvad dækker den her egentlig?" kan besvares meningsfuldt,
fordi Copilot ved, hvilket produkt og hvilket trin brugeren står i.

### Begrænsninger

Copilot er **deaktiveret under en aktiv Assessment**. Formålet med Assessment er at måle
medarbejderens egen faglige kunnen, og det kan ikke lade sig gøre med assistance til
stede.

Efter en gennemført Assessment er Copilot igen tilgængelig og kan blandt andet hjælpe
medarbejderen med at forstå sine fejl, gennemgå de faglige områder, der gik galt, finde
kilderne bag det rigtige svar og foreslå relevant læring eller træning. Copilot er dermed
en del af efterbehandlingen, ikke af prøven.

Copilot er ligeledes **ikke tilgængelig under selve AI-rollespillet** i Practice. Pointen
er, at medarbejderen gennemfører samtalen selv. Copilot må anvendes før rollespillet til
forberedelse og efter til refleksion, feedback og læring.

Begge begrænsninger følger samme princip: hvor platformen måler eller træner
selvstændighed, er assistance sat på pause — og genåbnet i det øjeblik, situationen går
fra præstation til læring.

### Samtalehistorik

Historikken er brugerens egen. Den knytter sig til den kontekst, samtalen fandt sted i,
så en samtale ført inde i en kundecase kan genfindes fra casen og ikke kun kronologisk.

---

## 6. Sammenhængen mellem Learn, Practice, Copilot og Advise

De fire centrale moduler udgør én bevægelse fra viden til anvendelse:

```
        LEARN                PRACTICE               ADVISE
     (ved det)            (kan gøre det)        (gør det rigtigt)
        │                      │                      │
        │  viden anvendes      │  adfærd anvendes     │
        ├─────────────────────►├─────────────────────►│
        │                      │                      │
        │◄─────────────────────┴──────────────────────┤
        │        videnshuller sendes tilbage          │
        │                                             │
        └──────────────── COPILOT ────────────────────┘
                 (understøtter alle tre trin)
                              │
                              ▼
                  ASSESSMENT  +  MIN PROFIL
                   (måler)      (viser udvikling)
```

**Learn → Practice.** Et gennemført produktforløb gør den tilsvarende træning relevant.
Den afsluttende case i Learn er broen: sidste faglige trin og første anvendelsestrin.

**Practice → Advise.** Træning kvalificerer til reel rådgivning. En rådgiver, der har
trænet behovsafdækning på et produkt, går ind i en kundecase med et kendt mønster frem for
et improviseret.

**Advise → Learn.** Modsat vej: når en kundecase afdækker noget, rådgiveren ikke ved, skal
det kunne føre direkte til det læringsmodul, der dækker emnet — og registreres som
udviklingsområde i Min profil.

**Copilot på tværs.** Copilot understøtter alle tre uden at være et trin i kæden. I Learn
forklarer den stof, i Practice bruges den til forberedelse og efterbehandling men ikke
under selve rollespillet, i Advise leverer den det faglige opslag midt i arbejdet.

**Fælles grundlag.** Alle fire trækker på samme Knowledge Engine. Det er det, der gør, at
kæden hænger sammen fagligt og ikke kun navigationsmæssigt.

---

## 7. Domænebegreber med flere anvendelser

Samme forsikringsfaglige begreb optræder bevidst flere steder i brugerfladen. Brugerne
taler dansk og forsikringsfagligt, og betegnelserne skal derfor være naturlige. Men
begreberne er **konceptuelt forskellige** og skal adskilles i datamodellen.

| Betegnelse i UI | Placering | Betydning |
|-----------------|-----------|-----------|
| Dækninger | Learn | Undervisningsindhold om dækninger |
| Dækninger | Advise | Analyse af relevante dækninger for en konkret kundecase |
| Kundecases | Practice | Fiktive træningscases |
| Kundecases | Advise | Reelle arbejdscases |
| Behovsafdækning | Learn | Undervisning i behovsafdækning |
| Behovsafdækning | Practice | Træning i behovsafdækning |
| Behovsafdækning | Advise | Behovsafdækning for en konkret kunde |
| Kompetencer | Assessment | Måling og evaluering af kompetencer |
| Kompetencer | Min profil | Præsentation af brugerens samlede kompetenceprofil |

**Konsekvens for fase 3:** disse domænebegreber skal have entydige interne navne i den
tekniske arkitektur. Brugerfladens danske betegnelser må ikke være det, der identificerer
dem internt, da samme betegnelse ellers dækker over flere forskellige ting.

---

## 8. De vigtigste brugerflows

### Flow A — Genoptagelse af læring
`Home → Fortsæt læring → Learn → Produkt → Produktforløb → modul → Progression → Home`

### Flow B — Fra viden til træning
`Learn → Afsluttende case → Practice → (træningsform) → Feedback → Min profil`

Feedbacken fra træningen bliver til styrker og udviklingsområder i Min profil.

### Flow C — Spørgsmål under arbejdet
`(vilkårlig sektion) → Copilot → Kilder → Dokumentvisning → tilbage til udgangspunktet`

Brugeren stiller et spørgsmål midt i en opgave, får svaret med kildehenvisning, åbner om
nødvendigt dokumentet og fortsætter uden at have mistet sin kontekst.

### Flow D — Rådgivning af en kunde
`Home / Aktive kundecases → Advise → Virksomhedsprofil → Risikoanalyse → Manglende
oplysninger → Forsikringsbehov → Dækninger → Accept → Opsummering`

Rådgiveren kan til enhver tid navigere tilbage til et tidligere arbejdsområde. Copilot er
tilgængelig i hvert trin med trinnets kontekst.

### Flow E — Fra rådgivning tilbage til læring
`Advise → Copilot → "lær mere" → Learn / relevant modul`

Lukker sløjfen mellem anvendelse og læring.

### Flow F — Dokumentation af kompetence
`Learn → Assessment / Tests eller Cases → Resultater → Kompetencer → Min profil`

### Flow G — Ændring i grundlaget
`Admin / Produkter eller Dokumenter → ny version i Knowledge Engine → Home / Relevante
opdateringer → berørte læringsmoduler og kundecases markeres`

Det vigtigste flow, der ikke udgår fra en brugerhandling.

---

## 9. Informationsflow mellem modulerne

| Fra | Til | Information | Formål |
|-----|-----|-------------|--------|
| Learn | Home | Igangværende forløb, senest åbnede modul | Genoptagelse |
| Learn | Practice | Gennemført produktforløb | Frigiver relevant træning |
| Learn | Min profil | Progression, gennemførte moduler | Udviklingsbillede |
| Learn | Assessment | Gennemført forløb | Adgang til prøve |
| Practice | Home | Seneste træning | Genoptagelse |
| Practice | Min profil | Feedback → styrker, udviklingsområder | Udviklingsbillede |
| Practice | Learn | Identificerede videnshuller | Anbefaling af modul |
| Advise | Home | Aktive kundecases og deres trin | Genoptagelse |
| Advise | Learn | Emner rådgiveren var i tvivl om | Anbefaling af modul |
| Advise | Min profil | Anvendelseshistorik | Udviklingsbillede |
| Copilot | Alle | Svar med kildehenvisning og version | Faglig understøttelse |
| Alle | Copilot | Aktuel kontekst (se afsnit 5) | Relevante svar |
| Copilot | Min profil | Gentagne spørgsmål inden for et emne | Signal om udviklingsområde |
| Assessment | Min profil | Resultater, opnåede kompetencer | Dokumenteret kompetence |
| Assessment | Home | Kommende og beståede prøver | Overblik |
| Knowledge Engine | Copilot, Learn, Practice, Advise | Fagligt indhold med gældende version | Fælles faktagrundlag |
| Admin / Produkter, Dokumenter | Knowledge Engine | Kildeindhold | Vedligeholdelse af vidensgrundlag |
| Admin / Læringsindhold | Learn, Practice, Assessment | Forløb, cases, prøver | Indholdsforsyning |
| Admin / Versioner | Home | Ændringer i produkter, vilkår, regler | Notifikation til berørte |
| Admin / Brugere | Learn, Min profil | Tildelte forløb, rolle | Personalisering |
| Learn, Practice, Assessment, Advise | Analytics | Progression, resultater, brugsmønstre | Lederens overblik over teamet |
| Admin / Brugere | Analytics | Teamtilhørsforhold og rolle | Afgrænsning af lederens indsigt |

Tre principper går på tværs af tabellen:

1. **Knowledge Engine er kilde, ikke aftager.** Alt fagligt indhold har sit udspring i det
   forvaltede vidensgrundlag. Ingen anden sektion definerer produktfakta.
2. **Version følger med informationen.** Når indhold flyder til Copilot, Learn eller
   Advise, følger versionen med, så det senere kan fastslås, hvad et svar eller et forløb
   byggede på.
3. **Progression har én kilde.** Progression vises på Home, i Learn og i Min profil. Det
   skal være samme underliggende opgørelse vist tre steder med forskellig detaljegrad —
   ikke tre selvstændige tællinger.

---

## 10. Roller og adgang

Platformen har tre roller. **Lederadgang og administratoradgang er forskellige
rettigheder** — den ene medfører ikke den anden.

| Område | Rådgiver | Leder | Administrator |
|--------|----------|-------|---------------|
| Home | Egen | Egen | Egen |
| Learn | Ja | Ja | Ja |
| Copilot | Ja | Ja | Ja |
| Practice | Ja | Ja | Ja |
| Advise | Ja | Ja | Ja |
| Assessment | Ja | Ja | Ja |
| Min profil | Egen | Egen | Egen |
| Analytics | **Nej** | Eget team | Bredere adgang efter rettigheder |
| Admin | **Nej** | **Nej** | Ja |

### Rådgiver

Bruger Learn, Copilot, Practice og Advise, gennemfører Assessment og ser egen progression
og kompetenceprofil under Min profil. Rådgiveren har ikke adgang til andre medarbejderes
data og ikke adgang til administration af Knowledge Engine.

### Leder

Har samme funktioner som rådgiveren — en leder er også selv bruger af platformen — og
derudover adgang til Analytics for sit eget team:

| Data | Hvad lederen kan se |
|------|---------------------|
| Læringsprogression | Teamets fremdrift i Learn |
| Kompetenceniveauer | Hvor teamet fagligt står |
| Assessment-resultater | Udfald af tests og cases |
| Gennemførte læringsforløb | Hvad der er afsluttet |
| Udviklingsområder | Hvor der er behov for indsats |
| Brugsmønstre | Aggregeret anvendelse af platformen |
| Trænings- og læringsdata | Øvrige relevante data fra Practice og Learn |

Lederen får **ikke** automatisk administratorrettigheder til Knowledge Engine eller
fagligt indhold.

### Administrator

Administrerer produkter, dokumenter, Knowledge Engine, læringsindhold, brugere, versioner
og systemrelaterede indstillinger.

| Funktion | Hvorfor den er beskyttet |
|----------|--------------------------|
| Produkter | Definerer det faglige grundlag hele platformen bygger på |
| Dokumenter | Vilkår og betingelser der ligger til grund for rådgivning |
| Knowledge Base | Bestemmer hvad AI-funktionerne kan svare på og hvor godt |
| Læringsindhold | Bestemmer hvad medarbejdere lærer og prøves i |
| Brugere | Adgang, roller og teamtilhørsforhold |
| Versioner | Sporbarhed — hvilket grundlag gjaldt hvornår |
| Systemindstillinger | Platformens drift og opsætning |

### Udvidelse af rollemodellen

Tre roller er udgangspunktet, ikke et loft. Den tekniske arkitektur i fase 3 skal
designes, så rolle- og rettighedsmodellen senere kan udvides uden større
arkitekturændringer.

---

## 11. Input til fase 3

Informationsarkitekturen er fastlagt. Følgende er bevidst overladt til fase 3 og
blokerer ikke fasens start:

1. **Den præcise permission-model** for Analytics, herunder hvordan et team afgrænses, og
   hvilke data en leder ser på individniveau frem for aggregeret.
2. **Datatyper, adgangskrav, sikkerhed, GDPR og retention** for Advise, jf.
   `docs/01-product-definition.md` afsnit 8.
3. **Entydige interne navne** til de domænebegreber, der har flere anvendelser i
   brugerfladen, jf. afsnit 7.
4. **Versionsstyring af vidensgrundlaget**, så ethvert fagligt svar kan spores til den
   version, der gjaldt.
5. **Udvidelsesmodel for roller og rettigheder.**
