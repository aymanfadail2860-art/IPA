# Beslutninger — Insurance Partners (IPA)

Beslutningslog efter `CLAUDE.md` §5. Hvert punkt indeholder dato, beslutning, overvejede
alternativer og begrundelse. Nyeste øverst.

**Fasehenvisninger før B-019:** Beslutninger fra før 3. oktober 2026 bruger datidens numre. I
B-011 til B-018 betyder "fase 8" 8A — AI Gateway, "fase 9" betyder 8B — Produktionsgrundlag, og
"den foreslåede fase 10" betyder 8C — Copilot klar til brug. Teksten i de enkelte beslutninger
er ikke omskrevet, fordi loggen er historik.

---

## B-021 — Passage Recall bruger de påkrævede passager som et sæt

**Dato:** 3. oktober 2026
**Område:** `docs/08b-production-foundation.md` §4.2 og §21.1, `evals/engine/`, `evals/retrieval/README.md`

**Beslutning:** Passage Recall@K tæller et spørgsmål, når alle påkrævede passager (grad 3) er dækket
inden for K. Rækkefølgen af passager i facit har ingen betydning. Det præciserer "den primære
forventede passage (grad 3)" i §4.2 og afløser I1's fortolkning "den første passage med grad 3".
Der er intet nyt felt i spørgsmålsformatet, så eksisterende fixtures er uændrede, og rapportskemaet
er hævet til 2.

**Overvejede alternativer:**
- *Et eksplicit felt `primary: true` på én passage.* Fravalgt: endnu et felt, som forfatteren kan
  glemme. Et spørgsmål med flere lige vigtige passager kan ikke udtrykkes. Graden udtrykker allerede,
  hvad der er påkrævet.

**Begrundelse:** Resultatet afhænger ikke af en tilfældig rækkefølge i facit, og en test viser, at
omvendt rækkefølge giver identiske tal. For spørgsmål med én passage med grad 3 er tallet det samme
som før.

---

## B-020 — 8B-specifikationen er godkendt og låst

**Dato:** 3. oktober 2026
**Område:** `docs/08b-production-foundation.md` (hele dokumentet), `docs/roadmap.md`, `CLAUDE.md`,
`README.md`

**Beslutning:** Specifikationen for 8B — Produktionsgrundlag er godkendt og låst. Det gælder
specifikationen, ikke implementeringen, som kræver en særskilt godkendelse. Alle beslutninger
D-1–D-20 i specifikationens §19 er godkendt. De sidste, der blev godkendt, er:

- **D-6 — gates:** H1–H7 er hårde sikkerhedsgates med nul tolerance. Q1–Q7 er de initiale
  kvalitetstærskler. De ligger i et versionsstyret gate-sæt og kan kun rekalibreres gennem en ny,
  versionsstyret og eksplicit godkendt evalueringsbaseline. De hårdkodes ikke som uforanderlige
  domæneregler. Under 100 evalueringsspørgsmål er en godkendelse `tier: pilot`.
- **D-10 — workerens identitet:**
  - AWS ECS Fargate med direkte Postgres-forbindelse via Supavisor.
  - Dedikeret LOGIN-rolle `ingestion_worker_login`, uden tabelrettigheder og med kun `EXECUTE` på
    godkendte `knowledge.worker_*`.
  - Workeren kan ikke godkende eller publicere.
  - Netværksbegrænsning til NAT'ens faste IP og credentials i AWS Secrets Manager.
  - Ingen production-service-rolle i workeren.
- **D-15 — alarmer:** en abstrakt `AlertSink`. Domænemodellen bindes ikke til en konkret kanal.
- **D-18 — `evaluation_publisher`:** administratorer kan ikke fremstille eller rette en
  evalueringskørsel.
- **D-19 — dependency:** `postgres` (postgres.js) er den specificerede dependency i workeren ved
  implementeringen. Den er ikke installeret endnu.
