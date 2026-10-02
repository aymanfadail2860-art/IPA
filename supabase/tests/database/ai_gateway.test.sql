-- pgTAP: fase 8 — AI Gateway i databasen (docs/08 §5, §9.2, §11; B-013, B-014, B-017).
-- Matricen (fail-closed, audit), gating-tilstanden (bevidst minimum), den opdelte log og
-- administratorers læsning (slået fra, auditeret). Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(64);

-- ---------------------------------------------------------------------------
-- Fiktive data
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('80000000-0000-4000-a000-000000000001', 'g.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP AI-admin"}'),
  ('80000000-0000-4000-a000-000000000002', 'g.a@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver A"}'),
  ('80000000-0000-4000-a000-000000000003', 'g.b@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver B"}'),
  ('80000000-0000-4000-a000-000000000004', 'g.c@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver C"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = case u.auth_id
  when '80000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id::text like '80000000-0000-4000-a000-00000000000_';

create function pg_temp.as_user(p_auth text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.uid(p_auth text) returns uuid language sql as $$
  select id from identity.users where auth_id = p_auth::uuid
$$;

-- Kundecase ejet af A, delt med B. C er ikke deltager.
insert into advise.customer_cases (id, company_name, owner_id)
values ('81000000-0000-4000-a000-000000000001', 'Fiktiv Tømrer ApS', pg_temp.uid('80000000-0000-4000-a000-000000000002'));
insert into advise.case_participants (case_id, user_id, access_type)
values ('81000000-0000-4000-a000-000000000001', pg_temp.uid('80000000-0000-4000-a000-000000000003'), 'viewer');

-- ---------------------------------------------------------------------------
-- Permission (B-014)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(r.key order by r.key) from identity.role_permissions rp
     join identity.roles r on r.id = rp.role_id join identity.permissions p on p.id = rp.permission_id
   where p.key = 'ai.quality.read'),
  array['administrator']::text[], 'ai.quality.read gives kun til Administrator');

-- ---------------------------------------------------------------------------
-- Matricen (B-017): fail-closed, kun via funktion, auditeret
-- ---------------------------------------------------------------------------
select is((select rule from ai.data_category_policy where model_id = 'stub' and category = 'customer_identifiable'), 'deny',
  'kundedata er deny for stub-modellen som standard');
select is((select count(*)::int from ai.data_category_policy where model_id = 'ukendt-model'), 0,
  'en ukendt model har ingen rækker (fail-closed: deny)');
select throws_ok($$ insert into ai.data_category_policy (model_id, category, rule) values ('x', 'audit_access', 'allow') $$,
  '23514', null, 'audit_access kan aldrig sættes til andet end deny');
select throws_ok($$ insert into ai.data_category_policy (model_id, category, rule) values ('x', 'andet', 'allow') $$,
  '23514', null, 'ukendt datakategori afvises');

select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select count(*)::int from ai.data_category_policy where model_id = 'stub'), 6, 'rådgiver kan læse matricen');
select throws_ok($$ update ai.data_category_policy set rule = 'allow' where model_id = 'stub' $$, '42501', null,
  'rådgiver kan ikke skrive direkte i matricen');
select throws_ok($$ select ai.set_data_category_rule('stub', 'customer_identifiable', 'allow') $$, '42501', null,
  'rådgiver kan ikke ændre matricen');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ insert into ai.data_category_policy (model_id, category, rule) values ('stub', 'learning', 'deny') $$, '42501', null,
  'heller ikke administratoren kan skrive direkte i matricen');
select lives_ok($$ select ai.set_data_category_rule('stub', 'learning', 'deny') $$, 'administrator ændrer matricen via funktionen');
reset role;
select is((select rule from ai.data_category_policy where model_id = 'stub' and category = 'learning'), 'deny', 'ændringen er gennemført');
select ok(exists (
  select 1 from audit.audit_log
  where action = 'ai.data_category_policy.update' and entity_id = 'stub:learning'
    and actor_id = pg_temp.uid('80000000-0000-4000-a000-000000000001')
    and details -> 'before' ->> 'rule' = 'allow' and details -> 'after' ->> 'rule' = 'deny' and occurred_at is not null),
  'matriceændringen er auditeret med hvem, hvad (før/efter) og hvornår');
delete from ai.data_category_policy where model_id = 'stub' and category = 'training_fictional';
select ok(exists (select 1 from audit.audit_log where action = 'ai.data_category_policy.delete' and entity_id = 'stub:training_fictional'),
  'også en ændring uden om funktionen (fx en migration) auditeres');

-- ---------------------------------------------------------------------------
-- Gating-tilstand (B-013)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select assessment_active from ai.my_gating_state()), false, 'intet aktivt forsøg fra start');
select throws_ok($$ insert into assessment.assessment_attempts (user_id) values (identity.current_user_id()) $$, '42501', null,
  'forsøg kan ikke oprettes direkte');
