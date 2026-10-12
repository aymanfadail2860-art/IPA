-- ============================================================================
-- Fase 8B, deltrin I8 (C4) — H6 i regression kan suspendere sikkert, idempotent publicering
-- ============================================================================
-- Specifikation: docs/08b §4.4 (H6), §10.2, D-8 og §21.15 (C4).
--
-- §4.4: en kørsel, hvis runtime ikke er den erklærede konfiguration (H6), dokumenterer ikke
-- konfigurationen. For konfigurationen i drift er det en hård regression, og den suspenderes
-- automatisk. For alle andre konfigurationer er kørslen ugyldig (invalid_run). Indtil I8
-- afviste publiceringstrinnet en sådan rapport lokalt, før databasen kunne suspendere.
--
--   * record_evaluation_run (samme regler som før, plus): H6 skal kunne bevises af rapporten.
--     Et H6-brud på kørselsniveau findes netop, når de genberegnede fingeraftryk afviger; et
--     påstået brud uden afvigelse eller en afvigelse uden brud afvises (h6_evidence). Målet for
--     en suspendering er altid den erklærede konfiguration, og kun hvis den er i drift — en
--     rapport om B kan aldrig suspendere A. H7 afviser stadig som invalid_run (ingen suspendering).
--   * publish_evaluation_run er idempotent: præcis samme rapport igen (samme checksum og
--     indhold) giver den registrerede kørsels hændelse med replayed = true — ingen ny
--     registrering, audit eller suspendering.
--   * record_performance_measurement er idempotent på samme måde og afviser målinger fra en
--     kørsel, hvis runtime ikke var den erklærede konfiguration.
--
-- Ingen ændring af rettigheder, publisher-API, RLS, P1–P9 eller klassifikationen (I7.1).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Registrering: H6 skal kunne bevises
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


-- ----------------------------------------------------------------------------
-- 2. Performance-måling: idempotent, og kun for en kørsel af den erklærede konfiguration
-- ----------------------------------------------------------------------------

