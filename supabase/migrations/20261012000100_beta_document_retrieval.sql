-- ============================================================================
-- Beta (B-035), L1 — retrieval uden embedding: "produktdokumenter i fuld længde"
-- ============================================================================
-- Specifikation: docs/beta.md §4–§5 og docs/decisions.md B-035 (K1, K2).
--
-- En ny retrieval-metode, product_documents, uden embedding-model og reranker. Brugeren vælger
-- ét produkt, og databasen udleverer — som den indloggede bruger, gennem RLS og adgangsfiltret —
-- alle chunks i de publicerede dokumentversioner for produktet, der gælder på datoen, inden for
-- de valgte dokumenttyper, i dokumentrækkefølge. Overstiger grundlaget budgettet (maxChars,
-- en del af konfigurationens fingeraftryk), afvises kaldet; det afkortes aldrig.
--
--   * Materialet: {method: "product_documents", embedding: null, reranker: null,
--     algorithmVersion: "product-documents-<n>", params: {maxChars}, chunkerVersions}. Hybride
--     materialer (8B-I6) er uændrede og har intet "method"-felt — deres fingeraftryk er uændrede.
--   * Registret: en konfiguration uden embedding har ingen embedding-model (constraint). Den er
--     ikke en udviklingskonfiguration og kan registreres, godkendes og aktiveres ad præcis samme
--     vej som en hybrid: bestået registreret evaluering, godkendt gate-sæt, menneskelig
--     godkendelse og aktivering (system.settings.manage). Intet bliver production automatisk.
--   * Retrieval-konteksten oplyser metoden. Den aktive embedding-model påvirker ikke
--     beredskabet for en konfiguration uden embedding.
--   * Publicering (K2): embeddings kræves, når en embedding-model er aktiv. Uden aktiv model kan
--     ingen søgning bruge vektorer, og kravet bortfalder. Alle andre blokeringer (metadata,
--     ulæste sider, gyldighed, review-status) og frigivelseskravet fra upload-sikkerheden (I5)
--     er uændrede. En hybrid konfiguration kan fortsat kun aktiveres, når dens model dækker alle
--     chunks.
--
-- Ingen ændring af rettigheder, RLS, P3–P9, gates, publisherens API eller hybride materialer.
-- Ingen data ændres eller slettes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Metoden og dens materiale
-- ----------------------------------------------------------------------------

