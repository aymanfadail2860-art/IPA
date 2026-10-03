# 08 — AI Gateway

**Fase:** 8A — AI Gateway (underfase af masterfase 8 — AI Copilot, B-019)
**Status:** ✅ **Gennemført og låst** (godkendt 2026-10-03, B-018). Specifikationen blev
godkendt 2026-10-02 med afgørelserne B-012 til B-017. Implementeringsstatus, tests og kendte
begrænsninger står i §18. Dokumentet ændres kun ved en eksplicit beslutning om at genåbne det.
**Sprog:** Dansk (kode på engelsk, brugerflade på dansk)
**Bygger på:** `docs/01`–`docs/07` (låst) og `docs/decisions.md` (B-011 til B-019).

Dokumentet er implementeringsspecifikationen for underfase 8A. Det konkretiserer `docs/03` §9 (AI
Gateway), §5 flow A og C, §7 (retrieval-profiler), §11 (privacy) og §13 (observability).
Arkitekturen fra `docs/03` ændres ikke. Hvor specifikationen fortolker eller udbygger et låst
dokument, er det markeret **(udledt)**. Modstriden med låste dokumenter og afgørelserne står i
§15. Åbne spørgsmål står i §16.

Gatewayen er det lag, der afgør, hvilke data der forlader platformen. Derfor blev
specifikationen godkendt, før der blev implementeret.

---

## 0. Formål og afgrænsning

8A bygger politiklaget mellem applikationen og AI-modeller (`docs/03` §1 pkt. 7, §9).
Laget skal bygges uanset hvilken udbyder der vælges senere. Det testes uden en udbyder.

**Der kaldes ingen rigtig AI-model i 8A.** Den eneste model er en stub-model (§3) efter
samme mønster som test-embedderen fra fase 7: udviklingsgrad, fail-closed, og den kan ikke
konstrueres uden for `local` og `test`.

| Bygges i 8A | Bygges ikke i 8A |
|-----------------|----------------------|
| Gatewayens ene indgang og dens trin (§1) | Adapter til Claude API eller anden ekstern model |
| Minimale tilstandstabeller til gating (§9.2, B-013) | Assessment- og Practice-indhold: prøver, spørgsmål, besvarelser, bedømmelse |
| Stub-model og fail-closed modelregister (§3) | Valg af embedding- og reranking-udbyder (8B) |
| Fem workflow-profiler med prompt, handlinger og output-kontrakt (§4) | Learn AI, Practice AI, Advise AI og Assessment AI som moduler med brugerflade |
| Datakategori-matricen som data (§5) | Samtalelagring og -historik (`ai.conversations`, `messages`), se §16 Q-5. Placeret i 8C |
| Dataminimering (§6) og redaction (§7) | Citations-tabellen og en Admin-visning af videnshuller (læsningen er slået fra, B-014) |
| Permission-tjek i gatewayen (§8) | Endelig compliancebeslutning om kundedata (`docs/03` §17 pkt. 4) |
| Server-side gating under Assessment og AI-rollespil (§9) | Assessment og Practice som moduler |
| Logning af kald, kilder og indhold (§11) | Retention: hverken politik pr. datakategori, perioder eller sletningsjob (§11.4, 8C) |
| Copilot-brugerfladen koblet på gatewayen lokalt, mock-svar i demoen (§13) | Omkostningsstyring (ingen omkostning med stub) |
| Opdelt log: indhold og metadata, administratorlæsning slået fra (§11, B-014) | Rate limiting (§10, Q-3). Placeret i 8C |

---

## 1. Placering og flow

Gatewayen ligger i `src/lib/ai/`, er `server-only` og har én offentlig indgang:

```ts
runAiRequest(request: AiRequest): Promise<AiOutcome>
```

Ingen anden kode må kalde en model. Modeladaptere kan kun importeres af gatewayen, og det
håndhæves af en guardrail-test (§14).

```
AiRequest (profil, handling, brugerens input, kontekst-reference)
 → 1. Authn                      gyldig session; aktiv bruger (identity.users.status)
 → 2. Profil                     slås op i registret; ukendt profil/handling → afvist
 → 3. Permission-tjek            §8 — mod databasen, med brugerens egen identitet
 → 4. Gating                     §9 — sessionstilstand i databasen
 → (redaction af brugerens tekst §7 — før retrieval, se nedenfor)
 → 6. Retrieval                  retrieveEvidence med profilens retrieval-profil (docs/03 §7)
 → 7. Evidenskrav                ingen evidens → "utilstrækkeligt grundlag"; modellen kaldes ikke
 → 8. Dataminimering             §6 — kun profilens tilladte dele og felter
 → 9. Klassificering + redaction §5, §7
 → 10. Matrice-tjek              §5 — model × datakategori
 → 11. Modelkald                 stub-modellen (§3)
 → 12. Output-kontrakt           §4.3 — validering; afvisning ved brud
 → 13. Gen-identifikation        pladsholdere erstattes i svaret til brugeren (§7.3)
 → 14. Logning                   §11 — også for afviste og blokerede kald
 → AiOutcome
```

Trinene kører i den rækkefølge. Et trin, der afviser, stopper flowet, og intet efterfølgende
trin kører. Især når intet afvist kald frem til modellen. Logningen (trin 14) sker altid for en
indlogget bruger. Kan et kald ikke logges, vises det ikke (`unavailable`), for det, der har
forladt platformen, skal altid kunne spores. **(udledt)**

Brugerens tekst redigeres **før retrieval** og ikke først i trin 9. Så søges der på det faglige
spørgsmål og ikke på kundens identitet (`docs/03` §9, "Advise er privacy-first"). Kontekstens
allowlist (§6) anvendes allerede ved trin 2. **(udledt under implementeringen)**

**`AiOutcome`** er eksplicit, ligesom `RetrievalOutcome` i fase 7 (B-007):

| `kind` | Betydning | Vises som (`docs/04` §16) |
|--------|-----------|---------------------------|
| `answer` | Svar, der har bestået output-kontrakten | Svar |
| `insufficient` | Retrieval gav ingen evidens; modellen blev ikke kaldt | "Der findes ikke tilstrækkelig dokumentation" |
| `locked` | Gating: aktiv Assessment eller AI-rollespil | Låst tilstand (`docs/04` §15.3) |
| `denied` | Manglende adgang | Adgangsfejl |
| `blocked_policy` | Matricen tillader ikke en nødvendig datakategori | Fejl med forklaring, ikke "utilstrækkeligt" |
| `unverifiable` | Modellens svar brød output-kontrakten. Svaret vises aldrig | Egen tilstand: "Systemet kunne ikke give et svar, der kan dokumenteres", med de fundne kilder (§4.4, B-016) |
| `invalid_request` | Ugyldig forespørgsel (fx tom eller for lang) | Besked ved feltet |
| `unavailable` | Gatewayen, modellen eller retrieval kan ikke køre | Systemfejl |

