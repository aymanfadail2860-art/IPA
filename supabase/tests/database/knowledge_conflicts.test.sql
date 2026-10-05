-- pgTAP: Knowledge Engine trin 7 — konflikter (docs/07 §11) og huller i gyldigheden (§3.5,
-- B-006): strukturel detektion ved publicering, rettigheder, den neutrale indikator håndhævet
-- i databasen, løs/afvis, manuel registrering. Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(54);

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
  ('80000000-0000-4000-a000-000000000001', 'k.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Konfliktadmin"}'),
  ('80000000-0000-4000-a000-000000000002', 'k.adv@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Konfliktrådgiver"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = case u.auth_id
  when '80000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id::text like '80000000-0000-4000-a000-00000000000_';

update knowledge.embedding_models set status = 'retired', retired_at = now() where status in ('active', 'candidate');
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status, activated_at)
values ('81000000-0000-4000-a000-000000000001', 'pgtap', 'conflict-model', '1', 3, 'active', now());

insert into knowledge.products (id, name) values
  ('82000000-0000-4000-a000-000000000001', 'pgTAP Konfliktprodukt 1'),
  ('82000000-0000-4000-a000-000000000002', 'pgTAP Konfliktprodukt 2');
-- X og Y: samme produkt og type (overlapping_scope). Z: andet produkt med et identisk chunk
-- (duplicate_content). G: versioner til huller i gyldigheden.
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select d.id, d.product_id, d.document_type, s.id, d.title
from (values
  ('83000000-0000-4000-a000-00000000000a'::uuid, '82000000-0000-4000-a000-000000000001'::uuid, 'acceptance_rules', 'pgTAP Acceptregler X'),
  ('83000000-0000-4000-a000-00000000000b'::uuid, '82000000-0000-4000-a000-000000000001'::uuid, 'acceptance_rules', 'pgTAP Acceptregler Y'),
  ('83000000-0000-4000-a000-00000000000c'::uuid, '82000000-0000-4000-a000-000000000002'::uuid, 'guidance', 'pgTAP Vejledning Z'),
  ('83000000-0000-4000-a000-00000000000d'::uuid, '82000000-0000-4000-a000-000000000002'::uuid, 'terms', 'pgTAP Hulbetingelser G')
) as d(id, product_id, document_type, title), knowledge.sources s where s.type = 'manual_upload';

insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, user_id)
select '83000000-0000-4000-a000-00000000000a'::uuid, 'knowledge.document.read', 'user', u.id
from identity.users u where u.auth_id = '80000000-0000-4000-a000-000000000002';

create function pg_temp.as_user(p_auth text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.publish(p_id uuid, p_document uuid, p_from date, p_to date, p_text text)
returns void language plpgsql as $$
begin
  insert into knowledge.document_versions (id, document_id, version_label, valid_from, valid_to, storage_path, checksum_sha256, uploaded_by)
  select p_id, p_document, '1', p_from, p_to, 'k/' || p_id || '.pdf', encode(sha256(p_id::text::bytea), 'hex'), u.id
  from identity.users u where u.auth_id = '80000000-0000-4000-a000-000000000001';
  update knowledge.document_versions set status = 'processing' where id = p_id;
  insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
  values (p_id, 1, p_text, true, 0, char_length(p_text));
  insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, page_start, page_end,
    char_start, char_end, content_hash, char_count, token_estimate)
  values (p_id, p_id, 0, 'prose', p_text, '{"§ 1"}', 1, 1, 0, char_length(p_text), encode(sha256(p_text::bytea), 'hex'), char_length(p_text), 5);
  insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
  values (p_id, '81000000-0000-4000-a000-000000000001', '[1,0,0]', 'da', repeat('d', 64));
  insert into knowledge.ingestion_jobs (document_version_id, status, finished_at, quality_report)
  values (p_id, 'succeeded', now(), '{"pages":{"total":1,"read":1,"all_read":true},"structure":{"recognized":true}}');
  perform pg_temp.release(p_id);
  update knowledge.document_versions set status = 'processed', page_count = 1 where id = p_id;
  perform pg_temp.as_user('80000000-0000-4000-a000-000000000001');
  set local role authenticated;
  perform knowledge.start_review(p_id);
  perform knowledge.approve_version(p_id, '[]');
  reset role;
end $$;