-- Metoden, et materiale beskriver: "product_documents" eller "hybrid" (alle materialer fra 8B).
create or replace function knowledge.retrieval_material_method(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(p) = 'object' and p ? 'method' then p ->> 'method' else 'hybrid' end
$$;

-- Materialets form for metoden product_documents (B-035). Null = gyldigt.
create or replace function knowledge.document_retrieval_material_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object'
     or knowledge.jsonb_keys(p) <> array['algorithmVersion', 'chunkerVersions', 'embedding', 'method', 'params', 'reranker'] then
    return 'materialet har ikke de definerende felter';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'method') is distinct from 'string' or (p ->> 'method') is distinct from 'product_documents' then
    return 'ukendt retrieval-metode';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'embedding') is distinct from 'null' then
    return 'metoden product_documents har ingen embedding-model';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'reranker') is distinct from 'null' then
    return 'metoden product_documents har ingen reranker';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'algorithmVersion') is distinct from 'string' or (p ->> 'algorithmVersion') !~ '^product-documents-[0-9]{1,6}$' then
    return 'algoritmeversionen er ugyldig';
  end if;
  if pg_catalog.jsonb_typeof(p -> 'params') is distinct from 'object' or knowledge.jsonb_keys(p -> 'params') <> array['maxChars'] then
    return 'parametrene er ufuldstændige';
  end if;
  if pg_catalog.jsonb_typeof(p #> '{params,maxChars}') is distinct from 'number'
     or (p #>> '{params,maxChars}')::numeric not between 10000 and 2000000
     or (p #>> '{params,maxChars}')::numeric <> pg_catalog.trunc((p #>> '{params,maxChars}')::numeric) then
    return 'parameteren maxChars er ugyldig';
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

-- Materialets form (docs/08b §10.1, RetrievalFingerprintMaterial). Null = gyldigt. Et materiale med
-- feltet "method" er en embedding-fri metode (B-035) og valideres for sig; alle andre er hybride
-- og valideres som hidtil (uændret nedenfor).
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
  if pg_catalog.jsonb_typeof(p) = 'object' and p ? 'method' then
    return knowledge.document_retrieval_material_problem(p);
  end if;
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
-- "none"-rerankeren i et hybridt materiale. En konfiguration uden embedding (B-035) er ingen
-- udviklingskonfiguration — men kun med et gyldigt materiale; et ugyldigt er det altid.
create or replace function knowledge.retrieval_material_is_development(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when knowledge.retrieval_material_method(p) = 'product_documents' then knowledge.document_retrieval_material_problem(p) is not null
    else p -> 'embedding' is null or pg_catalog.jsonb_typeof(p -> 'embedding') = 'null'
      or (p #>> '{embedding,provider}') = 'test'
      or (p #>> '{reranker,id}') = 'none'
      or (p #>> '{reranker,model}') = 'none'
  end
$$;

-- ----------------------------------------------------------------------------
-- 2. Registret: embedding-modellen følger metoden
-- ----------------------------------------------------------------------------

alter table knowledge.retrieval_configurations alter column embedding_model_id drop not null;
alter table knowledge.retrieval_configurations add constraint retrieval_configurations_model_by_method
  check ((knowledge.retrieval_material_method(material) = 'product_documents') = (embedding_model_id is null));

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

  -- Embedding-modellen: skift i samme transaktion, hvis konfigurationen bruger en anden. En
  -- konfiguration uden embedding (B-035) rører ikke modellerne.
  if knowledge.retrieval_material_method(v_cfg.material) = 'hybrid' then
    select * into v_model from knowledge.embedding_models where id = v_cfg.embedding_model_id for update;
  end if;
  if v_model.id is not null and v_model.status <> 'active' then
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
      'embedding_model_id', v_cfg.embedding_model_id, 'method', knowledge.retrieval_material_method(v_cfg.material),
      'model_switched', coalesce(v_previous_model is not null or v_model.status <> 'active', false)));
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


-- ----------------------------------------------------------------------------
-- 3. Publicering (K2): embeddings kræves, når en embedding-model er aktiv
-- ----------------------------------------------------------------------------

create or replace function knowledge.publication_requires_embeddings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from knowledge.embedding_models where status = 'active')
$$;

-- Kun til databasens egne funktioner (review_state er security definer).
revoke all on function knowledge.publication_requires_embeddings() from public, anon, authenticated, service_role;

create or replace function knowledge.review_state(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_report jsonb;
  v_facts jsonb;
  v_plan jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_unread int;
begin
  if not knowledge.is_knowledge_manager() then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  select ver.*, d.title, d.document_type, d.product_id into v
  from knowledge.document_versions ver join knowledge.documents d on d.id = ver.document_id
  where ver.id = p_version_id;
  if v.id is null then
    raise exception 'Versionen findes ikke' using errcode = 'no_data_found';
  end if;

  select j.quality_report into v_report
  from knowledge.ingestion_jobs j
  where j.document_version_id = p_version_id and j.kind = 'process' and j.status = 'succeeded'
  order by j.finished_at desc nulls last limit 1;
  v_facts := knowledge.compute_quality_facts(p_version_id);
  v_plan := knowledge.publication_plan(p_version_id);

  -- Blokeringer
  if v.status <> 'under_review' then
    v_blockers := v_blockers || jsonb_build_object('code', 'not_under_review',
      'message', 'Versionen er ikke under review.');
  end if;
  if v.version_label is null then v_missing := array_append(v_missing, 'versionsbetegnelse'); end if;
  if v.valid_from is null then v_missing := array_append(v_missing, 'gyldig fra'); end if;
  if v.title is null or btrim(v.title) = '' then v_missing := array_append(v_missing, 'titel'); end if;
  if v.document_type is null then v_missing := array_append(v_missing, 'dokumenttype'); end if;
  if v.product_id is null then v_missing := array_append(v_missing, 'produkt'); end if;
  if v.language is null then v_missing := array_append(v_missing, 'sprog'); end if;
  if cardinality(v_missing) > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'metadata_missing',
      'message', 'Obligatorisk metadata mangler: ' || array_to_string(v_missing, ', ') || '.', 'fields', to_jsonb(v_missing));
  end if;

  select count(*) into v_unread from knowledge.document_pages p where p.document_version_id = p_version_id and not p.has_text_layer;
  if v_unread > 0 or not exists (select 1 from knowledge.document_pages p where p.document_version_id = p_version_id)
     or coalesce((v_report -> 'pages' ->> 'all_read')::boolean, false) = false then
    v_blockers := v_blockers || jsonb_build_object('code', 'pages_unread',
      'message', format('Ikke alle sider er læst (%s af %s). Et delvist læst dokument kan ikke godkendes.',
                        coalesce(v_report -> 'pages' ->> 'read', '?'), coalesce(v_report -> 'pages' ->> 'total', '?')));
  end if;

  -- B-035 (K2): embeddings kræves, når en embedding-model er aktiv — så kan søgningen bruge
  -- vektorer. Uden aktiv model bruger ingen søgning vektorer, og publicering kræver dem ikke.
  if knowledge.publication_requires_embeddings() and not knowledge.version_has_active_embeddings(p_version_id) then
    v_blockers := v_blockers || jsonb_build_object('code', 'embeddings_missing',
      'message', 'Ikke alle tekstsegmenter har embeddings med den aktive embedding-model.');
  end if;

  if v.valid_from is not null and not coalesce((v_plan ->> 'ok')::boolean, false) then
    v_blockers := v_blockers || jsonb_build_object('code', coalesce(v_plan ->> 'code', 'validity_conflict'),
      'message', coalesce(v_plan ->> 'message', 'Gyldigheden kan ikke indpasses.'));
  end if;

  -- Advarsler (blokerer ikke; vises igen i bekræftelsesdialogen)
  if coalesce((v_facts -> 'access' ->> 'no_grants')::boolean, false) then
    v_warnings := v_warnings || jsonb_build_object('code', 'no_grants',
      'message', 'Dokumentet har ingen adgangstildelinger. Kun administratorer kan finde det.');
  end if;
  if jsonb_array_length(coalesce(v_facts -> 'duplicates', '[]')) > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'duplicate',
      'message', 'Den samme fil findes allerede som en anden version.');
  end if;
  if v_plan -> 'predecessor' is not null and v_plan -> 'predecessor' <> 'null'::jsonb then
    v_warnings := v_warnings || jsonb_build_object('code', 'predecessor_superseded',
      'message', format('Version %s bliver erstattet og gælder til %s.',
                        coalesce(v_plan -> 'predecessor' ->> 'version_label', ''), v_plan -> 'predecessor' ->> 'valid_to_after'));
  end if;
  if v_plan -> 'gap_after' is not null and v_plan -> 'gap_after' <> 'null'::jsonb then
    v_warnings := v_warnings || jsonb_build_object('code', 'validity_gap',
      'message', format('Der bliver et hul i gyldigheden fra %s.', v_plan -> 'gap_after' ->> 'from'));
  end if;
  if v_facts -> 'validity' -> 'gap_before' is not null and v_facts -> 'validity' -> 'gap_before' <> 'null'::jsonb then
    v_warnings := v_warnings || jsonb_build_object('code', 'validity_gap',
      'message', format('Der er et hul i gyldigheden fra %s til %s.',
                        v_facts -> 'validity' -> 'gap_before' ->> 'from', v_facts -> 'validity' -> 'gap_before' ->> 'to'));
  end if;
  if v_report is not null then
    if not coalesce((v_report -> 'structure' ->> 'recognized')::boolean, true) then
      v_warnings := v_warnings || jsonb_build_object('code', 'structure_not_recognized',
        'message', 'Dokumentets struktur (overskrifter) blev ikke genkendt.');
    end if;
    if coalesce((v_report -> 'chunks' ->> 'without_heading')::int, 0) > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'chunks_without_heading',
        'message', format('%s afsnit uden overskrift.', v_report -> 'chunks' ->> 'without_heading'));
    end if;
    if coalesce((v_report -> 'tables' ->> 'uncertain')::int, 0) > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'uncertain_tables',
        'message', format('%s tabel(ler) med usikker struktur.', v_report -> 'tables' ->> 'uncertain'));
    end if;
    if jsonb_array_length(coalesce(v_report -> 'normalization' -> 'encoding_warnings', '[]')) > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'encoding',
        'message', 'Mulige tegnsætsfejl (æ, ø, å).');
    end if;
  end if;

  return jsonb_build_object(
    'status', v.status,
    'can_approve', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'publication', v_plan,
    'quality_report', coalesce(v_report, '{}'::jsonb) || v_facts
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. Retrieval-metoden product_documents
-- ----------------------------------------------------------------------------

-- Alle chunks i de dokumentversioner, brugeren må læse, for ÉT produkt (docs/beta.md §4).
--
--   * SECURITY INVOKER og STABLE som search_chunks: RLS gælder, adgangsfiltret ligger i
--     forespørgslen, og funktionen kan ikke skrive. Forespørgslens tekst indgår ikke.
--   * Kun publicerede versioner, der gælder på datoen, i det valgte sprog — højst én pr. dokument
--     (exclusion constraint). Klientens filtre (dokumenter, dokumenttyper) kan kun snævre ind.
--   * Hele versioner: version_chunk_count er versionens antal chunks, så kaldet kan efterprøve,
--     at intet mangler. Overstiger teksten budgettet, afvises kaldet — der afkortes aldrig.
--   * Rækkefølgen er dokumentets: dokumenttype, titel, dokument, chunk.
--   * Samme kolonner som search_chunks (rangeringskolonnerne er null), plus version_chunk_count.
create function knowledge.product_document_chunks(
  p_product_id uuid,
  p_mode text default 'current',
  p_as_of date default null,
  p_language text default 'da',
  p_document_ids uuid[] default null,
  p_document_types text[] default null,
  p_max_chars int default 360000
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
  chunker_version text,
  version_chunk_count int
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_date date;
  v_chars bigint;
begin
  if p_product_id is null then
    raise exception 'Vælg et produkt' using errcode = 'invalid_parameter_value';
  end if;
  if p_mode not in ('current', 'as_of') then
    raise exception 'Ukendt tilstand: %', p_mode using errcode = 'invalid_parameter_value';
  end if;
  if p_mode = 'as_of' and p_as_of is null then
    raise exception 'Historisk opslag kræver en dato' using errcode = 'invalid_parameter_value';
  end if;
  if p_max_chars is null or p_max_chars not between 10000 and 2000000 then
    raise exception 'Ugyldigt budget' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(cardinality(p_document_ids), 0) > 100 or coalesce(cardinality(p_document_types), 0) > 50 then
    raise exception 'For mange filtre' using errcode = 'invalid_parameter_value';
  end if;

  v_date := case when p_mode = 'current' then knowledge.today() else p_as_of end;

  -- Budgettet: hele grundlaget som brugeren må læse det. Over budgettet afvises kaldet.
  select coalesce(sum(char_length(c.text) + coalesce(char_length(c.lead_in), 0)), 0) into v_chars
  from knowledge.document_versions v
  join knowledge.documents d on d.id = v.document_id
  join knowledge.document_chunks c on c.document_version_id = v.id
  where d.product_id = p_product_id
    and v.status = 'published'
    and v.language = p_language
    and daterange(v.valid_from, v.valid_to, '[)') @> v_date
    and (p_document_ids is null or d.id = any (p_document_ids))
    and (p_document_types is null or d.document_type = any (p_document_types))
    and knowledge.can_read_version(v.id, 'any');
  if v_chars > p_max_chars then
    raise exception 'Dokumentgrundlaget for produktet er for stort til ét samlet svar (% tegn, højst %). Afgræns til de dokumenter, spørgsmålet gælder.', v_chars, p_max_chars
      using errcode = 'program_limit_exceeded';
  end if;

  return query
    with allowed as (
      select v.id, v.version_label, v.language, v.valid_from, v.valid_to, v.approved_at, v.superseded_by, v.chunker_version,
             d.id as document_id, d.title, d.document_type, pr.id as product_id, pr.name as product_name,
             knowledge.source_type(d.source_id) as source_type
      from knowledge.document_versions v
      join knowledge.documents d on d.id = v.document_id
      join knowledge.products pr on pr.id = d.product_id
      where d.product_id = p_product_id
        and v.status = 'published'
        and v.language = p_language
        and daterange(v.valid_from, v.valid_to, '[)') @> v_date
        and (p_document_ids is null or d.id = any (p_document_ids))
        and (p_document_types is null or d.document_type = any (p_document_types))
        and knowledge.can_read_version(v.id, 'any')
    )
    select c.id, c.chunk_index, c.kind, c.text, c.lead_in, c.heading, c.heading_path, c.section_number,
           c.page_start, c.page_end, c.char_start, c.char_end, c.overlap_chars,
           a.id, a.version_label, a.language, a.valid_from, a.valid_to, a.approved_at, a.superseded_by,
           a.document_id, a.title, a.document_type, a.product_id, a.product_name, a.source_type,
           case when a.valid_from > knowledge.today() then 'future'
                when a.valid_to is not null and a.valid_to <= knowledge.today() then 'historical'
                else 'current' end,
           null::int, null::double precision, null::int, null::double precision, '{}'::text[],
           a.chunker_version,
           (select count(*)::int from knowledge.document_chunks x where x.document_version_id = a.id)
    from allowed a
    join knowledge.document_chunks c on c.document_version_id = a.id
    order by a.document_type collate "C", a.title collate "C", a.document_id, c.chunk_index;
end;
$$;

-- Kun som den indloggede bruger (P6), som search_chunks — ikke service_role.
revoke all on function knowledge.product_document_chunks(uuid, text, date, text, uuid[], text[], int) from public, anon, authenticated, service_role;
grant execute on function knowledge.product_document_chunks(uuid, text, date, text, uuid[], text[], int) to authenticated;

-- Hjælpefunktionerne er interne som materialefunktionerne fra 8B-I6.
revoke all on function knowledge.retrieval_material_method(jsonb), knowledge.document_retrieval_material_problem(jsonb)
  from public, anon, authenticated, service_role;
