-- ============================================================================
-- Fase 8B, deltrin I5 — Upload-sikkerhed, karantæne og malware-scanning (§7, docs/08b §21.6)
--
-- Sikkerhedsgrænsen mellem en uploadet originalfil og ingestion-pipelinen:
--
--   upload → I karantæne (bucket knowledge-intake) → scan-job:
--     strukturel validering → ClamAV → PDF-sikkerhedsinspektion → verdict (afledt her)
--     → safe: frigivelse (filen flyttes til knowledge-originals, checksum kontrolleres igen)
--       → behandlingsjob → parsing/chunking/embedding
--     → afvist: knowledge-quarantine (ingen læsepolitikker) — kan ikke behandles
--     → teknisk scanfejl: genforsøg, fail-closed
--
--   * En version kan kun blive "processed" eller "published", hvis den er frigivet
--     (security_state = released). Det håndhæves af en trigger for ALLE roller.
--   * Sikkerhedskolonnerne kan kun ændres af databasens egne funktioner (tabellens ejer),
--     aldrig af en klient, service_role eller en almindelig opdatering.
--   * "safe" afledes her ud fra workerens måleresultater — aldrig et felt, nogen kan sætte.
--   * Verdict er bundet til version, sti, checksum og sikkerhedspolitikkens version.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Buckets: intake (karantæne for nye uploads), originals (kun frigivne), quarantine (afviste)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-intake', 'knowledge-intake', false, 52428800, array['application/pdf']),
       ('knowledge-quarantine', 'knowledge-quarantine', false, 52428800, null)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Uploads går nu kun til intake. Ingen kan læse intake eller quarantine gennem API'et.
drop policy if exists knowledge_originals_insert on storage.objects;
create policy knowledge_intake_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'knowledge-intake'
    and identity.has_permission('knowledge.document.write')
    and knowledge.is_original_path(name)
    and not exists (select 1 from knowledge.document_versions v where v.storage_path = name)
  );

-- ----------------------------------------------------------------------------
-- 2. Sikkerhedspolitik (versioneret). Ændres kun ved migration — ingen rettigheder.
-- ----------------------------------------------------------------------------

create table knowledge.security_policies (
  version text primary key check (version ~ '^[a-z0-9][a-z0-9.-]{0,40}$'),
  active boolean not null default false,
  max_signature_age interval not null check (max_signature_age > interval '0' and max_signature_age <= interval '7 days'),
  limits jsonb not null check (jsonb_typeof(limits) = 'object'),
  description text not null,
  created_at timestamptz not null default now()
);
create unique index security_policies_one_active on knowledge.security_policies ((true)) where active;

insert into knowledge.security_policies (version, active, max_signature_age, limits, description) values (
  'pdf-v1', true, interval '24 hours',
  '{"max_bytes": 52428800, "max_pages": 2000, "max_objects": 200000, "max_object_stream_bytes": 20971520,
    "max_total_inflated_bytes": 104857600, "max_inflate_ratio": 200, "max_nesting_depth": 64,
    "inspect_timeout_ms": 60000, "inspect_memory_mb": 512, "scan_timeout_ms": 120000}'::jsonb,
  'V1: kun PDF med tekstlag; krypterede PDF''er, aktivt indhold og indlejrede filer afvises; ClamAV med signaturer højst 24 timer gamle.'
);

-- Udviklingsscannere (lokalt/test, uden ClamAV). Tom i migrationer; kun det lokale seed
-- (supabase/seed.sql) indsætter en række. I produktion er tabellen tom.
create table knowledge.security_development_scanners (
  engine text primary key check (engine ~ '^development-[a-z0-9-]{1,40}$')
);

create or replace function knowledge.active_security_policy()
returns knowledge.security_policies
language sql
stable
set search_path = ''
as $$
  select * from knowledge.security_policies where active
$$;

-- ----------------------------------------------------------------------------
-- 3. Verdict (auditérbart, uforanderligt bortset fra frigivelse/afløsning)
-- ----------------------------------------------------------------------------

create table knowledge.security_verdicts (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references knowledge.document_versions (id) on delete restrict,
  job_id uuid references knowledge.ingestion_jobs (id) on delete set null,
  policy_version text not null references knowledge.security_policies (version),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  detected_mime text not null check (char_length(detected_mime) between 1 and 100),
  object_bucket text not null,
  object_path text not null,
  structural_result text not null check (structural_result in ('pass', 'fail')),
  structural_code text,
  malware_result text not null check (malware_result in ('clean', 'infected', 'error', 'not_scanned')),
  malware_name text check (malware_name is null or malware_name ~ '^[A-Za-z0-9._:/-]{1,120}$'),
  malware_code text,
  scanner_engine text,
  scanner_version text,
  signature_version text,
  signature_time timestamptz,
  pdf_security_result text not null check (pdf_security_result in ('pass', 'fail', 'error', 'not_run')),
  pdf_security_code text,
  active_content_result text not null check (active_content_result in ('pass', 'fail', 'not_run')),
  findings text[] not null default '{}',
  final_verdict text not null check (final_verdict in ('safe', 'rejected', 'scan_failed')),
  failure_code text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  superseded_at timestamptz,
  superseded_reason text,
  check ((final_verdict = 'safe') = (failure_code is null)),
  check (released_at is null or final_verdict = 'safe')
);
create index security_verdicts_version_idx on knowledge.security_verdicts (document_version_id, created_at desc);

