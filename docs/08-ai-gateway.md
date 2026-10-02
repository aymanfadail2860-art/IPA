# 08 — AI Gateway

**Fase:** 8 — AI Gateway
**Status:** 📝 **Specifikation — afventer godkendelse.** Intet er implementeret.
**Sprog:** Dansk (kode på engelsk, brugerflade på dansk)
**Bygger på:** `docs/01`–`docs/07` (låst) og `docs/decisions.md` (B-011).

Dokumentet er implementeringsspecifikationen for fase 8. Det konkretiserer `docs/03` §9 (AI
Gateway), §5 flow A og C, §7 (retrieval-profiler), §11 (privacy) og §13 (observability).
Arkitekturen fra `docs/03` ændres ikke. Hvor specifikationen fortolker eller udbygger et låst
dokument, er det markeret **(udledt)**. Modstrid med låste dokumenter er **ikke** løst her. De
står i §15 og kræver en beslutning. Åbne spørgsmål står i §16.

Gatewayen er det lag, der afgør, hvilke data der forlader platformen. Derfor skal
specifikationen godkendes, før der implementeres.

---

## 0. Formål og afgrænsning

Fase 8 bygger politiklaget mellem applikationen og AI-modeller (`docs/03` §1 pkt. 7, §9).
Laget skal bygges uanset hvilken udbyder der vælges senere. Det testes uden en udbyder.

**Der kaldes ingen rigtig AI-model i fase 8.** Den eneste model er en stub-model (§3) efter
samme mønster som test-embedderen fra fase 7: udviklingsgrad, fail-closed, og den kan ikke
konstrueres uden for `local` og `test`.

| Bygges i fase 8 | Bygges ikke i fase 8 |
|-----------------|----------------------|
| Gatewayens ene indgang og dens trin (§1) | Adapter til Claude API eller anden ekstern model |
| Stub-model og fail-closed modelregister (§3) | Valg af embedding- og reranking-udbyder (fase 9) |
| Fem workflow-profiler med prompt, handlinger og output-kontrakt (§4) | Learn AI, Practice AI, Advise AI og Assessment AI som moduler med brugerflade |
| Datakategori-matricen som data (§5) | Samtalelagring og -historik (`ai.conversations`, `messages`), se §16 Q-5 |
| Dataminimering (§6) og redaction (§7) | Citations-tabellen og videnshuller (kræver rigtige svar) |
| Permission-tjek i gatewayen (§8) | Endelig compliancebeslutning om kundedata (`docs/03` §17 pkt. 4) |
| Server-side gating under Assessment og AI-rollespil (§9) | Assessment og Practice som moduler |
| Logning af kald, kilder og indhold (§11) | Retentionsperioder (`docs/03` §17 pkt. 5) — kun mekanismen |
| Copilot-brugerfladen koblet på gatewayen lokalt, mock-svar i demoen (§13) | Omkostningsstyring (ingen omkostning med stub) |

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
 → 5. Rate limiting              §10
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
trin kører. Især når intet afvist kald frem til modellen. Logningen (trin 14) sker altid.

**`AiOutcome`** er eksplicit, ligesom `RetrievalOutcome` i fase 7 (B-007):

| `kind` | Betydning | Vises som (`docs/04` §16) |
|--------|-----------|---------------------------|
| `answer` | Svar, der har bestået output-kontrakten | Svar |
| `insufficient` | Retrieval gav ingen evidens; modellen blev ikke kaldt | "Der findes ikke tilstrækkelig dokumentation" |
| `locked` | Gating: aktiv Assessment eller AI-rollespil | Låst tilstand (`docs/04` §15.3) |
| `denied` | Manglende adgang | Adgangsfejl |
| `blocked_policy` | Matricen tillader ikke en nødvendig datakategori | Fejl med forklaring, ikke "utilstrækkeligt" |
| `rate_limited` | For mange kald | Fejl med forklaring |
| `contract_violation` | Modellens svar brød output-kontrakten og vises ikke | Systemfejl (§16 Q-4) |
| `unavailable` | Gatewayen, modellen eller retrieval kan ikke køre | Systemfejl |

