-- pgTAP: Knowledge Engine trin 2 — privat bucket, registrering af upload og audit af
-- download-URL'er (docs/07 §2.2, §5.1, §13, §14). Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('30000000-0000-4000-a000-000000000001', 's.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Administrator"}'),
  ('30000000-0000-4000-a000-000000000002', 's.adv@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r
  on r.key = case when u.auth_id = '30000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id in ('30000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002');
insert into knowledge.products (id, name) values ('32000000-0000-4000-a000-000000000001', 'pgTAP Storageprodukt');

select ok(
  (select not public and allowed_mime_types = array['application/pdf'] and file_size_limit = 52428800
   from storage.buckets where id = 'knowledge-originals'),
  'originaler ligger i en privat bucket, der kun tager imod PDF op til 50 MB'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'knowledge_originals_%' and cmd in ('UPDATE', 'DELETE')),
  0, 'der findes ingen policy, som tillader at ændre eller slette en original'
);
select ok(knowledge.is_original_path('11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/original.pdf'),
  'stien følger {document_id}/{version_id}/original.pdf');
select ok(not knowledge.is_original_path('11111111-1111-4111-8111-111111111111/../betingelser.pdf'),
  'en sti med brugerens filnavn afvises');

-- Rådgiveren kan ikke registrere en upload.
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select knowledge.register_upload('33000000-0000-4000-a000-000000000001', '34000000-0000-4000-a000-000000000001',
       '{"product_id":"32000000-0000-4000-a000-000000000001","document_type":"terms","title":"x"}', '1', 'da',
       null, null, repeat('a', 64), 'x.pdf') $$,
  '42501', null, 'en rådgiver kan ikke registrere en upload'
);
reset role;

-- Administratoren kan ikke registrere uden fil i Storage.
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select knowledge.register_upload('33000000-0000-4000-a000-000000000001', '34000000-0000-4000-a000-000000000001',
       '{"product_id":"32000000-0000-4000-a000-000000000001","document_type":"terms","title":"x"}', '1', 'da',
       null, null, repeat('a', 64), 'x.pdf') $$,
  'P0002', null, 'registrering kræver, at filen ligger i Storage'
);
reset role;

-- Med filen i Storage oprettes dokument, version (uploaded) og job i én transaktion.
insert into storage.objects (bucket_id, name, metadata)
values ('knowledge-originals',
        '34000000-0000-4000-a000-000000000001/33000000-0000-4000-a000-000000000001/original.pdf',
        '{"size": 1234, "mimetype": "application/pdf"}');
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  knowledge.register_upload('33000000-0000-4000-a000-000000000001', '34000000-0000-4000-a000-000000000001',
    '{"product_id":"32000000-0000-4000-a000-000000000001","document_type":"terms","title":"pgTAP Upload"}', '1', 'da',
    '2026-01-01', null, repeat('a', 64), 'betingelser.pdf'),
  '33000000-0000-4000-a000-000000000001'::uuid, 'administratoren registrerer en uploadet version'
);
select is(
  (select status || '/' || byte_size::text from knowledge.document_versions where id = '33000000-0000-4000-a000-000000000001'),
  'uploaded/1234', 'versionen starter som uploadet med størrelsen fra Storage'
);
select is(
  (select status from knowledge.ingestion_jobs where document_version_id = '33000000-0000-4000-a000-000000000001'),
  'queued', 'behandlingsjobbet oprettes i samme transaktion'
);
select is(
  knowledge.log_original_download('33000000-0000-4000-a000-000000000001'),
  '34000000-0000-4000-a000-000000000001/33000000-0000-4000-a000-000000000001/original.pdf',
  'en forvalter kan få stien til en signeret download-URL'
);
reset role;
select ok(
  exists (select 1 from audit.audit_log where action = 'knowledge.original.download_url_issued'
          and entity_id = '33000000-0000-4000-a000-000000000001'),
  'udstedelse af en download-URL auditeres'
);

select * from finish();
rollback;
