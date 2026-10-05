-- ============================================================================
-- Fase 8B, deltrin I5.5 — Scanner-isolation og signaturforsyning (docs/08b §21.7, B-027)
--
-- Et verdict kan spores til den præcise scanner-revision, der lavede det. Scanner-imaget
-- bygges af den planlagte pipeline og tagges uforanderligt i ECR som
-- ipa-clamav:<engine-version>-<signaturversion> (.github/workflows/clamav-signatures.yml).
-- Kolonnen afledes af verdictets egne felter, så ingen kan sætte en anden revision. Formatet
-- er ellers uændret, og verdicts forbliver uforanderlige.
-- ============================================================================

alter table knowledge.security_verdicts
  add column scanner_revision text generated always as (
    case
      when scanner_engine = 'ClamAV' and scanner_version is not null and signature_version is not null
        then 'ipa-clamav:' || scanner_version || '-' || signature_version
    end
  ) stored;

comment on column knowledge.security_verdicts.scanner_revision is
  'Scanner-imagets uforanderlige ECR-tag (ipa-clamav:<engine>-<signaturversion>); null for udviklingsscanneren.';

-- Uforanderligheden: en genereret kolonne er endnu ikke beregnet i NEW i en BEFORE-trigger. Den
-- afledes af felter, som triggeren allerede beskytter, og kan ikke sættes direkte (Postgres
-- afviser det), så den udelades af sammenligningen.
create or replace function knowledge.check_security_verdict_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Et sikkerhedsverdict slettes aldrig' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'released_at' - 'superseded_at' - 'superseded_reason' - 'scanner_revision')
     is distinct from (to_jsonb(old) - 'released_at' - 'superseded_at' - 'superseded_reason' - 'scanner_revision')
     or (old.released_at is not null and new.released_at is distinct from old.released_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'Et sikkerhedsverdict kan ikke ændres' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function knowledge.check_security_verdict_update() from public, anon, authenticated, service_role;