En systemfejl og "utilstrækkeligt grundlag" kan aldrig se ens ud. Afbildningen ligger ét sted,
som `presentRetrieval` i fase 7.

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
(`docs/03` §2, låst). Adapteren til den bygges ikke i fase 8.

### 3.2 Stub-modellen

| Egenskab | Specifikation |
|----------|---------------|
| **Grad** | `development`, sat af implementeringen og frosset (`Object.freeze`) som test-embedderen |
| **Fail-closed** | Registret konstruerer den kun, når `IPA_RUNTIME_ENV` udtrykkeligt er `local` eller `test`. Mangler variablen, eller har den en anden værdi, nægtes konstruktionen ved opstart. Gatewayen er så `unavailable` (§12) |
| **Adfærd** | Deterministisk. Den bygger et svar, der opfylder profilens output-kontrakt, alene ud fra de dele, den modtager. For Copilot: højst tre afsnit, hvert et kort uddrag af et evidenselement med kildemarkør. Konflikt i evidensen giver svartypen "modstridende kilder". Historisk evidens giver historisk markering |
| **Markering** | Hvert svar bærer `grade: "development"`. Brugerfladen viser "Udviklingssvar — ingen AI-model" (§13) |
| **Ingen viden** | Stubben tilføjer intet indhold, den ikke har fået. Derfor kan tests fastslå præcis, hvad der nåede frem til "modellen" |
| **Testvarianter** | Kun tests kan konstruere varianter, der bryder kontrakten, fejler eller timer ud. De kan ikke vælges via konfiguration eller miljøvariabler |

### 3.3 Grad på svaret

Svarets grad er `production`, kun hvis både modellen og evidensen er `production`
(`combinedGrade` fra fase 7). **En production-model kræver `ProductionEvidenceSet`**, og
typesystemet håndhæver det. Stub-modellen accepterer udviklingsevidens. Den regel går ud over
`docs/07` §9.1 pkt. 4 — se **K-1** i §15.

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

| Profil | Handlinger i fase 8 | Retrieval | Evidens kræves | Særligt |
|--------|---------------------|-----------|----------------|---------|
| **Copilot** | `answer_question` | Præcis; alle tilladte typer; gældende, historisk på anmodning | Ja | Strengest grounding. Låst under Assessment og AI-rollespil |
| **Learn** | `explain` | Bred; produktbeskrivelser, vejledninger, materiale; gældende | Ja | Eksempler må være opdigtede og markeres som det. Produktfakta i dem kræver citation |
| **Practice** | `roleplay_turn`, `feedback` | Scenariebundet; produktdata; gældende | Kun `feedback` | Må opfinde en fiktiv kunde, ikke produktfakta. Ingen Copilot-adgang under rollespil |
| **Advise** | `suggest` | Case-bundet; betingelser, acceptregler, forretningsgange; gældende på casens dato | Ja | Alt fagligt bærer citation. Svar har status **AI-genereret forslag** og skrives ikke ind i sagen i fase 8 |
| **Assessment** | `evaluate` | Facitgrundlag; gældende | Ja | Systemets egen brug. Kan ikke kaldes af en bruger under et aktivt forsøg. Kaldes ikke fra brugerfladen i fase 8 |

Kun Copilot får en brugerflade i fase 8 (§13). De øvrige fire profiler bygges og testes
gennem gatewayen alene, så politikken er på plads, før modulerne bygges. Det er ikke
modulfunktionalitet.

**Prompterne er udkast.** De kan ikke valideres uden en rigtig model og et evalueringssæt
(fase 9). De markeres i koden som ikke-validerede, og profilversionen hæves, når en prompt
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

**Ved brud vises svaret ikke.** Udfaldet er `contract_violation`. Det rå output logges (§11),
så bruddet kan undersøges. `docs/03` §9 siger "afvises eller markeres". Fase 8 vælger at
afvise, fordi det er det strengeste. Hvordan bruddet præsenteres, er §16 Q-4.

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
  fase 8.
- **`audit_access` er `deny` uden undtagelse.** Databasen afviser en række med en anden
  regel (check-constraint).
- Startværdier for stub-modellen: `knowledge` allow, `user_question` allow_redacted,
  `learning` allow, `training_fictional` allow, `customer_identifiable` deny, `audit_access`
  deny.
