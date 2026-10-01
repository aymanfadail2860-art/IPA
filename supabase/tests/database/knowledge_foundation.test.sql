-- pgTAP: Knowledge Engine trin 1 — tilstandsregler, uforanderlighed, adgang pr. dokument,
-- RLS og audit (docs/07 §2, §4, §13, §14). Køres med `npx supabase test db`. Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(40);

-- ---------------------------------------------------------------------------
-- Fiktive testdata (oprettes og rulles tilbage i transaktionen)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('20000000-0000-4000-a000-000000000001', 'k.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Administrator"}'),
  ('20000000-0000-4000-a000-000000000002', 'k.adv1@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver 1"}'),
  ('20000000-0000-4000-a000-000000000003', 'k.adv2@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver 2"}'),
  ('20000000-0000-4000-a000-000000000004', 'k.leader@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Leder"}'),
  ('20000000-0000-4000-a000-000000000005', 'k.inactive@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Inaktiv"}');

insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = case u.auth_id
  when '20000000-0000-4000-a000-000000000001' then 'administrator'
  when '20000000-0000-4000-a000-000000000004' then 'leader'
  else 'advisor' end
where u.auth_id::text like '20000000-0000-4000-a000-00000000000_';
update identity.users set status = 'inactive' where auth_id = '20000000-0000-4000-a000-000000000005';

-- Teams: T0 (rod) → T1 (barn); T2 separat. Rådgiver 1 i T1, Rådgiver 2 i T2, Inaktiv i T1.
-- Lederen har lederscope over T0 inkl. underteams, men er ikke medlem.
insert into identity.teams (id, name) values
  ('21000000-0000-4000-a000-000000000000', 'pgTAP T0'),
  ('21000000-0000-4000-a000-000000000002', 'pgTAP T2');
insert into identity.teams (id, name, parent_team_id) values
  ('21000000-0000-4000-a000-000000000001', 'pgTAP T1', '21000000-0000-4000-a000-000000000000');
insert into identity.team_memberships (user_id, team_id)
select u.id, t.team_id from identity.users u join (values
  ('20000000-0000-4000-a000-000000000002'::uuid, '21000000-0000-4000-a000-000000000001'::uuid),
  ('20000000-0000-4000-a000-000000000003', '21000000-0000-4000-a000-000000000002'),
  ('20000000-0000-4000-a000-000000000005', '21000000-0000-4000-a000-000000000001')
) as t(auth_id, team_id) on t.auth_id = u.auth_id;
insert into identity.leader_scopes (user_id, team_id, include_descendants)
select id, '21000000-0000-4000-a000-000000000000', true from identity.users where auth_id = '20000000-0000-4000-a000-000000000004';

insert into knowledge.products (id, name) values ('22000000-0000-4000-a000-000000000001', 'pgTAP Testprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '23000000-0000-4000-a000-000000000001', '22000000-0000-4000-a000-000000000001', 'terms', s.id, 'pgTAP Testbetingelser'
from knowledge.sources s where s.type = 'manual_upload';

insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('24000000-0000-4000-a000-000000000001', '23000000-0000-4000-a000-000000000001', '1', '2020-01-01',
        'pgtap/v1/original.pdf', repeat('a', 64));

-- ---------------------------------------------------------------------------
-- Struktur og grundrettigheder
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables where schemaname = 'knowledge' and not rowsecurity), 0,
  'RLS er slået til på alle knowledge-tabeller'
);
select ok(not has_schema_privilege('anon', 'knowledge', 'usage'), 'anon har ingen adgang til knowledge-skemaet');
select ok(not has_column_privilege('authenticated', 'knowledge.document_versions', 'status', 'update'),
  'authenticated kan ikke opdatere versionsstatus direkte');
select ok(not has_table_privilege('authenticated', 'knowledge.document_chunks', 'insert'),
  'authenticated kan ikke skrive chunks direkte');
select is((select count(*)::int from knowledge.document_types), 8, 'præcis de otte dokumenttyper fra docs/03 §6');

-- ---------------------------------------------------------------------------
-- Tilstandsmaskinen (docs/07 §2.2) gælder for alle roller
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into knowledge.document_versions (document_id, storage_path, checksum_sha256, status, valid_from, approved_at, published_at)
     values ('23000000-0000-4000-a000-000000000001', 'pgtap/x.pdf', repeat('b', 64), 'published', '2020-01-01', now(), now()) $$,
  '23514', null, 'en ny version kan ikke starte som publiceret'
);
select throws_ok(
  $$ update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now()
     where id = '24000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'uploadet → publiceret afvises (springer behandling og review over)'
);
select throws_ok(
  $$ insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
     values ('24000000-0000-4000-a000-000000000001', 1, 'x', true, 0, 1) $$,
  '23514', null, 'sider kan ikke skrives, før versionen behandles'
);

