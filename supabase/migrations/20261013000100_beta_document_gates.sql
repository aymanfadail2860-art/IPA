-- ============================================================================
-- Beta (B-036), L1.1 — gate-sæt for product_documents
-- ============================================================================
-- Specifikation: docs/beta.md §5.1 og docs/decisions.md B-036.
--
-- Q1–Q7 (8B, gates-v1) måler en rangerende søgning: topK, MRR, rerankerens løft og afvisning i
-- retrieval-laget. product_documents rangerer ikke; den leverer hele produktets dokumentgrundlag.
-- Derfor et separat, versionsstyret gate-sæt, D1–D6, der måler metodens faktiske opgave:
--
--   D1 required_document_coverage    facits kildeversioner er leveret       (besvarbare)
--   D2 required_passage_coverage     facits påkrævede passager er leveret    (besvarbare)
--   D3 full_document_integrity       hver version hel, i rækkefølge, uforkortet
--   D4 valid_version_coverage        præcis de gyldige versioner (current/as_of)
--   D5 correct_product_scope         netop spørgsmålets ene produkt
--   D6 authorized_document_coverage  præcis de dokumenter, brugeren må læse
--
-- Hver gate er en invariant: andelen af spørgsmål, der opfylder kravet, skal være 1. Metrik,
-- retning og tærskel er låst her og i koden; et gate-sæt kan ikke løsne dem. En dokumentgate gør
-- aldrig en kørsel "uncertain": én mangel fejler gaten.
--
--   * Et gate-sæt gælder netop én retrieval-metode (kolonnen method, afledt af definitionen).
--     Gate-sæt uden "method" er de hybride fra 8B (gates-v1), uændrede. En kørsel registreres kun,
--     når gate-sættets metode er konfigurationens; godkendelse og retrieval-konteksten
--     kontrollerer det igen. D1–D6 kan aldrig godkende en hybrid konfiguration, og Q1–Q7 aldrig
--     en product_documents-konfiguration.
--   * Rapportformat 6: gateSet.method, gateSet.k (null for product_documents), D-metrikker,
--     dokumentobservationer pr. spørgsmål og ingen reranker-sammenligning for product_documents.
--     Hybride rapporter genberegnes som hidtil (eval_report_problems er uændret).
--   * De hårde gates H1–H7, minimum pr. type, tier, gyldighed og afgørelse genberegnes som for
--     hybride rapporter.
--
-- Ingen ændring af rettigheder, RLS, publisher-API, P1–P9, gates-v1 eller registrerede data.
-- Ingen data ændres eller slettes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Gate-sættets metode
-- ----------------------------------------------------------------------------

alter table knowledge.evaluation_gate_sets alter column k drop not null;
alter table knowledge.evaluation_gate_sets
  add column method text not null generated always as (case when definition ? 'method' then definition ->> 'method' else 'hybrid' end) stored;
alter table knowledge.evaluation_gate_sets add constraint evaluation_gate_sets_method_known
  check (method in ('hybrid', 'product_documents'));
-- K er topK for en rangerende metode og findes ikke for product_documents (hele sættet).
alter table knowledge.evaluation_gate_sets add constraint evaluation_gate_sets_k_by_method
  check ((method = 'hybrid') = (k is not null));

-- Gate-sættet ændres aldrig (8B-I6). "method" er afledt af definitionen og er endnu ikke beregnet
-- i en BEFORE-trigger (null i NEW); definitionen sammenlignes stadig, så metoden kan ikke ændres.
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
  if (to_jsonb(new) - 'approved_at' - 'approved_by' - 'method') <> (to_jsonb(old) - 'approved_at' - 'approved_by' - 'method')
     or old.approved_at is not null or new.approved_at is null then
    raise exception 'Et registreret gate-sæt kan ikke ændres — kun godkendes én gang' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on column knowledge.evaluation_gate_sets.method is
  'Den retrieval-metode, gate-sættet gælder (B-036). Afledt af definitionen: uden "method" er det et hybridt gate-sæt (Q1–Q7).';
comment on table knowledge.evaluation_gate_sets is
  'Gate-sæt (Q1–Q7 for den hybride metode, docs/08b §4.4; D1–D6 for product_documents, B-036). Registreres af evaluation_publisher, godkendes af system.settings.manage og ændres aldrig.';

