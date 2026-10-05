-- pgTAP: 8B-I3 — lease-capability, worker-API og billetter, også fjendtligt (docs/08b §21.4).
-- Blue og green kører hver hele API'et. Alle angreb skal afvises deterministisk eller være
-- idempotente. Alt rulles tilbage.
--
-- Fejlkoder: 42501 identitet/rettighed, 55P03 ingen gyldig lease, 22023 ugyldigt input,
-- 23514 forkert tilstand/version, P0002 ukendt model, 54000 billetgrænse, 28000 ugyldig billet.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(98);

-- Testdata. Andre jobs i databasen holdes ude af testen.
update knowledge.ingestion_jobs set next_attempt_at = now() + interval '1 day' where status = 'queued';
update knowledge.ingestion_jobs set locked_until = now() + interval '1 day' where status = 'running';
insert into knowledge.products (id, name) values ('52000000-0000-4000-a000-000000000001', 'pgTAP Leaseprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '53000000-0000-4000-a000-000000000001', '52000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Lease'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, valid_from, storage_path, checksum_sha256)
select ('54000000-0000-4000-a000-00000000000' || i)::uuid, '53000000-0000-4000-a000-000000000001', make_date(2030 + i, 1, 1),
       'pgtap-lease/' || i || '.pdf', repeat(i::text, 64)
from generate_series(1, 7) i;
insert into knowledge.ingestion_jobs (id, document_version_id, kind, next_attempt_at)
select ('55000000-0000-4000-a000-00000000000' || i)::uuid, ('54000000-0000-4000-a000-00000000000' || i)::uuid, 'process', now() + interval '1 day'
from generate_series(1, 7) i;
insert into knowledge.document_versions (id, document_id, valid_from, storage_path, checksum_sha256)
values ('54000000-0000-4000-a000-000000000009', '53000000-0000-4000-a000-000000000001', '2040-01-01', 'pgtap-lease/9.pdf', repeat('9', 64));
insert into knowledge.ingestion_jobs (id, document_version_id, kind, next_attempt_at)
values ('55000000-0000-4000-a000-000000000009', '54000000-0000-4000-a000-000000000009', 'process', now() + interval '1 day');
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('56000000-0000-4000-a000-000000000001', 'pgtap', 'lease-model', '1', 3, 'candidate');

create function pg_temp.ready(p_job uuid) returns void language sql as
  $$ update knowledge.ingestion_jobs set next_attempt_at = now() where id = p_job $$;

-- 8B-I5: en fixture-version består sikkerhedskontrollen (testhjælper, kun i denne session).
-- Som postgres (tabellens ejer) og efter tilstandsmaskinen: karantæne → scanning → frigivet.
create function pg_temp.release(p_version uuid) returns void language plpgsql as $release$
declare v_verdict uuid;
begin
  insert into knowledge.security_verdicts (document_version_id, policy_version, checksum_sha256, byte_size, detected_mime,
    object_bucket, object_path, structural_result, malware_result, scanner_engine, scanner_version, signature_version,
    signature_time, pdf_security_result, active_content_result, final_verdict, released_at)
  select v.id, 'pdf-v1', v.checksum_sha256, coalesce(v.byte_size, 0), 'application/pdf', 'knowledge-originals', v.storage_path,
         'pass', 'clean', 'development-fixture', '0', '0', now(), 'pass', 'pass', 'safe', now()
  from knowledge.document_versions v where v.id = p_version
  returning id into v_verdict;
  update knowledge.document_versions set security_state = 'scanning' where id = p_version;
  update knowledge.document_versions
  set security_state = 'released', storage_bucket = 'knowledge-originals', security_verdict_id = v_verdict, security_released_at = now()
  where id = p_version;
end $release$;
do $$ begin perform pg_temp.release(id) from knowledge.document_versions where document_id = '53000000-0000-4000-a000-000000000001'; end $$;

-- Rotationstilstand: begge roller aktive. Kun i testen: SET på rollerne og USAGE på extensions.
select ops.ingestion_worker_prepare('ingestion_worker_login_blue');
select ops.ingestion_worker_prepare('ingestion_worker_login_green');
grant ingestion_worker_login_blue, ingestion_worker_login_green to postgres with inherit false, set true;
grant usage on schema extensions to ingestion_worker_login_blue, ingestion_worker_login_green;

-- ---------------------------------------------------------------------------
-- 1. Blue: hele API'et på job 1.
-- ---------------------------------------------------------------------------

select pg_temp.ready('55000000-0000-4000-a000-000000000001');
set local role ingestion_worker_login_blue;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('blue-a', 300);
  perform set_config('t.b1', to_jsonb(c)::text, true);
  perform set_config('t.b1tok', coalesce(c.lease_token, ''), true);
end $$;
select is((current_setting('t.b1')::jsonb ->> 'job_id')::uuid, '55000000-0000-4000-a000-000000000001'::uuid, 'blue tager job 1');
select ok(current_setting('t.b1tok') ~ '^[0-9a-f]{64}$', 'claim udsteder en lease-token på 64 hex-tegn');
select is((current_setting('t.b1')::jsonb ->> 'lease_expires_at')::timestamptz, now() + interval '300 seconds', 'leasen udløber efter den ønskede tid');
reset role;
select ok((select lease_token_hash = knowledge.lease_hash(id, current_setting('t.b1tok'))
                  and position(current_setting('t.b1tok') in row_to_json(j)::text) = 0 and locked_by = 'blue-a'
           from knowledge.ingestion_jobs j where id = '55000000-0000-4000-a000-000000000001'),
  'kun hashen af tokenet (bundet til jobbet) gemmes — aldrig tokenet');
select isnt(knowledge.lease_hash('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok')),
            knowledge.lease_hash('55000000-0000-4000-a000-000000000002', current_setting('t.b1tok')),
  'samme token giver forskellige hashes for to jobs (bundet til jobbet)');