- Ændringer sker kun gennem en databasefunktion, der kræver `system.settings.manage`, og de
  auditeres i `audit.audit_log` (handling, før og efter — intet indhold). Der bygges ingen
  Admin-brugerflade til matricen i fase 8. **(udledt)**

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
- **Kundecase-kontekst:** Advise-profilens allowlist er **tom** i fase 8. Hvilke sagsfelter der
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
| Dokumentadgang | `retrieveEvidence` kører som brugeren (security invoker, grants fra `docs/07` §4). Gatewayen kan ikke udvide adgangen |
| Kundecase | Kun med `advise.case.read` og `advise.is_case_participant(case_id)`. En sag, man ikke har adgang til, svarer som "findes ikke" |
| Lærings- og træningskontekst | `learning.progress.read` og `practice.session.write`, scope `own` |
| Assessment-profilen | Kan ikke kaldes som brugerhandling i fase 8 |

**Der indføres ingen nye permissions.** At bruge Copilot kræver ingen særskilt permission:
Copilot er tilgængelig for alle roller (`docs/02` §10), og adgangen til indholdet styres af
dokumentadgangen. Se dog §16 Q-10 om adgang til loggen.

---

## 9. Gating — håndhævet på serveren

### 9.1 Regler

| Regel | Kilde | Låser |
|-------|-------|-------|
| **G1** Aktivt Assessment-forsøg | KRAV-ASS-001, `docs/02` §5, `docs/03` §5 flow C og §9 | Al brugerrettet AI: Copilot, Learn, Practice og Advise **(udledt** af `docs/03` §9, "Ingen brugerrettet AI under aktivt forsøg", og `docs/04` §11, "Copilot og AI-hjælp er slået fra"**)** |
| **G2** Aktivt AI-rollespil | `docs/02` §5, `docs/03` §9 | Copilot. Practice-profilens egne handlinger i samme session er tilladt. Om Learn og Advise også låses: §16 Q-1 |

- Gatingen gælder **brugeren**, ikke fanen eller enheden. Et kald fra en anden fane eller
  enhed afvises også.
- Tilstanden læses fra databasen ved hvert kald. **Kan den ikke læses, afvises kaldet som
  systemfejl** (fail-closed). Det vises aldrig som "utilstrækkeligt grundlag".
- Efter afslutning ophæves låsen straks (`docs/02` §5). Copilot skifter rolle til
  efterbehandler.
- Brugerfladen forklarer låsen (`docs/04` §15.3). Låsen bestemmes ikke i brugerfladen.

### 9.2 Tilstanden

`docs/03` §4 lægger sessionstilstanden i `assessment.assessment_attempts` og
`practice.roleplay_sessions` ("Session-tilstand afgør AI-gating"). Ingen af domænerne findes
endnu. Forslaget til, hvordan tilstanden kan findes i fase 8, er **K-2** i §15.

Uanset løsning gælder (udledt):

- Gatewayen læser tilstanden gennem én funktion, `ai.my_gating_state()`, der kun returnerer
  den aktuelle brugers tilstand (`assessment_active`, `roleplay_active`).
- En bruger kan ikke selv ophæve et aktivt Assessment-forsøg. Forsøget ophører kun ved
  aflevering eller ved udløb af en tidsgrænse.
- Hvad der sker med et forladt forsøg uden tidsgrænse og med et forladt rollespil, er
  **[AFKLARES]** (§16 Q-2).

---

## 10. Rate limiting

`docs/03` §9 placerer rate limiting i gatewayen, og `docs/07` §14 siger, at den "kommer med"
gatewayen. Opgaven nævner den ikke. Forslag: en enkel grænse pr. bruger pr. minut og pr. døgn,
talt i kaldsloggen, med tallene som konfiguration. Se §16 Q-3.

---

## 11. Logning

Hvad blev sendt, hvad kom retur, hvilke kilder, hvor lang tid, hvilke fejl (`docs/03` §9,
§13). Loggen ligger i skemaet `ai` og holdes adskilt fra `audit`, som kun registrerer
handlinger (`docs/07` §13).

### 11.1 Tabeller (udledt)