Fire tilstande kan aldrig se ens ud: svar, "utilstrækkeligt grundlag", "kan ikke
dokumenteres" og systemfejl. Afbildningen ligger ét sted (`presentAi`), som `presentRetrieval`
i fase 7.

Trin 5 (rate limiting) er udeladt, indtil Q-3 er afgjort. Numrene bevares, så logningens
trinnavne ikke skifter betydning senere.

---

## 2. Begreber (udledt)

| Begreb | Betydning |
|--------|-----------|
| **Workflow-profil** | Konfigurationen for ét modul: prompt, tilladte handlinger, retrieval-profil, tilladte datakategorier, output-kontrakt, gating-regler (`docs/03` §9) |
| **Handling** | En navngiven opgave inden for en profil, fx `copilot.answer_question`. En profil kan aldrig udføre en anden profils handlinger |
| **Del** | Ét stykke indhold i en prompt: et evidenselement, brugerens spørgsmål, et kontekstfelt. Hver del bærer én datakategori |
| **Datakategori** | Kategorierne fra `docs/03` §9 (§5) |
| **Model** | En implementering bag `Model`-interfacet med `id`, `version` og `grade` |
| **Grad** | `development` eller `production`, som i `docs/07` §9.1 |

---

## 3. Modellen

### 3.1 Interface

```ts
interface Model {
  readonly id: string;            // fx "stub", senere "anthropic:<model>"
  readonly version: string;
  readonly grade: Grade;          // "development" | "production" — sættes af implementeringen
  generate(input: ModelInput): Promise<ModelOutput>;
}

type ModelInput = {
  profile: { id: string; version: string };
  action: string;
  system: string;                 // profilens prompt
  parts: SentPart[];              // efter minimering og redaction — præcis det, der sendes
  outputContract: string;         // kontraktens id
};
```

Modelversioner er konfiguration (`docs/03` §2). Generering sker med Claude API
(`docs/03` §2, låst). Adapteren til den bygges ikke i 8A.

### 3.2 Stub-modellen

| Egenskab | Specifikation |
|----------|---------------|
| **Grad** | `development`, sat af implementeringen og frosset (`Object.freeze`) som test-embedderen |
| **Fail-closed** | Registret konstruerer den kun, når `IPA_RUNTIME_ENV` udtrykkeligt er `local` eller `test`. Mangler variablen, eller har den en anden værdi, nægtes konstruktionen ved opstart. Gatewayen er så `unavailable` (§12) |
| **Adfærd** | Deterministisk. Den bygger et svar, der opfylder profilens output-kontrakt, alene ud fra de dele, den modtager. For Copilot: højst tre afsnit, hvert et kort uddrag af et evidenselement med kildemarkør. Konflikt i evidensen giver svartypen "modstridende kilder". Historisk evidens giver historisk markering |
| **Markering** | Hvert svar bærer `grade: "development"`. Brugerfladen viser "Udviklingssvar — ingen AI-model" (§13) |
| **Ingen viden** | Stubben tilføjer intet indhold, den ikke har fået. Derfor kan tests fastslå præcis, hvad der nåede frem til "modellen" |
| **Testvarianter** | Kun tests kan konstruere varianter, der bryder kontrakten, fejler eller timer ud. De kan ikke vælges via konfiguration eller miljøvariabler |

### 3.3 Grad på svaret og parringsreglen (B-012)

Svarets grad er `production`, kun hvis både modellen og evidensen er `production`
(`combinedGrade` fra fase 7).

**En production-model må kun tage imod production-evidens** (`docs/07` §9.1 pkt. 4, præciseret
ved B-012). Den farlige parring er production-model med udviklingsevidens. En udviklingsmodel
med udviklingsevidens ser ingen bruger, fordi stubben ikke kan konstrueres uden for
`local`/`test`.

Reglen håndhæves i koden, ikke kun i dokumentationen:

1. **Ét sted kalder modeller.** `invokeModel` i `src/lib/ai/core/invoke.ts` er den eneste
   funktion, der kalder `Model.generate`. En guardrail-test fastslår det.
2. **Fail-closed på modellens grad.** Er modellens grad ikke præcis `"development"`, behandles
   den som production. Så kræver `invokeModel` `requireProductionEvidence(evidence)` fra fase 7,
   som kaster for alt andet end udstedt production-evidens.
3. **Typesystemet.** En production-model (`Model<"production">`) kan kun gives et
   `ProductionEvidenceSet`. Overload-signaturen afviser et almindeligt `EvidenceSet` ved
   kompilering. En typetest fastslår det.
4. **Registret er fail-closed.** Mangler `IPA_RUNTIME_ENV`, eller er den ukendt, er miljøet
   production, og stubben kan ikke konstrueres.
5. **Test og mutationstest.** Tests fastslår, at en production-model får afvist
   udviklingsevidens, uudstedt evidens og evidens fremtvunget af udviklingsværktøjet, og at
   modellen ikke kaldes. Mutationstesten svækker hvert af punkt 1–4 og kræver, at testene fejler.
   Det er samme standard som guardrailen i fase 7.

---

## 4. Workflow-profiler

Profilerne ligger versioneret i repoet (`src/lib/ai/profiles/`). De er tæt knyttet til
prompttekst og output-skemaer og skal gennemgås i review. Profilens id og version logges for
hvert kald. **(udledt)**

### 4.1 Indhold pr. profil

| Felt | Indhold |
|------|---------|
| `id`, `version` | Fx `copilot`, `1` |
| `system` | Prompt og grounding-instruktion (`docs/03` §9 "I kaldet") |
| `actions` | Tilladte handlinger (tool allowlist, `docs/03` §9) |
| `retrieval` | Retrieval-profil efter `docs/03` §7: dokumenttyper, temporal tilstand, `topK` |
| `requiresEvidence` | Om tom evidens stopper kaldet før modellen (trin 7) |
| `categories` | Datakategorier profilen overhovedet må sende. Snævrer matricen ind, udvider den aldrig |
| `context` | Allowlist over kontekstfelter (§6) |
| `outputContract` | Skema, der valideres efter kaldet (§4.3) |
| `gating` | Hvilke sessionstilstande der låser profilen (§9) |

### 4.2 De fem profiler