set local role ingestion_worker_login_blue;

select is(knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), 600), now() + interval '600 seconds',
  'blue: heartbeat forlænger leasen');
select lives_ok($$ select knowledge.worker_checkpoint('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), 'validation', '{"ok":true}') $$,
  'blue: checkpoint');
do $$ declare c record; begin
  select * into c from knowledge.worker_issue_storage_ticket('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), 'download_original');
  perform set_config('t.ticket1', coalesce(c.ticket, ''), true);
  perform set_config('t.ticket1exp', coalesce(c.expires_at::text, ''), true);
end $$;
select ok(current_setting('t.ticket1') ~ '^[0-9a-f]{64}$' and current_setting('t.ticket1exp')::timestamptz = now() + interval '60 seconds',
  'blue: en billet til originalen, gyldig i 60 sekunder');
select lives_ok($$ select knowledge.worker_store_pages('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'),
  '[{"page_number":1,"text":"§ 1 Lease. Fiktiv tekst.","has_text_layer":true,"char_start":0,"char_end":24}]', 1, 100, 'application/pdf', 'test/1') $$,
  'blue: sider');
select is(knowledge.worker_store_chunks('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'),
  '[{"chunk_index":0,"kind":"prose","text":"Fiktiv tekst.","heading":"§ 1 Lease","heading_path":["§ 1 Lease"],"section_number":"1",
     "page_start":1,"page_end":1,"char_start":10,"char_end":23,"overlap_chars":0,"content_hash":"0000000000000000000000000000000000000000000000000000000000000000","char_count":13,"token_estimate":4},
    {"chunk_index":1,"kind":"prose","text":"Mere tekst.","heading":"§ 1 Lease","heading_path":["§ 1 Lease"],"section_number":"1",
     "page_start":1,"page_end":1,"char_start":13,"char_end":24,"overlap_chars":0,"content_hash":"1111111111111111111111111111111111111111111111111111111111111111","char_count":11,"token_estimate":3}]',
  'test/1'), 2, 'blue: chunks');
