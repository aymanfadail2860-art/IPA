-- ============================================================================
-- Fase 8B, deltrin I7 — Evaluation Operations, Monitoring & Regression Guardrails (B-032)
--
-- Specifikation: docs/08b §4.5, §10.2, §12, §14, §17 pkt. 9–10 og §21.10 (definitionen af I7).
--
--   * Miljøets art (ops.environment): sættes kun af databasens ejer ved udrulning. En
--     evalueringskørsel mod databasen kræver arten "evaluation" — den rører aldrig produktion.
--   * Regressionshændelser: en registreret kørsel af konfigurationen i drift er en regression.
--     Den auditeres med evalueringssæt, gate-sæt og runtime-fingeraftryk. Et hårdt gate-brud
--     suspenderer fortsat i record_evaluation_run (D-8, uændret); et fejlet kvalitetsgate er en
--     alarm til vurdering.
--   * Performance-målinger (§12, §17 pkt. 10): registreres af evaluation_publisher med
--     konfigurationens fingeraftryk; databasen genberegner percentiler og resultater mod de
--     versionerede mål. En afvigelse kræver en dokumenteret menneskelig godkendelse.
--   * Systemstatus (§14): kø, fejl, scanner, konfiguration, evaluering og performance som tal og
--     id'er — aldrig dokumentindhold, forespørgsler eller persondata. Læses af workerens planlagte
--     kontrol og af Admin (system.settings.manage).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Miljøets art
-- ----------------------------------------------------------------------------

create table ops.environment (
  singleton boolean primary key default true check (singleton),
  kind text not null check (kind in ('local', 'evaluation', 'staging', 'production')),
  set_at timestamptz not null default now(),
  set_by text not null default session_user
);
revoke all on ops.environment from public, anon, authenticated, service_role;

comment on table ops.environment is
  'Miljøets art (8B-I7). Sættes kun af ejeren ved udrulning (ops.set_environment_kind). Uden række er arten "unset".';

-- Kun databasens ejer (ingen grants). Auditeres.
create or replace function ops.set_environment_kind(p_kind text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('local', 'evaluation', 'staging', 'production') then
    raise exception 'Ukendt miljøart: %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  insert into ops.environment (singleton, kind) values (true, p_kind)
  on conflict (singleton) do update set kind = excluded.kind, set_at = now(), set_by = session_user;
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, details)
  values (null, 'ops.environment.set', 'ops', 'environment', p_kind, pg_catalog.jsonb_build_object('db_user', session_user::text));
end;
$$;
revoke all on function ops.set_environment_kind(text) from public, anon, authenticated, service_role;

create or replace function knowledge.environment_kind()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select e.kind from ops.environment e), 'unset') $$;

-- ----------------------------------------------------------------------------
-- 2. Regressionshændelser (§10.2, §14 "Kvalitetsregression")
-- ----------------------------------------------------------------------------

-- En kørsel af konfigurationen i drift er en regression. Den auditeres altid med det, der
-- forklarer den: evalueringssæt, gate-sæt, fingeraftryk og de fejlede gates. Udfaldet:
--   hard_gate_regression  et hårdt gate-brud — konfigurationen suspenderes i samme transaktion
--   quality_regression    et kvalitetsgate fejler — alarm og faglig/teknisk vurdering
--   pass                  ingen regression
create or replace function knowledge.audit_evaluation_regression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_gate knowledge.evaluation_gate_sets;
  v_kind text;
