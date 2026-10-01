-- ============================================================================
-- Fase 7, trin 1 — Knowledge Engine: datamodel, tilstandsregler, adgang og audit
--
-- Specifikation: docs/07-knowledge-engine.md §1 (datamodel), §2 (livscyklus),
-- §4 (dokumentadgang), §13 (audit) og §14 (sikkerhed).
--
-- Principper:
--   * Upload og teknisk behandling gør aldrig en version autoritativ. Kun en menneskelig
--     godkendelse (knowledge.version.publish) gør — den bygges i trin 5.
--   * Statusovergange er kun dem i docs/07 §2.2. Det håndhæves af en trigger for ALLE
--     roller, også service_role. Klienter kan ikke opdatere status direkte.
--   * Rådgiveres og lederes adgang til viden gives pr. dokument (document_access_grants),
--     aldrig gennem rollen. Lederscope giver ingen vidensadgang (docs/07 §4.3).
--   * Ingen tabel eller funktion fra fase 6 ændres.
-- ============================================================================

create extension if not exists vector with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists knowledge;
revoke all on schema knowledge from public;
grant usage on schema knowledge to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Hjælpere
-- ----------------------------------------------------------------------------

create or replace function knowledge.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- "I dag" i dansk tid (docs/07 §3.4): en betingelse med virkning fra 1. januar gælder fra
-- dansk midnat.
create or replace function knowledge.today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Copenhagen')::date
$$;

-- Overskriftskæden som tekst til de genererede søgekolonner. array_to_string er STABLE i
-- Postgres; for text[] er resultatet uforanderligt, så wrapperen kan erklæres IMMUTABLE.
create or replace function knowledge.heading_text(p_heading_path text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_to_string(p_heading_path, ' '), '')
$$;

-- ----------------------------------------------------------------------------
-- Opslagstabeller
-- ----------------------------------------------------------------------------

-- De otte dokumenttyper fra docs/03 §6. Der opfindes ikke flere (docs/07 §1.2).
create table knowledge.document_types (
  key text primary key check (key ~ '^[a-z][a-z_]*$'),
  name text not null,
  sort_order int not null,
  created_at timestamptz not null default now()
);

insert into knowledge.document_types (key, name, sort_order) values
  ('policy_text', 'Policetekst', 1),
  ('terms', 'Betingelser', 2),
  ('product_description', 'Produktbeskrivelse', 3),
  ('acceptance_rules', 'Acceptregler', 4),
  ('business_procedure', 'Forretningsgang', 5),
  ('guidance', 'Vejledning', 6),
  ('sales_material', 'Salgsmateriale', 7),
  ('internal_document', 'Internt fagligt dokument', 8);

-- Kilder (docs/03 §15). Fase 7 har kun manuel upload; connectors kommer senere.
create table knowledge.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('manual_upload', 'connector')),
  created_at timestamptz not null default now()
);

insert into knowledge.sources (name, type) values ('Manuel upload', 'manual_upload');

-- ----------------------------------------------------------------------------
-- products — forsikringsprodukter. category er bevidst simpel, nullable metadata (B-28).
-- ----------------------------------------------------------------------------

create table knowledge.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text check (category is null or char_length(category) <= 200),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid default identity.current_user_id() references identity.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index products_name_key on knowledge.products (lower(btrim(name)));

create trigger products_touch_updated_at
  before update on knowledge.products
  for each row execute function knowledge.touch_updated_at();

-- ----------------------------------------------------------------------------
-- documents — det logiske dokument, uden indhold (docs/03 §12)
-- ----------------------------------------------------------------------------