select ok(exists (select 1 from knowledge.worker_embedding_models() where id = '56000000-0000-4000-a000-000000000001'), 'blue: modeller');
do $$ begin perform set_config('t.rows1', (
  select jsonb_agg(jsonb_build_object('chunk_id', chunk_id, 'embedding', '[1,0,0]'::jsonb, 'language', 'da', 'input_hash', repeat('a', 64)))::text
  from knowledge.worker_chunks_to_embed('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), '56000000-0000-4000-a000-000000000001')), true);
end $$;
select is(jsonb_array_length(current_setting('t.rows1')::jsonb), 2, 'blue: chunks, der mangler embeddings');
select is(knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'),
  '56000000-0000-4000-a000-000000000001', current_setting('t.rows1')::jsonb), 2, 'blue: embeddings');
select is(knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'),
  '56000000-0000-4000-a000-000000000001', current_setting('t.rows1')::jsonb), 0, 'genafspillede embeddings er idempotente');
select ok((select bool_or((m ->> 'model_id')::uuid = '56000000-0000-4000-a000-000000000001' and (m ->> 'embeddings')::int = 2)
           from jsonb_array_elements(knowledge.worker_verify_index('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'))) m),
  'blue: indeksverifikation');
select ok(knowledge.worker_complete_job('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), '{"pages":{"all_read":true}}') ? 'metadata',
  'blue: afslut');
select throws_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), '{}') $$,
  '55P03', null, 'en gentaget afslutning afvises (genafspilning)');
select throws_ok($$ select knowledge.worker_fail_job('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), 'x', 'y', true) $$,
  '55P03', null, 'et afsluttet job kan ikke fejles bagefter');
select throws_ok($$ select knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000001', current_setting('t.b1tok'), 300) $$,
  '55P03', null, 'en afsluttet lease kan ikke forlænges');
reset role;
select ok((select status = 'succeeded' and lease_token_hash is null and locked_by is null from knowledge.ingestion_jobs
           where id = '55000000-0000-4000-a000-000000000001'), 'leasen er væk, når jobbet er afsluttet');
select is((select status from knowledge.document_versions where id = '54000000-0000-4000-a000-000000000001'), 'processed',
  'versionen er klar til review — aldrig publiceret');

-- ---------------------------------------------------------------------------
-- 2. Green: hele API'et på job 2 (fejl med genforsøg) og job 3 (afslutning).
-- ---------------------------------------------------------------------------

select pg_temp.ready('55000000-0000-4000-a000-000000000002');
set local role ingestion_worker_login_green;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('green-a', 120);
  perform set_config('t.g2', to_jsonb(c)::text, true);
  perform set_config('t.g2tok', coalesce(c.lease_token, ''), true);
end $$;
select is((current_setting('t.g2')::jsonb ->> 'job_id')::uuid, '55000000-0000-4000-a000-000000000002'::uuid, 'green tager job 2');
select is(knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'), 300), now() + interval '300 seconds',
  'green: heartbeat');
select lives_ok($$ select knowledge.worker_checkpoint('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'), 'validation', null) $$,
  'green: checkpoint');
select ok((select ticket ~ '^[0-9a-f]{64}$' from knowledge.worker_issue_storage_ticket('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'), 'download_original')),
  'green: billet');
