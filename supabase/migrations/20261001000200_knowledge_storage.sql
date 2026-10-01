-- ============================================================================
-- Fase 7, trin 2 — Originalfiler i Storage, upload og registrering af en version
--
-- Specifikation: docs/07 §2.2 (— → uploaded), §5.1 (upload via signeret URL), §5.4
-- (kun PDF) og §14 (privat bucket, signerede URL'er, upload-validering).
--
--   * Bucket'en er privat. Originaler hentes kun via kortlivede signerede URL'er, som
--     serveren udsteder efter permission-tjek.
--   * Stien er {document_id}/{version_id}/original.pdf — aldrig brugerens filnavn.
--   * Bucket'en tager kun imod application/pdf. Workeren validerer indholdet igen
--     (magic bytes), fordi klientens Content-Type ikke er til at stole på.
--   * Registreringen opretter versionen (status uploaded) og behandlingsjobbet i samme
--     transaktion og kræver, at filen faktisk ligger i Storage.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-originals', 'knowledge-originals', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Gyldig sti for en original: {uuid}/{uuid}/original.pdf
create or replace function knowledge.is_original_path(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/original\.pdf$'
$$;

-- Upload: kun knowledge.document.write, kun i den rigtige stistruktur, og aldrig til en
-- sti, der allerede tilhører en registreret version.
create policy knowledge_originals_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'knowledge-originals'
    and identity.has_permission('knowledge.document.write')
    and knowledge.is_original_path(name)
    and not exists (select 1 from knowledge.document_versions v where v.storage_path = name)
  );

-- Læsning (og dermed signerede download-URL'er): kun vidensforvaltere. Rådgivere og ledere
-- får ikke originalfiler i fase 7 (docs/07 §12: ingen brugerrettet dokumentvisning endnu).
create policy knowledge_originals_select on storage.objects
  for select to authenticated
  using (bucket_id = 'knowledge-originals' and knowledge.is_knowledge_manager());

-- Der findes bevidst ingen update- eller delete-policies: en original ændres eller slettes
-- aldrig gennem API'et.

-- ----------------------------------------------------------------------------
-- Registrering af en uploadet version (docs/07 §2.2: — → uploaded)
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

  select o.name, o.metadata into v_object
  from storage.objects o
  where o.bucket_id = 'knowledge-originals' and o.name = v_path;
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

  insert into knowledge.ingestion_jobs (document_version_id, kind) values (p_version_id, 'process');
  return p_version_id;
end;
$$;

-- Dubletdialogen (docs/04 §14.3): findes filen allerede som en version? Kun for forvaltere.
create or replace function knowledge.find_versions_by_checksum(p_checksum_sha256 text)
returns table (version_id uuid, document_id uuid, title text, version_label text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.document_id, d.title, v.version_label, v.status
  from knowledge.document_versions v
  join knowledge.documents d on d.id = v.document_id
  where knowledge.is_knowledge_manager()
    and v.checksum_sha256 = lower(p_checksum_sha256)
    and v.status <> 'discarded'
  order by v.uploaded_at desc
$$;

-- Udstedelse af en download-URL til en original auditeres (docs/07 §13). Serveren kalder
-- funktionen, før den beder Storage om en signeret URL; funktionen afviser uden adgang.
create or replace function knowledge.log_original_download(p_version_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not knowledge.is_knowledge_manager() then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  select v.storage_path into v_path from knowledge.document_versions v where v.id = p_version_id;
  if v_path is null then
    raise exception 'Versionen findes ikke' using errcode = 'no_data_found';
  end if;
  perform knowledge.write_audit('knowledge.original.download_url_issued', 'document_versions', p_version_id::text, '{}'::jsonb);
  return v_path;
end;
$$;

revoke all on function
  knowledge.is_original_path(text),
  knowledge.register_upload(uuid, uuid, jsonb, text, text, date, date, text, text),
  knowledge.find_versions_by_checksum(text),
  knowledge.log_original_download(uuid)
from public, anon;
grant execute on function
  knowledge.is_original_path(text),
  knowledge.register_upload(uuid, uuid, jsonb, text, text, date, date, text, text),
  knowledge.find_versions_by_checksum(text),
  knowledge.log_original_download(uuid)
to authenticated, service_role;
