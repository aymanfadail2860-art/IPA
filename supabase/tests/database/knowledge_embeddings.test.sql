-- pgTAP: Knowledge Engine trin 4 — embeddings, modeller og indeks (docs/07 §7, §14).
-- Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(21);

-- Fiktive data: en administrator, en rådgiver, et dokument med én version og ét chunk.
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('50000000-0000-4000-a000-000000000001', 'e.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Administrator"}'),
  ('50000000-0000-4000-a000-000000000002', 'e.adv@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r
  on r.key = case when u.auth_id = '50000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id in ('50000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000002');

-- Dækning gælder hele databasen. Andre versioner (fx fra lokale integrationskørsler) tages
-- ud af betragtning inden for denne tilbagerullede transaktion.
update knowledge.document_versions set status = 'processed' where status = 'under_review';
update knowledge.document_versions set status = 'discarded' where status in ('processed', 'rejected');
update knowledge.document_versions set status = 'withdrawn', withdrawn_at = now(), withdrawal_category = 'other',
  withdrawal_reason = 'pgTAP-isolation' where status = 'published';

-- Kun testens egne modeller er aktive/kandidater.
update knowledge.embedding_models set status = 'retired', retired_at = now() where status in ('active', 'candidate')
  and id <> '00000000-0000-4000-b000-000000000001';
update knowledge.embedding_models set status = 'candidate', activated_at = null where id = '00000000-0000-4000-b000-000000000001';
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('51000000-0000-4000-a000-000000000001', 'pgtap', 'fiktiv-model', '1', 3, 'candidate');

insert into knowledge.products (id, name) values ('52000000-0000-4000-a000-000000000001', 'pgTAP Embeddingprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '53000000-0000-4000-a000-000000000001', '52000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Embedding'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('54000000-0000-4000-a000-000000000001', '53000000-0000-4000-a000-000000000001', '1', '2020-01-01', 'e/1.pdf', repeat('5', 64));
update knowledge.document_versions set status = 'processing' where id = '54000000-0000-4000-a000-000000000001';
insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, page_start, page_end,
  char_start, char_end, content_hash, char_count, token_estimate)
values ('55000000-0000-4000-a000-000000000001', '54000000-0000-4000-a000-000000000001', 0, 'prose', 'Fiktiv tekst.', '{}',
  1, 1, 0, 13, repeat('6', 64), 13, 4);

select ok(exists (select 1 from pg_indexes where schemaname = 'knowledge' and indexname = 'chunk_embeddings_test_hash_embedder_1_hnsw'
                  and indexdef ilike '%hnsw%vector(256)%WHERE%'), 'udviklingsmodellen har et partielt HNSW-indeks på sin dimension');
select is((select count(*)::int from knowledge.embedding_models where status = 'active'), 0, 'ingen model er aktiv ved start af testen');

select throws_ok(
  $$ insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
     values ('55000000-0000-4000-a000-000000000001', '51000000-0000-4000-a000-000000000001', '[1,2]', 'da', repeat('7', 64)) $$,
  '23514', null, 'en embedding med forkert dimension afvises'
);
insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
values ('55000000-0000-4000-a000-000000000001', '51000000-0000-4000-a000-000000000001', '[1,2,3]', 'da', repeat('7', 64));
select pass('en embedding med modellens dimension gemmes, mens versionen behandles');
select throws_ok(
  $$ update knowledge.chunk_embeddings set embedding = '[3,2,1]' where chunk_id = '55000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'embeddings ændres aldrig'
);
select throws_ok(
  $$ insert into knowledge.embedding_models (provider, model_name, model_version, dimensions, status)
     values ('pgtap', 'anden', '1', 3, 'active'), ('pgtap', 'tredje', '1', 3, 'active') $$,
  '23505', null, 'der kan højst være én aktiv model'
);

select is(knowledge.version_has_active_embeddings('54000000-0000-4000-a000-000000000001'), false,
  'uden aktiv model har versionen ikke "aktive" embeddings (godkendelse blokeres)');

-- Behandling færdig; review; publicering.
update knowledge.document_versions set status = 'processed' where id = '54000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'under_review' where id = '54000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now()
  where id = '54000000-0000-4000-a000-000000000001';

-- Re-embedding af en publiceret version tilføjer vektorer uden at ændre chunks.
insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
values ('55000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000001',
        (select ('[' || array_to_string(array_fill(0::real, array[255]) || array[1::real], ',') || ']'))::extensions.vector,
        'da', repeat('8', 64));
select pass('re-embedding af en publiceret version tilføjer en vektor for en anden model');
select throws_ok(
  $$ delete from knowledge.chunk_embeddings where chunk_id = '55000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'en publiceret versions embeddings kan ikke slettes'
);

-- Aktivering kræver system.settings.manage, afviser udviklingsmodellen og kræver fuld dækning.
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select knowledge.activate_embedding_model('51000000-0000-4000-a000-000000000001') $$,
  '42501', null, 'en rådgiver kan ikke skifte embedding-model');
