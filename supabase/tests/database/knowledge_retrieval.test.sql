-- pgTAP: Knowledge Engine trin 6 — retrieval-funktionen knowledge.search_chunks (docs/07 §8,
-- §3.4, §15): adgangsfilter før søgning, gældende/historisk/fremtidig viden, grænsedage,
-- klientfiltre der kun snævrer ind, deaktiverede versioner, read-only. Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(39);

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
  ('70000000-0000-4000-a000-000000000001', 's.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Søgeadmin"}'),
  ('70000000-0000-4000-a000-000000000002', 's.hist@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver med historik"}'),
  ('70000000-0000-4000-a000-000000000003', 's.read@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver uden historik"}'),
  ('70000000-0000-4000-a000-000000000004', 's.none@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver uden tildelinger"}'),
  ('70000000-0000-4000-a000-000000000005', 's.writer@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Forvalter uden læseret"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = case u.auth_id
  when '70000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id::text like '70000000-0000-4000-a000-00000000000_' and u.auth_id <> '70000000-0000-4000-a000-000000000005';

-- En rolle med forvaltning (knowledge.document.write) men uden læserettighed: RLS lader en
-- forvalter se versionerne, men retrieval må kun bruge læseadgang (filteret i search_chunks).
insert into identity.roles (key, name) values ('pgtap_writer', 'pgTAP Forvalter');
insert into identity.role_permissions (role_id, permission_id, scope)
select r.id, p.id, 'all' from identity.roles r, identity.permissions p where r.key = 'pgtap_writer' and p.key = 'knowledge.document.write';
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u, identity.roles r where u.auth_id = '70000000-0000-4000-a000-000000000005' and r.key = 'pgtap_writer';

update knowledge.embedding_models set status = 'retired', retired_at = now() where status in ('active', 'candidate');
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status, activated_at)
values ('71000000-0000-4000-a000-000000000001', 'pgtap', 'search-model', '1', 3, 'active', now());

insert into knowledge.products (id, name) values
  ('72000000-0000-4000-a000-000000000001', 'pgTAP Søgeprodukt X'),
  ('72000000-0000-4000-a000-000000000002', 'pgTAP Søgeprodukt Y');
-- X: tildelt. Y: ikke tildelt rådgiverne. Z: publiceres og deaktiveres.
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select d.id, d.product_id, 'terms', s.id, d.title
from (values
  ('73000000-0000-4000-a000-00000000000a'::uuid, '72000000-0000-4000-a000-000000000001'::uuid, 'pgTAP Søgebetingelser X'),
  ('73000000-0000-4000-a000-00000000000b'::uuid, '72000000-0000-4000-a000-000000000002'::uuid, 'pgTAP Hemmelige betingelser Y'),
  ('73000000-0000-4000-a000-00000000000c'::uuid, '72000000-0000-4000-a000-000000000001'::uuid, 'pgTAP Tilbagekaldte betingelser Z')
) as d(id, product_id, title), knowledge.sources s where s.type = 'manual_upload';

insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, user_id)
select '73000000-0000-4000-a000-00000000000a'::uuid, p.key, 'user', u.id
from identity.users u, (values ('knowledge.document.read'), ('knowledge.document.read_historical')) as p(key)
where u.auth_id = '70000000-0000-4000-a000-000000000002'
union all
select '73000000-0000-4000-a000-00000000000a'::uuid, 'knowledge.document.read', 'user', u.id
from identity.users u where u.auth_id = '70000000-0000-4000-a000-000000000003'
union all
select '73000000-0000-4000-a000-00000000000c'::uuid, 'knowledge.document.read', 'all_users', null;

