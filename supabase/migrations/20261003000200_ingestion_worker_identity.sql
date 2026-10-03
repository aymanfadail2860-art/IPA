-- ============================================================================
-- Fase 8B, deltrin I3 — Workerens databaseidentitet og databasefunktioner (D-10, D-20)
--
-- Specifikation: docs/08b §6.1.1 og §21.4. Realiserer databasesiden af D-10 og D-20:
--
--   * Roller: gruppen ingestion_worker (NOLOGIN, ejer intet) og to login-roller til
--     blue/green-rotation, ingestion_worker_login_blue og _green. Begge oprettes NOLOGIN, uden
--     password og uden medlemskab. En rolle aktiveres først af runbooken (ops-funktionerne
--     nedenfor), og passwordet sættes af driften — aldrig i en migration.
--   * Rettigheder: gruppen har kun USAGE på skemaet knowledge og EXECUTE på præcis de godkendte
--     knowledge.worker_*-funktioner (ops.ingestion_worker_api()). Ingen tabelrettigheder.
--   * Identitet: hver worker-funktion kontrollerer den faktiske databaseidentitet (session_user
--     eller den aktive SET ROLE — aldrig en parameter) og medlemskab af ingestion_worker ved
--     hvert kald. Nødspærring virker derfor straks, også på åbne pooler-forbindelser.
--   * Lease-capability: worker_claim_job udsteder en uforudsigelig lease-token. Kun dens hash
--     (bundet til jobbet) gemmes. Job-id alene giver aldrig adgang.
--   * Billetter til filer: DB-kontrakten for engangsbilletter (D-10 pkt. 3). Ingen Edge
--     Function og ingen download i dette deltrin.
--   * service_role: har ikke længere EXECUTE på worker-funktionerne. Lokalt får service_role
--     medlemskab af ingestion_worker fra det lokale seed (supabase/seed.sql, development-only).
--
-- Migrationen indeholder ingen credentials.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Roller (klyngebrede, derfor idempotent). Findes en rolle allerede, skal dens attributter
--    være de forventede — ellers stopper migrationen.
-- ----------------------------------------------------------------------------

do $$
declare
  v_name text;
  v_role record;
begin
  foreach v_name in array array['ingestion_worker', 'ingestion_worker_login_blue', 'ingestion_worker_login_green'] loop
    select * into v_role from pg_catalog.pg_roles where rolname = v_name;
    if not found then
      if v_name = 'ingestion_worker' then
        execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls', v_name);
      else
        execute format(
          'create role %I nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 5 password null',
          v_name);
      end if;
    elsif v_role.rolsuper or v_role.rolcreaterole or v_role.rolcreatedb or v_role.rolreplication or v_role.rolbypassrls then
      raise exception 'Rollen % findes med for brede attributter', v_name;
    end if;
  end loop;
end;
$$;

-- Sessionsindstillinger for login-rollerne. Ingen sessionstilstand i øvrigt (Supavisors
-- transaktionstilstand, docs/08b §21.4).
alter role ingestion_worker_login_blue set statement_timeout = '60s';
alter role ingestion_worker_login_blue set lock_timeout = '10s';
alter role ingestion_worker_login_blue set idle_in_transaction_session_timeout = '30s';
alter role ingestion_worker_login_blue set search_path = '';
alter role ingestion_worker_login_green set statement_timeout = '60s';
alter role ingestion_worker_login_green set lock_timeout = '10s';
alter role ingestion_worker_login_green set idle_in_transaction_session_timeout = '30s';
alter role ingestion_worker_login_green set search_path = '';

comment on role ingestion_worker is
  'Ingestion-workerens capability (8B-I3, D-10): kun EXECUTE på de godkendte knowledge.worker_*-funktioner. Ingen tabelrettigheder.';
comment on role ingestion_worker_login_blue is
  'Workerens login-rolle, blue (D-20). Aktiveres og deaktiveres kun via ops.ingestion_worker_*.';
comment on role ingestion_worker_login_green is
  'Workerens login-rolle, green (D-20). Aktiveres og deaktiveres kun via ops.ingestion_worker_*.';

grant usage on schema knowledge to ingestion_worker;

-- ----------------------------------------------------------------------------
-- 2. Identitet: den faktiske databaseidentitet bag kaldet.
--
-- Inde i en security definer-funktion er current_user ejeren. Rollen bag kaldet er den aktive
-- SET ROLE (indstillingen "role", som definer-skiftet ikke ændrer, og som kun kan sættes til en
-- rolle, man er medlem af) eller, uden SET ROLE, session_user (login-rollen). Ingen af dem kan
-- angives som parameter.
-- ----------------------------------------------------------------------------