- **D-20 — rotation:**
  - En planlagt rotationscyklus på højst 90 dage i V1.
  - Rotationen sker blue/green mellem to dedikerede login-roller: klargør, flyt kontrolleret,
    verificér og deaktivér den gamle. Skiftet afhænger derfor ikke af, at Supavisor holder op
    med at cache den gamle credential.
  - Nødspærring sker straks med fjernet medlemskab, `NOLOGIN` og afbrudte sessioner.
- **K-9 — kundedata:** de fem lag L1–L5 er godkendt som en tilladt sikkerhedsstramning af 8A.
  - Fri tekst fra kundesager når ikke en ekstern model.
  - Et fejlende eller manglende redaction-trin fører aldrig til et modelkald.
  - Almindelig administratorkonfiguration kan ikke slå guardrailen fra.

**P1–P9** (§9) er source of truth for, hvornår et EvidenceSet får `grade = production`:
- `production` er aldrig et manuelt flag.
- Graden beregnes ud fra den aktive, godkendte retrieval-konfiguration og dens fingeraftryk og
  evalueringsstatus.
- Runtime skal matche den evaluerede konfiguration.
- En betingelse, der ikke kan afgøres, giver `development`.
- En hård gate, der fejler i regression, suspenderer konfigurationen.

De åbne spørgsmål Å-1–Å-6 forbliver åbne og blokerer ikke specifikationen. Å-2
(databehandleraftaler) er fortsat et exit-kriterium før reel produktionsbrug.

**Overvejede alternativer:**
- *Service-rollen i workeren, eller egne roller via JWT.* Fravalgt, fordi blast radius bliver hele
  projektet, og den, der kan signere, også kan udstede `service_role` (§6.1.1).
- *Kvalitetstærskler som faste konstanter.* Fravalgt, fordi de skal kunne kalibreres mod en
  voksende baseline uden at gå på kompromis med sporbarheden.
- *Rotation ved at skifte password på den aktive rolle.* Fravalgt, fordi poolerens cache gør
  skiftet uforudsigeligt.

**Begrundelse:** Hver beslutning kan efterprøves med tests og exit-kriterier (§16–§17).
Ingen vej til `grade = production` går uden om en bestået, registreret evaluering og en
menneskelig godkendelse.

---

## B-019 — Master-roadmappen med 21 faser er låst; fase 8 opdeles i 8A, 8B og 8C

**Dato:** 3. oktober 2026
**Område:** `docs/roadmap.md`, `CLAUDE.md` §1–§5, `docs/07` §20.6, `docs/08`, `docs/03` §10,
`docs/06` §6, `README.md`

**Beslutning:**
- Den oprindelige roadmap med 21 faser er projektets permanente master-roadmap og er låst:
  1 Produktdefinition, 2 Informationsarkitektur, 3 Teknisk arkitektur, 4 UI/UX-design,
  5 Grundplatform, 6 Identity, database og adgangskontrol, 7 Knowledge Engine, 8 AI Copilot,
  9 Learn, 10 Practice, 11 Advise, 12 Assessment, 13 Personlig AI og læringsprofil, 14 Admin,
  15 Analytics, 16 Kvalitet og guardrails, 17 Test, 18 Pilotversion, 19 Feedback,
  20 Enterprise-version og 21 Produktion.
