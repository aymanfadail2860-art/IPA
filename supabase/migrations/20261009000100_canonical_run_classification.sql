-- ============================================================================
-- Fase 8B, deltrin I7.1 — Kanonisk klassifikation af evalueringskørsler (B-033)
-- ============================================================================
-- Specifikation: docs/08b §4.4, §10.2 og §21.13.
--
-- Databasen er source of truth for, hvad en registreret kørsel ER. Den kaldende CI-kørsel må
-- gerne sige, hvad den har tænkt sig (baseline eller regression). Det gemmes som diagnostik
-- (requested_mode), men afgør aldrig klassifikation, alvor, suspendering, alarmkode eller
-- production-tilstand.
--
--   * registered_while: konfigurationens status i databasen, i det øjeblik kørslen registreres
--     (rækken er låst i record_evaluation_run). Sættes af en trigger; kalderen kan ikke sætte den.
--   * knowledge.evaluation_run_classification(run): én regel —
--       baseline              konfigurationen var ikke i drift (kandidat, godkendt, suspenderet,
--                             udfaset)
--       hard_gate_regression  i drift, et hårdt gate er brudt — suspenderet i samme transaktion
--       quality_regression    i drift, ingen hårde brud, men udfaldet er ikke bestået — vurdering
--       regression            i drift og bestået (pass eller pass_with_uncertainty)
--     En ugyldig kørsel (H7, eller H6 for en konfiguration uden for drift) registreres aldrig;
--     den afvises med koden invalid_run og kan derfor hverken blive baseline eller bestået.
--   * knowledge.publish_evaluation_run(rapport, ønsket tilstand): registrerer som
--     evaluation_publisher og returnerer databasens klassifikation. Publiceringstrinnet
--     afleder alarmerne af den — ikke af CI-jobbets mode.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Forudsætning: ingen registrerede kørsler. Konfigurationens status ved en tidligere
--    registrering kan ikke rekonstrueres sikkert. Der findes ingen uden for lokale tests.
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from knowledge.evaluation_runs) then
    raise exception 'I7.1: der findes registrerede evalueringskørsler. Konfigurationens status ved registreringen kan ikke rekonstrueres; migrationen kræver en tom knowledge.evaluation_runs.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Status ved registreringen og den ønskede tilstand (kun diagnostik)
-- ----------------------------------------------------------------------------

alter table knowledge.evaluation_runs
  add column registered_while text not null
    check (registered_while in ('candidate', 'approved', 'active', 'suspended', 'retired')),
  add column requested_mode text check (requested_mode in ('baseline', 'regression'));

comment on column knowledge.evaluation_runs.registered_while is
  'Konfigurationens status i databasen, da kørslen blev registreret (8B-I7.1). Sat af databasen, aldrig af kalderen.';
comment on column knowledge.evaluation_runs.requested_mode is
  'Den tilstand, CI-kørslen bad om (baseline eller regression). Kun diagnostik: afgør aldrig klassifikation, alvor, suspendering eller alarm (8B-I7.1).';

create or replace function knowledge.evaluation_run_set_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := nullif(pg_catalog.current_setting('knowledge.requested_mode', true), '');
begin
  -- Databasens egen status for konfigurationen lige nu (rækken er låst af record_evaluation_run).
  -- Hvad kalderen måtte have sat, overskrives.
  select c.status into new.registered_while from knowledge.retrieval_configurations c where c.id = new.configuration_id;
  -- Kalderens ønske gemmes kun, hvis det er en kendt tilstand.
  new.requested_mode := case when v_mode in ('baseline', 'regression') then v_mode end;
  return new;
end;
$$;

create trigger evaluation_runs_registration
  before insert on knowledge.evaluation_runs
  for each row execute function knowledge.evaluation_run_set_registration();

-- ----------------------------------------------------------------------------
-- 2. Klassifikationen — én regel, brugt af audit, systemstatus og publiceringen
-- ----------------------------------------------------------------------------

create or replace function knowledge.evaluation_run_classification(p_run knowledge.evaluation_runs)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_run.registered_while is distinct from 'active' then 'baseline'
    when not p_run.hard_gates_passed then 'hard_gate_regression'
    when p_run.outcome in ('pass', 'pass_with_uncertainty') then 'regression'
    else 'quality_regression'
  end
$$;

