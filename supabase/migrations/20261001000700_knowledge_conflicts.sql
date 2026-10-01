-- ============================================================================
-- Fase 7, trin 7 — Konflikter (docs/07 §11) og huller i gyldigheden (docs/07 §3.5, B-006)
--
--   * conflicts / conflict_passages: "Kilde A → X, Kilde B → Y". Begge kilder bevares uændret.
--     Systemet afgør aldrig, hvilken kilde der har ret.
--   * Strukturelle kandidater (overlapping_scope, duplicate_content) registreres, når en
--     version publiceres; manuelle konflikter registreres af et menneske.
--   * Løs/afvis kræver knowledge.version.publish; registrering write eller publish.
--   * Retrieval: evidence_conflicts returnerer for en tilgængelig modpart dens id'er og for en
--     utilgængelig modpart KUN det boolske restricted (B-20). Den skjulte kildes metadata —
--     også konflikt-id, regel, beskrivelse og noter — forlader aldrig databasen.
--   * Huller i gyldigheden (B-006) beregnes og vises; de lukkes kun ved at publicere en ny
--     version. Systemet ændrer aldrig selv gyldighed og foreslår ingen løsning.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabeller
-- ----------------------------------------------------------------------------

create table knowledge.conflicts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  detected_by text not null check (detected_by in ('system', 'user')),
  detection_rule text not null check (detection_rule in ('overlapping_scope', 'duplicate_content', 'manual')),
  description text check (char_length(description) <= 2000),
  -- Systemkandidater registreres én gang pr. regel og versionspar (også efter en afvisning).
  fingerprint text unique,
  created_by uuid references identity.users (id),
  created_at timestamptz not null default now(),
  resolved_by uuid references identity.users (id),
  resolved_at timestamptz,
  resolution_note text check (char_length(resolution_note) <= 2000),
  check ((detected_by = 'user') = (detection_rule = 'manual')),
  check ((detected_by = 'system') = (fingerprint is not null)),
  check ((status = 'open') = (resolved_at is null)),
  check (status = 'open' or (resolved_by is not null and char_length(btrim(coalesce(resolution_note, ''))) > 0))
);

create table knowledge.conflict_passages (
  id uuid primary key default gen_random_uuid(),
  conflict_id uuid not null references knowledge.conflicts (id),
  side text not null check (side in ('A', 'B')),
  document_version_id uuid not null references knowledge.document_versions (id),
  -- Valgfri: null, når konflikten er på versionsniveau.
  chunk_id uuid references knowledge.document_chunks (id),
  unique nulls not distinct (conflict_id, side, document_version_id, chunk_id)
);

create index conflict_passages_version_idx on knowledge.conflict_passages (document_version_id);
create index conflict_passages_chunk_idx on knowledge.conflict_passages (chunk_id) where chunk_id is not null;
create index conflicts_open_idx on knowledge.conflicts (created_at) where status = 'open';
create index document_chunks_content_hash_idx on knowledge.document_chunks (content_hash);

-- Et chunk i en passage skal tilhøre passagens version.
create or replace function knowledge.check_conflict_passage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.chunk_id is not null and not exists (
    select 1 from knowledge.document_chunks c where c.id = new.chunk_id and c.document_version_id = new.document_version_id
  ) then
    raise exception 'Passagen hører ikke til versionen' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger conflict_passages_check
  before insert or update on knowledge.conflict_passages
  for each row execute function knowledge.check_conflict_passage();

create trigger conflict_passages_immutable
  before update or delete on knowledge.conflict_passages
  for each row execute function knowledge.prevent_delete();

-- Kun open → resolved/dismissed; alt andet ved konflikten er uændret.
create or replace function knowledge.check_conflict_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'open' or new.status = 'open'
     or (to_jsonb(new) - array['status', 'resolved_by', 'resolved_at', 'resolution_note'])
        is distinct from (to_jsonb(old) - array['status', 'resolved_by', 'resolved_at', 'resolution_note']) then
    raise exception 'Konflikten kan ikke ændres sådan' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger conflicts_check_update
  before update on knowledge.conflicts
  for each row execute function knowledge.check_conflict_update();

