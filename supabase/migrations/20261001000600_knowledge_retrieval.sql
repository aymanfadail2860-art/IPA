-- ============================================================================
-- Fase 7, trin 6 — Retrieval (docs/07 §8)
--
-- knowledge.search_chunks er retrievalens kandidattrin:
--
--   Forespørgsel → permission-filtrering → metadata-filtrering → hybrid søgning
--   (vektor med den aktive model ∥ leksikalsk FTS dansk + simple) → kandidater
--
--   * SECURITY INVOKER: RLS på versioner, chunks og embeddings gælder også (andet lag).
--   * Adgangsfilteret ligger I forespørgslen, før søgningen (docs/03 §6): kun publicerede,
--     tidsgyldige versioner, som brugeren må læse, indgår. Klientens filtre kan kun snævre ind.
--   * STABLE: funktionen kan ikke skrive (PL/pgSQL afviser ændringer i ikke-volatile
--     funktioner). Forespørgslen gemmes ingen steder (docs/07 §12.1).
--   * Kun én aktiv model; forespørgslens embedding skal være lavet med den (ellers fejl).
--   * Højst én gyldig version pr. dokument og sprog på datoen (exclusion constraint) — to
--     versioner af samme dokument kan aldrig optræde i samme resultat.
--
-- Fusion (RRF), reranking og evidensudvælgelse sker i applikationslaget (docs/07 §8–10).
-- ============================================================================

-- Kildens type (fx manual_upload) til evidensens sourceReference. `sources` kan kun læses med
-- write/publish (docs/07 §14) og kan senere indeholde connector-konfiguration; denne funktion
-- udleverer kun typen.
create or replace function knowledge.source_type(p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.type from knowledge.sources s where s.id = p_source_id
$$;

revoke all on function knowledge.source_type(uuid) from public, anon;
grant execute on function knowledge.source_type(uuid) to authenticated;

create or replace function knowledge.search_chunks(
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
  lexical_terms text[]
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

  -- The HNSW index is filtered afterwards (permission, model, version); iterative scan keeps
  -- reading the index until enough allowed candidates are found. Transaction-local; the
  -- result is re-ranked by exact distance below.
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);

  select m.id, m.dimensions into v_active, v_dims from knowledge.active_embedding_model() m;
  if p_query_embedding is not null and (v_active is null or p_model_id is distinct from v_active) then
    raise exception 'Forespørgslen er ikke lavet med den aktive embedding-model' using errcode = 'invalid_parameter_value';
  end if;

  return query execute format($q$
    with allowed as (
      select v.id, v.version_label, v.language, v.valid_from, v.valid_to, v.approved_at, v.superseded_by,
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
           array(select w from unnest(tsvector_to_array(c.fts_simple)) w, q where w = any (q.words) order by w)
    from candidates cand
    join knowledge.document_chunks c on c.id = cand.chunk_id
    join allowed a on a.id = c.document_version_id
    order by least(coalesce(cand.vector_rank, 1000000), coalesce(cand.lexical_rank, 1000000)), c.id
  $q$, coalesce(v_dims, 1))
  using p_language, v_date, p_product_ids, p_document_ids, p_document_types,
        p_query_embedding, p_model_id, p_candidate_k, p_query;
end;
$$;

revoke all on function knowledge.search_chunks(text, text, uuid, text, date, text, uuid[], uuid[], text[], int) from public, anon;
grant execute on function knowledge.search_chunks(text, text, uuid, text, date, text, uuid[], uuid[], text[], int) to authenticated;