-- Hændelsen for en registreret kørsel: klassifikation, konfigurationens tilstand nu, og det,
-- der forklarer den (sæt, gate-sæt, fingeraftryk, korpus, fejlede gates). Tal, id'er og
-- checksums — intet indhold.
create or replace function knowledge.evaluation_run_event(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', r.id,
    'runId', r.run_id,
    'registeredAt', r.registered_at,
    'classification', knowledge.evaluation_run_classification(r),
    'requestedMode', r.requested_mode,
    'registeredWhile', r.registered_while,
    'outcome', r.outcome,
    'configurationId', r.configuration_id,
    'configurationStatus', c.status,
    'suspended', c.status = 'suspended' and c.suspension_run_id is not distinct from r.id,
    'evalSet', pg_catalog.jsonb_build_object('id', r.eval_set_id, 'version', r.eval_set_version, 'checksum', r.eval_set_checksum),
    'gateSet', pg_catalog.jsonb_build_object('id', g.gate_set_id, 'version', g.version, 'checksum', r.gate_set_checksum),
    'runtimeFingerprint', r.runtime_fingerprint,
    'corpusChecksum', r.corpus_checksum,
    'failedHardGates', coalesce((select pg_catalog.jsonb_agg(h ->> 'id' order by h ->> 'id') from pg_catalog.jsonb_array_elements(r.hard_gates) h where h ->> 'status' <> 'pass'), '[]'::jsonb),
    'failedQualityGates', coalesce((select pg_catalog.jsonb_agg(q ->> 'id' order by q ->> 'id') from pg_catalog.jsonb_array_elements(r.quality_gates) q where q ->> 'status' <> 'pass'), '[]'::jsonb))
  from knowledge.evaluation_runs r
  join knowledge.retrieval_configurations c on c.id = r.configuration_id
  join knowledge.evaluation_gate_sets g on g.id = r.gate_set_id
  where r.id = p_run_id
$$;

-- Regressionsauditten (8B-I7) bruger nu den kanoniske klassifikation og gemmer den ønskede
-- tilstand ved siden af — så en uoverensstemmelse kan ses bagefter.
create or replace function knowledge.audit_evaluation_regression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class text := knowledge.evaluation_run_classification(new);
  v_gate knowledge.evaluation_gate_sets;
begin
  if v_class = 'baseline' then
    return null;
  end if;
  select * into v_gate from knowledge.evaluation_gate_sets g where g.id = new.gate_set_id;
  perform knowledge.write_audit('knowledge.evaluation_run.regression', 'evaluation_runs', new.id::text,
    pg_catalog.jsonb_build_object(
      'result', case v_class when 'regression' then 'pass' else v_class end,
      'classification', v_class,
      'requested_mode', new.requested_mode,
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

-- ----------------------------------------------------------------------------
-- 3. Registrering med databasens klassifikation (kun evaluation_publisher)
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
  perform pg_catalog.set_config('knowledge.requested_mode', coalesce(p_requested_mode, ''), true);
  -- Al validering, genberegning, afvisning af ugyldige kørsler (invalid_run) og suspendering
  -- sker uændret i record_evaluation_run.
  v_id := knowledge.record_evaluation_run(p_report);
  perform pg_catalog.set_config('knowledge.requested_mode', '', true);
  return knowledge.evaluation_run_event(v_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Systemstatus: klassifikationen i stedet for en afledning i læseren
-- ----------------------------------------------------------------------------

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
    select r.*, knowledge.evaluation_run_classification(r) as classification
    from knowledge.evaluation_runs r join cfg on r.configuration_id = cfg.id
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
        -- Databasens klassifikation (I7.1), aldrig kalderens ønskede tilstand.
        'classification', run.classification,
        'regression', run.classification <> 'baseline',
        'requestedMode', run.requested_mode,
        'hardGatesPassed', run.hard_gates_passed, 'qualityGatesPassed', run.quality_gates_passed,
        'evalSet', pg_catalog.jsonb_build_object('id', run.eval_set_id, 'version', run.eval_set_version, 'checksum', run.eval_set_checksum),
        'gateSetChecksum', run.gate_set_checksum, 'runtimeFingerprint', run.runtime_fingerprint) from run),
    'performance', (select pg_catalog.jsonb_build_object(
        'measurementId', perf.id, 'registeredAt', perf.registered_at, 'deviations', pg_catalog.to_jsonb(perf.deviations),
        'accepted', exists (select 1 from knowledge.performance_deviation_acceptances a where a.measurement_id = perf.id)) from perf))
$$;
revoke all on function ops.system_health() from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Rettigheder og publisherens API
-- ----------------------------------------------------------------------------

revoke all on function
  knowledge.evaluation_run_set_registration(),
  knowledge.evaluation_run_classification(knowledge.evaluation_runs),
  knowledge.evaluation_run_event(uuid),
  knowledge.publish_evaluation_run(jsonb, text)
from public, anon, authenticated, service_role;

create or replace function ops.evaluation_publisher_api()
returns regprocedure[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'knowledge.record_evaluation_run(jsonb)',
    'knowledge.register_evaluation_gate_set(jsonb)',
    'knowledge.record_performance_measurement(jsonb)',
    'knowledge.publish_evaluation_run(jsonb, text)'
  ]::regprocedure[]
$$;

-- Tildeles kun, hvis API'et er slået til (en nødspærring forbliver i kraft).
do $$
begin
  if pg_catalog.has_function_privilege('evaluation_publisher', 'knowledge.record_evaluation_run(jsonb)', 'EXECUTE') then
    grant execute on function knowledge.publish_evaluation_run(jsonb, text) to evaluation_publisher;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt): drop triggeren evaluation_runs_registration, kolonnerne
-- registered_while og requested_mode og de nye funktioner; genskab audit_evaluation_regression,
-- ops.system_health og ops.evaluation_publisher_api fra 20261008000100.
-- ----------------------------------------------------------------------------
