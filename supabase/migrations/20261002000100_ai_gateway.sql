-- ============================================================================
-- Fase 8 — AI Gateway: matrice, opdelt log og gating-tilstand
--
-- Specifikation: docs/08-ai-gateway.md §5 (matricen, B-017), §9.2 (gating-tilstand, B-013),
-- §11 (log: indhold og metadata adskilt, B-014).
--
-- Principper:
--   * Matricen er fail-closed: en manglende række betyder "deny". audit_access er altid deny.
--     Hver ændring auditeres (hvem, hvad, hvornår) af en trigger — uanset hvem der ændrer.
--   * Loggen er delt i metadata (ingen fritekst) og indhold (behandles som kundedata).
--     Indhold: kun brugeren selv, eller kundecasens adgangsregler for et sagsbundet kald.
--     Administratorers læsning af metadata og videnshuller sker kun gennem to funktioner,
--     der er slået fra i fase 8 og auditerer hver læsning.
--   * Gating-tabellerne er et BEVIDST MINIMUM: kun det, gatingen skal læse. Senere faser
--     udvider dem (kolonner, relationer) — de bygger dem ikke om.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Permission til kvalitetsarbejde (B-014, docs/03 §17 pkt. 6). Giver ingen adgang, før
-- administratorlæsning er slået til i ai.settings.
-- ----------------------------------------------------------------------------

insert into identity.permissions (key, description, allowed_scopes) values
  ('ai.quality.read', 'Læse metadata og videnshuller fra AI-loggen til kvalitetsarbejde (kun når det er slået til)', array['all']);

insert into identity.role_permissions (role_id, permission_id, scope)
select r.id, p.id, 'all'
from identity.roles r, identity.permissions p
where r.key = 'administrator' and p.key = 'ai.quality.read';

-- ----------------------------------------------------------------------------
-- Gating-tilstand: assessment (B-013) — bevidst minimum
-- ----------------------------------------------------------------------------

create schema if not exists assessment;
revoke all on schema assessment from public;
grant usage on schema assessment to authenticated, service_role;

create table assessment.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.users (id) on delete cascade,
  -- active: i gang. submitted: afleveret. expired: tidsgrænsen er udløbet.
  status text not null default 'active' check (status in ('active', 'submitted', 'expired')),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  ended_at timestamptz,
  check ((status = 'active') = (ended_at is null)),
  check (ends_at is null or ends_at > started_at)
);

comment on table assessment.assessment_attempts is
  'Bevidst minimum (fase 8, B-013): kun det, AI-gating skal læse. Udvides af Assessment-fasen.';

create unique index assessment_attempts_one_active_idx on assessment.assessment_attempts (user_id) where status = 'active';

alter table assessment.assessment_attempts enable row level security;
revoke all on assessment.assessment_attempts from anon, authenticated;
grant select on assessment.assessment_attempts to authenticated;
create policy assessment_attempts_own on assessment.assessment_attempts
  for select to authenticated using (user_id = identity.current_user_id());

-- Start et forsøg for den aktuelle bruger. Et forsøg med udløbet tidsgrænse markeres først.
create or replace function assessment.start_attempt(p_ends_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := identity.current_user_id();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Ingen aktiv bruger' using errcode = 'insufficient_privilege';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'Tidsgrænsen skal ligge i fremtiden.' using errcode = 'check_violation';
  end if;
  update assessment.assessment_attempts set status = 'expired', ended_at = ends_at
  where user_id = v_user and status = 'active' and ends_at is not null and ends_at <= now();
  if exists (select 1 from assessment.assessment_attempts where user_id = v_user and status = 'active') then
    raise exception 'Der er allerede et aktivt forsøg.' using errcode = 'check_violation';
  end if;
  insert into assessment.assessment_attempts (user_id, ends_at) values (v_user, p_ends_at) returning id into v_id;
  return v_id;
end;
$$;

-- Aflever brugerens eget aktive forsøg. Et forsøg kan ikke "afbrydes" — kun afleveres eller udløbe.
create or replace function assessment.submit_attempt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update assessment.assessment_attempts set status = 'submitted', ended_at = now()
  where id = p_id and user_id = identity.current_user_id() and status = 'active'
    and (ends_at is null or ends_at > now());
  if not found then
    raise exception 'Forsøget findes ikke.' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Gating-tilstand: practice (B-013) — bevidst minimum
-- ----------------------------------------------------------------------------

create schema if not exists practice;
revoke all on schema practice from public;
grant usage on schema practice to authenticated, service_role;

create table practice.roleplay_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((status = 'active') = (ended_at is null))
);