create table knowledge.documents (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references knowledge.products (id) on delete restrict,
  document_type text not null references knowledge.document_types (key) on delete restrict,
  source_id uuid not null references knowledge.sources (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  external_ref text check (external_ref is null or char_length(external_ref) <= 500),
  created_by uuid default identity.current_user_id() references identity.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_product_id_idx on knowledge.documents (product_id);

create trigger documents_touch_updated_at
  before update on knowledge.documents
  for each row execute function knowledge.touch_updated_at();

-- Et udgået produkt kan ikke få nye dokumenter (docs/07 §1.2).
create or replace function knowledge.check_document_product_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) and exists (
    select 1 from knowledge.products p where p.id = new.product_id and p.status <> 'active'
  ) then
    raise exception 'Produktet er udgået og kan ikke få nye dokumenter' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger documents_check_product_active
  before insert or update of product_id on knowledge.documents
  for each row execute function knowledge.check_document_product_active();

-- ----------------------------------------------------------------------------
-- document_versions — indhold, gyldighed og godkendelse hører til versionen
-- ----------------------------------------------------------------------------

create table knowledge.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge.documents (id) on delete restrict,
  version_label text check (version_label is null or char_length(btrim(version_label)) between 1 and 100),
  language text not null default 'da' check (language ~ '^[a-z]{2}$'),
  -- Gyldighed: halvåbent interval [valid_from, valid_to), kalenderdatoer i dansk tid.
  valid_from date,
  valid_to date,
  status text not null default 'uploaded' check (status in (
    'uploaded', 'processing', 'processing_failed', 'processed',
    'under_review', 'rejected', 'published', 'withdrawn', 'discarded'
  )),
  -- Originalfilen. Stien er uuid-baseret; brugerens filnavn er kun metadata.
  storage_path text not null unique,
  -- Erklæret af klienten ved upload; workeren genberegner og verificerer (docs/07 §2.3).
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  checksum_verified_at timestamptz,
  byte_size bigint check (byte_size is null or byte_size > 0),
  mime_type text,
  page_count int check (page_count is null or page_count >= 0),
  original_filename text check (original_filename is null or char_length(original_filename) <= 255),
  uploaded_by uuid references identity.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  review_started_by uuid references identity.users (id) on delete set null,
  review_started_at timestamptz,
  approved_by uuid references identity.users (id) on delete set null,
  approved_at timestamptz,
  -- Registreringstid (recorded_at i docs/03 §12).
  published_at timestamptz,
  superseded_by uuid references knowledge.document_versions (id) on delete restrict,
  superseded_at timestamptz,
  withdrawn_by uuid references identity.users (id) on delete set null,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  withdrawal_category text check (withdrawal_category is null or withdrawal_category in ('invalid', 'withdrawn_by_owner', 'other')),
  extractor_version text,
  chunker_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (valid_to is null or valid_from is null or valid_to > valid_from),
  check (superseded_by is null or superseded_by <> id),
  -- En publiceret (eller senere deaktiveret) version er godkendt af et menneske.
  check (status not in ('published', 'withdrawn') or (
    valid_from is not null and approved_at is not null and published_at is not null
  )),
  check (status <> 'withdrawn' or (
    withdrawn_at is not null and withdrawal_category is not null and char_length(btrim(coalesce(withdrawal_reason, ''))) > 0
  )),
  -- To publicerede versioner af samme dokument og sprog må aldrig overlappe (docs/07 §1.2).
  constraint document_versions_no_overlap exclude using gist (
    document_id with =,
    language with =,
    daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'published')
);

create index document_versions_document_id_idx on knowledge.document_versions (document_id);
create index document_versions_status_idx on knowledge.document_versions (status);
create index document_versions_checksum_idx on knowledge.document_versions (checksum_sha256);

create trigger document_versions_touch_updated_at
  before update on knowledge.document_versions
  for each row execute function knowledge.touch_updated_at();

-- Tilstandsmaskinen fra docs/07 §2.2 og uforanderlighed efter review/publicering. Gælder
-- for alle roller — også service_role og tabellens ejer.
create or replace function knowledge.check_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed text[][] := array[
    ['uploaded', 'processing'], ['uploaded', 'discarded'],
    ['processing', 'processed'], ['processing', 'processing_failed'],
    ['processing_failed', 'processing'], ['processing_failed', 'discarded'],
    ['processed', 'under_review'], ['processed', 'discarded'],
    ['under_review', 'processed'], ['under_review', 'published'], ['under_review', 'rejected'],
    ['rejected', 'processing'], ['rejected', 'processed'], ['rejected', 'discarded'],
    ['published', 'withdrawn']
  ];
  v_pair text[];
  v_ok boolean := false;