select lives_ok($$ select knowledge.worker_store_pages('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  '[{"page_number":1,"text":"§ 2 Grøn.","has_text_layer":true,"char_start":0,"char_end":9}]', 1, 50, 'application/pdf', 'test/1') $$, 'green: sider');
select is(knowledge.worker_store_chunks('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  '[{"chunk_index":0,"kind":"prose","text":"Grøn.","heading":"§ 2","heading_path":["§ 2"],"section_number":"2",
     "page_start":1,"page_end":1,"char_start":4,"char_end":9,"overlap_chars":0,"content_hash":"2222222222222222222222222222222222222222222222222222222222222222","char_count":5,"token_estimate":1}]',
  'test/1'), 1, 'green: chunks');
select ok(exists (select 1 from knowledge.worker_embedding_models() where id = '56000000-0000-4000-a000-000000000001'), 'green: modeller');
do $$ begin perform set_config('t.rows2', (
  select jsonb_agg(jsonb_build_object('chunk_id', chunk_id, 'embedding', '[0,1,0]'::jsonb, 'language', 'da', 'input_hash', repeat('b', 64)))::text
  from knowledge.worker_chunks_to_embed('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'), '56000000-0000-4000-a000-000000000001')), true);
end $$;
select is(jsonb_array_length(current_setting('t.rows2')::jsonb), 1, 'green: chunks, der mangler embeddings');
select is(knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  '56000000-0000-4000-a000-000000000001', current_setting('t.rows2')::jsonb), 1, 'green: embeddings');
select ok(jsonb_typeof(knowledge.worker_verify_index('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'))) = 'array', 'green: indeksverifikation');

-- Embeddings for en anden versions chunk (job 1) afvises samlet.
select throws_ok($$ select knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  '56000000-0000-4000-a000-000000000001', current_setting('t.rows1')::jsonb) $$,
  '23514', null, 'embeddings for et chunk i en anden version afvises');
select throws_ok($$ select knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  '56000000-0000-4000-a000-000000000001', (current_setting('t.rows2')::jsonb || current_setting('t.rows1')::jsonb)) $$,
  '23514', null, 'en blandet batch afvises helt (intet gemmes delvist)');
select throws_ok($$ select knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  gen_random_uuid(), current_setting('t.rows2')::jsonb) $$, 'P0002', null, 'en ukendt model afvises');
select throws_ok($$ select * from knowledge.worker_chunks_to_embed('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'), gen_random_uuid()) $$,
  'P0002', null, 'chunks til en ukendt model afvises');
reset role;
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('56000000-0000-4000-a000-000000000002', 'pgtap', 'lease-retired', '1', 3, 'retired');
set local role ingestion_worker_login_green;
select throws_ok($$ select knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  '56000000-0000-4000-a000-000000000002', current_setting('t.rows2')::jsonb) $$, 'P0002', null, 'en udfaset model afvises');
select throws_ok($$ select knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'),
  '56000000-0000-4000-a000-000000000001', '[]') $$, '22023', null, 'en tom embeddingliste afvises');

select is(knowledge.worker_fail_job('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'), 'processing_error', 'midlertidig', true), 'retry',
  'green: fejl med genforsøg (workerens måde at frigive et job på)');
select throws_ok($$ select knowledge.worker_fail_job('55000000-0000-4000-a000-000000000002', current_setting('t.g2tok'), 'processing_error', 'igen', true) $$,
  '55P03', null, 'en gentaget fejl på samme lease afvises (genafspilning)');
reset role;

select pg_temp.ready('55000000-0000-4000-a000-000000000003');
set local role ingestion_worker_login_green;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('green-a', 300);
  perform set_config('t.g3tok', coalesce(c.lease_token, ''), true);
end $$;
select ok(knowledge.worker_complete_job('55000000-0000-4000-a000-000000000003', current_setting('t.g3tok'), null) ? 'generated_at', 'green: afslut');
reset role;

-- Sidste forsøg: en fejl, der ellers kunne genforsøges, bliver endelig.
select pg_temp.ready('55000000-0000-4000-a000-000000000009');
update knowledge.ingestion_jobs set attempts = max_attempts - 1 where id = '55000000-0000-4000-a000-000000000009';
set local role ingestion_worker_login_green;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('green-a', 300);
  perform set_config('t.g9tok', coalesce(c.lease_token, ''), true);