-- Én dato, hvor alle tre kilder er gyldige.
create function pg_temp.d() returns date language sql as $$ select '2025-06-01'::date $$;

select pg_temp.publish('84000000-0000-4000-a000-00000000000a', '83000000-0000-4000-a000-00000000000a', '2020-01-01', null,
  'Fælles fiktiv klausul om accept af virksomheder.');

-- ---------------------------------------------------------------------------
-- Struktur og rettigheder
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'knowledge.conflicts'::regclass), 'RLS er slået til på conflicts');
select ok((select relrowsecurity from pg_class where oid = 'knowledge.conflict_passages'::regclass), 'RLS er slået til på conflict_passages');
select ok(not has_table_privilege('anon', 'knowledge.conflicts', 'select'), 'anon kan ikke læse konflikter');
select ok(not has_table_privilege('authenticated', 'knowledge.conflicts', 'insert')
          and not has_table_privilege('authenticated', 'knowledge.conflicts', 'update')
          and not has_table_privilege('authenticated', 'knowledge.conflict_passages', 'insert'),
  'konflikter skrives kun gennem funktionerne');
select is((select count(*)::int from knowledge.conflicts c join knowledge.conflict_passages p on p.conflict_id = c.id
           where p.document_version_id = '84000000-0000-4000-a000-00000000000a'), 0,
  'den første version har ingen konfliktkandidater');

-- ---------------------------------------------------------------------------
-- Strukturel detektion ved publicering (docs/07 §11.2)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
-- Y er behandlet, men endnu ikke publiceret: kandidaten vises i kvalitetsrapporten.
reset role;
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256, uploaded_by)
select '84000000-0000-4000-a000-00000000000b', '83000000-0000-4000-a000-00000000000b', '1', '2024-01-01', 'k/y.pdf', repeat('e', 64), u.id
from identity.users u where u.auth_id = '80000000-0000-4000-a000-000000000001';
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select is(jsonb_path_query_array(knowledge.conflict_candidates('84000000-0000-4000-a000-00000000000b'), '$[*].rule'), '["overlapping_scope"]'::jsonb,
  'kvalitetsrapporten viser overlapping_scope som kandidat før publicering');
select is((knowledge.conflict_candidates('84000000-0000-4000-a000-00000000000b') -> 0 ->> 'registered')::boolean, false,
  'kandidaten er endnu ikke registreret');
reset role;
-- Versionen færdiggøres og publiceres.
update knowledge.document_versions set status = 'processing' where id = '84000000-0000-4000-a000-00000000000b';
insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
values ('84000000-0000-4000-a000-00000000000b', 1, 'Virksomheder accepteres ikke.', true, 0, 29);
insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, page_start, page_end,
  char_start, char_end, content_hash, char_count, token_estimate)
values ('84000000-0000-4000-a000-00000000000b', '84000000-0000-4000-a000-00000000000b', 0, 'prose', 'Virksomheder accepteres ikke.', '{"§ 1"}', 1, 1, 0, 29,
        encode(sha256('Virksomheder accepteres ikke.'::bytea), 'hex'), 29, 5);
insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
values ('84000000-0000-4000-a000-00000000000b', '81000000-0000-4000-a000-000000000001', '[1,0,0]', 'da', repeat('d', 64));
insert into knowledge.ingestion_jobs (document_version_id, status, finished_at, quality_report)
values ('84000000-0000-4000-a000-00000000000b', 'succeeded', now(), '{"pages":{"total":1,"read":1,"all_read":true},"structure":{"recognized":true}}');
do $$ begin perform pg_temp.release('84000000-0000-4000-a000-00000000000b'); end $$;
update knowledge.document_versions set status = 'processed', page_count = 1 where id = '84000000-0000-4000-a000-00000000000b';
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
do $$ begin
  perform knowledge.start_review('84000000-0000-4000-a000-00000000000b');
  perform knowledge.approve_version('84000000-0000-4000-a000-00000000000b', '[]');
end $$;
reset role;

create temporary table scope_conflict as
  select c.* from knowledge.conflicts c
  where c.detection_rule = 'overlapping_scope'
    and exists (select 1 from knowledge.conflict_passages p where p.conflict_id = c.id and p.document_version_id = '84000000-0000-4000-a000-00000000000b');
