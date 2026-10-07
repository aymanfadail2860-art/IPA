-- ============================================================================
-- Fase 8B, deltrin I6.1 — Pilot-evalueringspolitik og pilot-scope (B-030)
--
-- Specifikation: docs/08b §4.4 (pilotregel 4 og 5), §9, §10 og §21.10.
--
--   * Udfald af en registreret kørsel (evaluation_runs.outcome, afledt — aldrig sat):
--       pass                   alle hårde og kvalitetsgates bestået og statistisk sikre
--       pass_with_uncertainty  tier pilot: alle gates bestået på punktestimatet, men mindst ét
--                              Wilson-interval krydser tærsklen (uncertain_gates)
--       insufficient_certainty tier standard: samme situation — kan ikke godkendes
--       fail                   alt andet (ét hårdt gate-brud er altid fail)
--   * pass_with_uncertainty kan kun godkendes og aktiveres efter en eksplicit menneskelig accept
--     (knowledge.evaluation_uncertainty_acceptances: hvem, hvornår, kørsel, område, intervaller
--     og de usikre gates). Det sker aldrig automatisk. Tærsklerne ændres ikke.
--   * Pilot-scope: rapporten (reportSchema 4) bærer de evaluerede par af produkt og dokumenttype.
--     For tier pilot gælder godkendelsen kun dem; for standard dokumenttyperne (§9). Området
--     håndhæves pr. element i evidensen (P3): indhold uden for området kan aldrig blive production,
--     og et nyt produkt arver ikke en pilot-godkendelse.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Kørslens område, usikre gates og afledt udfald
-- ----------------------------------------------------------------------------

alter table knowledge.evaluation_runs
  add column evaluated_scope jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(evaluated_scope) = 'array'),
  add column uncertain_gates text[] not null default '{}';

alter table knowledge.evaluation_runs
  add column outcome text generated always as (
    case
      when verdict = 'pass' and valid and hard_gates_passed and quality_gates_passed and minimums_met then 'pass'
      when verdict = 'uncertain' and valid and hard_gates_passed and quality_gates_passed and minimums_met and tier = 'pilot' then 'pass_with_uncertainty'
      when verdict = 'uncertain' and valid and hard_gates_passed and quality_gates_passed and minimums_met then 'insufficient_certainty'
      else 'fail'
    end) stored;

comment on column knowledge.evaluation_runs.evaluated_scope is
  'Det evaluerede område: par af produkt (navn) og dokumenttype fra evalueringskorpusset (8B-I6.1).';
comment on column knowledge.evaluation_runs.outcome is
  'Afledt udfald (B-030): pass, pass_with_uncertainty (kun pilot, kræver menneskelig accept), insufficient_certainty eller fail.';

-- ----------------------------------------------------------------------------
-- 2. Menneskelig accept af statistisk usikkerhed (append-only)
-- ----------------------------------------------------------------------------

create table knowledge.evaluation_uncertainty_acceptances (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references knowledge.evaluation_runs (id) on delete restrict,
  configuration_id uuid not null references knowledge.retrieval_configurations (id) on delete restrict,
  tier text not null check (tier = 'pilot'),
  -- Kopier fra kørslen på accepttidspunktet: hvad der blev accepteret.
  scope jsonb not null,
  uncertain_gates jsonb not null,
  justification text not null check (char_length(btrim(justification)) between 20 and 2000),
  accepted_by uuid not null,
  accepted_at timestamptz not null default clock_timestamp()
);

comment on table knowledge.evaluation_uncertainty_acceptances is
  'Eksplicit menneskelig accept af statistisk usikkerhed i en pilot-kørsel (B-030). Append-only.';

create trigger evaluation_uncertainty_acceptances_append_only
  before insert or update or delete on knowledge.evaluation_uncertainty_acceptances
  for each row execute function knowledge.check_append_only();
create trigger evaluation_uncertainty_acceptances_no_truncate before truncate on knowledge.evaluation_uncertainty_acceptances
  for each statement execute function knowledge.refuse_truncate();

-- Kan kørslen bære en godkendelse? Bestået, eller pilot med accepteret usikkerhed.
create or replace function knowledge.evaluation_run_approvable(p_run_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select r.outcome = 'pass'
        or (r.outcome = 'pass_with_uncertainty'
            and exists (select 1 from knowledge.evaluation_uncertainty_acceptances a where a.run_id = r.id))
    from knowledge.evaluation_runs r where r.id = p_run_id), false)
