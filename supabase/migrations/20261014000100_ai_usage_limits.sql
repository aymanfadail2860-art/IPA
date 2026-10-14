-- ============================================================================
-- Beta L4 — forbrugsgrænser for ekstern AI: tokenbudget, rate limits, samtidighed og budget
--
-- Specifikation: docs/beta.md §16.7–§16.8 (B-039).
--
-- Principper:
--   * Grænserne er konfiguration i databasen (én række). De ændres kun af en bruger med
--     system.settings.manage, og hver ændring auditeres af en trigger — også en ændring direkte
--     i SQL.
--   * Kun godkendte modeller med verificerede priser kan bruges. Ukendt model eller pris = afvist
--     (fail-closed). Migrationen indsætter ingen modeller: de konfigureres før L4b.
--   * En reservation tages FØR det eksterne kald, i én transaktion under én global lås, så
--     samtidige Vercel-instanser ikke kan omgå grænserne. Den reserverer den maksimale omkostning
--     (tokenloftet × inputpris + outputloftet × outputpris) og afstemmes bagefter med den faktiske
--     usage.
--   * En reservation frigives KUN, når udbyderen beviseligt ikke behandlede kaldet. Efter en
--     netværksfejl eller timeout markeres den "uncertain" og tæller fortsat med sin fulde
--     reserverede omkostning. En reservation, der aldrig afsluttes (fx et afbrudt kald), tæller
--     også med sin fulde reserverede omkostning. Intet frigives automatisk.
--   * Alle perioder er UTC: døgn og kalendermåned fra date_trunc(..., 'UTC'), minut som de
--     seneste 60 sekunder.
--   * Rækkerne indeholder aldrig tekst: ingen prompt, intet spørgsmål, ingen dokumenttekst.
--   * Kun gatewayen kender reservationens hemmelige token (det returneres én gang og gemmes kun
--     som SHA-256). En bruger, der kalder funktionerne direkte, kan derfor ikke afslutte eller
--     frigive gatewayens reservationer — kun sine egne, og så højst inden for sine egne grænser.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Grænserne (én række) — de godkendte startværdier (docs/beta.md §16.7)
-- ----------------------------------------------------------------------------

