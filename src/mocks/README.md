# Mock-data — KUN UDVIKLING

Alt i denne mappe er **fiktive udviklingsdata** til Fase 5 (grundplatform). Formålet er at
kunne vurdere design og informationshierarki med realistisk dansk indhold.

- Virksomheder, personer, produkter, dokumenter, betingelser, citater og tal er **opdigtede**.
  De beskriver ikke rigtige forsikringsprodukter, og intet her er fagligt grundlag.
- Filerne må kun importeres af sider og udviklingsværktøjer. Genbrugelige komponenter i
  `src/components/` modtager data som props og kender ikke til mock-data.
- Mock-data må aldrig kopieres ind i, seedes til eller blandes med produktionsdata. Når
  rigtige data kommer i en senere fase, erstattes importen fra `@/mocks` af server-side
  dataadgang — mock-filerne slettes.
- Alle eksporter er præfikset `mock` og hver fil starter med samme advarsel.
