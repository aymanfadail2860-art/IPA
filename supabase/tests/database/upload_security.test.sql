-- pgTAP: 8B-I5 — upload-sikkerhed, karantæne og malware-scanning (docs/08b §21.6).
-- Tilstandsmaskinen, det afledte verdict, checksum-bindingen, release-gaten og forsøg på at
-- omgå dem: spoofet "safe", direkte statusopdateringer, genbrug af verdict, re-embedding,
-- parallelle flytninger og ældre politikker. Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(115);

-- Kun testens jobs er klar.
update knowledge.ingestion_jobs set next_attempt_at = now() + interval '1 day' where status = 'queued';
update knowledge.ingestion_jobs set locked_until = now() + interval '1 day' where status = 'running';

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('90000000-0000-4000-a000-000000000001', 'sec.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Sikkerhedsadmin"}'),
  ('90000000-0000-4000-a000-000000000002', 'sec.adv@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Sikkerhedsrådgiver"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r
  on r.key = case when u.auth_id = '90000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id in ('90000000-0000-4000-a000-000000000001', '90000000-0000-4000-a000-000000000002');
insert into knowledge.products (id, name) values ('92000000-0000-4000-a000-000000000001', 'pgTAP Sikkerhedsprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '93000000-0000-4000-a000-000000000001', '92000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Sikkerhed'
from knowledge.sources where type = 'manual_upload';

select ops.ingestion_worker_prepare('ingestion_worker_login_blue');
grant ingestion_worker_login_blue to postgres with inherit false, set true;
grant usage on schema extensions to ingestion_worker_login_blue;

-- ---------------------------------------------------------------------------
-- Hjælpere (kun i denne session)
-- ---------------------------------------------------------------------------
create function pg_temp.v(p_n int) returns uuid language sql immutable as
  $$ select ('94000000-0000-4000-a000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.sha(p_n int) returns text language sql immutable as
  $$ select encode(sha256(('sikkerhed-' || p_n)::bytea), 'hex') $$;
-- En version i karantæne med sit scan-job, som efter en upload.
create function pg_temp.upload(p_n int) returns void language plpgsql as $$
begin
  insert into knowledge.document_versions (id, document_id, valid_from, storage_path, checksum_sha256, byte_size, mime_type, original_filename)
  values (pg_temp.v(p_n), '93000000-0000-4000-a000-000000000001', make_date(2030 + p_n, 1, 1),
          '93000000-0000-4000-a000-000000000001/' || pg_temp.v(p_n) || '/original.pdf', pg_temp.sha(p_n), 1000 + p_n, 'application/pdf', 'v' || p_n || '.pdf');
  insert into knowledge.ingestion_jobs (document_version_id, kind, next_attempt_at) values (pg_temp.v(p_n), 'scan', now() + interval '1 day');
end $$;
-- Workerens måleresultater for version n: alt bestået, medmindre p_patch siger andet.
create function pg_temp.m(p_n int, p_patch jsonb default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'policy_version', 'pdf-v1', 'checksum_sha256', pg_temp.sha(p_n), 'byte_size', 1000 + p_n, 'detected_mime', 'application/pdf',
    'structural', jsonb_build_object('result', 'pass', 'code', null),
    'malware', jsonb_build_object('result', 'clean', 'code', null, 'name', null),
    'scanner', jsonb_build_object('engine', 'ClamAV', 'engine_version', '1.4.3', 'signature_version', '27790',
                                  'signature_time', now() - interval '2 hours'),
    'pdf_security', jsonb_build_object('result', 'pass', 'code', null),
    'active_content', jsonb_build_object('result', 'pass', 'findings', '[]'::jsonb)) || p_patch
$$;
-- Workeren (blue) tager versionens job af den givne art. Token og job-id gemmes i sessionen.
create function pg_temp.claim(p_n int, p_kind text default 'scan') returns jsonb language plpgsql as $$
declare r jsonb;
begin
  update knowledge.ingestion_jobs set next_attempt_at = now() + interval '1 day' where status = 'queued';
  update knowledge.ingestion_jobs set next_attempt_at = now() - interval '1 second'
  where status = 'queued' and document_version_id = pg_temp.v(p_n) and kind = p_kind;
  set local role ingestion_worker_login_blue;
  select to_jsonb(c) into r from knowledge.worker_claim_job('pgtap-sec', 300) c;
  reset role;
  perform set_config('t.tok' || p_n, coalesce(r ->> 'lease_token', ''), true);
  perform set_config('t.job' || p_n, coalesce(r ->> 'job_id', ''), true);
  return r;
end $$;
create function pg_temp.job(p_n int) returns uuid language sql stable as $$ select nullif(current_setting('t.job' || p_n), '')::uuid $$;
create function pg_temp.tok(p_n int) returns text language sql stable as $$ select current_setting('t.tok' || p_n) $$;
create function pg_temp.record(p_n int, p_m jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role ingestion_worker_login_blue;
  r := knowledge.worker_record_security_verdict(pg_temp.job(p_n), pg_temp.tok(p_n), p_m);
  reset role;
  return r;
end $$;
create function pg_temp.ticket(p_n int, p_purpose text) returns text language plpgsql as $$
declare r text;
begin
  set local role ingestion_worker_login_blue;
  select ticket into r from knowledge.worker_issue_storage_ticket(pg_temp.job(p_n), pg_temp.tok(p_n), p_purpose);
  reset role;
  return r;
end $$;
create function pg_temp.clear(p_n int, p_sha text default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role ingestion_worker_login_blue;
  r := knowledge.worker_security_clearance(pg_temp.job(p_n), pg_temp.tok(p_n), p_sha);
  reset role;
  return r;
end $$;
create function pg_temp.complete(p_n int) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role ingestion_worker_login_blue;
  r := knowledge.worker_complete_job(pg_temp.job(p_n), pg_temp.tok(p_n), null);
  reset role;
  return r;
end $$;
create function pg_temp.fail(p_n int, p_retry boolean) returns text language plpgsql as $$
declare r text;
begin
  set local role ingestion_worker_login_blue;
  r := knowledge.worker_fail_job(pg_temp.job(p_n), pg_temp.tok(p_n), 'pgtap_failure', 'pgTAP', p_retry);
  reset role;
  return r;
end $$;
-- Lagerfunktionen (service_role i Supabase): indløs og bekræft.
create function pg_temp.redeem(p_ticket text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  select to_jsonb(t) into r from knowledge.redeem_worker_storage_ticket(p_ticket) t;
  reset role;
  return r;
end $$;
create function pg_temp.confirm(p_ticket_id uuid, p_sha text) returns text language plpgsql as $$
declare r text;
begin
  set local role service_role;
  r := knowledge.confirm_worker_storage_operation(p_ticket_id, p_sha);
  reset role;
  return r;
end $$;
create function pg_temp.state(p_n int) returns text language sql stable as $$
  select security_state || '/' || storage_bucket || '/' || status from knowledge.document_versions where id = pg_temp.v(p_n)
$$;
create function pg_temp.as_user(p_auth text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- 1. Buckets, tabeller og rettigheder
-- ---------------------------------------------------------------------------
select ok((select not public and allowed_mime_types = array['application/pdf'] and file_size_limit = 52428800
           from storage.buckets where id = 'knowledge-intake'), 'karantænen (knowledge-intake) er privat, kun PDF, højst 50 MB');
select ok((select not public from storage.buckets where id = 'knowledge-quarantine'), 'afviste filer ligger i en privat bucket');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'knowledge_%'),
  array['knowledge_intake_insert', 'knowledge_originals_select'],
  'kun to politikker: upload til karantænen og læsning af frigivne originaler');
select is((select cmd::text from pg_policies where schemaname = 'storage' and policyname = 'knowledge_intake_insert'), 'INSERT',
  'karantænen kan ikke læses, ændres eller slettes gennem API''et — kun uploades til');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('knowledge.security_verdicts'::regclass, 'knowledge.security_policies'::regclass, 'knowledge.security_development_scanners'::regclass)),
  'RLS er slået til på sikkerhedstabellerne');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'ingestion_worker']) r,
                                    unnest(array['knowledge.security_verdicts', 'knowledge.security_policies', 'knowledge.security_development_scanners']) t
                      where has_table_privilege(r, t, 'SELECT,INSERT,UPDATE,DELETE')),
  'ingen klient, service_role eller worker har tabelrettigheder på verdicts, politikker eller udviklingsscannere');