grant select on scope_conflict to authenticated;
select is((select count(*)::int from scope_conflict), 1, 'publicering registrerer overlapping_scope-konflikten');
select ok((select status = 'open' and detected_by = 'system' and created_by is null and fingerprint is not null from scope_conflict),
  'systemkandidaten starter som åben og er systemregistreret');
select is((select array_agg(side || ':' || document_version_id || ':' || coalesce(chunk_id::text, '-') order by side)
           from knowledge.conflict_passages where conflict_id = (select id from scope_conflict)),
  array['A:84000000-0000-4000-a000-00000000000b:-', 'B:84000000-0000-4000-a000-00000000000a:-'],
  'begge kilder bevares som passager på versionsniveau (A = ny, B = eksisterende)');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.conflict.flagged' and entity_id = (select id::text from scope_conflict)
                  and details ->> 'rule' = 'overlapping_scope'),
  'registreringen auditeres med regel');
select is(knowledge.detect_conflicts('84000000-0000-4000-a000-00000000000b'), 0, 'detektionen er idempotent — ingen dubletter');

select pg_temp.publish('84000000-0000-4000-a000-00000000000c', '83000000-0000-4000-a000-00000000000c', '2020-01-01', null,
  'Fælles fiktiv klausul om accept af virksomheder.');
create temporary table duplicate_conflict as
  select c.* from knowledge.conflicts c
  where c.detection_rule = 'duplicate_content'
    and exists (select 1 from knowledge.conflict_passages p where p.conflict_id = c.id and p.document_version_id = '84000000-0000-4000-a000-00000000000c');
grant select on duplicate_conflict to authenticated;
select is((select count(*)::int from duplicate_conflict), 1, 'identisk chunk i et dokument med andet produkt giver duplicate_content');
select is((select array_agg(side || ':' || chunk_id order by side) from knowledge.conflict_passages where conflict_id = (select id from duplicate_conflict)),
  array['A:84000000-0000-4000-a000-00000000000c', 'B:84000000-0000-4000-a000-00000000000a'], 'duplicate_content peger på de identiske chunks');
select is((select count(*)::int from knowledge.conflicts c join knowledge.conflict_passages p on p.conflict_id = c.id
           where p.document_version_id = '84000000-0000-4000-a000-00000000000c' and c.detection_rule = 'overlapping_scope'), 0,
  'andet produkt og anden type giver ingen overlapping_scope');

-- ---------------------------------------------------------------------------
-- Rådgiveren: ingen direkte adgang, ingen handlinger
-- ---------------------------------------------------------------------------
select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select count(*)::int from knowledge.conflicts), 0, 'en rådgiver kan ikke læse konflikter direkte');
select is((select count(*)::int from knowledge.conflict_passages), 0, 'en rådgiver kan ikke læse konfliktpassager direkte');
select throws_ok($$ select knowledge.conflict_candidates('84000000-0000-4000-a000-00000000000b') $$, '42501', null,
  'en rådgiver kan ikke se konfliktkandidater');
select throws_ok($$ select knowledge.resolve_conflict((select id from scope_conflict), 'x') $$, '42501', null, 'en rådgiver kan ikke løse');
select throws_ok($$ select knowledge.flag_conflict('x', '[]') $$, '42501', null, 'en rådgiver kan ikke registrere');
select throws_ok($$ select knowledge.validity_gaps() $$, '42501', null, 'en rådgiver kan ikke se huller i gyldigheden');

-- ---------------------------------------------------------------------------
-- Den neutrale indikator håndhæves i databasen (docs/07 §11.4, B-20)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], pg_temp.d())), 1,
  'uden adgang til modparterne: præcis én række');
select ok((select restricted and conflict_id is null and counterpart_document_id is null and counterpart_version_id is null and counterpart_chunk_id is null
           from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], pg_temp.d())),
  'rækken er kun det boolske restricted — ingen id''er, ingen metadata');