update knowledge.document_versions set status = 'processing' where id = '24000000-0000-4000-a000-000000000001';
insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
values ('24000000-0000-4000-a000-000000000001', 1, '§ 4 Undtagelser. Forsikringen dækker ikke forurening.', true, 0, 53);
insert into knowledge.document_chunks (document_version_id, chunk_index, kind, text, heading, heading_path, section_number,
  page_start, page_end, char_start, char_end, content_hash, char_count, token_estimate)
values ('24000000-0000-4000-a000-000000000001', 0, 'prose', 'Forsikringen dækker ikke forurening.', '§ 4 Undtagelser',
  '{"§ 4 Undtagelser"}', '4', 1, 1, 17, 53, repeat('c', 64), 36, 9);
select pass('sider og chunks kan skrives, mens versionen behandles');

select ok(
  (select fts_da @@ to_tsquery('danish', 'forurening') and fts_simple @@ to_tsquery('simple', 'undtagelser')
   from knowledge.document_chunks where document_version_id = '24000000-0000-4000-a000-000000000001'),
  'chunks får leksikalske søgekolonner inkl. overskriftskæden'
);

update knowledge.document_versions set status = 'processed', page_count = 1 where id = '24000000-0000-4000-a000-000000000001';
select throws_ok(
  $$ delete from knowledge.document_chunks where document_version_id = '24000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'chunks er frosne, når behandlingen er færdig'
);
select throws_ok(
  $$ update knowledge.document_versions set page_count = 2 where id = '24000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'teknisk indhold kan ikke ændres efter behandlingen'
);

update knowledge.document_versions set status = 'under_review' where id = '24000000-0000-4000-a000-000000000001';
select throws_ok(
  $$ update knowledge.document_versions set valid_from = '2021-01-01' where id = '24000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'påbegyndt review låser versionens metadata'
);

update knowledge.document_versions
set status = 'published', approved_at = now(), published_at = now()
where id = '24000000-0000-4000-a000-000000000001';
select is(
  (select status from knowledge.document_versions where id = '24000000-0000-4000-a000-000000000001'), 'published',
  'under review → publiceret er en gyldig overgang'
);

select throws_ok(
  $$ update knowledge.document_versions set valid_to = null, valid_from = '2019-01-01'
     where id = '24000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'en publiceret versions gyldighed kan ikke udvides'
);
select throws_ok(
  $$ update knowledge.document_versions set status = 'processing' where id = '24000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'en publiceret version kan ikke genbehandles'
);
select throws_ok(
  $$ delete from knowledge.document_versions where id = '24000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'versioner slettes aldrig'
);

-- Exclusion constraint: to publicerede versioner af samme dokument og sprog må ikke overlappe.
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('24000000-0000-4000-a000-000000000002', '23000000-0000-4000-a000-000000000001', '2', '2024-01-01',
        'pgtap/v2/original.pdf', repeat('d', 64));
update knowledge.document_versions set status = 'processing' where id = '24000000-0000-4000-a000-000000000002';
update knowledge.document_versions set status = 'processed' where id = '24000000-0000-4000-a000-000000000002';
update knowledge.document_versions set status = 'under_review' where id = '24000000-0000-4000-a000-000000000002';
select throws_ok(
  $$ update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now()
     where id = '24000000-0000-4000-a000-000000000002' $$,
  '23P01', null, 'overlappende publicerede versioner af samme dokument afvises'
);

-- Afkortning ved erstatning er tilladt: v1 gælder [2020-01-01, 2024-01-01), v2 fra 2024-01-01.
update knowledge.document_versions
set valid_to = '2024-01-01', superseded_by = '24000000-0000-4000-a000-000000000002', superseded_at = now()
where id = '24000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now()
where id = '24000000-0000-4000-a000-000000000002';
select is(
  (select count(*)::int from knowledge.document_versions where document_id = '23000000-0000-4000-a000-000000000001' and status = 'published'),
  2, 'erstatning afkorter forgængeren, og begge versioner er publiceret uden overlap'
);

-- Et udgået produkt kan ikke få nye dokumenter.
insert into knowledge.products (id, name, status) values ('22000000-0000-4000-a000-000000000002', 'pgTAP Udgået', 'retired');
select throws_ok(
  $$ insert into knowledge.documents (product_id, document_type, source_id, title)
     select '22000000-0000-4000-a000-000000000002', 'terms', id, 'x' from knowledge.sources limit 1 $$,
  '23514', null, 'et udgået produkt kan ikke få nye dokumenter'
);

-- Tildelinger skal være entydige.
select throws_ok(
  $$ insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, user_id)
     values ('23000000-0000-4000-a000-000000000001', 'knowledge.document.read', 'all_users',
             (select id from identity.users limit 1)) $$,
  '23514', null, 'en tildeling til alle brugere kan ikke samtidig pege på en bruger'
);