-- (Lokalt er service_role medlem af workerens gruppe via seedet; i produktion er den ikke.)
revoke ingestion_worker from service_role;
select ok(not has_function_privilege('authenticated', 'knowledge.worker_record_security_verdict(uuid, text, jsonb)', 'execute')
          and not has_function_privilege('service_role', 'knowledge.worker_record_security_verdict(uuid, text, jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'knowledge.confirm_worker_storage_operation(uuid, text)', 'execute')
          and not has_function_privilege('ingestion_worker', 'knowledge.confirm_worker_storage_operation(uuid, text)', 'execute')
          and not has_function_privilege('ingestion_worker', 'knowledge.security_block_reason(uuid, text)', 'execute'),
  'kun workeren indberetter, kun lagerfunktionen bekræfter, ingen kalder afledningen direkte');
grant ingestion_worker to service_role;
select is((select version from knowledge.active_security_policy()), 'pdf-v1', 'den aktive sikkerhedspolitik er pdf-v1');
select is((select max_signature_age from knowledge.security_policies where version = 'pdf-v1'), interval '24 hours',
  'signaturer må højst være 24 timer gamle');

-- ---------------------------------------------------------------------------
-- 2. Upload → karantæne. Ingen genvej til frigivelse.
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, metadata)
values ('knowledge-intake', '93000000-0000-4000-a000-000000000001/' || pg_temp.v(1) || '/original.pdf', '{"size": 1001, "mimetype": "application/pdf"}');
select pg_temp.as_user('90000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.register_upload(%L, '93000000-0000-4000-a000-000000000001', null, '1', 'da',
                          '2031-01-01', null, %L, 'v1.pdf') $$, pg_temp.v(1), pg_temp.sha(1)),
  'administratoren registrerer en upload fra karantænen');