create trigger conflicts_no_delete
  before delete on knowledge.conflicts
  for each row execute function knowledge.prevent_delete();

alter table knowledge.conflicts enable row level security;
alter table knowledge.conflict_passages enable row level security;

-- Kun forvaltere (write/publish) kan læse konflikter direkte (docs/07 §11.4, §14).
create policy conflicts_select on knowledge.conflicts
  for select to authenticated using (knowledge.is_knowledge_manager());
create policy conflict_passages_select on knowledge.conflict_passages
  for select to authenticated using (knowledge.is_knowledge_manager());

revoke all on knowledge.conflicts, knowledge.conflict_passages from public, anon, authenticated;
grant select on knowledge.conflicts, knowledge.conflict_passages to authenticated;

-- ----------------------------------------------------------------------------
-- Strukturelle kandidater (docs/07 §11.2)
-- ----------------------------------------------------------------------------

-- Kandidater for en version i forhold til PUBLICEREDE versioner af andre dokumenter:
--   overlapping_scope  samme produkt og dokumenttype, overlappende gyldighed (versionsniveau)
--   duplicate_content  chunks med identisk content_hash i et dokument med andet produkt eller
--                      anden dokumenttype ("forskellig metadata")
create or replace function knowledge.conflict_candidates_for(p_version_id uuid)
returns table (rule text, other_version_id uuid, own_chunk_ids uuid[], other_chunk_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select v.id, v.document_id, v.valid_from, v.valid_to, d.product_id, d.document_type
    from knowledge.document_versions v join knowledge.documents d on d.id = v.document_id
    where v.id = p_version_id
  ),
  others as (
    select o.id, o.valid_from, o.valid_to, d.product_id, d.document_type
    from knowledge.document_versions o
    join knowledge.documents d on d.id = o.document_id, me
    where o.status = 'published' and o.document_id <> me.document_id
  )
  select 'overlapping_scope', o.id, null::uuid[], null::uuid[]
  from others o, me
  where o.product_id = me.product_id and o.document_type = me.document_type
    and me.valid_from is not null
    and daterange(o.valid_from, o.valid_to, '[)') && daterange(me.valid_from, me.valid_to, '[)')
  union all
  select 'duplicate_content', o.id,
         array_agg(distinct mc.id order by mc.id), array_agg(distinct oc.id order by oc.id)
  from me
  join knowledge.document_chunks mc on mc.document_version_id = me.id
  join knowledge.document_chunks oc on oc.content_hash = mc.content_hash and oc.document_version_id <> me.id
  join others o on o.id = oc.document_version_id
  where o.product_id <> me.product_id or o.document_type <> me.document_type
  group by o.id
$$;

revoke all on function knowledge.conflict_candidates_for(uuid) from public, anon, authenticated;

-- Kvalitetsrapportens konfliktkandidater (docs/07 §5.3) — kun for forvaltere.
create or replace function knowledge.conflict_candidates(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not knowledge.is_knowledge_manager() then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'rule', c.rule,
      'version_id', o.id,
      'document_id', d.id,
      'document_title', d.title,
      'version_label', o.version_label,
      'chunk_count', coalesce(cardinality(c.own_chunk_ids), 0),
      'registered', exists (select 1 from knowledge.conflicts k
                            where k.fingerprint = c.rule || ':' || least(p_version_id, o.id) || ':' || greatest(p_version_id, o.id)))
      order by d.title, o.valid_from)
    from knowledge.conflict_candidates_for(p_version_id) c
    join knowledge.document_versions o on o.id = c.other_version_id
    join knowledge.documents d on d.id = o.document_id
  ), '[]'::jsonb);
end;
$$;