| Tabel | Indhold | Indeholder kundedata? |
|-------|---------|------------------------|
| `ai.gateway_calls` | Én række pr. kald, også afviste: bruger, profil og version, handling, model (id, version, grad), evidensens grad, svarets grad, udfald (`AiOutcome.kind`), årsagskode, `case_id` (valgfri), tid pr. trin i ms, fejlkode, optælling af redaction pr. type, antal fjernede felter, tidspunkt | Nej. Ingen fritekst |
| `ai.gateway_call_sources` | Pr. evidenselement: `evidenceId`, chunk, dokumentversion, score, om det blev sendt, om det blev citeret | Nej |
| `ai.gateway_payloads` | Det, der blev sendt (efter minimering og redaction, præcis som modellen fik det), og modellens rå svar før validering | **Ja.** Behandles som kundedata (`docs/03` §11) |

### 11.2 Regler

- **Den oprindelige, uredigerede tekst logges ikke**, og pladsholderkoblingen logges ikke
  (§7.3). "Hvad blev sendt" er den redigerede version.
- **Append-only.** Rækkerne skrives kun gennem én databasefunktion (`ai.record_call`, security
  definer), der kun skriver for den aktuelle bruger. De kan ikke rettes, kun slettes af
  retention.
- **Adgang (RLS):** En bruger læser egne rækker ("AI-samtaledata: Egen", `docs/03` §11).
  Ingen rolle læser andres indhold, heller ikke administratoren. Se **K-3** i §15.
- **Retention:** `gateway_payloads` og `gateway_calls` har hver sin politik
  (`docs/03` §11: "AI-samtaler", "Retrieval-logs"). Et kald med `case_id` følger sagens
  politik og slettes med sagen. Perioderne er **[AFKLARES]**, og de skal fastlægges før
  produktion (`docs/03` §17 pkt. 5). I fase 8 bygges mekanismen. Uden en fastsat periode
  slettes intet automatisk, hvilket kun er forsvarligt, fordi fase 8 kun kører på fiktive data.
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

## 13. Copilot-brugerfladen i fase 8

| Miljø | Hvad sker der |
|-------|---------------|
| **Lokalt og i test, med database** | Copilot (hovedområde og globalt panel) sender spørgsmålet via en server action til `runAiRequest` med Copilot-profilen. Svaret vises med de eksisterende komponenter: svar med kildemarkører, grundlagslinje, kildekort (med `leadIn`), konflikt- og historisk markering. Et banner viser "Udviklingssvar — ingen AI-model". "Utilstrækkeligt grundlag" og låst tilstand kommer fra gatewayens udfald. Gating kan sættes til og fra med et markeret udviklingsværktøj (kun `local`/`test`, som B-009) |
| **Vercel-demoen uden database** | Gatewayen kan ikke køre: ingen database, og stubben nægtes uden for `local`/`test`. Copilot viser i stedet realistiske mock-svar med kildekomponenter fra `src/mocks/`, tydeligt markeret som mock, så brugerfladen kan vurderes. Et nyt spørgsmål besvares med et fast mock-svar, ikke af en model. Den låste tilstand kan ses gennem demoens udviklingsvælger. Se §16 Q-6 |

Mock-svar og stub-svar blandes aldrig: i et miljø med database vises ingen mock-samtaler.
Historiklisten viser en tom tilstand, fordi samtaler ikke gemmes i fase 8 (§16 Q-5).

---

## 14. Tests