end $$;
select is(knowledge.worker_fail_job('55000000-0000-4000-a000-000000000009', current_setting('t.g9tok'), 'processing_error', 'sidste', true), 'failed',
  'på sidste forsøg bliver en midlertidig fejl endelig');
reset role;
select is((select status from knowledge.document_versions where id = '54000000-0000-4000-a000-000000000009'), 'processing_failed',
  'versionen kunne ikke behandles efter sidste forsøg');


-- ---------------------------------------------------------------------------
-- 3. Angreb på leasen.
-- ---------------------------------------------------------------------------

select pg_temp.ready('55000000-0000-4000-a000-000000000004');
set local role ingestion_worker_login_blue;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('blue-a', 300);
  perform set_config('t.b4tok', coalesce(c.lease_token, ''), true);
end $$;
reset role;
set local role ingestion_worker_login_green;
select is((select count(*)::int from knowledge.worker_claim_job('green-a', 300)), 0, 'et job med en gyldig lease kan ikke tages af en anden worker');
select throws_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000004', current_setting('t.g3tok'), '{}') $$,
  '55P03', null, 'worker B kan ikke afslutte worker A''s lease med sit eget token');
select throws_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000004', null, '{}') $$,
  '55P03', null, 'job-id alene er aldrig nok');
select throws_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000004', md5('x') || md5('y'), '{}') $$,
  '55P03', null, 'et forfalsket token afvises');
select throws_ok($$ select knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000004', upper(current_setting('t.b4tok')), 300) $$,
  '55P03', null, 'et token i forkert format afvises');
select throws_ok($$ select knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000004', current_setting('t.b4tok') || ' or true', 300) $$,
  '55P03', null, 'et token med indsprøjtet tekst afvises');
reset role;
set local role ingestion_worker_login_blue;
select throws_ok($$ select knowledge.worker_heartbeat(gen_random_uuid(), current_setting('t.b4tok'), 300) $$,
  '55P03', null, 'et gyldigt token på et ukendt job afvises');
select throws_ok($$ select knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000002', current_setting('t.b4tok'), 300) $$,
  '55P03', null, 'et gyldigt token på et andet job afvises (hashen er bundet til jobbet)');
select is(knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000004', current_setting('t.b4tok'), 300), now() + interval '300 seconds',
  'det rigtige token virker stadig efter angrebene');
reset role;

-- Udløbet lease: kan ikke forlænges eller bruges; en anden worker overtager med et nyt token.
update knowledge.ingestion_jobs set locked_until = now() - interval '1 second' where id = '55000000-0000-4000-a000-000000000004';
set local role ingestion_worker_login_blue;
select throws_ok($$ select knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000004', current_setting('t.b4tok'), 300) $$,
  '55P03', null, 'en udløbet lease kan ikke genoplives');
select throws_ok($$ select knowledge.worker_store_pages('55000000-0000-4000-a000-000000000004', current_setting('t.b4tok'),
  '[{"page_number":1,"text":"x","has_text_layer":true,"char_start":0,"char_end":1}]', 1, 1, 'application/pdf', 'test/1') $$,
  '55P03', null, 'en udløbet lease kan ikke skrive');
reset role;
set local role ingestion_worker_login_green;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('green-b', 300);
  perform set_config('t.g4', to_jsonb(c)::text, true);
  perform set_config('t.g4tok', coalesce(c.lease_token, ''), true);
end $$;
select is((current_setting('t.g4')::jsonb ->> 'job_id')::uuid, '55000000-0000-4000-a000-000000000004'::uuid, 'green overtager det udløbne job');
select is((current_setting('t.g4')::jsonb ->> 'attempts')::int, 2, 'overtagelsen tæller et forsøg');
select isnt(current_setting('t.g4tok'), current_setting('t.b4tok'), 'overtagelsen giver et nyt token');
reset role;
set local role ingestion_worker_login_blue;
select throws_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000004', current_setting('t.b4tok'), '{}') $$,
  '55P03', null, 'det gamle (forældede) token virker ikke efter overtagelsen');