-- Kun frigivelse og afløsning må ændres — én gang.
create or replace function knowledge.check_security_verdict_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Et sikkerhedsverdict slettes aldrig' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'released_at' - 'superseded_at' - 'superseded_reason')
     is distinct from (to_jsonb(old) - 'released_at' - 'superseded_at' - 'superseded_reason')
     or (old.released_at is not null and new.released_at is distinct from old.released_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'Et sikkerhedsverdict kan ikke ændres' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger security_verdicts_immutable
  before update or delete on knowledge.security_verdicts
  for each row execute function knowledge.check_security_verdict_update();

-- ----------------------------------------------------------------------------
-- 4. Versionens sikkerhedstilstand
-- ----------------------------------------------------------------------------

-- Eksisterende versioner (før I5) er ikke scannet: legacy_unscanned i knowledge-originals.
alter table knowledge.document_versions
  add column security_state text not null default 'legacy_unscanned'
    check (security_state in ('quarantined', 'scanning', 'released', 'rejected', 'scan_failed', 'legacy_unscanned')),
  add column storage_bucket text not null default 'knowledge-originals'
    check (storage_bucket in ('knowledge-intake', 'knowledge-originals', 'knowledge-quarantine')),
  add column security_verdict_id uuid references knowledge.security_verdicts (id),
  add column security_released_at timestamptz,
  add column quarantined_at timestamptz;
alter table knowledge.document_versions alter column security_state set default 'quarantined';
alter table knowledge.document_versions alter column storage_bucket set default 'knowledge-intake';
alter table knowledge.document_versions
  add constraint document_versions_released_has_verdict
    check (security_state <> 'released' or (security_verdict_id is not null and storage_bucket = 'knowledge-originals'));

create or replace function knowledge.check_version_security()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner text := (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = 'knowledge.document_versions'::regclass);
  v_allowed text[][] := array[
    ['quarantined', 'scanning'],
    ['scanning', 'released'], ['scanning', 'rejected'], ['scanning', 'scan_failed'], ['scanning', 'quarantined'],
    ['scan_failed', 'scanning'], ['scan_failed', 'quarantined'],
    ['released', 'quarantined'],
    ['legacy_unscanned', 'quarantined']
  ];
  v_pair text[];
  v_ok boolean := false;
begin
  if tg_op = 'INSERT' then
    -- En ny version starter altid i karantæne i intake — for alle, også ejeren.
    if new.security_state <> 'quarantined' or new.storage_bucket <> 'knowledge-intake' or new.security_verdict_id is not null
       or new.security_released_at is not null or new.quarantined_at is not null then
      raise exception 'En ny version starter altid i karantæne' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.security_state, new.storage_bucket, new.security_verdict_id, new.security_released_at, new.quarantined_at)
     is distinct from (old.security_state, old.storage_bucket, old.security_verdict_id, old.security_released_at, old.quarantined_at) then
    -- Kun databasens egne funktioner (tabellens ejer) må ændre sikkerhedstilstanden.
    if current_user <> v_owner then
      raise exception 'Sikkerhedstilstanden kan kun ændres af sikkerhedskontrollen' using errcode = 'insufficient_privilege';
    end if;
    if new.security_state <> old.security_state then
      foreach v_pair slice 1 in array v_allowed loop
        if v_pair[1] = old.security_state and v_pair[2] = new.security_state then
          v_ok := true;
        end if;
      end loop;
      if not v_ok then
        raise exception 'Ugyldig sikkerhedsovergang: % → %', old.security_state, new.security_state using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- Behandlet eller publiceret kræver en frigivet fil — for alle roller.
  if new.status is distinct from old.status and new.status in ('processed', 'published') and new.security_state <> 'released' then
    raise exception 'Versionen har ikke bestået sikkerhedskontrollen' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger document_versions_check_security
  before insert or update on knowledge.document_versions
  for each row execute function knowledge.check_version_security();

-- Scan-jobs (sikkerhedskontrollen) som egen job-art.
alter table knowledge.ingestion_jobs drop constraint ingestion_jobs_kind_check;
alter table knowledge.ingestion_jobs add constraint ingestion_jobs_kind_check check (kind in ('scan', 'process', 'reembed'));
-- Højst én aktiv sikkerhedskontrol pr. version: to scanninger kan ikke køre eller frigive parallelt.
create unique index ingestion_jobs_one_active_scan on knowledge.ingestion_jobs (document_version_id)
  where kind = 'scan' and status in ('queued', 'running');

-- ----------------------------------------------------------------------------
-- 5. Afledning af verdict og frigivelsesgrund
-- ----------------------------------------------------------------------------