- Masterfase 8 — AI Copilot opdeles i underfaser:
  - **8A — AI Gateway** (det, der hed fase 8): gennemført og låst.
  - **8B — Produktionsgrundlag** (det, der hed fase 9): ikke specificeret eller godkendt.
  - **8C — Copilot klar til brug** (det, der hed den foreslåede fase 10, "Copilot i
    produktion"): ikke specificeret eller godkendt. Navnet er ændret, så det ikke forveksles
    med masterfase 21 Produktion.
- **Roadmap-regel:** underfaser må foreslås under en masterfase, når den tekniske kompleksitet
  kræver det. Uden eksplicit godkendelse må ingen masterfase fjernes, omnummereres eller
  erstattes, der må ikke indsættes en ny masterfase mellem de eksisterende, og et oprindeligt
  hovedområde må ikke flyttes til et andet nummer. Reglen står i `docs/roadmap.md` og
  `CLAUDE.md` §2.
- Fasehenvisningerne i de låste `docs/07` og `docs/08` er rettet fra fase 9/10 til 8B/8C. De
  seks uoverensstemmelser fra roadmap-auditten er rettet. Det genåbner ingen faglige eller
  tekniske beslutninger i de låste faser.

**Baggrund:** Roadmap-auditten (2026-10-03) viste, at den 21-fasede roadmap aldrig havde
stået i repoet. Roadmappen viste kun de faser, der var besluttet, og derefter "N+ Ikke
fastlagt". Faserne 9–21 var derfor fraværende uden en beslutning, og det indsatte
produktionsgrundlag og Copilot-trin skubbede nummereringen.

**Overvejede alternativer:**
- *A) Ny nummerering med indsatte faser.* Fravalgt: de oprindelige faser 8–21 ville flytte
  mindst to pladser og miste forbindelsen til planen.
- *B) Produktionsgrundlaget som en del af fase 7/8.* Fravalgt: det ville genåbne godkendte og
  låste faser som ufærdige.

**Begrundelse:** Underfaser bevarer de oprindelige numre og alt låst indhold. De viser, at
gateway og produktionsgrundlag er forudsætninger for en rigtig Copilot.

---

## B-018 — Fase 8 godkendt; rettelsen af retrieveEvidence bekræftet

**Dato:** 3. oktober 2026
**Område:** `docs/08-ai-gateway.md` §18; `docs/07-knowledge-engine.md` §4.1; `docs/roadmap.md`

**Beslutning:** Fase 8 — AI Gateway er godkendt og låst. Rettelsen i `docs/08` §18.2 pkt. 1 er
bekræftet som den er: `retrieveEvidence` kræver en aktiv session og ikke rollerettigheden
`knowledge.document.read`. Databasen afgør adgangen pr. version og kører som den kaldende
bruger, og inaktive brugere får ingen session. Tre punkter uden for fase 8 skrives ind i
roadmap: forudsætningen om redaction og kundedata i fase 9, samtalelagring og rate limiting i
den foreslåede fase 10.

**Overvejede alternativer:**
- *At beholde rollekravet.* Fravalgt: det ville have afvist alle andre end administratorer,
  hver gang en AI-funktion søgte på en brugers vegne, i strid med `docs/07` §4.1.

**Begrundelse:** Rettelsen bringer koden i overensstemmelse med den låste specifikation frem
for at omgå den.

**Bemærkning (B-019):** "Fase 8" er nu 8A, "fase 9" er 8B, og "den foreslåede fase 10" er 8C.

---

## B-017 — Matricen i databasen, profilerne i repoet

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §4, §5.2

**Beslutning:** Datakategori-matricen ligger i databasen, og workflow-profilerne ligger i
repoet. Enhver ændring i matricen auditeres med hvem, hvad og hvornår. Matricen er fail-closed:
hvad der ikke står, er forbudt.

**Overvejede alternativer:**
- *Begge i repoet.* Fravalgt: en politikændring ville kræve en udrulning og kunne ikke
  revideres som en handling i systemet.
- *Begge i databasen.* Fravalgt: prompts og output-kontrakter hører sammen med koden, der
  validerer dem, og skal gennemgås som kode.

**Begrundelse:** Matricen styrer, hvilke data der forlader platformen. Den er politik og skal
kunne ændres og revideres. Profilerne er kode.

---

## B-016 — Et svar, der ikke kan kontrolleres mod kilderne, vises aldrig

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §4.3, §4.4