reset role;

-- Ulovlig tilstandsovergang: versionen er ikke længere under behandling.
update knowledge.document_versions set status = 'processing_failed' where id = '54000000-0000-4000-a000-000000000004';
set local role ingestion_worker_login_green;
select throws_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), '{}') $$,
  '23514', null, 'afslutning afvises, når versionen ikke længere behandles (databasens statusmaskine)');
select throws_ok($$ select * from knowledge.worker_issue_storage_ticket('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), 'download_original') $$,
  '23514', null, 'ingen billet til en version, der ikke behandles');
reset role;

-- Re-embedding-job: ingen sider, chunks eller original.
insert into knowledge.ingestion_jobs (id, document_version_id, kind) values ('55000000-0000-4000-a000-000000000008', '54000000-0000-4000-a000-000000000001', 'reembed');
set local role ingestion_worker_login_blue;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('blue-a', 300);
  perform set_config('t.b8', to_jsonb(c)::text, true);
  perform set_config('t.b8tok', coalesce(c.lease_token, ''), true);
end $$;
select is(current_setting('t.b8')::jsonb ->> 'kind', 'reembed', 'blue tager et re-embedding-job');
select throws_ok($$ select knowledge.worker_store_pages('55000000-0000-4000-a000-000000000008', current_setting('t.b8tok'),
  '[{"page_number":1,"text":"x","has_text_layer":true,"char_start":0,"char_end":1}]', 1, 1, 'application/pdf', 'test/1') $$,
  '22023', null, 'et re-embedding-job kan ikke erstatte sider');
select throws_ok($$ select knowledge.worker_store_chunks('55000000-0000-4000-a000-000000000008', current_setting('t.b8tok'), '[{}]', 'test/1') $$,
  '22023', null, 'et re-embedding-job kan ikke erstatte chunks');
select throws_ok($$ select * from knowledge.worker_issue_storage_ticket('55000000-0000-4000-a000-000000000008', current_setting('t.b8tok'), 'download_original') $$,
  '23514', null, 'et re-embedding-job får ingen billet til originalen');
select lives_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000008', current_setting('t.b8tok'), '{}') $$,
  're-embedding-jobbet afsluttes');
reset role;
select is((select status from knowledge.document_versions where id = '54000000-0000-4000-a000-000000000001'), 'processed',
  'et re-embedding-job ændrer ikke versionens status');

-- En lease uden identitet er værdiløs: en spærret rolle kan ikke bruge et gyldigt token.
select pg_temp.ready('55000000-0000-4000-a000-000000000005');
set local role ingestion_worker_login_blue;
do $$ declare c record; begin
  select * into c from knowledge.worker_claim_job('blue-a', 300);
  perform set_config('t.b5tok', coalesce(c.lease_token, ''), true);
end $$;
reset role;
select ops.ingestion_worker_emergency_revoke('ingestion_worker_login_blue');
set local role ingestion_worker_login_blue;
select throws_ok($$ select knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000005', current_setting('t.b5tok'), 300) $$,
  '42501', null, 'efter nødspærring afvises selv et gyldigt token');
reset role;
select is((select status from knowledge.ingestion_jobs where id = '55000000-0000-4000-a000-000000000005'), 'running',
  'nødspærringen ændrer ikke jobbet; leasen udløber og overtages');
select ops.ingestion_worker_prepare('ingestion_worker_login_blue');

-- ---------------------------------------------------------------------------
-- 4. Inputvalidering.
-- ---------------------------------------------------------------------------