comment on table practice.roleplay_sessions is
  'Bevidst minimum (fase 8, B-013): kun det, AI-gating skal læse. Udvides af Practice-fasen.';

create unique index roleplay_sessions_one_active_idx on practice.roleplay_sessions (user_id) where status = 'active';

alter table practice.roleplay_sessions enable row level security;
revoke all on practice.roleplay_sessions from anon, authenticated;
grant select on practice.roleplay_sessions to authenticated;
create policy roleplay_sessions_own on practice.roleplay_sessions
  for select to authenticated using (user_id = identity.current_user_id());

create or replace function practice.start_roleplay()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := identity.current_user_id();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Ingen aktiv bruger' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from practice.roleplay_sessions where user_id = v_user and status = 'active') then
    raise exception 'Der er allerede et aktivt rollespil.' using errcode = 'check_violation';
  end if;
  insert into practice.roleplay_sessions (user_id) values (v_user) returning id into v_id;
  return v_id;
end;
$$;

create or replace function practice.end_roleplay(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update practice.roleplay_sessions set status = 'ended', ended_at = now()
  where id = p_id and user_id = identity.current_user_id() and status = 'active';
  if not found then
    raise exception 'Rollespillet findes ikke.' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function assessment.start_attempt(timestamptz), assessment.submit_attempt(uuid),
  practice.start_roleplay(), practice.end_roleplay(uuid) from public, anon;
grant execute on function assessment.start_attempt(timestamptz), assessment.submit_attempt(uuid),
  practice.start_roleplay(), practice.end_roleplay(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- ai
-- ----------------------------------------------------------------------------

create schema if not exists ai;
revoke all on schema ai from public;
grant usage on schema ai to authenticated, service_role;

-- Gatingtilstanden for den aktuelle bruger (docs/08 §9.2). Kun egne rækker (RLS).
create or replace function ai.my_gating_state()
returns table (assessment_active boolean, roleplay_session_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    exists (
      select 1 from assessment.assessment_attempts a
      where a.user_id = identity.current_user_id() and a.status = 'active'
        and (a.ends_at is null or a.ends_at > now())
    ),
    (select r.id from practice.roleplay_sessions r
     where r.user_id = identity.current_user_id() and r.status = 'active' limit 1)
$$;

revoke all on function ai.my_gating_state() from public, anon;
grant execute on function ai.my_gating_state() to authenticated;

-- Fælles audit for politikændringer: hvem (actor_id), hvad (før og efter), hvornår (occurred_at).
-- En trigger, så ingen ændring — heller ikke via migration eller service-role — undgår auditten.
create or replace function ai.audit_policy_change()
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
    case when tg_table_name = 'data_category_policy' then (v_row ->> 'model_id') || ':' || (v_row ->> 'category') else 'settings' end,
    jsonb_build_object(
      'before', case when tg_op = 'INSERT' then null else to_jsonb(old) - 'updated_by' - 'updated_at' end,
      'after', case when tg_op = 'DELETE' then null else to_jsonb(new) - 'updated_by' - 'updated_at' end
    )
  );
  return null;
end;
$$;

-- Indstillinger (én række). Administratorers læsning af metadata er slået fra i fase 8 (B-014).
create table ai.settings (
  id boolean primary key default true check (id),
  admin_metadata_read_enabled boolean not null default false,
  updated_by uuid references identity.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger settings_audit after insert or update or delete on ai.settings
  for each row execute function ai.audit_policy_change();

insert into ai.settings (id) values (true);

alter table ai.settings enable row level security;
revoke all on ai.settings from anon, authenticated;

create or replace function ai.set_admin_metadata_read(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not identity.has_permission('system.settings.manage') then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  update ai.settings set admin_metadata_read_enabled = p_enabled, updated_by = identity.current_user_id(), updated_at = now()
  where id;
end;
$$;

-- Datakategori-matricen (docs/08 §5.2, B-017). Fail-closed: mangler en række, gælder deny.
create table ai.data_category_policy (
  model_id text not null check (model_id ~ '^[a-z0-9_.:@-]{1,100}$'),
  category text not null check (category in ('knowledge', 'user_question', 'learning', 'training_fictional', 'customer_identifiable', 'audit_access')),
  rule text not null check (rule in ('allow', 'allow_redacted', 'deny')),
  updated_by uuid references identity.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (model_id, category),
  -- Audit- og adgangsdata sendes aldrig til en model.
  constraint audit_access_always_denied check (category <> 'audit_access' or rule = 'deny')
);

create trigger data_category_policy_audit after insert or update or delete on ai.data_category_policy
  for each row execute function ai.audit_policy_change();

alter table ai.data_category_policy enable row level security;
revoke all on ai.data_category_policy from anon, authenticated;
grant select on ai.data_category_policy to authenticated;
-- Politikken er ikke hemmelig: gatewayen læser den som den aktuelle bruger.
create policy data_category_policy_read on ai.data_category_policy for select to authenticated using (true);

create or replace function ai.set_data_category_rule(p_model_id text, p_category text, p_rule text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not identity.has_permission('system.settings.manage') then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  insert into ai.data_category_policy (model_id, category, rule, updated_by)
  values (p_model_id, p_category, p_rule, identity.current_user_id())
  on conflict (model_id, category) do update
    set rule = excluded.rule, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- Startværdier for stub-modellen (docs/08 §5.2). Kundedata er deny som standard.
insert into ai.data_category_policy (model_id, category, rule) values
  ('stub', 'knowledge', 'allow'),
  ('stub', 'user_question', 'allow_redacted'),
  ('stub', 'learning', 'allow'),
  ('stub', 'training_fictional', 'allow'),
  ('stub', 'customer_identifiable', 'deny'),
  ('stub', 'audit_access', 'deny');

revoke all on function ai.set_admin_metadata_read(boolean), ai.set_data_category_rule(text, text, text) from public, anon;
grant execute on function ai.set_admin_metadata_read(boolean), ai.set_data_category_rule(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Loggen (docs/08 §11, B-014)
-- ----------------------------------------------------------------------------

-- Korte maskinkoder — aldrig fritekst.
create or replace function ai.is_code(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null or p_value ~ '^[a-z0-9_.:-]{1,64}$'
$$;

-- METADATA: én række pr. kald, også afviste. Ingen fritekst.
create table ai.gateway_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.users (id) on delete cascade,
  profile_id text not null check (ai.is_code(profile_id)),
  profile_version text not null check (ai.is_code(profile_version)),
  action text not null check (ai.is_code(action)),
  model_id text check (ai.is_code(model_id)),
  model_version text check (ai.is_code(model_version)),
  model_grade text check (model_grade in ('development', 'production')),
  evidence_grade text check (evidence_grade in ('development', 'production')),
  answer_grade text check (answer_grade in ('development', 'production')),
  outcome text not null check (outcome in ('answer', 'insufficient', 'locked', 'denied', 'blocked_policy', 'unverifiable', 'invalid_request', 'unavailable')),
  reason_code text check (ai.is_code(reason_code)),
  case_id uuid references advise.customer_cases (id) on delete set null,
  case_bound boolean not null default false,
  insufficient boolean generated always as (outcome = 'insufficient') stored,
  timings jsonb not null default '{}'::jsonb check (jsonb_typeof(timings) = 'object'),
  redactions jsonb not null default '{}'::jsonb check (jsonb_typeof(redactions) = 'object'),
  removed_fields integer not null default 0 check (removed_fields >= 0),
  error_code text check (ai.is_code(error_code)),
  created_at timestamptz not null default now(),
  check (case_id is null or case_bound)
);

create index gateway_calls_user_idx on ai.gateway_calls (user_id, created_at desc);
create index gateway_calls_created_idx on ai.gateway_calls (created_at desc);

-- METADATA: hvilke kilder der blev hentet, sendt og citeret.
create table ai.gateway_call_sources (
  call_id uuid not null references ai.gateway_calls (id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  evidence_id text not null check (ai.is_code(evidence_id)),
  chunk_id uuid not null,
  document_version_id uuid not null,
  score double precision,
  sent boolean not null,
  cited boolean not null,
  primary key (call_id, ordinal)
);

-- INDHOLD: det, der blev sendt (redigeret), og modellens rå svar. Behandles som kundedata.
-- Et sagsbundet kald følger sagen og slettes med den.
create table ai.gateway_payloads (
  call_id uuid primary key references ai.gateway_calls (id) on delete cascade,
  user_id uuid not null references identity.users (id) on delete cascade,
  case_id uuid references advise.customer_cases (id) on delete cascade,
  sent jsonb not null,
  returned jsonb,
  created_at timestamptz not null default now()
);

-- VIDENSHULLER: den redigerede spørgsmålstekst — aldrig fra en kundecase.
create table ai.knowledge_gaps (
  call_id uuid primary key references ai.gateway_calls (id) on delete cascade,
  user_id uuid not null references identity.users (id) on delete cascade,
  question text check (question is null or char_length(question) <= 2000),
  case_bound boolean not null,
  created_at timestamptz not null default now(),
  constraint case_bound_gap_has_no_text check (not case_bound or question is null)
);

-- Append-only: rækkerne kan ikke rettes. Sletning sker kun ved retention og med sagen.
create or replace function ai.prevent_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AI-loggen kan ikke rettes' using errcode = 'insufficient_privilege';
end;
$$;

-- Undtagelse: når en kundecase slettes, nulstiller fremmednøglen case_id. Metadata bevares
-- (case_bound forbliver sand); intet andet felt må ændres. (Den genererede kolonne
-- insufficient er endnu ikke beregnet i en BEFORE-trigger og sammenlignes derfor ikke.)
create or replace function ai.prevent_call_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.case_id is not null and new.case_id is null and (to_jsonb(new) - 'case_id' - 'insufficient') = (to_jsonb(old) - 'case_id' - 'insufficient') then
    return new;
  end if;
  raise exception 'AI-loggen kan ikke rettes' using errcode = 'insufficient_privilege';
end;
$$;

create trigger gateway_calls_no_update before update on ai.gateway_calls for each row execute function ai.prevent_call_update();
create trigger gateway_call_sources_no_update before update on ai.gateway_call_sources for each row execute function ai.prevent_update();
create trigger gateway_payloads_no_update before update on ai.gateway_payloads for each row execute function ai.prevent_update();
create trigger knowledge_gaps_no_update before update on ai.knowledge_gaps for each row execute function ai.prevent_update();

alter table ai.gateway_calls enable row level security;
alter table ai.gateway_call_sources enable row level security;
alter table ai.gateway_payloads enable row level security;
alter table ai.knowledge_gaps enable row level security;
revoke all on ai.gateway_calls, ai.gateway_call_sources, ai.gateway_payloads, ai.knowledge_gaps from anon, authenticated;
grant select on ai.gateway_calls, ai.gateway_call_sources, ai.gateway_payloads, ai.knowledge_gaps to authenticated;

-- Metadata: kun brugeren selv. Administratorer læser kun gennem ai.admin_call_metadata.
create policy gateway_calls_own on ai.gateway_calls
  for select to authenticated using (user_id = identity.current_user_id());
create policy gateway_call_sources_own on ai.gateway_call_sources
  for select to authenticated using (exists (select 1 from ai.gateway_calls c where c.id = call_id and c.user_id = identity.current_user_id()));
create policy knowledge_gaps_own on ai.knowledge_gaps
  for select to authenticated using (user_id = identity.current_user_id());

-- Indhold: kun brugeren selv — eller, for et sagsbundet kald, sagens deltagere (kundecasens regler).
create policy gateway_payloads_read on ai.gateway_payloads
  for select to authenticated using (
    case
      when case_id is null then user_id = identity.current_user_id()
      else identity.has_permission('advise.case.read') and advise.is_case_participant(case_id)
    end
  );

-- Den eneste vej ind i loggen. Skriver kun for den aktuelle bruger.
create or replace function ai.record_call(p_call jsonb, p_sources jsonb, p_payload jsonb, p_gap_question text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := identity.current_user_id();
  v_case uuid := nullif(p_call ->> 'case_id', '')::uuid;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Ingen aktiv bruger' using errcode = 'insufficient_privilege';
  end if;
  if v_case is not null and not (identity.has_permission('advise.case.read') and advise.is_case_participant(v_case)) then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;

  insert into ai.gateway_calls (user_id, profile_id, profile_version, action, model_id, model_version, model_grade,
    evidence_grade, answer_grade, outcome, reason_code, case_id, case_bound, timings, redactions, removed_fields, error_code)
  values (
    v_user, p_call ->> 'profile_id', p_call ->> 'profile_version', p_call ->> 'action', p_call ->> 'model_id',
    p_call ->> 'model_version', p_call ->> 'model_grade', p_call ->> 'evidence_grade', p_call ->> 'answer_grade',
    p_call ->> 'outcome', p_call ->> 'reason_code', v_case, v_case is not null,
    coalesce(p_call -> 'timings', '{}'::jsonb), coalesce(p_call -> 'redactions', '{}'::jsonb),
    coalesce((p_call ->> 'removed_fields')::integer, 0), p_call ->> 'error_code'
  )
  returning id into v_id;

  insert into ai.gateway_call_sources (call_id, ordinal, evidence_id, chunk_id, document_version_id, score, sent, cited)
  select v_id, (s.ordinality - 1)::integer, s.value ->> 'evidence_id', (s.value ->> 'chunk_id')::uuid,
         (s.value ->> 'document_version_id')::uuid, (s.value ->> 'score')::double precision,
         coalesce((s.value ->> 'sent')::boolean, false), coalesce((s.value ->> 'cited')::boolean, false)
  from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) with ordinality as s(value, ordinality);

  if p_payload is not null then
    insert into ai.gateway_payloads (call_id, user_id, case_id, sent, returned)
    values (v_id, v_user, v_case, p_payload -> 'sent', p_payload -> 'returned');
  end if;

  if p_call ->> 'outcome' = 'insufficient' then
    insert into ai.knowledge_gaps (call_id, user_id, question, case_bound)
    values (v_id, v_user, case when v_case is null then left(p_gap_question, 2000) end, v_case is not null);
  end if;

  return v_id;
end;
$$;

revoke all on function ai.record_call(jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function ai.record_call(jsonb, jsonb, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Administratorers læsning (B-014) — slået fra i fase 8. Hver læsning auditeres.
-- Returnerer hverken bruger-id eller sags-id: kvalitetsarbejde skal ikke vide, hvem der spurgte.
-- ----------------------------------------------------------------------------

create or replace function ai.assert_admin_read()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select admin_metadata_read_enabled from ai.settings where id), false) then
    raise exception 'Administratorers læsning af AI-loggen er slået fra.' using errcode = 'insufficient_privilege';
  end if;
  if not identity.has_permission('ai.quality.read', 'all') then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function ai.admin_call_metadata(p_since timestamptz default now() - interval '30 days', p_limit integer default 200)
returns table (
  call_id uuid, created_at timestamptz, profile_id text, profile_version text, action text, model_id text,
  model_grade text, evidence_grade text, answer_grade text, outcome text, reason_code text, case_bound boolean,
  insufficient boolean, timings jsonb, error_code text, sources jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  perform ai.assert_admin_read();
  return query
    select c.id, c.created_at, c.profile_id, c.profile_version, c.action, c.model_id, c.model_grade, c.evidence_grade,
           c.answer_grade, c.outcome, c.reason_code, c.case_bound, c.insufficient, c.timings, c.error_code,
           coalesce((select jsonb_agg(jsonb_build_object('evidence_id', s.evidence_id, 'chunk_id', s.chunk_id,
                       'document_version_id', s.document_version_id, 'score', s.score, 'sent', s.sent, 'cited', s.cited)
                     order by s.ordinal)
                     from ai.gateway_call_sources s where s.call_id = c.id), '[]'::jsonb)
    from ai.gateway_calls c
    where c.created_at >= p_since
    order by c.created_at desc
    limit least(greatest(p_limit, 1), 1000);
  get diagnostics v_rows = row_count;
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, details)
  values (identity.current_user_id(), 'ai.metadata.read', 'ai', 'gateway_calls',
          jsonb_build_object('since', p_since, 'limit', p_limit, 'rows', v_rows));
end;
$$;

create or replace function ai.admin_knowledge_gaps(p_since timestamptz default now() - interval '30 days', p_limit integer default 200)
returns table (call_id uuid, created_at timestamptz, profile_id text, question text, case_bound boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  perform ai.assert_admin_read();
  return query
    select g.call_id, g.created_at, c.profile_id, g.question, g.case_bound
    from ai.knowledge_gaps g
    join ai.gateway_calls c on c.id = g.call_id
    where g.created_at >= p_since
    order by g.created_at desc
    limit least(greatest(p_limit, 1), 1000);
  get diagnostics v_rows = row_count;
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, details)
  values (identity.current_user_id(), 'ai.knowledge_gaps.read', 'ai', 'knowledge_gaps',
          jsonb_build_object('since', p_since, 'limit', p_limit, 'rows', v_rows));
end;
$$;

revoke all on function ai.assert_admin_read(), ai.admin_call_metadata(timestamptz, integer),
  ai.admin_knowledge_gaps(timestamptz, integer) from public, anon;
grant execute on function ai.admin_call_metadata(timestamptz, integer), ai.admin_knowledge_gaps(timestamptz, integer) to authenticated;
