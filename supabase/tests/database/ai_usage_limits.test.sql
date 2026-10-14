-- pgTAP: beta L4 — forbrugsgrænser for ekstern AI i databasen (docs/beta.md §16.7–§16.8, B-039).
-- Startværdier, godkendte modeller og priser, reservation før kaldet, rate limits, samtidighed,
-- budgetter i UTC, afstemning, frigivelse, "uncertain", forsøg og audit. Alt rulles tilbage.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(54);

-- ---------------------------------------------------------------------------
-- Fiktive data: en administrator og tre rådgivere. Ingen tidligere reservationer.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('82000000-0000-4000-a000-000000000001', 'u.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Forbrug-admin"}'),
  ('82000000-0000-4000-a000-000000000002', 'u.a@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Forbrug A"}'),
  ('82000000-0000-4000-a000-000000000003', 'u.b@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Forbrug B"}'),
  ('82000000-0000-4000-a000-000000000004', 'u.c@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Forbrug C"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = case u.auth_id
  when '82000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id::text like '82000000-0000-4000-a000-00000000000_';

create function pg_temp.as_user(p_auth text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.uid(p_auth text) returns uuid language sql as $$
  select id from identity.users where auth_id = p_auth::uuid
$$;
-- Historik indsættes direkte (testopsætning): en afsluttet reservation med en given omkostning.
create function pg_temp.history(p_user uuid, p_at timestamptz, p_status text, p_cost numeric) returns void language sql as $$
  insert into ai.usage_reservations (user_id, request_id, token_hash, model_id, profile_id, action, status,
    reserved_input_tokens, reserved_output_tokens, reserved_cost_usd, input_usd_per_mtok, output_usd_per_mtok,
    cache_write_usd_per_mtok, cache_read_usd_per_mtok, actual_cost_usd, created_at, expires_at, finished_at)
  values (p_user, gen_random_uuid(), '\x00', 'claude-pgtap', 'copilot', 'answer_question', p_status, 1000, 100,
    p_cost, 4, 20, 5, 0.4, case when p_status = 'settled' then p_cost end, p_at, p_at + interval '5 minutes',
    case when p_status = 'pending' then null else p_at end)
$$;
create function pg_temp.reserve(p_output integer default 3000) returns setof record language sql as $$
  select reservation_id, reservation_token, max_input_tokens, reserved_cost_usd
  from ai.reserve_usage(gen_random_uuid(), 'claude-pgtap', 'copilot', 'answer_question', p_output, false)
$$;
create function pg_temp.refusal(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ingen afvisning';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.reserve(integer), pg_temp.refusal(text) to authenticated;

delete from ai.usage_reservations;
delete from ai.model_prices;

-- ---------------------------------------------------------------------------
-- 1. De godkendte startværdier og adgang
-- ---------------------------------------------------------------------------
select is(
  (select row(max_input_tokens, max_output_tokens, user_calls_per_minute, user_calls_per_day, global_calls_per_minute,
     user_active_calls, global_active_calls, global_daily_budget_usd, global_monthly_budget_usd, user_daily_budget_usd)::text
   from ai.usage_limits),
  '(100000,3000,3,20,10,1,3,10.0000,30.0000,2.0000)',
  'startgrænserne er de godkendte (§16.7)');
-- Afsnit 2–4 og 8 prøver andet end rate limits; afsnit 5–7 sætter den grænse, de prøver.
update ai.usage_limits set user_calls_per_minute = 100, user_calls_per_day = 100, global_calls_per_minute = 100;
select ok((select relrowsecurity from pg_class where oid = 'ai.usage_reservations'::regclass), 'RLS er slået til på reservationerne');
select ok(not has_function_privilege('anon', 'ai.reserve_usage(uuid, text, text, text, integer, boolean)', 'execute'), 'anon kan ikke reservere');
select ok(not has_function_privilege('authenticated', 'ai.locked_reservation(uuid, text)', 'execute'), 'hjælpefunktionen kan ikke kaldes direkte');

select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ select * from ai.usage_reservations $$, '42501', null, 'en bruger kan ikke læse reservationerne direkte');
select throws_ok($$ insert into ai.usage_reservations (request_id, token_hash, model_id, profile_id, action, reserved_input_tokens, reserved_output_tokens, reserved_cost_usd, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok, cache_read_usd_per_mtok, expires_at) values (gen_random_uuid(), '\x00', 'm', 'copilot', 'a', 1, 1, 0, 1, 1, 1, 1, now()) $$,
  '42501', null, 'en bruger kan ikke skrive forbrug uden om funktionerne');
select throws_ok($$ update ai.usage_limits set user_daily_budget_usd = 1000 $$, '42501', null, 'en bruger kan ikke ændre grænserne direkte');
select throws_ok($$ select ai.set_usage_limits('{"user_daily_budget_usd": 1000}') $$, '42501', null, 'en rådgiver kan ikke ændre grænserne');
select throws_ok($$ select ai.set_model_price('claude-pgtap', 'anthropic', 4, 20, 5, 0.4, 1000000, 128000, null, 'x', current_date) $$,
  '42501', null, 'en rådgiver kan ikke godkende en model');

-- ---------------------------------------------------------------------------
-- 2. Ukendt model fejler lukket; administratoren godkender en model med priser
-- ---------------------------------------------------------------------------
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:model_not_approved', 'en model uden godkendt pris kan ikke bruges (fail-closed)');
reset role;

select pg_temp.as_user('82000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok($$ select ai.set_model_price('claude-pgtap', 'anthropic', 4, 20, 5, 0.4, 1000000, 128000, null, 'officiel prisside (test)', current_date) $$,
  'administratoren godkender en model med verificerede priser');
select throws_ok($$ select ai.set_usage_limits('{"ukendt": 1}') $$, '22023', null, 'en ukendt grænse afvises');
select lives_ok($$ select ai.set_usage_limits('{"reservation_ttl_seconds": 300}') $$, 'administratoren kan ændre en grænse');
reset role;
select ok(exists (select 1 from audit.audit_log where action = 'ai.model_prices.insert' and entity_id = 'claude-pgtap'
  and actor_id = pg_temp.uid('82000000-0000-4000-a000-000000000001')), 'godkendelsen af modellen auditeres med aktøren');
select ok(exists (select 1 from audit.audit_log where action = 'ai.usage_limits.update' and entity_id = 'usage_limits'), 'ændringen af grænserne auditeres');

-- ---------------------------------------------------------------------------
-- 3. Reservation før kaldet: den maksimale omkostning og det effektive inputloft
-- ---------------------------------------------------------------------------
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
create temp table r1 on commit drop as select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric);
select is((select max_input from r1), 100000, 'inputloftet er 100.000 tokens');
select is((select cost from r1), 0.46::numeric, 'reservationen er den maksimale omkostning: 100.000 × 4 + 3.000 × 20 USD/MTok');
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:active_user', 'kun ét aktivt kald pr. bruger');
select is(pg_temp.refusal($$ select * from pg_temp.reserve(3001) as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:output_budget', 'outputloftet på 3.000 tokens håndhæves');

-- Kun med det rigtige token, og kun brugerens egen reservation.
select is(pg_temp.refusal(format('select ai.settle_usage(%L, %L, 10, 10, 10, 0, 0, %L)', (select id from r1), 'forkert', 'ok')),
  'P0002 ai_limit:reservation_unknown', 'afstemning kræver reservationens token');
select is(ai.begin_attempt((select id from r1), (select token from r1)), 1, 'første forsøg');
select is(ai.begin_attempt((select id from r1), (select token from r1)), 2, 'andet forsøg (retry)');
select is(ai.begin_attempt((select id from r1), (select token from r1)), 3, 'tredje forsøg');
select is(pg_temp.refusal(format('select ai.begin_attempt(%L, %L)', (select id from r1), (select token from r1))),
  '54000 ai_limit:attempts_exhausted', 'ikke flere forsøg end max_attempts under én reservation');
select is(pg_temp.refusal(format('select ai.settle_usage(%L, %L, 50000, 50000, 3001, 0, 0, %L)', (select id from r1), (select token from r1), 'ok')),
  '54000 ai_limit:usage_out_of_bounds', 'usage uden for reservationen afvises (reservationen tæller fortsat fuldt)');
reset role;
select pg_temp.as_user('82000000-0000-4000-a000-000000000003');
set local role authenticated;
select is(pg_temp.refusal(format('select ai.settle_usage(%L, %L, 10, 10, 10, 0, 0, %L)', (select id from r1), (select token from r1), 'ok')),
  'P0002 ai_limit:reservation_unknown', 'en anden bruger kan ikke afstemme reservationen, heller ikke med tokenet');
reset role;
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(ai.settle_usage((select id from r1), (select token from r1), 40000, 39000, 800, 0, 1000, 'answer'),
  (39000 * 4 + 800 * 20 + 1000 * 0.4) / 1000000.0, 'afstemningen bruger den faktiske usage inkl. cache read');
select is(pg_temp.refusal(format('select ai.settle_usage(%L, %L, 10, 10, 10, 0, 0, %L)', (select id from r1), (select token from r1), 'ok')),
  '54000 ai_limit:reservation_closed', 'en afstemt reservation kan ikke afstemmes igen (ingen dobbeltregistrering)');
reset role;
select is((select row(status, actual_cost_usd, attempts, counted_input_tokens)::text from ai.usage_reservations where id = (select id from r1)),
  '(settled,0.17240000,3,40000)', 'reservationen er afstemt med faktisk omkostning, forsøg og optalte tokens');

-- ---------------------------------------------------------------------------
-- 4. Frigivelse og "uncertain"
-- ---------------------------------------------------------------------------
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
create temp table r2 on commit drop as select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric);
select lives_ok(format('select ai.release_usage(%L, %L, null, %L)', (select id from r2), (select token from r2), 'provider_rejected'),
  'en reservation frigives, når udbyderen beviseligt ikke behandlede kaldet');
create temp table r3 on commit drop as select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric);
select lives_ok(format('select ai.mark_usage_uncertain(%L, %L, 40000, %L)', (select id from r3), (select token from r3), 'provider_uncertain'),
  'efter en timeout markeres reservationen uncertain');
select is(pg_temp.refusal(format('select ai.release_usage(%L, %L, null, %L)', (select id from r3), (select token from r3), 'ok')),
  '54000 ai_limit:reservation_closed', 'en uncertain reservation kan ikke frigives bagefter');
reset role;
select is((select ai.counted_cost(r) from ai.usage_reservations r where id = (select id from r2)), 0::numeric, 'en frigivet reservation tæller 0');
select is((select ai.counted_cost(r) from ai.usage_reservations r where id = (select id from r3)), 0.46::numeric,
  'en uncertain reservation tæller fortsat med sin fulde reserverede omkostning');

-- Udløbet reservation: ingen nye forsøg, og den holder ikke længere en plads i samtidigheden.
update ai.usage_reservations set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second'
where id = (select id from r3);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
create temp table r4 on commit drop as select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric);
reset role;
update ai.usage_reservations set expires_at = now() - interval '1 second' where id = (select id from r4);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal(format('select ai.begin_attempt(%L, %L)', (select id from r4), (select token from r4))),
  '54000 ai_limit:reservation_expired', 'intet forsøg under en udløbet reservation');