begin
  -- Felter, der aldrig ændres.
  if new.id <> old.id or new.document_id <> old.document_id or new.storage_path <> old.storage_path
     or new.uploaded_by is distinct from old.uploaded_by or new.uploaded_at <> old.uploaded_at then
    raise exception 'Versionens identitet og originalfil kan ikke ændres' using errcode = 'check_violation';
  end if;

  if old.status in ('withdrawn', 'discarded') then
    raise exception 'En % version kan ikke ændres', old.status using errcode = 'check_violation';
  end if;

  if new.status <> old.status then
    foreach v_pair slice 1 in array v_allowed loop
      if v_pair[1] = old.status and v_pair[2] = new.status then
        v_ok := true;
      end if;
    end loop;
    if not v_ok then
      raise exception 'Ugyldig statusovergang: % → %', old.status, new.status using errcode = 'check_violation';
    end if;
  end if;

  -- Teknisk indhold ændres kun af workeren, mens versionen behandles.
  if old.status <> 'processing' and (
    new.checksum_sha256 <> old.checksum_sha256
    or new.checksum_verified_at is distinct from old.checksum_verified_at
    or new.byte_size is distinct from old.byte_size
    or new.mime_type is distinct from old.mime_type
    or new.page_count is distinct from old.page_count
    or new.extractor_version is distinct from old.extractor_version
    or new.chunker_version is distinct from old.chunker_version
  ) then
    raise exception 'Teknisk indhold kan kun ændres under behandling' using errcode = 'check_violation';
  end if;

  -- Påbegyndt review låser versionens metadata (docs/07 §2.2).
  if old.status in ('under_review', 'published') and (
    new.version_label is distinct from old.version_label
    or new.language <> old.language
    or new.valid_from is distinct from old.valid_from
  ) then
    raise exception 'Versionens metadata er låst efter påbegyndt review' using errcode = 'check_violation';
  end if;

  if old.status = 'under_review' and new.valid_to is distinct from old.valid_to then
    raise exception 'Versionens metadata er låst efter påbegyndt review' using errcode = 'check_violation';
  end if;

  -- En publiceret version: kun afkortning ved erstatning (docs/07 §3.5) og deaktivering.
  if old.status = 'published' then
    if new.valid_to is distinct from old.valid_to and not (
      new.valid_to is not null
      and (old.valid_to is null or new.valid_to < old.valid_to)
      and new.superseded_by is not null
      and old.superseded_by is null
    ) then
      raise exception 'Gyldigheden af en publiceret version kan kun afkortes, når den erstattes'
        using errcode = 'check_violation';
    end if;
    if old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by then
      raise exception 'En erstattet version kan ikke erstattes igen' using errcode = 'check_violation';
    end if;
    if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
       or new.published_at is distinct from old.published_at then
      raise exception 'Godkendelsen af en publiceret version kan ikke ændres' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger document_versions_check_update
  before update on knowledge.document_versions
  for each row execute function knowledge.check_version_update();

-- Nye versioner starter altid som "uploaded" — upload gør aldrig noget autoritativt.
create or replace function knowledge.check_version_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'uploaded' or new.approved_at is not null or new.published_at is not null
     or new.superseded_by is not null or new.withdrawn_at is not null then
    raise exception 'En ny version starter altid som uploadet' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger document_versions_check_insert
  before insert on knowledge.document_versions
  for each row execute function knowledge.check_version_insert();

-- Versioner slettes aldrig (citations og audit peger på dem).
create or replace function knowledge.prevent_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% kan ikke slettes', tg_table_name using errcode = 'check_violation';
end;
$$;

create trigger document_versions_no_delete
  before delete on knowledge.document_versions
  for each row execute function knowledge.prevent_delete();

