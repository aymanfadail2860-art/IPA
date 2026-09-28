# 01 — Produktdefinition

**Fase:** 1 — Produktdefinition
**Status:** Gennemført
**Sprog:** Dansk
**Teknologi:** Ikke behandlet. Teknologivalget træffes i fase 3.

---

## 1. Hvad Insurance Partners er

Insurance Partners er en AI-baseret platform til erhvervsforsikringsrådgivere.

Platformen er ikke et læringssystem med et værktøj ved siden af, og heller ikke et
arbejdsværktøj med kurser knyttet til. Den er begge dele i én sammenhæng, hvor viden og
anvendelse deler det samme faglige grundlag.

---

## 2. Formål

Platformen har to overordnede formål:

1. **At uddanne og udvikle medarbejdere inden for erhvervsforsikring.**
2. **At fungere som AI-baseret arbejds- og sparringsværktøj i rådgiverens daglige
   arbejde.**

De to formål er gensidigt afhængige. Uddannelsen får sin relevans fra det daglige
arbejde, og arbejdsværktøjet får sin kvalitet fra den viden, rådgiveren har opbygget.

---

## 3. Brugerroller

Platformen har tre centrale brugerroller.

### Rådgiver

Primær bruger. Lærer, træner, rådgiver og måles på platformen.

- Bruger Learn, Copilot, Practice og Advise
- Gennemfører Assessment
- Ser egen progression og kompetenceprofil under Min profil
- Har **ikke** adgang til andre medarbejderes data
- Har **ikke** adgang til administration af Knowledge Engine

### Leder

Har som udgangspunkt samme funktioner som Rådgiver og derudover adgang til Analytics for
sit eget team. Lederen skal blandt andet kunne se teamets læringsprogression,
kompetenceniveauer, Assessment-resultater, gennemførte læringsforløb, udviklingsområder,
aggregerede brugsmønstre og øvrige relevante trænings- og læringsdata.

En leder har **ikke** automatisk administratorrettigheder til Knowledge Engine eller
fagligt indhold.

### Administrator

Forvalter platformens grundlag: produkter, dokumenter, Knowledge Engine, læringsindhold,
brugere, versioner og systemrelaterede indstillinger.

### Principper for rollemodellen

**Administratoradgang og lederadgang er forskellige rettigheder.** Den ene medfører ikke
den anden. En leder ser mennesker; en administrator forvalter indhold.

**Rollemodellen skal kunne udvides.** Den tekniske arkitektur i fase 3 skal designes, så
roller og rettigheder senere kan udvides uden større arkitekturændringer.

---

## 4. Produktmoduler

### Centrale moduler

De fire centrale produktmoduler er:

| Modul | Funktion |
|-------|----------|
| **Learn** | Opbygning af faglig viden om erhvervsforsikringsprodukter |
| **Copilot** | AI-baseret faglig assistance på tværs af platformen |
| **Practice** | Træning af anvendelse i sikre rammer |
| **Advise** | AI-understøttet rådgivning på reelle kundecases |

### Øvrige moduler

| Modul | Funktion |
|-------|----------|
| **Assessment** | Måling og dokumentation af kompetence |
| **Min profil** | Brugerens samlede kompetence- og udviklingsprofil |
| **Admin** | Forvaltning af indhold, dokumenter, brugere og versioner |
| **Analytics** | Data om anvendelse og resultater, med rollebaseret adgang |
| **Knowledge Engine** | Det autoritative vidensgrundlag bag alle AI-funktioner |

---

## 5. Knowledge Engine

**Alle centrale AI-funktioner skal bygge på samme autoritative Knowledge Engine.**

Dette er platformens bærende princip. Copilot, Practice og Advise trækker ikke på hver
sit vidensgrundlag, men på ét fælles, forvaltet grundlag. Det er forudsætningen for, at
et svar givet i Learn og et svar givet midt i en kundecase hviler på det samme.

Knowledge Engine skal kunne indeholde og arbejde med blandt andet:

- Forsikringsprodukter
- Policetekster
- Forsikringsbetingelser
- Dækninger
- Undtagelser
- Acceptregler
- Forretningsgange
- Produktvejledninger
- Salgs- og rådgivningsmateriale
- Andre relevante interne dokumenter

---

## 6. Principper for faglige AI-svar

Platformen bruges i en reguleret branche, hvor et forkert svar om en dækning eller en
acceptregel kan få konsekvenser for en kunde. Følgende principper er derfor ufravigelige
for alle AI-funktioner:

**Faglige AI-svar skal som udgangspunkt kunne dokumenteres med kilder fra den autoritative
vidensbase.** Et svar uden sporbar kilde kan ikke bruges som grundlag for rådgivning.

**AI'en må ikke opfinde dækninger, betingelser, acceptregler eller forretningsgange.**
Det gælder også, når et plausibelt svar ville være nemt at formulere.

**Findes tilstrækkelig dokumentation ikke, skal systemet kunne kommunikere usikkerheden
i stedet for at præsentere et gæt som et faktum.** At sige "det står der ikke noget om"
er et gyldigt og ønsket svar.

---

## 7. Krav

Nummererede krav udledt direkte af afsnit 5 og 6. Kravene er formuleret som noget, der
kan konstateres, og siger intet om, hvordan de opfyldes.

| ID | Krav |
|----|------|
| KRAV-AI-001 | Alle centrale AI-funktioner skal anvende samme autoritative Knowledge Engine som vidensgrundlag. |
| KRAV-AI-002 | Et fagligt AI-svar skal som udgangspunkt kunne henvise til den kilde i vidensbasen, det bygger på. |
| KRAV-AI-003 | AI'en må ikke generere dækninger, betingelser, acceptregler eller forretningsgange, der ikke findes i vidensbasen. |
| KRAV-AI-004 | Findes der ikke tilstrækkelig dokumentation til at besvare et fagligt spørgsmål, skal usikkerheden kommunikeres eksplicit frem for at et svar præsenteres som faktum. |
| KRAV-KE-001 | Knowledge Engine skal kunne indeholde de indholdstyper, der er anført i afsnit 5. |
| KRAV-ADV-001 | Advise skal kunne arbejde med reelle kundecases for konkrete virksomheder. |
| KRAV-ROL-001 | Platformen skal understøtte tre adskilte roller: Rådgiver, Leder og Administrator. |
| KRAV-ROL-002 | Lederadgang må ikke automatisk medføre administratorrettigheder til Knowledge Engine eller fagligt indhold. |
| KRAV-ROL-003 | En rådgiver må ikke kunne se andre medarbejderes data. |
| KRAV-ROL-004 | Rolle- og rettighedsmodellen skal kunne udvides med nye roller uden større arkitekturændringer. |
| KRAV-ASS-001 | Copilot skal være deaktiveret under en aktiv Assessment og igen tilgængelig efter. |

Kravlisten er ikke udtømmende. Den dækker de principper, der er fastlagt i fase 1, og
udbygges i takt med at flere krav formuleres.

---

## 8. Kundedata i Advise

Advise skal i den færdige platform kunne arbejde med reelle kundecases og derfor
potentielt behandle virksomheds- og kundedata.

De præcise datatyper, adgangskrav, sikkerhed, GDPR, retention og øvrige compliancekrav
**fastlægges i fase 3, Teknisk arkitektur.** De er dermed ikke et udestående i fase 1,
men et defineret input til fase 3.

---

## 9. Ikke fastlagt i denne fase

Følgende er bevidst ikke fastlagt her og skal på plads senere:

- Detaljeret kravspecifikation pr. modul
- Ordliste over domænebegreber med entydige interne navne (se `docs/02-information-architecture.md`, afsnit om begreber)
- Compliance- og databehandlingskrav (fase 3)
- Den præcise permission-model, herunder afgrænsning af et team (fase 3)
- Kommerciel model og prissætning
