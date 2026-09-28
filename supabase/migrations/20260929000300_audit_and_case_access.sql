-- ============================================================================
-- Fase 6 — Audit (append-only) og adgangsfundamentet for kundecases
--
-- audit:  docs/03 §4 og §11 — "skrives til, aldrig rettes i". Registrerer handlinger,
--         ikke indhold.
-- advise: KUN adgangsfundamentet (sag, ejer, deltagere) fra docs/03 §10 "Kundecases".
--         Sagens indhold (virksomhedsprofil, analyser, AI-forslag osv.) bygges i en senere fase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- audit
-- ----------------------------------------------------------------------------

create schema if not exists audit;
revoke all on schema audit from public;
grant usage on schema audit to service_role;

create table audit.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- Ingen fremmednøgle: sporet skal bestå, også når en bruger slettes eller anonymiseres.
  actor_id uuid,
  action text not null,
  entity_schema text not null,
  entity_table text not null,
  entity_id text,
  subject_user_id uuid,
  details jsonb not null default '{}'::jsonb
);

create index audit_log_occurred_at_idx on audit.audit_log (occurred_at desc);
create index audit_log_subject_user_id_idx on audit.audit_log (subject_user_id);

comment on table audit.audit_log is
  'Append-only. Registrerer administrative ændringer og adgangshændelser — ikke indhold.';

-- Append-only håndhæves i databasen, også for tabellens ejer.
create or replace function audit.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit.audit_log er append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update
  before update or delete on audit.audit_log
  for each row execute function audit.prevent_mutation();

create trigger audit_log_no_truncate
  before truncate on audit.audit_log
  for each statement execute function audit.prevent_mutation();

alter table audit.audit_log enable row level security;
-- Ingen policies: hverken anon eller authenticated kan læse eller skrive direkte.
-- Indsættelse sker kun gennem SECURITY DEFINER-funktionerne nedenfor. Hvem der må læse
-- audit-loggen via API'et, er ikke fastlagt (se docs/06 §12).
revoke all on audit.audit_log from anon, authenticated;
grant select, insert on audit.audit_log to service_role;

-- Generisk trigger til administrative ændringer i identity og deling af sager.
create or replace function audit.record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, subject_user_id, details)
  values (
    identity.current_user_id(),
    lower(tg_op),
    tg_table_schema,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'team_id', v_row ->> 'case_id'),
    nullif(v_row ->> 'user_id', '')::uuid,
    -- Kun nøgler og strukturfelter — aldrig fritekst-indhold.
    v_row - 'display_name' - 'job_title' - 'company_name'
  );
  return null;
end;
$$;

create trigger audit_users after insert or update or delete on identity.users
  for each row execute function audit.record_change();
create trigger audit_user_roles after insert or delete on identity.user_roles
  for each row execute function audit.record_change();
create trigger audit_teams after insert or update or delete on identity.teams
  for each row execute function audit.record_change();
create trigger audit_team_memberships after insert or delete on identity.team_memberships
  for each row execute function audit.record_change();
create trigger audit_leader_scopes after insert or update or delete on identity.leader_scopes
  for each row execute function audit.record_change();

-- Lederens indsigt på individniveau logges som adgangshændelse (docs/03 §10).
-- Registreres kun, hvis lederen faktisk har adgang — ellers afvises kaldet.
create or replace function identity.log_individual_access(p_subject_id uuid, p_permission text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_permission not in ('learning.progress.read', 'assessment.result.read') then
    raise exception 'Ukendt kategori for individadgang' using errcode = 'invalid_parameter_value';
  end if;
  if not identity.can_access_user_data(p_permission, p_subject_id) then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, subject_user_id, details)
  values (identity.current_user_id(), 'view_individual', 'identity', 'users', p_subject_id::text, p_subject_id,
          jsonb_build_object('permission', p_permission));
end;
$$;

revoke all on function identity.log_individual_access(uuid, text) from public, anon;
grant execute on function identity.log_individual_access(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advise — adgang pr. sag (docs/03 §10 og beslutning B-001)
-- ----------------------------------------------------------------------------

create schema if not exists advise;
revoke all on schema advise from public;
grant usage on schema advise to authenticated, service_role;

create table advise.customer_cases (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'awaiting_customer', 'closed')),
  -- Én primær ejer. Overdragelse er et eget flow (senere fase); ejeren ændres ikke ved update.
  owner_id uuid not null references identity.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_cases_owner_id_idx on advise.customer_cases (owner_id);

create trigger customer_cases_touch_updated_at
  before update on advise.customer_cases
  for each row execute function identity.touch_updated_at();