create function pg_temp.as_user(p_auth text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;

-- En færdigbehandlet version med ét chunk (tekst + embedding), som administratoren godkender.
create function pg_temp.publish(p_id uuid, p_document uuid, p_label text, p_from date, p_text text, p_vector text)
returns void language plpgsql as $$
begin
  insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256, uploaded_by)
  select p_id, p_document, p_label, p_from, 's/' || p_id || '.pdf', encode(sha256(p_id::text::bytea), 'hex'), u.id
  from identity.users u where u.auth_id = '70000000-0000-4000-a000-000000000001';
  update knowledge.document_versions set status = 'processing' where id = p_id;
  insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
  values (p_id, 1, p_text, true, 0, char_length(p_text));
  insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, section_number, page_start, page_end,
    char_start, char_end, content_hash, char_count, token_estimate)
  values (p_id, p_id, 0, 'prose', p_text, '{"§ 4 Undtagelser"}', '4', 1, 1, 0, char_length(p_text), encode(sha256(p_text::bytea), 'hex'),
          char_length(p_text), 10);
  insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
  values (p_id, '71000000-0000-4000-a000-000000000001', p_vector::extensions.vector, 'da', repeat('c', 64));
  insert into knowledge.ingestion_jobs (document_version_id, status, finished_at, quality_report)
  values (p_id, 'succeeded', now(), '{"pages":{"total":1,"read":1,"all_read":true},"structure":{"recognized":true}}');
  perform pg_temp.release(p_id);
  update knowledge.document_versions set status = 'processed', page_count = 1 where id = p_id;
  perform pg_temp.as_user('70000000-0000-4000-a000-000000000001');
  set local role authenticated;
  perform knowledge.start_review(p_id);
  perform knowledge.approve_version(p_id, '[]');
  reset role;
end $$;

create function pg_temp.versions(p_query text, p_mode text default 'current', p_as_of date default null,
                                 p_documents uuid[] default null, p_products uuid[] default null)
returns text[] language sql as $$
  select coalesce(array_agg(distinct version_label || ':' || temporal_status order by version_label || ':' || temporal_status), '{}')
  from knowledge.search_chunks(p_query, null, null, p_mode, p_as_of, 'da', p_products, p_documents)
$$;

select pg_temp.publish('74000000-0000-4000-a000-000000000001', '73000000-0000-4000-a000-00000000000a', 'X1', '2020-01-01',
  'Forsikringen dækker ikke gradvis forurening. Fiktiv formulering fra første version.', '[0.9,0.1,0]');
select pg_temp.publish('74000000-0000-4000-a000-000000000002', '73000000-0000-4000-a000-00000000000a', 'X2', '2024-01-01',
  'Forsikringen dækker ikke gradvis forurening. Fiktiv formulering fra anden version.', '[1,0,0]');
select pg_temp.publish('74000000-0000-4000-a000-000000000003', '73000000-0000-4000-a000-00000000000a', 'X3',
  (now() at time zone 'Europe/Copenhagen')::date + 30,
  'Forsikringen dækker ikke gradvis forurening. Fiktiv formulering fra fremtidig version.', '[0,1,0]');
select pg_temp.publish('74000000-0000-4000-a000-000000000004', '73000000-0000-4000-a000-00000000000b', 'Y1', '2020-01-01',
  'Hemmelig fiktiv frase zebrakvæg om gradvis forurening.', '[1,0,0]');
select pg_temp.publish('74000000-0000-4000-a000-000000000005', '73000000-0000-4000-a000-00000000000c', 'Z1', '2020-01-01',
  'Tilbagekaldt fiktiv frase trækfuglepolice.', '[1,0,0]');
select pg_temp.as_user('70000000-0000-4000-a000-000000000001');
set local role authenticated;
select knowledge.withdraw_version('74000000-0000-4000-a000-000000000005', 'invalid', 'Fiktiv fejl.');
reset role;

-- ---------------------------------------------------------------------------
-- Funktionens egenskaber
-- ---------------------------------------------------------------------------
select is((select provolatile from pg_proc where oid = 'knowledge.search_chunks(text,text,uuid,text,date,text,uuid[],uuid[],text[],int)'::regprocedure),
  's', 'search_chunks er STABLE og kan derfor ikke skrive');
select is((select prosecdef from pg_proc where oid = 'knowledge.search_chunks(text,text,uuid,text,date,text,uuid[],uuid[],text[],int)'::regprocedure),
  false, 'search_chunks er SECURITY INVOKER, så RLS også gælder');