create temp table r5 on commit drop as select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric);
select ok((select id from r5) is not null, 'en udløbet, åben reservation holder ikke pladsen som aktivt kald');
reset role;
select is((select ai.counted_cost(r) from ai.usage_reservations r where id = (select id from r4)), 0.46::numeric,
  'en åben reservation, der aldrig blev afsluttet, tæller fortsat fuldt i budgettet');

-- ---------------------------------------------------------------------------
-- 5. Rate limits (de seneste 60 sekunder og UTC-døgnet)
-- ---------------------------------------------------------------------------
delete from ai.usage_reservations;
update ai.usage_limits set user_calls_per_minute = 3;
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000002'), now() - interval '30 seconds', 'settled', 0.01) from generate_series(1, 3);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:rate_user_minute', '3 kald pr. bruger pr. minut');
reset role;
update ai.usage_reservations set created_at = now() - interval '61 seconds', finished_at = now() - interval '61 seconds';
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((select count(*) from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric)) = 1,
  'kald ældre end 60 sekunder tæller ikke i minutgrænsen');
reset role;

delete from ai.usage_reservations;
update ai.usage_limits set user_calls_per_minute = 100, user_calls_per_day = 20;
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000002'), date_trunc('day', now(), 'UTC') + interval '1 second', 'settled', 0.01)
from generate_series(1, 20);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:rate_user_day', '20 kald pr. bruger pr. UTC-døgn');
reset role;
update ai.usage_reservations set created_at = date_trunc('day', now(), 'UTC') - interval '1 second';
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((select count(*) from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric)) = 1,
  'gårsdagens kald (UTC) tæller ikke i dagens grænse');