| Område | Konkrete tests |
|--------|----------------|
| **Stub fail-closed** | Registret nægter at konstruere stubben, når `IPA_RUNTIME_ENV` mangler, er `production` eller ukendt. Graden kan ikke ændres (frosset). Gatewayen er `unavailable` i production |
| **Grad** | Stub-svar har altid `grade: "development"`. En production-model afviser `EvidenceSet` uden brand (typetest). Det gælder dog først, når K-1 er afgjort |
| **Eneste vej** | Ingen fil uden for `src/lib/ai/` importerer modeladaptere eller registret. Ingen klientkomponent importerer `src/lib/ai/` |
| **Redaction** | Korpus af positive og negative eksempler pr. type, herunder at beløb, "§ 4.2", datoer og 8-cifrede tal uden "CVR" ikke rammes. Stubben registrerer det modtagne: ingen CPR, CVR, e-mail, telefon, konto eller kendt navn når frem. Pladsholdere er konsistente inden for ét kald. Gen-identifikation sker kun i svaret til brugeren |
| **Matrice** | Manglende række giver `deny`. `customer_identifiable` blokerer kaldet (`blocked_policy`), og stubben kaldes ikke. `audit_access` kan ikke sættes til andet end `deny` (constraint). Ændring kræver `system.settings.manage` og auditeres. Profilen kan snævre ind, ikke udvide |
| **Minimering** | Felter uden for allowlisten når ikke frem. Grænser for antal og længde håndhæves. Brugerens navn, e-mail og id når aldrig frem |
| **Permissions** | Deaktiveret bruger afvises. Sag uden deltagelse giver "findes ikke". Evidens følger dokumentadgang (rådgiver A ser ikke dokument Y via gatewayen). Assessment-profilen kan ikke kaldes som bruger |
| **Gating** | Med aktivt forsøg: alle brugerrettede profiler giver `locked`, og stubben kaldes ikke, også fra en anden session for samme bruger. Med aktivt rollespil: Copilot `locked`, rollespillets egen Practice-handling tilladt. Efter afslutning: tilgængelig straks. Ulæselig tilstand giver systemfejl, aldrig `insufficient` |
| **Evidenskrav** | Tom evidens giver `insufficient`, og stubben kaldes ikke |
| **Output-kontrakt** | Testvarianter af stubben: afsnit uden markør, markør til ukendt evidens-id, manglende historisk markering, konflikt uden `kind = conflict` giver alle `contract_violation`, og intet vises |
| **Logning** | Hvert kald, også afviste, giver præcis én række i `gateway_calls`. Payload er den redigerede version. Den oprindelige tekst findes ingen steder i databasen bagefter. Brugere kan kun læse egne rækker. Rækker kan ikke opdateres. `audit` indeholder intet indhold |
| **Udfald** | `presentAi` afbilder `unavailable` og `contract_violation` til fejl, aldrig til "utilstrækkeligt" (som B-007) |
| **Mutationstests** | Svækket matrice, fjernet gating-tjek, fjernet redaction-type, fjernet RLS-politik på loggen skal hver især få tests til at fejle |
| **Rutetests** | Copilot lokalt: svar med kildekort og udviklingsbanner. Låst tilstand. Demoen uden database viser mock-svar og kalder ikke gatewayen |

Fasen er færdig, når lint, typecheck, build, enhedstests, pgTAP, integrationstests og
rutetests består.

---

## 15. Modstrid med låste dokumenter — kræver beslutning

**K-1 — Gatewayen og udviklingsevidens (`docs/07` §9.1 pkt. 4).**
`docs/07` siger: "Senere AI-moduler og AI Gateway må kun tage imod `ProductionEvidenceSet`."
Production-evidens kræver en rigtig embedder og reranker (fase 9). Hvis reglen gælder
ordret, kan gatewayen ikke køre en eneste forespørgsel med evidens i fase 8, og Copilot kan
ikke kobles på. Forslag: Reglen præciseres til "en **production-model** må kun tage imod
`ProductionEvidenceSet`". Stub-modellen (udviklingsgrad, kun `local`/`test`) må tage imod
udviklingsevidens, og svaret bliver da altid `development`. Beskyttelsen fra `docs/07` §9.1
består: intet i production kan bruge udviklingsevidens, fordi stubben ikke kan konstrueres
der. Det kræver, at `docs/07` §9.1 genåbnes for den ene sætning.

**K-2 — Gating-tilstanden findes ikke endnu (`docs/03` §4, CLAUDE.md §2 regel 2).**
Gatingen skal læse `assessment_attempts` og `roleplay_sessions`, men domænerne `assessment`
og `practice` bygges i senere faser, og senere fasers funktionalitet må ikke bygges forud.
Muligheder:
- **(a) Anbefalet:** Fase 8 opretter de to tabeller med kun tilstandsfelter (id, bruger,
  status, start, slut og tidsgrænse) i deres rigtige domæner. Senere faser udbygger dem. Én
  sandhed, som `docs/03` foreskriver. Indtil da sættes tilstanden kun af udviklingsværktøjet og
  af tests.