select ok(not has_function_privilege('anon', 'knowledge.search_chunks(text,text,uuid,text,date,text,uuid[],uuid[],text[],int)', 'execute'),
  'anon kan ikke kalde search_chunks');
select ok(has_function_privilege('authenticated', 'knowledge.search_chunks(text,text,uuid,text,date,text,uuid[],uuid[],text[],int)', 'execute'),
  'indloggede kan kalde search_chunks');

-- ---------------------------------------------------------------------------
-- Dokumentisolation (docs/07 §15)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('70000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.versions('gradvis forurening'), array['X2:current'],
  'current: kun den gældende version af det tildelte dokument — aldrig to versioner af samme dokument');
select is(pg_temp.versions('zebrakvæg'), '{}'::text[], 'en ordret unik frase fra et ikke-tildelt dokument giver 0 chunks');
select is(pg_temp.versions('gradvis forurening', p_documents => array['73000000-0000-4000-a000-00000000000b'::uuid]), '{}'::text[],
  'et klientfilter på et ikke-tildelt dokument giver 0 — filtre kan ikke udvide adgangen');
select is(pg_temp.versions('gradvis forurening', p_products => array['72000000-0000-4000-a000-000000000002'::uuid]), '{}'::text[],
  'et produktfilter kan heller ikke udvide adgangen');
select is(pg_temp.versions('gradvis forurening', p_documents => array['73000000-0000-4000-a000-00000000000a'::uuid]), array['X2:current'],
  'et filter på det tildelte dokument snævrer ind');
select is((select count(*)::int from knowledge.search_chunks('forurening', '[1,0,0]', '71000000-0000-4000-a000-000000000001')
           where document_id <> '73000000-0000-4000-a000-00000000000a'), 0,
  'vektorsøgning: et ikke-tildelt chunk med identisk vektor indgår ikke');
select ok((select bool_and(vector_rank is not null) from knowledge.search_chunks('forurening', '[1,0,0]', '71000000-0000-4000-a000-000000000001')),
  'vektorsøgning med den aktive model giver vektorrang');
select throws_ok($$ select * from knowledge.search_chunks('forurening', '[1,0,0]', '61000000-0000-4000-a000-000000000099') $$, '22023', null,
  'en forespørgsel lavet med en anden model end den aktive afvises — vektorer fra flere modeller blandes aldrig');
reset role;

-- ---------------------------------------------------------------------------
-- Gældende, historisk og fremtidig viden (docs/07 §3.4–3.5)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('70000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.versions('gradvis forurening', 'as_of', '2022-06-01'), array['X1:historical'],
  'as_of i forgængerens periode giver forgængeren, markeret historisk, med read_historical');
select is(pg_temp.versions('gradvis forurening', 'as_of', '2023-12-31'), array['X1:historical'],
  'valid_to er eksklusiv: dagen før efterfølgerens gyldig fra giver forgængeren');
select is(pg_temp.versions('gradvis forurening', 'as_of', '2024-01-01'), array['X2:current'],
  'valid_from er inklusiv: efterfølgerens første dag giver efterfølgeren');
select is(pg_temp.versions('gradvis forurening', 'as_of', (now() at time zone 'Europe/Copenhagen')::date + 40), array['X3:future'],
  'en fremtidig version findes ved as_of efter dens gyldig fra og markeres fremtidig');
select ok(not ('X3:future' = any (pg_temp.versions('gradvis forurening'))), 'en fremtidig version indgår ikke i current');
select is(pg_temp.versions('gradvis forurening', 'as_of', '2019-06-01'), '{}'::text[], 'før første version findes intet');
select throws_ok($$ select * from knowledge.search_chunks('x', null, null, 'as_of', null) $$, '22023', null, 'as_of kræver en dato');
select throws_ok($$ select * from knowledge.search_chunks(repeat('x', 1001), null, null) $$, '22023', null, 'forespørgslens længde er begrænset');
reset role;

select pg_temp.as_user('70000000-0000-4000-a000-000000000003');
set local role authenticated;
select is(pg_temp.versions('gradvis forurening', 'as_of', '2022-06-01'), '{}'::text[],
  'uden read_historical giver as_of i forgængerens periode intet');