begin
  select c.status into v_status from knowledge.retrieval_configurations c where c.id = new.configuration_id;
  if v_status is distinct from 'active' then
    return null;
  end if;
  select * into v_gate from knowledge.evaluation_gate_sets g where g.id = new.gate_set_id;
  v_kind := case when not new.hard_gates_passed then 'hard_gate_regression'
                 when not new.quality_gates_passed then 'quality_regression'
                 else 'pass' end;
  perform knowledge.write_audit('knowledge.evaluation_run.regression', 'evaluation_runs', new.id::text,
    pg_catalog.jsonb_build_object(
      'result', v_kind,
      'configuration_id', new.configuration_id,
      'run_id', new.run_id,
      'report_checksum', new.report_checksum,
      'outcome', new.outcome,
      'eval_set', pg_catalog.jsonb_build_object('id', new.eval_set_id, 'version', new.eval_set_version, 'checksum', new.eval_set_checksum),
      'gate_set', pg_catalog.jsonb_build_object('id', v_gate.gate_set_id, 'version', v_gate.version, 'checksum', new.gate_set_checksum),
      'runtime_fingerprint', new.runtime_fingerprint,
      'configuration_fingerprint', new.configuration_fingerprint,
      'corpus_checksum', new.corpus_checksum,
      'failed_hard_gates', coalesce((select pg_catalog.jsonb_agg(h ->> 'id' order by h ->> 'id') from pg_catalog.jsonb_array_elements(new.hard_gates) h where h ->> 'status' <> 'pass'), '[]'::jsonb),
      'failed_quality_gates', coalesce((select pg_catalog.jsonb_agg(q ->> 'id' order by q ->> 'id') from pg_catalog.jsonb_array_elements(new.quality_gates) q where q ->> 'status' <> 'pass'), '[]'::jsonb)));
  return null;
end;
$$;

create trigger evaluation_runs_regression_audit
  after insert on knowledge.evaluation_runs
  for each row execute function knowledge.audit_evaluation_regression();

-- ----------------------------------------------------------------------------
-- 3. Performance-målinger (§12, §17 pkt. 10)
-- ----------------------------------------------------------------------------

-- Målene i §12, versionsstyret. Tallene er grænser (≤). Ændres kun med en ny version og en
-- beslutning i docs/decisions.md.
create or replace function knowledge.performance_targets(p_version text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_version
    when 'performance-targets-v1' then '[
      {"target": "retrieval_total_p50", "limit": 800},
      {"target": "retrieval_total_p95", "limit": 1500},
      {"target": "query_embedding_p95", "limit": 300},
      {"target": "search_p95", "limit": 300},
      {"target": "rerank_p95", "limit": 500},
      {"target": "ingestion_50_pages_seconds", "limit": 300},
      {"target": "ingestion_corpus_2000_pages_seconds", "limit": 14400}
    ]'::jsonb
  end
$$;

-- Nearest-rank-percentil med heltal (samme formel som evals/engine/performance.ts): rang
-- k = ceil(p·n/100), værdien er den k'te mindste. Null uden målinger.
create or replace function knowledge.nearest_rank(p_samples jsonb, p_percent int)
returns numeric
language sql
immutable
set search_path = ''
as $$
  with s as (
    select (v #>> '{}')::numeric as x, pg_catalog.row_number() over (order by (v #>> '{}')::numeric) as r,
           pg_catalog.count(*) over () as n
    from pg_catalog.jsonb_array_elements(p_samples) v
  )
  select x from s where r = (p_percent * n + 99) / 100
$$;

-- Resultaterne for et sæt målinger, genberegnet fra målingerne selv.
create or replace function knowledge.performance_results(p_measurement jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_targets jsonb := knowledge.performance_targets(p_measurement ->> 'targets');
  v_r jsonb := p_measurement -> 'retrieval';
  v_i jsonb := p_measurement -> 'ingestion';
  v_values jsonb;
  v_big numeric;
begin
  if v_targets is null then
    return null;
  end if;
  select max((d ->> 'seconds')::numeric) into v_big
  from pg_catalog.jsonb_array_elements(coalesce(v_i -> 'documents', '[]'::jsonb)) d where (d ->> 'pages')::int >= 50;
  v_values := pg_catalog.jsonb_build_object(
    'retrieval_total_p50', knowledge.nearest_rank(v_r -> 'total', 50),
    'retrieval_total_p95', knowledge.nearest_rank(v_r -> 'total', 95),
    'query_embedding_p95', knowledge.nearest_rank(v_r -> 'queryEmbedding', 95),
    'search_p95', knowledge.nearest_rank(v_r -> 'search', 95),
    'rerank_p95', knowledge.nearest_rank(v_r -> 'rerank', 95),
    'ingestion_50_pages_seconds', v_big,
    'ingestion_corpus_2000_pages_seconds',
      case when (v_i ->> 'corpusPages')::int >= 2000 then (v_i ->> 'corpusSeconds')::numeric end);
  return (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'target', t ->> 'target',
             'limit', (t -> 'limit'),
             'value', v_values -> (t ->> 'target'),
             'status', case when pg_catalog.jsonb_typeof(v_values -> (t ->> 'target')) is distinct from 'number' then 'not_measured'
                            when (v_values ->> (t ->> 'target'))::numeric <= (t ->> 'limit')::numeric then 'met'
                            else 'not_met' end)
           order by ord)
    from pg_catalog.jsonb_array_elements(v_targets) with ordinality as x(t, ord));
