-- ============================================================================
-- Fase 7, trin 4 — Embeddings (docs/07 §7)
--
--   * Udbyder og model er IKKE låst. Hver embedding bærer sin model; modeller beskrives i
--     knowledge.embedding_models. Søgning sker altid inden for én model.
--   * chunk_embeddings.embedding er `vector` uden fast dimension, så en model ikke låses i
--     skemaet. Hver model får et partielt HNSW-indeks på (embedding::vector(n)) via sin egen
--     migration — en planlagt operation (docs/03 §12).
--   * Højst én aktiv model. Modelskifte: kandidat → re-embedding → evaluering → skifte i én
--     transaktion, kun ved 100 % dækning og kun med system.settings.manage.
--   * Test-embedderen (provider "test") er en tydeligt markeret udviklingsmodel. Den oprettes
--     og aktiveres kun af det lokale udviklingsseed og kan ikke aktiveres gennem funktionen.
-- ============================================================================

create table knowledge.embedding_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9_-]*$'),
  model_name text not null check (char_length(model_name) between 1 and 200),
  model_version text not null check (char_length(model_version) between 1 and 100),
  dimensions int not null check (dimensions between 1 and 2000),
  distance text not null default 'cosine' check (distance = 'cosine'),
  languages text[] not null default '{da}',
  status text not null default 'candidate' check (status in ('candidate', 'active', 'retired')),
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, model_name, model_version)
);

create unique index embedding_models_one_active on knowledge.embedding_models ((true)) where status = 'active';