-- Registrerer systemkandidater for en netop publiceret version (én konflikt pr. regel og
-- versionspar; en afvist kandidat oprettes ikke igen).
create or replace function knowledge.detect_conflicts(p_version_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_id uuid;
  v_count int := 0;
begin
  for c in select * from knowledge.conflict_candidates_for(p_version_id) loop
    insert into knowledge.conflicts (detected_by, detection_rule, fingerprint)
    values ('system', c.rule, c.rule || ':' || least(p_version_id, c.other_version_id) || ':' || greatest(p_version_id, c.other_version_id))
    on conflict (fingerprint) do nothing
    returning id into v_id;
    continue when v_id is null;

    if c.rule = 'overlapping_scope' then
      insert into knowledge.conflict_passages (conflict_id, side, document_version_id)
      values (v_id, 'A', p_version_id), (v_id, 'B', c.other_version_id);
    else
      insert into knowledge.conflict_passages (conflict_id, side, document_version_id, chunk_id)
      select v_id, 'A', p_version_id, unnest(c.own_chunk_ids)
      union all
      select v_id, 'B', c.other_version_id, unnest(c.other_chunk_ids);
    end if;

    perform knowledge.write_audit('knowledge.conflict.flagged', 'conflicts', v_id::text,
      jsonb_build_object('detected_by', 'system', 'rule', c.rule, 'versions', jsonb_build_array(p_version_id, c.other_version_id)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function knowledge.detect_conflicts(uuid) from public, anon, authenticated;

create or replace function knowledge.on_version_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform knowledge.detect_conflicts(new.id);
  return null;
end;
$$;

create trigger document_versions_detect_conflicts
  after update of status on knowledge.document_versions
  for each row when (new.status = 'published' and old.status is distinct from 'published')
  execute function knowledge.on_version_published();

-- ----------------------------------------------------------------------------
-- Registrér, løs, afvis (docs/07 §11.3)
-- ----------------------------------------------------------------------------

-- p_passages: [{"side": "A"|"B", "version_id": "…", "chunk_id": "…"|null}, …] — mindst én pr. side.
create or replace function knowledge.flag_conflict(p_description text, p_passages jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := identity.current_user_id();
  v_id uuid;
  p jsonb;
begin
  if v_me is null or not knowledge.is_knowledge_manager() then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_passages) is distinct from 'array' or jsonb_array_length(p_passages) > 50
     or not exists (select 1 from jsonb_array_elements(p_passages) e where e ->> 'side' = 'A')
     or not exists (select 1 from jsonb_array_elements(p_passages) e where e ->> 'side' = 'B') then
    raise exception 'Vælg mindst én passage fra hver kilde' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Beskriv konflikten' using errcode = 'check_violation';
  end if;

  insert into knowledge.conflicts (detected_by, detection_rule, description, created_by)
  values ('user', 'manual', btrim(p_description), v_me)
  returning id into v_id;

  for p in select * from jsonb_array_elements(p_passages) loop
    if p ->> 'side' not in ('A', 'B') or not exists (
      select 1 from knowledge.document_versions v
      where v.id = (p ->> 'version_id')::uuid and v.status in ('published', 'processed', 'under_review')
    ) then
      raise exception 'Passagen findes ikke' using errcode = 'check_violation';
    end if;
    insert into knowledge.conflict_passages (conflict_id, side, document_version_id, chunk_id)
    values (v_id, p ->> 'side', (p ->> 'version_id')::uuid, nullif(p ->> 'chunk_id', '')::uuid)
    on conflict do nothing;
  end loop;

  perform knowledge.write_audit('knowledge.conflict.flagged', 'conflicts', v_id::text,
    jsonb_build_object('detected_by', 'user', 'rule', 'manual'));
  return v_id;
end;
$$;

create or replace function knowledge.close_conflict(p_conflict_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := knowledge.require_permission('knowledge.version.publish');
  v_rule text;
begin
  if char_length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception '%', case when p_status = 'resolved' then 'Skriv en note om løsningen' else 'Skriv en begrundelse for afvisningen' end
      using errcode = 'check_violation';
  end if;
  update knowledge.conflicts
  set status = p_status, resolved_by = v_me, resolved_at = now(), resolution_note = btrim(p_note)
  where id = p_conflict_id and status = 'open'
  returning detection_rule into v_rule;
  if v_rule is null then
    raise exception 'Konflikten findes ikke eller er allerede afgjort' using errcode = 'no_data_found';
  end if;
  perform knowledge.write_audit('knowledge.conflict.' || p_status, 'conflicts', p_conflict_id::text,
    jsonb_build_object('rule', v_rule, 'note', btrim(p_note)));
end;
$$;

revoke all on function knowledge.close_conflict(uuid, text, text) from public, anon, authenticated;

-- "Løs" — den faglige løsning gennemføres med de almindelige handlinger (deaktivering, ny version).
create or replace function knowledge.resolve_conflict(p_conflict_id uuid, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$ select knowledge.close_conflict(p_conflict_id, 'resolved', p_note) $$;

-- "Afvis" — ikke en konflikt, med begrundelse.
create or replace function knowledge.dismiss_conflict(p_conflict_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$ select knowledge.close_conflict(p_conflict_id, 'dismissed', p_reason) $$;

-- ----------------------------------------------------------------------------
-- Konflikter i retrieval (docs/07 §11.4, B-20)
-- ----------------------------------------------------------------------------

-- For hvert af brugerens chunks (som brugeren kan læse, publiceret og gyldigt på p_date):
--   * én række pr. TILGÆNGELIG modpart i en åben konflikt (restricted = false): konflikt-id og
--     modpartens dokument, version og evt. chunk (null = konflikt på versionsniveau);
--   * højst én række med restricted = true og ALT andet null, hvis der findes en åben konflikt
--     med en publiceret, gyldig modpart, som brugeren ikke kan læse.
-- Modparter, der ikke er publiceret eller ikke gyldige på datoen, indgår ikke (de er ikke en
-- del af vidensgrundlaget på datoen). Løste og afviste konflikter påvirker ikke retrieval.
create or replace function knowledge.evidence_conflicts(p_chunk_ids uuid[], p_date date)
returns table (
  chunk_id uuid,
  restricted boolean,
  conflict_id uuid,
  counterpart_document_id uuid,
  counterpart_version_id uuid,
  counterpart_chunk_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_date is null or coalesce(cardinality(p_chunk_ids), 0) > 200 then
    raise exception 'Ugyldig forespørgsel' using errcode = 'invalid_parameter_value';
  end if;
  return query
  with input as (
    select c.id as chunk_id, c.document_version_id as version_id
    from knowledge.document_chunks c
    join knowledge.document_versions v on v.id = c.document_version_id
    where c.id = any (p_chunk_ids)
      and v.status = 'published'
      and daterange(v.valid_from, v.valid_to, '[)') @> p_date
      and knowledge.can_read_version(v.id, 'any')
  ),
  mine as (
    select i.chunk_id, p.conflict_id, p.side
    from input i
    join knowledge.conflict_passages p on p.document_version_id = i.version_id and (p.chunk_id is null or p.chunk_id = i.chunk_id)
    join knowledge.conflicts k on k.id = p.conflict_id and k.status = 'open'
  ),
  other as (
    select distinct m.chunk_id, m.conflict_id, o.document_version_id as version_id, o.chunk_id as other_chunk_id,
           v.document_id, knowledge.can_read_version(v.id, 'any') as readable
    from mine m
    join knowledge.conflict_passages o on o.conflict_id = m.conflict_id and o.side <> m.side
    join knowledge.document_versions v on v.id = o.document_version_id
    where v.status = 'published' and daterange(v.valid_from, v.valid_to, '[)') @> p_date
  )
  select o.chunk_id, false, o.conflict_id, o.document_id, o.version_id, o.other_chunk_id from other o where o.readable
  union
  select distinct o.chunk_id, true, null::uuid, null::uuid, null::uuid, null::uuid from other o where not o.readable;
end;
$$;

-- Modpartens chunks som evidens: de samme kolonner som search_chunks (uden scores), med samme
-- adgangs- og gyldighedsfilter (SECURITY INVOKER). Klientens filtre gælder ikke her: en kendt
-- konflikt skjules aldrig (docs/07 §11.4). p_version_ids giver versionens første chunk.
create or replace function knowledge.evidence_chunks(p_chunk_ids uuid[], p_version_ids uuid[], p_date date)
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
language sql
stable
security invoker
set search_path = ''
as $$
  with allowed as (
    select v.id, v.version_label, v.language, v.valid_from, v.valid_to, v.approved_at, v.superseded_by,
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
         null::int, null::double precision, null::int, null::double precision, '{}'::text[]
  from picked
  join knowledge.document_chunks c on c.id = picked.id
  join allowed a on a.id = c.document_version_id
  where coalesce(cardinality(p_chunk_ids), 0) + coalesce(cardinality(p_version_ids), 0) <= 200
  order by a.document_id, c.chunk_index
$$;

-- ----------------------------------------------------------------------------
-- Huller i gyldigheden (docs/07 §3.5, B-006)
-- ----------------------------------------------------------------------------

-- Et hul er en periode uden publiceret, ikke-deaktiveret version af dokumentet på sproget:
--   between_versions           mellem to publicerede versioner
--   after_withdrawn_successor  efter en version, der blev erstattet af en efterfølger, som siden
--                              er deaktiveret (åbent i den ene ende)
-- En version, der fra start er uploadet med en slutdato, giver ikke et hul efter sin slutdato.
-- p_assume_withdrawn beregner hullerne, som de ville være efter en deaktivering (bekræftelses-
-- dialogen). Kun for forvaltere.
create or replace function knowledge.validity_gaps(p_document_id uuid default null, p_assume_withdrawn uuid default null)
returns table (
  document_id uuid,
  language text,
  gap_from date,
  gap_to date,
  kind text,
  before_version_id uuid,
  after_version_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not knowledge.is_knowledge_manager() then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  return query
  with pub as (
    select v.id, v.document_id, v.language, v.valid_from, v.valid_to, v.superseded_by
    from knowledge.document_versions v
    where v.status = 'published' and v.id is distinct from p_assume_withdrawn
      and (p_document_id is null or v.document_id = p_document_id)
  ),
  ordered as (
    select p.*, lead(p.id) over w as next_id, lead(p.valid_from) over w as next_from
    from pub p
    window w as (partition by p.document_id, p.language order by p.valid_from)
  )
  select o.document_id, o.language, o.valid_to, o.next_from, 'between_versions'::text, o.id, o.next_id
  from ordered o
  where o.next_id is not null and o.valid_to is not null and o.valid_to < o.next_from
  union all
  select o.document_id, o.language, o.valid_to, null::date, 'after_withdrawn_successor'::text, o.id, o.superseded_by
  from ordered o
  where o.next_id is null and o.valid_to is not null and o.superseded_by is not null
    and (o.superseded_by = p_assume_withdrawn
         or exists (select 1 from knowledge.document_versions s where s.id = o.superseded_by and s.status = 'withdrawn'))
  order by 1, 2, 3;
end;
$$;

-- De huller, en deaktivering af versionen ville efterlade (vises i bekræftelsesdialogen).
create or replace function knowledge.gaps_after_withdrawal(p_version_id uuid)
returns table (
  document_id uuid,
  language text,
  gap_from date,
  gap_to date,
  kind text,
  before_version_id uuid,
  after_version_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.* from knowledge.validity_gaps((select v.document_id from knowledge.document_versions v where v.id = p_version_id), p_version_id) g
  except
  select g.* from knowledge.validity_gaps((select v.document_id from knowledge.document_versions v where v.id = p_version_id), null) g
$$;

-- ----------------------------------------------------------------------------
-- Rettigheder
-- ----------------------------------------------------------------------------
revoke all on function
  knowledge.check_conflict_passage(),
  knowledge.check_conflict_update(),
  knowledge.on_version_published(),
  knowledge.conflict_candidates(uuid),
  knowledge.flag_conflict(text, jsonb),
  knowledge.resolve_conflict(uuid, text),
  knowledge.dismiss_conflict(uuid, text),
  knowledge.evidence_conflicts(uuid[], date),
  knowledge.evidence_chunks(uuid[], uuid[], date),
  knowledge.validity_gaps(uuid, uuid),
  knowledge.gaps_after_withdrawal(uuid)
from public, anon;

grant execute on function
  knowledge.conflict_candidates(uuid),
  knowledge.flag_conflict(text, jsonb),
  knowledge.resolve_conflict(uuid, text),
  knowledge.dismiss_conflict(uuid, text),
  knowledge.evidence_conflicts(uuid[], date),
  knowledge.evidence_chunks(uuid[], uuid[], date),
  knowledge.validity_gaps(uuid, uuid),
  knowledge.gaps_after_withdrawal(uuid)
to authenticated;
