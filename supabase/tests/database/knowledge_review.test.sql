-- pgTAP: Knowledge Engine trin 5 — review, godkendelse/publicering, afvisning, deaktivering,
-- genbehandling, kassering og metadata (docs/07 §2.2, §2.3, §3). Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(41);

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

-- ---------------------------------------------------------------------------
-- Fiktive data
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('60000000-0000-4000-a000-000000000001', 'r.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Administrator"}'),
  ('60000000-0000-4000-a000-000000000002', 'r.adv@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver"}'),
  ('60000000-0000-4000-a000-000000000003', 'r.leader@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Leder"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = case u.auth_id
  when '60000000-0000-4000-a000-000000000001' then 'administrator'
  when '60000000-0000-4000-a000-000000000003' then 'leader' else 'advisor' end
where u.auth_id::text like '60000000-0000-4000-a000-00000000000_';

-- En aktiv 3-dimensionel testmodel inden for transaktionen.
update knowledge.embedding_models set status = 'retired', retired_at = now() where status in ('active', 'candidate');
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status, activated_at)
values ('61000000-0000-4000-a000-000000000001', 'pgtap', 'review-model', '1', 3, 'active', now());

insert into knowledge.products (id, name) values ('62000000-0000-4000-a000-000000000001', 'pgTAP Reviewprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-000000000001', '62000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Reviewbetingelser'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_access_grants (document_id, permission_key, grantee_type)
values ('63000000-0000-4000-a000-000000000001', 'knowledge.document.read', 'all_users');

-- En version, der er færdigbehandlet (side, chunk, embedding og kvalitetsrapport).
create function pg_temp.ready(p_id uuid, p_label text, p_from date, p_to date default null,
                              p_text_layer boolean default true, p_embed boolean default true)
returns void language plpgsql as $$
begin
  insert into knowledge.document_versions (id, document_id, version_label, valid_from, valid_to, storage_path, checksum_sha256, uploaded_by)
  select p_id, '63000000-0000-4000-a000-000000000001', p_label, p_from, p_to, 'r/' || p_id || '.pdf',
         encode(sha256(p_id::text::bytea), 'hex'), u.id
  from identity.users u where u.auth_id = '60000000-0000-4000-a000-000000000001';
  update knowledge.document_versions set status = 'processing' where id = p_id;
  insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
  values (p_id, 1, 'Fiktiv tekst.', p_text_layer, 0, 13);
  insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, page_start, page_end,
    char_start, char_end, content_hash, char_count, token_estimate)
  values (p_id, p_id, 0, 'prose', 'Fiktiv tekst.', '{"§ 1 Fiktiv"}', 1, 1, 0, 13, repeat('a', 64), 13, 4);
  if p_embed then
    insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
    values (p_id, '61000000-0000-4000-a000-000000000001', '[1,2,3]', 'da', repeat('b', 64));
  end if;
  insert into knowledge.ingestion_jobs (document_version_id, status, finished_at, quality_report)
  values (p_id, 'succeeded', now(), jsonb_build_object('pages', jsonb_build_object('total', 1, 'read', case when p_text_layer then 1 else 0 end,
          'all_read', p_text_layer), 'structure', jsonb_build_object('recognized', true)));
  perform pg_temp.release(p_id);
  update knowledge.document_versions set status = 'processed', page_count = 1 where id = p_id;
end $$;

create function pg_temp.as_user(p_auth text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;

select pg_temp.ready('64000000-0000-4000-a000-000000000001', '1', '2020-01-01');
select pg_temp.ready('64000000-0000-4000-a000-000000000002', '2', '2026-01-01');
select pg_temp.ready('64000000-0000-4000-a000-000000000003', '2b', '2026-01-01');
select pg_temp.ready('64000000-0000-4000-a000-000000000004', '3', (now() at time zone 'Europe/Copenhagen')::date + 30);
select pg_temp.ready('64000000-0000-4000-a000-000000000005', '4', '2030-01-01', null, false);
select pg_temp.ready('64000000-0000-4000-a000-000000000006', '5', '2031-01-01', null, true, false);
select pg_temp.ready('64000000-0000-4000-a000-000000000007', null, '2032-01-01');
select pg_temp.ready('64000000-0000-4000-a000-000000000008', '6', '2033-01-01');

-- ---------------------------------------------------------------------------
-- Rettigheder: kun knowledge.version.publish kan reviewe og godkende
-- ---------------------------------------------------------------------------
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ select knowledge.start_review('64000000-0000-4000-a000-000000000001') $$, '42501', null,
  'en rådgiver kan ikke påbegynde review');