select is((select count(*)::int from knowledge.embedding_models), 0, 'en rådgiver kan ikke se embedding-modellerne');
select is((select count(*)::int from knowledge.chunk_embeddings), 0, 'en rådgiver uden tildeling ser ingen embeddings');
reset role;

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select knowledge.activate_embedding_model('00000000-0000-4000-b000-000000000001') $$,
  '23514', null, 'udviklingsmodellen kan ikke aktiveres gennem funktionen');
select throws_ok(
  $$ insert into knowledge.embedding_models (provider, model_name, model_version, dimensions) values ('pgtap', 'x', '1', 3) $$,
  '42501', null, 'modeller oprettes kun via migrationer, ikke af brugere'
);
reset role;
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('51000000-0000-4000-a000-000000000002', 'pgtap', 'udaekket', '1', 3, 'candidate');
set local role authenticated;
select throws_ok($$ select knowledge.activate_embedding_model('51000000-0000-4000-a000-000000000002') $$,
  '23514', null, 'en model uden fuld dækning kan ikke aktiveres');
select lives_ok($$ select knowledge.activate_embedding_model('51000000-0000-4000-a000-000000000001') $$,
  'en fuldt dækket kandidat aktiveres af en administrator med system.settings.manage');
reset role;
select is((select status from knowledge.embedding_models where id = '51000000-0000-4000-a000-000000000001'), 'active',
  'kandidaten er nu den aktive model');
select is(knowledge.version_has_active_embeddings('54000000-0000-4000-a000-000000000001'), true,
  'versionen har embeddings for den aktive model');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.embedding_model.activated'
                  and entity_id = '51000000-0000-4000-a000-000000000001'), 'modelskiftet auditeres');

-- Med en tildeling ser rådgiveren embeddings for den publicerede version.
insert into knowledge.document_access_grants (document_id, permission_key, grantee_type)
values ('53000000-0000-4000-a000-000000000001', 'knowledge.document.read_historical', 'all_users'),
       ('53000000-0000-4000-a000-000000000001', 'knowledge.document.read', 'all_users');
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from knowledge.chunk_embeddings where chunk_id = '55000000-0000-4000-a000-000000000001'), 2,
  'med en tildeling ser rådgiveren embeddings for den publicerede version');
reset role;

-- Deaktiverede versioner beholder embeddings, men får ingen nye.
update knowledge.document_versions set status = 'withdrawn', withdrawn_at = now(), withdrawal_category = 'other', withdrawal_reason = 'pgTAP'
  where id = '54000000-0000-4000-a000-000000000001';
select throws_ok(
  $$ insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
     values ('55000000-0000-4000-a000-000000000001', '51000000-0000-4000-a000-000000000002', '[1,1,1]', 'da', repeat('9', 64)) $$,
  '23514', null, 'en deaktiveret version får ingen nye embeddings'
);

select * from finish();
rollback;