select lives_ok($$ select assessment.start_attempt() $$, 'A starter et forsøg');
select is((select assessment_active from ai.my_gating_state()), true, 'A har et aktivt forsøg');
select throws_ok($$ select assessment.start_attempt() $$, '23514', null, 'højst ét aktivt forsøg pr. bruger');
select throws_ok($$ update assessment.assessment_attempts set status = 'submitted' $$, '42501', null,
  'forsøget kan ikke afsluttes ved direkte opdatering');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000003');
set local role authenticated;
select is((select assessment_active from ai.my_gating_state()), false, 'B påvirkes ikke af A''s forsøg');
select is((select count(*)::int from assessment.assessment_attempts), 0, 'B kan ikke se A''s forsøg');
select throws_ok(format('select assessment.submit_attempt(%L)',
  (select id from assessment.assessment_attempts limit 1)), 'P0002', null, 'B kan ikke aflevere A''s forsøg');
reset role;
select throws_ok(format($q$ select pg_temp.as_user('80000000-0000-4000-a000-000000000003'); set local role authenticated;
  select assessment.submit_attempt(%L) $q$, (select id from assessment.assessment_attempts where user_id = pg_temp.uid('80000000-0000-4000-a000-000000000002'))),
  'P0002', null, 'B kan heller ikke aflevere A''s forsøg med det rigtige id');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select lives_ok(format('select assessment.submit_attempt(%L)', (select id from assessment.assessment_attempts where status = 'active')),
  'A afleverer sit forsøg');
select is((select assessment_active from ai.my_gating_state()), false, 'låsen ophæves straks efter aflevering');
reset role;

-- Udløbet tidsgrænse ophæver låsen.
insert into assessment.assessment_attempts (user_id, started_at, ends_at)
values (pg_temp.uid('80000000-0000-4000-a000-000000000004'), now() - interval '2 hours', now() - interval '1 hour');
select pg_temp.as_user('80000000-0000-4000-a000-000000000004');
set local role authenticated;
select is((select assessment_active from ai.my_gating_state()), false, 'et forsøg med udløbet tidsgrænse låser ikke');
select lives_ok($$ select assessment.start_attempt(now() + interval '1 hour') $$, 'et nyt forsøg kan startes efter udløb');
select is((select count(*)::int from assessment.assessment_attempts where status = 'expired'), 1, 'det udløbne forsøg er markeret udløbet');
select is((select assessment_active from ai.my_gating_state()), true, 'forsøget med tidsgrænse i fremtiden låser');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select roleplay_session_id from ai.my_gating_state()), null, 'intet aktivt rollespil fra start');
select lives_ok($$ select practice.start_roleplay() $$, 'A starter et rollespil');
select isnt((select roleplay_session_id from ai.my_gating_state()), null, 'rollespillet er aktivt');
select throws_ok($$ select practice.start_roleplay() $$, '23514', null, 'højst ét aktivt rollespil');
select lives_ok(format('select practice.end_roleplay(%L)', (select roleplay_session_id from ai.my_gating_state())), 'A afslutter rollespillet');
select is((select roleplay_session_id from ai.my_gating_state()), null, 'låsen ophæves straks efter rollespillet');
reset role;

-- ---------------------------------------------------------------------------
-- Loggen (B-014): én vej ind, egne rækker, indhold følger kundecasen
-- ---------------------------------------------------------------------------
create function pg_temp.call(p_outcome text, p_case uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('profile_id', 'copilot', 'profile_version', '1', 'action', 'answer_question',
    'model_id', 'stub', 'model_version', '1', 'model_grade', 'development', 'evidence_grade', 'development',
    'answer_grade', 'development', 'outcome', p_outcome, 'case_id', p_case,
    'user_id', '00000000-0000-4000-a000-000000000000', 'timings', '{"retrieval": 12}'::jsonb, 'redactions', '{"cpr": 1}'::jsonb)
$$;

select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ insert into ai.gateway_calls (user_id, profile_id, profile_version, action, outcome)
  values (identity.current_user_id(), 'copilot', '1', 'x', 'answer') $$, '42501', null, 'loggen kan ikke skrives direkte');
select lives_ok($$ select ai.record_call(pg_temp.call('answer'),
  '[{"evidence_id":"e1","chunk_id":"82000000-0000-4000-a000-000000000001","document_version_id":"82000000-0000-4000-a000-000000000002","score":0.8,"sent":true,"cited":true}]',
  '{"sent":{"parts":["[CPR-1] spørger"]},"returned":{"kind":"answer"}}', 'spørgsmål') $$, 'A logger et kald');
