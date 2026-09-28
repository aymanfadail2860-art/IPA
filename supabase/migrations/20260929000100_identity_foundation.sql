-- ============================================================================
-- Fase 6 — Identity, roller, permissions, teams og scopes
--
-- Bygger på docs/03-technical-architecture.md §4 (domæneskemaer), §10 (roller og
-- permissions med scope) og §11 (datasikkerhed). Se docs/06-identity-database-access-control.md.
--
-- Principper:
--   * Rolle ≠ permission. Roller er navngivne samlinger af permissions med scope.
--   * Adgang afgøres af permission + scope — aldrig af rollenavn.
--   * Lederens teamadgang kommer kun fra eksplicitte leader_scopes, aldrig fra jobtitel.
--   * Al autorisation håndhæves i databasen (RLS) og server-side — ikke i frontend.
-- ============================================================================

create schema if not exists identity;

revoke all on schema identity from public;
grant usage on schema identity to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Fælles hjælpere
-- ----------------------------------------------------------------------------

create or replace function identity.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- users — platformens brugere. Knyttet 1:1 til Supabase Auth via auth_id.
-- Adskilt fra auth.users, så en bruger kan anonymiseres uden at audit-sporet brydes.
-- ----------------------------------------------------------------------------

create table identity.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 200),
  job_title text check (job_title is null or char_length(job_title) <= 200),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_touch_updated_at
  before update on identity.users
  for each row execute function identity.touch_updated_at();

comment on table identity.users is
  'Platformens brugere. auth_id kobler til Supabase Auth. Email ejes af auth.users og kopieres ikke.';

-- ----------------------------------------------------------------------------
-- roles, permissions, role_permissions — kataloget
-- ----------------------------------------------------------------------------

create table identity.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z_]*$'),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger roles_touch_updated_at
  before update on identity.roles
  for each row execute function identity.touch_updated_at();

create table identity.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  description text not null,
  -- De scopes, permissionen giver mening med (docs/03 §10: own, team, all).
  allowed_scopes text[] not null check (
    cardinality(allowed_scopes) > 0 and allowed_scopes <@ array['own', 'team', 'all']::text[]
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger permissions_touch_updated_at
  before update on identity.permissions
  for each row execute function identity.touch_updated_at();

create table identity.role_permissions (
  role_id uuid not null references identity.roles (id) on delete cascade,
  permission_id uuid not null references identity.permissions (id) on delete cascade,
  scope text not null check (scope in ('own', 'team', 'all')),
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id, scope)
);

-- Et scope må kun tildeles, hvis permissionen understøtter det.
create or replace function identity.check_role_permission_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from identity.permissions p
    where p.id = new.permission_id and new.scope = any (p.allowed_scopes)
  ) then
    raise exception 'Scope % er ikke tilladt for permission %', new.scope, new.permission_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger role_permissions_check_scope
  before insert or update on identity.role_permissions
  for each row execute function identity.check_role_permission_scope();

create table identity.user_roles (
  user_id uuid not null references identity.users (id) on delete cascade,
  role_id uuid not null references identity.roles (id) on delete restrict,
  assigned_by uuid references identity.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index user_roles_role_id_idx on identity.user_roles (role_id);

-- ----------------------------------------------------------------------------
-- teams, team_memberships, leader_scopes
-- ----------------------------------------------------------------------------

create table identity.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  parent_team_id uuid references identity.teams (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_team_id is null or parent_team_id <> id)
);

create index teams_parent_team_id_idx on identity.teams (parent_team_id);

create trigger teams_touch_updated_at
  before update on identity.teams
  for each row execute function identity.touch_updated_at();