select throws_ok($$ select knowledge.review_state('64000000-0000-4000-a000-000000000001') $$, '42501', null,
  'en rådgiver kan ikke se review-tilstanden');
select is((select count(*)::int from knowledge.document_versions where document_id = '63000000-0000-4000-a000-000000000001'), 0,
  'behandlede versioner er usynlige for en rådgiver, også med tildeling');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000003');
set local role authenticated;
select throws_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000001') $$, '42501', null,
  'en leder kan ikke godkende (lederscope giver ingen vidensrettigheder)');
reset role;

-- ---------------------------------------------------------------------------
-- Påbegynd review, godkend som autoritativ
-- ---------------------------------------------------------------------------
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000001') $$, '23514', null,
  'en version kan ikke godkendes uden påbegyndt review');
select lives_ok($$ select knowledge.start_review('64000000-0000-4000-a000-000000000001') $$, 'administratoren påbegynder review');
select throws_ok($$ select knowledge.update_version_metadata('64000000-0000-4000-a000-000000000001', '1', 'da', '2019-01-01', null) $$,
  '23514', null, 'metadata er låst under review');
select is((knowledge.review_state('64000000-0000-4000-a000-000000000001') ->> 'can_approve')::boolean, true,
  'en komplet version kan godkendes');
select ok(not ((knowledge.review_state('64000000-0000-4000-a000-000000000001') -> 'warnings') @> '[{"code":"predecessor_superseded"}]'),
  'den første version erstatter ingen forgænger');
select lives_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000001', '["no_grants"]') $$,
  'administratoren godkender som autoritativ');
reset role;

select is((select status from knowledge.document_versions where id = '64000000-0000-4000-a000-000000000001'), 'published',
  'godkendelse publicerer versionen i samme transaktion');
select ok((select approved_by is not null and approved_at is not null and published_at is not null and approved_by = uploaded_by
           from knowledge.document_versions where id = '64000000-0000-4000-a000-000000000001'),
  'godkender og tidspunkter registreres; fire øjne håndhæves ikke (B-10), men begge registreres');
select is((select decision from knowledge.version_reviews where version_id = '64000000-0000-4000-a000-000000000001'), 'approved',
  'afgørelsen gemmes i version_reviews');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.version.approved'
                  and entity_id = '64000000-0000-4000-a000-000000000001' and details -> 'acknowledged_warnings' ? 'no_grants'),
  'godkendelsen auditeres med de advarsler, der blev vist');

-- Rådgiveren med tildeling ser nu den publicerede version.
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select array_agg(version_label) from knowledge.document_versions where document_id = '63000000-0000-4000-a000-000000000001'),
  array['1'], 'efter publicering ser en rådgiver med tildeling versionen');
reset role;

-- ---------------------------------------------------------------------------
-- Ny version erstatter forgængeren (docs/07 §3.5)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select knowledge.start_review('64000000-0000-4000-a000-000000000002');
select ok((knowledge.review_state('64000000-0000-4000-a000-000000000002') -> 'warnings') @> '[{"code":"predecessor_superseded"}]',
  'review viser, at forgængeren bliver erstattet');
select lives_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000002') $$, 'version 2 godkendes');
reset role;
select ok((select valid_to = '2026-01-01' and superseded_by = '64000000-0000-4000-a000-000000000002' and status = 'published'
           from knowledge.document_versions where id = '64000000-0000-4000-a000-000000000001'),
  'forgængeren afkortes til efterfølgerens gyldig fra og markeres som erstattet');

-- Samme gyldig fra som en publiceret version → blokeret med forklaring.
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select knowledge.start_review('64000000-0000-4000-a000-000000000003');
select ok((knowledge.review_state('64000000-0000-4000-a000-000000000003') -> 'blockers') @> '[{"code":"validity_conflict"}]',
  'overlap med en publiceret version blokerer godkendelsen');
select throws_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000003') $$, '23514', null,
  'godkendelse afvises, når gyldigheden ikke kan indpasses');

-- Fremtidig version publiceres straks; den nuværende gælder til dens gyldig fra.
select knowledge.start_review('64000000-0000-4000-a000-000000000004');
select lives_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000004') $$, 'en fremtidig version godkendes');
reset role;
select is((select status from knowledge.document_versions where id = '64000000-0000-4000-a000-000000000004'), 'published',
  'en fremtidig version er publiceret med det samme');