create trigger documents_no_delete
  before delete on knowledge.documents
  for each row execute function knowledge.prevent_delete();

-- ----------------------------------------------------------------------------
-- version_reviews — faglige afgørelser (domænedata, ikke audit)
-- ----------------------------------------------------------------------------

create table knowledge.version_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references knowledge.document_versions (id) on delete restrict,
  reviewer_id uuid references identity.users (id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text,
  quality_report_snapshot jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  check (decision <> 'rejected' or char_length(btrim(coalesce(reason, ''))) > 0)
);

create index version_reviews_version_id_idx on knowledge.version_reviews (version_id);

-- Afgørelser er uforanderlige.
create or replace function knowledge.prevent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% kan ikke ændres eller slettes', tg_table_name using errcode = 'check_violation';
end;
$$;

create trigger version_reviews_immutable
  before update or delete on knowledge.version_reviews
  for each row execute function knowledge.prevent_change();

-- ----------------------------------------------------------------------------
-- document_access_grants — adgang pr. dokument (docs/07 §4). "team" betyder teamets
-- medlemmer, ikke teams man leder.
-- ----------------------------------------------------------------------------

create table knowledge.document_access_grants (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge.documents (id) on delete cascade,
  permission_key text not null check (permission_key in ('knowledge.document.read', 'knowledge.document.read_historical')),
  grantee_type text not null check (grantee_type in ('all_users', 'team', 'user')),
  team_id uuid references identity.teams (id) on delete cascade,
  include_descendants boolean not null default false,
  user_id uuid references identity.users (id) on delete cascade,
  granted_by uuid default identity.current_user_id() references identity.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  check (
    (grantee_type = 'all_users' and team_id is null and user_id is null and not include_descendants)
    or (grantee_type = 'team' and team_id is not null and user_id is null)
    or (grantee_type = 'user' and user_id is not null and team_id is null and not include_descendants)
  ),
  unique nulls not distinct (document_id, permission_key, grantee_type, team_id, user_id)
);

create index document_access_grants_document_idx on knowledge.document_access_grants (document_id, permission_key);

-- ----------------------------------------------------------------------------
-- ingestion_jobs — teknisk behandling, adskilt fra faglig godkendelse (docs/03 §8)
-- ----------------------------------------------------------------------------