end;
$$;

create table knowledge.performance_measurements (
  id uuid primary key default gen_random_uuid(),
  measurement_id text not null unique check (length(measurement_id) between 1 and 100),
  evaluation_run_id uuid not null references knowledge.evaluation_runs (id) on delete restrict,
  configuration_id uuid not null references knowledge.retrieval_configurations (id) on delete restrict,
  configuration_fingerprint text not null check (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  targets_version text not null,
  results jsonb not null,
  -- Afvigelser: mål, der ikke er nået eller ikke er målt. De kræver en godkendelse (§17 pkt. 10).
  deviations text[] not null,
  measurement jsonb not null,
  checksum text not null unique check (checksum ~ '^[0-9a-f]{64}$'),
  measured_at timestamptz not null,
  registered_at timestamptz not null default clock_timestamp(),
  registered_by_role text not null
);
create index performance_measurements_configuration on knowledge.performance_measurements (configuration_id, registered_at desc);

comment on table knowledge.performance_measurements is
  'Performance-målinger fra evalueringsmiljøet med konfigurationens fingeraftryk (8B-I7). Append-only; registreres af evaluation_publisher.';

create table knowledge.performance_deviation_acceptances (
  id uuid primary key default gen_random_uuid(),
  measurement_id uuid not null unique references knowledge.performance_measurements (id) on delete restrict,
  deviations jsonb not null,
  justification text not null check (char_length(btrim(justification)) between 20 and 2000),
  accepted_by uuid not null,
  accepted_at timestamptz not null default clock_timestamp()
);

comment on table knowledge.performance_deviation_acceptances is
  'Dokumenteret menneskelig godkendelse af en performance-afvigelse (§17 pkt. 10, 8B-I7). Append-only.';

create trigger performance_measurements_append_only
  before insert or update or delete on knowledge.performance_measurements
  for each row execute function knowledge.check_append_only();
create trigger performance_measurements_no_truncate before truncate on knowledge.performance_measurements
  for each statement execute function knowledge.refuse_truncate();
create trigger performance_deviation_acceptances_append_only
  before insert or update or delete on knowledge.performance_deviation_acceptances
  for each row execute function knowledge.check_append_only();
create trigger performance_deviation_acceptances_no_truncate before truncate on knowledge.performance_deviation_acceptances
  for each statement execute function knowledge.refuse_truncate();

-- Registrering (kun evaluation_publisher). Målingen skal stamme fra en registreret
-- evalueringskørsel af netop den konfiguration; databasen genberegner percentiler og resultater.
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

-- Godkendelse af en afvigelse (system.settings.manage). Kun når der er en, og kun én gang.
create or replace function knowledge.accept_performance_deviation(p_measurement_id uuid, p_justification text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := knowledge.require_settings_manager();
  v_m knowledge.performance_measurements;
begin
  select * into v_m from knowledge.performance_measurements where id = p_measurement_id;
  if v_m.id is null then
    perform knowledge.registry_refuse('not_found', 'målingen findes ikke');
  end if;
  if cardinality(v_m.deviations) = 0 then
    perform knowledge.registry_refuse('no_deviation', 'målingen har ingen afvigelse at godkende');
  end if;
  if length(btrim(coalesce(p_justification, ''))) < 20 then
    perform knowledge.registry_refuse('justification', 'en godkendelse kræver en skriftlig begrundelse (mindst 20 tegn)');
  end if;
  if exists (select 1 from knowledge.performance_deviation_acceptances where measurement_id = p_measurement_id) then
    perform knowledge.registry_refuse('already_accepted', 'afvigelsen er allerede godkendt');
  end if;
  perform knowledge.registry_write_begin();
  insert into knowledge.performance_deviation_acceptances (measurement_id, deviations, justification, accepted_by)
  values (v_m.id,
          (select pg_catalog.jsonb_agg(r order by ord) from pg_catalog.jsonb_array_elements(v_m.results) with ordinality as x(r, ord) where r ->> 'status' <> 'met'),
          btrim(p_justification), v_actor);
  perform knowledge.registry_write_end();
  perform knowledge.write_audit('knowledge.performance_measurement.deviation_accepted', 'performance_measurements', v_m.id::text,
    pg_catalog.jsonb_build_object('configuration_id', v_m.configuration_id, 'fingerprint', v_m.configuration_fingerprint,
      'deviations', pg_catalog.to_jsonb(v_m.deviations)));
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Systemstatus (§14)
-- ----------------------------------------------------------------------------

-- Tal og id'er — aldrig dokumentindhold, titler, forespørgsler eller persondata.
create or replace function ops.system_health()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with cfg as (
    select c.* from knowledge.retrieval_configurations c where c.status in ('active', 'suspended') limit 1
  ),
  run as (
    select r.* from knowledge.evaluation_runs r join cfg on r.configuration_id = cfg.id
    order by r.registered_at desc limit 1
  ),
  perf as (
    select m.* from knowledge.performance_measurements m join cfg on m.configuration_id = cfg.id
    order by m.registered_at desc limit 1
  ),
  scan as (
    select v.signature_time, v.created_at from knowledge.security_verdicts v
    where v.signature_time is not null order by v.created_at desc limit 1
  )
  select pg_catalog.jsonb_build_object(
    'generatedAt', pg_catalog.now(),
    'environment', knowledge.environment_kind(),
    'queue', (select pg_catalog.jsonb_build_object(
        'queued', count(*) filter (where j.status = 'queued'),
        'running', count(*) filter (where j.status = 'running'),
        'oldestQueuedSeconds', floor(extract(epoch from pg_catalog.now() - min(j.created_at) filter (where j.status = 'queued')))::bigint,
        'expiredLeases', count(*) filter (where j.status = 'running' and j.locked_until < pg_catalog.now()))
      from knowledge.ingestion_jobs j where j.status in ('queued', 'running')),
    'failures', pg_catalog.jsonb_build_object(
        'failedLast24h', (select count(*) from knowledge.ingestion_jobs j where j.status = 'failed' and j.finished_at > pg_catalog.now() - interval '24 hours'),
        'byCodeLast24h', coalesce((select pg_catalog.jsonb_object_agg(code, n) from (
            select coalesce(j.error_code, 'unknown') as code, count(*) as n from knowledge.ingestion_jobs j
            where j.status = 'failed' and j.finished_at > pg_catalog.now() - interval '24 hours' group by 1) x), '{}'::jsonb),
        'recentFailedJobIds', coalesce((select pg_catalog.jsonb_agg(id order by finished_at desc) from (
            select j.id, j.finished_at from knowledge.ingestion_jobs j where j.status = 'failed' and j.finished_at > pg_catalog.now() - interval '24 hours'
            order by j.finished_at desc limit 50) x), '[]'::jsonb)),
    'processing', pg_catalog.jsonb_build_object(
        'stuckOverOneHour', (select count(*) from knowledge.document_versions v where v.status = 'processing' and v.updated_at < pg_catalog.now() - interval '1 hour')),
    'scanner', pg_catalog.jsonb_build_object(
        'latestVerdictAt', (select created_at from scan),
        -- Signaturernes alder, da de sidst blev brugt (ikke "nu": uden uploads står scanneren stille).
        'signatureAgeAtLatestVerdictSeconds', (select floor(extract(epoch from created_at - signature_time))::bigint from scan),
        'scanFailedLast24h', (select count(*) from knowledge.security_verdicts v where v.final_verdict = 'scan_failed' and v.created_at > pg_catalog.now() - interval '24 hours'),
        'infectedLast24h', (select count(*) from knowledge.security_verdicts v where v.malware_result = 'infected' and v.created_at > pg_catalog.now() - interval '24 hours')),
    'configuration', (select pg_catalog.jsonb_build_object(
        'id', cfg.id, 'label', cfg.label, 'version', cfg.version, 'status', cfg.status, 'fingerprint', cfg.fingerprint,
        'tier', cfg.tier, 'suspendedAt', cfg.suspended_at, 'suspensionReason', cfg.suspension_reason) from cfg),
    'evaluation', (select pg_catalog.jsonb_build_object(
        'runId', run.run_id, 'registeredAt', run.registered_at, 'outcome', run.outcome,
        'regression', run.id is distinct from (select approval_run_id from cfg),
        'hardGatesPassed', run.hard_gates_passed, 'qualityGatesPassed', run.quality_gates_passed,
        'evalSet', pg_catalog.jsonb_build_object('id', run.eval_set_id, 'version', run.eval_set_version, 'checksum', run.eval_set_checksum),
        'gateSetChecksum', run.gate_set_checksum, 'runtimeFingerprint', run.runtime_fingerprint) from run),
    'performance', (select pg_catalog.jsonb_build_object(
        'measurementId', perf.id, 'registeredAt', perf.registered_at, 'deviations', pg_catalog.to_jsonb(perf.deviations),
        'accepted', exists (select 1 from knowledge.performance_deviation_acceptances a where a.measurement_id = perf.id)) from perf))
$$;
revoke all on function ops.system_health() from public, anon, authenticated, service_role;

-- Workerens planlagte kontrol (§14, hvert 5. minut). Del af worker-API'et.
create or replace function knowledge.worker_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform knowledge.assert_worker_caller();
  return ops.system_health();
end;
$$;

-- Admins "Systemstatus" (system.settings.manage).
create or replace function knowledge.system_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform knowledge.require_settings_manager();
  return ops.system_health();
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Rettigheder og API-lister
-- ----------------------------------------------------------------------------

alter table knowledge.performance_measurements enable row level security;
create policy performance_measurements_select on knowledge.performance_measurements
  for select to authenticated using (identity.has_permission('system.settings.manage'));
alter table knowledge.performance_deviation_acceptances enable row level security;
create policy performance_deviation_acceptances_select on knowledge.performance_deviation_acceptances
  for select to authenticated using (identity.has_permission('system.settings.manage'));
revoke all on knowledge.performance_measurements, knowledge.performance_deviation_acceptances from public, anon, authenticated, service_role;
grant select on knowledge.performance_measurements, knowledge.performance_deviation_acceptances to authenticated;

revoke all on function
  knowledge.environment_kind(),
  knowledge.audit_evaluation_regression(),
  knowledge.performance_targets(text),
  knowledge.nearest_rank(jsonb, int),
  knowledge.performance_results(jsonb),
  knowledge.record_performance_measurement(jsonb),
  knowledge.accept_performance_deviation(uuid, text),
  knowledge.worker_system_health(),
  knowledge.system_status()
from public, anon, authenticated, service_role;
-- Miljøets art er ikke fortrolig og læses af evalueringskørslen (som evalueringsbruger).
grant execute on function knowledge.environment_kind() to authenticated, service_role;
grant execute on function knowledge.accept_performance_deviation(uuid, text) to authenticated;
grant execute on function knowledge.system_status() to authenticated;

-- evaluation_publisher: også performance-målinger.
create or replace function ops.evaluation_publisher_api()
returns regprocedure[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'knowledge.record_evaluation_run(jsonb)',
    'knowledge.register_evaluation_gate_set(jsonb)',
    'knowledge.record_performance_measurement(jsonb)'
  ]::regprocedure[]
$$;

-- ingestion_worker: også den planlagte sundhedskontrol.
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
    'knowledge.worker_issue_storage_ticket(uuid, text, text)',
    'knowledge.worker_security_scan_context(uuid, text)',
    'knowledge.worker_record_security_verdict(uuid, text, jsonb)',
    'knowledge.worker_security_clearance(uuid, text, text)',
    'knowledge.worker_system_health()'
  ]::regprocedure[]
$$;

-- De nye funktioner tildeles kun, hvis API'et er slået til (en nødspærring forbliver i kraft).
do $$
begin
  if pg_catalog.has_function_privilege('ingestion_worker', 'knowledge.worker_claim_job(text, int)', 'EXECUTE') then
    grant execute on function knowledge.worker_system_health() to ingestion_worker;
  end if;
  if pg_catalog.has_function_privilege('evaluation_publisher', 'knowledge.record_evaluation_run(jsonb)', 'EXECUTE') then
    grant execute on function knowledge.record_performance_measurement(jsonb) to evaluation_publisher;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt): drop triggeren evaluation_runs_regression_audit, tabellerne
-- performance_measurements og performance_deviation_acceptances, ops.environment og de nye
-- funktioner; genskab ops.evaluation_publisher_api og ops.ingestion_worker_api fra
-- 20261007000100 og 20261006000200.
-- ----------------------------------------------------------------------------