set local role ingestion_worker_login_green;
select throws_ok($$ select * from knowledge.worker_claim_job('green-a', 10) $$, '22023', null, 'for kort lease afvises');
select throws_ok($$ select * from knowledge.worker_claim_job('green-a', 901) $$, '22023', null, 'for lang lease afvises');
select throws_ok($$ select * from knowledge.worker_claim_job('green a; drop', 300) $$, '22023', null, 'en ugyldig worker-etiket afvises');
select throws_ok($$ select * from knowledge.worker_claim_job(null, 300) $$, '22023', null, 'en manglende worker-etiket afvises');
select throws_ok($$ select knowledge.worker_heartbeat('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), 5) $$,
  '22023', null, 'heartbeat med en ugyldig varighed afvises');
reset role;
update knowledge.document_versions set status = 'processing' where id = '54000000-0000-4000-a000-000000000004';
set local role ingestion_worker_login_green;
select throws_ok($$ select knowledge.worker_checkpoint('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), 'Bad Step', '{}') $$,
  '22023', null, 'et ugyldigt trinnavn afvises');
select throws_ok($$ select knowledge.worker_checkpoint('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), 'validation', '[1]') $$,
  '22023', null, 'en tilstand, der ikke er et objekt, afvises');
select throws_ok($$ select knowledge.worker_store_pages('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), '{}', 1, 1, 'application/pdf', 'test/1') $$,
  '22023', null, 'sider, der ikke er en liste, afvises');
select throws_ok($$ select knowledge.worker_store_pages('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'),
  '[{"page_number":1,"text":"x","has_text_layer":true,"char_start":0,"char_end":1}]', 1, 1, 'text/html', 'test/1') $$,
  '22023', null, 'en anden filtype end PDF afvises');
select throws_ok($$ select knowledge.worker_store_chunks('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), '[]', 'test/1') $$,
  '22023', null, 'en tom chunkliste afvises');
select throws_ok($$ select knowledge.worker_store_embeddings('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'),
  '56000000-0000-4000-a000-000000000001', '"x"') $$, '22023', null, 'embeddings, der ikke er en liste, afvises');
select throws_ok($$ select knowledge.worker_complete_job('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), '[1]') $$,
  '22023', null, 'en kvalitetsrapport, der ikke er et objekt, afvises');
select throws_ok($$ select knowledge.worker_fail_job('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), 'Not-A-Code', 'x', true) $$,
  '22023', null, 'en ugyldig fejlkode afvises');
select throws_ok($$ select knowledge.worker_fail_job('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), 'x', 'y', null) $$,
  '22023', null, 'et manglende genforsøgsvalg afvises');
select throws_ok($$ select * from knowledge.worker_issue_storage_ticket('55000000-0000-4000-a000-000000000004', current_setting('t.g4tok'), 'quarantine') $$,
  '22023', null, 'et billetformål uden for kontrakten afvises (karantæne er ikke en del af deltrinnet)');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Billetter: engangsbrug, udløb, lease-binding, kun service_role.
-- ---------------------------------------------------------------------------

select ok((select token_hash = sha256(convert_to(current_setting('t.ticket1'), 'UTF8'))
                  and position(current_setting('t.ticket1') in row_to_json(t)::text) = 0
                  and job_id = '55000000-0000-4000-a000-000000000001' and document_version_id = '54000000-0000-4000-a000-000000000001'
                  and object_path = 'pgtap-lease/1.pdf' and purpose = 'download_original'
           from knowledge.worker_storage_tickets t where job_id = '55000000-0000-4000-a000-000000000001'),
  'billetten gemmes som hash, bundet til job, version, sti og formål');

-- Billet 1 blev udstedt under en lease, der nu er afsluttet: kan ikke indløses.
set local role service_role;
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket1')) $$,
  '28000', null, 'en billet fra en afsluttet lease kan ikke indløses');
reset role;

select pg_temp.ready('55000000-0000-4000-a000-000000000006');
set local role ingestion_worker_login_green;
do $$ declare c record; t record; begin
  select * into c from knowledge.worker_claim_job('green-a', 300);
  perform set_config('t.g6tok', coalesce(c.lease_token, ''), true);
  select * into t from knowledge.worker_issue_storage_ticket(c.job_id, c.lease_token, 'download_original');
  perform set_config('t.ticket6', t.ticket, true);
  select * into t from knowledge.worker_issue_storage_ticket(c.job_id, c.lease_token, 'download_original');
  perform set_config('t.ticket6b', t.ticket, true);
  select * into t from knowledge.worker_issue_storage_ticket(c.job_id, c.lease_token, 'download_original');
end $$;
select throws_ok($$ select * from knowledge.worker_issue_storage_ticket('55000000-0000-4000-a000-000000000006', current_setting('t.g6tok'), 'download_original') $$,
  '54000', null, 'højst tre ubrugte billetter pr. job');
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket6')) $$,
  '42501', null, 'workeren kan ikke selv indløse en billet');
reset role;
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket6')) $$,
  '42501', null, 'ejeren (postgres) kan ikke indløse en billet');
set local role authenticated;
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket6')) $$,
  '42501', null, 'en bruger kan ikke indløse en billet');
reset role;
set local role service_role;
select results_eq($$ select bucket, object_path, purpose, checksum_sha256 from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket6')) $$,
  $$ values ('knowledge-originals'::text, 'pgtap-lease/6.pdf'::text, 'download_original'::text, repeat('6', 64)) $$,
  'service_role indløser en gyldig billet til præcis én operation');
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket6')) $$,
  '28000', null, 'en billet kan kun bruges én gang');
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(md5('a') || md5('b')) $$,
  '28000', null, 'en forfalsket billet afvises');
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket('not a ticket') $$,
  '28000', null, 'en billet i forkert format afvises');