reset role;
select is(pg_temp.state(1), 'quarantined/knowledge-intake/uploaded', 'en ny version er i karantæne i knowledge-intake');
select is((select array_agg(kind || ':' || status) from knowledge.ingestion_jobs where document_version_id = pg_temp.v(1)), array['scan:queued'],
  'kun sikkerhedskontrollen sættes i kø — ingen behandling før frigivelse');
update knowledge.ingestion_jobs set next_attempt_at = now() + interval '1 day' where document_version_id = pg_temp.v(1);

select throws_ok($$ insert into knowledge.document_versions (document_id, storage_path, checksum_sha256, security_state)
                    values ('93000000-0000-4000-a000-000000000001', 'x/y.pdf', repeat('e', 64), 'released') $$,
  '23514', null, 'en version kan ikke oprettes som frigivet — heller ikke af ejeren');
select pg_temp.as_user('90000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok(format($$ update knowledge.document_versions set security_state = 'released' where id = %L $$, pg_temp.v(1)),
  '42501', null, 'en administrator kan ikke sætte sikkerhedstilstanden fra klienten');
select throws_ok(format($$ insert into knowledge.security_verdicts (document_version_id, policy_version, checksum_sha256, byte_size,
    detected_mime, object_bucket, object_path, structural_result, malware_result, pdf_security_result, active_content_result, final_verdict)
    values (%L, 'pdf-v1', repeat('a', 64), 1, 'application/pdf', 'x', 'y', 'pass', 'clean', 'pass', 'pass', 'safe') $$, pg_temp.v(1)),
  '42501', null, 'en klient kan ikke indsætte et "safe" verdict');
reset role;
set local role service_role;
select throws_ok(format($$ update knowledge.document_versions set security_state = 'released', storage_bucket = 'knowledge-originals' where id = %L $$, pg_temp.v(1)),
  '42501', null, 'service_role kan heller ikke sætte sikkerhedstilstanden direkte');
reset role;
select throws_ok(format($$ update knowledge.document_versions set security_state = 'released' where id = %L $$, pg_temp.v(1)),
  '23514', null, 'selv ejeren kan ikke springe fra karantæne til frigivet');
select throws_ok(format($$ update knowledge.document_versions set status = 'processing' where id = %L;
                           update knowledge.document_versions set status = 'processed' where id = %L $$, pg_temp.v(1), pg_temp.v(1)),
  '23514', null, 'en version kan ikke blive behandlet uden frigivelse — for alle roller');

-- ---------------------------------------------------------------------------
-- 3. Scan → verdict (afledt af databasen) → frigivelse med checksum → behandling
-- ---------------------------------------------------------------------------
select is((pg_temp.claim(1)) ->> 'kind', 'scan', 'workeren tager scan-jobbet');
select is(pg_temp.state(1), 'scanning/knowledge-intake/processing', 'versionen scannes (Scanner)');
set local role ingestion_worker_login_blue;
select is((knowledge.worker_security_scan_context(pg_temp.job(1), pg_temp.tok(1))) ->> 'policy_version', 'pdf-v1',
  'scan-konteksten giver politikken og dens grænser');
reset role;
select throws_ok($$ select pg_temp.ticket(1, 'download_original') $$, '23514', null,
  'en fil i karantæne kan ikke hentes til behandling');
select throws_ok($$ select pg_temp.ticket(1, 'release_original') $$, '23514', null,
  'intet verdict: ingen frigivelse');
