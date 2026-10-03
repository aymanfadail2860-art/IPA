-- pgTAP: 8B-I3 — workerens databaseidentitet og mindste rettigheder (docs/08b §6.1.1, §21.4).
-- Begge login-roller (blue og green) testes ens. Alt rulles tilbage.
--
-- Testen kører som postgres. "set local role <worker>" kræver, at postgres midlertidigt får
-- SET på login-rollen (kun i transaktionen). Fordi session_user her er postgres, testes
-- "kan ikke skifte til en privilegeret rolle" både i kataloget (pg_has_role … 'SET', som gælder
-- for en rigtig login-session) og med forsøg mod andre roller end postgres.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(82);

-- Hjælpere (kun i testens transaktion).
create function pg_temp.reachable_functions(p_role text) returns text[] language sql stable as $$
  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_'
    and has_schema_privilege(p_role, n.oid, 'USAGE') and has_function_privilege(p_role, p.oid, 'EXECUTE')
$$;
create function pg_temp.api() returns text[] language sql stable as $$
  select array_agg(f::text order by f::text) from unnest(ops.ingestion_worker_api()) f
$$;
create function pg_temp.table_privileges(p_role text, p_any_schema boolean) returns int language sql stable as $$
  select count(*)::int
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_'
    and (p_any_schema or has_schema_privilege(p_role, n.oid, 'USAGE'))
    and (p_any_schema is false or n.nspname in ('knowledge', 'identity', 'audit', 'ai', 'advise', 'assessment', 'practice', 'ops', 'public', 'storage', 'auth', 'vault'))
    and ((c.relkind in ('r', 'p', 'v', 'm', 'f')
          and (has_table_privilege(p_role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               or has_any_column_privilege(p_role, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
      or (c.relkind = 'S' and has_sequence_privilege(p_role, c.oid, 'USAGE,SELECT,UPDATE')))
$$;
create function pg_temp.usable_schemas(p_role text) returns text[] language sql stable as $$
  select array_agg(nspname::text order by nspname) from pg_namespace
  where nspname not in ('pg_catalog', 'information_schema') and nspname !~ '^pg_' and has_schema_privilege(p_role, oid, 'USAGE')
$$;

-- ---------------------------------------------------------------------------
-- 1. Rollerne efter migrationen: begge findes, NOLOGIN, uden medlemskab og uden attributter.
-- ---------------------------------------------------------------------------

select ok((select not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls
           from pg_roles where rolname = 'ingestion_worker'), 'gruppen ingestion_worker er NOLOGIN uden særlige attributter');
select is((select count(*)::int from pg_roles where rolname in ('ingestion_worker_login_blue', 'ingestion_worker_login_green')
           and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls and rolconnlimit = 5), 2,
  'blue og green findes uden særlige attributter og med connection limit 5');
select is((select count(*)::int from pg_roles where rolname in ('ingestion_worker_login_blue', 'ingestion_worker_login_green')
           and not rolcanlogin and not pg_has_role(rolname, 'ingestion_worker', 'MEMBER')), 2,
  'efter migrationen er begge login-roller NOLOGIN og ikke medlem — kun runbooken aktiverer');
select is((select count(*)::int from pg_roles r, unnest(r.rolconfig) c
           where r.rolname in ('ingestion_worker_login_blue', 'ingestion_worker_login_green')
             and (c like 'statement_timeout=%' or c like 'lock_timeout=%' or c like 'idle_in_transaction_session_timeout=%' or c = 'search_path=""')), 8,
  'login-rollerne har statement_timeout, lock_timeout, idle-timeout og tom search_path');
select is((select count(*)::int from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
           where g.rolname = 'ingestion_worker' and (m.inherit_option or m.set_option)
             and u.rolname not in ('ingestion_worker_login_blue', 'ingestion_worker_login_green', 'service_role')), 0,
  'ingen andre roller er medlem af ingestion_worker (ejerens ADMIN-tildeling giver hverken arv eller SET)');
select is((select count(*)::int from pg_auth_members m join pg_roles u on u.oid = m.member
           where u.rolname in ('ingestion_worker', 'ingestion_worker_login_blue', 'ingestion_worker_login_green')
             and m.roleid <> 'ingestion_worker'::regrole), 0,
  'worker-rollerne er ikke medlem af nogen anden rolle (authenticated, service_role, postgres …)');
select is((select count(*)::int from (
             select relowner o from pg_class union all select proowner from pg_proc union all select nspowner from pg_namespace
             union all select typowner from pg_type) x
           where o in ('ingestion_worker'::regrole, 'ingestion_worker_login_blue'::regrole, 'ingestion_worker_login_green'::regrole)), 0,
  'worker-rollerne ejer ingen objekter');
select is(pg_temp.reachable_functions('ingestion_worker_login_blue'), '{}'::text[], 'en inaktiv rolle (blue) kan ikke køre nogen app-funktion');
select is(pg_temp.reachable_functions('ingestion_worker_login_green'), '{}'::text[], 'en inaktiv rolle (green) kan ikke køre nogen app-funktion');

-- ---------------------------------------------------------------------------
-- 2. Rotation: begge aktive (som under et kontrolleret skift). Samme snævre rettigheder.
-- ---------------------------------------------------------------------------

select lives_ok($$ select ops.ingestion_worker_prepare('ingestion_worker_login_blue') $$, 'runbooken aktiverer blue');
select lives_ok($$ select ops.ingestion_worker_prepare('ingestion_worker_login_green') $$, 'runbooken aktiverer green');
select throws_ok($$ select ops.ingestion_worker_prepare('postgres') $$, '22023', null, 'ops-funktionerne tager kun de to worker-roller');
select ok((select bool_and(rolcanlogin and pg_has_role(rolname, 'ingestion_worker', 'USAGE') and not pg_has_role(rolname, 'ingestion_worker', 'SET'))
           from pg_roles where rolname in ('ingestion_worker_login_blue', 'ingestion_worker_login_green')),
  'aktiverede roller har LOGIN og arver gruppen, men kan ikke SET ROLE til den');

select is(pg_temp.reachable_functions('ingestion_worker_login_blue'), pg_temp.api(), 'blue kan køre præcis det godkendte worker-API');
select is(pg_temp.reachable_functions('ingestion_worker_login_green'), pg_temp.api(), 'green kan køre præcis det godkendte worker-API');
select is(pg_temp.api(), array[
    'knowledge.worker_checkpoint(uuid,text,text,jsonb)', 'knowledge.worker_chunks_to_embed(uuid,text,uuid)',
    'knowledge.worker_claim_job(text,integer)', 'knowledge.worker_complete_job(uuid,text,jsonb)', 'knowledge.worker_embedding_models()',
    'knowledge.worker_fail_job(uuid,text,text,text,boolean)', 'knowledge.worker_heartbeat(uuid,text,integer)',
    'knowledge.worker_issue_storage_ticket(uuid,text,text)', 'knowledge.worker_store_chunks(uuid,text,jsonb,text)',
    'knowledge.worker_store_embeddings(uuid,text,uuid,jsonb)', 'knowledge.worker_store_pages(uuid,text,jsonb,integer,bigint,text,text)',
    'knowledge.worker_verify_index(uuid,text)'],
  'API-listen er de tolv godkendte funktioner');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and p.prosrc like '%knowledge.assert_worker_caller()%')
           from unnest(ops.ingestion_worker_api()) f join pg_proc p on p.oid = f),
  'hver API-funktion er security definer med fast search_path og kontrollerer kalderens identitet');
select ok((select bool_and(not has_function_privilege(r, f, 'EXECUTE'))
           from unnest(ops.ingestion_worker_api()) f, unnest(array['public', 'anon', 'authenticated', 'authenticator']) r),
  'PUBLIC, anon, authenticated og authenticator kan ikke køre worker-API''et');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'knowledge' and p.proname like 'worker_%'
    and p.prosrc ~* $re$(set\s+status\s*=\s*'published'|published_at\s*=|approved_at\s*=|withdrawn_at\s*=|document_access_grants|set\s+status\s*=\s*'active')$re$
), 'ingen workerfunktion publicerer, godkender, deaktiverer, ændrer adgang eller aktiverer en model');
select ok(not exists (
  select 1 from unnest(ops.ingestion_worker_api()) f join pg_proc p on p.oid = f
  where p.prosrc ~* '\mexecute\M\s+(format|p_|v_sql|\$)'
), 'ingen API-funktion udfører dynamisk SQL (ingen generisk SQL-proxy)');

