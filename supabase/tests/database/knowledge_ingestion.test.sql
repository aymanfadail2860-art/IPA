-- pgTAP: Knowledge Engine trin 3 — kø, lease, genforsøg og workerens grænser
-- (docs/07 §5.1–5.2, §2.3, §14.1). Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(23);

insert into knowledge.products (id, name) values ('42000000-0000-4000-a000-000000000001', 'pgTAP Workerprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '43000000-0000-4000-a000-000000000001', '42000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Worker'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, valid_from, storage_path, checksum_sha256)
values ('44000000-0000-4000-a000-000000000001', '43000000-0000-4000-a000-000000000001', '2026-01-01', 'w/1.pdf', repeat('1', 64)),
       ('44000000-0000-4000-a000-000000000002', '43000000-0000-4000-a000-000000000001', '2027-01-01', 'w/2.pdf', repeat('2', 64));
-- Kun disse to jobs er klar i testen.
update knowledge.ingestion_jobs set next_attempt_at = now() + interval '1 day' where status = 'queued';
insert into knowledge.ingestion_jobs (id, document_version_id, kind)
values ('45000000-0000-4000-a000-000000000001', '44000000-0000-4000-a000-000000000001', 'process'),
       ('45000000-0000-4000-a000-000000000002', '44000000-0000-4000-a000-000000000002', 'process');

-- Workerfunktionerne er kun for service_role.
select ok(not has_function_privilege('authenticated', 'knowledge.worker_claim_job(text, int)', 'execute'),
  'brugere kan ikke tage behandlingsjobs');
select ok(not has_function_privilege('authenticated', 'knowledge.worker_complete_job(uuid, text, jsonb)', 'execute'),
  'brugere kan ikke afslutte behandlingsjobs');
select ok(not has_function_privilege('anon', 'knowledge.worker_store_chunks(uuid, text, jsonb, text)', 'execute'),
  'anon kan ikke skrive chunks');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'knowledge' and p.proname like 'worker_%'
    and p.prosrc ~* $re$(set\s+status\s*=\s*'published'|published_at\s*=|approved_at\s*=)$re$
), 'ingen workerfunktion sætter en version til publiceret eller godkendt');

set local role service_role;

select is((select version_id from knowledge.worker_claim_job('w1')), '44000000-0000-4000-a000-000000000001'::uuid,
  'worker 1 tager det ældste job');
select is((select status from knowledge.document_versions where id = '44000000-0000-4000-a000-000000000001'), 'processing',
  'versionen går fra uploadet til behandles, når jobbet tages');
select is((select version_id from knowledge.worker_claim_job('w2')), '44000000-0000-4000-a000-000000000002'::uuid,
  'worker 2 springer det låste job over (SKIP LOCKED / lease)');
select throws_ok(
  $$ select knowledge.worker_checkpoint('45000000-0000-4000-a000-000000000001', 'w2', 'validation', '{}') $$,
  '55P03', null, 'en worker kan ikke skrive til et job, en anden worker holder'
);

-- Sider og chunks erstattes samlet (idempotent).
select knowledge.worker_store_pages('45000000-0000-4000-a000-000000000001', 'w1',
  '[{"page_number":1,"text":"§ 1 Test. Fiktiv tekst.","has_text_layer":true,"char_start":0,"char_end":23}]', 1, 100, 'application/pdf', 'test/1');
select knowledge.worker_store_pages('45000000-0000-4000-a000-000000000001', 'w1',
  '[{"page_number":1,"text":"§ 1 Test. Fiktiv tekst.","has_text_layer":true,"char_start":0,"char_end":23}]', 1, 100, 'application/pdf', 'test/1');
select is((select count(*)::int from knowledge.document_pages where document_version_id = '44000000-0000-4000-a000-000000000001'), 1,
  'at gemme siderne to gange giver ingen dubletter');