-- Grunden til, at en version IKKE må behandles (null = frigivet og gyldig). p_sha256 er
-- checksummen af de bytes, workeren faktisk har hentet (null før download).
create or replace function knowledge.security_block_reason(p_version_id uuid, p_sha256 text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v knowledge.document_versions;
  d knowledge.security_verdicts;
  p knowledge.security_policies := knowledge.active_security_policy();
begin
  select * into v from knowledge.document_versions where id = p_version_id;
  if v.id is null then return 'version_unknown'; end if;
  if v.security_state <> 'released' then return 'not_released'; end if;
  select * into d from knowledge.security_verdicts where id = v.security_verdict_id;
  if d.id is null or d.document_version_id <> v.id then return 'no_verdict'; end if;
  if d.final_verdict <> 'safe' then return 'verdict_not_safe'; end if;
  if d.superseded_at is not null then return 'verdict_superseded'; end if;
  if d.released_at is null then return 'verdict_not_released'; end if;
  if p.version is null or d.policy_version <> p.version then return 'policy_outdated'; end if;
  if d.malware_result <> 'clean' or d.structural_result <> 'pass' or d.pdf_security_result <> 'pass' or d.active_content_result <> 'pass' then
    return 'verdict_incomplete';
  end if;
  if d.checksum_sha256 <> v.checksum_sha256 then return 'checksum_mismatch'; end if;
  if p_sha256 is not null and p_sha256 <> d.checksum_sha256 then return 'bytes_changed'; end if;
  if d.object_path <> v.storage_path or v.storage_bucket <> 'knowledge-originals' then return 'object_mismatch'; end if;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Workerens sikkerheds-API (udvider I3-API'et; samme identitet og lease-capability)
-- ----------------------------------------------------------------------------

-- Konteksten for et scan-job: politik, grænser og hvad uploaden erklærede.
create function knowledge.worker_security_scan_context(p_job_id uuid, p_lease_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v knowledge.document_versions;
  p knowledge.security_policies := knowledge.active_security_policy();
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(v_job.kind = 'scan', 'kun et scan-job har en sikkerhedskontekst');
  select * into v from knowledge.document_versions where id = v_job.document_version_id;
  if p.version is null then
    raise exception 'Ingen aktiv sikkerhedspolitik' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'security_state', v.security_state,
    'storage_bucket', v.storage_bucket,
    'policy_version', p.version,
    'max_signature_age_seconds', extract(epoch from p.max_signature_age)::int,
    'limits', p.limits,
    'checksum_sha256', v.checksum_sha256,
    'byte_size', v.byte_size,
    'upload_mime', v.mime_type,
    'original_filename', v.original_filename
  );
end;
$$;

-- Workeren indberetter sine måleresultater. Databasen afleder det endelige verdict.
create function knowledge.worker_record_security_verdict(p_job_id uuid, p_lease_token text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v knowledge.document_versions;
  p knowledge.security_policies := knowledge.active_security_policy();
  v_structural text := p_result #>> '{structural,result}';
  v_structural_code text := p_result #>> '{structural,code}';
  v_malware text := p_result #>> '{malware,result}';
  v_malware_code text := p_result #>> '{malware,code}';
  v_malware_name text := p_result #>> '{malware,name}';
  v_engine text := p_result #>> '{scanner,engine}';
  v_signature_time timestamptz;
  v_pdf text := p_result #>> '{pdf_security,result}';
  v_pdf_code text := p_result #>> '{pdf_security,code}';
  v_active text := p_result #>> '{active_content,result}';
  v_findings text[];
  v_final text;
  v_code text;
  v_id uuid;
  v_next text;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(v_job.kind = 'scan', 'kun et scan-job kan indberette et verdict');
  if p.version is null then
    raise exception 'Ingen aktiv sikkerhedspolitik' using errcode = 'check_violation';
  end if;
  select * into v from knowledge.document_versions where id = v_job.document_version_id for update;
  if v.security_state <> 'scanning' then
    raise exception 'Versionen scannes ikke (tilstand: %)', v.security_state using errcode = 'check_violation';
  end if;

  -- Strengt input: kendte værdier og koder, ingen fri tekst.
  perform knowledge.require_input(jsonb_typeof(p_result) = 'object' and octet_length(p_result::text) <= 8192, 'verdict');
  perform knowledge.require_input(p_result ->> 'policy_version' ~ '^[a-z0-9][a-z0-9.-]{0,40}$', 'politikversion');
  perform knowledge.require_input(p_result ->> 'checksum_sha256' ~ '^[0-9a-f]{64}$', 'checksum');
  perform knowledge.require_input(jsonb_typeof(p_result -> 'byte_size') = 'number' and (p_result ->> 'byte_size')::bigint >= 0, 'filstørrelse');
  perform knowledge.require_input(p_result ->> 'detected_mime' ~ '^[a-z]+/[a-z0-9.+-]{1,60}$', 'filtype');
  perform knowledge.require_input(v_structural in ('pass', 'fail'), 'strukturelt resultat');
  perform knowledge.require_input(v_structural_code is null or v_structural_code in
    ('invalid_file_type', 'extension_mismatch', 'mime_mismatch', 'polyglot', 'invalid_pdf', 'too_large', 'checksum_mismatch'), 'strukturel kode');
  perform knowledge.require_input((v_structural = 'fail') = (v_structural_code is not null), 'strukturel kode');
  perform knowledge.require_input(v_malware in ('clean', 'infected', 'error', 'not_scanned'), 'malware-resultat');
  perform knowledge.require_input(v_malware_code is null or v_malware_code in
    ('scanner_unavailable', 'scanner_timeout', 'scanner_error', 'invalid_response', 'stale_signatures', 'signature_unknown'), 'scannerkode');
  perform knowledge.require_input(v_malware_name is null or v_malware_name ~ '^[A-Za-z0-9._:/-]{1,120}$', 'fundets navn');
  perform knowledge.require_input((v_malware = 'infected') = (v_malware_name is not null), 'fundets navn');
  perform knowledge.require_input(v_engine is null or v_engine ~ '^[A-Za-z0-9 ._-]{1,40}$', 'scanner');
  perform knowledge.require_input(coalesce(p_result #>> '{scanner,engine_version}', 'x') ~ '^[A-Za-z0-9 ._+-]{1,60}$', 'scannerversion');
  perform knowledge.require_input(coalesce(p_result #>> '{scanner,signature_version}', 'x') ~ '^[A-Za-z0-9._-]{1,40}$', 'signaturversion');
  if p_result #>> '{scanner,signature_time}' is not null then
    v_signature_time := (p_result #>> '{scanner,signature_time}')::timestamptz;
  end if;
  perform knowledge.require_input(v_pdf in ('pass', 'fail', 'error', 'not_run'), 'PDF-resultat');
  perform knowledge.require_input(v_pdf_code is null or v_pdf_code in
    ('invalid_pdf', 'encrypted_pdf', 'too_many_pages', 'too_many_objects', 'resource_limit', 'inspection_timeout', 'inspection_failed'), 'PDF-kode');
  perform knowledge.require_input((v_pdf in ('fail', 'error')) = (v_pdf_code is not null), 'PDF-kode');
  perform knowledge.require_input(v_active in ('pass', 'fail', 'not_run'), 'aktivt indhold');
  perform knowledge.require_input(coalesce(jsonb_typeof(p_result #> '{active_content,findings}'), 'array') = 'array', 'fund');
  v_findings := coalesce(array(select jsonb_array_elements_text(p_result #> '{active_content,findings}')), '{}');
  perform knowledge.require_input(v_findings <@ array['javascript', 'launch', 'open_action', 'additional_actions', 'embedded_file',
    'file_attachment', 'rich_media', 'multimedia', 'xfa', 'submit_form', 'import_data', 'remote_goto', 'embedded_goto'], 'fund');
  perform knowledge.require_input((v_active = 'fail') = (cardinality(v_findings) > 0), 'fund');

  -- Afledning (rækkefølgen er politikken). "safe" kun når ALT er bestået.
  if v_malware = 'infected' then
    v_final := 'rejected'; v_code := 'malware_detected';
  elsif v_structural = 'fail' then
    v_final := 'rejected'; v_code := v_structural_code;
  elsif p_result ->> 'checksum_sha256' <> v.checksum_sha256
        or (v.byte_size is not null and (p_result ->> 'byte_size')::bigint <> v.byte_size) then
    v_final := 'rejected'; v_code := 'checksum_mismatch';
  elsif v_malware in ('error', 'not_scanned') then
    v_final := 'scan_failed'; v_code := coalesce(v_malware_code, 'scanner_error');
  elsif v_engine is null or (v_engine <> 'ClamAV' and not exists (select 1 from knowledge.security_development_scanners s where s.engine = v_engine)) then
    v_final := 'scan_failed'; v_code := 'scanner_not_allowed';
  elsif v_signature_time is null or v_signature_time > now() + interval '5 minutes' or now() - v_signature_time > p.max_signature_age then
    v_final := 'scan_failed'; v_code := 'stale_signatures';
  elsif p_result ->> 'policy_version' <> p.version then
    v_final := 'scan_failed'; v_code := 'policy_outdated';
  elsif v_pdf in ('fail', 'error') then
    v_final := 'rejected'; v_code := v_pdf_code;
  elsif v_active = 'fail' then
    v_final := 'rejected';
    v_code := case when v_findings <@ array['embedded_file', 'file_attachment'] then 'embedded_file' else 'active_content' end;
  elsif v_pdf <> 'pass' or v_active <> 'pass' or v_malware <> 'clean' then
    v_final := 'scan_failed'; v_code := 'inspection_incomplete';
  else
    v_final := 'safe'; v_code := null;
  end if;

  perform knowledge.as_worker();
  update knowledge.security_verdicts set superseded_at = now(), superseded_reason = 'rescanned'
  where document_version_id = v.id and superseded_at is null;
  insert into knowledge.security_verdicts (
    document_version_id, job_id, policy_version, checksum_sha256, byte_size, detected_mime, object_bucket, object_path,
    structural_result, structural_code, malware_result, malware_name, malware_code,
    scanner_engine, scanner_version, signature_version, signature_time,
    pdf_security_result, pdf_security_code, active_content_result, findings, final_verdict, failure_code
  ) values (
    v.id, v_job.id, p.version, p_result ->> 'checksum_sha256', (p_result ->> 'byte_size')::bigint,
    p_result ->> 'detected_mime', v.storage_bucket, v.storage_path,
    v_structural, v_structural_code, v_malware, v_malware_name, v_malware_code,
    v_engine, p_result #>> '{scanner,engine_version}', p_result #>> '{scanner,signature_version}', v_signature_time,
    v_pdf, v_pdf_code, v_active, v_findings, v_final, v_code
  ) returning id into v_id;

  if v_final = 'safe' then
    update knowledge.document_versions set security_verdict_id = v_id where id = v.id;
    v_next := 'release';
  elsif v_final = 'rejected' then
    update knowledge.document_versions
    set security_verdict_id = v_id, security_state = 'rejected',
        status = case when status = 'processing' then 'processing_failed' else status end
    where id = v.id;
    v_next := 'quarantine';
  else
    update knowledge.document_versions set security_verdict_id = v_id, security_state = 'scan_failed' where id = v.id;
    v_next := 'retry';
  end if;

  perform knowledge.write_audit('knowledge.version.security_verdict', 'document_versions', v.id::text, jsonb_build_object(
    'verdict_id', v_id, 'final', v_final, 'failure_code', v_code, 'policy_version', p.version, 'checksum', p_result ->> 'checksum_sha256',
    'scanner', v_engine, 'scanner_version', p_result #>> '{scanner,engine_version}',
    'signature_version', p_result #>> '{scanner,signature_version}', 'malware_name', v_malware_name, 'findings', to_jsonb(v_findings)));
  return jsonb_build_object('verdict_id', v_id, 'final', v_final, 'failure_code', v_code, 'next', v_next);
end;
$$;

-- Release-gaten for et behandlings- eller re-embedding-job. p_sha256 = checksum af de
-- hentede bytes (null før download). Afviser aldrig med en fejl — svaret er cleared/grund.
-- Afviger de hentede bytes fra de scannede (bytes_changed), er verdict ugyldigt: det afløses,
-- versionen går tilbage i karantæne, og en ny scanning sættes i kø.
create function knowledge.worker_security_clearance(p_job_id uuid, p_lease_token text, p_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v_reason text;
  v_verdict uuid;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(v_job.kind in ('process', 'reembed'), 'kun behandlings- og re-embedding-jobs har en release-gate');
  perform knowledge.require_input(p_sha256 is null or p_sha256 ~ '^[0-9a-f]{64}$', 'checksum');
  perform 1 from knowledge.document_versions where id = v_job.document_version_id for update;
  v_reason := knowledge.security_block_reason(v_job.document_version_id, p_sha256);
  select security_verdict_id into v_verdict from knowledge.document_versions where id = v_job.document_version_id;
  if v_reason = 'bytes_changed' then
    perform knowledge.as_worker();
    update knowledge.security_verdicts set superseded_at = now(), superseded_reason = 'checksum_changed'
    where id = v_verdict and superseded_at is null;
    update knowledge.document_versions set security_state = 'quarantined' where id = v_job.document_version_id;
    insert into knowledge.ingestion_jobs (document_version_id, kind)
    select v_job.document_version_id, 'scan'
    where not exists (select 1 from knowledge.ingestion_jobs j
                      where j.document_version_id = v_job.document_version_id and j.kind = 'scan' and j.status in ('queued', 'running'));
    perform knowledge.write_audit('knowledge.version.security_release_invalidated', 'document_versions', v_job.document_version_id::text,
      jsonb_build_object('verdict_id', v_verdict, 'actual', p_sha256, 'job_id', v_job.id));
  end if;
  return jsonb_build_object('cleared', v_reason is null, 'reason', v_reason, 'verdict_id', v_verdict,
                            'policy_version', (knowledge.active_security_policy()).version);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Claim, complete og fail kender scan-jobbet. Samme signaturer som I3.
-- ----------------------------------------------------------------------------

create or replace function knowledge.worker_claim_job(p_worker text, p_lease_seconds int default 300)
returns table (
  job_id uuid, version_id uuid, kind text, attempts int, max_attempts int, step_state jsonb,
  storage_path text, checksum_sha256 text, document_id uuid, document_type text, product_id uuid,
  title text, version_label text, language text, valid_from date, valid_to date,
  lease_token text, lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job knowledge.ingestion_jobs;
  v knowledge.document_versions;
  v_token text;
  v_cancel text;
begin
  perform knowledge.assert_worker_caller();
  perform knowledge.require_input(p_worker ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$', 'worker-etiket');
  perform knowledge.require_input(p_lease_seconds between 30 and 900, 'lease-varighed (30–900 sekunder)');
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

    select * into v from knowledge.document_versions where id = v_job.document_version_id for update;

    -- Hvad jobbet må: scan kun ufrigivne filer; behandling og re-embedding KUN frigivne.
    v_cancel := case
      when v_job.kind = 'scan' and v.status not in ('uploaded', 'processing', 'processing_failed') then 'version_not_processable'
      when v_job.kind = 'scan' and v.security_state = 'rejected' and v.storage_bucket <> 'knowledge-quarantine' then null
      when v_job.kind = 'scan' and v.security_state not in ('quarantined', 'scan_failed', 'scanning') then 'security_scan_not_needed'
      when v_job.kind = 'process' and v.status not in ('uploaded', 'processing') then 'version_not_processable'
      when v_job.kind in ('process', 'reembed') and v.security_state <> 'released' then 'security_not_released'
      when v_job.kind = 'reembed' and not knowledge.worker_reembed_allowed(v.status) then 'version_not_processable'
      else null
    end;
    if v_cancel is not null then
      update knowledge.ingestion_jobs set status = 'cancelled', finished_at = now(), locked_by = null, locked_until = null,
        error_code = v_cancel, error_message = 'Jobbet kan ikke køres (status: ' || v.status || ', sikkerhed: ' || v.security_state || ').'
      where id = v_job.id;
      continue;
    end if;

    if v_job.status = 'running' and v_job.attempts >= v_job.max_attempts then
      update knowledge.ingestion_jobs set status = 'failed', finished_at = now(), locked_by = null, locked_until = null,
        error_code = 'worker_lost', error_message = 'Behandlingen blev afbrudt for mange gange.'
      where id = v_job.id;
      if v.security_state = 'scanning' then
        update knowledge.document_versions set security_state = 'scan_failed' where id = v.id;
      end if;
      if v.status = 'processing' then
        update knowledge.document_versions set status = 'processing_failed' where id = v.id;
      end if;
      continue;
    end if;

    v_token := knowledge.random_token();
    update knowledge.ingestion_jobs
    set status = 'running', locked_by = p_worker, locked_until = now() + make_interval(secs => p_lease_seconds),
        lease_token_hash = knowledge.lease_hash(v_job.id, v_token),
        attempts = attempts + 1, started_at = coalesce(started_at, now()), error_code = null, error_message = null
    where id = v_job.id;

    if v_job.kind = 'scan' and v.security_state in ('quarantined', 'scan_failed') then
      update knowledge.document_versions set security_state = 'scanning' where id = v.id;
    end if;
    if v_job.kind in ('scan', 'process') and v.status = 'uploaded' then
      update knowledge.document_versions set status = 'processing' where id = v.id;
    end if;

    return query
    select j.id, ver.id, j.kind, j.attempts, j.max_attempts, j.step_state,
           ver.storage_path, ver.checksum_sha256, d.id, d.document_type, d.product_id,
           d.title, ver.version_label, ver.language, ver.valid_from, ver.valid_to,
           v_token, j.locked_until
    from knowledge.ingestion_jobs j
    join knowledge.document_versions ver on ver.id = j.document_version_id
    join knowledge.documents d on d.id = ver.document_id
    where j.id = v_job.id;
    return;
  end loop;
end;
$$;

create or replace function knowledge.worker_complete_job(p_job_id uuid, p_lease_token text, p_quality_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
  v knowledge.document_versions;
  v_report jsonb;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(
    p_quality_report is null or (jsonb_typeof(p_quality_report) = 'object' and octet_length(p_quality_report::text) <= 262144),
    'kvalitetsrapport');
  perform knowledge.as_worker();

  if v_job.kind = 'scan' then
    -- Et scan-job er færdigt, når filen er frigivet eller afvist og flyttet i karantæne.
    select * into v from knowledge.document_versions where id = v_job.document_version_id;
    if not ((v.security_state = 'released' and v.storage_bucket = 'knowledge-originals')
            or (v.security_state = 'rejected' and v.storage_bucket = 'knowledge-quarantine')) then
      raise exception 'Sikkerhedskontrollen er ikke afsluttet (tilstand: %)', v.security_state using errcode = 'check_violation';
    end if;
    update knowledge.ingestion_jobs set status = 'succeeded', finished_at = now(), locked_by = null, locked_until = null
    where id = v_job.id;
    return jsonb_build_object('security_state', v.security_state);
  end if;

  v_report := coalesce(p_quality_report, '{}'::jsonb) || knowledge.compute_quality_facts(v_job.document_version_id)
              || jsonb_build_object('generated_at', now());
  update knowledge.ingestion_jobs
  set status = 'succeeded', finished_at = now(), locked_by = null, locked_until = null,
      quality_report = case when v_job.kind = 'process' then v_report else quality_report end
  where id = v_job.id;
  if v_job.kind = 'process' then
    update knowledge.document_versions set status = 'processed' where id = v_job.document_version_id;
  end if;
  return v_report;
end;
$$;

create or replace function knowledge.worker_fail_job(
  p_job_id uuid, p_lease_token text, p_error_code text, p_error_message text, p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job knowledge.ingestion_jobs;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(p_error_code ~ '^[a-z][a-z0-9_]{0,62}$', 'fejlkode');
  perform knowledge.require_input(p_error_message is not null and char_length(p_error_message) between 1 and 4000, 'fejlbesked');
  perform knowledge.require_input(p_retryable is not null, 'genforsøg');
  perform knowledge.as_worker();
  if v_job.kind = 'scan' then
    -- En afbrudt scanning er aldrig "bestået": tilbage til teknisk scanfejl.
    update knowledge.document_versions set security_state = 'scan_failed'
    where id = v_job.document_version_id and security_state = 'scanning';
  end if;
  if p_retryable and v_job.attempts < v_job.max_attempts then
    update knowledge.ingestion_jobs
    set status = 'queued', locked_by = null, locked_until = null,
        next_attempt_at = now() + make_interval(secs => 30 * power(2, v_job.attempts - 1)::int),
        error_code = p_error_code, error_message = left(p_error_message, 1000)
    where id = v_job.id;
    return 'retry';
  end if;
  update knowledge.ingestion_jobs
  set status = 'failed', finished_at = now(), locked_by = null, locked_until = null,
      error_code = p_error_code, error_message = left(p_error_message, 1000)
  where id = v_job.id;
  -- Mislykket — medmindre et andet job for versionen allerede er i kø (fx en ny scanning).
  if v_job.kind in ('process', 'scan') then
    update knowledge.document_versions set status = 'processing_failed'
    where id = v_job.document_version_id and status = 'processing'
      and not exists (select 1 from knowledge.ingestion_jobs j
                      where j.document_version_id = v_job.document_version_id and j.id <> v_job.id and j.status in ('queued', 'running'));
  end if;
  return 'failed';
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Billetter: scanning, frigivelse og karantæne (Edge Function worker-storage)
-- ----------------------------------------------------------------------------

alter table knowledge.worker_storage_tickets drop constraint worker_storage_tickets_bucket_check;
alter table knowledge.worker_storage_tickets
  add constraint worker_storage_tickets_bucket_check check (bucket in ('knowledge-intake', 'knowledge-originals', 'knowledge-quarantine'));
alter table knowledge.worker_storage_tickets drop constraint worker_storage_tickets_purpose_check;
alter table knowledge.worker_storage_tickets
  add constraint worker_storage_tickets_purpose_check
    check (purpose in ('download_original', 'scan_original', 'release_original', 'quarantine_original'));
alter table knowledge.worker_storage_tickets
  add column destination_bucket text check (destination_bucket is null or destination_bucket in ('knowledge-originals', 'knowledge-quarantine')),
  add column expected_sha256 text check (expected_sha256 is null or expected_sha256 ~ '^[0-9a-f]{64}$'),
  add column verdict_id uuid references knowledge.security_verdicts (id),
  add column confirmed_at timestamptz,
  add column confirmed_outcome text check (confirmed_outcome is null or confirmed_outcome in ('released', 'already_released', 'invalidated', 'quarantined'));
alter table knowledge.worker_storage_tickets
  add constraint worker_storage_tickets_operation_check check (
    (purpose in ('download_original', 'scan_original') and destination_bucket is null)
    or (purpose = 'release_original' and destination_bucket = 'knowledge-originals' and expected_sha256 is not null and verdict_id is not null)
    or (purpose = 'quarantine_original' and destination_bucket = 'knowledge-quarantine'));

create or replace function knowledge.worker_issue_storage_ticket(p_job_id uuid, p_lease_token text, p_purpose text)
returns table (ticket text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job knowledge.ingestion_jobs;
  v knowledge.document_versions;
  d knowledge.security_verdicts;
  v_ticket text;
  v_expires timestamptz := now() + interval '60 seconds';
  v_destination text;
  v_expected text;
begin
  perform knowledge.assert_worker_caller();
  v_job := knowledge.lease_job(p_job_id, p_lease_token);
  perform knowledge.require_input(p_purpose in ('download_original', 'scan_original', 'release_original', 'quarantine_original'), 'formål');
  select * into v from knowledge.document_versions where id = v_job.document_version_id;
  select * into d from knowledge.security_verdicts where id = v.security_verdict_id;

  if p_purpose = 'download_original' then
    -- Kun en frigivet fil med gyldigt verdict kan hentes til behandling.
    if v_job.kind <> 'process' or v.status <> 'processing' or knowledge.security_block_reason(v.id, null) is not null then
      raise exception 'Formålet passer ikke til jobbet eller versionens tilstand' using errcode = 'check_violation';
    end if;
  elsif p_purpose = 'scan_original' then
    if v_job.kind <> 'scan' or v.status <> 'processing' or v.security_state <> 'scanning' then
      raise exception 'Formålet passer ikke til jobbet eller versionens tilstand' using errcode = 'check_violation';
    end if;
  elsif p_purpose = 'release_original' then
    if v_job.kind <> 'scan' or v.security_state <> 'scanning' or d.id is null or d.final_verdict <> 'safe'
       or d.superseded_at is not null or d.released_at is not null then
      raise exception 'Kun et aktuelt, sikkert verdict kan frigives' using errcode = 'check_violation';
    end if;
    if exists (select 1 from knowledge.worker_storage_tickets t
               where t.job_id = v_job.id and t.purpose in ('release_original', 'quarantine_original') and t.confirmed_at is null
                 and ((t.used_at is not null and t.used_at > now() - interval '5 minutes') or (t.used_at is null and t.expires_at > now()))) then
      raise exception 'En flytning af filen er allerede i gang' using errcode = 'object_in_use';
    end if;
    v_destination := 'knowledge-originals';
    v_expected := d.checksum_sha256;
  else
    if v_job.kind <> 'scan' or v.security_state <> 'rejected' or v.storage_bucket = 'knowledge-quarantine' then
      raise exception 'Kun en afvist fil kan sættes i karantæne' using errcode = 'check_violation';
    end if;
    if exists (select 1 from knowledge.worker_storage_tickets t
               where t.job_id = v_job.id and t.purpose in ('release_original', 'quarantine_original') and t.confirmed_at is null
                 and ((t.used_at is not null and t.used_at > now() - interval '5 minutes') or (t.used_at is null and t.expires_at > now()))) then
      raise exception 'En flytning af filen er allerede i gang' using errcode = 'object_in_use';
    end if;
    v_destination := 'knowledge-quarantine';
  end if;

  if (select count(*) from knowledge.worker_storage_tickets t
      where t.job_id = v_job.id and t.used_at is null and t.expires_at > now()) >= 3 then
    raise exception 'For mange ubrugte billetter for jobbet' using errcode = 'program_limit_exceeded';
  end if;
  v_ticket := knowledge.random_token();
  insert into knowledge.worker_storage_tickets
    (token_hash, job_id, document_version_id, bucket, object_path, purpose, lease_token_hash, issued_at, expires_at,
     destination_bucket, expected_sha256, verdict_id)
  values
    (pg_catalog.sha256(pg_catalog.convert_to(v_ticket, 'UTF8')), v_job.id, v.id, v.storage_bucket,
     v.storage_path, p_purpose, v_job.lease_token_hash, now(), v_expires,
     v_destination, v_expected, case when p_purpose = 'release_original' then d.id end);
  return query select v_ticket, v_expires;
end;
$$;

drop function knowledge.redeem_worker_storage_ticket(text);
create function knowledge.redeem_worker_storage_ticket(p_ticket text)
returns table (
  bucket text, object_path text, purpose text, checksum_sha256 text,
  operation text, destination_bucket text, ticket_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ticket knowledge.worker_storage_tickets;
  v_checksum text;
begin
  if knowledge.effective_db_role() <> 'service_role' then
    raise exception 'Kun lagerfunktionen må indløse billetter' using errcode = 'insufficient_privilege';
  end if;
  if p_ticket is not null and p_ticket ~ '^[0-9a-f]{64}$' then
    select t.* into v_ticket
    from knowledge.worker_storage_tickets t
    join knowledge.ingestion_jobs j on j.id = t.job_id
    join knowledge.document_versions v on v.id = t.document_version_id
    where t.token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_ticket, 'UTF8'))
      and t.used_at is null
      and t.expires_at > now()
      and j.status = 'running' and j.lease_token_hash = t.lease_token_hash and j.locked_until > now()
      and v.storage_path = t.object_path and v.storage_bucket = t.bucket
      and case t.purpose
            when 'download_original' then v.status = 'processing' and knowledge.security_block_reason(v.id, null) is null
            when 'scan_original' then v.status = 'processing' and v.security_state = 'scanning'
            when 'release_original' then v.security_state = 'scanning' and v.security_verdict_id = t.verdict_id
            when 'quarantine_original' then v.security_state = 'rejected'
          end
    for update of t;
  end if;
  if v_ticket.id is null then
    raise exception 'Billetten er ugyldig, brugt eller udløbet' using errcode = 'invalid_authorization_specification';
  end if;
  update knowledge.worker_storage_tickets set used_at = now() where id = v_ticket.id;
  select v.checksum_sha256 into v_checksum from knowledge.document_versions v where v.id = v_ticket.document_version_id;
  return query select v_ticket.bucket, v_ticket.object_path, v_ticket.purpose,
                      coalesce(v_ticket.expected_sha256, v_checksum),
                      case v_ticket.purpose when 'release_original' then 'release' when 'quarantine_original' then 'quarantine' else 'stream' end,
                      v_ticket.destination_bucket, v_ticket.id;
end;
$$;

-- Edge Function bekræfter en flytning med checksum af de bytes, den faktisk flyttede.
-- Afviger checksummen fra verdict, er verdict ugyldigt: tilbage i karantæne og ny scanning.
create function knowledge.confirm_worker_storage_operation(p_ticket_id uuid, p_sha256 text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t knowledge.worker_storage_tickets;
  v knowledge.document_versions;
  d knowledge.security_verdicts;
  v_outcome text;
begin
  if knowledge.effective_db_role() <> 'service_role' then
    raise exception 'Kun lagerfunktionen må bekræfte en flytning' using errcode = 'insufficient_privilege';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Ugyldig checksum' using errcode = 'invalid_parameter_value';
  end if;
  select * into t from knowledge.worker_storage_tickets
  where id = p_ticket_id and used_at is not null and confirmed_at is null
    and purpose in ('release_original', 'quarantine_original') and used_at > now() - interval '5 minutes'
  for update;
  if t.id is null then
    raise exception 'Flytningen kan ikke bekræftes' using errcode = 'invalid_authorization_specification';
  end if;
  select * into v from knowledge.document_versions where id = t.document_version_id for update;
  perform set_config('ipa.actor', 'worker_storage', true);

  if t.purpose = 'release_original' then
    select * into d from knowledge.security_verdicts where id = t.verdict_id for update;
    if p_sha256 <> t.expected_sha256 or d.superseded_at is not null or d.final_verdict <> 'safe'
       or v.security_verdict_id is distinct from d.id or v.security_state not in ('scanning', 'released') then
      -- Bytes eller verdict er ændret efter scanningen: verdict ugyldigt, tilbage i karantæne —
      -- også hvis versionen allerede var frigivet (en parallel flytning med andre bytes).
      update knowledge.security_verdicts set superseded_at = now(), superseded_reason = 'checksum_changed'
      where id = d.id and superseded_at is null;
      if v.security_state in ('scanning', 'released') and v.security_verdict_id is not distinct from d.id then
        update knowledge.document_versions set security_state = 'quarantined' where id = v.id;
      end if;
      perform knowledge.write_audit('knowledge.version.security_release_refused', 'document_versions', v.id::text,
        jsonb_build_object('verdict_id', d.id, 'expected', t.expected_sha256, 'actual', p_sha256));
      v_outcome := 'invalidated';
    elsif v.security_state = 'released' then
      v_outcome := 'already_released';
    else
      update knowledge.security_verdicts set released_at = now() where id = d.id;
      update knowledge.document_versions
      set storage_bucket = 'knowledge-originals', security_state = 'released', security_released_at = now()
      where id = v.id;
      if v.status = 'processing' then
        insert into knowledge.ingestion_jobs (document_version_id, kind)
        select v.id, 'process'
        where not exists (select 1 from knowledge.ingestion_jobs j
                          where j.document_version_id = v.id and j.kind = 'process' and j.status in ('queued', 'running'));
      end if;
      perform knowledge.write_audit('knowledge.version.security_released', 'document_versions', v.id::text,
        jsonb_build_object('verdict_id', d.id, 'checksum', p_sha256, 'policy_version', d.policy_version));
      v_outcome := 'released';
    end if;
  else
    update knowledge.document_versions set storage_bucket = 'knowledge-quarantine', quarantined_at = now() where id = v.id;
    select * into d from knowledge.security_verdicts where id = v.security_verdict_id;
    perform knowledge.write_audit('knowledge.version.quarantined', 'document_versions', v.id::text,
      jsonb_build_object('verdict_id', d.id, 'checksum', p_sha256, 'failure_code', d.failure_code,
                         'scanner', d.scanner_engine, 'signature_version', d.signature_version, 'malware_name', d.malware_name));
    v_outcome := 'quarantined';
  end if;
  update knowledge.worker_storage_tickets set confirmed_at = now(), confirmed_outcome = v_outcome where id = t.id;
  return v_outcome;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Registrering, genbehandling, genscanning og download
-- ----------------------------------------------------------------------------

create or replace function knowledge.register_upload(
  p_version_id uuid,
  p_document_id uuid,
  p_new_document jsonb,
  p_version_label text,
  p_language text,
  p_valid_from date,
  p_valid_to date,
  p_checksum_sha256 text,
  p_original_filename text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := identity.current_user_id();
  v_path text := p_document_id::text || '/' || p_version_id::text || '/original.pdf';
  v_object record;
  v_source uuid;
begin
  if v_me is null or not identity.has_permission('knowledge.document.write') then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;

  -- 8B-I5: uploads ligger i karantæne (knowledge-intake), indtil sikkerhedskontrollen frigiver dem.
  select o.name, o.metadata into v_object
  from storage.objects o
  where o.bucket_id = 'knowledge-intake' and o.name = v_path;
  if not found then
    raise exception 'Filen findes ikke i Storage' using errcode = 'no_data_found';
  end if;

  if p_new_document is not null then
    if exists (select 1 from knowledge.documents d where d.id = p_document_id) then
      raise exception 'Dokumentet findes allerede' using errcode = 'unique_violation';
    end if;
    select s.id into v_source from knowledge.sources s where s.type = 'manual_upload' order by s.created_at limit 1;
    insert into knowledge.documents (id, product_id, document_type, source_id, title, created_by)
    values (
      p_document_id,
      (p_new_document ->> 'product_id')::uuid,
      p_new_document ->> 'document_type',
      v_source,
      btrim(p_new_document ->> 'title'),
      v_me
    );
  elsif not exists (select 1 from knowledge.documents d where d.id = p_document_id) then
    raise exception 'Dokumentet findes ikke' using errcode = 'no_data_found';
  end if;

  insert into knowledge.document_versions (
    id, document_id, version_label, language, valid_from, valid_to, storage_path,
    checksum_sha256, byte_size, mime_type, original_filename, uploaded_by
  ) values (
    p_version_id,
    p_document_id,
    nullif(btrim(coalesce(p_version_label, '')), ''),
    coalesce(nullif(p_language, ''), 'da'),
    p_valid_from,
    p_valid_to,
    v_path,
    lower(p_checksum_sha256),
    nullif(v_object.metadata ->> 'size', '')::bigint,
    v_object.metadata ->> 'mimetype',
    nullif(btrim(coalesce(p_original_filename, '')), ''),
    v_me
  );

  -- Først sikkerhedskontrollen. Behandlingsjobbet oprettes først ved frigivelse.
  insert into knowledge.ingestion_jobs (document_version_id, kind) values (p_version_id, 'scan');
  return p_version_id;
end;
$$;

create or replace function knowledge.request_reprocess(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v knowledge.document_versions;
begin
  perform knowledge.require_permission('knowledge.document.write');
  v := knowledge.lock_version(p_version_id, array['processing_failed', 'rejected']);
  if v.security_state = 'rejected' then
    raise exception 'Filen er afvist af sikkerhedskontrollen og kan ikke behandles igen. Upload en ny version.'
      using errcode = 'check_violation';
  end if;
  update knowledge.document_versions set status = 'processing' where id = p_version_id;
  if v.security_state = 'released' then
    insert into knowledge.ingestion_jobs (document_version_id, kind) values (p_version_id, 'process');
  else
    -- Ikke frigivet (teknisk scanfejl, karantæne eller før I5): først sikkerhedskontrollen.
    if v.security_state in ('scan_failed', 'legacy_unscanned') then
      update knowledge.document_versions set security_state = 'quarantined' where id = p_version_id;
    end if;
    insert into knowledge.ingestion_jobs (document_version_id, kind) values (p_version_id, 'scan');
  end if;
end;
$$;

-- Kontrolleret genscanning (server-side, auditeret). Minimum i I5: versioner, der ikke er
-- behandlet færdig eller publiceret. Frigivelsen ophæves, mens der scannes igen.
create function knowledge.request_security_rescan(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v knowledge.document_versions;
begin
  if not identity.has_permission('system.settings.manage') then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  v := knowledge.lock_version(p_version_id, array['uploaded', 'processing_failed']);
  if v.security_state not in ('released', 'scan_failed', 'legacy_unscanned', 'quarantined') then
    raise exception 'Versionen kan ikke genscannes (tilstand: %)', v.security_state using errcode = 'check_violation';
  end if;
  if exists (select 1 from knowledge.ingestion_jobs j where j.document_version_id = p_version_id and j.status in ('queued', 'running')) then
    raise exception 'Versionen har allerede et job i gang' using errcode = 'lock_not_available';
  end if;
  update knowledge.security_verdicts set superseded_at = now(), superseded_reason = 'rescan_requested'
  where document_version_id = p_version_id and superseded_at is null;
  update knowledge.document_versions
  set security_state = 'quarantined',
      status = case when status = 'processing_failed' then 'processing' else status end
  where id = p_version_id;
  insert into knowledge.ingestion_jobs (document_version_id, kind) values (p_version_id, 'scan');
  perform knowledge.write_audit('knowledge.version.security_rescan_requested', 'document_versions', p_version_id::text,
    jsonb_build_object('previous_state', v.security_state, 'previous_verdict', v.security_verdict_id));
end;
$$;

-- Download af en original: kun frigivne filer (eller filer fra før I5) i knowledge-originals.
create or replace function knowledge.log_original_download(p_version_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v knowledge.document_versions;
begin
  if not knowledge.is_knowledge_manager() then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  select * into v from knowledge.document_versions where id = p_version_id;
  if v.id is null or v.storage_bucket <> 'knowledge-originals' or v.security_state not in ('released', 'legacy_unscanned') then
    raise exception 'Versionen findes ikke' using errcode = 'no_data_found';
  end if;
  perform knowledge.write_audit('knowledge.original.download_url_issued', 'document_versions', p_version_id::text, '{}'::jsonb);
  return v.storage_path;
end;
$$;

-- Læsning af knowledge-originals: også kun frigivne filer.
create or replace function knowledge.original_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from knowledge.document_versions v
    where v.storage_path = p_name and v.storage_bucket = 'knowledge-originals'
      and v.security_state in ('released', 'legacy_unscanned')
  )
$$;

drop policy if exists knowledge_originals_select on storage.objects;
create policy knowledge_originals_select on storage.objects
  for select to authenticated
  using (bucket_id = 'knowledge-originals' and knowledge.is_knowledge_manager() and knowledge.original_readable(name));

-- ----------------------------------------------------------------------------
-- 10. Admin-visning: sikkerhedsstatus pr. version (kun koder, ingen fund-detaljer)
-- ----------------------------------------------------------------------------

create or replace function knowledge.version_security_status(p_version_ids uuid[])
returns table (version_id uuid, security_state text, failure_code text, scanned_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.security_state, d.failure_code, d.created_at
  from knowledge.document_versions v
  left join knowledge.security_verdicts d on d.id = v.security_verdict_id
  where knowledge.is_knowledge_manager() and v.id = any (p_version_ids)
$$;

-- ----------------------------------------------------------------------------
-- 11. Drift: workerens API udvides; status melder udviklingsscannere
-- ----------------------------------------------------------------------------

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
    'knowledge.worker_security_clearance(uuid, text, text)'
  ]::regprocedure[]
$$;

create or replace function ops.ingestion_worker_status()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with roles as (
    select r.rolname, r.rolcanlogin, r.rolconnlimit,
           pg_catalog.pg_has_role(r.rolname, 'ingestion_worker', 'MEMBER') as is_member,
           (select count(*) from pg_catalog.pg_stat_activity a where a.usename = r.rolname)::int as sessions
    from pg_catalog.pg_roles r
    where r.rolname in ('ingestion_worker_login_blue', 'ingestion_worker_login_green')
  ),
  api as (
    select count(*) filter (where pg_catalog.has_function_privilege('ingestion_worker', f, 'EXECUTE'))::int as granted,
           count(*)::int as expected
    from unnest(ops.ingestion_worker_api()) f
  ),
  extra as (
    select count(*)::int as n
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
      and pg_catalog.has_schema_privilege('ingestion_worker', n.oid, 'USAGE')
      and pg_catalog.has_function_privilege('ingestion_worker', p.oid, 'EXECUTE')
      and not (p.oid::regprocedure = any (ops.ingestion_worker_api()))
  )
  select jsonb_build_object(
    'roles', (select jsonb_agg(jsonb_build_object('role', rolname, 'login', rolcanlogin, 'member', is_member,
                                                  'connection_limit', rolconnlimit, 'sessions', sessions) order by rolname) from roles),
    'api', (select jsonb_build_object('granted', granted, 'expected', expected) from api),
    'service_role_is_worker', pg_catalog.pg_has_role('service_role', 'ingestion_worker', 'MEMBER'),
    'security_policy', (select version from knowledge.security_policies where active),
    'violations', to_jsonb(array_remove(array[
      case when pg_catalog.pg_has_role('service_role', 'ingestion_worker', 'MEMBER') then 'service_role_is_worker' end,
      case when (select n from extra) > 0 then 'extra_executable_functions' end,
      case when exists (select 1 from roles where is_member and not rolcanlogin) then 'member_without_login' end,
      case when exists (select 1 from roles where rolcanlogin and not is_member) then 'login_without_membership' end,
      case when exists (select 1 from knowledge.security_development_scanners) then 'development_scanner_allowed' end,
      case when not exists (select 1 from knowledge.security_policies where active) then 'no_active_security_policy' end
    ], null))
  )
$$;

-- ----------------------------------------------------------------------------
-- 12. Rettigheder
-- ----------------------------------------------------------------------------

alter table knowledge.security_policies enable row level security;
alter table knowledge.security_verdicts enable row level security;
alter table knowledge.security_development_scanners enable row level security;
revoke all on knowledge.security_policies, knowledge.security_verdicts, knowledge.security_development_scanners
  from public, anon, authenticated, service_role;

revoke all on function
  knowledge.active_security_policy(),
  knowledge.check_security_verdict_update(),
  knowledge.check_version_security(),
  knowledge.security_block_reason(uuid, text),
  knowledge.worker_security_scan_context(uuid, text),
  knowledge.worker_record_security_verdict(uuid, text, jsonb),
  knowledge.worker_security_clearance(uuid, text, text),
  knowledge.worker_claim_job(text, int),
  knowledge.worker_complete_job(uuid, text, jsonb),
  knowledge.worker_fail_job(uuid, text, text, text, boolean),
  knowledge.worker_issue_storage_ticket(uuid, text, text),
  knowledge.redeem_worker_storage_ticket(text),
  knowledge.confirm_worker_storage_operation(uuid, text),
  knowledge.register_upload(uuid, uuid, jsonb, text, text, date, date, text, text),
  knowledge.request_reprocess(uuid),
  knowledge.request_security_rescan(uuid),
  knowledge.log_original_download(uuid),
  knowledge.original_readable(text),
  knowledge.version_security_status(uuid[])
from public, anon, authenticated, service_role;

select ops.ingestion_worker_set_api(true);
grant execute on function knowledge.redeem_worker_storage_ticket(text), knowledge.confirm_worker_storage_operation(uuid, text) to service_role;
grant execute on function
  knowledge.register_upload(uuid, uuid, jsonb, text, text, date, date, text, text),
  knowledge.request_reprocess(uuid),
  knowledge.request_security_rescan(uuid),
  knowledge.log_original_download(uuid),
  knowledge.original_readable(text),
  knowledge.version_security_status(uuid[])
to authenticated;