-- ---------------------------------------------------------------------------
-- Adgang pr. dokument og RLS (docs/07 §4). v2 er gældende i dag, v1 er historisk.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.document_versions), 0, 'rådgiver uden tildeling ser ingen versioner');
select is((select count(*)::int from knowledge.document_chunks), 0, 'rådgiver uden tildeling ser ingen chunks');
select throws_ok(
  $$ insert into knowledge.document_access_grants (document_id, permission_key, grantee_type)
     values ('23000000-0000-4000-a000-000000000001', 'knowledge.document.read', 'all_users') $$,
  '42501', null, 'en rådgiver kan ikke tildele sig selv adgang'
);
update knowledge.products set name = 'x' where id = '22000000-0000-4000-a000-000000000001';
reset role;
select is(
  (select name from knowledge.products where id = '22000000-0000-4000-a000-000000000001'), 'pgTAP Testprodukt',
  'en rådgiver kan ikke ændre produkter (RLS filtrerer opdateringen fra)'
);

-- Tildeling til T0 uden underteams: Rådgiver 1 (medlem af T1) får ikke adgang.
insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, team_id, include_descendants)
values ('23000000-0000-4000-a000-000000000001', 'knowledge.document.read', 'team', '21000000-0000-4000-a000-000000000000', false);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.document_versions), 0, 'tildeling til et overordnet team uden underteams giver ikke adgang');
reset role;

-- Med underteams: Rådgiver 1 ser den gældende version, men ikke den historiske.
update knowledge.document_access_grants set include_descendants = true
where document_id = '23000000-0000-4000-a000-000000000001' and team_id = '21000000-0000-4000-a000-000000000000';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select array_agg(version_label order by version_label) from knowledge.document_versions), array['2'],
  'medlem af et underteam ser kun den gældende version (historisk kræver read_historical)'
);
select is((select count(*)::int from knowledge.document_chunks), 0, 'den historiske versions chunks er ikke synlige uden read_historical');
select is((select count(*)::int from knowledge.document_access_grants), 0, 'en rådgiver kan ikke se tildelinger');
select is((select count(*)::int from knowledge.ingestion_jobs), 0, 'en rådgiver kan ikke se behandlingsjobs');
reset role;

-- Lederscope giver ingen vidensadgang (kun medlemskab tæller).
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.document_versions), 0, 'lederscope over teamet giver ikke adgang til teamets dokumenter');
reset role;

-- Rådgiver 2 (T2) har ingen adgang; inaktiv bruger heller ikke, selv med "alle brugere".
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.document_versions), 0, 'medlem af et andet team har ingen adgang');
reset role;

insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, user_id)
select '23000000-0000-4000-a000-000000000001', 'knowledge.document.read_historical', 'user', id
from identity.users where auth_id = '20000000-0000-4000-a000-000000000002';
insert into knowledge.document_access_grants (document_id, permission_key, grantee_type)
values ('23000000-0000-4000-a000-000000000001', 'knowledge.document.read', 'all_users');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.document_versions), 2, 'med read_historical ser rådgiveren også den historiske version');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.document_versions), 0, 'en inaktiv bruger har ingen adgang, heller ikke via "alle brugere"');
reset role;

-- Upublicerede versioner er aldrig synlige for rådgivere, heller ikke med tildeling.
insert into knowledge.document_versions (id, document_id, version_label, storage_path, checksum_sha256)
values ('24000000-0000-4000-a000-000000000003', '23000000-0000-4000-a000-000000000001', '3', 'pgtap/v3/original.pdf', repeat('e', 64));
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from knowledge.document_versions where id = '24000000-0000-4000-a000-000000000003'), 0,
  'en uploadet version er usynlig for rådgivere, også med "alle brugere"-tildeling'
);
reset role;

-- Administratoren (knowledge.* med scope all) ser også upublicerede versioner.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.document_versions where document_id = '23000000-0000-4000-a000-000000000001'), 3,
  'en vidensforvalter ser alle versioner, også upublicerede');
reset role;

-- ---------------------------------------------------------------------------
-- Audit (docs/07 §13)
-- ---------------------------------------------------------------------------
select ok(
  (select count(distinct action) from audit.audit_log
   where entity_schema = 'knowledge' and entity_id = '24000000-0000-4000-a000-000000000002'
     and action in ('knowledge.version.uploaded', 'knowledge.version.processing_started',
                    'knowledge.version.processing_succeeded', 'knowledge.version.review_started',
                    'knowledge.version.approved', 'knowledge.version.published')) = 6,
  'hver statusovergang auditeres som navngiven hændelse'
);
select ok(
  exists (select 1 from audit.audit_log where action = 'knowledge.version.superseded'
          and entity_id = '24000000-0000-4000-a000-000000000001'),
  'erstatning auditeres'
);
select ok(
  exists (select 1 from audit.audit_log where action = 'knowledge.access.granted'
          and entity_id = '23000000-0000-4000-a000-000000000001'),
  'tildeling af adgang auditeres'
);
select ok(
  not exists (select 1 from audit.audit_log where entity_schema = 'knowledge' and details::text like '%forurening%'),
  'audit indeholder aldrig dokumenttekst'
);

select * from finish();
rollback;
