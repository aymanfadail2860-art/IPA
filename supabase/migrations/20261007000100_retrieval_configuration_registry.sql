-- ============================================================================
-- Fase 8B, deltrin I6 — Register over retrieval-konfigurationer og ProductionEvidenceSet
--
-- Specifikation: docs/08b §4.4–§4.5, §9, §10, §11 (D-6, D-8, D-14, D-18) og §21.9.
--
--   * knowledge.retrieval_configurations: versioneret register. Hver konfiguration er netop det
--     fingeraftrykte materiale (material) og ændres aldrig. Kun status og statusfelterne ændres,
--     og kun gennem funktionerne nedenfor, efter en streng tilstandsmaskine:
--       candidate → approved → active → suspended → (approved igen med en ny bestået kørsel)
--       og retired (aldrig slettet). Højst én konfiguration er i drift (active eller suspended).
--   * knowledge.evaluation_runs: append-only. Skrives kun af evaluation_publisher via
--     knowledge.record_evaluation_run, der genberegner checksums, fingeraftryk, metrics,
--     gates, minimum pr. type, tier og afgørelse fra rapporten selv og afviser alt, der ikke
--     stemmer.
--   * knowledge.evaluation_gate_sets: registreres af evaluation_publisher, godkendes af et
--     menneske med system.settings.manage og kan derefter ikke ændres.
--   * evaluation_publisher (D-18): gruppen evaluation_publisher (NOLOGIN, kun EXECUTE på de to
--     publiceringsfunktioner) og login-rollen evaluation_publisher_login, der oprettes NOLOGIN
--     uden password og aktiveres af driften via ops.evaluation_publisher_*. Ingen credentials her.
--   * Godkendelse, aktivering, suspendering og udfasning kræver system.settings.manage. Ingen
--     kolonne, indstilling eller parameter sætter evidensgraden (§9). Graden afledes i
--     applikationen af P1–P9 ud fra knowledge.retrieval_context().
--   * search_chunks og evidence_chunks returnerer chunker-versionen pr. chunk (P7).
--
-- Ingen tabel kan skrives direkte af app-roller, service_role eller administratoren.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Roller (klyngebrede, derfor idempotent). Samme disciplin som ingestion_worker (8B-I3).
-- ----------------------------------------------------------------------------

do $$
declare
  v_name text;
  v_role record;
begin
  foreach v_name in array array['evaluation_publisher', 'evaluation_publisher_login'] loop
    select * into v_role from pg_catalog.pg_roles where rolname = v_name;
    if not found then
      if v_name = 'evaluation_publisher' then
        execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls', v_name);
      else
        execute format(
          'create role %I nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2 password null',
          v_name);
      end if;
    elsif v_role.rolsuper or v_role.rolcreaterole or v_role.rolcreatedb or v_role.rolreplication or v_role.rolbypassrls then
      raise exception 'Rollen % findes med for brede attributter', v_name;
    end if;
  end loop;
end;
$$;

alter role evaluation_publisher_login set statement_timeout = '60s';
alter role evaluation_publisher_login set lock_timeout = '10s';
alter role evaluation_publisher_login set idle_in_transaction_session_timeout = '30s';
alter role evaluation_publisher_login set search_path = '';

comment on role evaluation_publisher is
  'Evalueringskørslens capability (8B-I6, D-18): kun EXECUTE på knowledge.record_evaluation_run og knowledge.register_evaluation_gate_set. Ingen tabelrettigheder.';
comment on role evaluation_publisher_login is
  'evaluation_publishers login-rolle (kun CI i evalueringsmiljøet). Aktiveres og deaktiveres kun via ops.evaluation_publisher_*.';

grant usage on schema knowledge to evaluation_publisher;

-- Kalderen skal være publisherens login-rolle OG have medlemskab af evaluation_publisher lige
-- nu. Ingen undtagelse for service_role — heller ikke lokalt.
create or replace function knowledge.assert_publisher_caller()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_role text := knowledge.effective_db_role();
begin
  if v_role = 'evaluation_publisher_login' and pg_catalog.pg_has_role(v_role, 'evaluation_publisher', 'USAGE') then
    return v_role;
  end if;
  raise exception 'Kun evaluation_publisher må registrere evalueringer' using errcode = 'insufficient_privilege';
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Kanonisk JSON, checksum og fingeraftryk — samme form som canonicalJson i
--    src/lib/knowledge/core/provider.ts (sorterede nøgler, ingen mellemrum, tal som i
--    JavaScript). En rapport kan derfor efterprøves i databasen uden at stole på klienten.
-- ----------------------------------------------------------------------------

-- Et tal, som JSON.stringify skriver det (for tal, der kommer fra JavaScript).
create or replace function knowledge.canonical_number(p numeric)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v numeric := pg_catalog.trim_scale(p);
  a numeric := abs(v);
  s text;
  frac text;
  digits text;
  e int;
begin
  if v = 0 then return '0'; end if;
  if a >= 0.000001 and a < 1e21 then return v::text; end if;
  s := a::text;
  if a < 1 then
    frac := pg_catalog.split_part(s, '.', 2);
    digits := pg_catalog.ltrim(frac, '0');
    e := -(length(frac) - length(digits) + 1);
  else
    digits := pg_catalog.rtrim(pg_catalog.replace(s, '.', ''), '0');
    e := length(pg_catalog.split_part(s, '.', 1)) - 1;
  end if;
  return case when v < 0 then '-' else '' end || left(digits, 1)
    || case when length(digits) > 1 then '.' || substr(digits, 2) else '' end
    || 'e' || case when e > 0 then '+' else '' end || e::text;
end;
$$;