select throws_ok($$ select pg_temp.clear(1) $$, '22023', null, 'et scan-job har ingen release-gate');
select is((pg_temp.redeem(pg_temp.ticket(1, 'scan_original'))) ->> 'bucket', 'knowledge-intake',
  'scan-billetten giver kun filen i karantænen');

select is((pg_temp.record(1, pg_temp.m(1))) ->> 'final', 'safe', 'alle kontroller bestået → databasen afleder safe');
select is(pg_temp.state(1), 'scanning/knowledge-intake/processing', 'safe er ikke frigivet: filen er stadig i karantæne');
select is(knowledge.security_block_reason(pg_temp.v(1), null), 'not_released', 'release-gaten er lukket før frigivelsen');
select is((select final_verdict || '/' || scanner_engine || '/' || signature_version || '/' || policy_version || '/' || checksum_sha256
           from knowledge.security_verdicts where document_version_id = pg_temp.v(1)),
  'safe/ClamAV/27790/pdf-v1/' || pg_temp.sha(1), 'verdict registrerer scanner, signaturversion, politik og checksum');

do $$ begin perform set_config('t.rel1', pg_temp.ticket(1, 'release_original'), true); end $$;
select throws_ok($$ select pg_temp.ticket(1, 'release_original') $$, '55006', null,
  'kun én frigivelse ad gangen (parallelle flytninger afvises)');
do $$ begin perform set_config('t.red1', pg_temp.redeem(current_setting('t.rel1'))::text, true); end $$;
select is((current_setting('t.red1')::jsonb ->> 'operation') || '>' || (current_setting('t.red1')::jsonb ->> 'destination_bucket'),
  'release>knowledge-originals', 'frigivelsesbilletten flytter netop denne fil til knowledge-originals');
select is(current_setting('t.red1')::jsonb ->> 'checksum_sha256', pg_temp.sha(1), 'billetten bærer den scannede checksum');
select is(pg_temp.confirm((current_setting('t.red1')::jsonb ->> 'ticket_id')::uuid, pg_temp.sha(1)), 'released',
  'samme bytes som scannet → frigivet');
select is(pg_temp.state(1), 'released/knowledge-originals/processing', 'Godkendt sikkerhedskontrol: filen ligger i knowledge-originals');
select throws_ok(format($$ select pg_temp.confirm(%L, %L) $$, current_setting('t.red1')::jsonb ->> 'ticket_id', pg_temp.sha(1)),
  '28000', null, 'en bekræftelse kan ikke genbruges');
select is((select count(*)::int from knowledge.ingestion_jobs where document_version_id = pg_temp.v(1) and kind = 'process' and status = 'queued'), 1,
  'behandlingsjobbet oprettes først ved frigivelsen');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.version.security_released' and entity_id = pg_temp.v(1)::text),
  'frigivelsen auditeres');
select is((pg_temp.complete(1)) ->> 'security_state', 'released', 'scan-jobbet afsluttes, når filen er frigivet');
select is(knowledge.security_block_reason(pg_temp.v(1), pg_temp.sha(1)), null, 'release-gaten er åben for de frigivne bytes');

select is((pg_temp.claim(1, 'process')) ->> 'kind', 'process', 'workeren tager behandlingsjobbet');
select is((pg_temp.clear(1)) ->> 'cleared', 'true', 'release-gaten før download: frigivet');
select ok(pg_temp.ticket(1, 'download_original') ~ '^[0-9a-f]{64}$', 'en frigivet original kan hentes til behandling');
select is((pg_temp.clear(1, pg_temp.sha(1))) ->> 'cleared', 'true', 'release-gaten efter download: de samme bytes');
select throws_ok($$ update knowledge.security_verdicts set final_verdict = 'rejected' where final_verdict = 'safe' $$,
  '23514', null, 'et verdict kan ikke ændres — heller ikke af ejeren');
select throws_ok($$ delete from knowledge.security_verdicts $$, '23514', null, 'et verdict kan ikke slettes');

-- En ny politik gør alle verdicts under den gamle forældede (ingen automatisk genscanning i I5).
update knowledge.security_policies set active = false where version = 'pdf-v1';
insert into knowledge.security_policies (version, active, max_signature_age, limits, description)
values ('pdf-v2-pgtap', true, interval '24 hours', '{}', 'pgTAP');
select is((pg_temp.clear(1)) ->> 'reason', 'policy_outdated', 'et verdict under en ældre politik åbner ikke gaten');
update knowledge.security_policies set active = false where version = 'pdf-v2-pgtap';
update knowledge.security_policies set active = true where version = 'pdf-v1';