select is((select user_id from ai.gateway_calls), identity.current_user_id(), 'rækken tilhører den aktuelle bruger, uanset hvad kalderen sender');
select is((select count(*)::int from ai.gateway_call_sources), 1, 'kilderne er logget');
select is((select count(*)::int from ai.knowledge_gaps), 0, 'et svar giver intet videnshul');
select throws_ok($$ update ai.gateway_calls set outcome = 'denied' $$, '42501', null, 'loggen kan ikke rettes');
select lives_ok($$ select ai.record_call(pg_temp.call('insufficient'), '[]', null, '[CPR-1] om droner') $$, 'A logger et utilstrækkeligt kald');
select is((select question from ai.knowledge_gaps), '[CPR-1] om droner', 'videnshullet har den redigerede tekst');
select lives_ok($$ select ai.record_call(pg_temp.call('insufficient', '81000000-0000-4000-a000-000000000001'), '[]',
  '{"sent":{"parts":["sag"]},"returned":null}', 'Fiktiv Tømrer ApS spørger') $$, 'A logger et sagsbundet kald');
select is((select question from ai.knowledge_gaps where case_bound), null, 'et videnshul fra en kundecase har aldrig tekst');
select throws_ok($$ select ai.record_call(pg_temp.call('answer', '81000000-0000-4000-a000-000000000099'), '[]', null, null) $$,
  '42501', null, 'et kald kan ikke bindes til en sag, brugeren ikke deltager i');
select throws_ok($$ select ai.record_call(pg_temp.call('answer') || '{"reason_code":"fri tekst med mellemrum"}', '[]', null, null) $$,
  '23514', null, 'metadata kan ikke bære fritekst');
reset role;
select throws_ok($$ insert into ai.knowledge_gaps (call_id, user_id, question, case_bound)
  select id, user_id, 'tekst', true from ai.gateway_calls limit 1 $$, '23514', null, 'databasen afviser tekst på et sagsbundet videnshul');

select pg_temp.as_user('80000000-0000-4000-a000-000000000003');
set local role authenticated;
select is((select count(*)::int from ai.gateway_calls), 0, 'B ser ikke A''s metadata');
select is((select count(*)::int from ai.gateway_payloads), 1, 'B ser kun indholdet fra det sagsbundne kald (B deltager i sagen)');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000004');
set local role authenticated;
select is((select count(*)::int from ai.gateway_payloads), 0, 'C (ikke deltager) ser intet indhold');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select count(*)::int from ai.gateway_calls) + (select count(*)::int from ai.gateway_payloads)
  + (select count(*)::int from ai.knowledge_gaps), 0, 'administratoren kan ikke læse andres log direkte');

-- ---------------------------------------------------------------------------
-- Administratorers læsning (B-014): slået fra, kræver permission, auditeret
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from ai.admin_call_metadata() $$, '42501', 'Administratorers læsning af AI-loggen er slået fra.',
  'administratorlæsning er slået fra i fase 8');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ select ai.set_admin_metadata_read(true) $$, '42501', null, 'rådgiver kan ikke slå administratorlæsning til');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok($$ select ai.set_admin_metadata_read(true) $$, 'administrator slår læsning til (kun i testen)');
reset role;
select ok(exists (select 1 from audit.audit_log where action = 'ai.settings.update'
  and details -> 'after' ->> 'admin_metadata_read_enabled' = 'true' and actor_id = pg_temp.uid('80000000-0000-4000-a000-000000000001')),
  'ændringen af kontakten er auditeret');

select pg_temp.as_user('80000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ select * from ai.admin_call_metadata() $$, '42501', 'Ingen adgang', 'uden ai.quality.read ingen læsning');
reset role;

select pg_temp.as_user('80000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select count(*)::int from ai.admin_call_metadata(now())), 3, 'med kontakt og permission kan metadata læses');
select is((select count(*)::int from ai.admin_knowledge_gaps(now()) where question is null and case_bound), 1,
  'videnshullet fra kundecasen er kun det nøgne faktum');
reset role;
select is((select count(*)::int from audit.audit_log where action in ('ai.metadata.read', 'ai.knowledge_gaps.read')
  and actor_id = pg_temp.uid('80000000-0000-4000-a000-000000000001')), 2, 'hver administratorlæsning er auditeret');
select ok(not exists (
  select 1 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_schema = 'ai' and r.routine_name in ('admin_call_metadata', 'admin_knowledge_gaps')
    and p.parameter_mode = 'OUT' and p.parameter_name in ('user_id', 'case_id')),
  'administratorfunktionerne returnerer hverken bruger-id eller sags-id');

-- Sletning af sagen fjerner indholdet; metadata bevares uden sags-id.
delete from advise.customer_cases where id = '81000000-0000-4000-a000-000000000001';
select is((select count(*)::int from ai.gateway_payloads where case_id = '81000000-0000-4000-a000-000000000001'), 0, 'sagens indhold slettes med sagen');
select is((select count(*)::int from ai.gateway_calls where case_bound and case_id is null
  and user_id = pg_temp.uid('80000000-0000-4000-a000-000000000002')), 1, 'metadata bevares uden sags-id');
select throws_ok($$ update ai.gateway_calls set case_bound = false where case_bound and user_id = pg_temp.uid('80000000-0000-4000-a000-000000000002') $$, '42501', null,
  'kun fremmednøglens nulstilling af sags-id er tilladt');

select * from finish();
rollback;