create table ai.usage_limits (
  id boolean primary key default true check (id),
  max_input_tokens integer not null check (max_input_tokens between 1 and 2000000),
  max_output_tokens integer not null check (max_output_tokens between 1 and 200000),
  user_calls_per_minute integer not null check (user_calls_per_minute >= 0),
  user_calls_per_day integer not null check (user_calls_per_day >= 0),
  global_calls_per_minute integer not null check (global_calls_per_minute >= 0),
  user_active_calls integer not null check (user_active_calls >= 0),
  global_active_calls integer not null check (global_active_calls >= 0),
  global_daily_budget_usd numeric(12, 4) not null check (global_daily_budget_usd >= 0),
  global_monthly_budget_usd numeric(12, 4) not null check (global_monthly_budget_usd >= 0),
  user_daily_budget_usd numeric(12, 4) not null check (user_daily_budget_usd >= 0),
  -- Hvor længe en åben reservation holder en plads i samtidigheden (ikke i budgettet).
  reservation_ttl_seconds integer not null check (reservation_ttl_seconds between 30 and 3600),
  -- Det højeste antal forsøg mod udbyderen under én reservation. Adapteren gentager aldrig et
  -- kald (B-040) og bruger højst ét forsøg; grænsen er databasens værn.
  max_attempts integer not null check (max_attempts between 1 and 5),
  updated_by uuid references identity.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table ai.usage_limits is
  'Forbrugsgrænser for ekstern AI (docs/beta.md §16.7, B-039). Startværdier til demo; ændres med ai.set_usage_limits.';

insert into ai.usage_limits (id, max_input_tokens, max_output_tokens, user_calls_per_minute, user_calls_per_day,
  global_calls_per_minute, user_active_calls, global_active_calls, global_daily_budget_usd, global_monthly_budget_usd,
  user_daily_budget_usd, reservation_ttl_seconds, max_attempts)
values (true, 100000, 3000, 3, 20, 10, 1, 3, 10, 30, 2, 300, 3);

-- ----------------------------------------------------------------------------
-- 2. Godkendte modeller og deres verificerede priser
-- ----------------------------------------------------------------------------

create table ai.model_prices (
  model_id text primary key check (model_id ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  provider text not null check (provider = 'anthropic'),
  input_usd_per_mtok numeric(12, 6) not null check (input_usd_per_mtok > 0),
  output_usd_per_mtok numeric(12, 6) not null check (output_usd_per_mtok > 0),
  cache_write_usd_per_mtok numeric(12, 6) not null check (cache_write_usd_per_mtok > 0),
  cache_read_usd_per_mtok numeric(12, 6) not null check (cache_read_usd_per_mtok > 0),
  context_window_tokens integer not null check (context_window_tokens > 0),
  max_output_tokens integer not null check (max_output_tokens > 0),
  -- Prisen gælder kun op til denne promptstørrelse (fx en dyrere pris for lange prompts). Null =
  -- samme pris uanset størrelse. Et kald over grænsen afvises frem for at blive prissat forkert.
  price_input_token_limit integer check (price_input_token_limit is null or price_input_token_limit > 0),
  -- Hvor og hvornår prisen er verificeret mod udbyderens officielle dokumentation.
  verified_source text not null check (char_length(verified_source) between 1 and 300),
  verified_on date not null,
  active boolean not null default true,
  updated_by uuid references identity.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table ai.model_prices is
  'Godkendte eksterne modeller med verificerede priser (B-039). Ingen række = modellen kan ikke bruges.';

-- Audit af grænser og priser: hvem, før og efter, hvornår. En trigger, så ingen ændring undgår den.
create or replace function ai.audit_usage_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, details)
  values (
    identity.current_user_id(),
    'ai.' || tg_table_name || '.' || lower(tg_op),
    tg_table_schema,
    tg_table_name,
    case when tg_table_name = 'model_prices' then v_row ->> 'model_id' else 'usage_limits' end,
    jsonb_build_object(
      'before', case when tg_op = 'INSERT' then null else to_jsonb(old) - 'updated_by' - 'updated_at' end,
      'after', case when tg_op = 'DELETE' then null else to_jsonb(new) - 'updated_by' - 'updated_at' end
    )
  );
  return null;
end;
$$;

create trigger usage_limits_audit after insert or update or delete on ai.usage_limits
  for each row execute function ai.audit_usage_config_change();
create trigger model_prices_audit after insert or update or delete on ai.model_prices
  for each row execute function ai.audit_usage_config_change();

-- Grænser og priser er ikke hemmelige: gatewayen læser dem som den aktuelle bruger.
alter table ai.usage_limits enable row level security;
alter table ai.model_prices enable row level security;
revoke all on ai.usage_limits, ai.model_prices from anon, authenticated;
grant select on ai.usage_limits, ai.model_prices to authenticated;
create policy usage_limits_read on ai.usage_limits for select to authenticated using (true);
create policy model_prices_read on ai.model_prices for select to authenticated using (true);

-- Ændrer en eller flere grænser (system.settings.manage). Ukendte nøgler afvises.
create or replace function ai.set_usage_limits(p_limits jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := ai.require_permission('system.settings.manage');
  v_key text;
  v_allowed constant text[] := array['max_input_tokens', 'max_output_tokens', 'user_calls_per_minute', 'user_calls_per_day',
    'global_calls_per_minute', 'user_active_calls', 'global_active_calls', 'global_daily_budget_usd',
    'global_monthly_budget_usd', 'user_daily_budget_usd', 'reservation_ttl_seconds', 'max_attempts'];
begin
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'Grænserne skal angives som et objekt.' using errcode = 'invalid_parameter_value';
  end if;
  for v_key in select jsonb_object_keys(p_limits) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Ukendt grænse: %', v_key using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  update ai.usage_limits set
    max_input_tokens = coalesce((p_limits ->> 'max_input_tokens')::integer, max_input_tokens),
    max_output_tokens = coalesce((p_limits ->> 'max_output_tokens')::integer, max_output_tokens),
    user_calls_per_minute = coalesce((p_limits ->> 'user_calls_per_minute')::integer, user_calls_per_minute),
    user_calls_per_day = coalesce((p_limits ->> 'user_calls_per_day')::integer, user_calls_per_day),
    global_calls_per_minute = coalesce((p_limits ->> 'global_calls_per_minute')::integer, global_calls_per_minute),
    user_active_calls = coalesce((p_limits ->> 'user_active_calls')::integer, user_active_calls),
    global_active_calls = coalesce((p_limits ->> 'global_active_calls')::integer, global_active_calls),
    global_daily_budget_usd = coalesce((p_limits ->> 'global_daily_budget_usd')::numeric, global_daily_budget_usd),
    global_monthly_budget_usd = coalesce((p_limits ->> 'global_monthly_budget_usd')::numeric, global_monthly_budget_usd),
    user_daily_budget_usd = coalesce((p_limits ->> 'user_daily_budget_usd')::numeric, user_daily_budget_usd),
    reservation_ttl_seconds = coalesce((p_limits ->> 'reservation_ttl_seconds')::integer, reservation_ttl_seconds),
    max_attempts = coalesce((p_limits ->> 'max_attempts')::integer, max_attempts),
    updated_by = v_actor,
    updated_at = now()
  where id;
end;
$$;

-- Godkender (eller opdaterer) en model med verificerede priser (system.settings.manage).
create or replace function ai.set_model_price(
  p_model_id text, p_provider text, p_input numeric, p_output numeric, p_cache_write numeric, p_cache_read numeric,
  p_context_window integer, p_max_output integer, p_price_input_token_limit integer, p_verified_source text,
  p_verified_on date, p_active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := ai.require_permission('system.settings.manage');
begin
  insert into ai.model_prices (model_id, provider, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok,
    cache_read_usd_per_mtok, context_window_tokens, max_output_tokens, price_input_token_limit, verified_source,
    verified_on, active, updated_by)
  values (p_model_id, p_provider, p_input, p_output, p_cache_write, p_cache_read, p_context_window, p_max_output,
    p_price_input_token_limit, p_verified_source, p_verified_on, coalesce(p_active, false), v_actor)
  on conflict (model_id) do update set
    provider = excluded.provider, input_usd_per_mtok = excluded.input_usd_per_mtok,
    output_usd_per_mtok = excluded.output_usd_per_mtok, cache_write_usd_per_mtok = excluded.cache_write_usd_per_mtok,
    cache_read_usd_per_mtok = excluded.cache_read_usd_per_mtok, context_window_tokens = excluded.context_window_tokens,
    max_output_tokens = excluded.max_output_tokens, price_input_token_limit = excluded.price_input_token_limit,
    verified_source = excluded.verified_source, verified_on = excluded.verified_on, active = excluded.active,
    updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Reservationer og forbrug — ingen tekst, kun tal og maskinkoder
-- ----------------------------------------------------------------------------

create table ai.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  -- Null efter sletning af brugeren: forbruget tæller fortsat med i de globale budgetter.
  user_id uuid references identity.users (id) on delete set null,
  -- Ét gateway-kald = én reservation. Et gentaget kald kan aldrig reservere to gange.
  request_id uuid not null unique,
  token_hash bytea not null,
  model_id text not null check (ai.is_code(model_id)),
  profile_id text not null check (ai.is_code(profile_id)),
  action text not null check (ai.is_code(action)),
  -- pending: åben. settled: afstemt med den faktiske usage. released: udbyderen behandlede
  -- beviseligt ikke kaldet. uncertain: udbyderen kan have behandlet kaldet (netværksfejl, timeout,
  -- 429, 5xx og 529 — B-040); tæller fuldt, indtil det er afstemt.
  status text not null default 'pending' check (status in ('pending', 'settled', 'released', 'uncertain')),
  reserved_input_tokens integer not null check (reserved_input_tokens > 0),
  reserved_output_tokens integer not null check (reserved_output_tokens > 0),
  reserved_cost_usd numeric(14, 8) not null check (reserved_cost_usd >= 0),
  -- Priserne på reservationstidspunktet. Afstemningen bruger dem, så en prisændring undervejs
  -- ikke ændrer et igangværende kald.
  input_usd_per_mtok numeric(12, 6) not null,
  output_usd_per_mtok numeric(12, 6) not null,
  cache_write_usd_per_mtok numeric(12, 6) not null,
  cache_read_usd_per_mtok numeric(12, 6) not null,
  counted_input_tokens integer check (counted_input_tokens >= 0),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cache_creation_input_tokens integer check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer check (cache_read_input_tokens >= 0),
  actual_cost_usd numeric(14, 8) check (actual_cost_usd >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  outcome_code text check (ai.is_code(outcome_code)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz,
  check ((status = 'pending') = (finished_at is null)),
  check ((status = 'settled') = (actual_cost_usd is not null))
);

comment on table ai.usage_reservations is
  'Reservationer og forbrug for ekstern AI (docs/beta.md §16.8). Ingen tekst. Skrives kun gennem ai.reserve_usage m.fl.';

create index usage_reservations_created_idx on ai.usage_reservations (created_at);
create index usage_reservations_user_created_idx on ai.usage_reservations (user_id, created_at);
create index usage_reservations_pending_idx on ai.usage_reservations (expires_at) where status = 'pending';

-- Ingen direkte adgang: kun funktionerne nedenfor skriver og læser.
alter table ai.usage_reservations enable row level security;
revoke all on ai.usage_reservations from anon, authenticated;

-- Omkostningen, en reservation tæller med i et budget: den faktiske, når den er afstemt; 0, når
-- udbyderen beviseligt ikke behandlede kaldet; ellers den fulde reserverede (åben og uncertain).
create or replace function ai.counted_cost(p_row ai.usage_reservations)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_row.status
    when 'settled' then p_row.actual_cost_usd
    when 'released' then 0::numeric
    else p_row.reserved_cost_usd
  end
$$;

create or replace function ai.usage_refuse(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ai_limit:%', p_code using errcode = 'program_limit_exceeded';
end;
$$;

-- Reserverer den maksimale omkostning for ét kald, før noget sendes. Kontrollerer i rækkefølge:
-- model og pris, outputloftet, rate limits, samtidighed og budgetter. Returnerer det effektive
-- inputloft (tokens), som adapteren håndhæver med udbyderens tokenoptælling.
create or replace function ai.reserve_usage(p_request_id uuid, p_model_id text, p_profile_id text, p_action text,
  p_max_output_tokens integer, p_cache_writes boolean)
returns table (reservation_id uuid, reservation_token text, max_input_tokens integer, max_output_tokens integer,
  reserved_cost_usd numeric, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := identity.current_user_id();
  v_limits ai.usage_limits;
  v_price ai.model_prices;
  v_input integer;
  v_input_price numeric;
  v_cost numeric;
  v_day timestamptz := pg_catalog.date_trunc('day', now(), 'UTC');
  v_month timestamptz := pg_catalog.date_trunc('month', now(), 'UTC');
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'Ingen aktiv bruger' using errcode = 'insufficient_privilege';
  end if;
  if p_request_id is null or not ai.is_code(p_model_id) or p_model_id is null or not ai.is_code(p_profile_id)
     or p_profile_id is null or not ai.is_code(p_action) or p_action is null or p_cache_writes is null then
    raise exception 'Ugyldig reservation' using errcode = 'invalid_parameter_value';
  end if;

  -- Én reservation ad gangen på tværs af alle instanser: tælling og indsættelse er atomare.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ai.usage_reservations'));

  select * into v_limits from ai.usage_limits where id;
  if not found then perform ai.usage_refuse('limits_missing'); end if;
  select * into v_price from ai.model_prices p where p.model_id = p_model_id and p.active;
  if not found then perform ai.usage_refuse('model_not_approved'); end if;

  if p_max_output_tokens is null or p_max_output_tokens < 1 or p_max_output_tokens > v_limits.max_output_tokens
     or p_max_output_tokens > v_price.max_output_tokens then
    perform ai.usage_refuse('output_budget');
  end if;
  -- Inputloftet: vores eget loft, prisens gyldighed og modellens kontekstvindue (minus output).
  v_input := least(v_limits.max_input_tokens, coalesce(v_price.price_input_token_limit, v_limits.max_input_tokens),
    v_price.context_window_tokens - p_max_output_tokens);
  if v_input < 1 then perform ai.usage_refuse('input_budget'); end if;

  if (select count(*) from ai.usage_reservations r where r.user_id = v_user and r.created_at > now() - interval '1 minute')
     >= v_limits.user_calls_per_minute then
    perform ai.usage_refuse('rate_user_minute');
  end if;
  if (select count(*) from ai.usage_reservations r where r.user_id = v_user and r.created_at >= v_day)
     >= v_limits.user_calls_per_day then
    perform ai.usage_refuse('rate_user_day');
  end if;
  if (select count(*) from ai.usage_reservations r where r.created_at > now() - interval '1 minute')
     >= v_limits.global_calls_per_minute then
    perform ai.usage_refuse('rate_global_minute');
  end if;
  if (select count(*) from ai.usage_reservations r where r.user_id = v_user and r.status = 'pending' and r.expires_at > now())
     >= v_limits.user_active_calls then
    perform ai.usage_refuse('active_user');
  end if;
  if (select count(*) from ai.usage_reservations r where r.status = 'pending' and r.expires_at > now())
     >= v_limits.global_active_calls then
    perform ai.usage_refuse('active_global');
  end if;

  -- Den maksimale omkostning. Med cache-skrivning kan hele inputtet koste skrivepris.
  v_input_price := case when p_cache_writes then greatest(v_price.input_usd_per_mtok, v_price.cache_write_usd_per_mtok)
                        else v_price.input_usd_per_mtok end;
  v_cost := (v_input::numeric * v_input_price + p_max_output_tokens::numeric * v_price.output_usd_per_mtok) / 1000000;

  if (select coalesce(sum(ai.counted_cost(r)), 0) from ai.usage_reservations r where r.user_id = v_user and r.created_at >= v_day)
     + v_cost > v_limits.user_daily_budget_usd then
    perform ai.usage_refuse('budget_user_day');
  end if;
  if (select coalesce(sum(ai.counted_cost(r)), 0) from ai.usage_reservations r where r.created_at >= v_day)
     + v_cost > v_limits.global_daily_budget_usd then
    perform ai.usage_refuse('budget_global_day');
  end if;
  if (select coalesce(sum(ai.counted_cost(r)), 0) from ai.usage_reservations r where r.created_at >= v_month)
     + v_cost > v_limits.global_monthly_budget_usd then
    perform ai.usage_refuse('budget_global_month');
  end if;

  if exists (select 1 from ai.usage_reservations r where r.request_id = p_request_id) then
    perform ai.usage_refuse('duplicate_request');
  end if;

  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_expires := now() + pg_catalog.make_interval(secs => v_limits.reservation_ttl_seconds);
  insert into ai.usage_reservations (user_id, request_id, token_hash, model_id, profile_id, action, reserved_input_tokens,
    reserved_output_tokens, reserved_cost_usd, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok,
    cache_read_usd_per_mtok, expires_at)
  values (v_user, p_request_id, pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), p_model_id, p_profile_id,
    p_action, v_input, p_max_output_tokens, v_cost, v_price.input_usd_per_mtok, v_price.output_usd_per_mtok,
    v_price.cache_write_usd_per_mtok, v_price.cache_read_usd_per_mtok, v_expires)
  returning id into v_id;

  return query select v_id, v_token, v_input, p_max_output_tokens, v_cost, v_expires;
end;
$$;

-- Den åbne reservation bag et token — kun brugerens egen, og kun med det rigtige token.
create or replace function ai.locked_reservation(p_reservation uuid, p_token text)
returns ai.usage_reservations
language plpgsql
set search_path = ''
as $$
declare
  v_row ai.usage_reservations;
begin
  select * into v_row from ai.usage_reservations r
  where r.id = p_reservation and r.user_id = identity.current_user_id()
    and r.token_hash = pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_token, ''), 'UTF8'))
  for update;
  if not found then
    raise exception 'ai_limit:reservation_unknown' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'ai_limit:reservation_closed' using errcode = 'program_limit_exceeded';
  end if;
  return v_row;
end;
$$;

-- Ét forsøg mod udbyderen. Kun under en åben, ikke udløbet reservation, og højst max_attempts
-- gange. Et retry kan derfor aldrig ske uden om reservationen.
create or replace function ai.begin_attempt(p_reservation uuid, p_token text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row ai.usage_reservations := ai.locked_reservation(p_reservation, p_token);
  v_max integer := (select l.max_attempts from ai.usage_limits l where l.id);
begin
  if v_row.expires_at <= now() then perform ai.usage_refuse('reservation_expired'); end if;
  if v_max is null or v_row.attempts >= v_max then perform ai.usage_refuse('attempts_exhausted'); end if;
  update ai.usage_reservations set attempts = attempts + 1 where id = v_row.id;
  return v_row.attempts + 1;
end;
$$;

-- Afstemmer med den faktiske usage fra udbyderen. Tallene skal ligge inden for reservationen
-- (+10 % på inputtet for forskellen mellem tokenoptælling og faktisk usage); ellers afvises de,
-- og reservationen tæller fortsat fuldt med.
create or replace function ai.settle_usage(p_reservation uuid, p_token text, p_counted_input_tokens integer,
  p_input_tokens integer, p_output_tokens integer, p_cache_creation_input_tokens integer, p_cache_read_input_tokens integer,
  p_outcome_code text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row ai.usage_reservations := ai.locked_reservation(p_reservation, p_token);
  v_cost numeric;
begin
  if p_input_tokens is null or p_output_tokens is null or p_cache_creation_input_tokens is null
     or p_cache_read_input_tokens is null or p_input_tokens < 0 or p_output_tokens < 0
     or p_cache_creation_input_tokens < 0 or p_cache_read_input_tokens < 0
     or (p_counted_input_tokens is not null and p_counted_input_tokens < 0) or not ai.is_code(p_outcome_code) then
    raise exception 'Ugyldig usage' using errcode = 'invalid_parameter_value';
  end if;
  if p_output_tokens > v_row.reserved_output_tokens
     or p_input_tokens::bigint + p_cache_creation_input_tokens + p_cache_read_input_tokens > ceil(v_row.reserved_input_tokens * 1.1) then
    perform ai.usage_refuse('usage_out_of_bounds');
  end if;
  v_cost := (p_input_tokens::numeric * v_row.input_usd_per_mtok
    + p_cache_creation_input_tokens::numeric * v_row.cache_write_usd_per_mtok
    + p_cache_read_input_tokens::numeric * v_row.cache_read_usd_per_mtok
    + p_output_tokens::numeric * v_row.output_usd_per_mtok) / 1000000;
  update ai.usage_reservations set status = 'settled', counted_input_tokens = p_counted_input_tokens,
    input_tokens = p_input_tokens, output_tokens = p_output_tokens, cache_creation_input_tokens = p_cache_creation_input_tokens,
    cache_read_input_tokens = p_cache_read_input_tokens, actual_cost_usd = v_cost, outcome_code = p_outcome_code,
    finished_at = now()
  where id = v_row.id;
  return v_cost;
end;
$$;

-- Frigiver en reservation, når udbyderen BEVISELIGT ikke behandlede kaldet (et HTTP-fejlsvar,
-- en afvisning før afsendelse eller et inputloft overskredet ved tokenoptællingen).
create or replace function ai.release_usage(p_reservation uuid, p_token text, p_counted_input_tokens integer, p_outcome_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row ai.usage_reservations := ai.locked_reservation(p_reservation, p_token);
begin
  if not ai.is_code(p_outcome_code) or p_outcome_code is null or (p_counted_input_tokens is not null and p_counted_input_tokens < 0) then
    raise exception 'Ugyldig afslutning' using errcode = 'invalid_parameter_value';
  end if;
  update ai.usage_reservations set status = 'released', counted_input_tokens = p_counted_input_tokens,
    outcome_code = p_outcome_code, finished_at = now()
  where id = v_row.id;
end;
$$;

-- Udbyderen KAN have behandlet kaldet (netværksfejl, timeout, ukendt svar): reservationen tæller
-- fortsat med sin fulde reserverede omkostning og frigives aldrig.
create or replace function ai.mark_usage_uncertain(p_reservation uuid, p_token text, p_counted_input_tokens integer, p_outcome_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row ai.usage_reservations := ai.locked_reservation(p_reservation, p_token);
begin
  if not ai.is_code(p_outcome_code) or p_outcome_code is null or (p_counted_input_tokens is not null and p_counted_input_tokens < 0) then
    raise exception 'Ugyldig afslutning' using errcode = 'invalid_parameter_value';
  end if;
  update ai.usage_reservations set status = 'uncertain', counted_input_tokens = p_counted_input_tokens,
    outcome_code = p_outcome_code, finished_at = now()
  where id = v_row.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Rettigheder
-- ----------------------------------------------------------------------------

revoke all on function ai.audit_usage_config_change(), ai.counted_cost(ai.usage_reservations), ai.usage_refuse(text),
  ai.locked_reservation(uuid, text) from public, anon, authenticated, service_role;
revoke all on function ai.set_usage_limits(jsonb),
  ai.set_model_price(text, text, numeric, numeric, numeric, numeric, integer, integer, integer, text, date, boolean),
  ai.reserve_usage(uuid, text, text, text, integer, boolean), ai.begin_attempt(uuid, text),
  ai.settle_usage(uuid, text, integer, integer, integer, integer, integer, text),
  ai.release_usage(uuid, text, integer, text), ai.mark_usage_uncertain(uuid, text, integer, text)
  from public, anon, service_role;
grant execute on function ai.set_usage_limits(jsonb),
  ai.set_model_price(text, text, numeric, numeric, numeric, numeric, integer, integer, integer, text, date, boolean),
  ai.reserve_usage(uuid, text, text, text, integer, boolean), ai.begin_attempt(uuid, text),
  ai.settle_usage(uuid, text, integer, integer, integer, integer, integer, text),
  ai.release_usage(uuid, text, integer, text), ai.mark_usage_uncertain(uuid, text, integer, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- Retention (docs/beta.md §16.11): rækkerne har ingen tekst. Der slettes intet automatisk;
-- en periode er ikke juridisk godkendt [AFKLARES]. Sletning af en bruger sætter user_id til null,
-- så forbruget fortsat tæller i de globale budgetter.
--
-- Tilbagerulning (manuelt): drop funktionerne og de tre tabeller. Forbruget er historik og bør
-- eksporteres først.
-- ----------------------------------------------------------------------------
