-- ============================================================================
-- Fase 7, trin 5 — Review, godkendelse og publicering, afvisning og deaktivering
--
-- Specifikation: docs/07 §2.2 (overgange), §2.3 (særtilfælde), §3 (autoritativ viden).
--
--   * Kun en menneskelig handling gør en version autoritativ: "Godkend som autoritativ"
--     (knowledge.version.publish). Godkendelse og publicering sker i samme transaktion (K-1).
--   * Godkendelse blokeres af manglende metadata, ulæste sider, manglende embeddings med den
--     aktive model og gyldighed, der ikke kan indpasses (docs/07 §3.2, B-11). Øvrige
--     kvalitetsadvarsler blokerer ikke; de vises igen i bekræftelsesdialogen.
--   * Erstatning er afledt (B-06): forgængerens valid_to afkortes til efterfølgerens
--     valid_from, og superseded_by sættes. Systemet ændrer aldrig gyldighed i andre tilfælde.
--   * Fire øjne håndhæves ikke (B-10), men uploader og godkender registreres begge.
-- ============================================================================

-- Detaljer til audit fra handlingsfunktionerne (begrundelse, viste advarsler). Læses af
-- audit-triggeren og gælder kun resten af transaktionen.
create or replace function knowledge.set_audit_details(p_details jsonb)
returns void
language sql
set search_path = ''
as $$
  select set_config('ipa.audit_details', coalesce(p_details, '{}'::jsonb)::text, true);
$$;

create or replace function knowledge.audit_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := new.id::text;
  v_action text;
  v_fields text[];
  v_extra jsonb := coalesce(nullif(current_setting('ipa.audit_details', true), '')::jsonb, '{}'::jsonb);
begin
  if tg_op = 'INSERT' then
    perform knowledge.write_audit('knowledge.version.uploaded', 'document_versions', v_id,
      jsonb_build_object('document_id', new.document_id, 'checksum_sha256', new.checksum_sha256, 'byte_size', new.byte_size));
    return null;
  end if;

  if new.status <> old.status then
    v_action := case
      when old.status = 'uploaded' and new.status = 'processing' then 'knowledge.version.processing_started'
      when new.status = 'processing' then 'knowledge.version.reprocess_requested'
      when old.status = 'processing' and new.status = 'processed' then 'knowledge.version.processing_succeeded'
      when new.status = 'processing_failed' then 'knowledge.version.processing_failed'
      when new.status = 'under_review' then 'knowledge.version.review_started'
      when old.status = 'under_review' and new.status = 'processed' then 'knowledge.version.review_cancelled'
      when old.status = 'rejected' and new.status = 'processed' then 'knowledge.version.metadata_changed'
      when new.status = 'rejected' then 'knowledge.version.rejected'
      when new.status = 'withdrawn' then 'knowledge.version.withdrawn'
      when new.status = 'discarded' then 'knowledge.version.discarded'
      else null
    end;
    if new.status = 'published' then
      perform knowledge.write_audit('knowledge.version.approved', 'document_versions', v_id,
        jsonb_build_object('approved_by', new.approved_by, 'uploaded_by', new.uploaded_by) || v_extra);
      perform knowledge.write_audit('knowledge.version.published', 'document_versions', v_id,
        jsonb_build_object('valid_from', new.valid_from, 'valid_to', new.valid_to, 'language', new.language));
    elsif v_action is not null then
      perform knowledge.write_audit(v_action, 'document_versions', v_id,
        case when new.status = 'withdrawn' then
          jsonb_build_object('category', new.withdrawal_category, 'reason', new.withdrawal_reason)
        else jsonb_build_object('from', old.status, 'to', new.status) || v_extra end);
    end if;
  end if;

  if new.superseded_by is not null and old.superseded_by is null then
    perform knowledge.write_audit('knowledge.version.superseded', 'document_versions', v_id,
      jsonb_build_object('successor_id', new.superseded_by, 'valid_to', new.valid_to, 'previous_valid_to', old.valid_to));
  elsif new.status = old.status then
    v_fields := array(
      select f from unnest(array['version_label', 'language', 'valid_from', 'valid_to']) f
      where (to_jsonb(old) -> f) is distinct from (to_jsonb(new) -> f)
    );
    if cardinality(v_fields) > 0 then
      perform knowledge.write_audit('knowledge.version.metadata_changed', 'document_versions', v_id,
        jsonb_build_object(
          'fields', v_fields,
          'valid_from', jsonb_build_object('before', old.valid_from, 'after', new.valid_from),
          'valid_to', jsonb_build_object('before', old.valid_to, 'after', new.valid_to)
        ));
    end if;
  end if;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- Gyldighed ved publicering (docs/07 §3.5)