select is(knowledge.worker_store_chunks('45000000-0000-4000-a000-000000000001', 'w1',
  '[{"chunk_index":0,"kind":"prose","text":"Fiktiv tekst.","heading":"§ 1 Test","heading_path":["§ 1 Test"],"section_number":"1",
     "page_start":1,"page_end":1,"char_start":10,"char_end":23,"overlap_chars":0,
     "content_hash":"0000000000000000000000000000000000000000000000000000000000000000","char_count":13,"token_estimate":4},
    {"chunk_index":1,"kind":"list","text":"• a","lead_in":"Dækker ikke:","heading":"§ 1 Test","heading_path":["§ 1 Test"],"section_number":"1",
     "page_start":1,"page_end":1,"char_start":20,"char_end":23,"overlap_chars":0,
     "content_hash":"1111111111111111111111111111111111111111111111111111111111111111","char_count":3,"token_estimate":1}]', 'test/1'),
  2, 'chunks gemmes med lead-in');
select ok((select fts_da @@ to_tsquery('danish', 'dækker') from knowledge.document_chunks
           where document_version_id = '44000000-0000-4000-a000-000000000001' and chunk_index = 1),
  'den gentagne indledning indgår i den leksikalske søgning');

-- Midlertidig fejl: genforsøg med backoff.
select is(knowledge.worker_fail_job('45000000-0000-4000-a000-000000000001', 'w1', 'processing_error', 'midlertidig', true), 'retry',
  'en midlertidig fejl giver genforsøg');
select ok((select status = 'queued' and next_attempt_at > now() and locked_by is null
           from knowledge.ingestion_jobs where id = '45000000-0000-4000-a000-000000000001'),
  'jobbet står i kø igen med backoff');
select is((select status from knowledge.document_versions where id = '44000000-0000-4000-a000-000000000001'), 'processing',
  'versionen er fortsat under behandling under genforsøg');
select is((select count(*)::int from knowledge.worker_claim_job('w3')), 0, 'et job i backoff tages ikke før tid');

reset role;
update knowledge.ingestion_jobs set next_attempt_at = now() where id = '45000000-0000-4000-a000-000000000001';
set local role service_role;
select is((select attempts from knowledge.worker_claim_job('w1')), 2, 'genforsøget tæller forsøg');
select is(knowledge.worker_fail_job('45000000-0000-4000-a000-000000000001', 'w1', 'not_pdf', 'Filen er ikke en PDF.', false), 'failed',
  'en fejl i selve filen genforsøges ikke');
select is((select status from knowledge.document_versions where id = '44000000-0000-4000-a000-000000000001'), 'processing_failed',
  'versionen bliver "kunne ikke behandles" med årsag');

-- Worker 2 gør sit job færdigt: status processed og kvalitetsrapport med fakta fra databasen.
select knowledge.worker_complete_job('45000000-0000-4000-a000-000000000002', 'w2', '{"pages":{"all_read":true}}');
select is((select status from knowledge.document_versions where id = '44000000-0000-4000-a000-000000000002'), 'processed',
  'et færdigt job gør versionen klar til review — aldrig publiceret');
select ok((select quality_report -> 'metadata' -> 'missing' ? 'version_label' and (quality_report -> 'access' ->> 'no_grants')::boolean
           from knowledge.ingestion_jobs where id = '45000000-0000-4000-a000-000000000002'),
  'kvalitetsrapporten får manglende metadata og manglende tildelinger fra databasen');

reset role;

-- Et job for en kasseret version annulleres, når det tages.
update knowledge.document_versions set status = 'discarded' where id = '44000000-0000-4000-a000-000000000001';
insert into knowledge.ingestion_jobs (id, document_version_id) values ('45000000-0000-4000-a000-000000000003', '44000000-0000-4000-a000-000000000001');
set local role service_role;
select is((select count(*)::int from knowledge.worker_claim_job('w1')), 0, 'en kasseret version behandles ikke');
reset role;
select is((select status from knowledge.ingestion_jobs where id = '45000000-0000-4000-a000-000000000003'), 'cancelled',
  'jobbet for den kasserede version annulleres');

select ok(
  exists (select 1 from audit.audit_log where action = 'knowledge.version.processing_failed'
          and entity_id = '44000000-0000-4000-a000-000000000001' and details ->> 'actor' = 'ingestion_worker'),
  'workerens hændelser auditeres med actor = ingestion_worker'
);

select * from finish();
rollback;
