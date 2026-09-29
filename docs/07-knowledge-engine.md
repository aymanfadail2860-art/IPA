# 07 — Knowledge Engine

**Fase:** 7 — Knowledge Engine
**Status:** DRAFT — afventer godkendelse. Intet i dokumentet er implementeret.
**Sprog:** Dansk (kode på engelsk, brugerflade på dansk)
**Bygger på:** `docs/01`–`docs/06` (låst) og `docs/decisions.md`.

Dokumentet er implementeringsspecifikationen for fase 7. Det konkretiserer `docs/03` §4, §6–8
og §12 til en datamodel, en livscyklus, en pipeline og et retrieval-lag, der kan bygges og
testes. Arkitekturen fra `docs/03` ændres ikke. Hvor forslaget fortolker eller udbygger et
låst dokument, er det markeret som **(udledt)**. Konflikter med låste dokumenter står i §19,
og beslutninger til godkendelse står i §17.

---

## 0. Formål og afgrænsning

Fase 7 bygger platformens autoritative videnslag. Det omfatter dokumenter, versioner,
behandling, menneskelig godkendelse, publicering, adgang pr. dokument, retrieval og et
standardiseret evidensformat. Copilot, Learn, Practice og Advise skal senere bruge det.

```
Dokument → Klassificering → Version → Behandling → Tekstudtræk → Chunking → Embeddings
        → Review → Menneskelig godkendelse → Publicering → Retrieval → Evidens → Kildehenvisning
```

**Grundregel (`docs/03` §1 pkt. 4):** Hverken upload eller gennemført behandling gør en
dokumentversion autoritativ. Kun en eksplicit menneskelig godkendelse, foretaget af en bruger
med `knowledge.version.publish`, kan det. Reglen håndhæves i databasen. Det er ikke nok, at
brugerfladen skjuler en knap.

Fase 7 slutter ved **evidens**. Evidens er strukturerede, adgangsfiltrerede og
kildebærende tekstuddrag. Hvordan en AI-model bruger evidensen, bygges i en senere fase
(§16).

---

## 1. Datamodel

### 1.1 Genbrug fra fase 6

| Eksisterende | Anvendelse i fase 7 | Ændres? |
|--------------|---------------------|---------|
| `identity.users` | `uploaded_by`, `approved_by`, `granted_by` m.fl. | Nej |
| `identity.teams`, `team_memberships` | Adgangstildelinger til et team (§4) | Nej |
| `identity.permissions` / `role_permissions` | De fire `knowledge.*`-permissions og `system.settings.manage` findes allerede | Nej. **Ingen nye permissions** |
| `identity.has_permission()`, `current_user_id()` | Autorisation i RLS og funktioner | Nej |
| `identity.leader_scopes` | **Bruges ikke** til viden. Lederscope giver indsigt i mennesker, ikke i indhold (`docs/01` §3, `docs/03` §10) | Nej |
| `audit.audit_log` | Knowledge-hændelser (§13) via en ny triggerfunktion i `knowledge` | Nej |

Der ændres ikke i nogen tabel eller funktion fra fase 6. Fase 7 tilføjer skemaet `knowledge`,
udvidelserne `vector` (pgvector) og `btree_gist` samt Storage-bucket'en `knowledge-originals`.

### 1.2 Entiteter i skemaet `knowledge`

Felterne nedenfor er dem, der er nødvendige i fase 7. Alle tabeller har `created_at` og, hvor
rækken kan ændres, `updated_at`.

**`products`** — forsikringsprodukt (`docs/03` §4)

| Felt | Bemærkning |
|------|------------|
| `id`, `name` | Navnet er unikt |
| `category` | Fritekst i fase 7. Kategorierne er ikke fastlagt **[AFKLARES]** |
| `status` | `active` / `retired`. Et udgået produkt kan ikke få nye dokumenter |

**`document_types`** — opslagstabel med de otte typer fra `docs/03` §6: `policy_text`
(policetekst), `terms` (betingelser), `product_description` (produktbeskrivelse),
`acceptance_rules` (acceptregler), `business_procedure` (forretningsgang), `guidance`
(vejledning), `sales_material` (salgsmateriale) og `internal_document` (internt fagligt
dokument). Der opfindes ikke flere typer.

**`sources`** — `id`, `name`, `type` (`manual_upload` | `connector`). Fase 7 opretter én
kilde: manuel upload. Konfigurationen for connectors kommer senere (`docs/03` §15).

**`documents`** — det logiske dokument, uden indhold (`docs/03` §12)

| Felt | Bemærkning |
|------|------------|
| `id`, `product_id`, `document_type`, `source_id` | |
| `title` | Menneskelæsbar titel |
| `external_ref` | Kildens egen identitet. Tom ved manuel upload; forberedt til connectors |
| `created_by` | |

**`document_versions`** — indholdet, gyldigheden og godkendelsen hører til versionen

| Felt | Bemærkning |
|------|------------|
| `id`, `document_id`, `version_label` | Versionsbetegnelsen er fritekst, f.eks. "3" eller "2025-07" |
| `language` | `da` i V1 (`docs/03` §6, multilingual-ready) |
| `valid_from` (påkrævet før godkendelse), `valid_to` (valgfri) | `date`, halvåbent interval `[valid_from, valid_to)`, dansk tid (§3.4) |
| `status` | Se §2 |
| `storage_path`, `checksum_sha256`, `byte_size`, `mime_type`, `page_count`, `original_filename` | Originalfilen. Stien er uuid-baseret; filnavnet er kun metadata |
| `uploaded_by`, `uploaded_at` | |
| `review_started_by`, `review_started_at` | |
| `approved_by`, `approved_at` | Den menneskelige godkendelse |
| `published_at` | Registreringstid (`recorded_at` i `docs/03` §12). Sættes i samme transaktion som godkendelsen |
| `superseded_by`, `superseded_at` | Efterfølgeren (§3.5) |
| `withdrawn_by`, `withdrawn_at`, `withdrawal_reason`, `withdrawal_category` | Deaktivering (§2.3) |
| `extractor_version`, `chunker_version` | Versionen af den behandlingskode, der frembragte chunks |

Constraint: **To publicerede, ikke-deaktiverede versioner af samme dokument og sprog må
aldrig have overlappende gyldighed.** Det håndhæves med en exclusion constraint over
`daterange(valid_from, valid_to)`. Dermed kan der på en given dato højst være én gyldig
version pr. dokument og sprog, og versioner blandes aldrig implicit (`docs/03` §12).

**`version_reviews`** — faglige afgørelser (domænedata, ikke audit): `version_id`,
`reviewer_id`, `decision` (`approved` | `rejected`), `reason` (påkrævet ved afvisning),
`quality_report_snapshot` og `decided_at`. En version kan afvises flere gange, før den
godkendes.

**`document_access_grants`** — adgang pr. dokument (§4). Udbygger `docs/03` §4's
konceptuelle felter (`document_id`, `permission_key`, `scope`) **(udledt)**:

| Felt | Bemærkning |
|------|------------|
| `document_id` | Tildelingen gælder dokumentet og dermed alle dets versioner |
| `permission_key` | `knowledge.document.read` eller `knowledge.document.read_historical` |
| `grantee_type` | `all_users` \| `team` \| `user` |
| `team_id`, `include_descendants` | Når `grantee_type = team` |
| `user_id` | Når `grantee_type = user` |
| `granted_by`, `granted_at` | |

**`ingestion_jobs`** — teknisk behandling, adskilt fra faglig godkendelse (`docs/03` §4, §8)

| Felt | Bemærkning |
|------|------------|
| `id`, `document_version_id`, `kind` | `kind`: `process` \| `reembed` |
| `status` | `queued` \| `running` \| `succeeded` \| `failed` \| `cancelled` |
| `current_step`, `step_state` (jsonb) | Checkpoint pr. trin, så et job genoptages ved det trin, der fejlede |
| `attempts`, `max_attempts`, `next_attempt_at` | Kontrolleret genforsøg |
| `locked_by`, `locked_until` | Lease: et job fra en worker, der er gået ned, frigives igen |
| `error_code`, `error_message` | Årsag i klartekst til Admin. Aldrig dokumentindhold |
| `quality_report` (jsonb) | §5.3 |

**`document_pages`** — normaliseret tekst pr. side: `version_id`, `page_number`, `text`,
`has_text_layer`. Grundlaget for sporbarhed og for strukturvisningen i review.

**`document_chunks`** — tekstsegmentet (`docs/03` §6)