reset role;
update knowledge.worker_storage_tickets set issued_at = now() - interval '2 minutes', expires_at = now() - interval '61 seconds'
where token_hash = sha256(convert_to(current_setting('t.ticket6b'), 'UTF8'));
set local role service_role;
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket6b')) $$,
  '28000', null, 'en udløbet billet afvises');
reset role;
select throws_ok($$ insert into knowledge.worker_storage_tickets (token_hash, job_id, document_version_id, bucket, object_path, purpose, lease_token_hash, expires_at)
  values (sha256('x'), '55000000-0000-4000-a000-000000000006', '54000000-0000-4000-a000-000000000006', 'knowledge-originals', 'p', 'download_original', sha256('y'), now() + interval '1 hour') $$,
  '23514', null, 'en billet kan ikke gælde i mere end 60 sekunder');
select ok(not has_table_privilege('service_role', 'knowledge.worker_storage_tickets', 'SELECT,INSERT,UPDATE,DELETE')
          and not has_table_privilege('authenticated', 'knowledge.worker_storage_tickets', 'SELECT,INSERT,UPDATE,DELETE'),
  'ingen rolle har direkte adgang til billettabellen');

-- Ny lease efter udløb gør billetter fra den gamle lease ugyldige.
select pg_temp.ready('55000000-0000-4000-a000-000000000007');
set local role ingestion_worker_login_green;
do $$ declare c record; t record; begin
  select * into c from knowledge.worker_claim_job('green-a', 300);
  select * into t from knowledge.worker_issue_storage_ticket(c.job_id, c.lease_token, 'download_original');
  perform set_config('t.ticket7', t.ticket, true);
end $$;
reset role;
update knowledge.ingestion_jobs set locked_until = now() - interval '1 second' where id = '55000000-0000-4000-a000-000000000007';
set local role service_role;
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket7')) $$,
  '28000', null, 'en billet kan ikke indløses, når leasen er udløbet');
reset role;
set local role ingestion_worker_login_blue;
select is((select job_id from knowledge.worker_claim_job('blue-b', 300)), '55000000-0000-4000-a000-000000000007'::uuid, 'blue overtager job 7');
reset role;
set local role service_role;
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(current_setting('t.ticket7')) $$,
  '28000', null, 'en billet fra en overtaget lease kan ikke indløses');
reset role;

select * from finish();
rollback;