**Beslutning:** Bryder modellens svar output-kontrakten, vises det ikke, heller ikke med en
advarsel. Brugeren får at vide, at systemet ikke kunne give et svar, der kan dokumenteres, og
ser de kilder, der blev fundet. Det er en fjerde tilstand med egen formulering og eget
udseende, adskilt fra "utilstrækkelig dokumentation" og fra systemfejl. Den logges, fordi
gentagelser betyder, at noget er galt med prompten eller modellen.

**Overvejede alternativer:**
- *At vise svaret med en advarsel.* Fravalgt: folk læser svaret og overser advarslen.
- *At vise det som "utilstrækkelig dokumentation".* Fravalgt: dokumentationen fandtes. Modellen
  brugte den ikke rigtigt.
- *At vise det som systemfejl.* Fravalgt: systemet virkede, og kilderne kan bruges.

**Begrundelse:** Et fagligt svar, der ikke kan dokumenteres, må ikke nå en bruger, der handler
på det. Kilderne er stadig nyttige.

---

## B-015 — Under et AI-rollespil låses AI, ikke moduler

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §9.1

**Beslutning:** Under et aktivt AI-rollespil låses al brugerrettet AI undtagen rollespillet
selv. Det omfatter Copilot, AI i Learn (forklaringer og eksempelgenerering), Advise-AI og
Practice-feedback. Learn og Advise forbliver tilgængelige som moduler.

**Overvejede alternativer:**
- *Kun Copilot låses* (ordlyden i `docs/02` §5). Fravalgt: AI i Learn svarer også for brugeren.
- *Learn og Advise låses som moduler.* Fravalgt: at læse op i Learn er læring, ikke snyd, og man
  kan alligevel ikke forhindre nogen i at slå op i en bog. Advise er en anden arbejdsopgave.

**Begrundelse:** Copilot er en genvej, fordi den svarer for brugeren. Det gælder al AI, der
svarer, ikke at læse.

---

## B-014 — AI-loggen deler indhold fra metadata

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §11; `docs/03` §11 og §13

**Beslutning:** Modstriden mellem `docs/03` §11 ("AI-samtaledata: Egen") og §13 (kvalitetsanalyse)
afgøres ved at skelne:
- **Indhold** (spørgsmål og svar i fri tekst): kun brugeren selv. En samtale ført inde i en
  kundecase følger kundecasens adgangsregler, ikke AI-domænets.
- **Metadata** (dokumenter, chunks, evidensgrad, svartid, fejl, utilstrækkeligt grundlag): kan
  læses af administratorer til kvalitetsarbejde.
- **Videnshuller:** spørgsmålsteksten må nå administratorer, men aldrig fra en samtale bundet
  til en kundecase. Derfra kommer kun det nøgne faktum, at grundlaget manglede.

Skemaet bygges med opdelingen nu. Administratorers læseadgang er slået fra i fase 8 og kan slås
til før produktion uden en migration. Enhver administrators læsning af AI-data logges i audit,
ligesom individniveau i Analytics. Til læsningen indføres permissionen `ai.quality.read`
(udledt: adgang styres af permissions, ikke rollenavne. `docs/03` §17 pkt. 6).

**Overvejede alternativer:**
- *Kun brugeren selv for alt.* Fravalgt: ingen kan da arbejde med kvaliteten eller med
  videnshuller.
- *Administratorer læser alt.* Fravalgt: indholdet kan indeholde kundedata, og
  administratorrettigheder giver ingen adgang til kundecases (`docs/03` §10).

**Begrundelse:** Dataminimering anvendt på loggen selv. Kvalitetsarbejde kræver maskineriet,
ikke indholdet. Fejlen var i `docs/03`, som er låst. Afgørelsen står her og i `docs/08`.

---

## B-013 — Minimale tilstandstabeller til gating oprettes i fase 8

**Dato:** 2. oktober 2026
**Område:** `docs/08-ai-gateway.md` §9.2; `docs/03` §4

**Beslutning:** `assessment.assessment_attempts` og `practice.roleplay_sessions` oprettes i fase
8 med kun de felter, gatingen har brug for: id, bruger, status, start, slut og tidsgrænse.
Ingen spørgsmål, besvarelser eller bedømmelse. De dokumenteres som et bevidst minimum, så den
senere fase udvider tabellerne frem for at bygge dem om.