-- De låste dokumentgates (evals/engine/gates.ts LOCKED_DOCUMENT_GATES). Kun til databasens egne
-- funktioner.
create or replace function knowledge.locked_document_gates()
returns table (id text, metric text, answerable_only boolean)
language sql
immutable
set search_path = ''
as $$
  values ('D1', 'required_document_coverage', true),
         ('D2', 'required_passage_coverage', true),
         ('D3', 'full_document_integrity', false),
         ('D4', 'valid_version_coverage', false),
         ('D5', 'correct_product_scope', false),
         ('D6', 'authorized_document_coverage', false)
$$;

-- Gate-sættets form (schema.ts validateGateSet). Et gate-sæt med "method" er et dokumentgate-sæt
-- (B-036) og valideres for sig; alle andre er hybride og valideres uændret som i 8B.
create or replace function knowledge.document_gate_set_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_gate record;
begin
  if not (knowledge.jsonb_keys(p) = array['decision', 'id', 'method', 'quality', 'version']
          or knowledge.jsonb_keys(p) = array['decision', 'description', 'id', 'method', 'quality', 'version']) then
    return 'gate-sættet har ikke de forventede felter';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'id') <> 'string' or (p ->> 'id') !~ '^[a-z0-9][a-z0-9_-]{0,40}$'
     or pg_catalog.jsonb_typeof(p -> 'version') <> 'number' or (p ->> 'version')::numeric < 1 or (p ->> 'version')::numeric <> pg_catalog.trunc((p ->> 'version')::numeric)
     or pg_catalog.jsonb_typeof(p -> 'decision') <> 'string' or (p ->> 'decision') !~ '^B-[0-9]{3}$'
     or (p ? 'description' and pg_catalog.jsonb_typeof(p -> 'description') <> 'string') then
    return 'gate-sættets id, version eller beslutning er ugyldig';
  end if;
  if (p -> 'method') is distinct from '"product_documents"'::jsonb then
    return 'gate-sættets metode er ukendt';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'quality') <> 'object' or knowledge.jsonb_keys(p -> 'quality') <> array['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] then
    return 'gate-sættet har ikke præcis D1–D6';
  end if;
  for v_gate in select * from knowledge.locked_document_gates() loop
    if pg_catalog.jsonb_typeof(p -> 'quality' -> v_gate.id) <> 'object'
       or knowledge.jsonb_keys(p -> 'quality' -> v_gate.id) <> array['comparator', 'metric', 'threshold']
       or (p #>> array['quality', v_gate.id, 'metric']) is distinct from v_gate.metric
       or (p #> array['quality', v_gate.id, 'comparator']) is distinct from '">="'::jsonb
       or (p #> array['quality', v_gate.id, 'threshold']) is distinct from '1'::jsonb then
      return format('%s har ikke den låste metrik, retning og tærskel 1', v_gate.id);
    end if;
  end loop;
  return null;
end;
$$;

-- gate_set_problem (8B) kaldes af register_evaluation_gate_set. Den hybride del er uændret.
create or replace function knowledge.gate_set_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_gate record;
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object' then
    return 'gate-sættet har ikke de forventede felter';
  end if;
  if p ? 'method' then
    return knowledge.document_gate_set_problem(p);
  end if;
  if not (knowledge.jsonb_keys(p) = array['decision', 'id', 'k', 'quality', 'version']
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
-- 2. Genberegning af en product_documents-rapport (publication.ts verifyReport, gates.ts,
--    metrics.ts computeDocumentMetrics). Metrikker fra observationerne, gates fra metrikkerne
--    og de låste dokumentgates, afgørelsen fra gates.
-- ----------------------------------------------------------------------------

-- En dokumentobservation (types.ts DocumentObservation): præcis felterne, tællinger er
-- ikke-negative heltal og hænger sammen.
create or replace function knowledge.document_observation_valid(d jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if pg_catalog.jsonb_typeof(d) is distinct from 'object'
     or knowledge.jsonb_keys(d) <> array['deliveredVersions', 'expectedVersions', 'foreignProductItems', 'incompleteVersions', 'missingDocuments',
                                         'missingVersions', 'productQueried', 'requiredDocuments', 'requiredDocumentsCovered', 'requiredPassages',
                                         'requiredPassagesCovered', 'unexpectedDocuments', 'unexpectedVersions'] then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(d -> 'productQueried') <> 'boolean' then return false; end if;
  foreach v_key in array array['deliveredVersions', 'expectedVersions', 'foreignProductItems', 'incompleteVersions', 'missingDocuments',
                               'missingVersions', 'requiredDocuments', 'requiredDocumentsCovered', 'requiredPassages', 'requiredPassagesCovered',
                               'unexpectedDocuments', 'unexpectedVersions'] loop
    if pg_catalog.jsonb_typeof(d -> v_key) <> 'number' or (d ->> v_key)::numeric < 0 or (d ->> v_key)::numeric <> pg_catalog.trunc((d ->> v_key)::numeric) then
      return false;
    end if;
  end loop;
  return (d ->> 'missingVersions')::int <= (d ->> 'expectedVersions')::int
     and (d ->> 'unexpectedVersions')::int <= (d ->> 'deliveredVersions')::int
     and (d ->> 'incompleteVersions')::int <= (d ->> 'deliveredVersions')::int
     and (d ->> 'requiredDocumentsCovered')::int <= (d ->> 'requiredDocuments')::int
     and (d ->> 'requiredPassagesCovered')::int <= (d ->> 'requiredPassages')::int;
end;
$$;

-- Opfylder spørgsmålets grundlag kravet bag en dokumentmetrik (metrics.ts DOCUMENT_CASE_CHECKS)?
-- Uden dokumentobservation (retrieval fejlede) opfyldes intet.
create or replace function knowledge.document_case_meets(p_metric text, d jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(d) is distinct from 'object' then false
    else case p_metric
      when 'required_document_coverage' then (d ->> 'requiredDocuments')::int > 0 and (d ->> 'requiredDocumentsCovered')::int = (d ->> 'requiredDocuments')::int
      when 'required_passage_coverage' then (d ->> 'requiredPassages')::int > 0 and (d ->> 'requiredPassagesCovered')::int = (d ->> 'requiredPassages')::int
      when 'full_document_integrity' then (d ->> 'incompleteVersions')::int = 0
      when 'valid_version_coverage' then (d ->> 'missingVersions')::int = 0 and (d ->> 'unexpectedVersions')::int = 0
      when 'correct_product_scope' then (d -> 'productQueried') = 'true'::jsonb and (d ->> 'foreignProductItems')::int = 0
      when 'authorized_document_coverage' then (d ->> 'missingDocuments')::int = 0 and (d ->> 'unexpectedDocuments')::int = 0
      else false
    end
  end
$$;

-- Returnerer en liste af problemer (tom = rapporten stemmer). Antager et valideret dokumentgate-sæt.
create or replace function knowledge.eval_document_report_problems(p_report jsonb, p_gates jsonb)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_cases jsonb := p_report -> 'cases';
  v_metrics jsonb := p_report -> 'metrics';
  v_errors int;
  v_gate record;
  v_population int;
  v_met int;
  v_value double precision;
  v_ok boolean;
  v_reported jsonb;
  v_quality_passed boolean := true;
  v_hard jsonb;
  v_hard_passed boolean;
  v_case_violations int;
  v_run_violations int;
  v_reported_hard int;
  v_minimums jsonb;
  v_minimums_met boolean;
  v_n int;
  v_valid boolean;
  v_verdict text;
begin
  if pg_catalog.jsonb_typeof(v_cases) is distinct from 'array' or pg_catalog.jsonb_typeof(v_metrics) is distinct from 'object' then
    return array['rapporten mangler observationer eller metrics'];
  end if;
  -- Hver observation bærer sin dokumentobservation — null netop når retrieval fejlede.
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_cases) o
             where pg_catalog.jsonb_typeof(o) <> 'object'
                or (o ->> 'outcome') not in ('evidence', 'insufficient')
                or (o ->> 'type') not in ('direct', 'multi_chunk', 'historical', 'conflict', 'unanswerable', 'distractor', 'permission', 'filter')
                or pg_catalog.jsonb_typeof(o -> 'violations') <> 'array'
                or pg_catalog.jsonb_typeof(o -> 'error') not in ('string', 'null')
                or not (o ? 'documents')
                or (pg_catalog.jsonb_typeof(o -> 'error') = 'null') <> (pg_catalog.jsonb_typeof(o -> 'documents') = 'object')
                or pg_catalog.jsonb_typeof(o -> 'documents') not in ('object', 'null')
                or (pg_catalog.jsonb_typeof(o -> 'documents') = 'object' and not knowledge.document_observation_valid(o -> 'documents'))) then
    return array['en observation har ikke den forventede form'];
  end if;
  select count(*) filter (where pg_catalog.jsonb_typeof(o -> 'error') = 'string') into v_errors
  from pg_catalog.jsonb_array_elements(v_cases) o;

  -- Metoden rangerer ikke og har ingen reranker: ingen sammenligning uden reranker.
  if (p_report -> 'rerankerComparison') is distinct from 'null'::jsonb then
    v_problems := array_append(v_problems, 'En kørsel af product_documents har ingen sammenligning uden reranker');
  end if;
  if knowledge.jsonb_keys(v_metrics) <> array['authorized_document_coverage', 'correct_product_scope', 'full_document_integrity',
                                              'required_document_coverage', 'required_passage_coverage', 'valid_version_coverage'] then
    v_problems := array_append(v_problems, 'Rapporten har ikke præcis dokumentmetrikkerne');
  end if;

  -- D1–D6: metrikken genberegnes fra observationerne, gaten fra metrikken og den låste tærskel 1.
  for v_gate in select * from knowledge.locked_document_gates() loop
    select count(*)::int, count(*) filter (where knowledge.document_case_meets(v_gate.metric, o -> 'documents'))::int
    into v_population, v_met
    from pg_catalog.jsonb_array_elements(v_cases) o
    where not v_gate.answerable_only or o ->> 'outcome' = 'evidence';
    v_value := case when v_population = 0 then null else v_met::double precision / v_population end;
    if not knowledge.eval_metric_matches(v_metrics -> v_gate.metric, v_value, v_met, v_population, knowledge.eval_wilson(v_met, v_population)) then
      v_problems := array_append(v_problems, format('%s kan ikke genberegnes', v_gate.metric));
    end if;
    v_ok := v_value is not null and v_value >= 1 - 1e-9;
    v_quality_passed := v_quality_passed and v_ok;
    select r into v_reported from pg_catalog.jsonb_array_elements(p_report -> 'qualityGates') r where r ->> 'id' = v_gate.id;
    if v_reported is null
       or (v_reported ->> 'metric') is distinct from v_gate.metric
       or (v_reported -> 'comparator') is distinct from '">="'::jsonb
       or (v_reported -> 'threshold') is distinct from '1'::jsonb
       or not knowledge.eval_close(v_reported -> 'value', v_value)
       or (v_reported ->> 'status') is distinct from (case when v_ok then 'pass' else 'fail' end)
       or (v_reported -> 'uncertain') is distinct from 'false'::jsonb then
      v_problems := array_append(v_problems, format('Dokumentgate %s kan ikke genberegnes med gate-sættet', v_gate.id));
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_report -> 'qualityGates') is distinct from 'array' or pg_catalog.jsonb_array_length(p_report -> 'qualityGates') <> 6 then
    v_problems := array_append(v_problems, 'Rapporten har ikke præcis D1–D6');
  end if;

  -- Hårde gates H1–H7 (gates.ts evaluateHardGates): nul tolerance, som for hybride rapporter.
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

  -- Minimum pr. type (gates.ts TYPE_MINIMUMS — låst, som for hybride rapporter).
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

  -- Afgørelsen (gates.ts decide): hårde gates først, så gyldighed, så kvalitet. En dokumentgate
  -- er en invariant og gør aldrig afgørelsen "uncertain".
  v_valid := v_minimums_met and v_errors = 0
    and not exists (select 1 from pg_catalog.jsonb_array_elements(v_hard) h where h ->> 'id' in ('H6', 'H7') and h ->> 'status' <> 'pass');
  v_verdict := case when not v_hard_passed or not v_valid or not v_quality_passed then 'fail' else 'pass' end;
  if (p_report -> 'valid') is distinct from pg_catalog.to_jsonb(v_valid) or (p_report ->> 'verdict') is distinct from v_verdict then
    v_problems := array_append(v_problems, format('Afgørelsen stemmer ikke: rapporten siger "%s", genberegnet "%s"', p_report ->> 'verdict', v_verdict));
  end if;
  return v_problems;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Registrering, godkendelse og retrieval-konteksten: gate-sættets metode er konfigurationens
--    (nye versioner af funktionerne fra 20261012000100; kun det markerede er ændret)
-- ----------------------------------------------------------------------------

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
  v_scope jsonb;
  v_hard_passed boolean;
  v_h6 boolean;
  v_h7 boolean;
  v_run_h6 int;
  v_quality_passed boolean;
  v_minimums_met boolean;
  v_run_id uuid;
begin
  -- Form og version (runner.ts EvaluationReport).
  if pg_catalog.jsonb_typeof(p_report) is distinct from 'object'
     or (p_report -> 'reportSchema') is distinct from '6'::jsonb
     or (p_report ->> 'kind') is distinct from 'retrieval-evaluation'
     or coalesce(p_report ->> 'engine', '') !~ '^(8B-I[0-9.]+|beta-L[0-9.]+)/[0-9]+$' then
    perform knowledge.registry_refuse('format', 'rapporten har ikke det understøttede format (reportSchema 6)');
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
  -- B-035: erklæret og runtime skal være samme metode (fingeraftrykket afgør det også; her med en
  -- klar besked, før gates og minimum vurderes).
  if knowledge.retrieval_material_method(v_declared) is distinct from knowledge.retrieval_material_method(v_runtime) then
    perform knowledge.registry_refuse('configuration', 'runtime brugte en anden retrieval-metode end den erklærede');
  end if;

  -- Gate-sættet skal være registreret og godkendt.
  select * into v_gate from knowledge.evaluation_gate_sets where checksum = p_report #>> '{gateSet,checksum}';
  if v_gate.id is null or v_gate.approved_at is null then
    perform knowledge.registry_refuse('gate_set', 'gate-sættet er ikke registreret og godkendt');
  end if;
  if (p_report #>> '{gateSet,id}') is distinct from v_gate.gate_set_id or (p_report #> '{gateSet,version}') is distinct from pg_catalog.to_jsonb(v_gate.version)
     or (p_report #>> '{gateSet,decision}') is distinct from v_gate.decision
     or (p_report #>> '{gateSet,method}') is distinct from v_gate.method
     or (p_report #> '{gateSet,k}') is distinct from coalesce(pg_catalog.to_jsonb(v_gate.k), 'null'::jsonb) then
    perform knowledge.registry_refuse('gate_set', 'rapporten beskriver gate-sættet anderledes end registret');
  end if;
  -- B-036: et gate-sæt evaluerer — og kan dermed godkende — netop én retrieval-metode. Q1–Q7
  -- gælder kun den hybride metode, D1–D6 kun product_documents.
  if v_gate.method is distinct from knowledge.retrieval_material_method(v_declared) then
    perform knowledge.registry_refuse('gate_set', format('gate-sættet gælder retrieval-metoden "%s", men konfigurationen bruger "%s"',
                                                         v_gate.method, knowledge.retrieval_material_method(v_declared)));
  end if;

  -- Korpusset: uændret under kørslen, og de evaluerede dokumenttyper (pilot-scope).
  if (p_report #>> '{corpus,checksumBefore}') is null or (p_report #>> '{corpus,checksumBefore}') is distinct from (p_report #>> '{corpus,checksumAfter}') then
    perform knowledge.registry_refuse('corpus', 'korpussets checksum ændrede sig under kørslen');
  end if;
  -- Det evaluerede område (8B-I6.2): par af produkt og dokumenttype. Produktet identificeres ved
  -- sit stabile id (knowledge.products.id); navnet er et øjebliksbillede fra evalueringen, så
  -- rapporten kan læses senere. Navnet afgør aldrig noget.
  if pg_catalog.jsonb_typeof(p_report #> '{corpus,scope}') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_report #> '{corpus,scope}') = 0
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_report #> '{corpus,scope}') e
                where pg_catalog.jsonb_typeof(e) <> 'object' or knowledge.jsonb_keys(e) <> array['documentType', 'productId', 'productName']
                   or pg_catalog.jsonb_typeof(e -> 'productId') <> 'string'
                   or (e ->> 'productId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   or pg_catalog.jsonb_typeof(e -> 'productName') <> 'string' or (e ->> 'productName') <> btrim(e ->> 'productName')
                   or length(e ->> 'productName') not between 1 and 200
                   or not exists (select 1 from knowledge.document_types d where d.key = e ->> 'documentType')) then
    perform knowledge.registry_refuse('corpus', 'det evaluerede område (produkter og dokumenttyper) er ugyldigt');
  end if;
  -- Kørslen gemmer området i rapportens rækkefølge (produkt-id, dokumenttype), præcis som det blev
  -- evalueret — også navnet. En senere omdøbning omskriver aldrig historikken.
  select pg_catalog.jsonb_agg(e order by e ->> 'productId' collate "C", e ->> 'documentType' collate "C") into v_scope
  from (select distinct on (x ->> 'productId', x ->> 'documentType') x as e
        from pg_catalog.jsonb_array_elements(p_report #> '{corpus,scope}') x
        order by x ->> 'productId', x ->> 'documentType') d;
  if pg_catalog.jsonb_array_length(v_scope) <> pg_catalog.jsonb_array_length(p_report #> '{corpus,scope}') then
    perform knowledge.registry_refuse('corpus', 'det evaluerede område indeholder dubletter');
  end if;
  select array_agg(t order by t collate "C") into v_doc_types
  from (select distinct e ->> 'documentType' as t from pg_catalog.jsonb_array_elements(v_scope) e) d;
  if knowledge.jsonb_text_array(p_report #> '{corpus,documentTypes}') is distinct from v_doc_types then
    perform knowledge.registry_refuse('corpus', 'de evaluerede dokumenttyper stemmer ikke med det evaluerede område');
  end if;

  -- Metrics, gates, minimum, tier og afgørelse genberegnes.
  v_problems := case when v_gate.method = 'product_documents' then knowledge.eval_document_report_problems(p_report, v_gate.definition)
                     else knowledge.eval_report_problems(p_report, v_gate.definition) end;
  if cardinality(v_problems) > 0 then
    perform knowledge.registry_refuse('recomputation', array_to_string(v_problems, '; '));
  end if;
  v_hard_passed := not exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'hardGates') h where h ->> 'status' <> 'pass');
  v_h6 := exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'hardGates') h where h ->> 'id' = 'H6' and h ->> 'status' = 'pass');
  v_h7 := exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'hardGates') h where h ->> 'id' = 'H7' and h ->> 'status' = 'pass');
  v_quality_passed := not exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'qualityGates') q where q ->> 'status' <> 'pass');
  v_minimums_met := not exists (select 1 from pg_catalog.jsonb_array_elements(p_report -> 'minimums') m where m -> 'met' <> 'true'::jsonb);

  -- H6 skal kunne bevises af rapporten selv (8B-I8 C4). Et brud på kørselsniveau findes netop,
  -- når runtime-fingeraftrykket (genberegnet ovenfor fra runtime-materialet) ikke er det
  -- erklærede. Et påstået brud uden afvigelse, eller en afvigelse uden brud, afvises: ingen kan
  -- udløse en suspendering — eller undgå en — med en påstand.
  select count(*) into v_run_h6 from pg_catalog.jsonb_array_elements(p_report -> 'failures') f
  where f ->> 'gate' = 'H6' and pg_catalog.jsonb_typeof(f -> 'caseId') = 'null';
  if v_declared_fp = v_runtime_fp and v_run_h6 > 0 then
    perform knowledge.registry_refuse('h6_evidence', 'rapporten påstår et H6-brud på kørselsniveau, men runtime er den erklærede konfiguration');
  elsif v_declared_fp <> v_runtime_fp and v_run_h6 <> 1 then
    perform knowledge.registry_refuse('h6_evidence', 'runtime er ikke den erklærede konfiguration, men rapporten viser ikke netop ét H6-brud på kørselsniveau');
  end if;

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
    -- B-035: en konfiguration uden embedding har ingen embedding-model.
    if knowledge.retrieval_material_method(v_declared) = 'hybrid' then
      select m.id into v_model_id from knowledge.embedding_models m
      where m.provider = v_declared #>> '{embedding,provider}' and m.model_name = v_declared #>> '{embedding,model}'
        and m.model_version = v_declared #>> '{embedding,modelVersion}' and m.dimensions = (v_declared #>> '{embedding,dimensions}')::int;
      if v_model_id is null then
        perform knowledge.registry_refuse('model', 'embedding-modellen findes ikke i knowledge.embedding_models');
      end if;
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
    corpus_checksum, evaluated_document_types, evaluated_scope, uncertain_gates, environment, active_cases, cases_by_type, metrics, hard_gates, quality_gates,
    minimums, failures, hard_gates_passed, quality_gates_passed, minimums_met, tier, verdict, valid, report,
    started_at, finished_at, registered_by_role)
  values (
    v_cfg.id, v_gate.id, p_report ->> 'runId', (p_report ->> 'reportSchema')::int, p_report ->> 'engine', v_checksum,
    p_report #>> '{checksums,results}', p_report #>> '{evalSet,setId}', (p_report #>> '{evalSet,version}')::int,
    p_report #>> '{evalSet,checksum}', v_gate.checksum, v_declared_fp, v_runtime_fp, p_report #>> '{corpus,checksumBefore}',
    v_doc_types, v_scope,
    coalesce((select array_agg(q ->> 'id' order by q ->> 'id') from pg_catalog.jsonb_array_elements(p_report -> 'qualityGates') q
              where q -> 'uncertain' = 'true'::jsonb), '{}'),
    p_report #>> '{configuration,environment}', (p_report #>> '{evalSet,activeCases}')::int, p_report #> '{evalSet,byType}',
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
  -- 8B-I6.1 (B-030): en pilot-kørsel, der kun er bestået på punktestimatet, kræver en
  -- menneskelig accept af usikkerheden. For tier standard skal gates være statistisk sikre.
  if v_run.outcome = 'pass_with_uncertainty' then
    if not exists (select 1 from knowledge.evaluation_uncertainty_acceptances a where a.run_id = v_run.id) then
      v_problems := array_append(v_problems, format('pilot-kørslens statistiske usikkerhed (%s) er ikke accepteret af et menneske',
                                                    array_to_string(v_run.uncertain_gates, ', ')));
    end if;
  elsif v_run.outcome = 'insufficient_certainty' then
    v_problems := array_append(v_problems, format('afgørelsen er "uncertain" (%s) — for tier standard skal kvalitetsgates være statistisk sikre',
                                                  array_to_string(v_run.uncertain_gates, ', ')));
  elsif v_run.outcome <> 'pass' then
    v_problems := array_append(v_problems, format('afgørelsen er "%s", ikke "pass"', v_run.verdict));
  end if;
  if v_run.environment <> 'evaluation' then v_problems := array_append(v_problems, 'kørslen er ikke fra evalueringsmiljøet'); end if;
  select * into v_gate from knowledge.evaluation_gate_sets where id = v_run.gate_set_id;
  if v_gate.approved_at is null then v_problems := array_append(v_problems, 'gate-sættet er ikke godkendt'); end if;
  -- B-036: gate-sættet skal gælde konfigurationens metode (håndhæves også ved registreringen).
  if v_gate.method is distinct from knowledge.retrieval_material_method(v_cfg.material) then
    v_problems := array_append(v_problems, 'gate-sættet gælder en anden retrieval-metode end konfigurationen');
  end if;
  if knowledge.retrieval_material_is_development(v_cfg.material) then
    v_problems := array_append(v_problems, 'konfigurationen bruger en udviklingsimplementering (test-embedder eller "none")');
  end if;
  if knowledge.retrieval_material_method(v_cfg.material) = 'product_documents' then
    -- B-035: metoden har ingen embedding-model (håndhævet af en constraint; tjekkes igen her).
    if v_cfg.embedding_model_id is not null then
      v_problems := array_append(v_problems, 'en konfiguration uden embedding må ikke pege på en embedding-model');
    end if;
  else
    select * into v_model from knowledge.embedding_models where id = v_cfg.embedding_model_id;
    if v_model.id is null or v_model.provider = 'test'
       or v_model.provider <> v_cfg.embedding_provider or v_model.model_name <> v_cfg.embedding_model
       or v_model.model_version <> v_cfg.embedding_model_version or v_model.dimensions <> v_cfg.embedding_dimensions then
      v_problems := array_append(v_problems, 'embedding-modellen findes ikke som konfigurationen beskriver den');
    end if;
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
    if v_run.id is null or not knowledge.evaluation_run_approvable(v_run.id) or v_run.configuration_id <> v_cfg.id
       or v_run.configuration_fingerprint <> v_cfg.fingerprint or v_run.runtime_fingerprint <> v_cfg.fingerprint then
      v_not_ready := array_append(v_not_ready, 'evaluation');
    end if;
    -- B-036: et godkendt gate-sæt for netop konfigurationens metode.
    if not exists (select 1 from knowledge.evaluation_gate_sets g where g.id = v_run.gate_set_id and g.approved_at is not null
                   and g.method = knowledge.retrieval_material_method(v_cfg.material)) then
      v_not_ready := array_append(v_not_ready, 'gate_set');
    end if;
    if knowledge.retrieval_material_is_development(v_cfg.material) then v_not_ready := array_append(v_not_ready, 'development'); end if;
    -- B-035: en konfiguration uden embedding afhænger ikke af den aktive embedding-model.
    if knowledge.retrieval_material_method(v_cfg.material) = 'hybrid' and (v_model ->> 'id')::uuid is distinct from v_cfg.embedding_model_id then
      v_not_ready := array_append(v_not_ready, 'model');
    elsif knowledge.retrieval_material_method(v_cfg.material) = 'product_documents' and v_cfg.embedding_model_id is not null then
      v_not_ready := array_append(v_not_ready, 'model');
    end if;
    -- Kun til information (Admin): indhold uden for det evaluerede område. Selve håndhævelsen
    -- sker pr. element (P3), så indhold uden for området aldrig bliver production.
    v_gaps := knowledge.retrieval_scope_gaps(v_cfg.approval_run_id);
  end if;

  return pg_catalog.jsonb_build_object(
    'executedAs', pg_catalog.jsonb_build_object('role', knowledge.effective_db_role(), 'userId', auth.uid()),
    'activeModel', v_model,
    'configuration', case when v_cfg.id is null then null else pg_catalog.jsonb_build_object(
      'id', v_cfg.id, 'label', v_cfg.label, 'version', v_cfg.version, 'fingerprint', v_cfg.fingerprint, 'status', v_cfg.status,
      'method', knowledge.retrieval_material_method(v_cfg.material),
      'material', v_cfg.material, 'embeddingModelId', v_cfg.embedding_model_id, 'rerankerId', v_cfg.reranker_id,
      'rerankerVersion', v_cfg.reranker_version, 'algorithmVersion', v_cfg.algorithm_version, 'params', v_cfg.params,
      'chunkerVersions', pg_catalog.to_jsonb(v_cfg.chunker_versions), 'tier', v_cfg.tier,
      'evaluation', case when v_run.id is null then null else pg_catalog.jsonb_build_object(
        'runId', v_run.id, 'reportChecksum', v_run.report_checksum, 'gateSetChecksum', v_run.gate_set_checksum,
        'verdict', v_run.verdict, 'passed', v_run.passed, 'outcome', v_run.outcome,
        'approved', knowledge.evaluation_run_approvable(v_run.id),
        'uncertaintyAccepted', exists (select 1 from knowledge.evaluation_uncertainty_acceptances a where a.run_id = v_run.id),
        'uncertainGates', pg_catalog.to_jsonb(v_run.uncertain_gates),
        'evaluatedDocumentTypes', pg_catalog.to_jsonb(v_run.evaluated_document_types)) end,
      'scope', pg_catalog.jsonb_build_object('tier', v_cfg.tier, 'entries', coalesce(v_run.evaluated_scope, '[]'::jsonb),
        'documentTypes', pg_catalog.to_jsonb(coalesce(v_run.evaluated_document_types, '{}'))),
      'scopeGaps', pg_catalog.to_jsonb(coalesce(v_gaps, '{}')),
      'productionReady', cardinality(v_not_ready) = 0,
      'notReady', pg_catalog.to_jsonb(v_not_ready)) end);
end;
$$;


-- Hjælpefunktionerne er interne som de øvrige registerfunktioner. Rettighederne på de
-- erstattede funktioner er uændrede (create or replace bevarer dem).
revoke all on function knowledge.locked_document_gates(), knowledge.document_gate_set_problem(jsonb),
  knowledge.document_observation_valid(jsonb), knowledge.document_case_meets(text, jsonb),
  knowledge.eval_document_report_problems(jsonb, jsonb) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt): genskab gate_set_problem fra 20261007000100 og record_evaluation_run,
-- retrieval_configuration_problems og retrieval_context fra 20261012000100; drop de nye
-- hjælpefunktioner, constraints og kolonnen method. Registrerede gate-sæt og kørsler bevares.
-- ----------------------------------------------------------------------------
