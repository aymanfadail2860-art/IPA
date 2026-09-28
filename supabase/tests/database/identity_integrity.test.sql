-- pgTAP: dataintegritet og audit i identity-fundamentet (docs/06 §11).
-- Køres med `npx supabase test db` (lokal Supabase). Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

-- Scope skal være tilladt for permissionen.
select throws_ok(
  $$ insert into identity.role_permissions (role_id, permission_id, scope)
     select r.id, p.id, 'team' from identity.roles r, identity.permissions p
     where r.key = 'advisor' and p.key = 'identity.user.manage' $$,
  '23514', null, 'scope uden for permissionens allowed_scopes afvises'
);

-- Teamhierarkiet må ikke indeholde cykler.
insert into identity.teams (id, name) values
  ('10000000-0000-4000-a000-000000000001', 'pgTAP rod'),
  ('10000000-0000-4000-a000-000000000002', 'pgTAP barn');
update identity.teams set parent_team_id = '10000000-0000-4000-a000-000000000001'
  where id = '10000000-0000-4000-a000-000000000002';
select throws_ok(
  $$ update identity.teams set parent_team_id = '10000000-0000-4000-a000-000000000002'
     where id = '10000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'cyklus i teamhierarkiet afvises'
);

-- Administrative ændringer logges i audit.
select ok(
  exists (select 1 from audit.audit_log where entity_table = 'teams' and entity_id = '10000000-0000-4000-a000-000000000002' and action = 'update'),
  'ændring af team registreres i audit_log'
);

-- Audit er append-only — også for tabellens ejer.
select throws_ok($$ update audit.audit_log set action = 'x' $$, '42501', null, 'audit_log kan ikke opdateres');
select throws_ok($$ delete from audit.audit_log $$, '42501', null, 'audit_log kan ikke slettes fra');

-- Audit gemmer ikke fritekst-indhold.
select ok(
  not exists (select 1 from audit.audit_log where details ? 'display_name' or details ? 'company_name'),
  'audit_log indeholder ikke navne eller virksomhedsnavne'
);

-- anon og authenticated har ingen direkte adgang til audit.
select ok(not has_table_privilege('authenticated', 'audit.audit_log', 'select'), 'authenticated kan ikke læse audit_log');
select ok(not has_schema_privilege('anon', 'identity', 'usage'), 'anon har ingen adgang til identity-skemaet');

-- RLS er slået til på alle tabeller i identity og advise.
select is(
  (select count(*)::int from pg_tables where schemaname in ('identity', 'advise') and not rowsecurity),
  0,
  'RLS er slået til på alle identity- og advise-tabeller'
);

select * from finish();
rollback;