create or replace function knowledge.canonical_json(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text;
begin
  if p is null then return 'null'; end if;
  case pg_catalog.jsonb_typeof(p)
    when 'object' then
      select '{' || coalesce(string_agg(pg_catalog.to_jsonb(k)::text || ':' || knowledge.canonical_json(v), ',' order by k collate "C"), '') || '}'
      into v_out from pg_catalog.jsonb_each(p) as x(k, v);
      return v_out;
    when 'array' then
      select '[' || coalesce(string_agg(knowledge.canonical_json(e), ',' order by i), '') || ']'
      into v_out from pg_catalog.jsonb_array_elements(p) with ordinality as x(e, i);
      return v_out;
    when 'number' then return knowledge.canonical_number((p #>> '{}')::numeric);
    else return p::text; -- string (JSON-escaped), boolean, null
  end case;
end;
$$;

create or replace function knowledge.checksum_of(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(knowledge.canonical_json(p), 'UTF8')), 'hex')
$$;

create or replace function knowledge.jsonb_keys(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k order by k collate "C"), '{}') from pg_catalog.jsonb_object_keys(p) k
$$;

create or replace function knowledge.jsonb_text_array(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(p) = 'array'
    then (select coalesce(array_agg(e #>> '{}' order by i), '{}') from pg_catalog.jsonb_array_elements(p) with ordinality as x(e, i))
  end
$$;

-- Fingeraftrykket (docs/08b §10.1): chunker-versionerne er et sæt (sorteret, unikt).
create or replace function knowledge.retrieval_fingerprint(p_material jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select knowledge.checksum_of(
    p_material || pg_catalog.jsonb_build_object('chunkerVersions',
      (select coalesce(pg_catalog.jsonb_agg(v order by v collate "C"), '[]'::jsonb)
       from (select distinct e #>> '{}' as v from pg_catalog.jsonb_array_elements(p_material -> 'chunkerVersions') e) d)))
$$;

-- Materialets form (docs/08b §10.1, RetrievalFingerprintMaterial). Null = gyldigt.
create or replace function knowledge.retrieval_material_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_part text;
  v_obj jsonb;
  v_key text;
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object'
     or knowledge.jsonb_keys(p) <> array['algorithmVersion', 'chunkerVersions', 'embedding', 'params', 'reranker'] then
    return 'materialet har ikke de definerende felter';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'embedding') is distinct from 'object' then
    return 'konfigurationen har ingen embedding-model (udviklingskonfiguration)';
  end if;
  if knowledge.jsonb_keys(p -> 'embedding') <> array['dimensions', 'model', 'modelVersion', 'processing', 'provider', 'settings'] then
    return 'embedding-materialet er ufuldstændigt';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'reranker') is distinct from 'object'
     or knowledge.jsonb_keys(p -> 'reranker') <> array['id', 'model', 'modelVersion', 'processing', 'provider', 'settings', 'version'] then
    return 'reranker-materialet er ufuldstændigt';
  end if;
  foreach v_part in array array['embedding', 'reranker'] loop
    v_obj := p -> v_part;
    foreach v_key in array array['provider', 'model', 'modelVersion'] loop
      if pg_catalog.jsonb_typeof(v_obj -> v_key) is distinct from 'string' or length(v_obj ->> v_key) not between 1 and 200 then
        return format('%s.%s mangler', v_part, v_key);
      end if;
    end loop;
    if pg_catalog.jsonb_typeof(v_obj -> 'processing') is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_obj #> '{processing,kind}') is distinct from 'string' then
      return format('%s.processing mangler', v_part);
    end if;
    if pg_catalog.jsonb_typeof(v_obj -> 'settings') is distinct from 'object'
       or exists (select 1 from pg_catalog.jsonb_each(v_obj -> 'settings') s(k, v)
                  where pg_catalog.jsonb_typeof(v) not in ('string', 'number', 'boolean')) then
      return format('%s.settings skal være skalare værdier', v_part);
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p #> '{embedding,dimensions}') is distinct from 'number'
     or (p #>> '{embedding,dimensions}')::numeric not between 1 and 2000
     or (p #>> '{embedding,dimensions}')::numeric <> pg_catalog.trunc((p #>> '{embedding,dimensions}')::numeric) then
    return 'embedding.dimensions er ugyldig';
  end if;
  foreach v_key in array array['id', 'version'] loop
    if pg_catalog.jsonb_typeof(p -> 'reranker' -> v_key) is distinct from 'string' or length(p -> 'reranker' ->> v_key) not between 1 and 200 then
      return format('reranker.%s mangler', v_key);
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p -> 'algorithmVersion') is distinct from 'string' or (p ->> 'algorithmVersion') !~ '^[a-z0-9][a-z0-9.-]{0,40}$' then
    return 'algoritmeversionen er ugyldig';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'params') is distinct from 'object'
     or knowledge.jsonb_keys(p -> 'params') <> array['candidateK', 'maxPerVersion', 'minScore', 'rerankN', 'rrfK', 'topK'] then
    return 'parametrene er ufuldstændige';
  end if;
  foreach v_key in array array['candidateK', 'maxPerVersion', 'rerankN', 'rrfK', 'topK'] loop
    if pg_catalog.jsonb_typeof(p -> 'params' -> v_key) is distinct from 'number'
       or (p -> 'params' ->> v_key)::numeric not between 1 and 1000
       or (p -> 'params' ->> v_key)::numeric <> pg_catalog.trunc((p -> 'params' ->> v_key)::numeric) then
      return format('parameteren %s er ugyldig', v_key);
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p #> '{params,minScore}') is distinct from 'number' or (p #>> '{params,minScore}')::numeric not between 0 and 1 then
    return 'parameteren minScore er ugyldig';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'chunkerVersions') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p -> 'chunkerVersions') = 0
     or exists (select 1 from pg_catalog.jsonb_array_elements(p -> 'chunkerVersions') e
                where pg_catalog.jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,99}$') then
    return 'chunker-versionerne er ugyldige';
  end if;
  return null;
end;
$$;

-- Udviklingsimplementeringer kan aldrig godkendes (docs/08b §3.4, §10.2): test-embedderen og
-- "none"-rerankeren.
create or replace function knowledge.retrieval_material_is_development(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p -> 'embedding' is null or pg_catalog.jsonb_typeof(p -> 'embedding') = 'null'
      or (p #>> '{embedding,provider}') = 'test'
      or (p #>> '{reranker,id}') = 'none'
      or (p #>> '{reranker,model}') = 'none'
$$;

-- ----------------------------------------------------------------------------
-- 3. Tabeller
-- ----------------------------------------------------------------------------

create table knowledge.evaluation_gate_sets (
  id uuid primary key default gen_random_uuid(),
  gate_set_id text not null check (gate_set_id ~ '^[a-z0-9][a-z0-9_-]{0,40}$'),
  version int not null check (version > 0),
  decision text not null check (decision ~ '^B-[0-9]{3}$'),
  k int not null check (k between 1 and 50),
  -- Gate-sættet som det blev indlæst (validateGateSet), og dets checksum (gateSetChecksum).
  definition jsonb not null,
  checksum text not null unique check (checksum ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz not null default now(),
  registered_by_role text not null,
  approved_at timestamptz,
  approved_by uuid,
  unique (gate_set_id, version),
  check ((approved_at is null) = (approved_by is null))
);

comment on table knowledge.evaluation_gate_sets is
  'Gate-sæt (Q1–Q7, docs/08b §4.4). Registreres af evaluation_publisher, godkendes af system.settings.manage og ændres aldrig.';

create table knowledge.retrieval_configurations (
  id uuid primary key default gen_random_uuid(),
  label text not null check (label ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'),
  version int not null check (version > 0),
  -- Det fingeraftrykte materiale (RetrievalFingerprintMaterial) — konfigurationens eneste
  -- definerende kilde. Kolonnerne nedenfor er afledt af det og kan ikke afvige.
  material jsonb not null,
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  embedding_model_id uuid not null references knowledge.embedding_models (id) on delete restrict,
  embedding_provider text generated always as (material #>> '{embedding,provider}') stored,
  embedding_model text generated always as (material #>> '{embedding,model}') stored,
  embedding_model_version text generated always as (material #>> '{embedding,modelVersion}') stored,
  embedding_dimensions int generated always as ((material #>> '{embedding,dimensions}')::int) stored,
  embedding_settings jsonb generated always as (material #> '{embedding,settings}') stored,
  embedding_processing jsonb generated always as (material #> '{embedding,processing}') stored,
  reranker_provider text generated always as (material #>> '{reranker,provider}') stored,
  reranker_id text generated always as (material #>> '{reranker,id}') stored,
  reranker_version text generated always as (material #>> '{reranker,version}') stored,
  reranker_model text generated always as (material #>> '{reranker,model}') stored,
  reranker_model_version text generated always as (material #>> '{reranker,modelVersion}') stored,
  reranker_settings jsonb generated always as (material #> '{reranker,settings}') stored,
  reranker_processing jsonb generated always as (material #> '{reranker,processing}') stored,
  algorithm_version text generated always as (material ->> 'algorithmVersion') stored,
  params jsonb generated always as (material -> 'params') stored,
  chunker_versions text[] generated always as (knowledge.jsonb_text_array(material -> 'chunkerVersions')) stored,
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'active', 'suspended', 'retired')),
  -- clock_timestamp: the order of registrations and status changes is real, also within one transaction.
  status_changed_at timestamptz not null default clock_timestamp(),
  -- Godkendelsen: den registrerede kørsel, dens gate-sæt og tier.
  approval_run_id uuid,
  gate_set_id uuid references knowledge.evaluation_gate_sets (id) on delete restrict,
  tier text check (tier in ('pilot', 'standard')),
  created_at timestamptz not null default now(),
  created_by_role text not null,
  approved_at timestamptz,
  approved_by uuid,
  activated_at timestamptz,
  activated_by uuid,
  suspended_at timestamptz,
  suspended_by uuid,
  suspension_reason text,
  suspension_run_id uuid,
  retired_at timestamptz,
  retired_by uuid,
  retirement_reason text,
  unique (label, version),
  check (status not in ('approved', 'active', 'suspended')
         or (approval_run_id is not null and gate_set_id is not null and tier is not null and approved_at is not null)),
  check (status <> 'active' or activated_at is not null),
  check (status <> 'suspended' or (suspended_at is not null and suspension_reason is not null)),
  check (status <> 'retired' or (retired_at is not null and retirement_reason is not null))
);

-- Højst én konfiguration i drift: aktiv eller suspenderet (docs/08b §10.1 "højst én active").
create unique index retrieval_configurations_one_in_service on knowledge.retrieval_configurations ((true))
  where status in ('active', 'suspended');

comment on table knowledge.retrieval_configurations is
  'Register over retrieval-konfigurationer (docs/08b §10). Uforanderligt materiale, status kun via funktionerne. Slettes aldrig.';

create table knowledge.evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references knowledge.retrieval_configurations (id) on delete restrict,
  gate_set_id uuid not null references knowledge.evaluation_gate_sets (id) on delete restrict,
  run_id text not null unique check (length(run_id) between 1 and 100),
  report_schema int not null,
  engine text not null,
  report_checksum text not null unique check (report_checksum ~ '^[0-9a-f]{64}$'),
  results_checksum text not null check (results_checksum ~ '^[0-9a-f]{64}$'),
  eval_set_id text not null,
  eval_set_version int not null,
  eval_set_checksum text not null check (eval_set_checksum ~ '^[0-9a-f]{64}$'),
  gate_set_checksum text not null check (gate_set_checksum ~ '^[0-9a-f]{64}$'),
  configuration_fingerprint text not null check (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  runtime_fingerprint text not null check (runtime_fingerprint ~ '^[0-9a-f]{64}$'),
  corpus_checksum text not null,
  evaluated_document_types text[] not null,
  environment text not null,
  active_cases int not null,
  cases_by_type jsonb not null,
  metrics jsonb not null,
  hard_gates jsonb not null,
  quality_gates jsonb not null,
  minimums jsonb not null,
  failures jsonb not null,
  hard_gates_passed boolean not null,
  quality_gates_passed boolean not null,
  minimums_met boolean not null,
  tier text not null check (tier in ('pilot', 'standard')),
  verdict text not null check (verdict in ('pass', 'fail', 'uncertain')),
  valid boolean not null,
  -- Bestået = afgørelsen er "pass" (alle hårde og kvalitetsgates bestået, ingen usikre), og
  -- kørslen er gyldig. "uncertain" er ikke bestået.
  passed boolean generated always as (verdict = 'pass' and valid and hard_gates_passed and quality_gates_passed and minimums_met) stored,
  -- Hele rapporten (formatet står i report_schema og engine), så kørslen kan efterprøves igen.
  report jsonb not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  registered_at timestamptz not null default clock_timestamp(),
  registered_by_role text not null
);

create index evaluation_runs_configuration on knowledge.evaluation_runs (configuration_id, registered_at desc);

alter table knowledge.retrieval_configurations
  add constraint retrieval_configurations_approval_run
  foreign key (approval_run_id) references knowledge.evaluation_runs (id) on delete restrict;
alter table knowledge.retrieval_configurations
  add constraint retrieval_configurations_suspension_run
  foreign key (suspension_run_id) references knowledge.evaluation_runs (id) on delete restrict;

comment on table knowledge.evaluation_runs is
  'Registrerede evalueringskørsler (docs/08b §10.1). Append-only, kun skrevet af evaluation_publisher via record_evaluation_run.';

create table knowledge.retrieval_configuration_transitions (
  id bigint generated always as identity primary key,
  configuration_id uuid not null references knowledge.retrieval_configurations (id) on delete restrict,
  from_status text,
  to_status text not null,
  run_id uuid references knowledge.evaluation_runs (id) on delete restrict,
  actor_id uuid,
  actor_role text not null,
  reason text,
  -- Årsagsnoter pr. fejl i godkendelseskørslen (pilot-regel 3), i rapportens rækkefølge.
  root_cause_notes jsonb,
  occurred_at timestamptz not null default now()
);

comment on table knowledge.retrieval_configuration_transitions is
  'Statushistorik for retrieval-konfigurationer. Append-only.';

-- ----------------------------------------------------------------------------
-- 4. Integritet: kun funktionerne skriver, intet ændres bagefter, tilstandsmaskinen holder.
--
-- Funktionerne sætter knowledge.registry_write transaktionslokalt. App-roller, service_role
-- og administratoren har ingen tabelrettigheder overhovedet. Triggerne holder invarianterne
-- også for tabellens ejer.
-- ----------------------------------------------------------------------------

create or replace function knowledge.registry_write_begin()
returns void
language sql
set search_path = ''
as $$ select pg_catalog.set_config('knowledge.registry_write', 'on', true) $$;

create or replace function knowledge.registry_write_end()
returns void
language sql
set search_path = ''
as $$ select pg_catalog.set_config('knowledge.registry_write', '', true) $$;

create or replace function knowledge.require_registry_write()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('knowledge.registry_write', true), '') <> 'on' then
    raise exception 'Registret ændres kun gennem dets funktioner' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function knowledge.check_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform knowledge.require_registry_write();
    return new;
  end if;
  raise exception '% kan ikke ændres eller slettes', tg_table_name using errcode = 'check_violation';
end;
$$;

create trigger evaluation_runs_append_only
  before insert or update or delete on knowledge.evaluation_runs
  for each row execute function knowledge.check_append_only();
create trigger retrieval_configuration_transitions_append_only
  before insert or update or delete on knowledge.retrieval_configuration_transitions
  for each row execute function knowledge.check_append_only();

create or replace function knowledge.check_gate_set_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Et gate-sæt slettes aldrig' using errcode = 'check_violation';
  end if;
  perform knowledge.require_registry_write();
  if tg_op = 'INSERT' then
    if new.approved_at is not null then
      raise exception 'Et gate-sæt registreres altid ugodkendt' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'approved_at' - 'approved_by') <> (to_jsonb(old) - 'approved_at' - 'approved_by')
     or old.approved_at is not null or new.approved_at is null then
    raise exception 'Et registreret gate-sæt kan ikke ændres — kun godkendes én gang' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger evaluation_gate_sets_write
  before insert or update or delete on knowledge.evaluation_gate_sets
  for each row execute function knowledge.check_gate_set_write();

-- De tilladte overgange (docs/08b §10.2). Alt andet afvises.
create or replace function knowledge.retrieval_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('candidate', 'approved'), ('candidate', 'retired'),
    ('approved', 'active'), ('approved', 'retired'),
    ('active', 'suspended'), ('active', 'retired'),
    ('suspended', 'retired'), ('suspended', 'approved'),
    ('retired', 'approved'))
$$;

-- Felter, der aldrig ændres efter oprettelsen (alt andet end status og statusfelterne).
create or replace function knowledge.retrieval_configuration_identity(p knowledge.retrieval_configurations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('id', p.id, 'label', p.label, 'version', p.version, 'material', p.material,
    'fingerprint', p.fingerprint, 'embedding_model_id', p.embedding_model_id, 'created_at', p.created_at,
    'created_by_role', p.created_by_role)
$$;

create or replace function knowledge.check_retrieval_configuration_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run knowledge.evaluation_runs;
begin
  if tg_op = 'DELETE' then
    raise exception 'En retrieval-konfiguration slettes aldrig (reproducerbarhed, docs/08b §11)' using errcode = 'check_violation';
  end if;
  perform knowledge.require_registry_write();

  if tg_op = 'INSERT' then
    if new.status <> 'candidate' then
      raise exception 'En konfiguration registreres altid som kandidat' using errcode = 'check_violation';
    end if;
    if knowledge.retrieval_material_problem(new.material) is not null then
      raise exception 'Ugyldigt materiale: %', knowledge.retrieval_material_problem(new.material) using errcode = 'check_violation';
    end if;
    if new.fingerprint <> knowledge.retrieval_fingerprint(new.material) then
      raise exception 'Fingeraftrykket stemmer ikke med materialet' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if knowledge.retrieval_configuration_identity(new) <> knowledge.retrieval_configuration_identity(old) then
    raise exception 'En konfiguration ændres aldrig — en ændring er en ny konfiguration (docs/08b §10.2)' using errcode = 'check_violation';
  end if;
  if new.status = old.status or not knowledge.retrieval_transition_allowed(old.status, new.status) then
    raise exception 'Overgangen % → % er ikke tilladt', old.status, new.status using errcode = 'check_violation';
  end if;
  if new.status in ('approved', 'active') then
    select * into v_run from knowledge.evaluation_runs where id = new.approval_run_id;
    if v_run.id is null or v_run.configuration_id <> new.id or not v_run.passed
       or v_run.configuration_fingerprint <> new.fingerprint or v_run.runtime_fingerprint <> new.fingerprint
       or v_run.gate_set_id <> new.gate_set_id or v_run.tier <> new.tier then
      raise exception 'En godkendt konfiguration kræver en bestået, registreret kørsel af netop den konfiguration'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger retrieval_configurations_write
  before insert or update or delete on knowledge.retrieval_configurations
  for each row execute function knowledge.check_retrieval_configuration_write();

-- Ingen kan tømme registret.
create or replace function knowledge.refuse_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% kan ikke tømmes', tg_table_name using errcode = 'check_violation';
end;
$$;

create trigger retrieval_configurations_no_truncate before truncate on knowledge.retrieval_configurations
  for each statement execute function knowledge.refuse_truncate();
create trigger evaluation_runs_no_truncate before truncate on knowledge.evaluation_runs
  for each statement execute function knowledge.refuse_truncate();
create trigger evaluation_gate_sets_no_truncate before truncate on knowledge.evaluation_gate_sets
  for each statement execute function knowledge.refuse_truncate();
create trigger retrieval_configuration_transitions_no_truncate before truncate on knowledge.retrieval_configuration_transitions
  for each statement execute function knowledge.refuse_truncate();

-- ----------------------------------------------------------------------------
-- 5. Genberegning af en rapport (spejler evals/engine/publication.ts verifyReport og
--    gates.ts). Metrics genberegnes fra observationerne, gates fra metrics og gate-sættet,
--    afgørelsen fra gates. Tal sammenlignes med en tolerance på 1e-9 (afrunding), tællinger
--    og status eksakt.
-- ----------------------------------------------------------------------------

create or replace function knowledge.eval_close(p_reported jsonb, p_value double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then p_reported is null or pg_catalog.jsonb_typeof(p_reported) = 'null'
    when pg_catalog.jsonb_typeof(p_reported) is distinct from 'number' then false
    else abs((p_reported #>> '{}')::double precision - p_value) <= 1e-9
  end
$$;

-- Wilson 95 %-interval (metrics.ts wilson). Null for n = 0.
create or replace function knowledge.eval_wilson(p_successes int, p_n int)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  z constant double precision := 1.959963984540054;
  p double precision;
  z2 double precision := z * z;
  n double precision := p_n;
  denominator double precision;
  center double precision;
  half double precision;
begin
  if p_n = 0 then return null; end if;
  p := p_successes::double precision / n;
  denominator := 1 + z2 / n;
  center := (p + z2 / (2 * n)) / denominator;
  half := (z * sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return pg_catalog.jsonb_build_object(
    'lower', case when p_successes = 0 then 0 else greatest(0, center - half) end,
    'upper', case when p_successes = p_n then 1 else least(1, center + half) end);
end;
$$;

create or replace function knowledge.eval_metric_matches(p_reported jsonb, p_value double precision, p_numerator int, p_denominator int, p_interval jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_reported) = 'object'
    and knowledge.eval_close(p_reported -> 'value', p_value)
    and (p_reported -> 'numerator') is not distinct from case when p_numerator is null then 'null'::jsonb else pg_catalog.to_jsonb(p_numerator) end
    and (p_reported -> 'denominator') = pg_catalog.to_jsonb(p_denominator)
    and case
      when p_interval is null then (p_reported -> 'interval') = 'null'::jsonb
      else pg_catalog.jsonb_typeof(p_reported -> 'interval') = 'object'
        and knowledge.eval_close(p_reported #> '{interval,lower}', (p_interval ->> 'lower')::double precision)
        and knowledge.eval_close(p_reported #> '{interval,upper}', (p_interval ->> 'upper')::double precision)
    end
$$;

-- Returnerer en liste af problemer (tom = rapporten stemmer). Antager et valideret gate-sæt.
create or replace function knowledge.eval_report_problems(p_report jsonb, p_gates jsonb)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_cases jsonb := p_report -> 'cases';
  v_metrics jsonb := p_report -> 'metrics';
  v_answerable int;
  v_abstaining int;
  v_distractor int;
  v_n int;
  v_num int;
  v_mrr double precision;
  v_intrusions int;
  v_returned int;
  v_errors int;
  v_hard jsonb;
  v_quality jsonb := '[]'::jsonb;
  v_minimums jsonb;
  v_hard_passed boolean;
  v_quality_passed boolean;
  v_any_uncertain boolean;
  v_minimums_met boolean;
  v_valid boolean;
  v_verdict text;
  v_gate text;
  v_spec jsonb;
  v_metric jsonb;
  v_value double precision;
  v_threshold double precision;
  v_ok boolean;
  v_uncertain boolean;
  v_on_recall double precision;
  v_on_mrr double precision;
  v_off_recall double precision;
  v_off_mrr double precision;
  v_reported jsonb;
  v_case_violations int;
  v_run_violations int;
  v_reported_hard int;
begin
  if pg_catalog.jsonb_typeof(v_cases) is distinct from 'array' or pg_catalog.jsonb_typeof(v_metrics) is distinct from 'object' then
    return array['rapporten mangler observationer eller metrics'];
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_cases) o
             where pg_catalog.jsonb_typeof(o) <> 'object'
                or (o ->> 'outcome') not in ('evidence', 'insufficient')
                or (o ->> 'type') not in ('direct', 'multi_chunk', 'historical', 'conflict', 'unanswerable', 'distractor', 'permission', 'filter')
                or pg_catalog.jsonb_typeof(o -> 'empty') <> 'boolean'
                or pg_catalog.jsonb_typeof(o -> 'requiredCovered') <> 'number' or pg_catalog.jsonb_typeof(o -> 'requiredTotal') <> 'number'
                or pg_catalog.jsonb_typeof(o -> 'distractorItems') <> 'number' or pg_catalog.jsonb_typeof(o -> 'itemsWithinK') <> 'number'
                or pg_catalog.jsonb_typeof(o -> 'violations') <> 'array'
                or pg_catalog.jsonb_typeof(o -> 'sourceRank') not in ('number', 'null')
                or pg_catalog.jsonb_typeof(o -> 'firstGrade3Rank') not in ('number', 'null')
                or (pg_catalog.jsonb_typeof(o -> 'firstGrade3Rank') = 'number' and (o ->> 'firstGrade3Rank')::numeric < 1)
                or pg_catalog.jsonb_typeof(o -> 'error') not in ('string', 'null')) then
    return array['en observation har ikke den forventede form'];
  end if;

  -- Metrics (metrics.ts computeMetrics), de gatede seks.
  select count(*) filter (where o ->> 'outcome' = 'evidence'),
         count(*) filter (where o ->> 'outcome' = 'insufficient'),
         count(*) filter (where o ->> 'type' = 'distractor'),
         count(*) filter (where pg_catalog.jsonb_typeof(o -> 'error') = 'string')
  into v_answerable, v_abstaining, v_distractor, v_errors
  from pg_catalog.jsonb_array_elements(v_cases) o;

  select count(*) into v_num from pg_catalog.jsonb_array_elements(v_cases) o
  where o ->> 'outcome' = 'evidence' and pg_catalog.jsonb_typeof(o -> 'sourceRank') = 'number';
  if not knowledge.eval_metric_matches(v_metrics -> 'source_recall_at_k', case when v_answerable = 0 then null else v_num::double precision / v_answerable end,
                                       v_num, v_answerable, knowledge.eval_wilson(v_num, v_answerable)) then
    v_problems := array_append(v_problems, 'Source Recall kan ikke genberegnes');
  end if;

  select count(*) into v_num from pg_catalog.jsonb_array_elements(v_cases) o
  where o ->> 'outcome' = 'evidence' and (o ->> 'requiredTotal')::int > 0 and (o ->> 'requiredCovered')::int = (o ->> 'requiredTotal')::int;
  if not knowledge.eval_metric_matches(v_metrics -> 'passage_recall_at_k', case when v_answerable = 0 then null else v_num::double precision / v_answerable end,
                                       v_num, v_answerable, knowledge.eval_wilson(v_num, v_answerable)) then
    v_problems := array_append(v_problems, 'Passage Recall kan ikke genberegnes');
  end if;

  select sum(case when pg_catalog.jsonb_typeof(o -> 'firstGrade3Rank') = 'number' then 1 / (o ->> 'firstGrade3Rank')::double precision else 0 end)
  into v_mrr from pg_catalog.jsonb_array_elements(v_cases) o where o ->> 'outcome' = 'evidence';
  if not knowledge.eval_metric_matches(v_metrics -> 'mrr_at_k', case when v_answerable = 0 then null else v_mrr / v_answerable end,
                                       null, v_answerable, null) then
    v_problems := array_append(v_problems, 'MRR kan ikke genberegnes');
  end if;

  select count(*) into v_num from pg_catalog.jsonb_array_elements(v_cases) o
  where o ->> 'outcome' = 'insufficient' and (o -> 'empty') = 'true'::jsonb;
  if not knowledge.eval_metric_matches(v_metrics -> 'correct_abstention', case when v_abstaining = 0 then null else v_num::double precision / v_abstaining end,
                                       v_num, v_abstaining, knowledge.eval_wilson(v_num, v_abstaining)) then
    v_problems := array_append(v_problems, 'Korrekt afvisning kan ikke genberegnes');
  end if;

  select count(*) into v_num from pg_catalog.jsonb_array_elements(v_cases) o
  where o ->> 'outcome' = 'evidence' and (o -> 'empty') = 'true'::jsonb;
  if not knowledge.eval_metric_matches(v_metrics -> 'false_abstention', case when v_answerable = 0 then null else v_num::double precision / v_answerable end,
                                       v_num, v_answerable, knowledge.eval_wilson(v_num, v_answerable)) then
    v_problems := array_append(v_problems, 'Falsk afvisning kan ikke genberegnes');
  end if;

  select coalesce(sum((o ->> 'distractorItems')::int), 0), coalesce(sum((o ->> 'itemsWithinK')::int), 0)
  into v_intrusions, v_returned from pg_catalog.jsonb_array_elements(v_cases) o where o ->> 'type' = 'distractor';
  if v_intrusions < 0 or v_returned < 0 or v_intrusions > v_returned then
    v_problems := array_append(v_problems, 'Distraktor-tællingerne er umulige');
  elsif v_distractor = 0 then
    if not knowledge.eval_metric_matches(v_metrics -> 'distractor_intrusion', null, 0, 0, null) then
      v_problems := array_append(v_problems, 'Distraktor-indtrængen kan ikke genberegnes');
    end if;
  elsif not knowledge.eval_metric_matches(v_metrics -> 'distractor_intrusion', case when v_returned = 0 then 0 else v_intrusions::double precision / v_returned end,
                                          v_intrusions, v_returned, knowledge.eval_wilson(v_intrusions, v_returned)) then
    v_problems := array_append(v_problems, 'Distraktor-indtrængen kan ikke genberegnes');
  end if;

  -- Sammenligningen med kørslen uden reranker bruger metrikkernes egne tal (Q7).
  if not knowledge.eval_close(p_report #> '{rerankerComparison,withReranker,passage_recall_at_k}', (v_metrics #>> '{passage_recall_at_k,value}')::double precision)
     or not knowledge.eval_close(p_report #> '{rerankerComparison,withReranker,mrr_at_k}', (v_metrics #>> '{mrr_at_k,value}')::double precision) then
    v_problems := array_append(v_problems, 'Sammenligningen uden reranker bruger andre tal end metrikkerne');
  end if;

  -- Hårde gates H1–H7 (gates.ts evaluateHardGates): nul tolerance. Brud pr. spørgsmål og på
  -- kørselsniveau (fejl uden spørgsmål).
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g, 'status', case when n > 0 then 'fail' else 'pass' end, 'violations', n) order by g)
  into v_hard
  from (
    select g, (select count(*) from pg_catalog.jsonb_array_elements(v_cases) o, pg_catalog.jsonb_array_elements(o -> 'violations') v where v ->> 'gate' = g)
            + (select count(*) from pg_catalog.jsonb_array_elements(p_report -> 'failures') f
               where f ->> 'gate' = g and pg_catalog.jsonb_typeof(f -> 'caseId') = 'null') as n
    from unnest(array['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']) g
  ) counts;
  if v_hard is distinct from (p_report -> 'hardGates') then
    v_problems := array_append(v_problems, 'De hårde gates kan ikke genberegnes');
  end if;
  select count(*) into v_case_violations from pg_catalog.jsonb_array_elements(v_cases) o, pg_catalog.jsonb_array_elements(o -> 'violations') v;
  select count(*) filter (where pg_catalog.jsonb_typeof(f -> 'caseId') = 'null' and f ->> 'gate' ~ '^H[1-7]$'),
         count(*) filter (where f ->> 'gate' ~ '^H[1-7]$')
  into v_run_violations, v_reported_hard
  from pg_catalog.jsonb_array_elements(p_report -> 'failures') f;
  if v_reported_hard <> v_case_violations + v_run_violations then
    v_problems := array_append(v_problems, 'Bruddene på de hårde gates stemmer ikke med observationerne');
  end if;
  v_hard_passed := not exists (select 1 from pg_catalog.jsonb_array_elements(v_hard) h where h ->> 'status' <> 'pass');

  -- Kvalitetsgates Q1–Q7 mod netop dette gate-sæt (gates.ts evaluateQualityGates).
  foreach v_gate in array array['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'] loop
    v_spec := p_gates -> 'quality' -> v_gate;
    v_uncertain := false;
    v_threshold := null;
    if v_spec ->> 'comparator' = 'not_lower' then
      v_on_recall := (p_report #>> '{rerankerComparison,withReranker,passage_recall_at_k}')::double precision;
      v_on_mrr := (p_report #>> '{rerankerComparison,withReranker,mrr_at_k}')::double precision;
      v_off_recall := (p_report #>> '{rerankerComparison,withoutReranker,passage_recall_at_k}')::double precision;
      v_off_mrr := (p_report #>> '{rerankerComparison,withoutReranker,mrr_at_k}')::double precision;
      if (p_report #> '{rerankerComparison,available}') is distinct from 'true'::jsonb
         or v_on_recall is null or v_on_mrr is null or v_off_recall is null or v_off_mrr is null then
        v_value := null;
        v_ok := false;
      else
        v_value := least(v_on_recall - v_off_recall, v_on_mrr - v_off_mrr);
        v_ok := v_on_recall - v_off_recall >= -1e-9 and v_on_mrr - v_off_mrr >= -1e-9;
      end if;
    else
      v_metric := v_metrics -> (v_spec ->> 'metric');
      v_threshold := (v_spec ->> 'threshold')::double precision;
      v_value := (v_metric ->> 'value')::double precision;
      if v_value is null or v_threshold is null then
        v_ok := false;
        v_value := null;
      else
        v_ok := case when v_spec ->> 'comparator' = '>=' then v_value >= v_threshold - 1e-9 else v_value <= v_threshold + 1e-9 end;
        v_uncertain := pg_catalog.jsonb_typeof(v_metric -> 'interval') = 'object'
          and case when v_spec ->> 'comparator' = '>=' then (v_metric #>> '{interval,lower}')::double precision < v_threshold
                   else (v_metric #>> '{interval,upper}')::double precision > v_threshold end;
      end if;
    end if;
    select r into v_reported from pg_catalog.jsonb_array_elements(p_report -> 'qualityGates') r where r ->> 'id' = v_gate;
    if v_reported is null
       or (v_reported ->> 'metric') is distinct from (v_spec ->> 'metric')
       or (v_reported ->> 'comparator') is distinct from (v_spec ->> 'comparator')
       or not knowledge.eval_close(v_reported -> 'threshold', v_threshold)
       or not knowledge.eval_close(v_reported -> 'value', v_value)
       or (v_reported ->> 'status') is distinct from (case when v_ok then 'pass' else 'fail' end)
       or (v_reported -> 'uncertain') is distinct from pg_catalog.to_jsonb(v_uncertain) then
      v_problems := array_append(v_problems, format('Kvalitetsgate %s kan ikke genberegnes med gate-sættet', v_gate));
    end if;
    v_quality := v_quality || pg_catalog.jsonb_build_object('id', v_gate, 'ok', v_ok, 'uncertain', v_uncertain);
  end loop;
  if pg_catalog.jsonb_array_length(coalesce(p_report -> 'qualityGates', '[]'::jsonb)) <> 7 then
    v_problems := array_append(v_problems, 'Rapporten har ikke præcis Q1–Q7');
  end if;
  v_quality_passed := not exists (select 1 from pg_catalog.jsonb_array_elements(v_quality) q where q -> 'ok' <> 'true'::jsonb);
  v_any_uncertain := exists (select 1 from pg_catalog.jsonb_array_elements(v_quality) q where q -> 'uncertain' = 'true'::jsonb);

  -- Minimum pr. type (gates.ts TYPE_MINIMUMS — låst i koden, pilot-regel 2).
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('minimum', m.minimum, 'actual', m.actual, 'met', m.actual >= m.minimum) order by m.ord)
  into v_minimums
  from (
    select r.ord, r.minimum,
           (select count(*)::int from pg_catalog.jsonb_array_elements(v_cases) o where o ->> 'type' = any (r.types)) as actual
    from (values (1, array['direct', 'multi_chunk'], 20), (2, array['unanswerable'], 5), (3, array['historical'], 3),
                 (4, array['conflict'], 2), (5, array['distractor'], 3), (6, array['permission', 'filter'], 3)) as r(ord, types, minimum)
  ) m;
  if pg_catalog.jsonb_typeof(p_report -> 'minimums') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_report -> 'minimums') <> 6
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_report -> 'minimums') with ordinality r(e, i)
       join pg_catalog.jsonb_array_elements(v_minimums) with ordinality c(e, i) on c.i = r.i
       where (r.e -> 'minimum') <> (c.e -> 'minimum') or (r.e -> 'actual') <> (c.e -> 'actual') or (r.e -> 'met') <> (c.e -> 'met')) then
    v_problems := array_append(v_problems, 'Minimum pr. type kan ikke genberegnes');
  end if;
  v_minimums_met := not exists (select 1 from pg_catalog.jsonb_array_elements(v_minimums) m where m -> 'met' <> 'true'::jsonb);

  -- Antal, typer og tier.
  v_n := pg_catalog.jsonb_array_length(v_cases);
  if (p_report #> '{evalSet,activeCases}') is distinct from pg_catalog.to_jsonb(v_n) then
    v_problems := array_append(v_problems, 'Antallet af spørgsmål stemmer ikke med observationerne');
  end if;
  if (p_report ->> 'tier') is distinct from (case when v_n < 100 then 'pilot' else 'standard' end) then
    v_problems := array_append(v_problems, 'Tier stemmer ikke med antallet af spørgsmål');
  end if;
  if exists (
    select 1 from unnest(array['direct', 'multi_chunk', 'historical', 'conflict', 'unanswerable', 'distractor', 'permission', 'filter']) t
    where (p_report #> array['evalSet', 'byType', t]) is distinct from
          pg_catalog.to_jsonb((select count(*)::int from pg_catalog.jsonb_array_elements(v_cases) o where o ->> 'type' = t))) then
    v_problems := array_append(v_problems, 'Antal pr. type stemmer ikke med observationerne');
  end if;

  -- Afgørelsen (gates.ts decide): hårde gates først, så gyldighed, så kvalitet.
  v_valid := v_minimums_met and v_errors = 0
    and not exists (select 1 from pg_catalog.jsonb_array_elements(v_hard) h where h ->> 'id' in ('H6', 'H7') and h ->> 'status' <> 'pass');
  v_verdict := case when not v_hard_passed or not v_valid or not v_quality_passed then 'fail'
                    when v_any_uncertain then 'uncertain' else 'pass' end;
  if (p_report -> 'valid') is distinct from pg_catalog.to_jsonb(v_valid) or (p_report ->> 'verdict') is distinct from v_verdict then
    v_problems := array_append(v_problems, format('Afgørelsen stemmer ikke: rapporten siger "%s", genberegnet "%s"', p_report ->> 'verdict', v_verdict));
  end if;
  return v_problems;
end;
$$;

-- Gate-sættets form (schema.ts validateGateSet). Metrik og retning er låst i koden.
create or replace function knowledge.gate_set_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_gate record;
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object'
     or not (knowledge.jsonb_keys(p) = array['decision', 'id', 'k', 'quality', 'version']
             or knowledge.jsonb_keys(p) = array['decision', 'description', 'id', 'k', 'quality', 'version']) then
    return 'gate-sættet har ikke de forventede felter';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'id') <> 'string' or (p ->> 'id') !~ '^[a-z0-9][a-z0-9_-]{0,40}$'
     or pg_catalog.jsonb_typeof(p -> 'version') <> 'number' or (p ->> 'version')::numeric < 1 or (p ->> 'version')::numeric <> pg_catalog.trunc((p ->> 'version')::numeric)
     or pg_catalog.jsonb_typeof(p -> 'decision') <> 'string' or (p ->> 'decision') !~ '^B-[0-9]{3}$'
     or pg_catalog.jsonb_typeof(p -> 'k') <> 'number' or (p ->> 'k')::numeric not between 1 and 50 or (p ->> 'k')::numeric <> pg_catalog.trunc((p ->> 'k')::numeric)
     or (p ? 'description' and pg_catalog.jsonb_typeof(p -> 'description') <> 'string') then
    return 'gate-sættets id, version, beslutning eller k er ugyldig';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'quality') <> 'object' or knowledge.jsonb_keys(p -> 'quality') <> array['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'] then
    return 'gate-sættet har ikke præcis Q1–Q7';
  end if;
  for v_gate in
    select * from (values ('Q1', 'source_recall_at_k', '>='), ('Q2', 'passage_recall_at_k', '>='), ('Q3', 'mrr_at_k', '>='),
                          ('Q4', 'correct_abstention', '>='), ('Q5', 'false_abstention', '<='), ('Q6', 'distractor_intrusion', '<='),
                          ('Q7', 'reranker_uplift', 'not_lower')) as g(id, metric, comparator)
  loop
    if (p #>> array['quality', v_gate.id, 'metric']) is distinct from v_gate.metric
       or (p #>> array['quality', v_gate.id, 'comparator']) is distinct from v_gate.comparator then
      return format('%s har ikke den låste metrik og retning', v_gate.id);
    end if;
    if v_gate.comparator = 'not_lower' then
      if knowledge.jsonb_keys(p -> 'quality' -> v_gate.id) <> array['comparator', 'metric'] then
        return format('%s har ingen tærskel', v_gate.id);
      end if;
    elsif knowledge.jsonb_keys(p -> 'quality' -> v_gate.id) <> array['comparator', 'metric', 'threshold']
       or pg_catalog.jsonb_typeof(p #> array['quality', v_gate.id, 'threshold']) <> 'number'
       or (p #>> array['quality', v_gate.id, 'threshold'])::numeric not between 0 and 1 then
      return format('%s har en ugyldig tærskel', v_gate.id);
    end if;
  end loop;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Publisherens funktioner (evaluation_publisher, D-18)
-- ----------------------------------------------------------------------------

create or replace function knowledge.registry_refuse(p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Afvist (%): %', p_code, p_message using errcode = 'check_violation';
end;
$$;

-- Registrerer et gate-sæt (ugodkendt). Idempotent på checksum.
create or replace function knowledge.register_evaluation_gate_set(p_gate_set jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := knowledge.assert_publisher_caller();
  v_problem text := knowledge.gate_set_problem(p_gate_set);
  v_checksum text;
  v_id uuid;
begin
  if v_problem is not null then
    perform knowledge.registry_refuse('gate_set', v_problem);
  end if;
  v_checksum := knowledge.checksum_of(p_gate_set);
  select id into v_id from knowledge.evaluation_gate_sets where checksum = v_checksum;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from knowledge.evaluation_gate_sets where gate_set_id = p_gate_set ->> 'id' and version = (p_gate_set ->> 'version')::int) then
    perform knowledge.registry_refuse('gate_set', 'en anden version af gate-sættet er allerede registreret med samme id og version — en ændring kræver en ny version');
  end if;
  perform knowledge.registry_write_begin();
  insert into knowledge.evaluation_gate_sets (gate_set_id, version, decision, k, definition, checksum, registered_by_role)
  values (p_gate_set ->> 'id', (p_gate_set ->> 'version')::int, p_gate_set ->> 'decision', (p_gate_set ->> 'k')::int, p_gate_set, v_checksum, v_role)
  returning id into v_id;
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.evaluation_gate_set.registered', 'evaluation_gate_sets', v_id::text,
    pg_catalog.jsonb_build_object('gate_set', p_gate_set ->> 'id', 'version', (p_gate_set ->> 'version')::int, 'checksum', v_checksum, 'db_role', v_role));
  return v_id;
end;
$$;

-- Intern suspendering (D-8): kaldes af record_evaluation_run ved en fejlet hård gate og af
-- suspend_retrieval_configuration. Ingen rolle har EXECUTE på den.
create or replace function knowledge.suspend_retrieval_configuration_internal(p_configuration_id uuid, p_reason text, p_run_id uuid, p_actor_role text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_cfg knowledge.retrieval_configurations;
begin
  select * into v_cfg from knowledge.retrieval_configurations where id = p_configuration_id for update;
  if v_cfg.id is null or v_cfg.status <> 'active' then
    perform knowledge.registry_refuse('not_active', 'kun den aktive konfiguration kan suspenderes');
  end if;
  perform knowledge.registry_write_begin();
  update knowledge.retrieval_configurations
  set status = 'suspended', status_changed_at = pg_catalog.clock_timestamp(), suspended_at = now(), suspended_by = identity.current_user_id(),
      suspension_reason = p_reason, suspension_run_id = p_run_id
  where id = p_configuration_id;
  insert into knowledge.retrieval_configuration_transitions (configuration_id, from_status, to_status, run_id, actor_id, actor_role, reason)
  values (p_configuration_id, 'active', 'suspended', p_run_id, identity.current_user_id(), p_actor_role, p_reason);
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.retrieval_configuration.suspended', 'retrieval_configurations', p_configuration_id::text,
    pg_catalog.jsonb_build_object('fingerprint', v_cfg.fingerprint, 'reason', p_reason, 'run_id', p_run_id, 'db_role', p_actor_role));
end;
$$;

-- Registrerer en evalueringskørsel (docs/08b §4.5, §10.1). Genberegner alt fra rapporten.
-- Konfigurationen oprettes som kandidat, hvis den ikke findes. En kørsel, der ikke er gyldig
-- som dokumentation (H7, eller H6 for en konfiguration, der ikke er i drift), afvises. En
-- fejlet hård gate for den aktive konfiguration suspenderer den i samme transaktion (D-8).
create or replace function knowledge.record_evaluation_run(p_report jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := knowledge.assert_publisher_caller();
  v_body jsonb;
  v_results jsonb;
  v_checksum text;
  v_declared jsonb;
  v_runtime jsonb;
  v_declared_fp text;
  v_runtime_fp text;
  v_problem text;
  v_problems text[];
  v_gate knowledge.evaluation_gate_sets;
  v_model_id uuid;
  v_cfg knowledge.retrieval_configurations;
  v_doc_types text[];
  v_hard_passed boolean;
  v_h6 boolean;
  v_h7 boolean;
  v_quality_passed boolean;
  v_minimums_met boolean;
  v_run_id uuid;
begin
  -- Form og version (runner.ts EvaluationReport).
  if pg_catalog.jsonb_typeof(p_report) is distinct from 'object'
     or (p_report -> 'reportSchema') is distinct from '3'::jsonb
     or (p_report ->> 'kind') is distinct from 'retrieval-evaluation'
     or coalesce(p_report ->> 'engine', '') !~ '^8B-I[0-9.]+/[0-9]+$' then
    perform knowledge.registry_refuse('format', 'rapporten har ikke det understøttede format (reportSchema 3)');
  end if;
  if exists (select 1 from unnest(array['runId', 'startedAt', 'finishedAt', 'evalSet', 'gateSet', 'configuration', 'corpus', 'metrics',
                                        'rerankerComparison', 'hardGates', 'qualityGates', 'minimums', 'tier', 'verdict', 'valid',
                                        'invalidReasons', 'failures', 'cases', 'production', 'checksums']) k
             where not p_report ? k) then
    perform knowledge.registry_refuse('format', 'rapporten mangler felter');
  end if;

  -- Checksums: rapporten og resultaterne er uændrede siden kørslen.
  v_body := (p_report - 'checksums') || pg_catalog.jsonb_build_object('checksums', pg_catalog.jsonb_build_object('results', p_report #> '{checksums,results}'));
  if knowledge.checksum_of(v_body) is distinct from (p_report #>> '{checksums,report}') then
    perform knowledge.registry_refuse('report_checksum', 'rapportens checksum stemmer ikke med indholdet');
  end if;
  v_results := pg_catalog.jsonb_build_object(
    'metrics', p_report -> 'metrics', 'rerankerComparison', p_report -> 'rerankerComparison', 'hardGates', p_report -> 'hardGates',
    'qualityGates', p_report -> 'qualityGates', 'minimums', p_report -> 'minimums', 'tier', p_report -> 'tier', 'verdict', p_report -> 'verdict',
    'valid', p_report -> 'valid', 'invalidReasons', p_report -> 'invalidReasons', 'failures', p_report -> 'failures', 'cases', p_report -> 'cases');
  if knowledge.checksum_of(v_results) is distinct from (p_report #>> '{checksums,results}') then
    perform knowledge.registry_refuse('results_checksum', 'resultaternes checksum stemmer ikke');
  end if;
  v_checksum := p_report #>> '{checksums,report}';
  if exists (select 1 from knowledge.evaluation_runs where report_checksum = v_checksum or run_id = p_report ->> 'runId') then
    perform knowledge.registry_refuse('duplicate', 'kørslen er allerede registreret');
  end if;

  -- En rapport erklærer aldrig sig selv production-egnet. Kun registreringen og en menneskelig
  -- godkendelse kan føre til en aktiv konfiguration.
  if (p_report #> '{production,eligible}') is distinct from 'false'::jsonb then
    perform knowledge.registry_refuse('self_certified', 'en rapport kan ikke selv erklære sig production-egnet');
  end if;

  -- Konfigurationen: fingeraftryk genberegnet fra materialet, erklæret og runtime.
  v_declared := p_report #> '{configuration,declared}';
  v_runtime := p_report #> '{configuration,runtime}';
  v_problem := knowledge.retrieval_material_problem(v_declared);
  if v_problem is not null then
    perform knowledge.registry_refuse('configuration', v_problem);
  end if;
  if knowledge.retrieval_material_problem(v_runtime) is not null then
    perform knowledge.registry_refuse('configuration', 'runtime-konfigurationen er ufuldstændig');
  end if;
  v_declared_fp := knowledge.retrieval_fingerprint(v_declared);
  v_runtime_fp := knowledge.retrieval_fingerprint(v_runtime);
  if v_declared_fp is distinct from (p_report #>> '{configuration,declaredFingerprint}')
     or v_runtime_fp is distinct from (p_report #>> '{configuration,runtimeFingerprint}')
     or (p_report #> '{configuration,matches}') is distinct from pg_catalog.to_jsonb(v_declared_fp = v_runtime_fp) then
    perform knowledge.registry_refuse('fingerprint', 'fingeraftrykkene kan ikke genberegnes fra konfigurationen');
  end if;
  if knowledge.retrieval_material_is_development(v_declared) then
    perform knowledge.registry_refuse('development', 'en konfiguration med test-embedderen eller "none"-rerankeren kan ikke registreres');
  end if;

  -- Gate-sættet skal være registreret og godkendt.
  select * into v_gate from knowledge.evaluation_gate_sets where checksum = p_report #>> '{gateSet,checksum}';
  if v_gate.id is null or v_gate.approved_at is null then
    perform knowledge.registry_refuse('gate_set', 'gate-sættet er ikke registreret og godkendt');
  end if;
  if (p_report #>> '{gateSet,id}') is distinct from v_gate.gate_set_id or (p_report #> '{gateSet,version}') is distinct from pg_catalog.to_jsonb(v_gate.version)
     or (p_report #>> '{gateSet,decision}') is distinct from v_gate.decision or (p_report #> '{gateSet,k}') is distinct from pg_catalog.to_jsonb(v_gate.k) then
    perform knowledge.registry_refuse('gate_set', 'rapporten beskriver gate-sættet anderledes end registret');
  end if;

  -- Korpusset: uændret under kørslen, og de evaluerede dokumenttyper (pilot-scope).
  if (p_report #>> '{corpus,checksumBefore}') is null or (p_report #>> '{corpus,checksumBefore}') is distinct from (p_report #>> '{corpus,checksumAfter}') then
    perform knowledge.registry_refuse('corpus', 'korpussets checksum ændrede sig under kørslen');
  end if;
  v_doc_types := knowledge.jsonb_text_array(p_report #> '{corpus,documentTypes}');
  if v_doc_types is null or cardinality(v_doc_types) = 0
     or v_doc_types <> (select array_agg(t order by t collate "C") from (select distinct t from unnest(v_doc_types) t) d)
     or exists (select 1 from unnest(v_doc_types) t where not exists (select 1 from knowledge.document_types d where d.key = t)) then
    perform knowledge.registry_refuse('corpus', 'de evaluerede dokumenttyper er ugyldige');
  end if;

  -- Metrics, gates, minimum, tier og afgørelse genberegnes.
  v_problems := knowledge.eval_report_problems(p_report, v_gate.definition);
  if cardinality(v_problems) > 0 then
    perform knowledge.registry_refuse('recomputation', array_to_string(v_problems, '; '));
  end if;
  v_hard_passed := not exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'hardGates') h where h ->> 'status' <> 'pass');
  v_h6 := exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'hardGates') h where h ->> 'id' = 'H6' and h ->> 'status' = 'pass');
  v_h7 := exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'hardGates') h where h ->> 'id' = 'H7' and h ->> 'status' = 'pass');
  v_quality_passed := not exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'qualityGates') q where q ->> 'status' <> 'pass');
  v_minimums_met := not exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'minimums') m where m -> 'met' <> 'true'::jsonb);

  -- H7: kørslen er ikke fra evalueringsmiljøet eller ikke reproducerbar. Den kan ikke
  -- registreres (docs/08b §4.4).
  if not v_h7 or (p_report #>> '{configuration,environment}') is distinct from 'evaluation' then
    perform knowledge.registry_refuse('invalid_run', 'kørslen er ikke foretaget isoleret i evalueringsmiljøet (H7)');
  end if;

  select * into v_cfg from knowledge.retrieval_configurations where fingerprint = v_declared_fp for update;
  -- H6: kørslen dokumenterer ikke den konfiguration, den nævner. Den kan kun registreres som
  -- regression for den aktive konfiguration (og suspenderer den), ellers afvises den.
  if not v_h6 and (v_cfg.id is null or v_cfg.status <> 'active') then
    perform knowledge.registry_refuse('invalid_run', 'kørslen dokumenterer ikke den evaluerede konfiguration (H6)');
  end if;

  perform knowledge.registry_write_begin();
  if v_cfg.id is null then
    select m.id into v_model_id from knowledge.embedding_models m
    where m.provider = v_declared #>> '{embedding,provider}' and m.model_name = v_declared #>> '{embedding,model}'
      and m.model_version = v_declared #>> '{embedding,modelVersion}' and m.dimensions = (v_declared #>> '{embedding,dimensions}')::int;
    if v_model_id is null then
      perform knowledge.registry_refuse('model', 'embedding-modellen findes ikke i knowledge.embedding_models');
    end if;
    insert into knowledge.retrieval_configurations (label, version, material, fingerprint, embedding_model_id, created_by_role)
    values (p_report #>> '{configuration,label}',
            coalesce((select max(version) from knowledge.retrieval_configurations where label = p_report #>> '{configuration,label}'), 0) + 1,
            v_declared, v_declared_fp, v_model_id, v_role)
    returning * into v_cfg;
    insert into knowledge.retrieval_configuration_transitions (configuration_id, from_status, to_status, actor_id, actor_role, reason)
    values (v_cfg.id, null, 'candidate', null, v_role, 'registreret af evaluation_publisher');
    perform knowledge.write_audit('knowledge.retrieval_configuration.candidate_created', 'retrieval_configurations', v_cfg.id::text,
      pg_catalog.jsonb_build_object('fingerprint', v_cfg.fingerprint, 'label', v_cfg.label, 'version', v_cfg.version, 'db_role', v_role));
  end if;

  insert into knowledge.evaluation_runs (
    configuration_id, gate_set_id, run_id, report_schema, engine, report_checksum, results_checksum,
    eval_set_id, eval_set_version, eval_set_checksum, gate_set_checksum, configuration_fingerprint, runtime_fingerprint,
    corpus_checksum, evaluated_document_types, environment, active_cases, cases_by_type, metrics, hard_gates, quality_gates,
    minimums, failures, hard_gates_passed, quality_gates_passed, minimums_met, tier, verdict, valid, report,
    started_at, finished_at, registered_by_role)
  values (
    v_cfg.id, v_gate.id, p_report ->> 'runId', (p_report ->> 'reportSchema')::int, p_report ->> 'engine', v_checksum,
    p_report #>> '{checksums,results}', p_report #>> '{evalSet,setId}', (p_report #>> '{evalSet,version}')::int,
    p_report #>> '{evalSet,checksum}', v_gate.checksum, v_declared_fp, v_runtime_fp, p_report #>> '{corpus,checksumBefore}',
    v_doc_types, p_report #>> '{configuration,environment}', (p_report #>> '{evalSet,activeCases}')::int, p_report #> '{evalSet,byType}',
    p_report -> 'metrics', p_report -> 'hardGates', p_report -> 'qualityGates', p_report -> 'minimums', p_report -> 'failures',
    v_hard_passed, v_quality_passed, v_minimums_met, p_report ->> 'tier', p_report ->> 'verdict', (p_report ->> 'valid')::boolean, p_report,
    (p_report ->> 'startedAt')::timestamptz, (p_report ->> 'finishedAt')::timestamptz, v_role)
  returning id into v_run_id;
  perform knowledge.registry_write_end();

  perform knowledge.write_audit('knowledge.evaluation_run.published', 'evaluation_runs', v_run_id::text,
    pg_catalog.jsonb_build_object('configuration_id', v_cfg.id, 'fingerprint', v_cfg.fingerprint, 'report_checksum', v_checksum,
      'eval_set', p_report #>> '{evalSet,setId}', 'eval_set_checksum', p_report #>> '{evalSet,checksum}', 'gate_set_checksum', v_gate.checksum,
      'verdict', p_report ->> 'verdict', 'tier', p_report ->> 'tier', 'hard_gates_passed', v_hard_passed, 'db_role', v_role));

  -- D-8: en fejlet hård gate for den aktive konfiguration fjerner straks production-graden.
  if v_cfg.status = 'active' and not v_hard_passed then
    perform knowledge.suspend_retrieval_configuration_internal(v_cfg.id, 'hard_gate_failed', v_run_id, v_role);
  end if;
  return v_run_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Menneskelige beslutninger (system.settings.manage). En administrator kan godkende en
--    konfiguration, der har bestået en registreret kørsel, og aktivere en godkendt — aldrig
--    "markere en konfiguration som godkendt". Databasen efterprøver alle invarianter.
-- ----------------------------------------------------------------------------

create or replace function knowledge.require_settings_manager()
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if not identity.has_permission('system.settings.manage') or identity.current_user_id() is null then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  return identity.current_user_id();
end;
$$;

create or replace function knowledge.approve_evaluation_gate_set(p_gate_set_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := knowledge.require_settings_manager();
  v_gate knowledge.evaluation_gate_sets;
begin
  select * into v_gate from knowledge.evaluation_gate_sets where id = p_gate_set_id for update;
  if v_gate.id is null then
    perform knowledge.registry_refuse('not_found', 'gate-sættet findes ikke');
  end if;
  if v_gate.approved_at is not null then
    perform knowledge.registry_refuse('already_approved', 'gate-sættet er allerede godkendt');
  end if;
  perform knowledge.registry_write_begin();
  update knowledge.evaluation_gate_sets set approved_at = now(), approved_by = v_actor where id = p_gate_set_id;
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.evaluation_gate_set.approved', 'evaluation_gate_sets', p_gate_set_id::text,
    pg_catalog.jsonb_build_object('gate_set', v_gate.gate_set_id, 'version', v_gate.version, 'checksum', v_gate.checksum, 'decision', v_gate.decision));
end;
$$;

-- Dokumenttyper i det publicerede korpus, som kørslen ikke evaluerede (docs/08b §9 og §4.4
-- pilot-regel 5: nye dokumenttyper kræver en ny kørsel). Tom = kørslen dækker korpusset.
create or replace function knowledge.retrieval_scope_gaps(p_run_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct d.document_type order by d.document_type), '{}')
  from knowledge.document_versions v
  join knowledge.documents d on d.id = v.document_id
  where v.status = 'published'
    and not (d.document_type = any (coalesce((select r.evaluated_document_types from knowledge.evaluation_runs r where r.id = p_run_id), '{}')))
$$;

-- Hvorfor en konfiguration ikke kan bruges som godkendt lige nu. Tom = alt holder. Fælles
-- for godkendelse, aktivering og P3 (retrieval_context).
create or replace function knowledge.retrieval_configuration_problems(p_configuration_id uuid, p_run_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cfg knowledge.retrieval_configurations;
  v_run knowledge.evaluation_runs;
  v_gate knowledge.evaluation_gate_sets;
  v_model knowledge.embedding_models;
  v_problems text[] := '{}';
  v_latest uuid;
begin
  select * into v_cfg from knowledge.retrieval_configurations where id = p_configuration_id;
  select * into v_run from knowledge.evaluation_runs where id = p_run_id;
  if v_cfg.id is null then return array['konfigurationen findes ikke']; end if;
  if v_run.id is null then return array['kørslen findes ikke']; end if;
  if v_run.configuration_id <> v_cfg.id then v_problems := array_append(v_problems, 'kørslen gælder en anden konfiguration'); end if;
  if v_run.configuration_fingerprint <> v_cfg.fingerprint or v_run.runtime_fingerprint <> v_cfg.fingerprint
     or knowledge.retrieval_fingerprint(v_cfg.material) <> v_cfg.fingerprint then
    v_problems := array_append(v_problems, 'fingeraftrykket er ikke identisk med den evaluerede konfiguration');
  end if;
  if not v_run.hard_gates_passed then v_problems := array_append(v_problems, 'en hård gate er ikke bestået'); end if;
  if not v_run.valid then v_problems := array_append(v_problems, 'kørslen er ugyldig'); end if;
  if not v_run.minimums_met then v_problems := array_append(v_problems, 'minimum pr. type er ikke opfyldt'); end if;
  if not v_run.quality_gates_passed then v_problems := array_append(v_problems, 'en kvalitetsgate er ikke bestået'); end if;
  if v_run.verdict <> 'pass' then v_problems := array_append(v_problems, format('afgørelsen er "%s", ikke "pass"', v_run.verdict)); end if;
  if v_run.environment <> 'evaluation' then v_problems := array_append(v_problems, 'kørslen er ikke fra evalueringsmiljøet'); end if;
  select * into v_gate from knowledge.evaluation_gate_sets where id = v_run.gate_set_id;
  if v_gate.approved_at is null then v_problems := array_append(v_problems, 'gate-sættet er ikke godkendt'); end if;
  if knowledge.retrieval_material_is_development(v_cfg.material) then
    v_problems := array_append(v_problems, 'konfigurationen bruger en udviklingsimplementering (test-embedder eller "none")');
  end if;
  select * into v_model from knowledge.embedding_models where id = v_cfg.embedding_model_id;
  if v_model.id is null or v_model.provider = 'test'
     or v_model.provider <> v_cfg.embedding_provider or v_model.model_name <> v_cfg.embedding_model
     or v_model.model_version <> v_cfg.embedding_model_version or v_model.dimensions <> v_cfg.embedding_dimensions then
    v_problems := array_append(v_problems, 'embedding-modellen findes ikke som konfigurationen beskriver den');
  end if;
  -- Den seneste registrerede kørsel for konfigurationen skal være godkendelsens (en nyere
  -- kørsel kan ikke springes over).
  select r.id into v_latest from knowledge.evaluation_runs r where r.configuration_id = v_cfg.id order by r.registered_at desc, r.id desc limit 1;
  if v_latest is distinct from v_run.id then
    v_problems := array_append(v_problems, 'der findes en nyere registreret kørsel af konfigurationen');
  end if;
  return v_problems;
end;
$$;

-- Godkendelse (docs/08b §10.2). Kræver en bestået kørsel af netop konfigurationen og en
-- skriftlig årsagsnote for hver fejl i rapporten (pilot-regel 3), i rapportens rækkefølge.
-- Fra suspended eller retired kræves en kørsel, der er registreret efter statusskiftet.
create or replace function knowledge.approve_retrieval_configuration(p_configuration_id uuid, p_run_id uuid, p_root_cause_notes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := knowledge.require_settings_manager();
  v_cfg knowledge.retrieval_configurations;
  v_run knowledge.evaluation_runs;
  v_problems text[];
  v_failures int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('knowledge.retrieval_configurations'));
  select * into v_cfg from knowledge.retrieval_configurations where id = p_configuration_id for update;
  select * into v_run from knowledge.evaluation_runs where id = p_run_id;
  if v_cfg.id is null then
    perform knowledge.registry_refuse('not_found', 'konfigurationen findes ikke');
  end if;
  if v_cfg.status not in ('candidate', 'suspended', 'retired') then
    perform knowledge.registry_refuse('status', format('en konfiguration med status "%s" kan ikke godkendes', v_cfg.status));
  end if;
  if v_cfg.status in ('suspended', 'retired') and (v_run.id is null or v_run.registered_at <= v_cfg.status_changed_at) then
    perform knowledge.registry_refuse('reapproval', 'genaktivering kræver en ny bestået kørsel, registreret efter suspenderingen eller udfasningen');
  end if;
  v_problems := knowledge.retrieval_configuration_problems(p_configuration_id, p_run_id);
  if cardinality(v_problems) > 0 then
    perform knowledge.registry_refuse('not_approvable', array_to_string(v_problems, '; '));
  end if;
  v_failures := pg_catalog.jsonb_array_length(v_run.failures);
  if v_failures > 0 and (pg_catalog.jsonb_typeof(p_root_cause_notes) is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_root_cause_notes) <> v_failures
       or exists (select 1 from pg_catalog.jsonb_array_elements(p_root_cause_notes) n
                  where pg_catalog.jsonb_typeof(n) <> 'string' or length(btrim(n #>> '{}')) < 10)) then
    perform knowledge.registry_refuse('root_cause_notes', format('hver af rapportens %s fejl kræver en skriftlig årsagsnote (mindst 10 tegn)', v_failures));
  end if;
  perform knowledge.registry_write_begin();
  update knowledge.retrieval_configurations
  set status = 'approved', status_changed_at = pg_catalog.clock_timestamp(), approval_run_id = v_run.id, gate_set_id = v_run.gate_set_id, tier = v_run.tier,
      approved_at = now(), approved_by = v_actor
  where id = p_configuration_id;
  insert into knowledge.retrieval_configuration_transitions (configuration_id, from_status, to_status, run_id, actor_id, actor_role, reason, root_cause_notes)
  values (p_configuration_id, v_cfg.status, 'approved', v_run.id, v_actor, knowledge.effective_db_role(), 'godkendt',
          case when v_failures > 0 then p_root_cause_notes end);
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.retrieval_configuration.approved', 'retrieval_configurations', p_configuration_id::text,
    pg_catalog.jsonb_build_object('fingerprint', v_cfg.fingerprint, 'run_id', v_run.id, 'report_checksum', v_run.report_checksum,
      'gate_set_checksum', v_run.gate_set_checksum, 'tier', v_run.tier, 'from', v_cfg.status));
end;
$$;

-- Aktivering (docs/08b §10.2) i én transaktion: alle invarianter efterprøves igen, en
-- eventuel embedding-model skiftes (100 % dækning, §2.5), den hidtidige konfiguration i drift
-- udfases, og den nye bliver aktiv. Advisory lock + det unikke indeks: aldrig to aktive.
create or replace function knowledge.activate_retrieval_configuration(p_configuration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := knowledge.require_settings_manager();
  v_cfg knowledge.retrieval_configurations;
  v_previous knowledge.retrieval_configurations;
  v_problems text[];
  v_gaps text[];
  v_missing text[];
  v_model knowledge.embedding_models;
  v_coverage jsonb;
  v_previous_model uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('knowledge.retrieval_configurations'));
  select * into v_cfg from knowledge.retrieval_configurations where id = p_configuration_id for update;
  if v_cfg.id is null then
    perform knowledge.registry_refuse('not_found', 'konfigurationen findes ikke');
  end if;
  if v_cfg.status <> 'approved' then
    perform knowledge.registry_refuse('status', format('kun en godkendt konfiguration kan aktiveres (status "%s")', v_cfg.status));
  end if;
  v_problems := knowledge.retrieval_configuration_problems(v_cfg.id, v_cfg.approval_run_id);
  if cardinality(v_problems) > 0 then
    perform knowledge.registry_refuse('not_activatable', array_to_string(v_problems, '; '));
  end if;
  v_gaps := knowledge.retrieval_scope_gaps(v_cfg.approval_run_id);
  if cardinality(v_gaps) > 0 then
    perform knowledge.registry_refuse('scope', format('korpusset indeholder dokumenttyper, kørslen ikke evaluerede (%s) — det kræver en ny kørsel',
                                                       array_to_string(v_gaps, ', ')));
  end if;
  select coalesce(array_agg(c order by c), '{}') into v_missing from unnest(v_cfg.chunker_versions) c
  where not exists (select 1 from knowledge.document_versions v where v.chunker_version = c);
  if cardinality(v_missing) > 0 then
    perform knowledge.registry_refuse('chunker', format('chunker-versionerne %s findes ikke i korpusset', array_to_string(v_missing, ', ')));
  end if;

  -- Embedding-modellen: skift i samme transaktion, hvis konfigurationen bruger en anden.
  select * into v_model from knowledge.embedding_models where id = v_cfg.embedding_model_id for update;
  if v_model.status <> 'active' then
    if v_model.status <> 'candidate' then
      perform knowledge.registry_refuse('model', 'konfigurationens embedding-model er udfaset og kan ikke aktiveres igen');
    end if;
    v_coverage := knowledge.embedding_coverage(v_model.id);
    if (v_coverage ->> 'embedded')::int < (v_coverage ->> 'chunks')::int then
      perform knowledge.registry_refuse('model', format('modellen dækker ikke alle chunks (%s af %s)', v_coverage ->> 'embedded', v_coverage ->> 'chunks'));
    end if;
    update knowledge.embedding_models set status = 'retired', retired_at = now() where status = 'active' returning id into v_previous_model;
    update knowledge.embedding_models set status = 'active', activated_at = now() where id = v_model.id;
    if v_previous_model is not null then
      perform knowledge.write_audit('knowledge.embedding_model.retired', 'embedding_models', v_previous_model::text,
        pg_catalog.jsonb_build_object('retrieval_configuration_id', v_cfg.id));
    end if;
    perform knowledge.write_audit('knowledge.embedding_model.activated', 'embedding_models', v_model.id::text,
      v_coverage || pg_catalog.jsonb_build_object('retrieval_configuration_id', v_cfg.id));
  end if;

  perform knowledge.registry_write_begin();
  for v_previous in
    select * from knowledge.retrieval_configurations where status in ('active', 'suspended') and id <> v_cfg.id for update
  loop
    update knowledge.retrieval_configurations
    set status = 'retired', status_changed_at = pg_catalog.clock_timestamp(), retired_at = now(), retired_by = v_actor, retirement_reason = 'replaced'
    where id = v_previous.id;
    insert into knowledge.retrieval_configuration_transitions (configuration_id, from_status, to_status, actor_id, actor_role, reason)
    values (v_previous.id, v_previous.status, 'retired', v_actor, knowledge.effective_db_role(), 'erstattet af ' || v_cfg.id::text);
    perform knowledge.write_audit('knowledge.retrieval_configuration.replaced', 'retrieval_configurations', v_previous.id::text,
      pg_catalog.jsonb_build_object('fingerprint', v_previous.fingerprint, 'replaced_by', v_cfg.id, 'replaced_by_fingerprint', v_cfg.fingerprint));
  end loop;
  update knowledge.retrieval_configurations
  set status = 'active', status_changed_at = pg_catalog.clock_timestamp(), activated_at = now(), activated_by = v_actor
  where id = v_cfg.id;
  insert into knowledge.retrieval_configuration_transitions (configuration_id, from_status, to_status, run_id, actor_id, actor_role, reason)
  values (v_cfg.id, 'approved', 'active', v_cfg.approval_run_id, v_actor, knowledge.effective_db_role(), 'aktiveret');
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.retrieval_configuration.activated', 'retrieval_configurations', v_cfg.id::text,
    pg_catalog.jsonb_build_object('fingerprint', v_cfg.fingerprint, 'run_id', v_cfg.approval_run_id, 'tier', v_cfg.tier,
      'embedding_model_id', v_cfg.embedding_model_id, 'model_switched', v_previous_model is not null or v_model.status <> 'active'));
end;
$$;

-- Manuel suspendering (docs/08b §10.2, D-8). Samme operation som den automatiske (I7 bruger
-- record_evaluation_run). Ingen automatisk fallback til en anden konfiguration.
create or replace function knowledge.suspend_retrieval_configuration(p_configuration_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := knowledge.require_settings_manager();
begin
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    perform knowledge.registry_refuse('reason', 'en suspendering kræver en begrundelse (mindst 10 tegn)');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('knowledge.retrieval_configurations'));
  perform knowledge.suspend_retrieval_configuration_internal(p_configuration_id, btrim(p_reason), null, knowledge.effective_db_role());
end;
$$;

-- Udfasning (aldrig sletning). Den aktive konfiguration udfases kun ved at blive erstattet
-- eller efter suspendering.
create or replace function knowledge.retire_retrieval_configuration(p_configuration_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := knowledge.require_settings_manager();
  v_cfg knowledge.retrieval_configurations;
begin
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    perform knowledge.registry_refuse('reason', 'en udfasning kræver en begrundelse (mindst 10 tegn)');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('knowledge.retrieval_configurations'));
  select * into v_cfg from knowledge.retrieval_configurations where id = p_configuration_id for update;
  if v_cfg.id is null or v_cfg.status not in ('candidate', 'approved', 'suspended') then
    perform knowledge.registry_refuse('status', 'kun en kandidat, en godkendt eller en suspenderet konfiguration kan udfases');
  end if;
  perform knowledge.registry_write_begin();
  update knowledge.retrieval_configurations
  set status = 'retired', status_changed_at = pg_catalog.clock_timestamp(), retired_at = now(), retired_by = v_actor, retirement_reason = btrim(p_reason)
  where id = p_configuration_id;
  insert into knowledge.retrieval_configuration_transitions (configuration_id, from_status, to_status, actor_id, actor_role, reason)
  values (p_configuration_id, v_cfg.status, 'retired', v_actor, knowledge.effective_db_role(), btrim(p_reason));
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.retrieval_configuration.retired', 'retrieval_configurations', p_configuration_id::text,
    pg_catalog.jsonb_build_object('fingerprint', v_cfg.fingerprint, 'from', v_cfg.status));
end;
$$;

-- §2.7: en embedding-model kan kun blive aktiv, hvis der findes en godkendt
-- retrieval-konfiguration for den. Det normale modelskifte sker ved aktivering af
-- konfigurationen. (Udviklingsmodellen aktiveres kun af det lokale seed.)
create or replace function knowledge.activate_embedding_model(p_model_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model knowledge.embedding_models;
  v_coverage jsonb;
  v_previous uuid;
begin
  if not identity.has_permission('system.settings.manage') then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  select * into v_model from knowledge.embedding_models where id = p_model_id for update;
  if v_model.id is null or v_model.status <> 'candidate' then
    raise exception 'Kun en kandidatmodel kan aktiveres' using errcode = 'check_violation';
  end if;
  if v_model.provider = 'test' then
    raise exception 'Udviklingsmodellen kan ikke aktiveres her (den aktiveres kun af det lokale udviklingsseed)'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from knowledge.retrieval_configurations c where c.embedding_model_id = p_model_id and c.status = 'approved') then
    raise exception 'En embedding-model kan kun aktiveres med en godkendt retrieval-konfiguration for den (docs/08b §2.7)'
      using errcode = 'check_violation';
  end if;
  v_coverage := knowledge.embedding_coverage(p_model_id);
  if (v_coverage ->> 'embedded')::int < (v_coverage ->> 'chunks')::int then
    raise exception 'Modellen dækker ikke alle chunks (% af %)', v_coverage ->> 'embedded', v_coverage ->> 'chunks'
      using errcode = 'check_violation';
  end if;
  update knowledge.embedding_models set status = 'retired', retired_at = now()
  where status = 'active' returning id into v_previous;
  update knowledge.embedding_models set status = 'active', activated_at = now() where id = p_model_id;
  if v_previous is not null then
    perform knowledge.write_audit('knowledge.embedding_model.retired', 'embedding_models', v_previous::text, '{}'::jsonb);
  end if;
  perform knowledge.write_audit('knowledge.embedding_model.activated', 'embedding_models', p_model_id::text, v_coverage);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Retrieval-konteksten (P1, P3, P6 og P9). Kaldes af retrieval-laget som den indloggede
--    bruger ved hvert retrieval. Indeholder kun teknisk metadata (id'er, fingeraftryk,
--    status) — ingen dokumentindhold.
-- ----------------------------------------------------------------------------

create or replace function knowledge.retrieval_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_model jsonb;
  v_cfg knowledge.retrieval_configurations;
  v_run knowledge.evaluation_runs;
  v_active_count int;
  v_not_ready text[] := '{}';
  v_gaps text[];
begin
  select pg_catalog.jsonb_build_object('id', m.id, 'provider', m.provider, 'model_name', m.model_name, 'model_version', m.model_version,
                                       'dimensions', m.dimensions)
  into v_model from knowledge.embedding_models m where m.status = 'active';
  select * into v_cfg from knowledge.retrieval_configurations where status in ('active', 'suspended');
  select count(*)::int into v_active_count from knowledge.retrieval_configurations where status = 'active';

  if v_cfg.id is not null then
    select * into v_run from knowledge.evaluation_runs where id = v_cfg.approval_run_id;
    if v_cfg.status <> 'active' then v_not_ready := array_append(v_not_ready, 'suspended'); end if;
    if v_active_count <> 1 then v_not_ready := array_append(v_not_ready, 'active_count'); end if;
    if v_run.id is null or not v_run.passed or v_run.configuration_id <> v_cfg.id
       or v_run.configuration_fingerprint <> v_cfg.fingerprint or v_run.runtime_fingerprint <> v_cfg.fingerprint then
      v_not_ready := array_append(v_not_ready, 'evaluation');
    end if;
    if not exists (select 1 from knowledge.evaluation_gate_sets g where g.id = v_run.gate_set_id and g.approved_at is not null) then
      v_not_ready := array_append(v_not_ready, 'gate_set');
    end if;
    if knowledge.retrieval_material_is_development(v_cfg.material) then v_not_ready := array_append(v_not_ready, 'development'); end if;
    if (v_model ->> 'id')::uuid is distinct from v_cfg.embedding_model_id then v_not_ready := array_append(v_not_ready, 'model'); end if;
    v_gaps := knowledge.retrieval_scope_gaps(v_cfg.approval_run_id);
    if cardinality(v_gaps) > 0 then v_not_ready := array_append(v_not_ready, 'scope'); end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'executedAs', pg_catalog.jsonb_build_object('role', knowledge.effective_db_role(), 'userId', auth.uid()),
    'activeModel', v_model,
    'configuration', case when v_cfg.id is null then null else pg_catalog.jsonb_build_object(
      'id', v_cfg.id, 'label', v_cfg.label, 'version', v_cfg.version, 'fingerprint', v_cfg.fingerprint, 'status', v_cfg.status,
      'material', v_cfg.material, 'embeddingModelId', v_cfg.embedding_model_id, 'rerankerId', v_cfg.reranker_id,
      'rerankerVersion', v_cfg.reranker_version, 'algorithmVersion', v_cfg.algorithm_version, 'params', v_cfg.params,
      'chunkerVersions', pg_catalog.to_jsonb(v_cfg.chunker_versions), 'tier', v_cfg.tier,
      'evaluation', case when v_run.id is null then null else pg_catalog.jsonb_build_object(
        'runId', v_run.id, 'reportChecksum', v_run.report_checksum, 'gateSetChecksum', v_run.gate_set_checksum,
        'verdict', v_run.verdict, 'passed', v_run.passed, 'evaluatedDocumentTypes', pg_catalog.to_jsonb(v_run.evaluated_document_types)) end,
      'productionReady', cardinality(v_not_ready) = 0,
      'notReady', pg_catalog.to_jsonb(v_not_ready)) end);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Chunker-versionen pr. chunk i retrievalens resultater (P7). Uændret i øvrigt
--    (20261001000600 og 20261001000700); kun kolonnen chunker_version er tilføjet til sidst.
-- ----------------------------------------------------------------------------

drop function knowledge.search_chunks(text, text, uuid, text, date, text, uuid[], uuid[], text[], int);

create function knowledge.search_chunks(
  p_query text,
  p_query_embedding text,
  p_model_id uuid,
  p_mode text default 'current',
  p_as_of date default null,
  p_language text default 'da',
  p_product_ids uuid[] default null,
  p_document_ids uuid[] default null,
  p_document_types text[] default null,
  p_candidate_k int default 50
)
returns table (
  chunk_id uuid,
  chunk_index int,
  kind text,
  text text,
  lead_in text,
  heading text,
  heading_path text[],
  section_number text,
  page_start int,
  page_end int,
  char_start int,
  char_end int,
  overlap_chars int,
  version_id uuid,
  version_label text,
  language text,
  valid_from date,
  valid_to date,
  approved_at timestamptz,
  superseded_by uuid,
  document_id uuid,
  document_title text,
  document_type text,
  product_id uuid,
  product_name text,
  source_type text,
  temporal_status text,
  vector_rank int,
  vector_score double precision,
  lexical_rank int,
  lexical_score double precision,
  lexical_terms text[],
  chunker_version text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_date date;
  v_dims int;
  v_active uuid;
begin
  if p_mode not in ('current', 'as_of') then
    raise exception 'Ukendt tilstand: %', p_mode using errcode = 'invalid_parameter_value';
  end if;
  if p_mode = 'as_of' and p_as_of is null then
    raise exception 'Historisk opslag kræver en dato' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(p_query, '')) > 1000 then
    raise exception 'Forespørgslen er for lang' using errcode = 'invalid_parameter_value';
  end if;
  if p_candidate_k not between 1 and 200 then
    raise exception 'Ugyldigt kandidatantal' using errcode = 'invalid_parameter_value';
  end if;

  v_date := case when p_mode = 'current' then knowledge.today() else p_as_of end;

  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);

  select m.id, m.dimensions into v_active, v_dims from knowledge.active_embedding_model() m;
  if p_query_embedding is not null and (v_active is null or p_model_id is distinct from v_active) then
    raise exception 'Forespørgslen er ikke lavet med den aktive embedding-model' using errcode = 'invalid_parameter_value';
  end if;

  return query execute format($q$
    with allowed as (
      select v.id, v.version_label, v.language, v.valid_from, v.valid_to, v.approved_at, v.superseded_by, v.chunker_version,
             d.id as document_id, d.title, d.document_type, p.id as product_id, p.name as product_name,
             knowledge.source_type(d.source_id) as source_type
      from knowledge.document_versions v
      join knowledge.documents d on d.id = v.document_id
      join knowledge.products p on p.id = d.product_id
      where v.status = 'published'
        and v.language = $1
        and daterange(v.valid_from, v.valid_to, '[)') @> $2::date
        and ($3::uuid[] is null or d.product_id = any ($3))
        and ($4::uuid[] is null or d.id = any ($4))
        and ($5::text[] is null or d.document_type = any ($5))
        and knowledge.can_read_version(v.id, 'any')
    ),
    vec as (
      select ranked.chunk_id, ranked.score, row_number() over (order by ranked.distance, ranked.chunk_id)::int as rnk
      from (
        select e.chunk_id,
               (e.embedding::extensions.vector(%1$s) operator(extensions.<=>) $6::extensions.vector(%1$s)) as distance,
               1 - (e.embedding::extensions.vector(%1$s) operator(extensions.<=>) $6::extensions.vector(%1$s)) as score
        from knowledge.chunk_embeddings e
        join knowledge.document_chunks c on c.id = e.chunk_id
        where $6 is not null
          and e.embedding_model_id = $7
          and c.document_version_id in (select id from allowed)
        order by e.embedding::extensions.vector(%1$s) operator(extensions.<=>) $6::extensions.vector(%1$s)
        limit $8
      ) ranked
    ),
    q as (
      select nullif(replace(plainto_tsquery('danish', coalesce($9, ''))::text, ' & ', ' | '), '')::tsquery as da,
             nullif(replace(plainto_tsquery('simple', coalesce($9, ''))::text, ' & ', ' | '), '')::tsquery as si,
             tsvector_to_array(to_tsvector('simple', coalesce($9, ''))) as words
    ),
    lex as (
      select c.id as chunk_id,
             (coalesce(ts_rank_cd(c.fts_da, q.da), 0) + coalesce(ts_rank_cd(c.fts_simple, q.si), 0))::double precision as score
      from knowledge.document_chunks c, q
      where c.document_version_id in (select id from allowed)
        and ((q.da is not null and c.fts_da @@ q.da) or (q.si is not null and c.fts_simple @@ q.si))
      order by score desc, c.id
      limit $8
    ),
    lexr as (
      select lex.chunk_id, lex.score, row_number() over (order by lex.score desc, lex.chunk_id)::int as rnk from lex
    ),
    candidates as (
      select coalesce(vec.chunk_id, lexr.chunk_id) as chunk_id,
             vec.rnk as vector_rank, vec.score as vector_score, lexr.rnk as lexical_rank, lexr.score as lexical_score
      from vec full join lexr on lexr.chunk_id = vec.chunk_id
    )
    select c.id, c.chunk_index, c.kind, c.text, c.lead_in, c.heading, c.heading_path, c.section_number,
           c.page_start, c.page_end, c.char_start, c.char_end, c.overlap_chars,
           a.id, a.version_label, a.language, a.valid_from, a.valid_to, a.approved_at, a.superseded_by,
           a.document_id, a.title, a.document_type, a.product_id, a.product_name, a.source_type,
           case when a.valid_from > knowledge.today() then 'future'
                when a.valid_to is not null and a.valid_to <= knowledge.today() then 'historical'
                else 'current' end,
           cand.vector_rank, cand.vector_score, cand.lexical_rank, cand.lexical_score,
           array(select w from unnest(tsvector_to_array(c.fts_simple)) w, q where w = any (q.words) order by w),
           a.chunker_version
    from candidates cand
    join knowledge.document_chunks c on c.id = cand.chunk_id
    join allowed a on a.id = c.document_version_id
    order by least(coalesce(cand.vector_rank, 1000000), coalesce(cand.lexical_rank, 1000000)), c.id
  $q$, coalesce(v_dims, 1))
  using p_language, v_date, p_product_ids, p_document_ids, p_document_types,
        p_query_embedding, p_model_id, p_candidate_k, p_query;
end;
$$;

drop function knowledge.evidence_chunks(uuid[], uuid[], date);

create function knowledge.evidence_chunks(p_chunk_ids uuid[], p_version_ids uuid[], p_date date)
returns table (
  chunk_id uuid,
  chunk_index int,
  kind text,
  text text,
  lead_in text,
  heading text,
  heading_path text[],
  section_number text,
  page_start int,
  page_end int,
  char_start int,
  char_end int,
  overlap_chars int,
  version_id uuid,
  version_label text,
  language text,
  valid_from date,
  valid_to date,
  approved_at timestamptz,
  superseded_by uuid,
  document_id uuid,
  document_title text,
  document_type text,
  product_id uuid,
  product_name text,
  source_type text,
  temporal_status text,
  vector_rank int,
  vector_score double precision,
  lexical_rank int,
  lexical_score double precision,
  lexical_terms text[],
  chunker_version text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with allowed as (
    select v.id, v.version_label, v.language, v.valid_from, v.valid_to, v.approved_at, v.superseded_by, v.chunker_version,
           d.id as document_id, d.title, d.document_type, p.id as product_id, p.name as product_name,
           knowledge.source_type(d.source_id) as source_type
    from knowledge.document_versions v
    join knowledge.documents d on d.id = v.document_id
    join knowledge.products p on p.id = d.product_id
    where (v.id = any (p_version_ids) or v.id in (select c.document_version_id from knowledge.document_chunks c where c.id = any (p_chunk_ids)))
      and v.status = 'published'
      and daterange(v.valid_from, v.valid_to, '[)') @> p_date
      and knowledge.can_read_version(v.id, 'any')
  ),
  picked as (
    select c.id from knowledge.document_chunks c join allowed a on a.id = c.document_version_id where c.id = any (p_chunk_ids)
    union
    select first.id from allowed a
    cross join lateral (
      select c.id from knowledge.document_chunks c where c.document_version_id = a.id order by c.chunk_index limit 1
    ) first
    where a.id = any (p_version_ids)
  )
  select c.id, c.chunk_index, c.kind, c.text, c.lead_in, c.heading, c.heading_path, c.section_number,
         c.page_start, c.page_end, c.char_start, c.char_end, c.overlap_chars,
         a.id, a.version_label, a.language, a.valid_from, a.valid_to, a.approved_at, a.superseded_by,
         a.document_id, a.title, a.document_type, a.product_id, a.product_name, a.source_type,
         case when a.valid_from > knowledge.today() then 'future'
              when a.valid_to is not null and a.valid_to <= knowledge.today() then 'historical'
              else 'current' end,
         null::int, null::double precision, null::int, null::double precision, '{}'::text[],
         a.chunker_version
  from picked
  join knowledge.document_chunks c on c.id = picked.id
  join allowed a on a.id = c.document_version_id
  where coalesce(cardinality(p_chunk_ids), 0) + coalesce(cardinality(p_version_ids), 0) <= 200
  order by a.document_id, c.chunk_index
$$;

-- ----------------------------------------------------------------------------
-- 10. Drift af publisherens identitet (samme mønster som ops.ingestion_worker_*, 8B-I3).
--     Passwordet sættes klientside med psql \password og lægges i CI's secret-håndtering.
-- ----------------------------------------------------------------------------

create or replace function ops.evaluation_publisher_api()
returns regprocedure[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'knowledge.record_evaluation_run(jsonb)',
    'knowledge.register_evaluation_gate_set(jsonb)'
  ]::regprocedure[]
$$;

create or replace function ops.evaluation_publisher_audit(p_action text, p_details jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, details)
  values (null, p_action, 'ops', 'pg_roles', 'evaluation_publisher_login', coalesce(p_details, '{}'::jsonb) || jsonb_build_object('db_user', session_user::text));
$$;

create or replace function ops.evaluation_publisher_set_api(p_enabled boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array ops.evaluation_publisher_api() loop
    if p_enabled then
      execute format('grant execute on function %s to evaluation_publisher', v_fn);
    else
      execute format('revoke execute on function %s from evaluation_publisher', v_fn);
    end if;
  end loop;
  perform ops.evaluation_publisher_audit(
    case when p_enabled then 'ops.evaluation_publisher.api_enabled' else 'ops.evaluation_publisher.api_disabled' end, '{}'::jsonb);
end;
$$;

create or replace function ops.evaluation_publisher_prepare()
returns void
language plpgsql
set search_path = ''
as $$
begin
  alter role evaluation_publisher_login login;
  grant evaluation_publisher to evaluation_publisher_login with inherit true, set false;
  perform ops.evaluation_publisher_audit('ops.evaluation_publisher.prepared', '{}'::jsonb);
end;
$$;

create or replace function ops.evaluation_publisher_deactivate(p_reason text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_terminated int := 0;
  v_pid int;
begin
  if p_reason not in ('retired', 'emergency_revoked') then
    raise exception 'Ukendt årsag: %', p_reason using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.pg_has_role('evaluation_publisher_login', 'evaluation_publisher', 'MEMBER') then
    revoke evaluation_publisher from evaluation_publisher_login;
  end if;
  if pg_catalog.pg_has_role('evaluation_publisher_login', 'evaluation_publisher', 'MEMBER') then
    raise exception 'evaluation_publisher_login er stadig medlem af evaluation_publisher (tildelt af en anden rolle)';
  end if;
  alter role evaluation_publisher_login nologin password null;
  for v_pid in
    select a.pid from pg_catalog.pg_stat_activity a where a.usename = 'evaluation_publisher_login' and a.pid <> pg_catalog.pg_backend_pid()
  loop
    if pg_catalog.pg_terminate_backend(v_pid) then
      v_terminated := v_terminated + 1;
    end if;
  end loop;
  perform ops.evaluation_publisher_audit('ops.evaluation_publisher.' || p_reason, jsonb_build_object('terminated_sessions', v_terminated));
  return v_terminated;
end;
$$;

-- "violations" skal være tom i produktion.
create or replace function ops.evaluation_publisher_status()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with role as (
    select r.rolcanlogin, r.rolconnlimit,
           pg_catalog.pg_has_role('evaluation_publisher_login', 'evaluation_publisher', 'MEMBER') as is_member
    from pg_catalog.pg_roles r where r.rolname = 'evaluation_publisher_login'
  ),
  extra as (
    select count(*)::int as n
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
      and pg_catalog.has_schema_privilege('evaluation_publisher', n.oid, 'USAGE')
      and pg_catalog.has_function_privilege('evaluation_publisher', p.oid, 'EXECUTE')
      and not (p.oid::regprocedure = any (ops.evaluation_publisher_api()))
  ),
  members as (
    select count(*)::int as n from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles g on g.oid = m.roleid and g.rolname = 'evaluation_publisher'
    join pg_catalog.pg_roles u on u.oid = m.member and u.rolname <> 'evaluation_publisher_login'
    -- A creator's automatic ADMIN-only membership (PG16) confers no privileges; inherit or set does.
    where m.inherit_option or m.set_option
  )
  select jsonb_build_object(
    'login', (select rolcanlogin from role), 'member', (select is_member from role), 'connection_limit', (select rolconnlimit from role),
    'violations', to_jsonb(array_remove(array[
      case when (select n from members) > 0 then 'other_members' end,
      case when (select n from extra) > 0 then 'extra_executable_functions' end,
      case when (select is_member and not rolcanlogin from role) then 'member_without_login' end,
      case when (select rolcanlogin and not is_member from role) then 'login_without_membership' end
    ], null)))
$$;

revoke all on function
  ops.evaluation_publisher_api(),
  ops.evaluation_publisher_audit(text, jsonb),
  ops.evaluation_publisher_set_api(boolean),
  ops.evaluation_publisher_prepare(),
  ops.evaluation_publisher_deactivate(text),
  ops.evaluation_publisher_status()
from public;

-- ----------------------------------------------------------------------------
-- 11. RLS og rettigheder. Ingen skriverettigheder for nogen app-rolle eller service_role.
--     Læsning af historikken kræver system.settings.manage.
-- ----------------------------------------------------------------------------

alter table knowledge.retrieval_configurations enable row level security;
alter table knowledge.evaluation_runs enable row level security;
alter table knowledge.evaluation_gate_sets enable row level security;
alter table knowledge.retrieval_configuration_transitions enable row level security;

create policy retrieval_configurations_select on knowledge.retrieval_configurations
  for select to authenticated using (identity.has_permission('system.settings.manage'));
create policy evaluation_runs_select on knowledge.evaluation_runs
  for select to authenticated using (identity.has_permission('system.settings.manage'));
create policy evaluation_gate_sets_select on knowledge.evaluation_gate_sets
  for select to authenticated using (identity.has_permission('system.settings.manage'));
create policy retrieval_configuration_transitions_select on knowledge.retrieval_configuration_transitions
  for select to authenticated using (identity.has_permission('system.settings.manage'));

revoke all on knowledge.retrieval_configurations, knowledge.evaluation_runs, knowledge.evaluation_gate_sets,
  knowledge.retrieval_configuration_transitions from public, anon, authenticated, service_role;
grant select on knowledge.retrieval_configurations, knowledge.evaluation_runs, knowledge.evaluation_gate_sets,
  knowledge.retrieval_configuration_transitions to authenticated;
revoke all on sequence knowledge.retrieval_configuration_transitions_id_seq from public, anon, authenticated, service_role;

revoke all on function
  knowledge.assert_publisher_caller(),
  knowledge.canonical_number(numeric),
  knowledge.canonical_json(jsonb),
  knowledge.checksum_of(jsonb),
  knowledge.jsonb_keys(jsonb),
  knowledge.jsonb_text_array(jsonb),
  knowledge.retrieval_fingerprint(jsonb),
  knowledge.retrieval_material_problem(jsonb),
  knowledge.retrieval_material_is_development(jsonb),
  knowledge.registry_write_begin(),
  knowledge.registry_write_end(),
  knowledge.require_registry_write(),
  knowledge.check_append_only(),
  knowledge.check_gate_set_write(),
  knowledge.retrieval_transition_allowed(text, text),
  knowledge.retrieval_configuration_identity(knowledge.retrieval_configurations),
  knowledge.check_retrieval_configuration_write(),
  knowledge.refuse_truncate(),
  knowledge.eval_close(jsonb, double precision),
  knowledge.eval_wilson(int, int),
  knowledge.eval_metric_matches(jsonb, double precision, int, int, jsonb),
  knowledge.eval_report_problems(jsonb, jsonb),
  knowledge.gate_set_problem(jsonb),
  knowledge.registry_refuse(text, text),
  knowledge.register_evaluation_gate_set(jsonb),
  knowledge.suspend_retrieval_configuration_internal(uuid, text, uuid, text),
  knowledge.record_evaluation_run(jsonb),
  knowledge.require_settings_manager(),
  knowledge.approve_evaluation_gate_set(uuid),
  knowledge.retrieval_scope_gaps(uuid),
  knowledge.retrieval_configuration_problems(uuid, uuid),
  knowledge.approve_retrieval_configuration(uuid, uuid, jsonb),
  knowledge.activate_retrieval_configuration(uuid),
  knowledge.suspend_retrieval_configuration(uuid, text),
  knowledge.retire_retrieval_configuration(uuid, text),
  knowledge.activate_embedding_model(uuid),
  knowledge.retrieval_context(),
  knowledge.search_chunks(text, text, uuid, text, date, text, uuid[], uuid[], text[], int),
  knowledge.evidence_chunks(uuid[], uuid[], date)
from public, anon, authenticated, service_role;

-- Publisheren: kun de to publiceringsfunktioner (via gruppen).
select ops.evaluation_publisher_set_api(true);

-- Menneskelige beslutninger: kun indloggede brugere; funktionerne kræver system.settings.manage.
grant execute on function
  knowledge.approve_evaluation_gate_set(uuid),
  knowledge.approve_retrieval_configuration(uuid, uuid, jsonb),
  knowledge.activate_retrieval_configuration(uuid),
  knowledge.suspend_retrieval_configuration(uuid, text),
  knowledge.retire_retrieval_configuration(uuid, text),
  knowledge.activate_embedding_model(uuid)
to authenticated;

-- Retrieval som den indloggede bruger (P6). Ikke service_role.
grant execute on function
  knowledge.retrieval_context(),
  knowledge.search_chunks(text, text, uuid, text, date, text, uuid[], uuid[], text[], int),
  knowledge.evidence_chunks(uuid[], uuid[], date)
to authenticated;

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt, kun hvis deltrinnet skal fjernes): genskab search_chunks og
-- evidence_chunks fra 20261001000600/0700 og activate_embedding_model fra 20261001000400,
-- drop tabellerne og funktionerne ovenfor og ops.evaluation_publisher_*, og
-- "drop role evaluation_publisher_login, evaluation_publisher". Registret må ikke tømmes i
-- et miljø, hvor det har været brugt (reproducerbarhed, docs/08b §11).
-- ----------------------------------------------------------------------------