-- Bytes ændret efter scanningen: verdict ugyldigt, tilbage i karantæne, ny scanning.
select is((pg_temp.clear(1, repeat('0', 64))) ->> 'reason', 'bytes_changed', 'andre bytes end de scannede åbner ikke gaten');
select is(pg_temp.state(1), 'quarantined/knowledge-originals/processing', 'versionen er tilbage i karantæne');
select is((select superseded_reason from knowledge.security_verdicts where document_version_id = pg_temp.v(1)), 'checksum_changed',
  'det gamle verdict er afløst og kan ikke genbruges');
select is((select count(*)::int from knowledge.ingestion_jobs where document_version_id = pg_temp.v(1) and kind = 'scan' and status = 'queued'), 1,
  'en ny scanning er sat i kø');
select is(pg_temp.fail(1, false), 'failed', 'behandlingsjobbet stoppes');
select is((select status from knowledge.document_versions where id = pg_temp.v(1)), 'processing',
  'versionen markeres ikke som mislykket, mens den nye scanning venter');

-- ---------------------------------------------------------------------------
-- 4. Malware → afvist → karantæne-bucketten. Ingen vej tilbage.
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.upload(2); end $$;
select is((pg_temp.claim(2)) ->> 'kind', 'scan', 'scan af version 2');
select is((pg_temp.record(2, pg_temp.m(2, '{"malware": {"result": "infected", "code": null, "name": "Eicar-Test-Signature"}}'))) ->> 'failure_code',
  'malware_detected', 'et fund → afvist: malware');
select is(pg_temp.state(2), 'rejected/knowledge-intake/processing_failed', 'den afviste version kan ikke behandles');
select throws_ok($$ select pg_temp.ticket(2, 'release_original') $$, '23514', null, 'en afvist fil kan ikke frigives');
do $$ begin perform set_config('t.red2', pg_temp.redeem(pg_temp.ticket(2, 'quarantine_original'))::text, true); end $$;
select is((current_setting('t.red2')::jsonb ->> 'operation') || '>' || (current_setting('t.red2')::jsonb ->> 'destination_bucket'),
  'quarantine>knowledge-quarantine', 'karantænebilletten flytter filen til knowledge-quarantine');
select is(pg_temp.confirm((current_setting('t.red2')::jsonb ->> 'ticket_id')::uuid, pg_temp.sha(2)), 'quarantined', 'flytningen bekræftes');
select is(pg_temp.state(2), 'rejected/knowledge-quarantine/processing_failed', 'filen ligger i karantæne-bucketten');
select is((pg_temp.complete(2)) ->> 'security_state', 'rejected', 'scan-jobbet afsluttes efter karantæne');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.version.quarantined' and entity_id = pg_temp.v(2)::text
                  and details ->> 'malware_name' = 'Eicar-Test-Signature'),
  'karantænen auditeres med signaturens navn (aldrig filens indhold)');
select pg_temp.as_user('90000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok(format($$ select knowledge.request_reprocess(%L) $$, pg_temp.v(2)), '23514', null,
  'en afvist fil kan ikke genbehandles — kun en ny version');
select throws_ok(format($$ select knowledge.log_original_download(%L) $$, pg_temp.v(2)), 'P0002', null, 'en afvist fil kan aldrig hentes');
select ok(not knowledge.original_readable('93000000-0000-4000-a000-000000000001/' || pg_temp.v(2) || '/original.pdf'),
  'en afvist fil kan ikke læses fra Storage');
reset role;
-- Omgåelse via re-embedding eller et indsat behandlingsjob: claim annullerer det.
insert into knowledge.ingestion_jobs (document_version_id, kind) values (pg_temp.v(2), 'reembed');
select is(pg_temp.claim(2, 'reembed'), null, 'et re-embedding-job for en ufrigivet version tages aldrig');
select is((select error_code from knowledge.ingestion_jobs where document_version_id = pg_temp.v(2) and kind = 'reembed'), 'security_not_released',
  'jobbet annulleres med årsagen');

-- ---------------------------------------------------------------------------
-- 5. Bytes ændret mellem scanning og frigivelse
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.upload(3); end $$;
select is((pg_temp.claim(3)) ->> 'kind', 'scan', 'scan af version 3');
select is((pg_temp.record(3, pg_temp.m(3))) ->> 'final', 'safe', 'version 3 er safe');
do $$ begin perform set_config('t.red3', pg_temp.redeem(pg_temp.ticket(3, 'release_original'))::text, true); end $$;
select is(pg_temp.confirm((current_setting('t.red3')::jsonb ->> 'ticket_id')::uuid, repeat('f', 64)), 'invalidated',
  'andre bytes ved flytningen → verdict ugyldigt');