select is(pg_temp.table_privileges('ingestion_worker_login_blue', false), 0, 'blue har ingen tabel-, kolonne- eller sekvensrettigheder');
select is(pg_temp.table_privileges('ingestion_worker_login_green', false), 0, 'green har ingen tabel-, kolonne- eller sekvensrettigheder');
select is(pg_temp.table_privileges('ingestion_worker_login_blue', true), 0, 'blue har ingen rettigheder på tabeller i app-, auth-, storage- og vault-skemaer');
select is(pg_temp.table_privileges('ingestion_worker_login_green', true), 0, 'green har ingen rettigheder på tabeller i app-, auth-, storage- og vault-skemaer');
select is(pg_temp.usable_schemas('ingestion_worker_login_blue'), array['knowledge', 'public'], 'blue kan kun bruge skemaerne knowledge og public');
select is(pg_temp.usable_schemas('ingestion_worker_login_green'), array['knowledge', 'public'], 'green kan kun bruge skemaerne knowledge og public');
select ok((select bool_and(not has_schema_privilege(r, n.oid, 'CREATE'))
           from pg_namespace n, unnest(array['ingestion_worker_login_blue', 'ingestion_worker_login_green']) r
           where n.nspname !~ '^pg_(temp|toast_temp)_'),
  'ingen af rollerne kan oprette objekter i noget skema');