| Felt | Bemærkning |
|------|------------|
| `id`, `document_version_id`, `chunk_index` | Rækkefølge inden for versionen, unik pr. version |
| `kind` | `prose` \| `list` \| `table` |
| `text` | Segmentets egen tekst, uden overskriftskæde |
| `heading`, `heading_path` (text[]) | Nærmeste overskrift og hele kæden, f.eks. `{"§4 Undtagelser","4.2 Forurening"}` |
| `section_number` | F.eks. `4.2`, når det kan genkendes |
| `page_start`, `page_end` | Chunks kan krydse en sidegrænse |
| `char_start`, `char_end` | Position i versionens normaliserede tekst |
| `overlap_chars` | Hvor meget af begyndelsen der er overlap fra forrige chunk (§6) |
| `content_hash`, `char_count`, `token_estimate` | Et eksakt tokenantal afhænger af modellen og beregnes ikke |
| `fts_da`, `fts_simple` | Genererede `tsvector`-kolonner til leksikalsk søgning (§8) |

Chunks er immutable. Sprog, produkt og gyldighed arves via versionen og kopieres ikke
(`docs/03` §4: "Krydsreferencer sker via id, ikke via kopier").

**`embedding_models`** — `id`, `provider`, `model_name`, `model_version`, `dimensions`,
`distance` (`cosine`), `languages`, `status` (`candidate` \| `active` \| `retired`),
`activated_at` og `retired_at`. Der er højst én `active` model ad gangen.

**`chunk_embeddings`** — `chunk_id`, `embedding_model_id`, `embedding` (`vector` uden fast
dimension), `language`, `input_hash` og `created_at`. Unik pr. (`chunk_id`,
`embedding_model_id`). Modelnavnet er dermed obligatorisk (`docs/03` §2).

**`conflicts`** og **`conflict_passages`** — §11.

**Retrieval-metadata** gemmes ikke i fase 7. Hændelser for retrieval (`retrieval_events`)
hører til domænet `ai` i `docs/03` §4 og bygges sammen med AI Gateway. Evidensformatet (§10)
bærer den metadata, som logningen senere skal skrive (§17, B-17).

### 1.3 Relationer

```
products 1─< documents >─1 document_types
sources  1─< documents
documents 1─< document_access_grants >─ identity.teams / identity.users
documents 1─< document_versions 1─< document_pages
                               1─< document_chunks 1─< chunk_embeddings >─1 embedding_models
                               1─< ingestion_jobs
                               1─< version_reviews
document_versions ─superseded_by→ document_versions
conflicts 1─< conflict_passages >─ document_chunks / document_versions
```

### 1.4 Hvad der bevidst ikke modelleres nu

Der bygges ikke tabeller til læringsforløb, `case_sources`, `citations`, `conversations`,
`retrieval_events` eller videnshuller. Det samme gælder connector-synkronisering. Hvor
modellen skal kunne bruges senere, bygges der fremadrettet kompatibelt med stabile id'er og
immutable chunks, uden at de senere tabeller bygges.

---

## 2. Dokumentlivscyklus

### 2.1 Statusser for en dokumentversion

| Status (kode) | Dansk label | Proces | Hvem/hvad sætter den |
|---------------|-------------|--------|----------------------|
| `uploaded` | Uploadet | Teknisk | Registrering af upload |
| `processing` | Behandles | Teknisk | Worker |
| `processing_failed` | Kunne ikke behandles | Teknisk | Worker (med årsag) |
| `processed` | Klar til review | Teknisk | Worker, når kvalitetsrapporten er klar |
| `under_review` | Under review **(udledt, ny label)** | Faglig | "Påbegynd review" (`knowledge.version.publish`) |
| `rejected` | Afvist | Faglig | "Afvis" med begrundelse (`knowledge.version.publish`) |
| `published` | Godkendt / Aktiv (§3.3) | Faglig | "Godkend som autoritativ" (`knowledge.version.publish`) |
| `withdrawn` | Deaktiveret | Faglig | "Deaktivér" med begrundelse (`knowledge.version.publish`) |
| `discarded` | Kasseret **(udledt)** | Administrativ | Kun for aldrig publicerede versioner (`knowledge.document.write`) |

"Erstattet" og "Historisk" er **afledte tilstande** af en publiceret version og ikke egne
statusser (§3.5). "Approved" er den menneskelige handling, som registreres med `approved_by`,
`approved_at` og en række i `version_reviews`. Publiceringen er systemets konsekvens af
handlingen og sker i samme transaktion (§19, K-1).

### 2.2 Overgange

```
 TEKNISK BEHANDLING (worker)                    ║  FAGLIG GODKENDELSE (menneske)
                                                ║
 uploaded ─→ processing ─→ processed ───────────╫─→ under_review ─→ published
                  │   ▲                         ║        │              │
                  ▼   │ genbehandl              ║        ▼              ├─→ withdrawn
         processing_failed                      ║    rejected           │
                  │                             ║     │   │   │         └─ (afledt) erstattet /
                  └──────────→ discarded ←──────╫─────┘   │   │            historisk
                                                ║         │   └─→ processed (metadata rettet)
                                                ║         └─→ processing (genbehandl)
```

| Fra → til | Handling | Betingelser |
|-----------|----------|-------------|
| — → `uploaded` | Upload registreres | `knowledge.document.write`; filen findes i Storage; job oprettes i samme transaktion |
| `uploaded` → `processing` | Worker tager jobbet | Automatisk |
| `processing` → `processed` | Alle trin lykkedes | Automatisk; kvalitetsrapport vedhæftet |
| `processing` → `processing_failed` | Et trin fejlede, og der er ikke flere forsøg tilbage | Automatisk; årsag synlig i Admin |
| `processing_failed` / `rejected` → `processing` | "Genbehandl" | `knowledge.document.write` |
| `processed` → `under_review` | "Påbegynd review" | `knowledge.version.publish`; låser versionens metadata |
| `under_review` → `processed` | "Afbryd review" | Samme reviewer eller anden med `knowledge.version.publish` |
| `under_review` → `published` | "Godkend som autoritativ" | §3.2 |
| `under_review` → `rejected` | "Afvis" | Begrundelse påkrævet |
| `rejected` → `processed` | Metadata rettet uden ny behandling | `knowledge.document.write` |
| `uploaded`/`processing_failed`/`processed`/`rejected` → `discarded` | "Kassér" | `knowledge.document.write`; aldrig publiceret |
| `published` → `withdrawn` | "Deaktivér" | `knowledge.version.publish`; begrundelse og kategori påkrævet |

Alle overgange sker gennem databasefunktioner, der kontrollerer permission og tilstand.
Klienten kan ikke opdatere `status` direkte (column-level grants, som i fase 6). Enhver
overgang auditeres (§13).

### 2.3 Særtilfælde

| Hændelse | Håndtering |
|----------|------------|
| **Fejl under behandling** | Trinnet genforsøges med backoff op til `max_attempts`. Derefter: `processing_failed` med årsag. Der indekseres aldrig delvist. Chunks og embeddings fra et fejlet forsøg er aldrig synlige for retrieval, fordi kun `published` versioner er det (`docs/03` §8) |
| **Delvist læst PDF** | Ulæselige sider registreres i kvalitetsrapporten ("8 af 10 sider behandlet", `docs/04` §14.3). Versionen når `processed`, men **godkendelse er blokeret**, så længe ikke alle sider er læst (§17, B-11) |
| **Afvist dokument** | `rejected` svarer til `docs/03` §12's "afvist → tilbage til kladde". Versionen er aldrig synlig for retrieval. Den kan rettes, genbehandles eller kasseres. Begrundelsen bevares i `version_reviews` |
| **Ny version** | Ny række i `document_versions` under samme dokument, med egen fil, egne chunks og egne embeddings. Den tidligere version er upåvirket, indtil den nye publiceres (§3.5) |
| **Dublet (checksum)** | Klienten beregner SHA-256 før upload og viser dialogen fra `docs/04` §14.3: ny version, erstat eller afvis. Workeren genberegner og verificerer checksummen, fordi klientens værdi ikke er til at stole på |
| **Tilbagetrækning** | `published` → `withdrawn`. Versionen fjernes straks fra al retrieval, også historisk. Den slettes ikke, fordi senere citations kan pege på den (`docs/03` §8) |
| **Historisk dokument** | En publiceret version, hvis `valid_to` er passeret, eller som er erstattet. Den findes kun ved eksplicit historisk opslag og med `knowledge.document.read_historical` (§3.4) |
| **Ugyldig version** | En publiceret version med faglig fejl deaktiveres med kategorien `invalid`. Den er derefter heller ikke historisk grundlag. En rettet version publiceres som ny version |
| **Konflikt mellem dokumenter** | Registreres og vises. Afgøres aldrig automatisk (§11) |
| **Publicerede chunks ændres ikke** | En publiceret versions chunks er frosne. Ny chunking af samme fil kræver en ny version og en ny godkendelse (§17, B-13). Re-embedding ved modelskifte er undtagelsen, fordi den tilføjer vektorer uden at ændre chunks (§7) |

---

## 3. Autoritativ viden

### 3.1 Hvornår en version er autoritativ

En dokumentversion er autoritativ viden, når alle fire betingelser er opfyldt:

1. `status = published`, dvs. godkendt af et menneske med `knowledge.version.publish`.
2. Den er ikke deaktiveret.
3. Den forespurgte dato ligger i `[valid_from, valid_to)`.
4. Den er den eneste sådanne version af dokumentet på sproget (sikret af constraint'en i §1.2).

### 3.2 Godkendelse

**Hvem:** En bruger med `knowledge.version.publish`. Efter kataloget fra fase 6 er det i dag
kun Administrator-rollen. Den fagligt ansvarlige er derfor en bruger med denne permission. Der
indføres ingen ny rolle (`docs/03` §10).

**Handlingen "Godkend som autoritativ"** (`docs/04` §14.2) kører i én transaktion.
Funktionen kontrollerer:

| Kontrol | Konsekvens ved fejl |
|---------|---------------------|
| Status er `under_review` | Afvises |
| Obligatorisk metadata er udfyldt: produkt, type, titel, versionsbetegnelse, `valid_from`, sprog (`docs/03` §8) | Afvises med forklaring. Knappen er deaktiveret i UI |
| Alle sider er læst | Afvises (§17, B-11) |
| Der findes embeddings for alle chunks med den aktive embedding-model | Afvises. Ellers ville versionen være "publiceret", men usynlig for vektorsøgning |
| Gyldigheden kan indpasses uden overlap (§3.5) | Afvises med forklaring |
| Kvalitetsadvarsler | **Blokerer ikke.** De vises igen i bekræftelsesdialogen (`docs/04` §14.2), og mennesket afgør |

Ved godkendelse skrives `approved_by`, `approved_at`, `published_at = now()` og en række i
`version_reviews`. En eventuel forgænger håndteres som beskrevet i §3.5, og der skrives
auditering.

**Fire øjne:** Det kræves ikke i fase 7, at den der uploader, er en anden end den der
godkender. Begge registreres, så reglen kan indføres senere uden datamodelændring (§17, B-10).

### 3.3 Hvad "publiceret" betyder

Publiceret betyder, at versionen er optaget i vidensgrundlaget. Den kan dermed findes af
retrieval på de datoer, hvor den er gyldig, for de brugere, der har adgang. Publicering er
ikke det samme som at være gældende i dag:

| Afledt tilstand | Betingelse | Dansk label (UI) |
|-----------------|------------|------------------|
| Fremtidig | `published` og `valid_from > i dag` | **Godkendt** — "Gældende fra [dato]" |
| Gældende | `published` og i dag ∈ `[valid_from, valid_to)` | **Aktiv** / "Gældende" |
| Historisk | `published` og `valid_to <= i dag` | **Historisk** — "Gjaldt [periode]" |
| Erstattet | `superseded_by` er sat (kan samtidig være gældende indtil efterfølgerens `valid_from`) | **Erstattet** af v[n] |

Det svarer til kæden "Godkendt → Aktiv" i `docs/04` §14.1 og til statusvarianterne for
kildekortet i `docs/04` §17.2.

### 3.4 Gældende og historisk viden

- **Gyldighedstid** (`valid_from`/`valid_to`) og **registreringstid** (`published_at`,
  `withdrawn_at`) er to akser (`docs/03` §12).
- Datoer er kalenderdatoer i dansk tid (Europe/Copenhagen). "I dag" beregnes i databasen i
  den tidszone, så en betingelse med virkning fra 1. januar gælder fra dansk midnat.
- `valid_to` er eksklusiv. v2 `[2024-01-01, 2025-07-01)` og v3 `[2025-07-01, ∞)` ligger op ad
  hinanden uden overlap og uden hul.

| Retrieval-tilstand | Filter | Kræver |
|--------------------|--------|--------|
| `current` (standard) | `published`, ikke deaktiveret, i dag ∈ gyldighed | `knowledge.document.read` (effektiv, §4) |
| `as_of` (dato D) | Samme, med D i stedet for i dag | For D < i dag, hvor versionen ikke er gældende i dag: `knowledge.document.read_historical`. For D ≥ i dag: `knowledge.document.read` |

Evidens fra `as_of` markeres altid med `temporal_status` (`current` \| `historical` \|
`future`). Et historisk resultat uden markering er et forkert resultat (`docs/03` §12).

En tredje tilstand, "hvad vidste systemet på tidspunkt T" (`published_at <= T` og ikke
deaktiveret før T), understøttes af datamodellen. Den bygges ikke i fase 7 (§17, B-27).

### 3.5 Nye og fremtidige versioner

Når en ny version N med `valid_from = F` publiceres, sker følgende:

1. Findes en publiceret forgænger P af samme dokument og sprog, hvis gyldighed dækker F, og
   hvor `P.valid_from < F`, afkortes `P.valid_to` til F. Samtidig sættes `P.superseded_by = N`
   og `P.superseded_at = now()`. P forbliver `published` og er gældende frem til F.
2. Ville N overlappe en publiceret version på anden vis, fx fordi F ≤ `P.valid_from` eller
   fordi en senere version allerede er publiceret, afvises godkendelsen med en forklaring.
   Administratoren må justere datoerne eller deaktivere den fejlagtige version. Systemet
   ændrer aldrig selv gyldigheden i andre tilfælde end pkt. 1.
3. **Fremtidige versioner** (F > i dag) publiceres straks. De indgår ikke i `current`, men
   findes ved `as_of` på en dato ≥ F. Det bruges senere af Advise, fordi retrieval der sker
   "gældende på casens dato" (`docs/03` §7). Der er intet planlagt job, der skal "aktivere" en
   version på en dato. Det temporale filter gør det.
4. **Tilbagevirkende versioner** (F < i dag) er tilladt. `published_at` viser, hvornår
   systemet fik kendskab til versionen.
5. Opstår der et hul (dage uden gyldig version), vises det som advarsel i kvalitetsrapporten
   og i Versioner-tidslinjen.

"Erstattet" er således en afledt markering og ikke en status, der skifter på et bestemt
tidspunkt. Det fortolker `docs/03` §8 ("gammel sættes til erstattet med `superseded_by`") på
en måde, der også virker for fremtidige versioner (§17, B-06).

---

## 4. Dokumentadgang

### 4.1 Model

Beslutning 3 fra fase 6 gælder: Rådgivere og ledere får adgang til viden **pr. dokument**,
aldrig gennem rollen.

**Effektiv læseadgang** for bruger U til en publiceret version af dokument D (tilstand
`current`, eller `as_of` med en dato fra i dag og frem) findes, når ét af følgende gælder:

- U har `knowledge.document.read` med scope `all` gennem en rolle (i dag Administrator), eller
- der findes en `document_access_grants`-række for D med `permission_key =
  knowledge.document.read`, og U matcher modtageren:
  - `all_users`: alle aktive platformbrugere
  - `team`: U er medlem af teamet, eller af et underteam, hvis `include_descendants` er sat
  - `user`: U er brugeren

**Historisk adgang** kræver det samme med `knowledge.document.read_historical`.
Historisk adgang forudsætter ikke læseadgang og omvendt. De tildeles hver for sig.

Adgangen gælder dokumentet og dermed alle dets versioner. Inaktive brugere har ingen adgang
(som i fase 6). **Upublicerede versioner, sider, kvalitetsrapporter og jobs** kan kun ses af
brugere med `knowledge.document.write` eller `knowledge.version.publish`.

Et nyt dokument har ingen tildelinger og kan derfor kun findes af administratorer.
Kvalitetsrapporten advarer, hvis et dokument godkendes uden tildelinger.

### 4.2 Hvem administrerer adgang

Tildelinger oprettes og fjernes af brugere med `knowledge.document.write`. Det er den eneste
eksisterende permission, der dækker forvaltning af dokumenter. Der opfindes ikke en ny
(§17, B-09). Alle ændringer auditeres.

### 4.3 Samspil med RBAC og teams

| Mekanisme | Betydning for viden |
|-----------|---------------------|
| Rolle → `role_permissions` | Kun Administrator har `knowledge.*` med scope `all`. Rådgiver og Leder har ingen `knowledge.*` i rollen (fase 6-katalog) |
| `document_access_grants` | Rådgiveres og lederes eneste vej til viden |
| `team_memberships` | Afgør, om en bruger matcher en teamtildeling. Flere medlemskaber tæller hver for sig |
| `teams.parent_team_id` | Anvendes ved `include_descendants` |
| `leader_scopes` | **Ingen betydning.** At lede et team giver ikke adgang til dokumenter, der er tildelt teamet. Kun medlemskab gør |

Begrebet "team" i en dokumenttildeling betyder **teamets medlemmer**. I permission-modellen
betyder scope `team` "teams, brugeren er leder af". Forskellen er bevidst. Den er beskrevet
her, så den ikke forveksles i koden (§17, B-09).

### 4.4 Håndhævelse

- **Databasen:** RLS på `documents`, `document_versions`, `document_chunks` og
  `chunk_embeddings` bruger funktionen `knowledge.can_read_version(version_id, mode)`
  (security definer, `search_path = ''`). Retrieval-funktionen anvender samme regel
  **i forespørgslen, før søgningen** (`docs/03` §6), ikke som efterfiltrering.
- **Applikationslaget:** Hver server action og side kalder `authorize()` (fase 6) før
  datatilgang, og RLS er andet lag (`docs/03` §10).
- **Storage:** Originalfiler kan kun hentes via kortlivede signerede URL'er, som serveren
  udsteder efter permission-tjek (§14).
- **Klienten** modtager aldrig ikke-filtrerede data og kalder aldrig retrieval direkte.

---

## 5. Ingestion-pipeline

### 5.1 Arkitektur

- **Kø:** `knowledge.ingestion_jobs` i Postgres. Workeren tager et job med
  `FOR UPDATE SKIP LOCKED` gennem en databasefunktion og får en tidsbegrænset lease.
- **Worker:** en selvstændig Node/TypeScript-proces i repoet (`workers/ingestion/`) uden for
  Next.js-appen. Den deler ikke runtime med brugerrequests (`docs/03` §8, §14). Lokalt
  startes den med et npm-script. **Hvor den hostes, er ikke låst** (§17).
- **Applikationen** opretter jobs og læser deres tilstand. Intet andet (`docs/03` §14).
- **Upload:** Filen går direkte fra browseren til Storage via en signeret upload-URL, som
  serveren udsteder efter permission-tjek. Store PDF'er passerer derfor ikke gennem en
  Vercel-funktion. Derefter registrerer en server action versionen, og jobbet oprettes i samme
  transaktion.

### 5.2 Trin

| # | Trin | Indhold | Checkpoint |
|---|------|---------|------------|
| 1 | **Validering** | Magic bytes (`%PDF-`), MIME, størrelse, sidetal, krypteret/password-beskyttet, checksum verificeres, dubletter slås op | Valideringsresultat |
| 2 | **Klassificering** | Metadata fra upload valideres mod opslagstabellerne: produkt aktivt, dokumenttype kendt, sprog, gyldighedens format. **Ingen AI-klassificering i fase 7** (§17, B-04) | Manglende felter noteres |
| 3 | **Tekstudtræk** | Tekst, placering og skrifttræk pr. side. Sider uden tekstlag registreres (ingen OCR) | `document_pages` |
| 4 | **Normalisering** | Unicode NFC, whitespace, orddeling ved linjeskift, gentagne sidehoveder og -fødder fjernes (og tælles), tegnsætskontrol for æøå | Normaliseret tekst |
| 5 | **Strukturering** | Overskrifter (skriftstørrelse/-vægt og nummerering som `§ 4`, `4.2`, `Punkt`), afsnit, lister, tabeller, sidegrænser → en blokstruktur | Blokstruktur |
| 6 | **Chunking** | §6 | `document_chunks` |
| 7 | **Metadata** | Chunks knyttes til version, sidetal, afsnit og overskriftskæde. `extractor_version` og `chunker_version` registreres | — |
| 8 | **Embedding** | Pr. chunk med den aktive model (og en eventuel kandidatmodel, §7) i batches. Idempotent via `input_hash` | `chunk_embeddings` |
| 9 | **Indeksering** | FTS-kolonnerne er genererede. Vektorindekset er et partielt HNSW-indeks pr. model. Trinnet verificerer antal og integritet | Integritetsresultat |
| 10 | **Kvalitetsrapport** | §5.3 → status `processed` | `quality_report` |
| 11 | **Review** | Menneske (§2, §3) | — |
| 12 | **Godkendelse** | Menneske (§3.2) | — |
| 13 | **Publicering** | Systemets konsekvens af godkendelsen, i samme transaktion | — |

**Idempotens:** Hvert trin skriver sit output erstattende for versionen (slet og indsæt i én
transaktion), og kun så længe versionen ikke er publiceret. To kørsler af samme job giver
samme resultat og ingen dubletter. **Genforsøg** genoptager ved det trin, der fejlede.

### 5.3 Kvalitetsrapport

Rapporten er rådgivende. Undtagelsen er de blokeringer, der står i §3.2. Indholdet følger
`docs/03` §8 og `docs/04` §14.2:

- sider i alt / sider læst / sider uden tekstlag
- overskrifter fundet, og om strukturen er genkendt
- antal chunks og chunks uden overskriftskæde
- tabeller fundet og tabeller med usikker struktur
- obligatorisk metadata udfyldt / manglende felter
- dublet: andre versioner med samme checksum
- overlap eller hul i gyldigheden i forhold til publicerede versioner
- konfliktkandidater (§11.2)
- ingen adgangstildelinger
- fjernede sidehoved- og sidefodslinjer, tegnsætsadvarsler
- versioner af udtræk, chunker og embedding-model

Grænseværdier er konfiguration (`docs/03` §17 pkt. 9).

### 5.4 Filtyper

Fase 7 understøtter **PDF med tekstlag**. Scannede PDF'er uden tekstlag fejler synligt med
årsagen "ingen tekst at læse". OCR, DOCX og andre formater kommer senere. Hvilke filtyper
V1 skal understøtte, er ikke fastlagt **[AFKLARES]** (§17, B-14).

---

## 6. Chunking

Chunking følger dokumentets struktur og ikke en fast tegnlængde (`docs/03` §6). Det er det
enkeltpunkt, hvor fejl gør mest skade.

| Regel | Indhold |
|-------|---------|
| **Overskrifter og afsnit** | Et chunk krydser aldrig en overskrift. Hver sektion chunkes for sig |
| **Overskriftskæde** | Hvert chunk bærer hele kæden (`heading_path`). Kæden indgår i embedding-input og leksikalsk tekst, men ikke i `text`, så uddraget forbliver kildens egen tekst |
| **Afsnit** | Sektioner pakkes afsnit for afsnit op til en målstørrelse. Et afsnit deles kun, hvis det alene overskrider maksimum, og så ved sætningsgrænser |
| **Semantiske grænser** | Deling sker ved (i prioriteret rækkefølge) overskrift, afsnit, listepunkt og sætning. Aldrig midt i en sætning |
| **Lister** | Indledningen til en liste ("Forsikringen dækker ikke:") følger altid med listepunkterne. Deles en lang liste, gentages indledningen i hvert chunk. En undtagelse må ikke skilles fra det, den undtager fra |
| **Tabeller** | En tabel er sit eget chunk (`kind = table`) og blandes aldrig med prosa. Store tabeller deles efter rækker, og overskriftsrækken gentages. Usikker tabelstruktur markeres i kvalitetsrapporten |
| **Sider** | `page_start`/`page_end` registreres. Sidegrænsen er ikke en chunkgrænse, men positionen bevares |
| **Overlap** | Kun inden for samme sektion: op til to sætninger fra forrige chunk (højst ca. 15 %). Aldrig på tværs af overskrifter. `overlap_chars` gør det muligt at vise uddraget uden gentagelse |
| **Sporbarhed** | `document_version_id`, `chunk_index`, `page_start`/`page_end`, `section_number`, `heading`, `heading_path`, `char_start`/`char_end` og `content_hash`. Et chunk kan altid føres tilbage til sin placering i den bestemte version af den bestemte fil |
| **Størrelse** | Målstørrelse, maksimum og overlap er konfiguration og ikke låst. Udgangspunktet er ca. 300–500 tokens (estimat) og højst ca. 800 |
| **Versionering** | `chunker_version` registreres pr. version. En ændret chunker gælder nye versioner, og publicerede chunks ændres ikke (§2.3) |

Chunkeren er ren, deterministisk kode uden I/O. Den testes med faste fiktive dokumenter.

---

## 7. Embeddings

| Emne | Specifikation |
|------|---------------|
| **Lagring** | `knowledge.chunk_embeddings` i samme database (pgvector, `docs/03` §2) |
| **Kobling** | Én række pr. (chunk, model). Chunks og embeddings hører til versionen (`docs/03` §12) |
| **Model-metadata** | `embedding_models` bærer udbyder, modelnavn, modelversion, dimension, afstandsmål og sprog. Hver embedding peger på sin model og har eget `language` og `input_hash` |
| **Dimension** | Kolonnen er `vector` uden fast dimension, så en model ikke låses i skemaet. Der oprettes et partielt HNSW-indeks pr. model på `(embedding::vector(n))` med `WHERE embedding_model_id = …`. Det sker via en migration, når en model tilføjes. Det er en planlagt operation, ligesom `docs/03` §12 beskriver |
| **Søgning** | Sker altid inden for den ene aktive model. Vektorer fra forskellige modeller sammenlignes aldrig |
| **Modelskifte** | (1) Ny model som `candidate`. (2) `reembed`-jobs genererer vektorer for alle chunks i publicerede, ikke-deaktiverede versioner og i versioner under behandling. (3) Evalueringskørsel. (4) Skifte i én transaktion: den nye bliver `active`, den gamle `retired`. Kræver `system.settings.manage`. Skiftet er blokeret, så længe dækningen ikke er 100 % |
| **Gamle embeddings** | Bevares, når modellen går på pension (`retired`), men søges ikke. De kan slettes ved en senere, eksplicit oprydning. Hvornår er ikke fastlagt (§17, B-25) |
| **Deaktiverede versioner** | Beholder deres embeddings, men retrieval-filteret udelukker dem |
| **Udbyder** | **Ikke låst.** Fase 7 bygger et `Embedder`-interface (`embed(texts, {model}) → vectors`). En konkret udbyder vælges, før der indlæses rigtige dokumenter (§17). Til udvikling og test bruges en **deterministisk test-embedder** (hash af tokens til en fast vektor). Den er tydeligt markeret som mock og kan ikke aktiveres uden for lokale miljøer |
| **Hvor embedding sker** | Chunk-embeddings laves i workeren. Forespørgselsembedding laves server-side i appen ved retrieval, med samme model. Nøglen til udbyderen er en server-secret og kan aldrig have `NEXT_PUBLIC_`-prefix |

---

## 8. Retrieval

### 8.1 Flow

```
Forespørgsel (tekst + tilstand + filtre)
 → Permission-filtrering     tilladte version-id'er for brugeren (§4), i SQL
 → Metadata-filtrering        status, gyldighed/tilstand, sprog, produkt, dokument, dokumenttype
 → Hybrid retrieval           vektor (aktiv model) ∥ leksikalsk (FTS dansk + simple)
 → Kandidat-chunks            fusion med Reciprocal Rank Fusion (RRF)
 → Reranking                  §9
 → Evidensudvælgelse           §8.3
 → EvidenceSet                §10
```

### 8.2 Grænseflade

Server-side funktionen `retrieveEvidence(request)` ligger i `src/lib/knowledge/`, er
`server-only` og har ingen HTTP-route. Senere moduler kalder den server-side.

| Input | Betydning |
|-------|-----------|
| `query` | Tekst (længdebegrænset) |
| `mode` | `current` (standard) \| `as_of` + `asOf` |
| `productIds`, `documentIds`, `documentTypes` | Valgfri filtre. Snævrer kun ind; kan aldrig udvide adgangen |
| `language` | Standard `da` |
| `topK` | Antal evidenselementer |

Søgningen sker i én SQL-funktion (`security invoker`, så RLS også gælder). Den beregner først
de tilladte, tidsgyldige versioner og søger derefter kun i deres chunks. HNSW kører med
iterative index scans (pgvector 0.8), så filtreringen ikke tømmer kandidatsættet.

Leksikalsk søgning bruger to `tsvector`-kolonner. `danish` (stemming) håndterer bøjninger.
`simple` rammer eksakte strenge som "§ 4.2" og produktbetegnelser, hvor den præcise tekst er
afgørende (`docs/03` §6).

Versionsreglen: I `current` og `as_of` findes der højst én gyldig version pr. dokument og sprog
(§1.2). To versioner af samme dokument kan derfor ikke optræde i samme resultat.

### 8.3 Evidensudvælgelse

Reglerne er deterministiske, og tallene er konfiguration:

- sortering efter rerank-score
- nabochunks fra samme sektion slås sammen, hvis de begge er valgt
- højst N chunks pr. version, så ét dokument ikke fylder hele resultatet
- en minimumsscore, under hvilken et chunk ikke bliver evidens
- konfliktpart hentes med, når et valgt chunk indgår i en åben konflikt (§11.4)

Fase 7 **vurderer ikke**, om evidensen er tilstrækkelig til at besvare spørgsmålet. Det kræver
grounding-laget (`docs/03` §6 lag 4), som bygges sammen med AI. `EvidenceSet` returnerer
signaler (antal, topscore, konflikter), som vurderingen senere kan bruge.

---

## 9. Reranking

`docs/03` §7 gør reranking til et fast trin i V1. Fase 7 bygger trinnet og interfacet.
Udbyderen låses ikke.

**Interface**

```ts
interface Reranker {
  readonly id: string;          // fx "none", "provider-x:model-y"
  readonly version: string;
  rerank(input: RerankInput): Promise<RerankOutput>;
}

type RerankInput = {
  query: string;
  candidates: {
    chunkId: string;
    text: string;
    headingPath: string[];
    retrieval: { vectorRank?: number; lexicalRank?: number; vectorScore?: number; lexicalScore?: number; fusedScore: number };
  }[];
  topN: number;
};

type RerankOutput = {
  ranked: { chunkId: string; score: number; rank: number; reasons: RankReason[] }[];
  reranker: { id: string; version: string };
};

type RankReason =
  | { kind: "lexical_match"; terms: string[] }
  | { kind: "vector_similarity"; score: number }
  | { kind: "fused_rank"; rank: number }
  | { kind: "reranker_score"; score: number };
```

- **Top-k:** Hver retriever leverer op til `candidateK` (fx 50). Fusionen giver et kandidatsæt,
  hvoraf op til `rerankN` (fx 30) rerankes. Evidensudvælgelsen leverer `topK` (fx 8). Alle tre
  er konfiguration.
- **Score:** Hver kandidat har sin rerank-score normaliseret til [0,1] samt de underliggende
  scores. Scores sammenlignes kun inden for én forespørgsel.
- **Begrundelse:** `reasons` forklarer, hvorfor et chunk er valgt. Begrundelsen følger med i
  evidensen.
- **Fase 7:** Rerankeren er `none`, som bevarer fusionsrækkefølgen. Den er tydeligt markeret i
  evidensen (`reranker.id = "none"`). **Senere AI-moduler må ikke bruge evidens uden en rigtig
  reranker i produktion.** Det håndhæves, når AI Gateway bygges (§17, B-18).

---

## 10. Evidensmodel

Et standardiseret og versioneret format (`schemaVersion`), som senere AI-moduler og citations
bygger på. Det indeholder aldrig storage-stier, interne filnavne eller data om andre
brugeres adgang.

```jsonc
{
  "schemaVersion": 1,
  "query": { "text": "…", "mode": "current", "asOf": "2026-09-29", "language": "da",
             "filters": { "productIds": ["…"], "documentTypes": ["terms"] } },
  "retrieval": { "embeddingModel": "test-hash-embedder@1", "reranker": { "id": "none", "version": "1" },
                 "candidateCount": 50, "generatedAt": "2026-09-29T10:00:00Z" },
  "items": [
    {
      "evidenceId": "e1",
      "documentId": "…", "documentVersionId": "…", "chunkId": "…", "chunkIndex": 17,
      "product": { "id": "…", "name": "Testprodukt A" },
      "document": { "title": "Testbetingelser A (fiktiv)", "type": "terms", "versionLabel": "3", "language": "da" },
      "location": { "pageStart": 12, "pageEnd": 12, "sectionNumber": "4.2",
                    "heading": "4.2 Forurening", "headingPath": ["§4 Undtagelser", "4.2 Forurening"] },
      "excerpt": "…kildens egen tekst…",
      "validity": { "validFrom": "2025-07-01", "validTo": null, "temporalStatus": "current" },
      "authority": { "status": "published", "authoritative": true, "approvedAt": "…",
                     "supersededBy": null, "withdrawn": false },
      "relevance": { "score": 0.82, "rank": 1, "fusedScore": 0.031,
                     "vectorScore": 0.77, "lexicalScore": 0.4,
                     "reasons": [{ "kind": "lexical_match", "terms": ["forurening"] }] },
      "conflicts": [{ "conflictId": "…", "status": "open", "counterpartEvidenceId": "e4" }],
      "sourceReference": {
        "label": "Testbetingelser A (fiktiv), version 3, §4.2, side 12",
        "sourceType": "manual_upload"
      }
    }
  ],
  "signals": { "itemCount": 5, "topScore": 0.82, "hasConflicts": true, "hasHistorical": false }
}
```

`sourceReference.label` følger kildekortet i `docs/04` §17.1: titel, version, afsnit og side.
Til `temporalStatus` og `authority` svarer kildekortets varianter gældende, historisk og
deaktiveret. `conflicts` svarer til varianten "i konflikt".

---

## 11. Konflikthåndtering

### 11.1 Model

**`conflicts`:** `id`, `status` (`open` \| `resolved` \| `dismissed`), `detected_by` (`system`
\| `user`), `detection_rule` (§11.2), `description`, `created_by`, `created_at`,
`resolved_by`, `resolved_at` og `resolution_note`.

**`conflict_passages`:** `conflict_id`, `side` (`A` \| `B`), `document_version_id` og
`chunk_id` (valgfri, når konflikten er på versionsniveau). Konflikten repræsenterer
"Kilde A → X, Kilde B → Y". Begge kilder bevares uændret.

### 11.2 Identifikation i fase 7

Uden AI kan fase 7 ikke opdage, at to formuleringer modsiger hinanden indholdsmæssigt. Fase 7
identificerer derfor **potentielle** konflikter efter strukturelle regler og ved menneskelig
registrering:

| Regel | Eksempel |
|-------|----------|
| `overlapping_scope` | To forskellige dokumenter med samme produkt og dokumenttype, hvis publicerede versioner har overlappende gyldighed (fx to sæt acceptregler for samme produkt, gældende samtidig) |
| `duplicate_content` | Chunks med identisk `content_hash` i forskellige dokumenter med forskellig metadata |
| `manual` | Administrator eller fagligt ansvarlig registrerer konflikten og vælger de modstridende passager |

Kandidater vises i kvalitetsrapporten og i konfliktkøen. Systemregistrerede kandidater starter
som `open`. Senere faser kan tilføje AI-baseret detektion, der skriver til samme tabeller
(`detected_by = system`, ny `detection_rule`).

### 11.3 Afgørelse

Systemet afgør aldrig, hvilken kilde der har ret. Et menneske med `knowledge.version.publish`
kan:

- **Løse** konflikten med en note. Den faglige løsning gennemføres med de almindelige
  handlinger, fx deaktivering eller en ny version.
- **Afvise** den som ikke-en-konflikt, med begrundelse.

Registrering kræver `knowledge.document.write` eller `knowledge.version.publish`. Alle
ændringer auditeres.

### 11.4 Konflikter i retrieval

- Indgår et valgt chunk i en åben konflikt, markeres evidensen. Er modpartens passage
  tilgængelig for brugeren, hentes den med som eget evidenselement, også selv om den ikke
  scorede højt nok. Retrieval skjuler aldrig en kendt konflikt (`docs/03` §8: "Retrieval
  returnerer begge").
- Har brugeren ikke adgang til modparten, markeres evidensen med, at der findes en konflikt
  med en kilde, brugeren ikke har adgang til. Titel og indhold vises ikke (§17, B-20).
- Løste og afviste konflikter påvirker ikke retrieval.

---

## 12. Admin-UI i fase 7

Strukturen følger den låste IA (`docs/02` §2) og `docs/04` §14. Produkter, Dokumenter,
Knowledge Base og Versioner er søstersektioner i Admin og ikke indlejret under Knowledge Base
(§19, K-2). Admin er desktop-optimeret. Siderne kalder `authorize()` selv (fase 6's regel om
layouts).

| Sektion / view | Indhold | Handlinger | Permission |
|----------------|---------|------------|------------|
| **Admin (forside)** | Dokumentpipelinen med bruddet mellem teknisk behandling og faglig godkendelse (`docs/04` §14.1), nu med rigtige tal | — | Admin-adgang |
| **Produkter** | Liste; produktside med tilknyttede dokumenter | Opret, redigér, udfas | `knowledge.document.write` |
| **Dokumenter** — liste | Tabel med faner pr. status: Uploadet/Behandles, Klar til review (med tal), Under review, Kunne ikke behandles, Godkendt/Aktiv, Afvist, Deaktiveret | Upload dokument | Læs: `write` eller `publish` |
| **Upload-dialog** | Fil + produkt, dokumenttype, titel, versionsbetegnelse, gyldig fra/til, sprog. For en ny version vælges dokumentet. Dubletdialog (§2.3) | Upload | `knowledge.document.write` |
| **Dokument** | Overblik (titel, produkt, type, kilde, gældende version) med faner: Versioner, Adgang, Konflikter | Ny version, redigér dokumentmetadata | `write` |
| **Dokument → Adgang** | Tildelinger (alle brugere / team ± underteams / bruger) for læsning og historisk læsning | Tilføj, fjern | `knowledge.document.write` |
| **Version / Review** (`docs/04` §14.2) | Venstre: strukturvisning (normaliseret tekst med sider, overskrifter og chunkgrænser) og "Åbn original" (signeret URL). Højre: kvalitetsrapport, metadata, adgang | Påbegynd review, Godkend som autoritativ (eneste primære knap, bekræftelsesdialog), Afvis (begrundelse), Genbehandl, Kassér | `publish` for review/godkend/afvis; `write` for genbehandl/kassér |
| **Version (publiceret)** | Status, gyldighed, godkender, efterfølger | Deaktivér (begrundelse + kategori, bekræftelsesdialog) | `knowledge.version.publish` |
| **Versioner** | Tidslinje pr. dokument: gyldighedsperioder, publicering, erstatning, deaktivering, huller | — | `write` eller `publish` |
| **Knowledge Base** | Konfliktkø (begge passager side om side, `docs/04` §14.3); dækningsoversigt pr. produkt (publicerede dokumenter pr. type, manglende typer); videnshuller som tom tilstand ("registreres, når Copilot tages i brug") | Registrér, løs, afvis konflikt | Læs: `write` eller `publish`; løs/afvis: `publish` |
| **Knowledge Base → Afprøv retrieval** *(forslag, §17, B-21)* | Søgning som den indloggede administrator, der viser EvidenceSet'et med scores og begrundelser | Søg | `knowledge.document.read` |
| **Systemindstillinger → Embedding** | Aktiv model, kandidat, re-embedding-dækning (kun visning) | — | `system.settings.manage` |

Fejl- og tomme tilstande følger `docs/04` §14.3 og §18. Statuslabels bruger de danske
betegnelser fra §2.1, og statusfarver bruger tokens fra fase 5. Det gælder f.eks.
`knowledge.authoritative`, `knowledge.historical` og `knowledge.conflict`. Mock-data fra fase 5
for dokumenter, produkter, versioner og konflikter udskiftes med databasen. Videnshuller og
læringsindhold forbliver mock.

Uden for Admin bygges der intet brugerrettet i fase 7. Copilots Kilder og Dokumentvisning
kommer med AI-fasen.

---

## 13. Audit og sporbarhed

Knowledge-hændelser skrives til `audit.audit_log` (append-only, fase 6) af en triggerfunktion i
`knowledge` og af transitionsfunktionerne. Audit registrerer **handlinger, ikke indhold**:
ingen chunktekst, ingen forespørgsler.

| Hændelse (`action`) | Registreres |
|---------------------|-------------|
| `knowledge.product.created/updated/retired` | Aktør, produkt-id, ændrede felter |
| `knowledge.document.created/updated` | Aktør, dokument-id, ændrede metadatafelter |
| `knowledge.version.uploaded` | Aktør, version, checksum, størrelse |
| `knowledge.version.processing_started/succeeded/failed` | Worker (aktør `null` + `details.actor = "ingestion_worker"`), job, trin, fejlkode |
| `knowledge.version.reprocess_requested` / `discarded` | Aktør |
| `knowledge.version.review_started/review_cancelled` | Aktør |
| `knowledge.version.approved` + `published` | Aktør, gyldighed, advarsler vist i dialogen |
| `knowledge.version.rejected` | Aktør, begrundelse |
| `knowledge.version.superseded` | Forgænger, efterfølger, ny `valid_to` |
| `knowledge.version.withdrawn` | Aktør, kategori, begrundelse |
| `knowledge.version.metadata_changed` | Aktør, felter (før/efter for gyldighed) |
| `knowledge.access.granted/revoked` | Aktør, dokument, permission, modtagertype, team/bruger |
| `knowledge.conflict.flagged/resolved/dismissed` | Aktør, konflikt, regel, note |
| `knowledge.original.download_url_issued` | Aktør, version (signeret URL udstedt) |
| `knowledge.embedding_model.added/activated/retired`, `reembed.started/completed` | Aktør, model |

Knowledge-audit holdes adskilt fra AI-logs. Retrieval-forespørgsler, samtaler og citations
logges i `ai`-domænet i en senere fase og kan indeholde kundedata (`docs/03` §11). Knowledge-audit
indeholder aldrig forespørgselstekst. Sporbarheden af indhold (chunk → side → version →
fil → checksum → godkender) ligger i selve datamodellen, ikke i audit.

---

## 14. Sikkerhed

| Område | Specifikation |
|--------|---------------|
| **RLS** | Slået til på alle `knowledge`-tabeller. `anon` har ingen adgang. `authenticated` har kun de rettigheder, politikkerne giver. Status og godkendelsesfelter kan ikke opdateres direkte (column grants). Overgange sker kun gennem funktioner |
| **Politikker (kort)** | `products`, `document_types`: læs for alle indloggede; skriv med `write`. `sources`, `ingestion_jobs`, `document_pages`, `version_reviews`, `conflicts`, `embedding_models`: `write`/`publish` (modeller: `system.settings.manage`). `documents`, `document_versions`, `document_chunks`, `chunk_embeddings`: `can_read_version()` eller `write`/`publish`. `document_access_grants`: `write` |
| **Dokumentadgang** | §4. Filteret ligger i forespørgslen før søgning. Klientleverede id'er kan kun indsnævre |
| **Team-scopes** | Kun teammedlemskab tæller (§4.3). Lederscope giver ingen vidensadgang |
| **Admin-permissions** | `write`: forvaltning; `publish`: faglig autoritet; `system.settings.manage`: embedding-model. Administrator-rollen giver ingen genvej ud over de permissions, den faktisk har |
| **Server-side** | `authorize()` i hver side og server action, RLS som andet lag, retrieval kun server-side (`server-only`). Guardrail-tests sikrer, at `src/lib/knowledge/retrieval*` aldrig importeres i klientkomponenter |
| **Storage** | Privat bucket `knowledge-originals` (aldrig public). Stien er `{document_id}/{version_id}/original.pdf`, aldrig brugerens filnavn. Bucket-grænser: `allowed_mime_types = application/pdf`, filstørrelsesgrænse (fx 50 MiB, konfiguration). Storage-RLS: upload kun med `write`, læsning kun med `write`/`publish` |
| **Signerede URL'er** | Upload-URL'er og download-URL'er udstedes af serveren efter permission-tjek og har kort levetid (fx 60 sek.). Download auditeres |
| **Upload-validering** | Klientvalidering er kun for brugeroplevelsen. Workeren validerer magic bytes, MIME, størrelse, sidetal, kryptering og checksum. PDF-indhold eksekveres aldrig: tekstudtræk kører uden scripts, og indlejrede filer ignoreres. Virusscanning **[AFKLARES]** (§17, B-26) |
| **Secrets** | Service-role-nøglen findes kun i workerens miljø, aldrig i Next-appen (fase 6's guardrail-test udvides). Nøglen til embedding-udbyderen er en server-secret i app og worker. `.env.example` får tomme pladsholdere. Ingen nøgler i repoet |
| **Fejlbeskeder** | Et dokument, man ikke har adgang til, svarer som "findes ikke". Eksistens lækkes ikke. Undtagelsen er konfliktmarkeringen i §11.4 (B-20) |
| **Misbrug** | Forespørgselslængde begrænses. Rate limiting hører til AI Gateway (`docs/03` §9) og kommer med den |

---

## 15. Teststrategi

Alle tests bruger fiktive dokumenter og fiktive produkter, der ikke kan forveksles med rigtige.
Seed-brugerne og teams fra fase 6 genbruges.

**Testlag:** enhedstests (chunker, normalisering, evidensformat, RRF), pgTAP
(constraints, triggers, transitioner), integrationstests mod lokal Supabase (RLS,
retrieval, Storage, worker end-to-end) og rutetests mod den kørende app (Admin).

| Område | Konkrete tests |
|--------|----------------|
| **Dokumentisolation** | Rådgiver A med tildeling til dokument X og ikke Y: (a) `retrieveEvidence` med en forespørgsel, der ordret matcher en unik frase i Y, returnerer 0 Y-chunks; (b) direkte `select` på `document_chunks`, `chunk_embeddings`, `document_versions` og `document_pages` for Y giver 0 rækker; (c) retrieval-RPC'en med `documentIds = [Y]` giver 0; (d) download af Y's original og udstedelse af signeret URL afvises |
| **Dokument-permissions** | `all_users`, `team`, `team + include_descendants` og `user` giver hver præcis den forventede adgang. Fjernet tildeling fjerner adgangen straks. Inaktiv bruger har ingen adgang. Rådgiver og leder kan ikke se tildelinger eller oprette dem |
| **Team-scopes** | Advisor C (nord + sydB): tildeling til syd med underteams → adgang via sydB; uden underteams → ingen adgang. Leder Syd (lederscope syd, ikke medlem af et team med tildeling) → **ingen** adgang via lederscope |
| **Versionering** | Ny version påvirker ikke forgængeren før publicering. Publicering afkorter forgængerens `valid_to` og sætter `superseded_by`. Overlappende publicering afvises (constraint + funktion). Publicerede chunks kan ikke ændres |
| **Gældende/historisk retrieval** | `current` returnerer kun den gældende version. `as_of` i v2's periode returnerer v2 markeret `historical` for en bruger med `read_historical` og intet for en bruger uden. Samme dokument optræder aldrig med to versioner |
| **Gyldighedsdatoer** | Grænsedage (`valid_from` inklusiv, `valid_to` eksklusiv) i dansk tid. Fremtidig version er usynlig i `current` og synlig i `as_of` efter F. Hul i gyldighed giver advarsel |
| **Uautoriseret retrieval** | Uindlogget → afvist. Rådgiver uden tildelinger → tomt resultat. Klientfiltre kan ikke udvide adgang. Deaktiveret version findes aldrig, heller ikke historisk og heller ikke for administrator i retrieval |
| **RLS** | For hver tabel og rolle: læs/skriv tilladt/nægtet som §14. Direkte statusopdatering afvises. `anon` nægtes alt. **Mutationstest:** en svækket politik skal få tests til at fejle (som i fase 6) |
| **Chunk-sporbarhed** | Hvert chunk har version, sider, `char_start`/`char_end`. Teksten i `[char_start, char_end)` i versionens normaliserede tekst er lig med chunkets tekst. Overskriftskæden matcher dokumentets struktur. Listeindledning følger med alle listechunks. Tabeller blandes ikke med prosa |
| **Embedding/indeks-integritet** | Hvert chunk i en publiceret version har præcis én embedding med den aktive model, og dimensionen matcher modellen. Modelskifte blokeres ved manglende dækning. Vektorer fra flere modeller blandes aldrig i én søgning. Idempotent genkørsel giver ingen dubletter |
| **Godkendelses-workflow** | Upload eller gennemført behandling gør aldrig en version synlig. Godkendelse uden `publish` afvises. Manglende metadata, ulæste sider eller manglende embeddings blokerer. Afvisning kræver begrundelse. Alle overgange uden for tabellen i §2.2 afvises |
| **Publicerings-workflow** | Godkendelse gør versionen synlig for brugere med tildeling i samme transaktion. Deaktivering fjerner den straks fra al retrieval. Audit skrives for hver overgang og kan ikke ændres |
| **Konflikter** | Strukturel regel opretter kandidat. Retrieval returnerer begge parter med markering. Modpart uden adgang giver kun markering uden indhold. Løst konflikt påvirker ikke retrieval. Konflikt kan ikke løses uden `publish` |
| **Pipeline** | Worker end-to-end på fiktive PDF'er: gyldig → `processed`; krypteret, ingen tekst og forkert type → `processing_failed` med årsag; afbrudt job genoptages efter lease; genforsøg stopper ved `max_attempts` |
| **Guardrails** | Ingen service-role i `src/`. Retrieval-kode kun server-side. Bucket er privat. Test-embedderen kan ikke aktiveres uden for lokale miljøer |

Fasen er først færdig, når lint, typecheck, enhedstests, pgTAP, integrationstests og build
består, og adgangsisolationen er demonstreret mod en rigtig lokal Supabase.

---

## 16. Uden for fase 7

Følgende bygges **ikke** i fase 7:

- Claude API, AI Gateway, grounding/evidensvurdering med model, citations-validering
- Copilot, AI-chat, Copilots Kilder og Dokumentvisning for brugere
- AI-rollespil, Learn AI, Practice AI, Advise AI, Assessment AI, AI-genereret læringsindhold
- AI-baseret klassificering og AI-baseret konfliktdetektion
- `ai.retrieval_events`, `citations`, videnshuller (kræver AI-forespørgsler)
- `case_sources`, kobling mellem læringsindhold og dokumenter, notifikationer ved ny version
  (Flow G i `docs/02` §8)
- Connectors, OCR, DOCX og andre formater
- Evalueringssæt med rigtige dokumenter
- Produktions-Supabase, produktionsdata, hosting af workeren i produktion
- MFA, SSO, brugeradministration-UI, password reset-UI (henlagt i fase 6)

---

## 17. Teknisk beslutningsliste

### 17.1 Allerede låst (fase 1–6), anvendt uændret

PostgreSQL/Supabase, pgvector i samme database, Supabase Storage til originaler, skemaet
`knowledge`, asynkron ingestion adskilt fra appen, hybrid retrieval (vektor + leksikalsk),
reranking som fast trin, adskillelse af teknisk behandling og faglig godkendelse,
versionskæde med to tidsakser, embeddings bærer modelnavn, struktur-bevidst chunking,
adgang pr. dokument via `document_access_grants`, de fire `knowledge.*`-permissions og deres
rollefordeling, audit append-only, dansk sprog i V1 og multilingual-ready model, AI kun
server-side.

### 17.2 Beslutninger, fase 7 kræver (til godkendelse)

| # | Beslutning | Anbefaling |
|---|------------|------------|
| B-01 | Livscyklus og én menneskelig handling for godkendelse + publicering (K-1) | Som §2 |
| B-02 | Admin-struktur inden for den låste IA (K-2) | Som §12 |
| B-03 | Terminologi: "Archived" = **Deaktiveret**, "Published" = **Godkendt/Aktiv** afhængigt af dato, "Superseded" = **Erstattet** (K-3) | Ingen nye synonymer |
| B-04 | "Klassificering" i fase 7 = validering af menneskeligt angivet metadata, ingen AI | Ja |
| B-05 | Ny status `under_review` med "Påbegynd review" og ny status `discarded` | Ja |
| B-06 | "Erstattet" er afledt (`superseded_by` + afkortet `valid_to`), ikke en status | Ja |
| B-07 | Gyldighed som `date`, halvåbent interval, dansk tid, intet overlap pr. dokument+sprog | Ja |
| B-08 | Fremtidige versioner publiceres straks og findes kun via `as_of` | Ja |
| B-09 | Tildelingsmodel: `all_users` / `team` (medlemmer, ± underteams) / `user`, forvaltet med `knowledge.document.write`; lederscope giver ingen vidensadgang | Ja |
| B-10 | Fire øjne (uploader ≠ godkender) håndhæves ikke i fase 7, men registreres | Ja — kan strammes senere |
| B-11 | Godkendelse blokeres ved ulæste sider, manglende metadata, manglende embeddings eller overlap. Øvrige advarsler er rådgivende | Ja |
| B-12 | Deaktivering kræver `publish`, begrundelse og kategori (`invalid`, `withdrawn_by_owner`, `other`) | Ja |
| B-13 | Publicerede chunks er frosne; ny chunking kræver ny version | Ja |
| B-14 | Kun PDF med tekstlag i fase 7 | Ja — V1-filtyper **[AFKLARES]** |
| B-15 | Kø i Postgres og selvstændig Node-worker i repoet. Hosting ikke låst | Ja |
| B-16 | Workerens adgang: service-role-nøgle kun i workerens miljø, begrænset til snævre funktioner. Alternativ: dedikeret Postgres-rolle (mere least privilege, mere opsætning) | Service-role i fase 7; dedikeret rolle vurderes før produktion |
| B-17 | Ingen logning af retrieval i fase 7 (hører til `ai`) | Ja |
| B-18 | Reranker `none` i fase 7; AI-moduler må ikke bruge evidens uden rigtig reranker i produktion | Ja |
| B-19 | Leksikalsk søgning med Postgres FTS (`danish` + `simple`) og fusion med RRF | Ja |
| B-20 | Konflikt med en kilde, brugeren ikke har adgang til: markering uden titel og indhold (alternativ: skjul helt) | Markering uden indhold |
| B-21 | "Afprøv retrieval" i Knowledge Base (ny skærm, ikke i `docs/04`) | Ja, som admin-værktøj — kan fravælges |
| B-22 | Skift af embedding-model kræver `system.settings.manage` og sker som planlagt operation. UI viser kun status | Ja |
| B-23 | Supabase Storage slås til lokalt (`config.toml`), privat bucket, signerede upload-URL'er, SHA-256 i klienten til dubletdialogen | Ja |
| B-24 | Nye dependencies: PDF-udtræk i workeren (anbefaling `pdfjs-dist`, Mozilla, Apache-2.0) og til testfixtures `pdf-lib` som devDependency. Ingen andre | Ja |

### 17.3 Kan vente

| # | Beslutning | Hvornår |
|---|------------|---------|
| B-25 | Oprydning af embeddings fra udfasede modeller | Ved første modelskifte |
| B-26 | Virusscanning af uploads | Før rigtige dokumenter |
| B-27 | Tilstanden "hvad vidste systemet på tidspunkt T" i retrieval | Når Advise/audit kræver det |
| B-28 | Produktkategorier | Når produktkataloget fastlægges **[AFKLARES]** |
| B-29 | Evalueringssæt med rigtige dokumenter (`docs/03` §13) | Før AI-moduler tages i brug |
| B-30 | Retention for originalfiler og kasserede versioner (`docs/03` §17 pkt. 5) | Før produktion |

### 17.4 Hold udbyder/model åben

| Område | Hvorfor åben | Hvad fase 7 leverer i stedet |
|--------|--------------|------------------------------|
| Embedding-udbyder og -model | `docs/03` §2 og §17 pkt. 3. Kan først vurderes med et evalueringssæt | `Embedder`-interface, modeltabel, test-embedder, partielle indekser pr. model |
| Reranking-udbyder | `docs/03` §17 pkt. 2 | `Reranker`-interface, `none`-implementering |
| Worker-hosting | `docs/03` §17 pkt. 1 | Postgres-kø + worker, der kan køre hvor som helst |
| PDF-udtræk | Kan skiftes bag et `Extractor`-interface | Én implementering, `extractor_version` registreres |

**Irreversible valg** i forslaget og begrundelsen for dem: (1) pgvector i samme database
(allerede låst). (2) Chunks er immutable, og deres id'er er stabile. Det er forudsætningen for,
at senere citations kan pege på dem, og det er billigere at bevare end at genopbygge. (3)
Constraint'en om intet overlap. Den kan lempes senere, men er sikrest at starte med. (4)
Evidensformatet er versioneret (`schemaVersion`), så det kan udvikles uden at bryde senere
forbrugere.

---

## 18. Implementeringsrækkefølge (når specifikationen er godkendt)

1. Migrationer: `knowledge`-skema, opslagstabeller, dokumenter, versioner, tildelinger, RLS,
   transitionsfunktioner og audit-triggere + pgTAP
2. Storage-bucket og politikker, upload med signeret URL og registrering af version
3. Worker: kø, validering, udtræk, normalisering, strukturering og chunking + enhedstests
4. Embeddings: interface, test-embedder, modeltabel, indeks og integritetstjek
5. Review, godkendelse, publicering, afvisning og deaktivering
6. Retrieval: kandidatfunktion, RRF, reranker-interface og evidensformat
7. Konflikter
8. Admin-UI (§12), mock-data udskiftes
9. Integrations- og rutetests, mutationstest, dokumentation (`docs/07` opdateres fra DRAFT)

---

## 19. Konflikter med fase 1–6

| # | Konflikt | Låst kilde | Forslag |
|---|----------|------------|---------|
| **K-1** | Den ønskede livscyklus har **Approved** og **Published** som to tilstande. `docs/03` §12 fastslår, at overgangen til "aktiv" er den eneste, et menneske foretager, og `docs/04` §14.2 har én primær handling, "Godkend som autoritativ". To menneskelige trin (godkend, derefter publicér) ville stride mod begge | `docs/03` §12, `docs/04` §14.1–14.2 | Én menneskelig handling. Godkendelsen registreres, og publiceringen sker i samme transaktion. "Godkendt" og "Aktiv" i `docs/04` §14.1 vises som afledte tilstande ud fra datoen (§3.3). Ønskes to adskilte trin, kræver det, at `docs/03` §12 og `docs/04` §14 genåbnes eksplicit |
| **K-2** | Den foreslåede struktur `Admin → Knowledge Base → Documents → Document → Versions → Review → Access` indlejrer Dokumenter og Versioner under Knowledge Base. I den låste IA og i `docs/04` §14 er Produkter, Dokumenter, Knowledge Base og Versioner søstersektioner, og Knowledge Base rummer videnshuller, konfliktkø og dækningsoversigt | `docs/02` §2, `docs/04` §14 | Samme views og handlinger, placeret i de låste sektioner (§12). Document → Versions/Review/Access bliver faner og undersider under **Dokumenter** |
| **K-3** | "Archived" er ikke en låst betegnelse. `docs/03`/`docs/04` bruger **Erstattet** og **Deaktiveret**. Et nyt ord for samme tilstand ville være et synonym, hvilket `CLAUDE.md` §5 forbyder | `docs/03` §8/§12, `docs/04` §14.3, `CLAUDE.md` §5 | Archived → Deaktiveret (`withdrawn`), Superseded → Erstattet. Ingen ny betegnelse |

**Fortolkninger (ikke konflikter, men lagt frem til bekræftelse):**

- `docs/03` §8/§12 sætter en gammel version til "erstattet", når den nye aktiveres. Med
  fremtidige versioner ville en status, der skifter ved godkendelsen, efterlade en periode
  uden gældende version. Derfor gøres "erstattet" afledt (B-06).
- `docs/03` §17 placerer valg af worker- og reranking-udbyder "ved implementeringsstart".
  Forslaget låser mønsteret (Postgres-kø, `Reranker`-interface), men udskyder udbyderen, som
  du har bedt om. Det er en udsættelse af et non-blocking punkt, ikke en ændring af
  arkitekturen.
- `docs/03` §7 gør reranking obligatorisk i V1. Fase 7 leverer trinnet med `none`. Kravet
  opfyldes ved, at AI-moduler ikke må bruge evidens uden rigtig reranker i produktion (B-18).
- `docs/04` §14.4 placerer videnshuller i Knowledge Base. De kan først udfyldes, når der findes
  AI-forespørgsler, så i fase 7 vises en tom tilstand.
- `docs/03` §4's `document_access_grants.scope` udbygges med modtagerfelter, og "team" betyder
  her teamets medlemmer (B-09). `docs/03` §4 siger selv, at modellen ikke er en endelig
  SQL-model.