| Profil | Handlinger i 8A | Retrieval | Evidens kræves | Særligt |
|--------|---------------------|-----------|----------------|---------|
| **Copilot** | `answer_question` | Præcis; alle tilladte typer; gældende, historisk på anmodning | Ja | Strengest grounding. Låst under Assessment og AI-rollespil |
| **Learn** | `explain` | Bred; produktbeskrivelser, vejledninger, materiale; gældende | Ja | Eksempler må være opdigtede og markeres som det. Produktfakta i dem kræver citation |
| **Practice** | `roleplay_turn`, `feedback` | Scenariebundet; produktdata; gældende | Kun `feedback` | Må opfinde en fiktiv kunde, ikke produktfakta. Ingen Copilot-adgang under rollespil |
| **Advise** | `suggest` | Case-bundet; betingelser, acceptregler, forretningsgange; gældende på casens dato | Ja | Alt fagligt bærer citation. Svar har status **AI-genereret forslag** og skrives ikke ind i sagen i 8A |
| **Assessment** | `evaluate` | Facitgrundlag; gældende | Ja | Systemets egen brug. Kan ikke kaldes af en bruger under et aktivt forsøg. Kaldes ikke fra brugerfladen i 8A |

Kun Copilot får en brugerflade i 8A (§13). De øvrige fire profiler bygges og testes
gennem gatewayen alene, så politikken er på plads, før modulerne bygges. Det er ikke
modulfunktionalitet.

**Prompterne er udkast.** De kan ikke valideres uden et evalueringssæt med tilhørende
infrastruktur (8B) og en rigtig model. Selve valideringen af Copilot-prompterne mod en rigtig
model hører til 8C. De markeres i koden som ikke-validerede, og profilversionen hæves, når en prompt
ændres.

### 4.3 Output-kontrakter