select ok(not has_database_privilege('ingestion_worker_login_blue', current_database(), 'CREATE')
          and not has_database_privilege('ingestion_worker_login_green', current_database(), 'CREATE'),
  'ingen af rollerne kan oprette skemaer');
select ok((select bool_and(not pg_has_role(r, x, 'SET') and not pg_has_role(r, x, 'USAGE'))
           from unnest(array['ingestion_worker_login_blue', 'ingestion_worker_login_green']) r,
                unnest(array['postgres', 'service_role', 'authenticated', 'anon', 'authenticator', 'supabase_admin']) x
           where x <> r),
  'ingen af rollerne kan SET ROLE til eller arve postgres, service_role, authenticated, anon, authenticator eller supabase_admin');
select ok(not pg_has_role('ingestion_worker_login_blue', 'ingestion_worker_login_green', 'SET')
          and not pg_has_role('ingestion_worker_login_green', 'ingestion_worker_login_blue', 'SET'),
  'blue og green kan ikke skifte til hinanden');
select ok(not pg_has_role('authenticator', 'ingestion_worker_login_blue', 'SET') and not pg_has_role('authenticator', 'ingestion_worker', 'SET')
          and not pg_has_role('authenticated', 'ingestion_worker', 'MEMBER') and not pg_has_role('anon', 'ingestion_worker', 'MEMBER'),
  'PostgREST (authenticator) og brugerroller kan ikke optræde som workeren');

-- Rigtige forsøg som hver rolle. Kun i testens transaktion: USAGE på extensions, så pgTAP kan kaldes.
grant ingestion_worker_login_blue, ingestion_worker_login_green to postgres with inherit false, set true;
grant usage on schema extensions to ingestion_worker_login_blue, ingestion_worker_login_green;

set local role ingestion_worker_login_blue;
select throws_ok($$ select count(*) from knowledge.ingestion_jobs $$, '42501', null, 'blue kan ikke læse jobtabellen direkte');
select throws_ok($$ insert into knowledge.document_chunks (document_version_id) values (gen_random_uuid()) $$, '42501', null, 'blue kan ikke indsætte chunks direkte');
select throws_ok($$ update knowledge.document_versions set status = 'published' $$, '42501', null, 'blue kan ikke opdatere versioner direkte');
select throws_ok($$ delete from knowledge.chunk_embeddings $$, '42501', null, 'blue kan ikke slette embeddings direkte');
select throws_ok($$ select knowledge.approve_version(gen_random_uuid(), '{}') $$, '42501', null, 'blue kan ikke godkende');
select throws_ok($$ select knowledge.withdraw_version(gen_random_uuid(), 'x', 'y') $$, '42501', null, 'blue kan ikke deaktivere');
select throws_ok($$ insert into knowledge.document_access_grants (document_id) values (gen_random_uuid()) $$, '42501', null, 'blue kan ikke ændre dokumentadgang');
select throws_ok($$ select knowledge.activate_embedding_model(gen_random_uuid()) $$, '42501', null, 'blue kan ikke aktivere en embeddingmodel');
select throws_ok($$ select count(*) from identity.users $$, '42501', null, 'blue kan ikke læse brugere');
select throws_ok($$ select count(*) from advise.customer_cases $$, '42501', null, 'blue kan ikke læse kundesager');
select throws_ok($$ select count(*) from audit.audit_log $$, '42501', null, 'blue kan ikke læse audit');
select throws_ok($$ select count(*) from ai.data_category_policy $$, '42501', null, 'blue kan ikke læse AI-politikken');
select throws_ok($$ select ai.set_data_category_rule('a', 'b', 'c') $$, '42501', null, 'blue kan ikke ændre AI-politikken');
select throws_ok($$ select knowledge.redeem_worker_storage_ticket(repeat('a', 64)) $$, '42501', null, 'blue kan ikke indløse billetter');
select throws_ok($$ select ops.ingestion_worker_status() $$, '42501', null, 'blue kan ikke bruge ops-funktionerne');
select throws_ok($$ select knowledge.as_worker() $$, '42501', null, 'blue kan ikke kalde workerens interne hjælpere');
select throws_ok($$ grant ingestion_worker to ingestion_worker_login_green $$, '42501', null, 'blue kan ikke give medlemskab');
select throws_ok($$ revoke ingestion_worker from ingestion_worker_login_green $$, '42501', null, 'blue kan ikke fjerne en andens medlemskab');
select throws_ok($$ alter role ingestion_worker_login_blue createrole $$, '42501', null, 'blue kan ikke give sig selv attributter');
select throws_ok($$ alter role ingestion_worker_login_blue connection limit 100 $$, '42501', null, 'blue kan ikke hæve sin connection limit');
select throws_ok($$ create role pgtap_x $$, '42501', null, 'blue kan ikke oprette roller');
reset role;