create table knowledge.chunk_embeddings (
  chunk_id uuid not null references knowledge.document_chunks (id) on delete cascade,
  embedding_model_id uuid not null references knowledge.embedding_models (id) on delete restrict,
  embedding extensions.vector not null,
  language text not null check (language ~ '^[a-z]{2}$'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (chunk_id, embedding_model_id)
);

create index chunk_embeddings_model_idx on knowledge.chunk_embeddings (embedding_model_id);

-- Embeddings skrives, mens versionen behandles, og tilføjes ved re-embedding af versioner,
-- der er behandlet eller publiceret (docs/07 §2.3: re-embedding ændrer ikke chunks).
-- Dimensionen skal passe til modellen. Embeddings ændres aldrig.
create or replace function knowledge.check_embedding_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_chunk uuid := case when tg_op = 'DELETE' then old.chunk_id else new.chunk_id end;
  v_version_status text;
  v_model knowledge.embedding_models;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Embeddings ændres aldrig' using errcode = 'check_violation';
  end if;
  select v.status into v_version_status
  from knowledge.document_chunks c join knowledge.document_versions v on v.id = c.document_version_id
  where c.id = v_chunk;

  if tg_op = 'DELETE' then
    -- Sletning sker kun sammen med chunks under behandling (kaskade).
    if v_version_status is not null and v_version_status <> 'processing' then
      raise exception 'Embeddings kan kun slettes, mens versionen behandles' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select * into v_model from knowledge.embedding_models where id = new.embedding_model_id;
  if v_model.status = 'retired' then
    raise exception 'Modellen er udfaset' using errcode = 'check_violation';
  end if;
  if extensions.vector_dims(new.embedding) <> v_model.dimensions then
    raise exception 'Embeddingens dimension (%) passer ikke til modellen (%)',
      extensions.vector_dims(new.embedding), v_model.dimensions using errcode = 'check_violation';
  end if;
  if v_version_status not in ('processing', 'processed', 'under_review', 'rejected', 'published') then
    raise exception 'Der kan ikke laves embeddings for en version med status %', v_version_status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger chunk_embeddings_check_write
  before insert or update or delete on knowledge.chunk_embeddings
  for each row execute function knowledge.check_embedding_write();

-- Ingen model oprettes her. En rigtig model tilføjes med sin egen migration: rækken og dens
-- partielle HNSW-indeks, fx
--   create index ... on knowledge.chunk_embeddings
--     using hnsw ((embedding::extensions.vector(<n>)) extensions.vector_cosine_ops)
--     where embedding_model_id = '<model-id>';
-- Udviklingsmodellen (test-embedder) er mock-data og oprettes kun af det lokale
-- udviklingsseed (scripts/seed-dev.mjs) — aldrig af en migration (CLAUDE.md §2, B-005/B-006-
-- runden). Uden indeks søges der eksakt; resultatet er det samme, blot langsommere.

-- ----------------------------------------------------------------------------
-- Funktioner
-- ----------------------------------------------------------------------------

-- Den aktive model (eller ingen). Bruges af retrieval og godkendelse.
create or replace function knowledge.active_embedding_model()
returns table (id uuid, provider text, model_name text, model_version text, dimensions int)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.provider, m.model_name, m.model_version, m.dimensions
  from knowledge.embedding_models m where m.status = 'active'
$$;

-- Workerens modeller: den aktive og eventuelle kandidater (docs/07 §5.2 trin 8).
create or replace function knowledge.worker_embedding_models()
returns table (id uuid, provider text, model_name text, model_version text, dimensions int, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.provider, m.model_name, m.model_version, m.dimensions, m.status
  from knowledge.embedding_models m where m.status in ('active', 'candidate')
  order by (m.status = 'active') desc, m.created_at
$$;

-- Chunks i jobbets version, der mangler en embedding for modellen (idempotent genoptagelse).
create or replace function knowledge.worker_chunks_to_embed(p_job_id uuid, p_worker text, p_model_id uuid)
returns table (chunk_id uuid, text text, lead_in text, heading_path text[], language text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid := knowledge.worker_job_version(p_job_id, p_worker);
begin
  return query
  select c.id, c.text, c.lead_in, c.heading_path, v.language
  from knowledge.document_chunks c
  join knowledge.document_versions v on v.id = c.document_version_id
  where c.document_version_id = v_version
    and not exists (select 1 from knowledge.chunk_embeddings e where e.chunk_id = c.id and e.embedding_model_id = p_model_id)
  order by c.chunk_index;
end;
$$;

create or replace function knowledge.worker_store_embeddings(p_job_id uuid, p_worker text, p_model_id uuid, p_rows jsonb)
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
  insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
  select (r ->> 'chunk_id')::uuid, p_model_id, ((r -> 'embedding')::text)::extensions.vector, r ->> 'language', r ->> 'input_hash'
  from jsonb_array_elements(p_rows) r
  where exists (
    select 1 from knowledge.document_chunks c
    where c.id = (r ->> 'chunk_id')::uuid and c.document_version_id = v_version
  )
  on conflict (chunk_id, embedding_model_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Indeksering (docs/07 §5.2 trin 9): FTS er genereret; trinnet verificerer, at hvert chunk
-- har præcis én embedding pr. aktiv/kandidat-model med modellens dimension.
create or replace function knowledge.embedding_integrity(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'model_id', m.id,
    'model', m.provider || ':' || m.model_name || '@' || m.model_version,
    'status', m.status,
    'chunks', (select count(*) from knowledge.document_chunks c where c.document_version_id = p_version_id),
    'embeddings', (select count(*) from knowledge.chunk_embeddings e join knowledge.document_chunks c on c.id = e.chunk_id
                   where c.document_version_id = p_version_id and e.embedding_model_id = m.id),
    'wrong_dimensions', (select count(*) from knowledge.chunk_embeddings e join knowledge.document_chunks c on c.id = e.chunk_id
                         where c.document_version_id = p_version_id and e.embedding_model_id = m.id
                           and extensions.vector_dims(e.embedding) <> m.dimensions)
  ) order by m.created_at), '[]'::jsonb)
  from knowledge.embedding_models m
  where m.status in ('active', 'candidate')
$$;

create or replace function knowledge.worker_verify_index(p_job_id uuid, p_worker text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return knowledge.embedding_integrity(knowledge.worker_job_version(p_job_id, p_worker));
end;
$$;

-- Har alle versionens chunks en embedding med den aktive model? (Godkendelseskrav, docs/07 §3.2.)
create or replace function knowledge.version_has_active_embeddings(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from knowledge.embedding_models where status = 'active')
    and not exists (
      select 1 from knowledge.document_chunks c
      where c.document_version_id = p_version_id
        and not exists (
          select 1 from knowledge.chunk_embeddings e
          join knowledge.embedding_models m on m.id = e.embedding_model_id and m.status = 'active'
          where e.chunk_id = c.id
        )
    )
$$;

-- Modelskifte (docs/07 §7): re-embedding for kandidatmodellen og skiftet selv.
-- Versioner, der skal dækkes: publicerede (ikke deaktiverede) og versioner i review-forløbet.
create or replace function knowledge.embedding_coverage(p_model_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with relevant as (
    select c.id
    from knowledge.document_chunks c
    join knowledge.document_versions v on v.id = c.document_version_id
    where v.status in ('processed', 'under_review', 'rejected', 'published')
  )
  select jsonb_build_object(
    'chunks', (select count(*) from relevant),
    'embedded', (select count(*) from relevant r
                 where exists (select 1 from knowledge.chunk_embeddings e where e.chunk_id = r.id and e.embedding_model_id = p_model_id))
  )
$$;

create or replace function knowledge.request_reembedding(p_model_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not identity.has_permission('system.settings.manage') and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from knowledge.embedding_models where id = p_model_id and status in ('candidate', 'active')) then
    raise exception 'Modellen findes ikke eller er udfaset' using errcode = 'no_data_found';
  end if;
  insert into knowledge.ingestion_jobs (document_version_id, kind)
  select v.id, 'reembed'
  from knowledge.document_versions v
  where v.status in ('processed', 'under_review', 'rejected', 'published')
    and exists (
      select 1 from knowledge.document_chunks c
      where c.document_version_id = v.id
        and not exists (select 1 from knowledge.chunk_embeddings e where e.chunk_id = c.id and e.embedding_model_id = p_model_id)
    )
  on conflict do nothing;
  get diagnostics v_count = row_count;
  perform knowledge.write_audit('knowledge.reembed.started', 'embedding_models', p_model_id::text, jsonb_build_object('jobs', v_count));
  return v_count;
end;
$$;

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

-- Workeren afslutter re-embedding-jobs uden at røre versionens status (worker_complete_job
-- skelner allerede på kind). Claim tillader reembed-jobs for behandlede/publicerede versioner.
create or replace function knowledge.worker_reembed_allowed(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('processed', 'under_review', 'rejected', 'published')
$$;

-- Claim annullerer også re-embedding-jobs for versioner, der er deaktiveret eller kasseret.
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

    if (v_job.kind = 'process' and v_status not in ('uploaded', 'processing'))
       or (v_job.kind = 'reembed' and not knowledge.worker_reembed_allowed(v_status)) then
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

-- ----------------------------------------------------------------------------
-- RLS og rettigheder (docs/07 §14)
-- ----------------------------------------------------------------------------

alter table knowledge.embedding_models enable row level security;
alter table knowledge.chunk_embeddings enable row level security;

create policy embedding_models_select on knowledge.embedding_models
  for select to authenticated using (identity.has_permission('system.settings.manage'));

create policy chunk_embeddings_select on knowledge.chunk_embeddings
  for select to authenticated
  using (
    knowledge.is_knowledge_manager()
    or exists (
      select 1 from knowledge.document_chunks c
      where c.id = chunk_embeddings.chunk_id and knowledge.can_read_version(c.document_version_id, 'any')
    )
  );

revoke all on knowledge.embedding_models, knowledge.chunk_embeddings from anon, authenticated;
grant select on knowledge.embedding_models, knowledge.chunk_embeddings to authenticated;
grant all on knowledge.embedding_models, knowledge.chunk_embeddings to service_role;

revoke all on function
  knowledge.check_embedding_write(),
  knowledge.active_embedding_model(),
  knowledge.worker_embedding_models(),
  knowledge.worker_chunks_to_embed(uuid, text, uuid),
  knowledge.worker_store_embeddings(uuid, text, uuid, jsonb),
  knowledge.embedding_integrity(uuid),
  knowledge.worker_verify_index(uuid, text),
  knowledge.version_has_active_embeddings(uuid),
  knowledge.embedding_coverage(uuid),
  knowledge.request_reembedding(uuid),
  knowledge.activate_embedding_model(uuid),
  knowledge.worker_reembed_allowed(text)
from public, anon, authenticated;

grant execute on function knowledge.active_embedding_model() to authenticated, service_role;
grant execute on function
  knowledge.request_reembedding(uuid),
  knowledge.activate_embedding_model(uuid)
to authenticated, service_role;
grant execute on function knowledge.embedding_coverage(uuid) to service_role;
grant execute on function
  knowledge.worker_embedding_models(),
  knowledge.worker_chunks_to_embed(uuid, text, uuid),
  knowledge.worker_store_embeddings(uuid, text, uuid, jsonb),
  knowledge.worker_verify_index(uuid, text)
to service_role;