select is(pg_temp.state(3), 'quarantined/knowledge-intake/processing', 'versionen er tilbage i karantæne — ikke frigivet');
select is((select count(*)::int from knowledge.ingestion_jobs where document_version_id = pg_temp.v(3) and kind = 'process'), 0,
  'intet behandlingsjob');
select is(pg_temp.fail(3, true), 'retry', 'scan-jobbet prøves igen');
select is((pg_temp.claim(3)) ->> 'kind', 'scan', 'ny scanning');
select is(pg_temp.state(3), 'scanning/knowledge-intake/processing', 'versionen scannes igen');
-- Det gamle (afløste) verdict kan ikke frigives igen (replay).
select is((select count(*)::int from knowledge.security_verdicts where document_version_id = pg_temp.v(3) and superseded_at is null), 0,
  'intet gyldigt verdict efter ugyldiggørelsen');
select throws_ok($$ select pg_temp.ticket(3, 'release_original') $$, '23514', null, 'et afløst verdict kan ikke frigives (replay)');

-- ---------------------------------------------------------------------------
-- 6. Teknisk scanfejl: fail closed. Spoofet "safe" ignoreres.
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.upload(4); end $$;
select is((pg_temp.claim(4)) ->> 'kind', 'scan', 'scan af version 4');
create function pg_temp.rescan(p_n int) returns void language sql as
  $$ update knowledge.document_versions set security_state = 'scanning' where id = pg_temp.v(p_n) and security_state = 'scan_failed' $$;
select is((pg_temp.record(4, pg_temp.m(4, '{"malware": {"result": "error", "code": "scanner_unavailable", "name": null}}'))) ->> 'failure_code',
  'scanner_unavailable', 'scanneren er utilgængelig → teknisk scanfejl');
select is(pg_temp.state(4), 'scan_failed/knowledge-intake/processing', 'Teknisk scanfejl — aldrig frigivet');
do $$ begin perform pg_temp.rescan(4); end $$;
select is((pg_temp.record(4, pg_temp.m(4, '{"malware": {"result": "error", "code": "scanner_timeout", "name": null}}'))) ->> 'failure_code',
  'scanner_timeout', 'timeout → teknisk scanfejl');
do $$ begin perform pg_temp.rescan(4); end $$;
select is((pg_temp.record(4, pg_temp.m(4, jsonb_build_object('final', 'safe', 'final_verdict', 'safe',
  'scanner', jsonb_build_object('engine', 'ClamAV', 'engine_version', '1.4.3', 'signature_version', '27000',
                                'signature_time', now() - interval '3 days'))))) ->> 'failure_code',
  'stale_signatures', 'forældede signaturer → teknisk scanfejl, også med et spoofet "safe" i input');
do $$ begin perform pg_temp.rescan(4); end $$;
select is((pg_temp.record(4, pg_temp.m(4, '{"scanner": {"engine": "ClamAV", "engine_version": "1.4.3", "signature_version": null, "signature_time": null}}'))) ->> 'failure_code',
  'stale_signatures', 'ukendt signaturtid → teknisk scanfejl');
do $$ begin perform pg_temp.rescan(4); end $$;
select is((pg_temp.record(4, pg_temp.m(4, '{"scanner": {"engine": "FakeAV", "engine_version": "1", "signature_version": "1", "signature_time": null}}'))) ->> 'failure_code',
  'scanner_not_allowed', 'en ukendt scanner accepteres ikke');
do $$ begin perform pg_temp.rescan(4); end $$;
select is((pg_temp.record(4, pg_temp.m(4, '{"policy_version": "pdf-v0"}'))) ->> 'failure_code', 'policy_outdated',
  'måling under en anden politik → teknisk scanfejl');
do $$ begin perform pg_temp.rescan(4); end $$;
select is((pg_temp.record(4, pg_temp.m(4, '{"pdf_security": {"result": "not_run", "code": null}}'))) ->> 'failure_code',
  'inspection_incomplete', 'en PDF-kontrol, der ikke er kørt, er aldrig bestået');
do $$ begin perform pg_temp.rescan(4); end $$;
-- Udviklingsscanneren accepteres kun, hvor det lokale seed tillader den.
delete from knowledge.security_development_scanners;
select is((pg_temp.record(4, pg_temp.m(4, jsonb_build_object('scanner', jsonb_build_object('engine', 'development-fixture', 'engine_version', '0',
  'signature_version', '0', 'signature_time', now()))))) ->> 'failure_code',
  'scanner_not_allowed', 'uden seedets række (produktion) giver udviklingsscanneren aldrig safe');