-- Hierarkiet må ikke indeholde cykler.
create or replace function identity.check_team_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_team_id is not null and exists (
    with recursive ancestors(id) as (
      select new.parent_team_id
      union
      select t.parent_team_id
      from identity.teams t
      join ancestors a on t.id = a.id
      where t.parent_team_id is not null
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Teamhierarkiet må ikke indeholde en cyklus' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger teams_check_hierarchy
  before insert or update of parent_team_id on identity.teams
  for each row execute function identity.check_team_hierarchy();

create table identity.team_memberships (
  user_id uuid not null references identity.users (id) on delete cascade,
  team_id uuid not null references identity.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

create index team_memberships_team_id_idx on identity.team_memberships (team_id);

-- Eksplicit lederscope (docs/03 §10). Udledes aldrig af jobtitel eller rollenavn.
create table identity.leader_scopes (
  user_id uuid not null references identity.users (id) on delete cascade,
  team_id uuid not null references identity.teams (id) on delete cascade,
  include_descendants boolean not null default false,
  granted_by uuid references identity.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

create index leader_scopes_team_id_idx on identity.leader_scopes (team_id);

-- ----------------------------------------------------------------------------
-- Autorisationsfunktioner
--
-- SECURITY DEFINER, så de kan bruges i RLS-policies uden rekursion. De afgør altid
-- adgang for den aktuelle Supabase Auth-bruger (auth.uid()) og returnerer kun boolean
-- eller data om den aktuelle bruger.
-- ----------------------------------------------------------------------------

-- Den aktive platformbruger for den aktuelle session, eller null.
create or replace function identity.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from identity.users u
  where u.auth_id = auth.uid() and u.status = 'active'
$$;

-- Scopes en given bruger har for en permission, via alle brugerens roller.
create or replace function identity.permission_scopes(p_user_id uuid, p_permission text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct rp.scope), array[]::text[])
  from identity.user_roles ur
  join identity.role_permissions rp on rp.role_id = ur.role_id
  join identity.permissions p on p.id = rp.permission_id
  join identity.users u on u.id = ur.user_id
  where ur.user_id = p_user_id and p.key = p_permission and u.status = 'active'
$$;

-- Har den aktuelle bruger permissionen (med et bestemt scope, hvis angivet)?
create or replace function identity.has_permission(p_permission text, p_scope text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_scope is null then cardinality(identity.permission_scopes(identity.current_user_id(), p_permission)) > 0
    else p_scope = any (identity.permission_scopes(identity.current_user_id(), p_permission))
  end
$$;

-- Teams, en leder har scope til — inkl. underteams, hvor include_descendants er sat.
create or replace function identity.scoped_team_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive scoped(team_id, include_descendants) as (
    select ls.team_id, ls.include_descendants
    from identity.leader_scopes ls
    join identity.users u on u.id = ls.user_id
    where ls.user_id = p_user_id and u.status = 'active'
    union
    select t.id, true
    from identity.teams t
    join scoped s on t.parent_team_id = s.team_id
    where s.include_descendants
  )
  select distinct team_id from scoped
$$;

-- Den aktuelle brugers scopede teams. Policies bruger denne, så funktionerne med et
-- bruger-id som argument ikke skal kunne kaldes direkte (de kunne afsløre andres scopes).
create or replace function identity.my_scoped_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select identity.scoped_team_ids(identity.current_user_id())
$$;

-- Ligger subject inden for lederens scope (medlem af mindst ét team i scopet)?
create or replace function identity.is_in_leader_scope(p_leader_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from identity.team_memberships tm
    where tm.user_id = p_subject_id
      and tm.team_id in (select identity.scoped_team_ids(p_leader_id))
  )
$$;

-- Må den aktuelle bruger tilgå subjects data under en given permission?
--   own  → kun egne data
--   team → data om medarbejdere i lederens scope (og aldrig udledt af rollenavn)
--   all  → hele organisationen
create or replace function identity.can_access_user_data(p_permission text, p_subject_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := identity.current_user_id();
  v_scopes text[];
begin
  if v_me is null or p_subject_id is null then
    return false;
  end if;
  v_scopes := identity.permission_scopes(v_me, p_permission);
  if 'all' = any (v_scopes) then
    return true;
  end if;
  if 'own' = any (v_scopes) and p_subject_id = v_me then
    return true;
  end if;
  if 'team' = any (v_scopes) and identity.is_in_leader_scope(v_me, p_subject_id) then
    return true;
  end if;
  return false;
end;
$$;

-- Den aktuelle brugers effektive permissions. Bruges af applikationen til at vise UI.
-- UI-visning er aldrig adgangskontrol; den ligger i RLS og server-side checks.
create or replace function identity.my_permissions()
returns table (permission text, scope text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.key, rp.scope
  from identity.user_roles ur
  join identity.role_permissions rp on rp.role_id = ur.role_id
  join identity.permissions p on p.id = rp.permission_id
  where ur.user_id = identity.current_user_id()
  order by 1, 2
$$;

-- Transparens (docs/04 §13.1): hvilke ledere har scope til den aktuelle bruger, og hvilke
-- team-scopede permissions har de? Viser kategorier af adgang — aldrig hvornår der er set.
create or replace function identity.my_visibility()
returns table (leader_id uuid, leader_name text, team_names text[], permission text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select identity.current_user_id() as id),
  leaders as (
    select distinct ls.user_id
    from identity.leader_scopes ls, me
    where ls.user_id <> me.id and identity.is_in_leader_scope(ls.user_id, me.id)
  )
  select
    l.user_id,
    u.display_name,
    array(
      select distinct t.name
      from identity.team_memberships tm
      join identity.teams t on t.id = tm.team_id
      where tm.user_id = (select id from me)
        and tm.team_id in (select identity.scoped_team_ids(l.user_id))
      order by t.name
    ),
    p.key
  from leaders l
  join identity.users u on u.id = l.user_id and u.status = 'active'
  join identity.user_roles ur on ur.user_id = l.user_id
  join identity.role_permissions rp on rp.role_id = ur.role_id and rp.scope = 'team'
  join identity.permissions p on p.id = rp.permission_id
  order by u.display_name, p.key
$$;

-- ----------------------------------------------------------------------------
-- Ny Supabase Auth-bruger → platformbruger (uden roller; roller tildeles af administrator)
-- ----------------------------------------------------------------------------

create or replace function identity.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into identity.users (auth_id, display_name, job_title)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'job_title', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function identity.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table identity.users enable row level security;
alter table identity.roles enable row level security;
alter table identity.permissions enable row level security;
alter table identity.role_permissions enable row level security;
alter table identity.user_roles enable row level security;
alter table identity.teams enable row level security;
alter table identity.team_memberships enable row level security;
alter table identity.leader_scopes enable row level security;

-- users: sig selv, brugere i lederscope (for de team-scopede læse-permissions) og
-- brugeradministration.
create policy users_select on identity.users
  for select to authenticated
  using (
    id = identity.current_user_id()
    or identity.has_permission('identity.user.manage', 'all')
    or identity.can_access_user_data('learning.progress.read', id)
    or identity.can_access_user_data('assessment.result.read', id)
  );

create policy users_insert on identity.users
  for insert to authenticated
  with check (identity.has_permission('identity.user.manage', 'all'));

create policy users_update on identity.users
  for update to authenticated
  using (identity.has_permission('identity.user.manage', 'all'))
  with check (identity.has_permission('identity.user.manage', 'all'));

-- Kataloget er læsbart for alle loggede ind (bruges til transparens). Det ændres kun via
-- migrationer — der findes bevidst ingen skrive-policies.
create policy roles_select on identity.roles for select to authenticated using (true);
create policy permissions_select on identity.permissions for select to authenticated using (true);
create policy role_permissions_select on identity.role_permissions for select to authenticated using (true);

-- user_roles: egne roller; brugeradministration ser og ændrer alle.
create policy user_roles_select on identity.user_roles
  for select to authenticated
  using (
    user_id = identity.current_user_id()
    or identity.has_permission('identity.user.manage', 'all')
  );

create policy user_roles_insert on identity.user_roles
  for insert to authenticated
  with check (identity.has_permission('identity.user.manage', 'all'));

create policy user_roles_delete on identity.user_roles
  for delete to authenticated
  using (identity.has_permission('identity.user.manage', 'all'));

-- teams: teams man er medlem af, teams i eget lederscope, eller brugeradministration.
create policy teams_select on identity.teams
  for select to authenticated
  using (
    exists (
      select 1 from identity.team_memberships tm
      where tm.team_id = teams.id and tm.user_id = identity.current_user_id()
    )
    or id in (select identity.my_scoped_team_ids())
    or identity.has_permission('identity.user.manage', 'all')
  );

create policy teams_insert on identity.teams
  for insert to authenticated
  with check (identity.has_permission('identity.user.manage', 'all'));

create policy teams_update on identity.teams
  for update to authenticated
  using (identity.has_permission('identity.user.manage', 'all'))
  with check (identity.has_permission('identity.user.manage', 'all'));

create policy teams_delete on identity.teams
  for delete to authenticated
  using (identity.has_permission('identity.user.manage', 'all'));

-- team_memberships: egne, medlemskaber i eget lederscope, eller brugeradministration.
create policy team_memberships_select on identity.team_memberships
  for select to authenticated
  using (
    user_id = identity.current_user_id()
    or team_id in (select identity.my_scoped_team_ids())
    or identity.has_permission('identity.user.manage', 'all')
  );

create policy team_memberships_insert on identity.team_memberships
  for insert to authenticated
  with check (identity.has_permission('identity.user.manage', 'all'));

create policy team_memberships_delete on identity.team_memberships
  for delete to authenticated
  using (identity.has_permission('identity.user.manage', 'all'));

-- leader_scopes: egne scopes; brugeradministration ser og ændrer alle.
create policy leader_scopes_select on identity.leader_scopes
  for select to authenticated
  using (
    user_id = identity.current_user_id()
    or identity.has_permission('identity.user.manage', 'all')
  );

create policy leader_scopes_insert on identity.leader_scopes
  for insert to authenticated
  with check (identity.has_permission('identity.user.manage', 'all'));

create policy leader_scopes_update on identity.leader_scopes
  for update to authenticated
  using (identity.has_permission('identity.user.manage', 'all'))
  with check (identity.has_permission('identity.user.manage', 'all'));

create policy leader_scopes_delete on identity.leader_scopes
  for delete to authenticated
  using (identity.has_permission('identity.user.manage', 'all'));

-- ----------------------------------------------------------------------------
-- Rettigheder. anon har ingen adgang til identity-skemaet.
-- ----------------------------------------------------------------------------

revoke all on all tables in schema identity from anon, authenticated;
grant select on identity.roles, identity.permissions, identity.role_permissions to authenticated;
grant select, insert on identity.users to authenticated;
-- Kun disse kolonner kan ændres via API'et (id og auth_id er uforanderlige).
grant update (display_name, job_title, status) on identity.users to authenticated;
grant select, insert, delete on identity.user_roles to authenticated;
grant select, insert, update, delete on identity.teams to authenticated;
grant select, insert, delete on identity.team_memberships to authenticated;
grant select, insert, update, delete on identity.leader_scopes to authenticated;

revoke all on all functions in schema identity from public, anon;
grant execute on function
  identity.current_user_id(),
  identity.has_permission(text, text),
  identity.can_access_user_data(text, uuid),
  identity.my_permissions(),
  identity.my_visibility(),
  identity.my_scoped_team_ids()
to authenticated;
-- permission_scopes, scoped_team_ids og is_in_leader_scope tager et vilkårligt bruger-id
-- og er derfor kun tilgængelige for andre SECURITY DEFINER-funktioner.

grant all on all tables in schema identity to service_role;
grant execute on all functions in schema identity to service_role;