select ok((select valid_to = (now() at time zone 'Europe/Copenhagen')::date + 30 and status = 'published'
           from knowledge.document_versions where id = '64000000-0000-4000-a000-000000000002'),
  'den gældende version gælder til den fremtidige versions gyldig fra (intet planlagt job)');

-- ---------------------------------------------------------------------------
-- Blokeringer: ulæste sider, manglende embeddings, manglende metadata
-- ---------------------------------------------------------------------------
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select knowledge.start_review('64000000-0000-4000-a000-000000000005');
select ok((knowledge.review_state('64000000-0000-4000-a000-000000000005') -> 'blockers') @> '[{"code":"pages_unread"}]',
  'en delvist læst PDF kan ikke godkendes (B-11)');
select throws_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000005') $$, '23514', null,
  'godkendelse af en delvist læst PDF afvises');
select knowledge.start_review('64000000-0000-4000-a000-000000000006');
select ok((knowledge.review_state('64000000-0000-4000-a000-000000000006') -> 'blockers') @> '[{"code":"embeddings_missing"}]',
  'manglende embeddings med den aktive model blokerer godkendelsen');
select throws_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000006') $$, '23514', null,
  'godkendelse uden embeddings med den aktive model afvises');
select knowledge.start_review('64000000-0000-4000-a000-000000000007');
select ok((knowledge.review_state('64000000-0000-4000-a000-000000000007') -> 'blockers') @> '[{"code":"metadata_missing"}]',
  'manglende versionsbetegnelse blokerer godkendelsen');
select throws_ok($$ select knowledge.approve_version('64000000-0000-4000-a000-000000000007') $$, '23514', null,
  'godkendelse med manglende metadata afvises');

-- ---------------------------------------------------------------------------
-- Afvisning, rettelse, genbehandling og kassering
-- ---------------------------------------------------------------------------
select throws_ok($$ select knowledge.reject_version('64000000-0000-4000-a000-000000000007', '  ') $$, '23514', null,
  'en afvisning kræver en begrundelse');
select lives_ok($$ select knowledge.reject_version('64000000-0000-4000-a000-000000000007', 'Versionsbetegnelse mangler.') $$,
  'versionen afvises med begrundelse');
select lives_ok($$ select knowledge.update_version_metadata('64000000-0000-4000-a000-000000000007', '7', 'da', '2032-01-01', null) $$,
  'metadata rettes på den afviste version');
reset role;
select is((select status || '/' || version_label from knowledge.document_versions where id = '64000000-0000-4000-a000-000000000007'),
  'processed/7', 'en afvist version med rettet metadata er klar til review igen');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.version.rejected'
                  and entity_id = '64000000-0000-4000-a000-000000000007' and details ->> 'reason' = 'Versionsbetegnelse mangler.'),
  'afvisningen auditeres med begrundelse');

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select knowledge.reject_version('64000000-0000-4000-a000-000000000005', 'Side 1 kunne ikke læses.');
select lives_ok($$ select knowledge.request_reprocess('64000000-0000-4000-a000-000000000005') $$, 'en afvist version kan genbehandles');
select throws_ok($$ select knowledge.discard_version('64000000-0000-4000-a000-000000000001') $$, '23514', null,
  'en publiceret version kan ikke kasseres');
select lives_ok($$ select knowledge.discard_version('64000000-0000-4000-a000-000000000008') $$, 'en aldrig publiceret version kasseres');
reset role;
select is((select status from knowledge.ingestion_jobs where document_version_id = '64000000-0000-4000-a000-000000000005' and status = 'queued'),
  'queued', 'genbehandling opretter et nyt behandlingsjob');

-- ---------------------------------------------------------------------------
-- Deaktivering (docs/07 §2.3)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.withdraw_version('64000000-0000-4000-a000-000000000002', null, 'x') $$, '23514', null,
  'deaktivering kræver en kategori');
select lives_ok($$ select knowledge.withdraw_version('64000000-0000-4000-a000-000000000002', 'invalid', 'Fiktiv faglig fejl.') $$,
  'en publiceret version deaktiveres med kategori og begrundelse');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok(not exists (select 1 from knowledge.document_versions where id = '64000000-0000-4000-a000-000000000002'),
  'en deaktiveret version forsvinder straks for rådgiveren');
reset role;

select * from finish();
rollback;