select ok(not (ops.ingestion_worker_status() -> 'violations' ? 'development_scanner_allowed'), 'driftsstatus: ingen udviklingsscanner');
insert into knowledge.security_development_scanners (engine) values ('development-fixture');
select ok(ops.ingestion_worker_status() -> 'violations' ? 'development_scanner_allowed',
  'driftsstatus melder en tilladt udviklingsscanner som overtrædelse (kun lovligt lokalt)');
select throws_ok($$ select pg_temp.record(4, pg_temp.m(4)) $$, '23514', null, 'et verdict kræver, at versionen scannes');
do $$ begin perform pg_temp.rescan(4); end $$;
select throws_ok($$ select pg_temp.record(4, pg_temp.m(4, '{"active_content": {"result": "fail", "findings": []}}')) $$, '22023', null,
  'inkonsistente målinger afvises');
select throws_ok($$ select pg_temp.record(4, pg_temp.m(4, '{"active_content": {"result": "fail", "findings": ["shellcode"]}}')) $$, '22023', null,
  'ukendte fund afvises');
select throws_ok($$ select pg_temp.record(4, pg_temp.m(4, '{"malware": {"result": "clean", "code": null, "name": "x"}}')) $$, '22023', null,
  'et fundnavn uden fund afvises');

-- ---------------------------------------------------------------------------
-- 7. Afvisning af ugyldige og aktive PDF'er
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.upload(5); perform pg_temp.upload(6); perform pg_temp.upload(7); perform pg_temp.upload(8); perform pg_temp.upload(9); end $$;
do $$ begin perform pg_temp.claim(5); end $$;
select is((pg_temp.record(5, pg_temp.m(5, '{"active_content": {"result": "fail", "findings": ["javascript", "open_action"]}}'))) ->> 'failure_code',
  'active_content', 'JavaScript/OpenAction → afvist: aktivt indhold');
do $$ begin perform pg_temp.claim(6); end $$;
select is((pg_temp.record(6, pg_temp.m(6, '{"active_content": {"result": "fail", "findings": ["embedded_file"]}}'))) ->> 'failure_code',
  'embedded_file', 'indlejret fil → afvist');
do $$ begin perform pg_temp.claim(7); end $$;
select is((pg_temp.record(7, pg_temp.m(7, '{"pdf_security": {"result": "fail", "code": "encrypted_pdf"}, "active_content": {"result": "not_run", "findings": []}}'))) ->> 'failure_code',
  'encrypted_pdf', 'krypteret PDF → afvist');
do $$ begin perform pg_temp.claim(8); end $$;
select is((pg_temp.record(8, pg_temp.m(8, '{"structural": {"result": "fail", "code": "polyglot"}, "malware": {"result": "clean", "code": null, "name": null}, "pdf_security": {"result": "not_run", "code": null}, "active_content": {"result": "not_run", "findings": []}}'))) ->> 'failure_code',
  'polyglot', 'polyglot → afvist: ugyldig PDF');
do $$ begin perform pg_temp.claim(9); end $$;
select is((pg_temp.record(9, pg_temp.m(9, jsonb_build_object('checksum_sha256', repeat('9', 64))))) ->> 'failure_code',
  'checksum_mismatch', 'scannede bytes, der ikke er de uploadede → afvist');
select is((select array_agg(security_state order by id) from knowledge.document_versions where id in (pg_temp.v(5), pg_temp.v(6), pg_temp.v(7), pg_temp.v(8), pg_temp.v(9))),
  array['rejected', 'rejected', 'rejected', 'rejected', 'rejected'], 'alle fem er afvist');

-- Adminvisningen: kun kategorier og koder, kun for forvaltere.
select pg_temp.as_user('90000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select array_agg(security_state || ':' || coalesce(failure_code, '-') order by version_id)
           from knowledge.version_security_status(array[pg_temp.v(2), pg_temp.v(4), pg_temp.v(5)])),
  array['rejected:malware_detected', 'scanning:scanner_not_allowed', 'rejected:active_content'],
  'forvalteren ser sikkerhedsstatus og kode — ikke filen');
