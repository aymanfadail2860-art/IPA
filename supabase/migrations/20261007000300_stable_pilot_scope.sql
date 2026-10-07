-- ============================================================================
-- Fase 8B, deltrin I6.2 — Stabil produktidentitet i pilot-scope (B-031)
--
-- Specifikation: docs/08b §21.11.
--
--   * Et evalueret område er nu { productId, productName, documentType } (reportSchema 5).
--     productId (knowledge.products.id) er den autoritative identitet; productName er navnet på
--     evalueringstidspunktet og bruges kun til at forklare rapporten.
--   * En omdøbning ændrer hverken kørslen eller accepten (append-only). Et omdøbt, evalueret
--     produkt forbliver i området; et nyt produkt med samme navn har et andet id og arver intet.
--   * Pilotreglen for usikkerhed, tærskler, H1–H7 og P1–P9 er uændrede. P3 sammenligner nu
--     elementets produkt-id (production-conditions.ts).
-- ============================================================================

-- Kørsler med det gamle område (produktnavn som identitet) kan ikke oversættes sikkert og kan ikke
-- rettes (append-only). Der findes ingen uden for lokale tests; findes der alligevel en, stoppes
-- migrationen i stedet for at gætte.
do $$
begin
  if exists (select 1 from knowledge.evaluation_runs r, pg_catalog.jsonb_array_elements(r.evaluated_scope) e where not e ? 'productId') then
    raise exception 'Der findes registrerede kørsler med et område uden produkt-id (reportSchema 4). De skal evalueres igen, før 8B-I6.2 kan anvendes.';
  end if;
end $$;

comment on column knowledge.evaluation_runs.evaluated_scope is
  'Det evaluerede område: { productId, productName, documentType } fra evalueringskorpusset. productId er identiteten; productName er navnet på evalueringstidspunktet (8B-I6.2).';

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
     or (p_report -> 'reportSchema') is distinct from '5'::jsonb
     or (p_report ->> 'kind') is distinct from 'retrieval-evaluation'
     or coalesce(p_report ->> 'engine', '') !~ '^8B-I[0-9.]+/[0-9]+$' then
    perform knowledge.registry_refuse('format', 'rapporten har ikke det understøttede format (reportSchema 5)');
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
  -- Publiceret indhold uden for det godkendte område, vist med produktets nuværende navn. For
  -- pilot sammenlignes på produktets stabile id (8B-I6.2), aldrig på navnet.
  with run as (
    select r.tier, r.evaluated_scope, r.evaluated_document_types from knowledge.evaluation_runs r where r.id = p_run_id
  ),
  published as (
    select distinct p.id as product_id, p.name as product, d.document_type
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
               then run.evaluated_scope @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('productId', pub.product_id::text, 'documentType', pub.document_type))
               else pub.document_type = any (run.evaluated_document_types) end)
$$;