**Overvejede alternativer:**
- *En låsetabel i `ai`.* Fravalgt: en anden sandhed om, hvorvidt et forsøg er i gang.
- *Gating uden datakilde, testet med stubbet tilstand.* Fravalgt: håndhævelsen ville ikke være
  verificeret mod databasen.

**Begrundelse:** Gating er en del af fase 8 og kan ikke virke uden at kunne læse, om et forsøg
eller et rollespil er i gang. Det er at bygge det, fase 8 kræver, ikke at bygge forud.

---

## B-012 — En production-model må kun tage imod production-evidens

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9.1 pkt. 4 og §20.6; `docs/08-ai-gateway.md` §3.3

**Beslutning:** `docs/07` §9.1 er genåbnet for én sætning. "Senere AI-moduler og AI Gateway må
kun tage imod `ProductionEvidenceSet`" er præciseret til "En production-model må kun tage imod
`ProductionEvidenceSet`". En udviklingsmodel (kun `local`/`test`) må tage imod
udviklingsevidens. Kravet: ændringen må ikke kun stå i dokumentationen. Det skal være umuligt i
koden for en production-model at modtage udviklingsevidens. Registret er fail-closed, så et
ukendt miljø tælles som produktion. Det dækkes af både en test og en mutationstest, samme
standard som den eksisterende guardrail. Samtidig er henvisningen i `docs/07` §20.6 rettet fra
fase 8 til fase 9. Resten af `docs/07` er urørt.

**Overvejede alternativer:**
- *Reglen ordret.* Fravalgt: gatewayen kunne ikke køre en eneste forespørgsel med evidens, før
  der findes production-evidens (fase 9).

**Begrundelse:** Formålet med reglen er at forhindre, at svagt kildegrundlag når frem til en
bruger, der handler på det. Det er parringen production-model og udviklingsevidens, der er
farlig. Udviklingsmodel og udviklingsevidens ser ingen bruger.


**Bemærkning (B-019):** "Fase 8" i denne beslutning er nu 8A, og "fase 9" er 8B.

---

## B-011 — Fase 8 bliver AI Gateway; udbydervalget udskydes til fase 9

**Dato:** 2. oktober 2026
**Område:** `docs/roadmap.md`, `docs/08-ai-gateway.md`

**Beslutning:** Fase 8 er AI Gateway uden ekstern AI-udbyder. Det tidligere forslag til fase 8
(embedding- og reranking-udbyder, evalueringssæt, virusscanning, worker i produktion) flyttes
uændret til fase 9. Analysen af udbydere og brugerens svar om EU-krav, omfang og volumen
gemmes i fase 9's beskrivelse i roadmap. I fase 8 kaldes ingen rigtig model. Der bruges en
stub-model efter mønstret fra test-embedderen. Specifikationen skal godkendes før
implementering.

**Overvejede alternativer:**
- *At vælge udbydere først (det oprindelige forslag til fase 8).* Udskudt: gatewayen skal
  bygges uanset udbyder og kan testes uden en.

**Begrundelse:** Gatewayen afgør, hvilke kundedata der forlader platformen. Politikken skal
ligge fast og være testet, før en ekstern model kobles på.

**Bemærkning:** Henvisningen til "fase 8" i `docs/07` §20.6 er rettet til fase 9 ved B-012.
Ved B-019 blev fase 8 til 8A og fase 9 til 8B, og henvisningen peger nu på 8B.

---

## B-010 — Konfliktkandidater vises i bekræftelsesdialogen

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §3.2, §11.2 og §20.2; `docs/04` §14.2

**Beslutning:** Skaber en godkendelse en konflikt med en allerede autoritativ kilde, står det i
dialogen "Godkend som autoritativ" som en konsekvens af godkendelsen. Fremstillingen er den
samme neutrale som i konfliktkøen: begge kilder nævnes, og der anbefales ingen af dem.
Konflikten blokerer ikke godkendelsen (B-11). Den oplyses kun tydeligt.