select is((select count(*)::int from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000b'::uuid], pg_temp.d())), 0,
  'konflikter for et chunk, brugeren ikke kan læse, kan ikke afprøves');
select is((select count(*)::int from knowledge.evidence_chunks(array['84000000-0000-4000-a000-00000000000b'::uuid], '{}', pg_temp.d())), 0,
  'evidence_chunks udleverer intet fra et dokument uden adgang');
reset role;

-- Med adgang til Y: Y som fuld modpart, Z stadig kun som indikator.
insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, user_id)
select '83000000-0000-4000-a000-00000000000b'::uuid, 'knowledge.document.read', 'user', u.id
from identity.users u where u.auth_id = '80000000-0000-4000-a000-000000000002';
select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select array_agg(coalesce(counterpart_version_id::text, 'restricted') || ':' || coalesce(counterpart_chunk_id::text, '-') order by restricted, counterpart_version_id)
           from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], pg_temp.d())),
  array['84000000-0000-4000-a000-00000000000b:-', 'restricted:-'],
  'den tilgængelige modpart returneres; de øvrige samlet som én indikator');
select is((select conflict_id from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], pg_temp.d()) where not restricted),
  (select id from scope_conflict), 'konflikt-id udleveres kun, når modparten er tilgængelig');
select is((select chunk_id from knowledge.evidence_chunks('{}', array['84000000-0000-4000-a000-00000000000b'::uuid], pg_temp.d())),
  '84000000-0000-4000-a000-00000000000b'::uuid, 'evidence_chunks giver den tilgængelige modparts første chunk');
select is((select count(*)::int from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], '2021-06-01')
           where not restricted), 0,
  'en modpart, der ikke er gyldig på datoen, indgår ikke');
reset role;

-- ---------------------------------------------------------------------------
-- Løs og afvis (docs/07 §11.3)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.resolve_conflict((select id from scope_conflict), '  ') $$, '23514', null, 'løsning kræver en note');
select throws_ok($$ select knowledge.dismiss_conflict((select id from duplicate_conflict), '') $$, '23514', null, 'afvisning kræver en begrundelse');
select lives_ok($$ select knowledge.resolve_conflict((select id from scope_conflict), 'Y erstatter X fra 2024 (fiktivt).') $$, 'administratoren løser konflikten');
select throws_ok($$ select knowledge.resolve_conflict((select id from scope_conflict), 'igen') $$, 'P0002', null, 'en afgjort konflikt kan ikke afgøres igen');
select lives_ok($$ select knowledge.dismiss_conflict((select id from duplicate_conflict), 'Standardklausul, ikke en konflikt (fiktivt).') $$, 'administratoren afviser kandidaten');
select throws_ok($$ update knowledge.conflicts set status = 'open' where id = (select id from scope_conflict) $$, '42501', null,
  'konflikter kan ikke opdateres direkte');
reset role;
select ok((select status = 'resolved' and resolved_by is not null and resolved_at is not null and resolution_note like 'Y erstatter%'
           from knowledge.conflicts where id = (select id from scope_conflict)), 'løsningen registreres med aktør, tid og note');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.conflict.resolved' and entity_id = (select id::text from scope_conflict)),
  'løsningen auditeres');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.conflict.dismissed' and entity_id = (select id::text from duplicate_conflict)),
  'afvisningen auditeres');
select throws_ok($$ update knowledge.conflicts set status = 'open', resolved_at = null, resolved_by = null, resolution_note = null where id = (select id from scope_conflict) $$,
  '23514', null, 'en afgjort konflikt kan ikke genåbnes');
select throws_ok($$ delete from knowledge.conflicts where id = (select id from scope_conflict) $$, '23514', null, 'konflikter slettes aldrig');
select is(knowledge.detect_conflicts('84000000-0000-4000-a000-00000000000c'), 0, 'en afvist kandidat oprettes ikke igen');

select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select count(*)::int from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], pg_temp.d())), 0,
  'løste og afviste konflikter påvirker ikke retrieval');
reset role;

-- ---------------------------------------------------------------------------
-- Manuel registrering
-- ---------------------------------------------------------------------------
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.flag_conflict('Fiktiv modstrid.', '[{"side":"A","version_id":"84000000-0000-4000-a000-00000000000a"}]') $$,
  '23514', null, 'en manuel konflikt kræver passager fra begge kilder');
select throws_ok($$ select knowledge.flag_conflict('Fiktiv modstrid.', '[{"side":"A","version_id":"84000000-0000-4000-a000-00000000000a","chunk_id":"84000000-0000-4000-a000-00000000000b"},{"side":"B","version_id":"84000000-0000-4000-a000-00000000000b"}]') $$,
  '23514', null, 'en passage skal tilhøre sin version');
