-- ============================================================================
-- Fase 7, trin 3 — Ingestion-workerens kø og funktioner
--
-- Specifikation: docs/07 §5 (pipeline), §2.3 (fejl og genforsøg) og §14.1 (workerens
-- adgang). Workeren kalder KUN disse navngivne funktioner. De er kun eksekverbare for
-- service_role, kontrollerer selv job, lease og versionsstatus og kan aldrig publicere.
--
--   * Kø: knowledge.ingestion_jobs, taget med FOR UPDATE SKIP LOCKED og en lease.
--   * Hvert trin skriver sit output erstattende for versionen (slet og indsæt), og kun
--     mens versionen behandles (triggeren fra trin 1 håndhæver det).
--   * Genforsøg med backoff op til max_attempts; derefter processing_failed med årsag.
--   * Workerens hændelser auditeres med actor = ingestion_worker.
-- ============================================================================

-- Markerer resten af transaktionen som udført af workeren (læses af knowledge.write_audit).
create or replace function knowledge.as_worker()
returns void
language sql
set search_path = ''
as $$
  select set_config('ipa.actor', 'ingestion_worker', true);
$$;

-- Jobbet skal være i gang og holdes af denne worker. Returnerer versionen.
create or replace function knowledge.worker_job_version(p_job_id uuid, p_worker text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid;
begin
  select j.document_version_id into v_version
  from knowledge.ingestion_jobs j
  where j.id = p_job_id and j.status = 'running' and j.locked_by = p_worker
  for update;
  if v_version is null then
    raise exception 'Jobbet holdes ikke af denne worker' using errcode = 'lock_not_available';
  end if;
  return v_version;
end;
$$;

-- Faktuelle kvalitetsoplysninger fra databasen (docs/07 §5.3): manglende metadata,
-- dubletter, overlap og huller i gyldigheden og manglende adgangstildelinger. Bruges når
-- behandlingen afsluttes og igen ved review. Træffer ingen afgørelser.
create or replace function knowledge.compute_quality_facts(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_missing text[] := '{}';
  v_duplicates jsonb;
  v_overlaps jsonb;
  v_gap_before date;
  v_gap_after date;
  v_grants int;
begin
  select ver.*, d.title, d.product_id, d.document_type, p.status as product_status
  into v
  from knowledge.document_versions ver
  join knowledge.documents d on d.id = ver.document_id
  join knowledge.products p on p.id = d.product_id
  where ver.id = p_version_id;
  if not found then
    return '{}'::jsonb;
  end if;

  if v.version_label is null then v_missing := array_append(v_missing, 'version_label'); end if;
  if v.valid_from is null then v_missing := array_append(v_missing, 'valid_from'); end if;
  if v.title is null or btrim(v.title) = '' then v_missing := array_append(v_missing, 'title'); end if;
  if v.language is null then v_missing := array_append(v_missing, 'language'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('version_id', o.id, 'document_id', o.document_id, 'status', o.status)), '[]'::jsonb)
  into v_duplicates
  from knowledge.document_versions o
  where o.checksum_sha256 = v.checksum_sha256 and o.id <> v.id and o.status <> 'discarded';

  -- Overlap med publicerede versioner af samme dokument og sprog.
  select coalesce(jsonb_agg(jsonb_build_object(
           'version_id', o.id, 'version_label', o.version_label, 'valid_from', o.valid_from, 'valid_to', o.valid_to)), '[]'::jsonb)
  into v_overlaps
  from knowledge.document_versions o
  where v.valid_from is not null
    and o.document_id = v.document_id and o.language = v.language and o.status = 'published' and o.id <> v.id
    and daterange(o.valid_from, o.valid_to, '[)') && daterange(v.valid_from, v.valid_to, '[)');

  -- Huller: dage uden gyldig version lige før eller efter denne versions periode.
  if v.valid_from is not null then
    select max(o.valid_to) into v_gap_before
    from knowledge.document_versions o
    where o.document_id = v.document_id and o.language = v.language and o.status = 'published'
      and o.id <> v.id and o.valid_to is not null and o.valid_to < v.valid_from
      and not exists (
        select 1 from knowledge.document_versions x
        where x.document_id = v.document_id and x.language = v.language and x.status = 'published' and x.id <> v.id
          and daterange(x.valid_from, x.valid_to, '[)') @> (v.valid_from - 1)
      );
    if v.valid_to is not null then
      select min(o.valid_from) into v_gap_after
      from knowledge.document_versions o
      where o.document_id = v.document_id and o.language = v.language and o.status = 'published'
        and o.id <> v.id and o.valid_from > v.valid_to
        and not exists (
          select 1 from knowledge.document_versions x
          where x.document_id = v.document_id and x.language = v.language and x.status = 'published' and x.id <> v.id
            and daterange(x.valid_from, x.valid_to, '[)') @> v.valid_to
        );
    end if;
  end if;

  select count(*)::int into v_grants
  from knowledge.document_access_grants g where g.document_id = v.document_id;

  return jsonb_build_object(
    'metadata', jsonb_build_object('missing', to_jsonb(v_missing), 'complete', cardinality(v_missing) = 0,
                                   'product_active', v.product_status = 'active'),
    'duplicates', v_duplicates,
    'validity', jsonb_build_object(
      'overlaps', v_overlaps,
      'gap_before', case when v_gap_before is null then null else jsonb_build_object('from', v_gap_before, 'to', v.valid_from) end,
      'gap_after', case when v_gap_after is null then null else jsonb_build_object('from', v.valid_to, 'to', v_gap_after) end
    ),
    'access', jsonb_build_object('grant_count', v_grants, 'no_grants', v_grants = 0)
  );
end;
$$;

-- Tag næste job. Et job, hvis lease er udløbet (worker gået ned), kan tages igen.
-- Versioner, der er kasseret, mens jobbet stod i kø, annullerer jobbet.
create or replace function knowledge.worker_claim_job(p_worker text, p_lease_seconds int default 300)
returns table (
  job_id uuid, version_id uuid, kind text, attempts int, max_attempts int, step_state jsonb,
  storage_path text, checksum_sha256 text, document_id uuid, document_type text, product_id uuid,
  title text, version_label text, language text, valid_from date, valid_to date
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job knowledge.ingestion_jobs;
  v_status text;
begin
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

    if v_job.kind = 'process' and v_status not in ('uploaded', 'processing') then
      update knowledge.ingestion_jobs set status = 'cancelled', finished_at = now(), locked_by = null, locked_until = null,
        error_code = 'version_not_processable', error_message = 'Versionen kan ikke længere behandles (status: ' || v_status || ').'
      where id = v_job.id;
      continue;
    end if;

    if v_job.status = 'running' and v_job.attempts >= v_job.max_attempts then
      -- Workeren er gået ned for mange gange på dette job.
      update knowledge.ingestion_jobs set status = 'failed', finished_at = now(), locked_by = null, locked_until = null,
        error_code = 'worker_lost', error_message = 'Behandlingen blev afbrudt for mange gange.'
      where id = v_job.id;
      if v_status = 'processing' then
        update knowledge.document_versions set status = 'processing_failed' where id = v_job.document_version_id;
      end if;
      continue;
    end if;

    update knowledge.ingestion_jobs
    set status = 'running', locked_by = p_worker, locked_until = now() + make_interval(secs => p_lease_seconds),
        attempts = attempts + 1, started_at = coalesce(started_at, now()), error_code = null, error_message = null
    where id = v_job.id;

    if v_job.kind = 'process' and v_status = 'uploaded' then
      update knowledge.document_versions set status = 'processing' where id = v_job.document_version_id;
    end if;

    return query
    select j.id, v.id, j.kind, j.attempts, j.max_attempts, j.step_state,
           v.storage_path, v.checksum_sha256, d.id, d.document_type, d.product_id,
           d.title, v.version_label, v.language, v.valid_from, v.valid_to
    from knowledge.ingestion_jobs j
    join knowledge.document_versions v on v.id = j.document_version_id
    join knowledge.documents d on d.id = v.document_id
    where j.id = v_job.id;
    return;
  end loop;
end;
$$;

-- Forlæng leasen under et langt trin.
create or replace function knowledge.worker_heartbeat(p_job_id uuid, p_worker text, p_lease_seconds int default 300)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform knowledge.worker_job_version(p_job_id, p_worker);
  update knowledge.ingestion_jobs set locked_until = now() + make_interval(secs => p_lease_seconds) where id = p_job_id;
end;
$$;

-- Checkpoint: et trin er gennemført. Ved genforsøg genoptages fra næste trin.
create or replace function knowledge.worker_checkpoint(p_job_id uuid, p_worker text, p_step text, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform knowledge.worker_job_version(p_job_id, p_worker);
  update knowledge.ingestion_jobs
  set current_step = p_step, step_state = step_state || jsonb_build_object(p_step, coalesce(p_state, '{}'::jsonb))
  where id = p_job_id;
end;
$$;

-- Tekstudtræk: sider (normaliseret tekst og placering i den samlede tekst) samt filens
-- tekniske data. Checksummen er verificeret af workeren mod den erklærede.
create or replace function knowledge.worker_store_pages(
  p_job_id uuid, p_worker text, p_pages jsonb, p_page_count int, p_byte_size bigint, p_mime_type text, p_extractor_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid := knowledge.worker_job_version(p_job_id, p_worker);
begin
  perform knowledge.as_worker();
  delete from knowledge.document_pages where document_version_id = v_version;
  insert into knowledge.document_pages (document_version_id, page_number, text, has_text_layer, char_start, char_end)
  select v_version, (p ->> 'page_number')::int, coalesce(p ->> 'text', ''), (p ->> 'has_text_layer')::boolean,
         (p ->> 'char_start')::int, (p ->> 'char_end')::int
  from jsonb_array_elements(p_pages) p;
  update knowledge.document_versions
  set page_count = p_page_count, byte_size = p_byte_size, mime_type = p_mime_type,
      extractor_version = p_extractor_version, checksum_verified_at = now()
  where id = v_version;
end;
$$;

-- Chunks erstattes samlet (idempotent). Embeddings til chunks slettes med (trin 4).
create or replace function knowledge.worker_store_chunks(p_job_id uuid, p_worker text, p_chunks jsonb, p_chunker_version text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid := knowledge.worker_job_version(p_job_id, p_worker);
  v_count int;
begin
  perform knowledge.as_worker();
  delete from knowledge.document_chunks where document_version_id = v_version;
  insert into knowledge.document_chunks (
    document_version_id, chunk_index, kind, text, lead_in, heading, heading_path, section_number,
    page_start, page_end, char_start, char_end, overlap_chars, content_hash, char_count, token_estimate
  )
  select v_version, (c ->> 'chunk_index')::int, c ->> 'kind', c ->> 'text', nullif(c ->> 'lead_in', ''), c ->> 'heading',
         coalesce(array(select jsonb_array_elements_text(c -> 'heading_path')), '{}'), c ->> 'section_number',
         (c ->> 'page_start')::int, (c ->> 'page_end')::int, (c ->> 'char_start')::int, (c ->> 'char_end')::int,
         coalesce((c ->> 'overlap_chars')::int, 0), c ->> 'content_hash', (c ->> 'char_count')::int, (c ->> 'token_estimate')::int
  from jsonb_array_elements(p_chunks) c;
  get diagnostics v_count = row_count;
  update knowledge.document_versions set chunker_version = p_chunker_version where id = v_version;
  return v_count;
end;
$$;

-- Behandlingen er færdig: rapport + fakta fra databasen → status processed (klar til review).
create or replace function knowledge.worker_complete_job(p_job_id uuid, p_worker text, p_quality_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid := knowledge.worker_job_version(p_job_id, p_worker);
  v_kind text;
  v_report jsonb;
begin
  perform knowledge.as_worker();
  select kind into v_kind from knowledge.ingestion_jobs where id = p_job_id;
  v_report := coalesce(p_quality_report, '{}'::jsonb) || knowledge.compute_quality_facts(v_version)
              || jsonb_build_object('generated_at', now());
  update knowledge.ingestion_jobs
  set status = 'succeeded', finished_at = now(), locked_by = null, locked_until = null,
      quality_report = case when v_kind = 'process' then v_report else quality_report end
  where id = p_job_id;
  if v_kind = 'process' then
    update knowledge.document_versions set status = 'processed' where id = v_version;
  end if;
  return v_report;
end;
$$;

-- Et trin fejlede. Genforsøg med eksponentiel backoff, ellers processing_failed med årsag.
create or replace function knowledge.worker_fail_job(
  p_job_id uuid, p_worker text, p_error_code text, p_error_message text, p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid := knowledge.worker_job_version(p_job_id, p_worker);
  v_job knowledge.ingestion_jobs;
begin
  perform knowledge.as_worker();
  select * into v_job from knowledge.ingestion_jobs where id = p_job_id;
  if p_retryable and v_job.attempts < v_job.max_attempts then
    update knowledge.ingestion_jobs
    set status = 'queued', locked_by = null, locked_until = null,
        next_attempt_at = now() + make_interval(secs => 30 * power(2, v_job.attempts - 1)::int),
        error_code = p_error_code, error_message = left(p_error_message, 1000)
    where id = p_job_id;
    return 'retry';
  end if;
  update knowledge.ingestion_jobs
  set status = 'failed', finished_at = now(), locked_by = null, locked_until = null,
      error_code = p_error_code, error_message = left(p_error_message, 1000)
  where id = p_job_id;
  if v_job.kind = 'process' then
    update knowledge.document_versions set status = 'processing_failed' where id = v_version and status = 'processing';
  end if;
  return 'failed';
end;
$$;

-- ----------------------------------------------------------------------------
-- Gentaget indledning for delte lister og tabeller (docs/07 §6): når en lang liste eller
-- tabel deles, gentages listeindledningen eller tabellens overskriftsrække i hvert chunk.
-- Den gentagne tekst ligger ikke i chunkets [char_start, char_end), så sporbarheden mod den
-- normaliserede tekst bevares. Den indgår i søgningen og i evidensens uddrag.
-- ----------------------------------------------------------------------------

alter table knowledge.document_chunks add column lead_in text check (lead_in is null or char_length(lead_in) > 0);

alter table knowledge.document_chunks drop column fts_da, drop column fts_simple;
alter table knowledge.document_chunks
  add column fts_da tsvector generated always as (
    to_tsvector('danish'::regconfig,
      knowledge.heading_text(heading_path) || ' ' || coalesce(lead_in, '') || ' ' || text)
  ) stored,
  add column fts_simple tsvector generated always as (
    to_tsvector('simple'::regconfig,
      knowledge.heading_text(heading_path) || ' ' || coalesce(lead_in, '') || ' ' || text)
  ) stored;
create index document_chunks_fts_da_idx on knowledge.document_chunks using gin (fts_da);
create index document_chunks_fts_simple_idx on knowledge.document_chunks using gin (fts_simple);

-- ----------------------------------------------------------------------------
-- Rettigheder: kun service_role (workeren). compute_quality_facts bruges også af
-- review-funktionerne i trin 5.
-- ----------------------------------------------------------------------------

revoke all on function
  knowledge.as_worker(),
  knowledge.worker_job_version(uuid, text),
  knowledge.compute_quality_facts(uuid),
  knowledge.worker_claim_job(text, int),
  knowledge.worker_heartbeat(uuid, text, int),
  knowledge.worker_checkpoint(uuid, text, text, jsonb),
  knowledge.worker_store_pages(uuid, text, jsonb, int, bigint, text, text),
  knowledge.worker_store_chunks(uuid, text, jsonb, text),
  knowledge.worker_complete_job(uuid, text, jsonb),
  knowledge.worker_fail_job(uuid, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function
  knowledge.worker_claim_job(text, int),
  knowledge.worker_heartbeat(uuid, text, int),
  knowledge.worker_checkpoint(uuid, text, text, jsonb),
  knowledge.worker_store_pages(uuid, text, jsonb, int, bigint, text, text),
  knowledge.worker_store_chunks(uuid, text, jsonb, text),
  knowledge.worker_complete_job(uuid, text, jsonb),
  knowledge.worker_fail_job(uuid, text, text, text, boolean)
to service_role;