**Overvejede alternativer:**
- *Kun at vise kandidaten i kvalitetsrapporten.* Fravalgt: dialogen skal opsummere
  konsekvensen, og en ny konflikt er netop en konsekvens.
- *At blokere godkendelsen.* Fravalgt: i strid med B-11. Konflikter afgøres af et menneske
  bagefter.

**Begrundelse:** Efter godkendelsen viser platformen rådgivere to forskellige svar om samme
regel. Det skal den godkendende vide i det øjeblik, beslutningen træffes.

---

## B-009 — Ingen nøgleordsregel; "utilstrækkeligt grundlag" kan fremtvinges i udvikling

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9 og §20.4

**Beslutning:** `none`-rerankeren ændres ikke, og der indføres intet krav om leksikalsk træf.
I stedet findes udviklingsværktøjet "Fremtving utilstrækkeligt grundlag" i "Afprøv
retrieval". Det udsteder et tomt, markeret EvidenceSet uden at køre retrieval og uden at røre
scoringen. Det kan kun bruges, når `IPA_RUNTIME_ENV` udtrykkeligt er `local` eller `test`. Det
er et valg pr. kald og ikke en indstilling, og resultatet kan aldrig blive production-evidens.
I udvikling kan tilstanden kun fremtvinges og ikke opstå af sig selv, før en rigtig reranker
er på plads.

**Overvejede alternativer:**
- *At sende RRF-scorerne urørt videre.* Fravalgt: RRF er rangbaseret, og den bedste kandidat
  får altid samme score. Tærsklen ville stadig ikke kunne tømme resultatet.
- *Et krav om mindst ét leksikalsk træf.* Fravalgt: det ændrer retrieval-semantikken
  permanent for at løse et udviklerproblem og risikerer på dansk, med sammensatte ord og
  bøjninger, at afvise spørgsmål, der kan besvares. Relevans er rerankerens opgave.

**Begrundelse:** Brugerfladen for "Der findes ikke tilstrækkelig dokumentation" skal kunne
ses og bygges, før der findes en rigtig reranker, uden at udviklingsmiljøet opfører sig
anderledes end produktion på scoringen.

---

## B-008 — Retrieval-tallene skal valideres, før production-evidens må bruges

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9, §8.3 og §20.4

**Beslutning:** Tallene for reranking og evidensudvælgelse er ikke validerede. Test-embedderen
giver altid træffere uden reel lighed, og med `none`-rerankeren er tærsklen virkningsløs.
Tallene vurderes først med et evalueringssæt samt en rigtig embedder og reranker. Det er en
forudsætning, før AI-modulerne må bruge production-evidens. Stien "Der findes ikke tilstrækkelig
dokumentation" testes deterministisk uden embedder.

**Overvejede alternativer:**
- *At nøjes med en note i implementeringsstatus.* Fravalgt: begrænsningen rammer den sti, der
  forhindrer svar uden dokumentation, og må ikke kunne overses.
- *At tune tallene med test-embedderen.* Fravalgt: test-embedderen har ingen semantik, så tal
  tunet med den ville give falsk sikkerhed.

**Begrundelse:** "Utilstrækkeligt grundlag" er det vigtigste svar, systemet kan give
(`docs/04` §16, KRAV-AI-004). Under test med test-implementeringerne udløses det næsten aldrig.

---

## B-007 — Utilgængelig retrieval er en systemfejl; ingen mock-videnshuller i Admin

**Dato:** 2. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §9.1, §12 og §20.2; `docs/04` §16