-- ----------------------------------------------------------------------------

-- Hvad sker der med gyldigheden, hvis versionen publiceres nu? Returnerer forgængeren, der
-- afkortes, eller en blokering med forklaring.
create or replace function knowledge.publication_plan(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v knowledge.document_versions;
  p knowledge.document_versions;
  v_conflict knowledge.document_versions;
begin
  select * into v from knowledge.document_versions where id = p_version_id;
  if v.id is null or v.valid_from is null then
    return jsonb_build_object('ok', false);
  end if;

  -- Forgængeren: den publicerede version af samme dokument og sprog, der dækker valid_from.
  select * into p
  from knowledge.document_versions o
  where o.document_id = v.document_id and o.language = v.language and o.status = 'published' and o.id <> v.id
    and daterange(o.valid_from, o.valid_to, '[)') @> v.valid_from;

  if p.id is not null and p.valid_from >= v.valid_from then
    return jsonb_build_object('ok', false, 'code', 'validity_conflict',
      'message', format('Gyldig fra (%s) skal ligge efter den publicerede version %s''s gyldig fra (%s). Justér datoerne, eller deaktivér den fejlagtige version.',
                        v.valid_from, coalesce(p.version_label, ''), p.valid_from));
  end if;

  if p.id is not null and p.superseded_by is not null then
    return jsonb_build_object('ok', false, 'code', 'validity_conflict',
      'message', format('Den publicerede version %s, som dækker gyldig fra (%s), er allerede erstattet af en anden version. Justér datoerne, eller deaktivér den fejlagtige version.',
                        coalesce(p.version_label, ''), v.valid_from));
  end if;

  -- Ingen anden publiceret version må overlappe den nye periode (fx en senere version).
  select * into v_conflict
  from knowledge.document_versions o
  where o.document_id = v.document_id and o.language = v.language and o.status = 'published' and o.id <> v.id
    and o.id is distinct from p.id
    and daterange(o.valid_from, o.valid_to, '[)') && daterange(v.valid_from, v.valid_to, '[)')
  order by o.valid_from
  limit 1;
  if v_conflict.id is not null then
    return jsonb_build_object('ok', false, 'code', 'validity_conflict',
      'message', format('Perioden overlapper den publicerede version %s (gyldig fra %s). Justér datoerne, eller deaktivér den fejlagtige version.',
                        coalesce(v_conflict.version_label, ''), v_conflict.valid_from));
  end if;

  return jsonb_build_object(
    'ok', true,
    'predecessor', case when p.id is null then null else jsonb_build_object(
      'version_id', p.id, 'version_label', p.version_label,
      'valid_to_before', p.valid_to, 'valid_to_after', v.valid_from) end,
    -- Afkortningen fjerner forgængerens dækning efter den nye versions valid_to (hul).
    'gap_after', case when p.id is not null and v.valid_to is not null and (p.valid_to is null or p.valid_to > v.valid_to)
                      then jsonb_build_object('from', v.valid_to, 'to', p.valid_to) else null end,
    'temporal_status', case when v.valid_from > knowledge.today() then 'future'
                            when v.valid_to is not null and v.valid_to <= knowledge.today() then 'historical'
                            else 'current' end
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Review-tilstand: blokeringer og advarsler (docs/07 §3.2, §5.3)
-- ----------------------------------------------------------------------------

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

  if not knowledge.version_has_active_embeddings(p_version_id) then
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
-- Handlinger (docs/07 §2.2). Alle kontrollerer permission og tilstand selv.
-- ----------------------------------------------------------------------------

create or replace function knowledge.require_permission(p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := identity.current_user_id();
begin
  if v_me is null or not identity.has_permission(p_permission) then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  return v_me;
end;
$$;

create or replace function knowledge.lock_version(p_version_id uuid, p_expected text[])
returns knowledge.document_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v knowledge.document_versions;
begin
  select * into v from knowledge.document_versions where id = p_version_id for update;
  if v.id is null then
    raise exception 'Versionen findes ikke' using errcode = 'no_data_found';
  end if;
  if not (v.status = any (p_expected)) then
    raise exception 'Handlingen er ikke mulig for en version med status "%"', v.status using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

-- "Påbegynd review" (processed → under_review). Låser metadata.
create or replace function knowledge.start_review(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := knowledge.require_permission('knowledge.version.publish');
begin
  perform knowledge.lock_version(p_version_id, array['processed']);
  update knowledge.document_versions set status = 'under_review', review_started_by = v_me, review_started_at = now()
  where id = p_version_id;
end;
$$;

-- "Afbryd review" (under_review → processed).
create or replace function knowledge.cancel_review(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform knowledge.require_permission('knowledge.version.publish');
  perform knowledge.lock_version(p_version_id, array['under_review']);
  update knowledge.document_versions set status = 'processed', review_started_by = null, review_started_at = null
  where id = p_version_id;
end;
$$;

-- "Godkend som autoritativ" (under_review → published). Én transaktion: kontrol,
-- afkortning af forgængeren, publicering, afgørelse og audit (docs/07 §3.2, §3.5).
create or replace function knowledge.approve_version(p_version_id uuid, p_acknowledged_warnings jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := knowledge.require_permission('knowledge.version.publish');
  v knowledge.document_versions;
  v_state jsonb;
  v_plan jsonb;
begin
  v := knowledge.lock_version(p_version_id, array['under_review']);
  -- Lås dokumentets øvrige versioner, så to godkendelser ikke kan krydse hinanden.
  perform 1 from knowledge.document_versions where document_id = v.document_id for update;

  v_state := knowledge.review_state(p_version_id);
  if not (v_state ->> 'can_approve')::boolean then
    raise exception '%', (select string_agg(b ->> 'message', ' ') from jsonb_array_elements(v_state -> 'blockers') b)
      using errcode = 'check_violation', detail = (v_state -> 'blockers')::text;
  end if;
  v_plan := v_state -> 'publication';

  if v_plan -> 'predecessor' is not null and v_plan -> 'predecessor' <> 'null'::jsonb then
    update knowledge.document_versions
    set valid_to = v.valid_from, superseded_by = v.id, superseded_at = now()
    where id = (v_plan -> 'predecessor' ->> 'version_id')::uuid;
  end if;

  perform knowledge.set_audit_details(jsonb_build_object('acknowledged_warnings', coalesce(p_acknowledged_warnings, '[]'::jsonb)));
  update knowledge.document_versions
  set status = 'published', approved_by = v_me, approved_at = now(), published_at = now()
  where id = p_version_id;

  insert into knowledge.version_reviews (version_id, reviewer_id, decision, quality_report_snapshot)
  values (p_version_id, v_me, 'approved',
          jsonb_build_object('quality_report', v_state -> 'quality_report', 'warnings', v_state -> 'warnings',
                             'acknowledged_warnings', coalesce(p_acknowledged_warnings, '[]'::jsonb)));
  return v_plan;
end;
$$;

-- "Afvis" (under_review → rejected). Begrundelse påkrævet.
create or replace function knowledge.reject_version(p_version_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := knowledge.require_permission('knowledge.version.publish');
  v_state jsonb;
begin
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'En afvisning kræver en begrundelse' using errcode = 'check_violation';
  end if;
  perform knowledge.lock_version(p_version_id, array['under_review']);
  v_state := knowledge.review_state(p_version_id);
  perform knowledge.set_audit_details(jsonb_build_object('reason', btrim(p_reason)));
  update knowledge.document_versions set status = 'rejected' where id = p_version_id;
  insert into knowledge.version_reviews (version_id, reviewer_id, decision, reason, quality_report_snapshot)
  values (p_version_id, v_me, 'rejected', btrim(p_reason), jsonb_build_object('quality_report', v_state -> 'quality_report'));
end;
$$;

-- "Deaktivér" (published → withdrawn). Fjernes straks fra al retrieval; slettes aldrig.
create or replace function knowledge.withdraw_version(p_version_id uuid, p_category text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := knowledge.require_permission('knowledge.version.publish');
begin
  if p_category is null or p_category not in ('invalid', 'withdrawn_by_owner', 'other') then
    raise exception 'Vælg en kategori for deaktiveringen' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'En deaktivering kræver en begrundelse' using errcode = 'check_violation';
  end if;
  perform knowledge.lock_version(p_version_id, array['published']);
  update knowledge.document_versions
  set status = 'withdrawn', withdrawn_by = v_me, withdrawn_at = now(), withdrawal_category = p_category, withdrawal_reason = btrim(p_reason)
  where id = p_version_id;
end;
$$;

-- "Genbehandl" (processing_failed / rejected → processing) med et nyt behandlingsjob.
create or replace function knowledge.request_reprocess(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform knowledge.require_permission('knowledge.document.write');
  perform knowledge.lock_version(p_version_id, array['processing_failed', 'rejected']);
  update knowledge.document_versions set status = 'processing' where id = p_version_id;
  insert into knowledge.ingestion_jobs (document_version_id, kind) values (p_version_id, 'process');
end;
$$;

-- "Kassér" (kun aldrig publicerede versioner). Ventende jobs annulleres.
create or replace function knowledge.discard_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform knowledge.require_permission('knowledge.document.write');
  perform knowledge.lock_version(p_version_id, array['uploaded', 'processing_failed', 'processed', 'rejected']);
  update knowledge.ingestion_jobs set status = 'cancelled', finished_at = now(), locked_by = null, locked_until = null
  where document_version_id = p_version_id and status = 'queued';
  update knowledge.document_versions set status = 'discarded' where id = p_version_id;
end;
$$;

-- Ret versionens metadata (før review). En afvist version bliver klar til review igen
-- ("rejected → processed: metadata rettet uden ny behandling").
create or replace function knowledge.update_version_metadata(
  p_version_id uuid, p_version_label text, p_language text, p_valid_from date, p_valid_to date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v knowledge.document_versions;
begin
  perform knowledge.require_permission('knowledge.document.write');
  v := knowledge.lock_version(p_version_id, array['uploaded', 'processing', 'processing_failed', 'processed', 'rejected']);
  update knowledge.document_versions
  set version_label = nullif(btrim(coalesce(p_version_label, '')), ''),
      language = coalesce(nullif(p_language, ''), 'da'),
      valid_from = p_valid_from,
      valid_to = p_valid_to,
      status = case when v.status = 'rejected' then 'processed' else v.status end
  where id = p_version_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Rettigheder
-- ----------------------------------------------------------------------------

revoke all on function
  knowledge.set_audit_details(jsonb),
  knowledge.publication_plan(uuid),
  knowledge.review_state(uuid),
  knowledge.require_permission(text),
  knowledge.lock_version(uuid, text[]),
  knowledge.start_review(uuid),
  knowledge.cancel_review(uuid),
  knowledge.approve_version(uuid, jsonb),
  knowledge.reject_version(uuid, text),
  knowledge.withdraw_version(uuid, text, text),
  knowledge.request_reprocess(uuid),
  knowledge.discard_version(uuid),
  knowledge.update_version_metadata(uuid, text, text, date, date)
from public, anon, authenticated;

grant execute on function
  knowledge.review_state(uuid),
  knowledge.start_review(uuid),
  knowledge.cancel_review(uuid),
  knowledge.approve_version(uuid, jsonb),
  knowledge.reject_version(uuid, text),
  knowledge.withdraw_version(uuid, text, text),
  knowledge.request_reprocess(uuid),
  knowledge.discard_version(uuid),
  knowledge.update_version_metadata(uuid, text, text, date, date)
to authenticated;
