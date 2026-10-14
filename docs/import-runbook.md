# Runbook: dokumentimport (beta)

Til administratoren, der importerer forsikringsvilkår som PDF. Importen kører på en betroet computer
med Docker. Intet publiceres automatisk: hver version godkendes af en person i Admin.

**Kæden:** PDF → karantæne → validering → ClamAV → sikkerhedsvurdering → frigivelse → tekstudtræk →
registrering → faglig godkendelse i Admin → publicering.

Baggrund og tekniske detaljer: `docs/beta.md` §6 og §15.

---

## Før første import (én gang, teknisk ansvarlig)

- Platformen er sat op: databasen, Edge Function `worker-storage`, workerens login-rolle og dens
  adgangskode (`docs/beta.md` §15.7).
- Supabases CA-certifikat ligger i `deploy/ingestion-worker/certs/`.
- Produkterne er oprettet i **Admin → Produkter**.
- Du har en administratorkonto med ret til at uploade dokumenter.
- Computeren har krypteret disk og en personlig konto med adgangskode. Den har Docker Desktop og
  en kopi af repoet. Den kan nå projektets Supabase og `database.clamav.net`, hvor scannerens
  signaturer hentes.

Kommandoerne skrives i Terminal i repoets mappe. På Windows bruges WSL.

## 1. Start Docker

Åbn Docker Desktop, og vent, til den viser, at motoren kører.

## 2. Hvor PDF'erne lægges

Første gang opretter du mapperne og indstillingsfilen:

```
mkdir -p ~/ipa-import/dokumenter ~/ipa-import/rapporter
cp deploy/import/ipa-import.env.example ~/ipa-import/ipa-import.env
chmod 600 ~/ipa-import/ipa-import.env
```

Udfyld `~/ipa-import/ipa-import.env` med adresserne, din e-mail og de to mapper. Skriv aldrig en
adgangskode i filen. Står der en, afviser importen at køre.

Læg PDF'erne i `~/ipa-import/dokumenter`. Læg dem aldrig i repoet.

## 3. Metadata: importlisten

Hent produkternes id'er:

```
./deploy/import/ipa-import.sh produkter
```

Opret `importliste.csv` i mappen med PDF'erne. Du kan bruge Excel og gemme som **CSV UTF-8**.
Listen har én række pr. PDF:

| Kolonne | Indhold | Krav |
|---|---|---|
| `fil` | PDF'ens filnavn | påkrævet |
| `produkt_id` | id fra produktlisten | nyt dokument |
| `dokumenttype` | fx `terms` eller `Betingelser` | nyt dokument |
| `titel` | dokumentets titel | nyt dokument |
| `dokument_id` | et eksisterende dokument, hvis filen er en ny version af det | i stedet for de tre ovenfor |
| `version` | versionsbetegnelse, fx `2026-01` | påkrævet |
| `gyldig_fra` | første gyldige dag, `ÅÅÅÅ-MM-DD` | påkrævet |
| `gyldig_til` | første dag, versionen ikke gælder, `ÅÅÅÅ-MM-DD` | valgfri |
| `sprog` | to bogstaver, standard `da` | valgfri |
| `sider` | antal sider, som dokumentet skal have | valgfri, anbefales |

Eksempel:

```
fil;produkt_id;dokumenttype;titel;version;gyldig_fra;gyldig_til;sider
erhvervsansvar-2026.pdf;7c0e…;Betingelser;Erhvervsansvar – betingelser;2026-01;2026-01-01;;32
```

Importen gætter aldrig. Et ukendt produkt, en ukendt dokumenttype eller en ugyldig dato afviser
rækken. Selskab/udgiver kan ikke angives, fordi datamodellen ikke har et felt til det
**[AFKLARES]**.

Kontrollér listen. Kommandoen ændrer intet, så du kan rette og køre den igen:

```
./deploy/import/ipa-import.sh kontroller
```

## 4. Start importen

Byg og kontrollér scanneren. Gør det samme dag, og højst 8 timer før importen:

```
./deploy/import/ipa-import.sh forbered
```