create table knowledge.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references knowledge.document_versions (id) on delete restrict,
  kind text not null default 'process' check (kind in ('process', 'reembed')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  current_step text,
  step_state jsonb not null default '{}'::jsonb,
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  -- Årsag i klartekst til Admin. Aldrig dokumentindhold.
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  quality_report jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Højst ét aktivt job pr. version og art.
create unique index ingestion_jobs_one_active on knowledge.ingestion_jobs (document_version_id, kind)
  where status in ('queued', 'running');
create index ingestion_jobs_queue_idx on knowledge.ingestion_jobs (next_attempt_at) where status in ('queued', 'running');

create trigger ingestion_jobs_touch_updated_at
  before update on knowledge.ingestion_jobs
  for each row execute function knowledge.touch_updated_at();

-- ----------------------------------------------------------------------------
-- document_pages og document_chunks — skrives kun af workeren under behandling
-- ----------------------------------------------------------------------------

-- Normaliseret tekst pr. side. char_start/char_end er sidens placering i versionens
-- samlede normaliserede tekst, som chunks peger ind i.
create table knowledge.document_pages (
  document_version_id uuid not null references knowledge.document_versions (id) on delete restrict,
  page_number int not null check (page_number >= 1),
  text text not null default '',
  has_text_layer boolean not null,
  char_start int not null check (char_start >= 0),
  char_end int not null,
  created_at timestamptz not null default now(),
  primary key (document_version_id, page_number),
  check (char_end >= char_start)
);

create table knowledge.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references knowledge.document_versions (id) on delete restrict,
  chunk_index int not null check (chunk_index >= 0),
  kind text not null check (kind in ('prose', 'list', 'table')),
  -- Kildens egen tekst, uden overskriftskæde.
  text text not null check (char_length(text) > 0),
  heading text,
  heading_path text[] not null default '{}',
  section_number text,
  page_start int not null check (page_start >= 1),
  page_end int not null,
  char_start int not null check (char_start >= 0),
  char_end int not null,
  overlap_chars int not null default 0 check (overlap_chars >= 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  char_count int not null check (char_count > 0),
  token_estimate int not null check (token_estimate > 0),
  -- Leksikalsk søgning (docs/07 §8): dansk med stemming og simple til eksakte strenge.
  fts_da tsvector generated always as (
    to_tsvector('danish'::regconfig, knowledge.heading_text(heading_path) || ' ' || text)
  ) stored,
  fts_simple tsvector generated always as (
    to_tsvector('simple'::regconfig, knowledge.heading_text(heading_path) || ' ' || text)
  ) stored,
  created_at timestamptz not null default now(),
  unique (document_version_id, chunk_index),
  check (page_end >= page_start),
  check (char_end > char_start),
  check (overlap_chars < char_end - char_start)
);

create index document_chunks_fts_da_idx on knowledge.document_chunks using gin (fts_da);
create index document_chunks_fts_simple_idx on knowledge.document_chunks using gin (fts_simple);

-- Sider og chunks må kun skrives, mens versionen behandles. Dermed er en publiceret
-- versions chunks frosne (docs/07 §2.3, B-13), også under review.
create or replace function knowledge.check_version_processing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version_id uuid := case when tg_op = 'DELETE' then old.document_version_id else new.document_version_id end;
begin
  if not exists (
    select 1 from knowledge.document_versions v where v.id = v_version_id and v.status = 'processing'
  ) then
    raise exception '% kan kun ændres, mens versionen behandles', tg_table_name using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.document_version_id <> old.document_version_id then
    raise exception 'Versionen kan ikke ændres' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger document_pages_check_processing
  before insert or update or delete on knowledge.document_pages
  for each row execute function knowledge.check_version_processing();

create trigger document_chunks_check_processing
  before insert or update or delete on knowledge.document_chunks
  for each row execute function knowledge.check_version_processing();

-- ----------------------------------------------------------------------------
-- Adgangsfunktioner (docs/07 §4). SECURITY DEFINER, så de kan bruges i RLS uden
-- rekursion. De afgør altid adgang for den aktuelle bruger.
-- ----------------------------------------------------------------------------

-- Forvalter viden: knowledge.document.write eller knowledge.version.publish.
create or replace function knowledge.is_knowledge_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select identity.has_permission('knowledge.document.write') or identity.has_permission('knowledge.version.publish')
$$;

-- Et team og alle dets underteams.
create or replace function knowledge.team_and_descendants(p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree(id) as (
    select p_team_id
    union
    select t.id from identity.teams t join tree on t.parent_team_id = tree.id
  )
  select id from tree
$$;

-- Har den aktuelle bruger en tildeling til dokumentet for permissionen? Kun medlemskab
-- tæller for teamtildelinger — lederscope giver ingen vidensadgang (docs/07 §4.3).
create or replace function knowledge.has_document_grant(p_document_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select identity.current_user_id() as id)
  select exists (
    select 1
    from knowledge.document_access_grants g, me
    where me.id is not null
      and g.document_id = p_document_id
      and g.permission_key = p_permission
      and (
        g.grantee_type = 'all_users'
        or (g.grantee_type = 'user' and g.user_id = me.id)
        or (g.grantee_type = 'team' and exists (
          select 1 from identity.team_memberships tm
          where tm.user_id = me.id
            and (
              tm.team_id = g.team_id
              or (g.include_descendants and tm.team_id in (select knowledge.team_and_descendants(g.team_id)))
            )
        ))
      )
  )
$$;

-- Effektiv adgang til et dokument for en læse-permission: rolle med scope "all"
-- (i dag Administrator) eller en tildeling pr. dokument.
create or replace function knowledge.can_read_document_as(p_document_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission in ('knowledge.document.read', 'knowledge.document.read_historical')
    and (identity.has_permission(p_permission, 'all') or knowledge.has_document_grant(p_document_id, p_permission))
$$;

-- Må den aktuelle bruger læse en version?
--   current    → publiceret og gyldig i dag; kræver knowledge.document.read
--   historical → publiceret og udløbet (valid_to ≤ i dag); kræver read_historical
--   any        → current, fremtidig (read) eller historisk (read_historical). Bruges af RLS.
-- Upublicerede og deaktiverede versioner kan aldrig læses gennem denne funktion.
create or replace function knowledge.can_read_version(p_version_id uuid, p_mode text default 'any')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from knowledge.document_versions v
    where v.id = p_version_id
      and v.status = 'published'
      and case
        when v.valid_to is not null and v.valid_to <= knowledge.today() then
          p_mode in ('any', 'historical')
          and knowledge.can_read_document_as(v.document_id, 'knowledge.document.read_historical')
        when v.valid_from <= knowledge.today() then
          p_mode in ('any', 'current')
          and knowledge.can_read_document_as(v.document_id, 'knowledge.document.read')
        else
          p_mode = 'any'
          and knowledge.can_read_document_as(v.document_id, 'knowledge.document.read')
      end
  )
$$;

-- Kan brugeren læse mindst én version af dokumentet?
create or replace function knowledge.can_read_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from knowledge.document_versions v
    where v.document_id = p_document_id and v.status = 'published' and knowledge.can_read_version(v.id, 'any')
  )
$$;

-- ----------------------------------------------------------------------------
-- Audit (docs/07 §13): handlinger, ikke indhold. Skriver til audit.audit_log fra fase 6.
-- Workeren markerer sig selv med den transaktionslokale indstilling ipa.actor.
-- ----------------------------------------------------------------------------

create or replace function knowledge.write_audit(
  p_action text, p_table text, p_entity_id text, p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := nullif(current_setting('ipa.actor', true), '');
begin
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, details)
  values (
    identity.current_user_id(),
    p_action,
    'knowledge',
    p_table,
    p_entity_id,
    case when v_actor is null then p_details else p_details || jsonb_build_object('actor', v_actor) end
  );
end;
$$;

create or replace function knowledge.changed_fields(p_old jsonb, p_new jsonb, p_ignore text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(key order by key), '{}')
  from jsonb_each(p_new) n(key, value)
  where not (key = any (p_ignore)) and (p_old -> key) is distinct from value
$$;

create or replace function knowledge.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_ignore text[] := array['updated_at', 'fts_da', 'fts_simple'];
  v_fields text[];
begin
  if tg_table_name = 'products' then
    if tg_op = 'INSERT' then
      perform knowledge.write_audit('knowledge.product.created', 'products', new.id::text, '{}'::jsonb);
    else
      v_fields := knowledge.changed_fields(v_old, v_new, v_ignore);
      if cardinality(v_fields) > 0 then
        perform knowledge.write_audit(
          case when new.status = 'retired' and old.status <> 'retired' then 'knowledge.product.retired' else 'knowledge.product.updated' end,
          'products', new.id::text, jsonb_build_object('fields', v_fields)
        );
      end if;
    end if;

  elsif tg_table_name = 'documents' then
    if tg_op = 'INSERT' then
      perform knowledge.write_audit('knowledge.document.created', 'documents', new.id::text,
        jsonb_build_object('product_id', new.product_id, 'document_type', new.document_type));
    else
      v_fields := knowledge.changed_fields(v_old, v_new, v_ignore);
      if cardinality(v_fields) > 0 then
        perform knowledge.write_audit('knowledge.document.updated', 'documents', new.id::text,
          jsonb_build_object('fields', v_fields));
      end if;
    end if;

  elsif tg_table_name = 'document_access_grants' then
    perform knowledge.write_audit(
      case when tg_op = 'INSERT' then 'knowledge.access.granted' else 'knowledge.access.revoked' end,
      'document_access_grants',
      coalesce(v_new, v_old) ->> 'document_id',
      jsonb_build_object(
        'grant_id', coalesce(v_new, v_old) -> 'id',
        'permission_key', coalesce(v_new, v_old) -> 'permission_key',
        'grantee_type', coalesce(v_new, v_old) -> 'grantee_type',
        'team_id', coalesce(v_new, v_old) -> 'team_id',
        'include_descendants', coalesce(v_new, v_old) -> 'include_descendants',
        'user_id', coalesce(v_new, v_old) -> 'user_id'
      )
    );
  end if;
  return null;
end;
$$;

create trigger products_audit
  after insert or update on knowledge.products
  for each row execute function knowledge.audit_change();
create trigger documents_audit
  after insert or update on knowledge.documents
  for each row execute function knowledge.audit_change();
create trigger document_access_grants_audit
  after insert or delete on knowledge.document_access_grants
  for each row execute function knowledge.audit_change();

-- Versioner: hver statusovergang er en navngiven hændelse (docs/07 §13).
create or replace function knowledge.audit_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := new.id::text;
  v_action text;
  v_fields text[];
begin
  if tg_op = 'INSERT' then
    perform knowledge.write_audit('knowledge.version.uploaded', 'document_versions', v_id,
      jsonb_build_object('document_id', new.document_id, 'checksum_sha256', new.checksum_sha256, 'byte_size', new.byte_size));
    return null;
  end if;

  if new.status <> old.status then
    v_action := case
      when old.status = 'uploaded' and new.status = 'processing' then 'knowledge.version.processing_started'
      when new.status = 'processing' then 'knowledge.version.reprocess_requested'
      when old.status = 'processing' and new.status = 'processed' then 'knowledge.version.processing_succeeded'
      when new.status = 'processing_failed' then 'knowledge.version.processing_failed'
      when new.status = 'under_review' then 'knowledge.version.review_started'
      when old.status = 'under_review' and new.status = 'processed' then 'knowledge.version.review_cancelled'
      when old.status = 'rejected' and new.status = 'processed' then 'knowledge.version.metadata_changed'
      when new.status = 'rejected' then 'knowledge.version.rejected'
      when new.status = 'withdrawn' then 'knowledge.version.withdrawn'
      when new.status = 'discarded' then 'knowledge.version.discarded'
      else null
    end;
    if new.status = 'published' then
      perform knowledge.write_audit('knowledge.version.approved', 'document_versions', v_id,
        jsonb_build_object('approved_by', new.approved_by));
      perform knowledge.write_audit('knowledge.version.published', 'document_versions', v_id,
        jsonb_build_object('valid_from', new.valid_from, 'valid_to', new.valid_to, 'language', new.language));
    elsif v_action is not null then
      perform knowledge.write_audit(v_action, 'document_versions', v_id,
        case when new.status = 'withdrawn' then
          jsonb_build_object('category', new.withdrawal_category, 'reason', new.withdrawal_reason)
        else jsonb_build_object('from', old.status, 'to', new.status) end);
    end if;
  end if;

  if new.superseded_by is not null and old.superseded_by is null then
    perform knowledge.write_audit('knowledge.version.superseded', 'document_versions', v_id,
      jsonb_build_object('successor_id', new.superseded_by, 'valid_to', new.valid_to));
  elsif new.status = old.status then
    v_fields := array(
      select f from unnest(array['version_label', 'language', 'valid_from', 'valid_to']) f
      where (to_jsonb(old) -> f) is distinct from (to_jsonb(new) -> f)
    );
    if cardinality(v_fields) > 0 then
      perform knowledge.write_audit('knowledge.version.metadata_changed', 'document_versions', v_id,
        jsonb_build_object(
          'fields', v_fields,
          'valid_from', jsonb_build_object('before', old.valid_from, 'after', new.valid_from),
          'valid_to', jsonb_build_object('before', old.valid_to, 'after', new.valid_to)
        ));
    end if;
  end if;
  return null;
end;
$$;

create trigger document_versions_audit
  after insert or update on knowledge.document_versions
  for each row execute function knowledge.audit_version();

-- ----------------------------------------------------------------------------
-- Row Level Security (docs/07 §14)
-- ----------------------------------------------------------------------------

alter table knowledge.document_types enable row level security;
alter table knowledge.sources enable row level security;
alter table knowledge.products enable row level security;
alter table knowledge.documents enable row level security;
alter table knowledge.document_versions enable row level security;
alter table knowledge.version_reviews enable row level security;
alter table knowledge.document_access_grants enable row level security;
alter table knowledge.ingestion_jobs enable row level security;
alter table knowledge.document_pages enable row level security;
alter table knowledge.document_chunks enable row level security;

create policy document_types_select on knowledge.document_types for select to authenticated using (true);
create policy products_select on knowledge.products for select to authenticated using (true);

create policy products_insert on knowledge.products
  for insert to authenticated
  with check (identity.has_permission('knowledge.document.write'));
create policy products_update on knowledge.products
  for update to authenticated
  using (identity.has_permission('knowledge.document.write'))
  with check (identity.has_permission('knowledge.document.write'));

create policy sources_select on knowledge.sources
  for select to authenticated using (knowledge.is_knowledge_manager());

create policy documents_select on knowledge.documents
  for select to authenticated
  using (knowledge.is_knowledge_manager() or knowledge.can_read_document(id));
create policy documents_update on knowledge.documents
  for update to authenticated
  using (identity.has_permission('knowledge.document.write'))
  with check (identity.has_permission('knowledge.document.write'));

create policy document_versions_select on knowledge.document_versions
  for select to authenticated
  using (knowledge.is_knowledge_manager() or knowledge.can_read_version(id, 'any'));

create policy document_chunks_select on knowledge.document_chunks
  for select to authenticated
  using (knowledge.is_knowledge_manager() or knowledge.can_read_version(document_version_id, 'any'));

-- Upublicerede data, sider, kvalitetsrapporter og jobs: kun for forvaltere (docs/07 §4.1).
create policy version_reviews_select on knowledge.version_reviews
  for select to authenticated using (knowledge.is_knowledge_manager());
create policy ingestion_jobs_select on knowledge.ingestion_jobs
  for select to authenticated using (knowledge.is_knowledge_manager());
create policy document_pages_select on knowledge.document_pages
  for select to authenticated using (knowledge.is_knowledge_manager());

-- Tildelinger: kun knowledge.document.write ser og forvalter dem (docs/07 §4.2).
create policy document_access_grants_select on knowledge.document_access_grants
  for select to authenticated using (identity.has_permission('knowledge.document.write'));
create policy document_access_grants_insert on knowledge.document_access_grants
  for insert to authenticated with check (identity.has_permission('knowledge.document.write'));
create policy document_access_grants_delete on knowledge.document_access_grants
  for delete to authenticated using (identity.has_permission('knowledge.document.write'));

-- ----------------------------------------------------------------------------
-- Rettigheder. anon har ingen adgang. Versioner, sider, chunks og jobs skrives kun
-- gennem funktioner (trin 2, 3 og 5).
-- ----------------------------------------------------------------------------

revoke all on all tables in schema knowledge from anon, authenticated;
grant select on all tables in schema knowledge to authenticated;
grant insert (name, category, status), update (name, category, status) on knowledge.products to authenticated;
grant update (title, product_id, document_type, external_ref) on knowledge.documents to authenticated;
grant insert (document_id, permission_key, grantee_type, team_id, include_descendants, user_id),
  delete on knowledge.document_access_grants to authenticated;

grant all on all tables in schema knowledge to service_role;

revoke all on all functions in schema knowledge from public, anon;
grant execute on function
  knowledge.today(),
  knowledge.heading_text(text[]),
  knowledge.is_knowledge_manager(),
  knowledge.can_read_version(uuid, text),
  knowledge.can_read_document(uuid)
to authenticated;
-- has_document_grant, can_read_document_as og team_and_descendants bruges kun af andre
-- SECURITY DEFINER-funktioner og i policies via dem.
grant execute on all functions in schema knowledge to service_role;