create or replace function knowledge.record_performance_measurement(p_measurement jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := knowledge.assert_publisher_caller();
  v_run knowledge.evaluation_runs;
  v_results jsonb;
  v_id uuid;
begin
  -- Idempotent (8B-I8 C4): præcis samme måling igen (et gentaget CI-job) giver den registrerede.
  select m.id into v_id from knowledge.performance_measurements m
  where m.checksum = p_measurement ->> 'checksum' and m.measurement = p_measurement;
  if v_id is not null then
    return v_id;
  end if;
  if pg_catalog.jsonb_typeof(p_measurement) is distinct from 'object'
     or (p_measurement -> 'schema') is distinct from '1'::jsonb
     or (p_measurement ->> 'kind') is distinct from 'retrieval-performance'
     or knowledge.jsonb_keys(p_measurement) <> array['checksum', 'configurationFingerprint', 'environment', 'ingestion', 'kind', 'measuredAt',
                                                     'measurementId', 'results', 'retrieval', 'runId', 'schema', 'targets']
     or knowledge.jsonb_keys(p_measurement -> 'retrieval') is distinct from array['queryEmbedding', 'rerank', 'search', 'total']
     or knowledge.jsonb_keys(p_measurement -> 'ingestion') is distinct from array['corpusPages', 'corpusSeconds', 'documents'] then
    perform knowledge.registry_refuse('format', 'målingen har ikke det understøttede format (schema 1)');
  end if;
  if exists (select 1 from pg_catalog.jsonb_each(p_measurement -> 'retrieval') s, pg_catalog.jsonb_array_elements(
               case when pg_catalog.jsonb_typeof(s.value) = 'array' then s.value else '[null]'::jsonb end) v
             where pg_catalog.jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0)
     or exists (select 1 from pg_catalog.jsonb_array_elements(
                  case when pg_catalog.jsonb_typeof(p_measurement #> '{ingestion,documents}') = 'array' then p_measurement #> '{ingestion,documents}' else '[null]'::jsonb end) d
                where knowledge.jsonb_keys(d) is distinct from array['pages', 'seconds']
                   or pg_catalog.jsonb_typeof(d -> 'pages') <> 'number' or pg_catalog.jsonb_typeof(d -> 'seconds') <> 'number')
     or pg_catalog.jsonb_typeof(p_measurement #> '{ingestion,corpusPages}') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_measurement #> '{ingestion,corpusSeconds}') not in ('number', 'null')
     or pg_catalog.jsonb_typeof(p_measurement -> 'measurementId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_measurement -> 'runId') is distinct from 'string' then
    perform knowledge.registry_refuse('format', 'målingerne skal være ikke-negative tal');
  end if;
  if knowledge.checksum_of(p_measurement - 'checksum') is distinct from (p_measurement ->> 'checksum') then
    perform knowledge.registry_refuse('checksum', 'målingens checksum stemmer ikke');
  end if;
  if (p_measurement ->> 'environment') is distinct from 'evaluation' then
    perform knowledge.registry_refuse('environment', 'kun målinger fra evalueringsmiljøet registreres');
  end if;
  select * into v_run from knowledge.evaluation_runs where run_id = p_measurement ->> 'runId';
  if v_run.id is null or v_run.runtime_fingerprint is distinct from (p_measurement ->> 'configurationFingerprint') then
    perform knowledge.registry_refuse('run', 'målingen stammer ikke fra en registreret evalueringskørsel af netop den konfiguration');
  end if;
  -- En kørsel, hvis runtime ikke var den erklærede konfiguration (H6), måler ikke konfigurationen.
  if v_run.runtime_fingerprint is distinct from v_run.configuration_fingerprint then
    perform knowledge.registry_refuse('run', 'kørslens runtime var ikke den erklærede konfiguration (H6); dens tider måler ikke konfigurationen');
  end if;
  v_results := knowledge.performance_results(p_measurement);
  if v_results is null then
    perform knowledge.registry_refuse('targets', 'ukendt version af performance-målene');
  end if;
  if v_results is distinct from (p_measurement -> 'results') then
    perform knowledge.registry_refuse('recompute', 'resultaterne stemmer ikke med målingerne og målene');
  end if;
  perform knowledge.registry_write_begin();
  insert into knowledge.performance_measurements (measurement_id, evaluation_run_id, configuration_id, configuration_fingerprint, targets_version,
                                                  results, deviations, measurement, checksum, measured_at, registered_by_role)
  values (p_measurement ->> 'measurementId', v_run.id, v_run.configuration_id, v_run.runtime_fingerprint, p_measurement ->> 'targets',
          v_results,
          coalesce((select array_agg(r ->> 'target' order by ord) from pg_catalog.jsonb_array_elements(v_results) with ordinality as x(r, ord)
                    where r ->> 'status' <> 'met'), '{}'),
          p_measurement, p_measurement ->> 'checksum', (p_measurement ->> 'measuredAt')::timestamptz, v_role)
  returning id into v_id;
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.performance_measurement.recorded', 'performance_measurements', v_id::text,
    pg_catalog.jsonb_build_object('configuration_id', v_run.configuration_id, 'fingerprint', v_run.runtime_fingerprint,
      'run_id', v_run.run_id, 'checksum', p_measurement ->> 'checksum', 'db_role', v_role));
  return v_id;
end;
$$;



-- ----------------------------------------------------------------------------
-- 3. Publicering: idempotent ved gentagelse
-- ----------------------------------------------------------------------------

create or replace function knowledge.publish_evaluation_run(p_report jsonb, p_requested_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := knowledge.assert_publisher_caller();
  v_id uuid;
begin
  if p_requested_mode is not null and p_requested_mode not in ('baseline', 'regression') then
    perform knowledge.registry_refuse('requested_mode', 'den ønskede tilstand er "baseline", "regression" eller ingen');
  end if;
  -- Præcis denne rapport er allerede registreret (et gentaget CI-job): dens hændelse, uden at
  -- registrere, auditere eller suspendere igen. En anden rapport med samme kørsels-id eller
  -- checksum afvises af record_evaluation_run som før.
  select r.id into v_id from knowledge.evaluation_runs r
  where r.report_checksum = p_report #>> '{checksums,report}' and r.report = p_report;
  if v_id is not null then
    return knowledge.evaluation_run_event(v_id) || pg_catalog.jsonb_build_object('replayed', true);
  end if;
  perform pg_catalog.set_config('knowledge.requested_mode', coalesce(p_requested_mode, ''), true);
  -- Al validering, genberegning, afvisning af ugyldige kørsler (invalid_run, h6_evidence) og
  -- suspendering sker i record_evaluation_run.
  v_id := knowledge.record_evaluation_run(p_report);
  perform pg_catalog.set_config('knowledge.requested_mode', '', true);
  return knowledge.evaluation_run_event(v_id) || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;

-- Rettighederne er uændrede: create or replace bevarer dem (kun evaluation_publisher, og kun
-- når publisher-API'et er slået til).

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt): genskab record_evaluation_run fra 20261007000300,
-- record_performance_measurement fra 20261008000100 og publish_evaluation_run fra 20261009000100.
-- ----------------------------------------------------------------------------
