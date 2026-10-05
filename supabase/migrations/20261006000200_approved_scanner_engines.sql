-- ============================================================================
-- Fase 8B, deltrin I5.6 — ClamAV-patchversion og godkendte engine-versioner (docs/08b §21.8, B-028)
--
-- Production bruger den godkendte ClamAV 1.4 LTS-linje i den patchversion, der er godkendt her.
-- En ny 1.4.x-patch kommer ikke automatisk i production: den bygges som kandidat, testes
-- (scanner, EICAR, ren fil, PDF-/sikkerhedsfixtures), får et godkendt digest og tilføjes som en
-- RÆKKE her (sammen med deploy/clamav/engine.json). Domænemodellen ændres ikke.
--
-- Et verdict fra en ClamAV-engine, der ikke er godkendt (eller er trukket tilbage), bliver
-- teknisk scanfejl ('engine_not_approved') — aldrig safe.
-- ============================================================================

create table knowledge.security_approved_scanner_engines (
  engine text not null check (engine = 'ClamAV'),
  engine_version text not null check (engine_version ~ '^1\.4\.[0-9]{1,3}$'),
  approved_at date not null,
  decision text not null check (decision ~ '^B-[0-9]{3}$'),
  revoked_at date,
  primary key (engine, engine_version)
);

alter table knowledge.security_approved_scanner_engines enable row level security;
revoke all on knowledge.security_approved_scanner_engines from public, anon, authenticated, service_role;

-- Den godkendte production-version (LTS 1.4). 1.4.3 godkendes ikke.
insert into knowledge.security_approved_scanner_engines (engine, engine_version, approved_at, decision)
values ('ClamAV', '1.4.6', date '2026-10-06', 'B-028');

create or replace function knowledge.worker_record_security_verdict(p_job_id uuid, p_lease_token text, p_result jsonb)
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
  elsif v_engine = 'ClamAV' and not exists (
          select 1 from knowledge.security_approved_scanner_engines e
          where e.engine = 'ClamAV' and e.engine_version = p_result #>> '{scanner,engine_version}' and e.revoked_at is null) then
    -- 8B-I5.6: kun en godkendt engine-version kan give safe.
    v_final := 'scan_failed'; v_code := 'engine_not_approved';
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

revoke all on function knowledge.worker_record_security_verdict(uuid, text, jsonb) from public, anon, authenticated, service_role;
select ops.ingestion_worker_set_api(true);