set local role ingestion_worker_login_green;
select throws_ok($$ select count(*) from knowledge.document_chunks $$, '42501', null, 'green kan ikke læse chunks direkte');
select throws_ok($$ update knowledge.ingestion_jobs set status = 'succeeded' $$, '42501', null, 'green kan ikke opdatere jobs direkte');
select throws_ok($$ select knowledge.reject_version(gen_random_uuid(), 'x') $$, '42501', null, 'green kan ikke afvise eller publicere');
select throws_ok($$ select count(*) from identity.user_roles $$, '42501', null, 'green kan ikke læse rolletildelinger');
select throws_ok($$ select count(*) from ai.gateway_payloads $$, '42501', null, 'green kan ikke læse AI-loggen');
select throws_ok($$ select knowledge.redeem_worker_storage_ticket(repeat('a', 64)) $$, '42501', null, 'green kan ikke indløse billetter');
select throws_ok($$ grant ingestion_worker to ingestion_worker_login_blue $$, '42501', null, 'green kan ikke give medlemskab');
reset role;

-- Workeren kan ikke give sig selv rettigheder.
set local role ingestion_worker_login_blue;
select throws_ok($$ grant execute on function knowledge.approve_version(uuid, jsonb) to ingestion_worker_login_blue $$, '42501', null,
  'blue kan ikke give sig selv EXECUTE på en admin-funktion');
select throws_ok($$ grant select on knowledge.ingestion_jobs to ingestion_worker_login_blue $$, '42501', null,
  'blue kan ikke give sig selv tabelrettigheder');
reset role;
select ok(not has_function_privilege('ingestion_worker_login_blue', 'knowledge.approve_version(uuid, jsonb)', 'EXECUTE'),
  'rettighederne er uændrede');

-- ---------------------------------------------------------------------------
-- 3. Identitet: kun workerens roller — ikke ejeren, ikke brugere, ikke andre medlemmer.
-- ---------------------------------------------------------------------------

select throws_ok($$ select * from knowledge.worker_embedding_models() $$, '42501', null,
  'ejeren (postgres) har EXECUTE, men afvises af identitetskontrollen');
set local role authenticated;
select throws_ok($$ select * from knowledge.worker_claim_job('x') $$, '42501', null, 'en bruger kan ikke tage jobs');
reset role;
grant ingestion_worker to authenticated;
set local role authenticated;
select throws_ok($$ select * from knowledge.worker_embedding_models() $$, '42501', null,
  'selv et (fejlagtigt) medlem af gruppen afvises, hvis det ikke er en af workerens roller');
reset role;
revoke ingestion_worker from authenticated;

-- Direkte tildelinger (fx ved en fejl) erstatter ikke medlemskabet.
select ops.ingestion_worker_retire('ingestion_worker_login_green');
grant usage on schema knowledge to ingestion_worker_login_green;
grant execute on function knowledge.worker_embedding_models() to ingestion_worker_login_green;
set local role ingestion_worker_login_green;
select throws_ok($$ select * from knowledge.worker_embedding_models() $$, '42501', null,
  'en rolle med direkte USAGE og EXECUTE, men uden medlemskab, afvises af identitetskontrollen');