$$;

-- Accept af usikkerheden (system.settings.manage). Kun for en pilot-kørsel, der er bestået på
-- punktestimatet, og kun én gang. Gemmer område, intervaller og de usikre gates.
create or replace function knowledge.accept_evaluation_uncertainty(p_run_id uuid, p_justification text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := knowledge.require_settings_manager();
  v_run knowledge.evaluation_runs;
  v_gates jsonb;
begin
  select * into v_run from knowledge.evaluation_runs where id = p_run_id;
  if v_run.id is null then
    perform knowledge.registry_refuse('not_found', 'kørslen findes ikke');
  end if;
  if v_run.outcome <> 'pass_with_uncertainty' then
    perform knowledge.registry_refuse('not_uncertain', format('kun en pilot-kørsel, der er bestået med statistisk usikkerhed, kan accepteres (udfald "%s")', v_run.outcome));
  end if;
  if length(btrim(coalesce(p_justification, ''))) < 20 then
    perform knowledge.registry_refuse('justification', 'accepten kræver en skriftlig begrundelse (mindst 20 tegn)');
  end if;
  if exists (select 1 from knowledge.evaluation_uncertainty_acceptances where run_id = p_run_id) then
    perform knowledge.registry_refuse('already_accepted', 'usikkerheden i kørslen er allerede accepteret');
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', q ->> 'id', 'metric', q ->> 'metric', 'comparator', q ->> 'comparator', 'threshold', q -> 'threshold', 'value', q -> 'value',
           'interval', v_run.metrics -> (q ->> 'metric') -> 'interval') order by q ->> 'id')
  into v_gates
  from pg_catalog.jsonb_array_elements(v_run.quality_gates) q where q -> 'uncertain' = 'true'::jsonb;
  perform knowledge.registry_write_begin();
  insert into knowledge.evaluation_uncertainty_acceptances (run_id, configuration_id, tier, scope, uncertain_gates, justification, accepted_by)
  values (v_run.id, v_run.configuration_id, v_run.tier, v_run.evaluated_scope, coalesce(v_gates, '[]'::jsonb), btrim(p_justification), v_actor);
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.evaluation_run.uncertainty_accepted', 'evaluation_runs', v_run.id::text,
    pg_catalog.jsonb_build_object('configuration_id', v_run.configuration_id, 'fingerprint', v_run.configuration_fingerprint,
      'report_checksum', v_run.report_checksum, 'uncertain_gates', pg_catalog.to_jsonb(v_run.uncertain_gates), 'tier', v_run.tier));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Registrering, godkendelse, aktivering og retrieval-konteksten (opdateret)
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
  v_quality_passed boolean;
  v_minimums_met boolean;
  v_run_id uuid;