reset role;

delete from ai.usage_reservations;
update ai.usage_limits set user_calls_per_day = 100, global_calls_per_minute = 10;
select pg_temp.history(pg_temp.uid(u), now() - interval '20 seconds', 'settled', 0.01)
from unnest(array['82000000-0000-4000-a000-000000000003', '82000000-0000-4000-a000-000000000004']) u, generate_series(1, 5);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:rate_global_minute', '10 kald globalt pr. minut — også når brugeren selv intet har kaldt');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Samtidighed globalt
-- ---------------------------------------------------------------------------
delete from ai.usage_reservations;
update ai.usage_limits set global_calls_per_minute = 100;
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000003'), now() - interval '2 minutes', 'pending', 0.46);
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000004'), now() - interval '2 minutes', 'pending', 0.46);
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000001'), now() - interval '2 minutes', 'pending', 0.46);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:active_global', 'højst 3 samtidige kald globalt');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Budgetter (UTC): bruger pr. døgn, globalt pr. døgn, globalt pr. kalendermåned
-- ---------------------------------------------------------------------------
delete from ai.usage_reservations;
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000002'), date_trunc('day', now(), 'UTC') + interval '1 second', 'settled', 1.55);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:budget_user_day', '2 USD pr. bruger pr. døgn: 1,55 brugt + 0,46 reserveret er for meget');
reset role;
update ai.usage_reservations set status = 'released', actual_cost_usd = null;
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((select count(*) from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric)) = 1,
  'en frigivet reservation tæller ikke i budgettet');
