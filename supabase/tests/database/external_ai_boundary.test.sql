-- pgTAP: 8B-I2.5 — kundedata kan aldrig tillades i datakategori-matricen (docs/08b §8.2 L4).
-- Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('82000000-0000-4000-a000-000000000001', 'e.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Egress-admin"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = 'administrator'
where u.auth_id = '82000000-0000-4000-a000-000000000001';

create function pg_temp.as_user(p_auth text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;

select ok(exists (
  select 1 from pg_constraint
  where conname = 'customer_identifiable_always_denied' and conrelid = 'ai.data_category_policy'::regclass
), 'constraint customer_identifiable_always_denied findes');

select is((select count(*)::int from ai.data_category_policy where category = 'customer_identifiable' and rule <> 'deny'), 0,
  'ingen række tillader kundedata');

-- Direkte skrivning, selv som superbruger (som en migration eller service-rollen ville gøre).
select throws_ok($$ insert into ai.data_category_policy (model_id, category, rule) values ('ekstern-model', 'customer_identifiable', 'allow') $$,
  '23514', null, 'kundedata kan ikke indsættes som allow');
select throws_ok($$ insert into ai.data_category_policy (model_id, category, rule) values ('ekstern-model', 'customer_identifiable', 'allow_redacted') $$,
  '23514', null, 'kundedata kan ikke indsættes som allow_redacted — redaction åbner ikke for kundedata');
select throws_ok($$ update ai.data_category_policy set rule = 'allow' where model_id = 'stub' and category = 'customer_identifiable' $$,
  '23514', null, 'kundedata kan ikke opdateres til allow');
select lives_ok($$ insert into ai.data_category_policy (model_id, category, rule) values ('ekstern-model', 'customer_identifiable', 'deny') $$,
  'deny kan fortsat sættes');

-- Administratoren gennem den eneste skrivevej.
select pg_temp.as_user('82000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select ai.set_data_category_rule('stub', 'customer_identifiable', 'allow') $$, '23514', null,
  'administratoren kan ikke tillade kundedata via ai.set_data_category_rule');
select throws_ok($$ select ai.set_data_category_rule('stub', 'customer_identifiable', 'allow_redacted') $$, '23514', null,
  'heller ikke som allow_redacted');
reset role;

select is((select rule from ai.data_category_policy where model_id = 'stub' and category = 'customer_identifiable'), 'deny',
  'stub-modellens kundedata-regel er uændret deny');

select * from finish();
rollback;