Kontrakten valideres deterministisk efter modelkaldet (`docs/03` §6 lag 4 og §9 "Efter
kaldet"):

| Profil | Kontrakt (kort) | Valideres maskinelt |
|--------|-----------------|---------------------|
| Copilot | `kind`: `answer` \| `conflict` \| `insufficient`. Afsnit med tekst og kildemarkører. Hvert afsnit i et `answer` har mindst én markør. Markører peger kun på evidens-id'er, der blev sendt med. Citeres et historisk element, er svaret markeret historisk. Citeres et element i åben konflikt, er `kind` = `conflict` | Ja, fuldt |
| Learn | Forklaringsafsnit med markører. Eksempler i et særskilt felt med markeringen "fiktivt eksempel" | Strukturen, markørerne og eksempelmarkeringen |
| Practice | `roleplay_turn`: replik uden kildemarkører. `feedback`: punkter med markører, hvor de henviser til faglig viden | Strukturen. **At en replik ikke indeholder produktfakta, kan ikke valideres maskinelt.** Det er en restrisiko (`docs/03` §16) |
| Advise | Forslag med status `ai_suggestion` og mindst én markør pr. fagligt forslag | Ja |
| Assessment | Vurdering pr. kriterium med henvisning til facitgrundlaget | Strukturen |

**Ved brud vises svaret aldrig**, heller ikke med en advarsel (B-016). `docs/03` §9 siger
"afvises eller markeres". 8A afviser.

### 4.4 Tilstanden "kan ikke dokumenteres" (B-016)

Udfaldet `unverifiable` er en fjerde tilstand, adskilt fra de tre i `docs/04` §8.3 og fra
systemfejl:

- Den er ikke "utilstrækkelig dokumentation", for dokumentationen fandtes. Modellen brugte den
  ikke rigtigt.
- Den er ikke en systemfejl. Systemet virkede, men svaret bestod ikke kontrollen.

**Formulering:** "Systemet kunne ikke give et svar, der kan dokumenteres". Brødtekst: "Der blev
fundet kilder til spørgsmålet, men svaret kunne ikke kontrolleres mod dem. Derfor vises det
ikke. Du kan selv læse kilderne herunder."

**Udseende:** neutral ramme med ikonet `file-search` og kildekortene for de fundne kilder.
Ingen faglig tekst fra modellen og ingen grundlagslinje. Tilstanden genbruger hverken
farverollen for "utilstrækkeligt grundlag" (`knowledge.insufficient`) eller fejlrollen.
`docs/04` er låst og er ikke ændret. Tilstanden er defineret her.

**Logning:** Udfaldet logges med en årsagskode for det konkrete kontraktbrud (fx
`uncited_paragraph`, `unknown_citation`, `missing_historical_marker`, `conflict_not_flagged`).
Det rå output gemmes i indholdsloggen (§11), så gentagelser kan spores til prompten eller
modellen.

---

## 5. Datakategorier og matricen

### 5.1 Kategorier

Kategorierne er dem fra `docs/03` §9:

| Nøgle | Kategori | Hvordan en del får kategorien |
|-------|----------|-------------------------------|
| `knowledge` | Godkendt faglig viden fra Knowledge Engine | Kun fra et `EvidenceSet` fra `retrieveEvidence` |
| `user_question` | Brugerens eget spørgsmål | Brugerens fritekst. Fundne identifikatorer i teksten er `customer_identifiable` (§7) |
| `learning` | Lærings- og træningsdata | Fra profilens kontekst (Learn, Practice) |
| `training_fictional` | Fiktive træningscases | Fra Practice-scenarier |
| `customer_identifiable` | Identificerbare kunde- og virksomhedsdata | Alle felter fra en kundecase. Identifikatorer fundet af redaction |
| `audit_access` | Audit- og adgangsdata | Kan ikke konstrueres som del. Der findes ingen konstruktør |

Delene konstrueres kun gennem typede konstruktører i gatewayen. En kalder kan ikke selv
angive kategorien på en vilkårlig tekst. **(udledt)**

### 5.2 Matricen

Matricen er data, ikke kode (`docs/03` §9). Den ligger i databasen i
`ai.data_category_policy` (`model_id`, `category`, `rule`), hvor `rule` er en af tre værdier:

| `rule` | Betydning |
|--------|-----------|
| `allow` | Må sendes uændret |
| `allow_redacted` | Må sendes efter redaction (§7) |
| `deny` | Må ikke sendes |

- **Mangler en række, gælder `deny`.** Matricen er fail-closed.
- **`customer_identifiable` er `deny` for alle modeller som standard** (`docs/03` §9, §11).
  Ændringen kræver en eksplicit politikbeslutning (`docs/03` §17 pkt. 4) og hører ikke til i
  8A.
- **`audit_access` er `deny` uden undtagelse.** Databasen afviser en række med en anden
  regel (check-constraint).
- Startværdier for stub-modellen: `knowledge` allow, `user_question` allow_redacted,
  `learning` allow, `training_fictional` allow, `customer_identifiable` deny, `audit_access`
  deny.
- Ændringer sker kun gennem databasefunktionen `ai.set_data_category_rule`, der kræver
  `system.settings.manage`. Hver ændring auditeres i `audit.audit_log` med hvem
  (`actor_id`), hvad (model, kategori, regel før og efter) og hvornår (B-017). Ingen kan skrive
  direkte i tabellen, heller ikke administratoren. Der bygges ingen Admin-brugerflade til
  matricen i 8A.
- Matricen ligger i databasen, fordi den er politik, der kan skulle ændres uden en udrulning,
  og skal kunne revideres. Profilerne ligger i repoet, fordi de er prompts og
  output-kontrakter, der hører til koden og gennemgås som kode (B-017).

### 5.3 Evaluering

Den effektive regel for en del er den strengeste af matricen og profilens `categories`.
**Er en nødvendig del `deny`, blokeres hele kaldet** (`blocked_policy`) med en årsag, og det
logges. Delen fjernes ikke stiltiende, for så forringes svaret, uden at nogen opdager det
(`docs/03` §16, "Redaction kan fjerne for meget").

---

## 6. Dataminimering

Kun det nødvendige sendes med (`docs/03` §9, §11):

- **Allowlist pr. profil.** Kun kontekstfelter i profilens `context` kommer videre.
  Alt andet fjernes før klassificeringen. Antallet af fjernede felter logges, deres indhold
  logges ikke.
- **Grænser** pr. del og i alt: antal evidenselementer, tegn pr. del og tegn i alt. Tallene
  er konfiguration.
- **Brugerens identitet sendes aldrig til modellen.** Hverken navn, e-mail eller bruger-id.
- **Kontekst hentes af gatewayen selv** ud fra en reference (fx produkt-id eller sags-id), med
  brugerens egen adgang. Kontekst, som klienten sender i fritekst, behandles som brugerens
  input og ikke som kontekst. **(udledt)**
- **Kundecase-kontekst:** Advise-profilens allowlist er **tom** i 8A. Hvilke sagsfelter der
  er nødvendige, afgøres med Advise-modulet. Uanset det er de `customer_identifiable` og
  dermed `deny` (§5.2).
- **Én tur ad gangen.** Uden samtalelagring sendes ingen tidligere ture med (§16 Q-5).

---

## 7. Redaction og anonymisering

### 7.1 Hvad der findes

Redaction er regelbaseret og deterministisk. Den køres på al fritekst i kategorien
`user_question` og på kontekstfelter, der er markeret som fritekst.

| Type | Regel (kort) | Pladsholder |
|------|--------------|-------------|
| CPR-nummer | `ddmmåå-xxxx` / `ddmmååxxxx` med gyldig dato | `[CPR-n]` |
| CVR-nummer | 8 cifre **kun** med "CVR"/"cvr-nr." i nærheden, så beløb og paragraffer ikke rammes | `[CVR-n]` |
| E-mail | Standardformat | `[EMAIL-n]` |
| Telefonnummer | Danske formater, med og uden +45 | `[TELEFON-n]` |
| Kontonummer og IBAN | Reg.nr. + konto. DK-IBAN | `[KONTO-n]` |
| Kendte navne | Navne fra den kontekst, gatewayen selv har hentet (fx sagens virksomhedsnavn), og brugerens eget navn | `[VIRKSOMHED-n]`, `[PERSON-n]` |

Samme værdi får samme pladsholder inden for ét kald. Redaktionsniveauet er konfiguration pr.
datakategori (`docs/03` §16).

### 7.2 Hvad der ikke findes (restrisiko)

- **Navne og adresser i fri tekst**, som ikke kendes fra konteksten, findes ikke af regler.
- **Policenumre** findes ikke, fordi formatet er ukendt **[AFKLARES]** (§16 Q-8).

Netop derfor er `customer_identifiable` `deny` som standard, og Advise tages ikke i brug på
reelle kunder, før compliancebeslutningen er truffet (`docs/03` §17 pkt. 4). Redaction er et
ekstra lag, ikke en garanti.

### 7.3 Pladsholdere og gen-identifikation (udledt)

Koblingen mellem pladsholder og oprindelig værdi findes kun i hukommelsen under det ene kald.
Den logges aldrig og gemmes aldrig. Pladsholdere i modellens svar erstattes med de
oprindelige værdier i svaret til brugeren. Loggen indeholder kun den redigerede version og en
optælling pr. type (§11).

---

## 8. Permission-tjek i gatewayen

Gatewayen kontrollerer rettighederne igen. Den stoler ikke på, at applikationslaget har gjort
det (`docs/03` §9). Kontrollen sker mod databasen med **brugerens egen identitet** (RLS og
`identity.has_permission`) og aldrig med service-role-nøglen.

| Kontrol | Hvordan |
|---------|---------|
| Aktiv bruger | `identity.users.status`. En deaktiveret bruger afvises, selv med en gyldig session |
| Dokumentadgang | `retrieveEvidence` kører som brugeren (security invoker, grants fra `docs/07` §4). Gatewayen kan ikke udvide adgangen. Rådgivere og ledere har adgang gennem dokumenttildelinger, ikke gennem rollen (`docs/07` §4.1). Derfor kræver `retrieveEvidence` en aktiv session og ikke rollerettigheden `knowledge.document.read`. Se §18 om rettelsen |
| Kundecase | Kun med `advise.case.read` og `advise.is_case_participant(case_id)`. En sag, man ikke har adgang til, svarer som "findes ikke" |
| Lærings- og træningskontekst | `learning.progress.read` og `practice.session.write`, scope `own` |
| Assessment-profilen | Kan ikke kaldes som brugerhandling i 8A |

At bruge Copilot kræver ingen særskilt permission: Copilot er tilgængelig for alle roller
(`docs/02` §10), og adgangen til indholdet styres af dokumentadgangen. Den eneste nye
permission er `ai.quality.read` til administratorers læsning af metadata (§11.3, B-014). Den
er slået fra i 8A.

---

## 9. Gating — håndhævet på serveren

### 9.1 Regler

| Regel | Kilde | Låser |
|-------|-------|-------|
| **G1** Aktivt Assessment-forsøg | KRAV-ASS-001, `docs/02` §5, `docs/03` §5 flow C og §9 | Al brugerrettet AI: Copilot, Learn, Practice og Advise **(udledt** af `docs/03` §9, "Ingen brugerrettet AI under aktivt forsøg", og `docs/04` §11, "Copilot og AI-hjælp er slået fra"**)** |
| **G2** Aktivt AI-rollespil | `docs/02` §5, `docs/03` §9, B-015 | Al brugerrettet AI undtagen rollespillet selv: Copilot, AI i Learn (forklaringer, eksempler), Advise-AI og Practice-feedback. Kun `practice.roleplay_turn` for **det aktive rollespil** er tilladt |

Låsen gælder AI, ikke modulerne (B-015). Learn og Advise forbliver tilgængelige som moduler
under et rollespil. At læse op i Learn er læring, og en rigtig kundesag er en anden
arbejdsopgave. Det er AI'en i dem, der låses, fordi den svarer for brugeren.

- Gatingen gælder **brugeren**, ikke fanen eller enheden. Et kald fra en anden fane eller
  enhed afvises også.
- Tilstanden læses fra databasen ved hvert kald. **Kan den ikke læses, afvises kaldet som
  systemfejl** (fail-closed). Det vises aldrig som "utilstrækkeligt grundlag".
- Efter afslutning ophæves låsen straks (`docs/02` §5). Copilot skifter rolle til
  efterbehandler.
- Brugerfladen forklarer låsen (`docs/04` §15.3). Låsen bestemmes ikke i brugerfladen.

### 9.2 Tilstanden — bevidst minimum (B-013)

`docs/03` §4 lægger sessionstilstanden i `assessment.assessment_attempts` og
`practice.roleplay_sessions` ("Session-tilstand afgør AI-gating"). 8A opretter de to
tabeller i deres rigtige domæner, **med kun de felter, gatingen har brug for**. Det er at bygge
det, 8A kræver, ikke at bygge forud.

| Tabel | Felter | Aktiv når |
|-------|--------|-----------|
| `assessment.assessment_attempts` | `id`, `user_id`, `status` (`active` \| `submitted`), `started_at`, `ends_at` (tidsgrænse, valgfri), `ended_at` | `status = active` og (`ends_at` er tom eller i fremtiden) |
| `practice.roleplay_sessions` | `id`, `user_id`, `status` (`active` \| `ended`), `started_at`, `ended_at` | `status = active` |

**Bevidst minimum.** Ingen prøve, ingen spørgsmål, ingen besvarelser, ingen bedømmelse, intet
scenarie og ingen samtale. Den senere Assessment- og Practice-fase **udvider** tabellerne med
kolonner og relationer. Den bygger dem ikke om. Statusværdierne kan udvides. De eksisterende
betydninger af `active` og tidsgrænsen ændres ikke, fordi gatingen hviler på dem.

- **Skrivning** sker kun gennem fire funktioner for brugerens egne rækker:
  `assessment.start_attempt(ends_at)`, `assessment.submit_attempt(id)`,
  `practice.start_roleplay()` og `practice.end_roleplay(id)`. Højst ét aktivt forsøg og ét
  aktivt rollespil pr. bruger. Ingen kan skrive direkte i tabellerne.
- **Læsning:** brugeren læser egne rækker. Hverken leder eller administrator får adgang i 8A.
- **Gatewayen** læser tilstanden gennem `ai.my_gating_state()`, der kun returnerer den aktuelle
  brugers tilstand (`assessment_active`, `roleplay_session_id`).
- **Ophør:** et forsøg ophører kun ved aflevering eller ved udløb af tidsgrænsen. En bruger
  kan ikke "afbryde" et forsøg. Et rollespil afsluttes af brugeren. Forladte forsøg uden
  tidsgrænse og forladte rollespil er **[AFKLARES]** (§16 Q-2).
- I 8A bruger kun udviklingsværktøjet (§13) og tests funktionerne. Modulerne kalder dem
  senere.

---

## 10. Rate limiting

`docs/03` §9 placerer rate limiting i gatewayen, og `docs/07` §14 siger, at den "kommer med"
gatewayen. Den er ikke bygget i 8A og er placeret i 8C (`docs/roadmap.md`). Forslaget er en enkel
grænse pr. bruger pr. minut og pr. døgn, talt i kaldsloggen, med tallene som konfiguration.
Kaldsloggen indeholder allerede det, der skal tælles.

---

## 11. Logning

Hvad blev sendt, hvad kom retur, hvilke kilder, hvor lang tid, hvilke fejl (`docs/03` §9,
§13). Loggen ligger i skemaet `ai` og holdes adskilt fra `audit`, som kun registrerer
handlinger (`docs/07` §13).

### 11.1 Indhold og metadata er adskilt (B-014)

Loggen skelner mellem **svarets indhold** og **dets maskineri**. Det er dataminimering anvendt
på loggen selv.

| Tabel | Del | Indhold |
|-------|-----|---------|
| `ai.gateway_calls` | Metadata | Én række pr. kald, også afviste: bruger, profil og version, handling, model (id, version, grad), evidensens grad, svarets grad, udfald, årsagskode, om kaldet er bundet til en kundecase, tid pr. trin i ms, fejlkode, redaction-optælling pr. type, antal fjernede felter, om grundlaget var utilstrækkeligt, tidspunkt. **Ingen fritekst** |
| `ai.gateway_call_sources` | Metadata | Pr. evidenselement: `evidenceId`, chunk, dokumentversion, score, om det blev sendt, om det blev citeret |
| `ai.gateway_payloads` | Indhold | Det, der blev sendt (efter minimering og redaction, præcis som modellen fik det), og modellens rå svar. Behandles som kundedata (`docs/03` §11) |
| `ai.knowledge_gaps` | Videnshul | Ét pr. kald med udfaldet "utilstrækkeligt grundlag": den redigerede spørgsmålstekst, eller **tom**, når kaldet er bundet til en kundecase |

### 11.2 Adgang

| Del | Hvem læser | Hvordan |
|-----|------------|---------|
| **Indhold** (`gateway_payloads`) | Kun brugeren selv. **Et kald bundet til en kundecase følger kundecasens adgangsregler**: deltagere i sagen med `advise.case.read`, og rækken slettes med sagen | RLS |
| **Metadata** (`gateway_calls`, `gateway_call_sources`) | Brugeren selv. Administratorer med `ai.quality.read` til kvalitetsarbejde, **når adgangen er slået til** | RLS for brugeren. For administratorer kun gennem `ai.admin_call_metadata` |
| **Videnshuller** (`knowledge_gaps`) | Brugeren selv. Administratorer med `ai.quality.read`, når adgangen er slået til. Fra en kundecase kommer kun det nøgne faktum, at grundlaget manglede, aldrig teksten | RLS for brugeren. For administratorer kun gennem `ai.admin_knowledge_gaps` |

### 11.3 Administratorers læsning — bygget, men slået fra (B-014)

- Strukturen er på plads, så adgangsbeslutningen kan tages før produktion **uden en
  migration**. Kontakten `ai.settings.admin_metadata_read_enabled` er `false` i 8A.
- Kontakten ændres kun med `ai.set_admin_metadata_read(enabled)`, der kræver
  `system.settings.manage` og auditeres (hvem, før og efter, hvornår).
- Administratorers læsning sker kun gennem de to funktioner. Der findes ingen RLS-politik, der
  giver administratorer direkte læseadgang, så ingen læsning kan ske uden om auditten.
- **Hver læsning logges i `audit.audit_log`** (`ai.metadata.read` og `ai.knowledge_gaps.read`)
  med hvem, hvornår, filtre og antal rækker, ligesom individniveau i Analytics.
- Funktionerne returnerer hverken bruger-id eller sags-id, kun om kaldet var bundet til en
  kundecase. Kvalitetsarbejde kræver ikke at vide, hvem der spurgte. **(udledt)**
- `ai.quality.read` er en ny permission i kataloget (`docs/03` §17 pkt. 6), givet til
  Administrator-rollen. Uden kontakten giver den ingen adgang. **(udledt** af B-014: adgang
  styres af permissions, ikke af rollenavne.**)**

### 11.4 Regler

- **Den oprindelige, uredigerede tekst logges ikke**, og pladsholderkoblingen logges ikke
  (§7.3). "Hvad blev sendt" er den redigerede version. Videnshullets tekst er også den
  redigerede version.
- **Append-only.** Rækkerne skrives kun gennem én databasefunktion (`ai.record_call`, security
  definer), der kun skriver for den aktuelle bruger og kontrollerer sagsadgangen for et
  sagsbundet kald. De kan ikke opdateres.
- **Retention — hvad der faktisk er implementeret:** indholdet fra et sagsbundet kald slettes
  sammen med kundesagen (fremmednøgle med `on delete cascade`), og metadata mister da kun
  sags-id'et. Sletning af en bruger fjerner brugerens rækker. Ud over det slettes intet.
- **Retention — hvad der ikke er implementeret:** der findes ingen retentionspolitik pr.
  datakategori, ingen perioder og intet sletningsjob. `docs/03` §11 kræver en politik pr.
  kategori ("AI-samtaler", "Retrieval-logs"), og perioderne er **[AFKLARES]** (`docs/03` §17
  pkt. 5). Mekanismen og perioderne hører til 8C (`docs/roadmap.md`). At der intet slettes
  automatisk, er kun forsvarligt, fordi 8A kun kører på fiktive data.
- "Afprøv retrieval" fra fase 7 går ikke gennem gatewayen og logger fortsat intet.

---

## 12. Tilgængelighed

Som `getRetrievalAvailability()` i fase 7 (B-007) får gatewayen en læsbar tilstand,
`getGatewayAvailability()`. Tilstanden er `unavailable` med årsag, når:

- modellen ikke kan konstrueres (fx stub i production),
- retrieval er utilgængelig,
- matricen eller gating-tilstanden ikke kan læses.

Admin-oversigten viser tilstanden. En utilgængelig gateway vises altid som systemfejl.

---

## 13. Copilot-brugerfladen i 8A

| Miljø | Hvad sker der |
|-------|---------------|
| **Lokalt og i test, med database** | Copilot (hovedområde og globalt panel) sender spørgsmålet via en server action til `runAiRequest` med Copilot-profilen. Svaret vises med de eksisterende komponenter: svar med kildemarkører, grundlagslinje, kildekort (med `leadIn`), konflikt- og historisk markering. Et banner viser "Udviklingssvar — ingen AI-model". "Utilstrækkeligt grundlag" og låst tilstand kommer fra gatewayens udfald. Gating sættes til og fra med et markeret udviklingsværktøj (kun `local`/`test`, som B-009), der starter og afslutter et forsøg eller rollespil gennem funktionerne i §9.2. "Kan ikke dokumenteres" kan fremtvinges med en stub-variant, der bryder kontrakten, og "utilstrækkeligt grundlag" med samme værktøj som B-009. Begge er valg pr. kald og afvises af gatewayen uden for `local`/`test` |
| **Vercel-demoen uden database** | Gatewayen kan ikke køre: ingen database, og stubben nægtes uden for `local`/`test`. Copilot viser i stedet realistiske mock-svar med kildekomponenter fra `src/mocks/`, tydeligt markeret som mock, så brugerfladen kan vurderes. Et nyt spørgsmål besvares med et fast mock-svar, ikke af en model. Eksempelsamtalerne dækker også "kan ikke dokumenteres". Se §16 Q-6 |

Mock-svar og stub-svar blandes aldrig: i et miljø med database vises ingen mock-samtaler.
Historiklisten viser en tom tilstand, fordi samtaler ikke gemmes i 8A (§16 Q-5).

---

## 14. Tests

| Område | Konkrete tests |
|--------|----------------|
| **Stub fail-closed** | Registret nægter at konstruere stubben, når `IPA_RUNTIME_ENV` mangler, er `production` eller ukendt. Graden kan ikke ændres (frosset). Gatewayen er `unavailable` i production |
| **Parringsreglen (B-012)** | Stub-svar har altid `grade: "development"`. En production-model får afvist udviklingsevidens, uudstedt evidens og fremtvunget evidens, og `generate` kaldes ikke. En model med ukendt grad behandles som production. Et `EvidenceSet` uden brand kan ikke gives til en production-model (typetest). Kun `invokeModel` kalder `generate` |
| **Eneste vej** | Ingen fil uden for `src/lib/ai/` importerer modeladaptere eller registret. Ingen klientkomponent importerer `src/lib/ai/` |
| **Redaction** | Korpus af positive og negative eksempler pr. type, herunder at beløb, "§ 4.2", datoer og 8-cifrede tal uden "CVR" ikke rammes. Stubben registrerer det modtagne: ingen CPR, CVR, e-mail, telefon, konto eller kendt navn når frem. Pladsholdere er konsistente inden for ét kald. Gen-identifikation sker kun i svaret til brugeren |
| **Matrice** | Manglende række giver `deny`. `customer_identifiable` blokerer kaldet (`blocked_policy`), og stubben kaldes ikke. `audit_access` kan ikke sættes til andet end `deny` (constraint). Ændring kræver `system.settings.manage` og auditeres. Profilen kan snævre ind, ikke udvide |
| **Minimering** | Felter uden for allowlisten når ikke frem. Grænser for antal og længde håndhæves. Brugerens navn, e-mail og id når aldrig frem |
| **Permissions** | Deaktiveret bruger afvises. Sag uden deltagelse giver "findes ikke". Evidens følger dokumentadgang (rådgiver A ser ikke dokument Y via gatewayen). Assessment-profilen kan ikke kaldes som bruger |
| **Gating** | Med aktivt forsøg: alle brugerrettede profiler giver `locked`, og stubben kaldes ikke, også fra en anden session for samme bruger. Med aktivt rollespil: Copilot, Learn, Advise og Practice-feedback `locked`, `roleplay_turn` for det aktive rollespil tilladt, for et andet id afvist. Efter afslutning: tilgængelig straks. Udløbet tidsgrænse ophæver låsen. Ulæselig tilstand giver systemfejl, aldrig `insufficient`. Tabellerne kan ikke skrives direkte. En bruger kan ikke afslutte en andens forsøg |
| **Evidenskrav** | Tom evidens giver `insufficient`, og stubben kaldes ikke |
| **Output-kontrakt** | Testvarianter af stubben: afsnit uden markør, markør til ukendt evidens-id, manglende historisk markering, konflikt uden `kind = conflict` giver alle `unverifiable` med de fundne kilder og uden modellens tekst. Årsagskoden logges |
| **Logning** | Hvert kald, også afviste, giver præcis én række i `gateway_calls`. Payload er den redigerede version. Den oprindelige tekst findes ingen steder i databasen bagefter. Brugere kan kun læse egne rækker. Rækker kan ikke opdateres. `audit` indeholder intet indhold |
| **Indhold og metadata (B-014)** | Sagsbundet indhold læses af sagens deltagere og ikke af den, der har mistet adgangen. Det slettes med sagen. Videnshul fra en kundecase har ingen tekst. Administratorer kan ikke læse metadata eller videnshuller direkte. Funktionerne afviser, mens kontakten er slået fra. Når den er slået til i en test, kræver de `ai.quality.read`, returnerer hverken bruger- eller sags-id og skriver en audit-række pr. læsning. Kontakten og matricen kan kun ændres med `system.settings.manage`, og ændringen auditeres |
| **Udfald** | `presentAi` afbilder de fire tilstande entydigt: `unverifiable` er aldrig fejl eller "utilstrækkeligt", `unavailable` er aldrig "utilstrækkeligt" (som B-007) |
| **Mutationstests** | Svækket parringsregel, svækket register, svækket matrice, fjernet gating-tjek, fjernet redaction-type, fjernet RLS-politik på loggen og fjernet audit ved administratorlæsning skal hver især få tests til at fejle |
| **Rutetests** | Copilot lokalt: svar med kildekort og udviklingsbanner. Låst tilstand. Demoen uden database viser mock-svar og kalder ikke gatewayen |

Fasen er færdig, når lint, typecheck, build, enhedstests, pgTAP, integrationstests og
rutetests består.

---

## 15. Modstrid med låste dokumenter — afgjort 2026-10-02

| # | Modstrid | Afgørelse |
|---|----------|-----------|
| K-1 | `docs/07` §9.1 pkt. 4: "AI Gateway må kun tage imod `ProductionEvidenceSet`" ville forhindre enhver kørsel i 8A | **B-012.** Præciseret til "en production-model må kun tage imod `ProductionEvidenceSet`". `docs/07` §9.1 er genåbnet for netop den sætning. Håndhæves i koden med test og mutationstest (§3.3) |
| K-2 | Gatingen skal læse tilstand i domæner, der ikke findes endnu (`docs/03` §4, CLAUDE.md §2 regel 2) | **B-013.** De to tabeller oprettes nu i deres rigtige domæner med kun gating-felterne, dokumenteret som bevidst minimum (§9.2) |
| K-3 | `docs/03` §11 ("AI-samtaledata: Egen") mod §13 (kvalitetsanalyse) | **B-014.** Indhold og metadata adskilles. Indhold: kun brugeren selv, eller kundecasens regler. Metadata og videnshuller: administratorer til kvalitetsarbejde, men slået fra i 8A. Al administratorlæsning auditeres (§11) |

Desuden er henvisningen i `docs/07` §20.6 rettet, så udbyderne er videreført til 8B (B-012, B-019).

---

## 16. Åbne spørgsmål

| # | Spørgsmål | Blokerer |
|---|-----------|----------|
| Q-1 | ~~Låses Learn og Advise under et AI-rollespil?~~ **Afgjort (B-015):** al brugerrettet AI undtagen rollespillet selv låses. Modulerne gør ikke | — |
| Q-2 | Hvornår ophører et forladt Assessment-forsøg uden tidsgrænse og et forladt rollespil? Forslag: et rollespil udløber efter en konfigurerbar inaktivitet. Et forsøg uden tidsgrænse forbliver aktivt, til det afleveres eller afbrydes af en administrator | Nej, kan afgøres med modulerne. 8A kræver eksplicit afslutning |
| Q-3 | Skal rate limiting med i 8A (§10)? Ikke bygget. Placeret i 8C | Nej |
| Q-4 | ~~Hvordan vises et svar, der bryder kontrakten?~~ **Afgjort (B-016):** aldrig. En fjerde tilstand med egen formulering, eget udseende og de fundne kilder (§4.4) | — |
| Q-5 | Gemmes Copilot-samtaler i 8A (`ai.conversations`, `messages`)? Forslag: nej. Samtalelagring arver kundecasens regler (`docs/03` §11) og hører til Copilot-modulet. 8A er én tur ad gangen. Samtalelagring er placeret i 8C | Nej |
| Q-6 | Er faste mock-svar i Vercel-demoen nok til at vurdere Copilot, eller skal flere svartyper (konflikt, historisk, utilstrækkeligt, låst) kunne vælges direkte i demoen? | Nej |
| Q-7 | Skal kravet om EU-region og databehandleraftale (8B) også gælde for generering med Claude API? Det påvirker ikke 8A. Spørgsmålet hører til 8C, hvor en rigtig model kobles på | Nej |
| Q-8 | Har policenumre et kendt format, der kan genkendes? | Nej. Restrisiko indtil da |
| Q-9 | ~~Matrice i databasen, profiler i repoet?~~ **Afgjort (B-017):** ja. Matriceændringer auditeres med hvem, hvad og hvornår, og matricen er fail-closed | — |
| Q-10 | Skal administratorers læsning af metadata og videnshuller slås til før produktion (B-014)? Det kræver ingen migration | Produktion, ikke 8A |

---

## 17. Implementeringsrækkefølge

1. Skemaet `ai`: matricen, kaldsloggen, `record_call`, RLS og pgTAP.
2. Model-interface, fail-closed register og stub-model med guardrail-tests.
3. Profiler og output-kontrakter med validering.
4. Klassificering, minimering og redaction med testkorpus.
5. Gating-tilstand (B-013) og `my_gating_state()`.
6. `runAiRequest` med alle trin, udfald, tilgængelighed og logning.
7. Copilot-brugerfladen lokalt og mock-svar i demoen.
8. Integrations-, rute- og mutationstests. Opdatering af dokumentet og roadmap.

---

## 18. Implementeringsstatus — gennemført og låst (2026-10-03)

Alle otte trin i §17 er bygget. Lint, typecheck, build, enhedstests, pgTAP, integrations- og
rutetests består. Fasen blev godkendt og låst 2026-10-03 (B-018).

### 18.1 Hvad der er bygget

| Del | Hvor |
|-----|------|
| Migration: `ai`-skemaet (matrice, indstillinger, opdelt log, `record_call`, administratorfunktioner), de minimale tabeller i `assessment` og `practice`, permissionen `ai.quality.read` | `supabase/migrations/20261002000100_ai_gateway.sql` |
| Kerne: typer, model-interface, `invokeModel` (B-012), fail-closed register, stub-model, profiler, output-kontrakter, matrice, redaction, gating og pipelinen | `src/lib/ai/core/` |
| Server: `runAiRequest`, `getGatewayAvailability`, databaseafhængigheder, Copilots server action | `src/lib/ai/gateway.ts`, `gateway-deps.ts`, `copilot-actions.ts` |
| Visning: `AiOutcome`, `presentAi`, afbildning til Copilots svarvisning | `src/lib/ai/outcome.ts`, `copilot-view.ts` |
| Brugerflade: Copilot (hovedområde og globalt panel) på gatewayen, tilstanden "kan ikke dokumenteres", gatewayens tilstand i Admin | `src/components/copilot/`, `src/components/knowledge/unverifiable-answer.tsx`, `src/components/knowledge-admin/gateway-status.tsx` |
| Udviklingsværktøjer (kun `local`/`test`) og demoens faste mock-svar | `src/dev/ai/`, `src/dev/demo/copilot-demo.ts`, `src/mocks/copilot.ts` |

### 18.2 Afklaringer under implementeringen (godkendt 2026-10-03)

1. **Rettelse i fase 7-koden: `retrieveEvidence` krævede rollerettigheden
   `knowledge.document.read`.** Rådgivere og ledere har kun adgang gennem dokumenttildelinger
   (`docs/07` §4.1 og §4.3). Med kravet ville de altid blive afvist, når en AI-funktion søgte for
   dem. Fejlen viste sig først nu, fordi Admin-værktøjet var den eneste bruger i fase 7. Koden
   kræver nu en aktiv session, og databasen afgør adgangen, som `docs/07` foreskriver.
   `docs/07` er ikke ændret, for det var koden, der afveg. "Afprøv retrieval" kræver fortsat
   Admin-adgang og `knowledge.document.read`.
2. **Logningsfejl er fail-closed.** Kan et kald ikke logges, vises svaret ikke (§1).
3. **Redaction før retrieval** (§1).
4. **Svarets kilder er de citerede.** Copilot viser de kilder, svaret hviler på, i
   citationsrækkefølge. "Kan ikke dokumenteres" viser alle de fundne kilder (B-016).
5. **Sletning af en kundecase.** Fremmednøglen nulstiller `case_id` i metadata, og indholdet
   slettes. Append-only-triggeren tillader netop den ene ændring. pgTAP-testen fandt problemet.
6. **Et forsøg med udløbet tidsgrænse** får status `expired`, når brugeren starter et nyt. Det
   låser ikke i mellemtiden (§9.2).
7. **Ukendt model eller manglende matrice-rækker** gør gatewayen `unavailable` i Admin og
   `blocked_policy` for et kald.

### 18.3 Tests

| Lag | Antal | Hvad |
|-----|-------|------|
| Enhedstests (vitest) | 213 i alt, heraf 46 nye | Parringsreglen (B-012) med typetest, fail-closed register, guardrails i kildekoden (kun `invokeModel` kalder modeller, ingen klientimport af gatewayen), pipelinen med falske afhængigheder (svar, alle afvisninger, gating, matrice, minimering, redaction, gen-identifikation, kontraktbrud, logning) og redaction-korpus |
| pgTAP | 302 i alt, heraf 64 nye (`ai_gateway.test.sql`) | Matricen (fail-closed, audit med hvem, hvad og hvornår, ingen direkte skrivning), gating-tabellerne, loggen (én vej ind, egne rækker, sagsbundet indhold, videnshuller, append-only, sletning med sagen) og administratorlæsning (slået fra, permission, audit, intet bruger- eller sags-id) |
| Integration og rute | 107 i alt, heraf 10 nye | Gatewayen mod den rigtige database som rådgiver og administrator: svar gennem retrieval, utilstrækkeligt uden tildeling, privat log, sagsbundet kald uden virksomhedsnavn hos modellen, gating læst fra databasen, matricen i databasen. Copilot i den kørende app og gatewayen nægtet med `IPA_RUNTIME_ENV=production` |

**Mutationstests** (testriggen, ikke i repoet), samme standard som fase 7:

- **Kode, 25 af 25 fanget:** parringsreglen (fire mekanismer og typen), registret, `runtimeEnv`,
  stubbens grad og frysning, gating (Assessment, rollespil, ulæselig tilstand), matricen
  (manglende række, `audit_access`, profilens indsnævring), redaction (CPR, kendte navne, CVR
  uden kontekst), kontrakterne, B-016-afbildningen, logningsfejl, evidenskravet og minimering.
- **Database, 14 af 14 fanget:** matricens audit, constraint, permission og direkte skrivning,
  administratorlæsningens kontakt og audit, RLS på indhold og metadata, sagsbinding i
  `record_call`, videnshul med tekst, append-only, aflevering af andres forsøg, gating-funktionen
  og direkte skrivning af forsøg.
- Fase 7's 20 guardrail-mutationer er kørt igen og fanges stadig.

### 18.4 Kendte begrænsninger

- **Prompterne er udkast og ikke validerede** (§4.2). Evalueringssættet og -infrastrukturen
  hører til 8B. Valideringen af Copilot-prompterne mod en rigtig model hører til 8C.
- **Redaction er regelbaseret** (§7.2): navne og adresser i fri tekst og policenumre findes ikke.
  Det er en forudsætning, før kundedata kan tillades (`docs/roadmap.md`, 8B).
- **Practice-replikker kan ikke kontrolleres maskinelt** for produktfakta (§4.3).
- **Ingen rate limiting** (Q-3) og ingen samtalelagring (Q-5). Begge er placeret i 8C
  (`docs/roadmap.md`).
- **Ingen retentionsmekanisme:** hverken politik pr. datakategori, perioder eller sletningsjob.
  Kun sletning sammen med kundesagen (§11.4). Placeret i 8C.
- **Evidensen er udviklingsgrad.** Copilots svar er stubbens citater af test-embedderens
  nærmeste naboer. De viser mekanikken, ikke svarkvaliteten.
- **Demoen** svarer kun på eksempelspørgsmålene med faste mock-svar.