Scanneren bygges med friske officielle ClamAV-signaturer. Kontrollen kræver:
- den godkendte motor 1.4.6;
- signaturer under 8 timer gamle;
- at EICAR-testfilen bliver fundet;
- at en ren fil er ren.

Fejler kontrollen, importeres intet. Kør derefter importen:

```
./deploy/import/ipa-import.sh importer
```

Importen spørger om din adgangskode og workerens databaseadgangskode. Ingen af dem vises på
skærmen. Derefter kontrolleres scanneren igen. Filerne uploades til karantæne, og workeren kører
sikkerhedskontrol og tekstudtræk. Til sidst vises status.

Kør én import ad gangen og fra én computer.

## 5. Status og fejl

```
./deploy/import/ipa-import.sh status
```

| Status | Betyder | Hvad du gør |
|---|---|---|
| Afvist før upload | Importlisten eller filen er forkert | Ret listen eller filen, og kør `importer` igen |
| Venter på sikkerhedskontrol / tekstudtræk | Workeren er ikke kørt færdig | Kør `importer` igen |
| Sikkerhedskontrollen kunne ikke gennemføres | Scanneren svarede ikke, eller signaturerne var for gamle | Kør `forbered` og `importer` igen. Filen frigives ikke imens |
| Afvist af sikkerhedskontrollen | Malware, aktivt indhold, kryptering eller en ugyldig PDF | Filen bruges ikke. Skaf en ren kopi fra udgiveren |
| Kunne ikke behandles | Teksten kunne ikke læses | Se årsagen i rapporten |
| Ufuldstændig – kan ikke godkendes | En side mangler tekst, sideantallet passer ikke, eller den gemte fil afviger | Skaf en komplet PDF med tekstlag. Versionen kan ikke godkendes |
| Klar til faglig godkendelse i Admin | Alt er kontrolleret | Godkend i Admin (trin 6) |
| Publiceret – hele versionen er tilgængelig | Godkendt og bevist komplet | Intet |

Rapporterne ligger i `~/ipa-import/rapporter`. Filerne `import-…` og `status-…` er tekst og JSON.
Journalen `import-journal.json` bruges, når en afbrudt import genoptages.

## 6. Godkendelse i Admin

Gå til **Admin → Dokumenter → Klar til review**, og åbn versionen. Gennemgå den:
- kontrollér titel, produkt, version, gyldighed, sider og afsnit mod PDF'en;
- tildel adgang, dvs. hvem der må finde dokumentet;
- start review, og godkend.

Kun versioner med status "Klar til faglig godkendelse" kan godkendes. Ufuldstændige versioner
blokeres.

Kør `status` igen bagefter. Status "Publiceret – hele versionen er tilgængelig" er beviset for, at
versionen er hel:
- den gemte original har samme SHA-256 som din fil;
- alle sider har tekst;
- tekstsegmenterne følger dokumentets rækkefølge.

## 7. Stop importen sikkert

- **Under en kørsel:** tryk Ctrl-C. Workeren afslutter eller frigiver sit job, og intet publiceres.
  Kør `importer` igen, så fortsætter den, hvor den slap. Filer, der allerede er registreret, sendes
  ikke igen.
- **Når du er færdig:** `./deploy/import/ipa-import.sh stop`.

## 8. Midlertidige filer og adgangskoder

- **Adgangskoder:** Du bliver spurgt ved hver kørsel. De gemmes ingen steder. De findes kun i
  kørslens containere, som slettes bagefter. De står aldrig i indstillingsfilen, i repoet eller i
  et image.
- **Containerne:** De skriver kun i hukommelsen og i rapportmappen. Mappen med PDF'erne er
  skrivebeskyttet for dem.
- **Rapporter og journal:** De indeholder kun filnavne, id'er, SHA-256 og status. Aldrig
  dokumenttekst.
- **PDF'erne:** Når alle versioner er publiceret, og `status` viser beviset, sletter du PDF'erne i
  `~/ipa-import/dokumenter`. Originalerne ligger i platformen. Rapporterne beholder du.
- **Mistanke om læk:** Hvis en adgangskode kan være lækket, kontakter du den teknisk ansvarlige.
  Workerens rolle kan spærres, og adgangskoden skiftes.