reset role;
revoke execute on function knowledge.worker_embedding_models() from ingestion_worker_login_green;
revoke usage on schema knowledge from ingestion_worker_login_green;
select ops.ingestion_worker_prepare('ingestion_worker_login_green');

-- service_role: lokalt kun via seedets medlemskab. Uden medlemskab: ingen adgang.
revoke ingestion_worker from service_role;
set local role service_role;
select throws_ok($$ select * from knowledge.worker_embedding_models() $$, '42501', null,
  'service_role uden udviklingsmedlemskab kan ikke køre worker-API''et');
reset role;
select ok(not exists (select 1 from unnest(ops.ingestion_worker_api()) f where has_function_privilege('service_role', f, 'EXECUTE')),
  'service_role har ingen EXECUTE på worker-API''et uden udviklingsmedlemskabet');
select is(ops.ingestion_worker_status() -> 'violations', '[]'::jsonb, 'status: ingen overtrædelser, når service_role ikke er worker');
grant ingestion_worker to service_role;
select ok(ops.ingestion_worker_status() -> 'violations' ? 'service_role_is_worker', 'status melder service_role som worker (kun lovligt lokalt)');
set local role service_role;
select lives_ok($$ select * from knowledge.worker_embedding_models() $$, 'lokalt (seedets medlemskab) kan service_role køre workeren');
reset role;

-- ---------------------------------------------------------------------------
-- 4. Nødspærring og global stop. Ændrer ingen domænedata.
-- ---------------------------------------------------------------------------

select ops.ingestion_worker_set_api(false);
set local role ingestion_worker_login_green;
select throws_ok($$ select * from knowledge.worker_embedding_models() $$, '42501', null, 'efter global stop kan green intet køre');
reset role;
select ops.ingestion_worker_set_api(true);
set local role ingestion_worker_login_green;
select lives_ok($$ select * from knowledge.worker_embedding_models() $$, 'API''et kan gives tilbage præcist');
reset role;

create temp table domain_before as
  select (select count(*) from knowledge.document_versions) v, (select count(*) from knowledge.document_chunks) c,
         (select count(*) from knowledge.ingestion_jobs) j, (select md5(coalesce(string_agg(id::text || status, ',' order by id), '')) from knowledge.document_versions) s;
select is(ops.ingestion_worker_emergency_revoke('ingestion_worker_login_blue'), 0, 'nødspærring af blue (ingen åbne sessioner i testen)');
select ok((select not rolcanlogin and not pg_has_role(rolname, 'ingestion_worker', 'MEMBER') from pg_roles where rolname = 'ingestion_worker_login_blue'),
  'blue er NOLOGIN og uden medlemskab efter nødspærring');
set local role ingestion_worker_login_blue;
select throws_ok($$ select * from knowledge.worker_embedding_models() $$, '42501', null,
  'en spærret rolle afvises straks — også på en allerede åben forbindelse');
reset role;
set local role ingestion_worker_login_green;
select lives_ok($$ select * from knowledge.worker_embedding_models() $$, 'green arbejder videre, mens blue er spærret');
reset role;
select ok((select v = (select count(*) from knowledge.document_versions) and c = (select count(*) from knowledge.document_chunks)
                  and j = (select count(*) from knowledge.ingestion_jobs)
                  and s = (select md5(coalesce(string_agg(id::text || status, ',' order by id), '')) from knowledge.document_versions)
           from domain_before), 'nødspærringen ændrer ingen domænedata');
select ok(exists (select 1 from audit.audit_log where action = 'ops.ingestion_worker.emergency_revoked' and entity_id = 'ingestion_worker_login_blue'),
  'nødspærringen auditeres');
select is(ops.ingestion_worker_retire('ingestion_worker_login_green'), 0, 'rotationens deaktivering af green');
select ok(exists (select 1 from audit.audit_log where action = 'ops.ingestion_worker.retired' and entity_id = 'ingestion_worker_login_green'),
  'rotationen auditeres');

-- ---------------------------------------------------------------------------
-- 5. Værn mod PUBLIC: en ny funktion uden revoke ville give workeren adgang (USAGE på
--    knowledge og public). Testene ovenfor (præcis API'et) og denne fanger det.
-- ---------------------------------------------------------------------------

select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('knowledge', 'public', 'ops') and has_function_privilege('public', p.oid, 'EXECUTE')
), 'ingen funktion i knowledge, public eller ops er eksekverbar for PUBLIC');

select * from finish();
rollback;