reset role;
select pg_temp.as_user('90000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select count(*)::int from knowledge.version_security_status(array[pg_temp.v(2)])), 0, 'en rådgiver ser ingen sikkerhedsstatus');
select throws_ok(format($$ select knowledge.request_security_rescan(%L) $$, pg_temp.v(1)), '42501', null, 'en rådgiver kan ikke bestille genscanning');
reset role;

-- ---------------------------------------------------------------------------
-- 8. Release-gaten mod verdicts, der ikke hører til versionen
-- ---------------------------------------------------------------------------
-- Selv hvis ejeren satte en version frigivet med en ANDEN versions verdict, åbner gaten ikke.
do $$ begin perform pg_temp.upload(10); end $$;
update knowledge.document_versions set security_state = 'scanning' where id = pg_temp.v(10);
update knowledge.document_versions set security_state = 'released', storage_bucket = 'knowledge-originals',
  security_verdict_id = (select id from knowledge.security_verdicts where document_version_id = pg_temp.v(1))
where id = pg_temp.v(10);
select is(knowledge.security_block_reason(pg_temp.v(10), null), 'no_verdict', 'et verdict for en anden version åbner ikke gaten (replay)');
-- Et verdict for andre bytes eller en anden sti åbner heller ikke.
create function pg_temp.forge(p_n int, p_patch jsonb) returns text language plpgsql as $$
declare v_id uuid;
begin
  insert into knowledge.security_verdicts (document_version_id, policy_version, checksum_sha256, byte_size, detected_mime, object_bucket, object_path,
    structural_result, malware_result, pdf_security_result, active_content_result, final_verdict, released_at, scanner_engine, signature_time)
  select pg_temp.v(p_n), 'pdf-v1', coalesce(p_patch ->> 'checksum', pg_temp.sha(p_n)), 1, 'application/pdf', 'knowledge-originals',
         coalesce(p_patch ->> 'path', v.storage_path), 'pass', coalesce(p_patch ->> 'malware', 'clean'), 'pass', 'pass', 'safe', now(), 'ClamAV', now()
  from knowledge.document_versions v where v.id = pg_temp.v(p_n)
  returning id into v_id;
  update knowledge.document_versions set security_verdict_id = v_id where id = pg_temp.v(p_n);
  return knowledge.security_block_reason(pg_temp.v(p_n), null);
end $$;
select is(pg_temp.forge(10, '{"checksum": "0000000000000000000000000000000000000000000000000000000000000000"}'), 'checksum_mismatch',
  'et gammelt verdict på en ny fil (anden checksum) åbner ikke gaten');
select is(pg_temp.forge(10, '{"path": "andet/dokument/original.pdf"}'), 'object_mismatch', 'et verdict for et andet objekt åbner ikke gaten');
select is(pg_temp.forge(10, '{"malware": "not_scanned"}'), 'verdict_incomplete', 'et "safe" uden malwarescanning åbner ikke gaten');
select is(pg_temp.forge(10, '{}'), null, 'kontrol: et komplet verdict for netop denne fil og sti åbner gaten');

-- ---------------------------------------------------------------------------
-- 9. Kontrolleret genscanning (server-side, auditeret)
-- ---------------------------------------------------------------------------
-- Version 10 er frigivet; behandlingen mislykkes; en administrator bestiller genscanning.
update knowledge.document_versions set status = 'processing' where id = pg_temp.v(10);
update knowledge.document_versions set status = 'processing_failed' where id = pg_temp.v(10);
update knowledge.ingestion_jobs set status = 'cancelled', finished_at = now() where document_version_id = pg_temp.v(10) and status = 'queued';
select pg_temp.as_user('90000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.request_security_rescan(%L) $$, pg_temp.v(10)), 'en administrator bestiller genscanning');
reset role;
select is(pg_temp.state(10), 'quarantined/knowledge-originals/processing', 'frigivelsen er ophævet, mens der scannes igen');
select is((select count(*)::int from knowledge.security_verdicts where document_version_id = pg_temp.v(10) and superseded_at is null), 0,
  'alle tidligere verdicts er afløst');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.version.security_rescan_requested' and entity_id = pg_temp.v(10)::text),
  'genscanningen auditeres');
select throws_ok($$ insert into knowledge.ingestion_jobs (document_version_id, kind) values (pg_temp.v(10), 'scan') $$, '23505', null,
  'højst én aktiv scanning pr. version (ingen parallelle scanninger)');
select is((pg_temp.claim(10)) ->> 'kind', 'scan', 'genscanningen tages af workeren');
select is((pg_temp.redeem(pg_temp.ticket(10, 'scan_original'))) ->> 'bucket', 'knowledge-originals',
  'en frigivet fil genscannes, hvor den ligger');

-- Lagerfunktionens indgange er kun for service_role.
select pg_temp.as_user('90000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select * from knowledge.redeem_worker_storage_ticket(repeat('a', 64)) $$, '42501', null, 'en bruger kan ikke indløse billetter');
reset role;
select throws_ok($$ select pg_temp.confirm(gen_random_uuid(), repeat('a', 64)) $$, '28000', null, 'en ukendt flytning kan ikke bekræftes');

select * from finish();
rollback;