- **(b)** En særskilt låsetabel i `ai`. Fravalgt: den bliver en anden sandhed om, hvorvidt et
  forsøg er aktivt, og den skal holdes i sync, når Assessment bygges (`docs/03` §4, "Ét
  domæne ejer et begreb").
- **(c)** Gatingen bygges uden datakilde og testes kun med stubbet tilstand. Fravalgt: så er
  håndhævelsen ikke verificeret mod databasen.

**K-3 — Adgang til loggen (`docs/03` §11 vs. §13).**
`docs/03` §11 giver AI-samtaledata adgangen "Egen". `docs/03` §13 forudsætter, at nogen kan
analysere "hvorfor svarede systemet, som det gjorde?". Fase 8 kan følge §11 fuldt ud (kun
egne rækker). Så kan ingen ud over brugeren selv gennemgå et kald. Det er forsvarligt med
fiktive data, men skal afgøres før produktion: hvem må se metadata (uden indhold), og hvem, om
nogen, må se indhold? Et svar, der giver nogen adgang, kræver en ny permission i kataloget
(`docs/03` §17 pkt. 6). Se §16 Q-10.

---

## 16. Åbne spørgsmål

| # | Spørgsmål | Blokerer |
|---|-----------|----------|
| Q-1 | Låses Learn og Advise også under et aktivt AI-rollespil, eller kun Copilot? `docs/02` nævner kun Copilot. Princippet ("assistance sat på pause") taler for alle | Implementering af G2 |
| Q-2 | Hvornår ophører et forladt Assessment-forsøg uden tidsgrænse og et forladt rollespil? Forslag: et rollespil udløber efter en konfigurerbar inaktivitet. Et forsøg uden tidsgrænse forbliver aktivt, til det afleveres eller afbrydes af en administrator | Nej, kan afgøres med modulerne. Fase 8 kræver eksplicit afslutning |
| Q-3 | Skal rate limiting med i fase 8 (§10)? | Nej |
| Q-4 | Hvordan vises `contract_violation`? `docs/04` §8.3 definerer ikke tilstanden. Forslag: som systemfejl, "Svaret kunne ikke kontrolleres mod kilderne og vises derfor ikke", med "Prøv igen" | Copilot-brugerfladen |
| Q-5 | Gemmes Copilot-samtaler i fase 8 (`ai.conversations`, `messages`)? Forslag: nej. Samtalelagring arver kundecasens regler (`docs/03` §11) og hører til Copilot-modulet. Fase 8 er én tur ad gangen | Nej |
| Q-6 | Er faste mock-svar i Vercel-demoen nok til at vurdere Copilot, eller skal flere svartyper (konflikt, historisk, utilstrækkeligt, låst) kunne vælges direkte i demoen? | Nej |
| Q-7 | Skal kravet om EU-region og databehandleraftale (fase 9) også gælde for generering med Claude API? Det påvirker ikke fase 8, men det bør stå i fase 9 | Nej |
| Q-8 | Har policenumre et kendt format, der kan genkendes? | Nej. Restrisiko indtil da |
| Q-9 | Bekræft, at matricen ligger i databasen uden Admin-brugerflade i fase 8, og at profilerne ligger i repoet | Implementering |
| Q-10 | Hvem må læse kaldsloggen ud over brugeren selv (K-3)? | Produktion, ikke fase 8 |

---

## 17. Implementeringsrækkefølge (når specifikationen er godkendt)

1. Skemaet `ai`: matricen, kaldsloggen, `record_call`, RLS og pgTAP.
2. Model-interface, fail-closed register og stub-model med guardrail-tests.
3. Profiler og output-kontrakter med validering.
4. Klassificering, minimering og redaction med testkorpus.
5. Gating-tilstand efter beslutningen om K-2, samt `my_gating_state()`.
6. `runAiRequest` med alle trin, udfald, tilgængelighed og logning.
7. Copilot-brugerfladen lokalt og mock-svar i demoen.
8. Integrations-, rute- og mutationstests. Opdatering af dokumentet og roadmap.
