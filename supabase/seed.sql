-- ============================================================================
-- ⚠ DEVELOPMENT-ONLY — lokalt seed (supabase db reset). Køres aldrig mod produktion.
--
-- Lokalt og i test bruger ingestion-workeren fortsat service-rollen (docs/08b §6.1.1 pkt. 6,
-- B-16). Fra 8B-I3 kan workerens funktioner kun kaldes af medlemmer af rollen
-- ingestion_worker, så service_role får medlemskabet HER — aldrig i en migration.
--
-- I produktion må service_role ikke være medlem: ops.ingestion_worker_status() melder det som
-- "service_role_is_worker", og runbookens verifikation kræver en tom liste af overtrædelser
-- (docs/08b §21.4). Ingen credentials her.
-- ============================================================================

grant ingestion_worker to service_role with inherit true, set false;

-- 8B-I5: lokalt og i test findes der ingen ClamAV-signaturer. Udviklingsscanneren
-- (workers/ingestion/security/scanner.ts) accepteres derfor KUN, når denne række findes —
-- aldrig i produktion (ops.ingestion_worker_status() melder "development_scanner_allowed").
insert into knowledge.security_development_scanners (engine) values ('development-fixture') on conflict do nothing;