create or replace function knowledge.effective_db_role()
returns text
language sql
stable
set search_path = ''
as $$
  select case when pg_catalog.current_setting('role') = 'none' then session_user::text
              else pg_catalog.current_setting('role') end
$$;

-- Kalderen skal være en af workerens login-roller (eller, kun lokalt, service_role) OG have
-- medlemskab af ingestion_worker lige nu. Returnerer rollen.
create or replace function knowledge.assert_worker_caller()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_role text := knowledge.effective_db_role();
begin
  if v_role in ('ingestion_worker_login_blue', 'ingestion_worker_login_green', 'service_role')
     and pg_catalog.pg_has_role(v_role, 'ingestion_worker', 'USAGE') then
    return v_role;
  end if;
  raise exception 'Kun ingestion-workeren må kalde denne funktion' using errcode = 'insufficient_privilege';
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Lease-capability
-- ----------------------------------------------------------------------------

-- Kendte jobs i gang fra før deltrinnet har ingen token. De sættes i kø igen (forsøgstallet
-- bevares), så ingen lease findes uden token.
update knowledge.ingestion_jobs
set status = 'queued', locked_by = null, locked_until = null, next_attempt_at = now()
where status = 'running';

alter table knowledge.ingestion_jobs
  add column lease_token_hash bytea check (lease_token_hash is null or octet_length(lease_token_hash) = 32);
alter table knowledge.ingestion_jobs
  add constraint ingestion_jobs_lease_token check ((status = 'running') = (lease_token_hash is not null));

comment on column knowledge.ingestion_jobs.lease_token_hash is
  'SHA-256 af job-id og lease-token (8B-I3). Selve tokenet gemmes aldrig. Kun mens jobbet kører.';

-- Når et job forlader running (afsluttet, fejlet, annulleret, sat i kø), er leasen væk.
create or replace function knowledge.clear_lease_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'running' then
    new.lease_token_hash := null;
  end if;
  return new;
end;
$$;

create trigger ingestion_jobs_clear_lease_token
  before update on knowledge.ingestion_jobs
  for each row execute function knowledge.clear_lease_token();

-- 64 hex-tegn fra to v4-UUID'er (pg_strong_random, 244 tilfældige bit). Ingen ny extension.
create or replace function knowledge.random_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
$$;

-- Hashen binder tokenet til jobbet: et token for ét job passer aldrig til et andet.
create or replace function knowledge.lease_hash(p_job_id uuid, p_lease_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p_job_id::text || ':' || p_lease_token, 'UTF8'))
$$;

-- Jobbet er i gang, leasen er ikke udløbet, og tokenet passer. Låser og returnerer jobbet.
-- Én ensartet fejl for forkert job, forkert/forfalsket/gammelt token, udløbet lease og
-- afsluttet job (genafspilning).
create or replace function knowledge.lease_job(p_job_id uuid, p_lease_token text)
returns knowledge.ingestion_jobs
language plpgsql
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
begin
  if p_job_id is not null and p_lease_token is not null and p_lease_token ~ '^[0-9a-f]{64}$' then
    select j.* into v_job
    from knowledge.ingestion_jobs j
    where j.id = p_job_id
      and j.status = 'running'
      and j.lease_token_hash = knowledge.lease_hash(p_job_id, p_lease_token)
      and j.locked_until > now()
    for update;
  end if;
  if v_job.id is null then
    raise exception 'Jobbet holdes ikke af denne lease' using errcode = 'lock_not_available';
  end if;
  return v_job;
end;
$$;