select is(pg_temp.versions('gradvis forurening'), array['X2:current'], 'med read ses den gældende version');
reset role;

-- ---------------------------------------------------------------------------
-- Uautoriseret retrieval og deaktiverede versioner
-- ---------------------------------------------------------------------------
select pg_temp.as_user('70000000-0000-4000-a000-000000000004');
set local role authenticated;
select is(pg_temp.versions('gradvis forurening'), '{}'::text[], 'en rådgiver uden tildelinger får et tomt resultat');
select is(pg_temp.versions('gradvis forurening', 'as_of', '2022-06-01'), '{}'::text[], '— også historisk');
reset role;

select pg_temp.as_user('70000000-0000-4000-a000-000000000001');
set local role authenticated;
select is(pg_temp.versions('trækfuglepolice'), '{}'::text[], 'en deaktiveret version findes aldrig i retrieval — heller ikke for administrator');
select is(pg_temp.versions('trækfuglepolice', 'as_of', '2021-01-01'), '{}'::text[], '— heller ikke historisk');
select is(pg_temp.versions('zebrakvæg'), array['Y1:current'], 'administratorens rolle med scope "all" giver læseadgang (permission, ikke rollenavn)');
reset role;

select pg_temp.as_user('70000000-0000-4000-a000-000000000005');
set local role authenticated;
select ok((select count(*) from knowledge.document_versions where id = '74000000-0000-4000-a000-000000000002') = 1,
  'forvalteren ser versionen gennem RLS (forvaltning)');
select is(pg_temp.versions('gradvis forurening'), '{}'::text[],
  'men forvaltning giver ingen retrieval: search_chunks filtrerer selv på læseadgang');
select is(pg_temp.versions('trækfuglepolice', 'as_of', '2021-01-01'), '{}'::text[], '— og finder heller ikke den deaktiverede version');
reset role;

set local role anon;
select throws_ok($$ select * from knowledge.search_chunks('gradvis forurening', null, null) $$, '42501', null, 'uindlogget afvises');
reset role;

-- ---------------------------------------------------------------------------
-- Forespørgslen gemmes ikke, og funktionen virker i en read-only transaktion
-- ---------------------------------------------------------------------------
create temporary table counts_before as
  select (select count(*) from audit.audit_log) as audit_rows,
         (select count(*) from knowledge.document_versions) as versions,
         (select count(*) from knowledge.document_chunks) as chunks,
         (select count(*) from knowledge.chunk_embeddings) as embeddings;
select pg_temp.as_user('70000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.versions('pgtap-hemmelig-forespørgsel-42 gradvis'), array['X2:current'], 'en søgning gennemføres');
reset role;
select is((select audit_rows from counts_before), (select count(*) from audit.audit_log), 'retrieval skriver intet i audit');
select ok((select versions = (select count(*) from knowledge.document_versions)
              and chunks = (select count(*) from knowledge.document_chunks)
              and embeddings = (select count(*) from knowledge.chunk_embeddings) from counts_before),
  'retrieval ændrer ingen knowledge-rækker');
select ok(not exists (select 1 from audit.audit_log where details::text like '%pgtap-hemmelig-forespørgsel-42%'),
  'forespørgselsteksten findes ikke i audit');

-- Herfra er transaktionen read-only (som PostgREST kører STABLE-funktioner).
set local transaction_read_only = on;
select pg_temp.as_user('70000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.versions('gradvis forurening'), array['X2:current'], 'retrieval virker i en read-only transaktion');
reset role;
select pg_temp.as_user('70000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.withdraw_version('74000000-0000-4000-a000-000000000002', 'invalid', 'x') $$, '25006', null,
  'i den read-only transaktion kan intet skrives — heller ikke gennem en funktion');
reset role;
select is((select status from knowledge.document_versions where id = '74000000-0000-4000-a000-000000000002'), 'published',
  'versionen er uændret');
select ok(current_setting('transaction_read_only') = 'on', 'transaktionen er stadig read-only');

select * from finish();
rollback;