create temporary table manual_conflict (id uuid);
insert into manual_conflict select knowledge.flag_conflict('Fiktiv modstrid om accept.',
  '[{"side":"A","version_id":"84000000-0000-4000-a000-00000000000a","chunk_id":"84000000-0000-4000-a000-00000000000a"},{"side":"B","version_id":"84000000-0000-4000-a000-00000000000b","chunk_id":"84000000-0000-4000-a000-00000000000b"}]');
reset role;
select ok((select detected_by = 'user' and detection_rule = 'manual' and status = 'open' and created_by is not null and fingerprint is null
           from knowledge.conflicts where id = (select id from manual_conflict)), 'den manuelle konflikt registreres af en bruger');
select is((select count(*)::int from knowledge.conflict_passages where conflict_id = (select id from manual_conflict)), 2, 'med de valgte passager');
select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select counterpart_chunk_id from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], pg_temp.d())),
  '84000000-0000-4000-a000-00000000000b'::uuid, 'retrieval returnerer den modstridende passage');
reset role;

-- En deaktiveret modpart indgår aldrig.
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
do $$ begin perform knowledge.withdraw_version('84000000-0000-4000-a000-00000000000b', 'invalid', 'Fiktiv fejl.'); end $$;
reset role;
select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select count(*)::int from knowledge.evidence_conflicts(array['84000000-0000-4000-a000-00000000000a'::uuid], pg_temp.d())), 0,
  'en deaktiveret modpart indgår ikke');
reset role;

-- ---------------------------------------------------------------------------
-- Huller i gyldigheden (B-006)
-- ---------------------------------------------------------------------------
select pg_temp.publish('84000000-0000-4000-a000-0000000000d1', '83000000-0000-4000-a000-00000000000d', '2020-01-01', null, 'Hul version 1.');
select pg_temp.publish('84000000-0000-4000-a000-0000000000d2', '83000000-0000-4000-a000-00000000000d', '2024-01-01', null, 'Hul version 2.');
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select count(*)::int from knowledge.validity_gaps('83000000-0000-4000-a000-00000000000d')), 0,
  'to versioner, der ligger op ad hinanden, giver intet hul');
select is((select array_agg(kind || ':' || gap_from || ':' || coalesce(gap_to::text, '∞')) from knowledge.gaps_after_withdrawal('84000000-0000-4000-a000-0000000000d2')),
  array['after_withdrawn_successor:2024-01-01:∞'], 'bekræftelsesdialogen kan vise, at deaktiveringen efterlader et hul');
do $$ begin perform knowledge.withdraw_version('84000000-0000-4000-a000-0000000000d2', 'invalid', 'Fiktiv fejl.'); end $$;
select is((select array_agg(kind || ':' || gap_from || ':' || coalesce(gap_to::text, '∞')) from knowledge.validity_gaps('83000000-0000-4000-a000-00000000000d')),
  array['after_withdrawn_successor:2024-01-01:∞'], 'et hul forbliver et hul: forgængeren får ikke sin gyldighed tilbage');
reset role;
select is((select valid_to from knowledge.document_versions where id = '84000000-0000-4000-a000-0000000000d1'), '2024-01-01'::date,
  'forgængerens gyldighed er uændret efter deaktiveringen');
select pg_temp.publish('84000000-0000-4000-a000-0000000000d3', '83000000-0000-4000-a000-00000000000d', '2025-01-01', null, 'Hul version 3.');
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select array_agg(kind || ':' || gap_from || ':' || coalesce(gap_to::text, '∞')) from knowledge.validity_gaps('83000000-0000-4000-a000-00000000000d')),
  array['between_versions:2024-01-01:2025-01-01'], 'en ny version lukker hullet frem — perioden imellem forbliver et hul');
reset role;

-- En version uploadet med slutdato giver ikke et hul efter slutdatoen.
select pg_temp.publish('84000000-0000-4000-a000-0000000000e1', '83000000-0000-4000-a000-00000000000c', '2030-01-01', '2031-01-01', 'Tidsbegrænset fiktiv version.');
select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select count(*)::int from knowledge.validity_gaps('83000000-0000-4000-a000-00000000000c') where gap_from >= '2030-01-01'), 0,
  'en version uploadet med slutdato giver ikke et hul efter slutdatoen');
reset role;

select * from finish();
rollback;