-- Fælles inputvalidering.
create or replace function knowledge.require_input(p_ok boolean, p_what text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_ok is not true then
    raise exception 'Ugyldigt input: %', p_what using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Worker-API'et. De gamle signaturer (med p_worker som eneste "bevis") fjernes.
-- ----------------------------------------------------------------------------

drop function knowledge.worker_claim_job(text, int);
drop function knowledge.worker_heartbeat(uuid, text, int);
drop function knowledge.worker_checkpoint(uuid, text, text, jsonb);
drop function knowledge.worker_store_pages(uuid, text, jsonb, int, bigint, text, text);
drop function knowledge.worker_store_chunks(uuid, text, jsonb, text);
drop function knowledge.worker_complete_job(uuid, text, jsonb);
drop function knowledge.worker_fail_job(uuid, text, text, text, boolean);
drop function knowledge.worker_chunks_to_embed(uuid, text, uuid);
drop function knowledge.worker_store_embeddings(uuid, text, uuid, jsonb);
drop function knowledge.worker_verify_index(uuid, text);
drop function knowledge.worker_job_version(uuid, text);
drop function knowledge.worker_embedding_models();

-- Tag næste job og få en lease-token. p_worker er kun en etiket til drift (locked_by) — aldrig
-- et bevis. Udløbne leases tages igen og får en ny token; den gamle virker ikke længere.
create function knowledge.worker_claim_job(p_worker text, p_lease_seconds int default 300)
returns table (
  job_id uuid, version_id uuid, kind text, attempts int, max_attempts int, step_state jsonb,
  storage_path text, checksum_sha256 text, document_id uuid, document_type text, product_id uuid,
  title text, version_label text, language text, valid_from date, valid_to date,
  lease_token text, lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job knowledge.ingestion_jobs;
  v_status text;
  v_token text;
begin
  perform knowledge.assert_worker_caller();
  perform knowledge.require_input(p_worker ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$', 'worker-etiket');
  perform knowledge.require_input(p_lease_seconds between 30 and 900, 'lease-varighed (30–900 sekunder)');
  perform knowledge.as_worker();
  loop
    select j.* into v_job
    from knowledge.ingestion_jobs j
    where (j.status = 'queued' and j.next_attempt_at <= now())
       or (j.status = 'running' and j.locked_until < now())
    order by j.next_attempt_at, j.created_at
    limit 1
    for update skip locked;
    if not found then
      return;
    end if;

    select v.status into v_status from knowledge.document_versions v where v.id = v_job.document_version_id for update;

    if (v_job.kind = 'process' and v_status not in ('uploaded', 'processing'))
       or (v_job.kind = 'reembed' and not knowledge.worker_reembed_allowed(v_status)) then
      update knowledge.ingestion_jobs set status = 'cancelled', finished_at = now(), locked_by = null, locked_until = null,
        error_code = 'version_not_processable', error_message = 'Versionen kan ikke længere behandles (status: ' || v_status || ').'
      where id = v_job.id;
      continue;
    end if;

    if v_job.status = 'running' and v_job.attempts >= v_job.max_attempts then
      update knowledge.ingestion_jobs set status = 'failed', finished_at = now(), locked_by = null, locked_until = null,
        error_code = 'worker_lost', error_message = 'Behandlingen blev afbrudt for mange gange.'
      where id = v_job.id;
      if v_status = 'processing' then
        update knowledge.document_versions set status = 'processing_failed' where id = v_job.document_version_id;
      end if;
      continue;
    end if;

    v_token := knowledge.random_token();
    update knowledge.ingestion_jobs
    set status = 'running', locked_by = p_worker, locked_until = now() + make_interval(secs => p_lease_seconds),
        lease_token_hash = knowledge.lease_hash(v_job.id, v_token),
        attempts = attempts + 1, started_at = coalesce(started_at, now()), error_code = null, error_message = null
    where id = v_job.id;

    if v_job.kind = 'process' and v_status = 'uploaded' then
      update knowledge.document_versions set status = 'processing' where id = v_job.document_version_id;
    end if;

    return query
    select j.id, v.id, j.kind, j.attempts, j.max_attempts, j.step_state,
           v.storage_path, v.checksum_sha256, d.id, d.document_type, d.product_id,
           d.title, v.version_label, v.language, v.valid_from, v.valid_to,
           v_token, j.locked_until
    from knowledge.ingestion_jobs j
    join knowledge.document_versions v on v.id = j.document_version_id
    join knowledge.documents d on d.id = v.document_id
    where j.id = v_job.id;
    return;
  end loop;
end;
$$;

-- Forlæng en gyldig lease (samme token). En udløbet lease kan ikke genoplives.
create function knowledge.worker_heartbeat(p_job_id uuid, p_lease_token text, p_lease_seconds int default 300)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v_until timestamptz;
begin
  perform knowledge.assert_worker_caller();
  perform knowledge.require_input(p_lease_seconds between 30 and 900, 'lease-varighed (30–900 sekunder)');
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  update knowledge.ingestion_jobs set locked_until = now() + make_interval(secs => p_lease_seconds)
  where id = v_job.id
  returning locked_until into v_until;
  return v_until;
end;
$$;

-- Checkpoint: et trin er gennemført. Ved genforsøg genoptages fra næste trin.
create function knowledge.worker_checkpoint(p_job_id uuid, p_lease_token text, p_step text, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(p_step ~ '^[a-z][a-z0-9_]{0,62}$', 'trin');
  perform knowledge.require_input(
    p_state is null or (jsonb_typeof(p_state) = 'object' and octet_length(p_state::text) <= 65536), 'trinets tilstand');
  update knowledge.ingestion_jobs
  set current_step = p_step, step_state = step_state || jsonb_build_object(p_step, coalesce(p_state, '{}'::jsonb))
  where id = v_job.id;
end;
$$;

-- Tekstudtræk: sider og filens tekniske data (kun behandlingsjobs).
create function knowledge.worker_store_pages(
  p_job_id uuid, p_lease_token text, p_pages jsonb, p_page_count int, p_byte_size bigint, p_mime_type text, p_extractor_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(v_job.kind = 'process', 'sider gemmes kun af et behandlingsjob');
  perform knowledge.require_input(
    jsonb_typeof(p_pages) = 'array' and jsonb_array_length(p_pages) between 1 and 2000, 'sider (1–2000)');
  perform knowledge.require_input(p_page_count between 1 and 2000, 'sideantal');
  perform knowledge.require_input(p_byte_size between 1 and 52428800, 'filstørrelse');
  perform knowledge.require_input(p_mime_type = 'application/pdf', 'filtype');
  perform knowledge.require_input(p_extractor_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,99}$', 'udtræksversion');
  perform knowledge.as_worker();
  delete from knowledge.document_pages where document_version_id = v_job.document_version_id;
  insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
  select v_job.document_version_id, (p ->> 'page_number')::int, coalesce(p ->> 'text', ''), (p ->> 'has_text_layer')::boolean,
         (p ->> 'char_start')::int, (p ->> 'char_end')::int
  from jsonb_array_elements(p_pages) p;
  update knowledge.document_versions
  set page_count = p_page_count, byte_size = p_byte_size, mime_type = p_mime_type,
      extractor_version = p_extractor_version, checksum_verified_at = now()
  where id = v_job.document_version_id;
end;
$$;

-- Chunks erstattes samlet (idempotent, kun behandlingsjobs).
create function knowledge.worker_store_chunks(p_job_id uuid, p_lease_token text, p_chunks jsonb, p_chunker_version text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v_count int;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(v_job.kind = 'process', 'chunks gemmes kun af et behandlingsjob');
  perform knowledge.require_input(
    jsonb_typeof(p_chunks) = 'array' and jsonb_array_length(p_chunks) between 1 and 20000, 'chunks (1–20000)');
  perform knowledge.require_input(p_chunker_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,99}$', 'chunker-version');
  perform knowledge.as_worker();
  delete from knowledge.document_chunks where document_version_id = v_job.document_version_id;
  insert into knowledge.document_chunks (
    document_version_id, chunk_index, kind, text, lead_in, heading, heading_path, section_number,
    page_start, page_end, char_start, char_end, overlap_chars, content_hash, char_count, token_estimate
  )
  select v_job.document_version_id, (c ->> 'chunk_index')::int, c ->> 'kind', c ->> 'text', nullif(c ->> 'lead_in', ''), c ->> 'heading',
         coalesce(array(select jsonb_array_elements_text(c -> 'heading_path')), '{}'), c ->> 'section_number',
         (c ->> 'page_start')::int, (c ->> 'page_end')::int, (c ->> 'char_start')::int, (c ->> 'char_end')::int,
         coalesce((c ->> 'overlap_chars')::int, 0), c ->> 'content_hash', (c ->> 'char_count')::int, (c ->> 'token_estimate')::int
  from jsonb_array_elements(p_chunks) c;
  get diagnostics v_count = row_count;
  update knowledge.document_versions set chunker_version = p_chunker_version where id = v_job.document_version_id;
  return v_count;
end;
$$;

-- Workerens modeller: den aktive og eventuelle kandidater (docs/07 §5.2 trin 8).
create function knowledge.worker_embedding_models()
returns table (id uuid, provider text, model_name text, model_version text, dimensions int, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform knowledge.assert_worker_caller();
  return query
  select m.id, m.provider, m.model_name, m.model_version, m.dimensions, m.status
  from knowledge.embedding_models m where m.status in ('active', 'candidate')
  order by (m.status = 'active') desc, m.created_at;
end;
$$;

-- Modellen skal være aktiv eller kandidat.
create or replace function knowledge.require_worker_model(p_model_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from knowledge.embedding_models where id = p_model_id and status in ('active', 'candidate')) then
    raise exception 'Modellen findes ikke eller er udfaset' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Chunks i jobbets version, der mangler en embedding for modellen (idempotent genoptagelse).
create function knowledge.worker_chunks_to_embed(p_job_id uuid, p_lease_token text, p_model_id uuid)
returns table (chunk_id uuid, text text, lead_in text, heading_path text[], language text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_worker_model(p_model_id);
  return query
  select c.id, c.text, c.lead_in, c.heading_path, v.language
  from knowledge.document_chunks c
  join knowledge.document_versions v on v.id = c.document_version_id
  where c.document_version_id = v_job.document_version_id
    and not exists (select 1 from knowledge.chunk_embeddings e where e.chunk_id = c.id and e.embedding_model_id = p_model_id)
  order by c.chunk_index;
end;
$$;

-- Embeddings for jobbets egne chunks. Et chunk fra en anden version afviser hele kaldet.
-- Gentagelse er idempotent (eksisterende embeddings bevares).
create function knowledge.worker_store_embeddings(p_job_id uuid, p_lease_token text, p_model_id uuid, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v_count int;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_worker_model(p_model_id);
  perform knowledge.require_input(
    jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 2000, 'embeddings (1–2000)');
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where jsonb_typeof(r) <> 'object'
       or not exists (
         select 1 from knowledge.document_chunks c
         where c.id::text = r ->> 'chunk_id' and c.document_version_id = v_job.document_version_id
       )
  ) then
    raise exception 'Embeddings må kun gælde jobbets egne chunks' using errcode = 'check_violation';
  end if;
  perform knowledge.as_worker();
  insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
  select (r ->> 'chunk_id')::uuid, p_model_id, ((r -> 'embedding')::text)::extensions.vector, r ->> 'language', r ->> 'input_hash'
  from jsonb_array_elements(p_rows) r
  on conflict (chunk_id, embedding_model_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function knowledge.worker_verify_index(p_job_id uuid, p_lease_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  return knowledge.embedding_integrity(v_job.document_version_id);
end;
$$;

-- Behandlingen er færdig: rapport + fakta fra databasen → processed (klar til review). Leasen
-- ophører; et gentaget kald afvises (lease_job).
create function knowledge.worker_complete_job(p_job_id uuid, p_lease_token text, p_quality_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v_report jsonb;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(
    p_quality_report is null or (jsonb_typeof(p_quality_report) = 'object' and octet_length(p_quality_report::text) <= 262144),
    'kvalitetsrapport');
  perform knowledge.as_worker();
  v_report := coalesce(p_quality_report, '{}'::jsonb) || knowledge.compute_quality_facts(v_job.document_version_id)
              || jsonb_build_object('generated_at', now());
  update knowledge.ingestion_jobs
  set status = 'succeeded', finished_at = now(), locked_by = null, locked_until = null,
      quality_report = case when v_job.kind = 'process' then v_report else quality_report end
  where id = v_job.id;
  if v_job.kind = 'process' then
    update knowledge.document_versions set status = 'processed' where id = v_job.document_version_id;
  end if;
  return v_report;
end;
$$;

-- Et trin fejlede. Genforsøg med eksponentiel backoff, ellers failed (og processing_failed).
-- Er også workerens måde at frigive et job på (genforsøg). Leasen ophører.
create function knowledge.worker_fail_job(
  p_job_id uuid, p_lease_token text, p_error_code text, p_error_message text, p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(p_error_code ~ '^[a-z][a-z0-9_]{0,62}$', 'fejlkode');
  perform knowledge.require_input(p_error_message is not null and char_length(p_error_message) between 1 and 4000, 'fejlbesked');
  perform knowledge.require_input(p_retryable is not null, 'genforsøg');
  perform knowledge.as_worker();
  if p_retryable and v_job.attempts < v_job.max_attempts then
    update knowledge.ingestion_jobs
    set status = 'queued', locked_by = null, locked_until = null,
        next_attempt_at = now() + make_interval(secs => 30 * power(2, v_job.attempts - 1)::int),
        error_code = p_error_code, error_message = left(p_error_message, 1000)
    where id = v_job.id;
    return 'retry';
  end if;
  update knowledge.ingestion_jobs
  set status = 'failed', finished_at = now(), locked_by = null, locked_until = null,
      error_code = p_error_code, error_message = left(p_error_message, 1000)
  where id = v_job.id;
  if v_job.kind = 'process' then
    update knowledge.document_versions set status = 'processing_failed' where id = v_job.document_version_id and status = 'processing';
  end if;
  return 'failed';
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Engangsbilletter til filer (D-10 pkt. 3) — kun DB-kontrakten. Ingen Edge Function.
-- ----------------------------------------------------------------------------

create table knowledge.worker_storage_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  job_id uuid not null references knowledge.ingestion_jobs (id) on delete cascade,
  document_version_id uuid not null references knowledge.document_versions (id) on delete cascade,
  bucket text not null check (bucket = 'knowledge-originals'),
  object_path text not null check (char_length(object_path) between 1 and 1024),
  -- Kun download af originalen i dette deltrin. Karantæne kommer med sit eget deltrin.
  purpose text not null check (purpose in ('download_original')),
  -- Leasen, billetten er udstedt under. En ny lease (genoptaget job) gør billetten ugyldig.
  lease_token_hash bytea not null check (octet_length(lease_token_hash) = 32),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '60 seconds'),
  check (used_at is null or used_at >= issued_at)
);

create index worker_storage_tickets_job_idx on knowledge.worker_storage_tickets (job_id);

comment on table knowledge.worker_storage_tickets is
  'Engangsbilletter til workerens filadgang (8B-I3, D-10 pkt. 3). Kun hash af billetten gemmes. Ingen direkte adgang for nogen rolle.';

alter table knowledge.worker_storage_tickets enable row level security;
revoke all on knowledge.worker_storage_tickets from public, anon, authenticated, service_role;

-- Udsted en billet under en gyldig lease. Formålet skal passe til jobbet og versionens tilstand.
-- Højst 3 ubrugte, gyldige billetter pr. job ad gangen.
create function knowledge.worker_issue_storage_ticket(p_job_id uuid, p_lease_token text, p_purpose text)
returns table (ticket text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job knowledge.ingestion_jobs;
  v_version knowledge.document_versions;
  v_ticket text;
  v_expires timestamptz := now() + interval '60 seconds';
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(p_purpose = 'download_original', 'formål');
  select * into v_version from knowledge.document_versions where id = v_job.document_version_id;
  if v_job.kind <> 'process' or v_version.status <> 'processing' then
    raise exception 'Formålet passer ikke til jobbet eller versionens tilstand' using errcode = 'check_violation';
  end if;
  if (select count(*) from knowledge.worker_storage_tickets t
      where t.job_id = v_job.id and t.used_at is null and t.expires_at > now()) >= 3 then
    raise exception 'For mange ubrugte billetter for jobbet' using errcode = 'program_limit_exceeded';
  end if;
  v_ticket := knowledge.random_token();
  insert into knowledge.worker_storage_tickets
    (token_hash, job_id, document_version_id, bucket, object_path, purpose, lease_token_hash, issued_at, expires_at)
  values
    (pg_catalog.sha256(pg_catalog.convert_to(v_ticket, 'UTF8')), v_job.id, v_version.id, 'knowledge-originals',
     v_version.storage_path, p_purpose, v_job.lease_token_hash, now(), v_expires);
  return query select v_ticket, v_expires;
end;
$$;

-- Indløs en billet (kontrakten for Edge Function worker-storage, som bygges i et senere
-- deltrin). Kun service_role, kun én gang, kun inden udløb og kun mens leasen, billetten blev
-- udstedt under, stadig gælder. Returnerer præcis den ene operation, billetten giver.
create function knowledge.redeem_worker_storage_ticket(p_ticket text)
returns table (bucket text, object_path text, purpose text, checksum_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ticket knowledge.worker_storage_tickets;
  v_checksum text;
begin
  if knowledge.effective_db_role() <> 'service_role' then
    raise exception 'Kun lagerfunktionen må indløse billetter' using errcode = 'insufficient_privilege';
  end if;
  if p_ticket is not null and p_ticket ~ '^[0-9a-f]{64}$' then
    select t.* into v_ticket
    from knowledge.worker_storage_tickets t
    join knowledge.ingestion_jobs j on j.id = t.job_id
    join knowledge.document_versions v on v.id = t.document_version_id
    where t.token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_ticket, 'UTF8'))
      and t.used_at is null
      and t.expires_at > now()
      and j.status = 'running' and j.lease_token_hash = t.lease_token_hash and j.locked_until > now()
      and v.status = 'processing' and v.storage_path = t.object_path
    for update of t;
  end if;
  if v_ticket.id is null then
    raise exception 'Billetten er ugyldig, brugt eller udløbet' using errcode = 'invalid_authorization_specification';
  end if;
  update knowledge.worker_storage_tickets set used_at = now() where id = v_ticket.id;
  select v.checksum_sha256 into v_checksum from knowledge.document_versions v where v.id = v_ticket.document_version_id;
  return query select v_ticket.bucket, v_ticket.object_path, v_ticket.purpose, v_checksum;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Drift (D-20): rotation og nødspærring. Skemaet ops har ingen rettigheder for andre end
--    ejeren (migrationsrollen, postgres). Funktionerne kører som kalderen (security invoker):
--    kun ejeren — der har ADMIN på worker-rollerne — kan bruge dem. Ingen passwords passerer
--    gennem funktionerne; passwordet sættes klientside med psql \password (SCRAM-verifier).
-- ----------------------------------------------------------------------------

create schema if not exists ops;
revoke all on schema ops from public;

comment on schema ops is
  'Driftsfunktioner til workerens identitet (8B-I3, D-20). Ingen rettigheder for app-roller.';

-- Det godkendte worker-API: den eneste liste over, hvad ingestion_worker må køre.
create or replace function ops.ingestion_worker_api()
returns regprocedure[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'knowledge.worker_claim_job(text, int)',
    'knowledge.worker_heartbeat(uuid, text, int)',
    'knowledge.worker_checkpoint(uuid, text, text, jsonb)',
    'knowledge.worker_store_pages(uuid, text, jsonb, int, bigint, text, text)',
    'knowledge.worker_store_chunks(uuid, text, jsonb, text)',
    'knowledge.worker_embedding_models()',
    'knowledge.worker_chunks_to_embed(uuid, text, uuid)',
    'knowledge.worker_store_embeddings(uuid, text, uuid, jsonb)',
    'knowledge.worker_verify_index(uuid, text)',
    'knowledge.worker_complete_job(uuid, text, jsonb)',
    'knowledge.worker_fail_job(uuid, text, text, text, boolean)',
    'knowledge.worker_issue_storage_ticket(uuid, text, text)'
  ]::regprocedure[]
$$;

create or replace function ops.ingestion_worker_require_role(p_role text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('ingestion_worker_login_blue', 'ingestion_worker_login_green') then
    raise exception 'Ukendt worker-rolle: %', p_role using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create or replace function ops.ingestion_worker_audit(p_action text, p_role text, p_details jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, details)
  values (null, p_action, 'ops', 'pg_roles', p_role, coalesce(p_details, '{}'::jsonb) || jsonb_build_object('db_user', session_user::text));
$$;

-- Giv (true) eller fjern (false) gruppens EXECUTE på hele API'et. false er den globale
-- nødbremse: begge login-roller stopper ved næste kald.
create or replace function ops.ingestion_worker_set_api(p_enabled boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array ops.ingestion_worker_api() loop
    if p_enabled then
      execute format('grant execute on function %s to ingestion_worker', v_fn);
    else
      execute format('revoke execute on function %s from ingestion_worker', v_fn);
    end if;
  end loop;
  perform ops.ingestion_worker_audit(
    case when p_enabled then 'ops.ingestion_worker.api_enabled' else 'ops.ingestion_worker.api_disabled' end, null, '{}'::jsonb);
end;
$$;

-- Rotation trin 1 (klargør): rollen får LOGIN og medlemskab. Passwordet sættes FØR med
-- \password (klientside) og lægges i Secrets Manager (docs/08b §21.4).
create or replace function ops.ingestion_worker_prepare(p_role text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform ops.ingestion_worker_require_role(p_role);
  execute format('alter role %I login', p_role);
  execute format('grant ingestion_worker to %I with inherit true, set false', p_role);
  perform ops.ingestion_worker_audit('ops.ingestion_worker.prepared', p_role, '{}'::jsonb);
end;
$$;

-- Fælles deaktivering: medlemskab væk (virker ved næste funktionskald), NOLOGIN, intet
-- password, sessioner afbrudt. Ændrer ingen domænedata.
create or replace function ops.ingestion_worker_deactivate(p_role text, p_reason text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_terminated int := 0;
  v_pid int;
begin
  perform ops.ingestion_worker_require_role(p_role);
  if pg_catalog.pg_has_role(p_role, 'ingestion_worker', 'MEMBER') then
    execute format('revoke ingestion_worker from %I', p_role);
  end if;
  if pg_catalog.pg_has_role(p_role, 'ingestion_worker', 'MEMBER') then
    raise exception 'Rollen % er stadig medlem af ingestion_worker (tildelt af en anden rolle)', p_role;
  end if;
  execute format('alter role %I nologin password null', p_role);
  -- Først rollens sessioner, derefter afbrydelse én ad gangen. (I én WHERE-klausul afgør
  -- planneren rækkefølgen, og pg_terminate_backend kunne ramme andre sessioner.)
  for v_pid in
    select a.pid from pg_catalog.pg_stat_activity a where a.usename = p_role and a.pid <> pg_catalog.pg_backend_pid()
  loop
    if pg_catalog.pg_terminate_backend(v_pid) then
      v_terminated := v_terminated + 1;
    end if;
  end loop;
  perform ops.ingestion_worker_audit('ops.ingestion_worker.' || p_reason, p_role, jsonb_build_object('terminated_sessions', v_terminated));
  return v_terminated;
end;
$$;

-- Rotation trin 5 (deaktivér den gamle rolle).
create or replace function ops.ingestion_worker_retire(p_role text)
returns int
language sql
set search_path = ''
as $$
  select ops.ingestion_worker_deactivate(p_role, 'retired')
$$;

-- Nødspærring af én rolle. Kan køres igen, hvis status() stadig viser sessioner.
create or replace function ops.ingestion_worker_emergency_revoke(p_role text)
returns int
language sql
set search_path = ''
as $$
  select ops.ingestion_worker_deactivate(p_role, 'emergency_revoked')
$$;

-- Tilstand til runbookens verifikation. "violations" skal være tom i produktion.
create or replace function ops.ingestion_worker_status()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with roles as (
    select r.rolname, r.rolcanlogin, r.rolconnlimit,
           pg_catalog.pg_has_role(r.rolname, 'ingestion_worker', 'MEMBER') as is_member,
           (select count(*) from pg_catalog.pg_stat_activity a where a.usename = r.rolname)::int as sessions
    from pg_catalog.pg_roles r
    where r.rolname in ('ingestion_worker_login_blue', 'ingestion_worker_login_green')
  ),
  api as (
    select count(*) filter (where pg_catalog.has_function_privilege('ingestion_worker', f, 'EXECUTE'))::int as granted,
           count(*)::int as expected
    from unnest(ops.ingestion_worker_api()) f
  ),
  extra as (
    select count(*)::int as n
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
      and pg_catalog.has_schema_privilege('ingestion_worker', n.oid, 'USAGE')
      and pg_catalog.has_function_privilege('ingestion_worker', p.oid, 'EXECUTE')
      and not (p.oid::regprocedure = any (ops.ingestion_worker_api()))
  )
  select jsonb_build_object(
    'roles', (select jsonb_agg(jsonb_build_object('role', rolname, 'login', rolcanlogin, 'member', is_member,
                                                  'connection_limit', rolconnlimit, 'sessions', sessions) order by rolname) from roles),
    'api', (select jsonb_build_object('granted', granted, 'expected', expected) from api),
    'service_role_is_worker', pg_catalog.pg_has_role('service_role', 'ingestion_worker', 'MEMBER'),
    'violations', to_jsonb(array_remove(array[
      case when pg_catalog.pg_has_role('service_role', 'ingestion_worker', 'MEMBER') then 'service_role_is_worker' end,
      case when (select n from extra) > 0 then 'extra_executable_functions' end,
      case when exists (select 1 from roles where is_member and not rolcanlogin) then 'member_without_login' end,
      case when exists (select 1 from roles where rolcanlogin and not is_member) then 'login_without_membership' end
    ], null))
  )
$$;

revoke all on function
  ops.ingestion_worker_api(),
  ops.ingestion_worker_require_role(text),
  ops.ingestion_worker_audit(text, text, jsonb),
  ops.ingestion_worker_set_api(boolean),
  ops.ingestion_worker_prepare(text),
  ops.ingestion_worker_deactivate(text, text),
  ops.ingestion_worker_retire(text),
  ops.ingestion_worker_emergency_revoke(text),
  ops.ingestion_worker_status()
from public;

-- ----------------------------------------------------------------------------
-- 7. Rettigheder
-- ----------------------------------------------------------------------------

revoke all on function
  knowledge.effective_db_role(),
  knowledge.assert_worker_caller(),
  knowledge.clear_lease_token(),
  knowledge.random_token(),
  knowledge.lease_hash(uuid, text),
  knowledge.lease_job(uuid, text),
  knowledge.require_input(boolean, text),
  knowledge.require_worker_model(uuid),
  knowledge.worker_claim_job(text, int),
  knowledge.worker_heartbeat(uuid, text, int),
  knowledge.worker_checkpoint(uuid, text, text, jsonb),
  knowledge.worker_store_pages(uuid, text, jsonb, int, bigint, text, text),
  knowledge.worker_store_chunks(uuid, text, jsonb, text),
  knowledge.worker_embedding_models(),
  knowledge.worker_chunks_to_embed(uuid, text, uuid),
  knowledge.worker_store_embeddings(uuid, text, uuid, jsonb),
  knowledge.worker_verify_index(uuid, text),
  knowledge.worker_complete_job(uuid, text, jsonb),
  knowledge.worker_fail_job(uuid, text, text, text, boolean),
  knowledge.worker_issue_storage_ticket(uuid, text, text),
  knowledge.redeem_worker_storage_ticket(text)
from public, anon, authenticated, service_role;

-- Workerens API: kun gruppen. service_role har det ikke (lokalt kun via seedets medlemskab).
select ops.ingestion_worker_set_api(true);

-- Billetindløsning: kun service_role (Edge Function worker-storage i et senere deltrin).
grant execute on function knowledge.redeem_worker_storage_ticket(text) to service_role;

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt, kun hvis deltrinnet skal fjernes): genskab funktionerne fra
-- 20261001000300/0400 med p_worker, drop knowledge.worker_storage_tickets, kolonnen
-- lease_token_hash, triggeren og hjælpefunktionerne, drop schema ops cascade, og
-- "drop role ingestion_worker_login_blue, ingestion_worker_login_green, ingestion_worker".
-- ----------------------------------------------------------------------------