-- Adgangstyper. 'reviewer' er reserveret til four-eyes (docs/03 §10) og bruges ikke endnu.
create table advise.case_participants (
  case_id uuid not null references advise.customer_cases (id) on delete cascade,
  user_id uuid not null references identity.users (id) on delete cascade,
  access_type text not null check (access_type in ('owner', 'editor', 'viewer', 'reviewer')),
  granted_by uuid references identity.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (case_id, user_id)
);

create index case_participants_user_id_idx on advise.case_participants (user_id);
create unique index case_participants_one_owner_idx
  on advise.case_participants (case_id) where access_type = 'owner';

-- Er den aktuelle bruger deltager i sagen (evt. med en af de angivne adgangstyper)?
create or replace function advise.is_case_participant(p_case_id uuid, p_access_types text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from advise.case_participants cp
    where cp.case_id = p_case_id
      and cp.user_id = identity.current_user_id()
      and (p_access_types is null or cp.access_type = any (p_access_types))
  )
$$;

-- Ejeren bliver automatisk deltager med adgangstypen 'owner'.
create or replace function advise.add_owner_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into advise.case_participants (case_id, user_id, access_type, granted_by)
  values (new.id, new.owner_id, 'owner', new.owner_id);
  return new;
end;
$$;

create trigger customer_cases_add_owner
  after insert on advise.customer_cases
  for each row execute function advise.add_owner_participant();

-- Ejerskab ændres ikke ved almindelig redigering.
create or replace function advise.prevent_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Ejerskab overdrages gennem overdragelsesflowet, ikke ved redigering'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger customer_cases_prevent_owner_change
  before update on advise.customer_cases
  for each row execute function advise.prevent_owner_change();

alter table advise.customer_cases enable row level security;
alter table advise.case_participants enable row level security;

-- Læse: kun deltagere (ejer og tildelte). Ingen rolle — heller ikke leder eller
-- administrator — giver adgang til andres sager.
create policy customer_cases_select on advise.customer_cases
  for select to authenticated
  using (
    identity.has_permission('advise.case.read', 'own')
    and (owner_id = identity.current_user_id() or advise.is_case_participant(id))
  );

create policy customer_cases_insert on advise.customer_cases
  for insert to authenticated
  with check (
    identity.has_permission('advise.case.write', 'own')
    and owner_id = identity.current_user_id()
  );

create policy customer_cases_update on advise.customer_cases
  for update to authenticated
  using (
    identity.has_permission('advise.case.write', 'own')
    and advise.is_case_participant(id, array['owner', 'editor'])
  )
  with check (
    identity.has_permission('advise.case.write', 'own')
    and advise.is_case_participant(id, array['owner', 'editor'])
  );

create policy case_participants_select on advise.case_participants
  for select to authenticated
  using (
    identity.has_permission('advise.case.read', 'own')
    and advise.is_case_participant(case_id)
  );

-- Deling: kun sagens ejer, og ejerrollen kan ikke tildeles ved deling.
create policy case_participants_insert on advise.case_participants
  for insert to authenticated
  with check (
    identity.has_permission('advise.case.write', 'own')
    and advise.is_case_participant(case_id, array['owner'])
    and access_type in ('editor', 'viewer')
  );

create policy case_participants_delete on advise.case_participants
  for delete to authenticated
  using (
    identity.has_permission('advise.case.write', 'own')
    and advise.is_case_participant(case_id, array['owner'])
    and access_type <> 'owner'
  );

revoke all on all tables in schema advise from anon, authenticated;
grant select, insert on advise.customer_cases to authenticated;
grant update (company_name, status) on advise.customer_cases to authenticated;
grant select, insert, delete on advise.case_participants to authenticated;
revoke all on all functions in schema advise from public, anon;
grant execute on function advise.is_case_participant(uuid, text[]) to authenticated;
grant all on all tables in schema advise to service_role;

create trigger audit_case_participants after insert or delete on advise.case_participants
  for each row execute function audit.record_change();

-- Deltagere i en sag med navn. Kun for sagens egne deltagere; afslører ikke andre
-- oplysninger om brugerne end navn og adgangstype.
create or replace function advise.case_participant_list(p_case_id uuid)
returns table (user_id uuid, display_name text, access_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.user_id, u.display_name, cp.access_type
  from advise.case_participants cp
  join identity.users u on u.id = cp.user_id
  where cp.case_id = p_case_id
    and identity.has_permission('advise.case.read', 'own')
    and advise.is_case_participant(p_case_id)
  order by case cp.access_type when 'owner' then 0 else 1 end, u.display_name
$$;

revoke all on function advise.case_participant_list(uuid) from public, anon;
grant execute on function advise.case_participant_list(uuid) to authenticated;