reset role;

delete from ai.usage_reservations;
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000003'), date_trunc('day', now(), 'UTC') + interval '1 second', 'uncertain', 1.95)
from generate_series(1, 5);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:budget_global_day', '10 USD globalt pr. døgn: 5 × 1,95 uncertain + 0,46 — uncertain-kald tæller med');
reset role;

delete from ai.usage_reservations;
-- Dagsbudgettet hæves her, så kun månedsgrænsen prøves (uanset hvilken dag i måneden testen kører).
update ai.usage_limits set global_daily_budget_usd = 1000;
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000003'), date_trunc('month', now(), 'UTC') + interval '1 second', 'settled', 9.9);
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000004'), date_trunc('month', now(), 'UTC') + interval '2 seconds', 'settled', 9.9);
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000001'), date_trunc('month', now(), 'UTC') - interval '1 second', 'settled', 9.9);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((select count(*) from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric)) = 1,
  'forrige kalendermåned (UTC) tæller ikke: 19,80 + 0,46 er under 30 USD');
reset role;
update ai.usage_reservations set status = 'settled', actual_cost_usd = 0, finished_at = now() where status = 'pending';
select pg_temp.history(pg_temp.uid('82000000-0000-4000-a000-000000000001'), date_trunc('month', now(), 'UTC') + interval '3 seconds', 'settled', 9.9);
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:budget_global_month', '30 USD globalt pr. kalendermåned: 29,70 + 0,46 er for meget');
reset role;
update ai.usage_limits set global_daily_budget_usd = 10;

-- ---------------------------------------------------------------------------
-- 8. Ét kald = én reservation; prisens gyldighed begrænser inputloftet; priser er låst pr. kald
-- ---------------------------------------------------------------------------
delete from ai.usage_reservations;
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select lives_ok($$ select * from ai.reserve_usage('83000000-0000-4000-a000-000000000001', 'claude-pgtap', 'copilot', 'answer_question', 3000, false) $$,
  'første reservation for et request-id');
reset role;
update ai.usage_reservations set status = 'settled', actual_cost_usd = 0, finished_at = now();
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from ai.reserve_usage('83000000-0000-4000-a000-000000000001', 'claude-pgtap', 'copilot', 'answer_question', 3000, false) $$),
  '54000 ai_limit:duplicate_request', 'samme request-id kan ikke reservere igen (ingen dobbeltregistrering)');
reset role;

delete from ai.usage_reservations;
update ai.model_prices set price_input_token_limit = 60000 where model_id = 'claude-pgtap';
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
create temp table r6 on commit drop as select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric);
select is((select max_input from r6), 60000, 'inputloftet følger prisens gyldighed, så et kald aldrig prissættes forkert');
reset role;
update ai.model_prices set input_usd_per_mtok = 400 where model_id = 'claude-pgtap';
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(ai.settle_usage((select id from r6), (select token from r6), 1000, 1000, 0, 0, 0, 'answer'), 0.004::numeric,
  'afstemningen bruger prisen fra reservationstidspunktet');
reset role;

delete from ai.usage_reservations;
update ai.model_prices set active = false where model_id = 'claude-pgtap';
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(pg_temp.refusal($$ select * from pg_temp.reserve() as (id uuid, token text, max_input integer, cost numeric) $$),
  '54000 ai_limit:model_not_approved', 'en deaktiveret model kan ikke bruges');
reset role;

-- Med cache-skrivning reserveres inputtet til skriveprisen.
update ai.model_prices set active = true, input_usd_per_mtok = 4, price_input_token_limit = null where model_id = 'claude-pgtap';
select pg_temp.as_user('82000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select reserved_cost_usd from ai.reserve_usage(gen_random_uuid(), 'claude-pgtap', 'copilot', 'answer_question', 3000, true)),
  0.56::numeric, 'med cache-skrivning reserveres inputtet til skriveprisen (100.000 × 5 + 3.000 × 20)');
reset role;

select * from finish();
rollback;
