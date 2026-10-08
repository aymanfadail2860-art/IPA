-- pgTAP: 8B-I7 — miljøets art, systemstatus, sundhedskontrollens API og rettigheder
-- (docs/08b §4.5, §14, §21.12). Regression og performance-målinger testes sammen med registret
-- (retrieval_configuration_registry.test.sql), hvor kørslerne findes.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(36);

create function pg_temp.as_user(p_auth uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
end $f$;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('61000000-0000-4000-a000-000000000001', 'i7.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP I7 Administrator"}'),
  ('61000000-0000-4000-a000-000000000002', 'i7.advisor@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP I7 Rådgiver"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r
  on r.key = case when u.auth_id = '61000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id in ('61000000-0000-4000-a000-000000000001', '61000000-0000-4000-a000-000000000002');

-- ----------------------------------------------------------------------------
-- 1. Miljøets art: kun ejeren sætter den; alle kan læse den; den auditeres
-- ----------------------------------------------------------------------------

delete from ops.environment;
select is(knowledge.environment_kind(), 'unset', 'uden en angivet art er miljøet "unset" — ikke et evalueringsmiljø');
select lives_ok($$ select ops.set_environment_kind('evaluation') $$, 'databasens ejer angiver arten');
select is(knowledge.environment_kind(), 'evaluation', 'arten læses af evalueringen');
select throws_ok($$ select ops.set_environment_kind('anything') $$, '22023', null, 'en ukendt art afvises');
select ok(exists (select 1 from audit.audit_log where action = 'ops.environment.set' and entity_id = 'evaluation'), 'ændringen auditeres');
select is((select count(*)::int from ops.environment), 1, 'der er højst én art');
select lives_ok($$ select ops.set_environment_kind('production') $$, 'arten kan ændres af ejeren (med audit)');
select is(knowledge.environment_kind(), 'production', 'den nye art gælder');

select pg_temp.as_user('61000000-0000-4000-a000-000000000001');
set local role authenticated;
select is(knowledge.environment_kind(), 'production', 'en indlogget bruger kan læse arten (evalueringen kører som evalueringsbruger)');
select throws_ok($$ select ops.set_environment_kind('evaluation') $$, '42501', null, 'selv en administrator kan ikke ændre arten');
select throws_ok($$ select * from ops.environment $$, '42501', null, 'tabellen kan ikke læses direkte');
reset role;
set local role service_role;
select throws_ok($$ select ops.set_environment_kind('evaluation') $$, '42501', null, 'service_role kan ikke ændre arten');
reset role;
set local role anon;
select throws_ok($$ select knowledge.environment_kind() $$, '42501', null, 'anon kan ikke læse arten');
reset role;

-- ----------------------------------------------------------------------------
-- 2. Systemstatus: tal og id'er, aldrig indhold — og den rigtige læser
-- ----------------------------------------------------------------------------

select is((select array_agg(k order by k) from jsonb_object_keys(ops.system_health()) k),
  array['configuration', 'environment', 'evaluation', 'failures', 'generatedAt', 'performance', 'processing', 'queue', 'scanner'],
  'systemstatus har netop sine afsnit');
select is((ops.system_health() #>> '{queue,queued}')::int, (select count(*)::int from knowledge.ingestion_jobs where status = 'queued'), 'køen tælles som i tabellen');
select is((ops.system_health() #>> '{failures,failedLast24h}')::int,
  (select count(*)::int from knowledge.ingestion_jobs where status = 'failed' and finished_at > now() - interval '24 hours'), 'fejl i døgnet tælles som i tabellen');
select is((ops.system_health() #>> '{processing,stuckOverOneHour}')::int,
  (select count(*)::int from knowledge.document_versions where status = 'processing' and updated_at < now() - interval '1 hour'), 'versioner under behandling over en time tælles');
select ok(ops.system_health()::text !~* '"(title|text|excerpt|query|email|name|description)"',
  'systemstatus indeholder ingen titler, tekster, forespørgsler, navne eller e-mails');

select pg_temp.as_user('61000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ select knowledge.system_status() $$, '42501', null, 'en rådgiver kan ikke læse systemstatus');
select throws_ok($$ select ops.system_health() $$, '42501', null, 'ingen kan kalde ops.system_health direkte');
select throws_ok($$ select knowledge.worker_system_health() $$, '42501', null, 'en bruger kan ikke kalde workerens sundhedskontrol');
reset role;
select pg_temp.as_user('61000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok($$ select knowledge.system_status() $$, 'en administrator med system.settings.manage læser systemstatus');
reset role;

-- ----------------------------------------------------------------------------
-- 3. Workerens og publisherens API — og intet andet
-- ----------------------------------------------------------------------------

select ok('knowledge.worker_system_health()'::regprocedure = any (ops.ingestion_worker_api()), 'sundhedskontrollen er en del af worker-API''et');
select ok(has_function_privilege('ingestion_worker', 'knowledge.worker_system_health()', 'EXECUTE'), 'ingestion_worker kan køre sundhedskontrollen');
select ok(not (ops.ingestion_worker_status() -> 'violations') ? 'extra_executable_functions'
          and (ops.ingestion_worker_status() #>> '{api,granted}') = (ops.ingestion_worker_status() #>> '{api,expected}'),
  'workerens rolle har stadig kun API''et: alle API-funktioner og ingen ekstra');
select ok('knowledge.record_performance_measurement(jsonb)'::regprocedure = any (ops.evaluation_publisher_api()), 'performance-målinger er en del af publisherens API');
select ok(has_function_privilege('evaluation_publisher', 'knowledge.record_performance_measurement(jsonb)', 'EXECUTE'), 'evaluation_publisher kan registrere målinger');
select ok(not has_function_privilege('evaluation_publisher', 'knowledge.worker_system_health()', 'EXECUTE')
          and not has_function_privilege('evaluation_publisher', 'knowledge.system_status()', 'EXECUTE')
          and not has_function_privilege('evaluation_publisher', 'knowledge.accept_performance_deviation(uuid, text)', 'EXECUTE'),
  'publisheren kan hverken læse systemstatus eller godkende afvigelser');
select ok(not has_function_privilege('authenticated', 'knowledge.record_performance_measurement(jsonb)', 'EXECUTE')
          and not has_function_privilege('service_role', 'knowledge.record_performance_measurement(jsonb)', 'EXECUTE'),
  'hverken brugere eller service_role kan registrere en måling');
select ok(not has_table_privilege('authenticated', 'knowledge.performance_measurements', 'INSERT')
          and not has_table_privilege('authenticated', 'knowledge.performance_deviation_acceptances', 'INSERT')
          and not has_table_privilege('service_role', 'knowledge.performance_measurements', 'SELECT'),
  'ingen app-rolle kan skrive målinger eller godkendelser direkte');
-- Retrieval-telemetriens trin måles uden for databasen; triggeren for regression findes.
select ok(exists (select 1 from pg_trigger where tgname = 'evaluation_runs_regression_audit' and tgrelid = 'knowledge.evaluation_runs'::regclass),
  'en registreret kørsel af konfigurationen i drift auditeres som regression');

-- ----------------------------------------------------------------------------
-- 4. Grænser og identiteter, der ikke kan lånes
-- ----------------------------------------------------------------------------

-- Ejeren har EXECUTE, men ikke rollens identitet: kontrollen i funktionen er den sidste grænse.
select throws_ok($$ select knowledge.record_performance_measurement('{}'::jsonb) $$, '42501', null,
  'heller ikke ejeren kan registrere en måling uden publisherens identitet');
select throws_ok($$ select knowledge.worker_system_health() $$, '42501', null,
  'heller ikke ejeren kan køre sundhedskontrollen uden workerens identitet');

-- Målene er grænser (≤): lig med grænsen er nået, én over er ikke; uden målinger er målet ikke målt.
select is((select jsonb_object_agg(r ->> 'target', r ->> 'status') from jsonb_array_elements(knowledge.performance_results(
    '{"targets": "performance-targets-v1", "retrieval": {"total": [800], "queryEmbedding": [300], "search": [301], "rerank": []},
      "ingestion": {"documents": [{"pages": 50, "seconds": 300}], "corpusPages": 1999, "corpusSeconds": 10}}'::jsonb)) r),
  '{"retrieval_total_p50": "met", "retrieval_total_p95": "met", "query_embedding_p95": "met", "search_p95": "not_met",
    "rerank_p95": "not_measured", "ingestion_50_pages_seconds": "met", "ingestion_corpus_2000_pages_seconds": "not_measured"}'::jsonb,
  'grænsen er inklusiv, og et korpus under 2.000 sider måler ikke korpusmålet');

-- "Under behandling over en time": 61 minutter tæller, 59 gør ikke.
insert into knowledge.products (id, name) values ('62000000-0000-4000-a000-000000000001', 'pgTAP I7 Produkt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-000000000001', '62000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP I7'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, valid_from, storage_path, checksum_sha256)
select ('64000000-0000-4000-a000-00000000000' || i)::uuid, '63000000-0000-4000-a000-000000000001', make_date(2030 + i, 1, 1),
       'pgtap-i7/' || i || '.pdf', repeat(i::text, 64)
from generate_series(1, 2) i;
select set_config('t.stuck', ops.system_health() #>> '{processing,stuckOverOneHour}', true);
update knowledge.document_versions set status = 'processing'
where id in ('64000000-0000-4000-a000-000000000001', '64000000-0000-4000-a000-000000000002');
alter table knowledge.document_versions disable trigger document_versions_touch_updated_at;
update knowledge.document_versions set updated_at = now() - interval '59 minutes' where id = '64000000-0000-4000-a000-000000000001';
update knowledge.document_versions set updated_at = now() - interval '61 minutes' where id = '64000000-0000-4000-a000-000000000002';
alter table knowledge.document_versions enable trigger document_versions_touch_updated_at;
select is((ops.system_health() #>> '{processing,stuckOverOneHour}')::int - current_setting('t.stuck')::int, 1,
  'kun versionen, der har været under behandling i over en time, tæller');
select is((ops.system_health() #>> '{processing,stuckOverOneHour}')::int,
  (select count(*)::int from knowledge.document_versions where status = 'processing' and updated_at < now() - interval '1 hour'),
  'tallet svarer stadig til tabellen');

select * from finish();
rollback;