**Beslutning:**
1. Om retrieval kan køre, er en tilstand, som resten af systemet kan læse, og ikke kun en
   linje i serverloggen. Når retrieval er utilgængelig, får brugeren en systemfejl ("Retrieval
   er utilgængelig"), aldrig "Der findes ikke tilstrækkelig dokumentation". Administratoren
   ser tilstanden i Admin, og tests fastholder, at de to tilstande ikke kan forveksles.
2. Videnshuller vises som tom tilstand overalt i Admin, også på forsiden, indtil de kan opstå
   af AI-forespørgsler. Mock-videnshullerne fra fase 5 er fjernet. §12 i `docs/07` er rettet,
   så den ikke længere modsiger §19.

**Overvejede alternativer:**
- *Kun at logge ved opstart.* Fravalgt: en tilstand, der kun står i en log, kan ikke vises
  korrekt, og et tomt resultat kunne forveksles med manglende dokumentation.
- *At beholde mock-tal på forsiden.* Fravalgt: falske tal ved siden af rigtige på samme side
  kan forveksles med produktionsdata (`CLAUDE.md` §2).

**Begrundelse:** `docs/04` §16: "Insufficient" er et kompetent svar, "Error" er et
systemsvigt. Forveksles de, lærer brugerne at ignorere det vigtigste svar, systemet kan give.

---

## B-006 — Et hul i gyldigheden forbliver et hul, men må ikke være tyst

**Dato:** 1. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §3.5 og §12

**Beslutning:** Deaktiveres en version, der har erstattet en forgænger, får forgængeren ikke
sin gyldighed tilbage. Systemet ændrer aldrig selv gyldighed ud over afkortningen ved
erstatning. Et hul i gyldigheden vises i Admin som en tilstand, der kræver opmærksomhed, på
samme måde som dokumentkonflikter flages. Hullet lukkes kun ved en menneskelig handling, nemlig
at publicere en ny version. Systemet foreslår ikke selv en løsning.

**Overvejede alternativer:**
- *Genoplive forgængerens gyldighed automatisk.* Fravalgt: så ville systemet selv afgøre, hvad
  der er gældende viden.
- *Lade hullet være uden markering.* Fravalgt: et tyst hul ville først opdages, når en rådgiver
  ikke får svar.

**Begrundelse:** At systemet selv afgør, hvad der er gældende viden, er forbudt i hele
arkitekturen. Deaktiveringen af efterfølgeren kan netop skyldes, at den var forkert, og så er
en genoplivet forgænger det værste udfald. Et hul giver i stedet "ingen tilstrækkelig
dokumentation", som er et ærligt og korrekt svar (KRAV-AI-004).

---

## B-005 — Gentaget indledning (`lead_in`) for delte lister og tabeller

**Dato:** 1. oktober 2026
**Område:** `docs/07-knowledge-engine.md` §1.2, §6 og §10

**Beslutning:** Når en lang liste eller tabel deles, gemmes den gentagne listeindledning eller
overskriftsrække i feltet `lead_in` på chunket, uden for chunkets `[char_start, char_end)`.
`text` er fortsat præcis udsnittet af den normaliserede tekst. `lead_in` indgår i leksikalsk
søgning og embedding. Når chunket optræder som kilde, vises `lead_in` i kildekortet som
kontekst, visuelt adskilt fra den citerede passage.

**Overvejede alternativer:**
- *Indledningen i selve teksten.* Fravalgt: så er chunkets tekst ikke længere et præcist udsnit
  af dokumentet, og en citation kan ikke verificeres mod dokumentet.
- *Ingen gentagelse.* Fravalgt: en undtagelse ville kunne søges og vises uden sin overskrift.

**Begrundelse:** De to krav i §6 kan ikke opfyldes samtidig i ét felt. Løsningen bevarer det
væsentlige i begge: chunkets tekst er et præcist udsnit, så en citation kan verificeres mod
dokumentet, og indledningen følger med i søgning og embedding, så en undtagelse ikke står uden
sin overskrift. I kildekortet skal det være tydeligt, hvad der er citeret, og hvad der er
kontekst. Et menneske, der læser "undtagelse 7", skal kunne se, hvilken liste den hører til.

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