begin
  -- Form og version (runner.ts EvaluationReport).
  if pg_catalog.jsonb_typeof(p_report) is distinct from 'object'
     or (p_report -> 'reportSchema') is distinct from '4'::jsonb
     or (p_report ->> 'kind') is distinct from 'retrieval-evaluation'
     or coalesce(p_report ->> 'engine', '') !~ '^8B-I[0-9.]+/[0-9]+$' then
    perform knowledge.registry_refuse('format', 'rapporten har ikke det understøttede format (reportSchema 4)');
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
  -- Det evaluerede område (8B-I6.1): de par af produkt og dokumenttype, korpusset indeholdt.
  -- Produktet identificeres ved sit navn, som er unikt (knowledge.products).
  if pg_catalog.jsonb_typeof(p_report #> '{corpus,scope}') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_report #> '{corpus,scope}') = 0
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_report #> '{corpus,scope}') e
                where pg_catalog.jsonb_typeof(e) <> 'object' or knowledge.jsonb_keys(e) <> array['documentType', 'product']
                   or pg_catalog.jsonb_typeof(e -> 'product') <> 'string' or (e ->> 'product') <> btrim(e ->> 'product')
                   or length(e ->> 'product') not between 1 and 200
                   or not exists (select 1 from knowledge.document_types d where d.key = e ->> 'documentType')) then
    perform knowledge.registry_refuse('corpus', 'det evaluerede område (produkter og dokumenttyper) er ugyldigt');
  end if;
  select pg_catalog.jsonb_agg(e order by e ->> 'product', e ->> 'documentType') into v_scope
  from (select distinct pg_catalog.jsonb_build_object('product', x ->> 'product', 'documentType', x ->> 'documentType') as e
        from pg_catalog.jsonb_array_elements(p_report #> '{corpus,scope}') x) d;
  if pg_catalog.jsonb_array_length(v_scope) <> pg_catalog.jsonb_array_length(p_report #> '{corpus,scope}') then
    perform knowledge.registry_refuse('corpus', 'det evaluerede område indeholder dubletter');
  end if;
  select array_agg(t order by t collate "C") into v_doc_types
  from (select distinct e ->> 'documentType' as t from pg_catalog.jsonb_array_elements(v_scope) e) d;
  if knowledge.jsonb_text_array(p_report #> '{corpus,documentTypes}') is distinct from v_doc_types then
    perform knowledge.registry_refuse('corpus', 'de evaluerede dokumenttyper stemmer ikke med det evaluerede område');
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

create or replace function knowledge.retrieval_scope_gaps(p_run_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  with run as (
    select r.tier, r.evaluated_scope, r.evaluated_document_types from knowledge.evaluation_runs r where r.id = p_run_id
  ),
  published as (
    select distinct p.name as product, d.document_type
    from knowledge.document_versions v
    join knowledge.documents d on d.id = v.document_id
    join knowledge.products p on p.id = d.product_id
    where v.status = 'published'
  )
  select coalesce(array_agg(pub.product || ' / ' || pub.document_type order by pub.product, pub.document_type), '{}')
  from published pub
  where not exists (
    select 1 from run
    where case when run.tier = 'pilot'
               then run.evaluated_scope @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('product', pub.product, 'documentType', pub.document_type))
               else pub.document_type = any (run.evaluated_document_types) end)
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
    if v_run.id is null or v_run.configuration_id <> new.id or not knowledge.evaluation_run_approvable(v_run.id)
       or v_run.configuration_fingerprint <> new.fingerprint or v_run.runtime_fingerprint <> new.fingerprint
       or v_run.gate_set_id <> new.gate_set_id or v_run.tier <> new.tier then
      raise exception 'En godkendt konfiguration kræver en bestået (eller, for pilot, accepteret) registreret kørsel af netop den konfiguration'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

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
  -- 8B-I6.1: det evaluerede område håndhæves pr. element i evidensen (P3), ikke ved at
  -- blokere aktiveringen. Indhold uden for området kan aldrig blive production.
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
    if not exists (select 1 from knowledge.evaluation_gate_sets g where g.id = v_run.gate_set_id and g.approved_at is not null) then
      v_not_ready := array_append(v_not_ready, 'gate_set');
    end if;
    if knowledge.retrieval_material_is_development(v_cfg.material) then v_not_ready := array_append(v_not_ready, 'development'); end if;
    if (v_model ->> 'id')::uuid is distinct from v_cfg.embedding_model_id then v_not_ready := array_append(v_not_ready, 'model'); end if;
    -- Kun til information (Admin): indhold uden for det evaluerede område. Selve håndhævelsen
    -- sker pr. element (P3), så indhold uden for området aldrig bliver production.
    v_gaps := knowledge.retrieval_scope_gaps(v_cfg.approval_run_id);
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

-- ----------------------------------------------------------------------------
-- 4. RLS og rettigheder
-- ----------------------------------------------------------------------------

alter table knowledge.evaluation_uncertainty_acceptances enable row level security;
create policy evaluation_uncertainty_acceptances_select on knowledge.evaluation_uncertainty_acceptances
  for select to authenticated using (identity.has_permission('system.settings.manage'));
revoke all on knowledge.evaluation_uncertainty_acceptances from public, anon, authenticated, service_role;
grant select on knowledge.evaluation_uncertainty_acceptances to authenticated;

revoke all on function
  knowledge.evaluation_run_approvable(uuid),
  knowledge.accept_evaluation_uncertainty(uuid, text),
  knowledge.retrieval_scope_gaps(uuid)
from public, anon, authenticated, service_role;
grant execute on function knowledge.accept_evaluation_uncertainty(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt): genskab funktionerne fra 20261007000100, drop
-- knowledge.evaluation_uncertainty_acceptances, accept_evaluation_uncertainty,
-- evaluation_run_approvable og kolonnerne outcome, uncertain_gates og evaluated_scope.
-- ----------------------------------------------------------------------------
