-- ============================================================================
-- Beta (B-036), L1.1 — tre adskilte godkendelser
-- ============================================================================
-- Specifikation: docs/beta.md §5.2–§5.3 og docs/decisions.md B-036.
--
-- Betaen skelner mellem tre ting, og ingen af dem medfører automatisk en anden:
--
--   1. Godkendt retrieval-konfiguration (knowledge.retrieval_configurations, 8B-I6, uændret):
--      leverer metoden det rigtige dokumentgrundlag (hårde gates, D1–D6)?
--   2. Valideret AI-svarkvalitet (ai.answer_quality_validations, ny): er Claudes færdige svar
--      fagligt korrekte på betaens E2E-sæt? Registreres af en med system.settings.manage og
--      valideres af et menneske med knowledge.version.publish (faglig godkendelse). Kriterierne er
--      låst her og i evals/engine/acceptance.ts:
--        * mindst 40 spørgsmål, alle ni kategorier;
--        * mindst 95 % fuldt korrekte svar;
--        * 0 kritiske fejl, 0 opdigtede kildehenvisninger;
--        * 0 fejl i håndteringen af undtagelser og begrænsninger;
--        * 0 manglende eller uberettigede afvisninger;
--        * en rigtig Claude-model — aldrig stub- eller testmodellen.
--      Den statistiske usikkerhed (Wilson) gemmes, og valideringen kræver en eksplicit accept af
--      den. Et resultat, der opfylder kriterierne, er ikke valideret, før et menneske validerer det.
--   3. Betaversion godkendt til rådgivere (ai.beta_release_approvals, ny): et menneske med
--      system.settings.manage godkender en version, der bygger på en AKTIV retrieval-konfiguration
--      og en VALIDERET svarkvalitet for netop den konfiguration. Kan trækkes tilbage.
--
-- ai.beta_status() viser de tre tilstande hver for sig. Intet her ændrer retrieval-registret,
-- RLS på eksisterende tabeller eller gatewayen. Ingen data ændres eller slettes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Valideret AI-svarkvalitet
-- ----------------------------------------------------------------------------

create table ai.answer_quality_validations (
  id uuid primary key default gen_random_uuid(),
  criteria_id text not null check (criteria_id = 'beta-answer-acceptance'),
  criteria_version int not null check (criteria_version = 1),
  eval_set_id text not null check (eval_set_id ~ '^[a-z0-9][a-z0-9_-]{0,60}$'),
  eval_set_version int not null check (eval_set_version > 0),
  eval_set_checksum text not null check (eval_set_checksum ~ '^[0-9a-f]{64}$'),
  -- Svarene blev frembragt med netop denne retrieval-konfiguration, model og profil.
  retrieval_configuration_id uuid not null references knowledge.retrieval_configurations (id) on delete restrict,
  retrieval_fingerprint text not null check (retrieval_fingerprint ~ '^[0-9a-f]{64}$'),
  model_id text not null check (model_id ~ '^[a-z0-9][a-z0-9._-]{0,80}$'),
  model_version text not null check (length(model_version) between 1 and 80),
  profile_id text not null check (profile_id ~ '^[a-z0-9][a-z0-9._-]{0,60}$'),
  profile_version text not null check (length(profile_version) between 1 and 40),
  -- Genberegnet af databasen fra bedømmelserne pr. spørgsmål (results).
  questions int not null,
  fully_correct int not null,
  critical_errors int not null,
  invented_citations int not null,
  exception_failures int not null,
  refusal_failures int not null,
  categories jsonb not null,
  fully_correct_lower_bound double precision not null,
  results jsonb not null,
  results_checksum text not null check (results_checksum ~ '^[0-9a-f]{64}$'),
  criteria_met boolean not null,
  problems text[] not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null,
  validated_at timestamptz,
  validated_by uuid,
  validation_note text,
  uncertainty_accepted boolean not null default false,
  unique (results_checksum, retrieval_configuration_id, model_id, model_version, profile_id, profile_version),
  check ((validated_at is null) = (validated_by is null) and (validated_at is null) = (validation_note is null)),
  check (validated_at is null or (criteria_met and uncertainty_accepted)),
  check (criteria_met = (cardinality(problems) = 0))
);

comment on table ai.answer_quality_validations is
  'Valideret AI-svarkvalitet (B-036): E2E-bedømmelsen af Claudes færdige svar. Adskilt fra godkendt retrieval-konfiguration og fra betagodkendelsen; ingen af dem medfører de andre.';

-- Låste kriterier (evals/engine/acceptance.ts ACCEPTANCE_CRITERIA).
create or replace function ai.acceptance_categories()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['conflict', 'direct', 'exception', 'historical', 'missing_coverage', 'multi_clause', 'permission', 'similar_product', 'unanswerable']
$$;

-- Bedømmelsen af ét spørgsmål (acceptance.ts GradedAnswer). Null = gyldig.
create or replace function ai.graded_answer_problem(r jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(r) is distinct from 'object'
     or not (knowledge.jsonb_keys(r) = array['caseId', 'category', 'correctness', 'critical', 'exceptions', 'inventedCitation', 'refusal']
             or knowledge.jsonb_keys(r) = array['caseId', 'category', 'correctness', 'critical', 'exceptions', 'inventedCitation', 'note', 'refusal']) then
    return 'en bedømmelse har ikke de forventede felter';
  end if;
  if pg_catalog.jsonb_typeof(r -> 'caseId') <> 'string' or (r ->> 'caseId') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$'
     or not ((r ->> 'category') = any (ai.acceptance_categories()))
     or (r ->> 'correctness') not in ('full', 'partial', 'wrong')
     or pg_catalog.jsonb_typeof(r -> 'critical') <> 'boolean' or pg_catalog.jsonb_typeof(r -> 'inventedCitation') <> 'boolean'
     or (r ->> 'exceptions') not in ('correct', 'incorrect', 'not_applicable')
     or (r ->> 'refusal') not in ('correct', 'missing', 'unwarranted', 'not_applicable')
     or (r ? 'note' and (pg_catalog.jsonb_typeof(r -> 'note') <> 'string' or length(r ->> 'note') > 2000)) then
    return format('bedømmelsen af %s er ugyldig', coalesce(r ->> 'caseId', '?'));
  end if;
  -- Kategorierne, hvor kravet altid gælder, kan ikke bedømmes "ikke relevant".
  if (r ->> 'category') = 'exception' and (r ->> 'exceptions') = 'not_applicable' then
    return format('%s: et spørgsmål om undtagelser skal bedømmes på undtagelserne', r ->> 'caseId');
  end if;
  if (r ->> 'category') in ('unanswerable', 'permission') and (r ->> 'refusal') = 'not_applicable' then
    return format('%s: et spørgsmål uden tilstrækkeligt grundlag skal bedømmes på afvisningen', r ->> 'caseId');
  end if;
  return null;
end;
$$;

-- Fuldt korrekt: rigtigt svar uden kritisk fejl, opdigtet henvisning, fejl i undtagelser eller afvisning.
create or replace function ai.graded_answer_fully_correct(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (r ->> 'correctness') = 'full' and (r -> 'critical') = 'false'::jsonb and (r -> 'inventedCitation') = 'false'::jsonb
     and (r ->> 'exceptions') <> 'incorrect' and (r ->> 'refusal') in ('correct', 'not_applicable')
$$;

create or replace function ai.check_answer_quality_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'En registreret svarvalidering slettes aldrig' using errcode = 'check_violation';
  end if;
  if pg_catalog.current_setting('ai.acceptance_write', true) is distinct from 'on' then
    raise exception 'Svarvalideringer ændres kun gennem ai.record_answer_quality og ai.validate_answer_quality' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.validated_at is not null then
      raise exception 'En svarvalidering registreres altid uvalideret' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'validated_at' - 'validated_by' - 'validation_note' - 'uncertainty_accepted')
       <> (to_jsonb(old) - 'validated_at' - 'validated_by' - 'validation_note' - 'uncertainty_accepted')
     or old.validated_at is not null or new.validated_at is null then
    raise exception 'En registreret svarvalidering kan ikke ændres — kun valideres én gang' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger answer_quality_validations_write
  before insert or update or delete on ai.answer_quality_validations
  for each row execute function ai.check_answer_quality_write();

create or replace function ai.require_permission(p_permission text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if identity.current_user_id() is null or not identity.has_permission(p_permission) then
    raise exception 'Ingen adgang' using errcode = 'insufficient_privilege';
  end if;
  return identity.current_user_id();
end;
$$;

create or replace function ai.write_audit(p_action text, p_table text, p_entity_id text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into audit.audit_log (actor_id, action, entity_schema, entity_table, entity_id, details)
  values (identity.current_user_id(), p_action, 'ai', p_table, p_entity_id, p_details)
$$;

-- Registrerer en E2E-bedømmelse (system.settings.manage). Tallene genberegnes her fra
-- bedømmelserne; kriterierne vurderes, men intet bliver valideret ved registreringen.
create or replace function ai.record_answer_quality(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := ai.require_permission('system.settings.manage');
  v_cfg knowledge.retrieval_configurations;
  v_results jsonb := p -> 'results';
  v_problem text;
  v_problems text[] := '{}';
  v_questions int;
  v_fully int;
  v_critical int;
  v_invented int;
  v_exceptions int;
  v_refusals int;
  v_categories jsonb;
  v_missing text[];
  v_lower double precision;
  v_id uuid;
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object'
     or knowledge.jsonb_keys(p) <> array['criteria', 'evalSet', 'model', 'profile', 'results', 'retrievalConfigurationId'] then
    raise exception 'Bedømmelsen har ikke det forventede format' using errcode = '22023';
  end if;
  if (p -> 'criteria') is distinct from '{"id": "beta-answer-acceptance", "version": 1}'::jsonb then
    raise exception 'Kun kriterierne beta-answer-acceptance v1 kan registreres' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_results) is distinct from 'array' or pg_catalog.jsonb_array_length(v_results) = 0 then
    raise exception 'Bedømmelsen har ingen spørgsmål' using errcode = '22023';
  end if;
  select ai.graded_answer_problem(r) into v_problem from pg_catalog.jsonb_array_elements(v_results) r where ai.graded_answer_problem(r) is not null limit 1;
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if (select count(distinct r ->> 'caseId') from pg_catalog.jsonb_array_elements(v_results) r) <> pg_catalog.jsonb_array_length(v_results) then
    raise exception 'Et spørgsmål er bedømt mere end én gang' using errcode = '22023';
  end if;
  select * into v_cfg from knowledge.retrieval_configurations where id = (p ->> 'retrievalConfigurationId')::uuid;
  if v_cfg.id is null then
    raise exception 'Retrieval-konfigurationen findes ikke' using errcode = '22023';
  end if;

  select count(*)::int,
         count(*) filter (where ai.graded_answer_fully_correct(r))::int,
         count(*) filter (where (r -> 'critical') = 'true'::jsonb)::int,
         count(*) filter (where (r -> 'inventedCitation') = 'true'::jsonb)::int,
         count(*) filter (where (r ->> 'exceptions') = 'incorrect')::int,
         count(*) filter (where (r ->> 'refusal') in ('missing', 'unwarranted'))::int
  into v_questions, v_fully, v_critical, v_invented, v_exceptions, v_refusals
  from pg_catalog.jsonb_array_elements(v_results) r;
  select pg_catalog.jsonb_object_agg(c, (select count(*) from pg_catalog.jsonb_array_elements(v_results) r where r ->> 'category' = c))
  into v_categories from unnest(ai.acceptance_categories()) c;
  select coalesce(array_agg(c order by c), '{}') into v_missing from unnest(ai.acceptance_categories()) c where (v_categories ->> c)::int = 0;
  v_lower := (knowledge.eval_wilson(v_fully, v_questions) ->> 'lower')::double precision;

  -- Kriterierne (acceptance.ts decideAcceptance).
  if v_questions < 40 then v_problems := array_append(v_problems, format('for få spørgsmål: %s (mindst 40)', v_questions)); end if;
  if cardinality(v_missing) > 0 then v_problems := array_append(v_problems, format('kategorier uden spørgsmål: %s', array_to_string(v_missing, ', '))); end if;
  if v_fully * 100 < 95 * v_questions then v_problems := array_append(v_problems, format('%s af %s fuldt korrekte (mindst 95 %%)', v_fully, v_questions)); end if;
  if v_critical > 0 then v_problems := array_append(v_problems, format('%s kritiske fejl', v_critical)); end if;
  if v_invented > 0 then v_problems := array_append(v_problems, format('%s opdigtede kildehenvisninger', v_invented)); end if;
  if v_exceptions > 0 then v_problems := array_append(v_problems, format('%s fejl i undtagelser og begrænsninger', v_exceptions)); end if;
  if v_refusals > 0 then v_problems := array_append(v_problems, format('%s manglende eller uberettigede afvisninger', v_refusals)); end if;
  -- Kun en rigtig Claude-model kan bestå. Stub- og testmodellen er udviklingsværktøjer.
  if coalesce(p #>> '{model,id}', '') !~ '^claude-[a-z0-9.-]+$' then
    v_problems := array_append(v_problems, format('modellen "%s" er ikke en rigtig Claude-model', coalesce(p #>> '{model,id}', '')));
  end if;

  perform pg_catalog.set_config('ai.acceptance_write', 'on', true);
  insert into ai.answer_quality_validations (
    criteria_id, criteria_version, eval_set_id, eval_set_version, eval_set_checksum, retrieval_configuration_id, retrieval_fingerprint,
    model_id, model_version, profile_id, profile_version, questions, fully_correct, critical_errors, invented_citations,
    exception_failures, refusal_failures, categories, fully_correct_lower_bound, results, results_checksum, criteria_met, problems, recorded_by)
  values (
    'beta-answer-acceptance', 1, p #>> '{evalSet,id}', (p #>> '{evalSet,version}')::int, p #>> '{evalSet,checksum}', v_cfg.id, v_cfg.fingerprint,
    p #>> '{model,id}', p #>> '{model,version}', p #>> '{profile,id}', p #>> '{profile,version}', v_questions, v_fully, v_critical, v_invented,
    v_exceptions, v_refusals, v_categories, v_lower, v_results, knowledge.checksum_of(v_results), cardinality(v_problems) = 0, v_problems, v_actor)
  returning id into v_id;
  perform pg_catalog.set_config('ai.acceptance_write', '', true);

  perform ai.write_audit('ai.answer_quality.recorded', 'answer_quality_validations', v_id::text,
    pg_catalog.jsonb_build_object('retrieval_configuration_id', v_cfg.id, 'model', p #>> '{model,id}', 'questions', v_questions,
      'fully_correct', v_fully, 'critical_errors', v_critical, 'criteria_met', cardinality(v_problems) = 0));
  return v_id;
end;
$$;

-- Faglig, menneskelig validering (knowledge.version.publish). Kræver opfyldte kriterier, en
-- begrundelse og en eksplicit accept af den statistiske usikkerhed. Validerer kun svarkvaliteten —
-- ikke retrieval-konfigurationen og ikke betaen.
create or replace function ai.validate_answer_quality(p_validation_id uuid, p_note text, p_uncertainty_accepted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := ai.require_permission('knowledge.version.publish');
  v_row ai.answer_quality_validations;
begin
  select * into v_row from ai.answer_quality_validations where id = p_validation_id for update;
  if v_row.id is null then
    raise exception 'Svarvalideringen findes ikke' using errcode = '22023';
  end if;
  if v_row.validated_at is not null then
    raise exception 'Svarvalideringen er allerede valideret' using errcode = '22023';
  end if;
  if not v_row.criteria_met then
    raise exception 'Kriterierne er ikke opfyldt: %', array_to_string(v_row.problems, '; ') using errcode = '22023';
  end if;
  if p_uncertainty_accepted is distinct from true then
    raise exception 'Den statistiske usikkerhed (nedre 95 %%-grænse %) skal accepteres eksplicit', round(v_row.fully_correct_lower_bound::numeric, 3) using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'En faglig begrundelse er påkrævet' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('ai.acceptance_write', 'on', true);
  update ai.answer_quality_validations
  set validated_at = now(), validated_by = v_actor, validation_note = btrim(p_note), uncertainty_accepted = true
  where id = v_row.id;
  perform pg_catalog.set_config('ai.acceptance_write', '', true);
  perform ai.write_audit('ai.answer_quality.validated', 'answer_quality_validations', v_row.id::text,
    pg_catalog.jsonb_build_object('retrieval_configuration_id', v_row.retrieval_configuration_id, 'model', v_row.model_id,
      'fully_correct', v_row.fully_correct, 'questions', v_row.questions, 'lower_bound', v_row.fully_correct_lower_bound));
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Betaversion godkendt til rådgivere
-- ----------------------------------------------------------------------------

create table ai.beta_release_approvals (
  id uuid primary key default gen_random_uuid(),
  label text not null check (label ~ '^[a-z0-9][a-z0-9._-]{0,60}$'),
  retrieval_configuration_id uuid not null references knowledge.retrieval_configurations (id) on delete restrict,
  answer_quality_validation_id uuid not null references ai.answer_quality_validations (id) on delete restrict,
  approved_at timestamptz not null default now(),
  approved_by uuid not null,
  note text not null check (length(note) between 10 and 2000),
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revocation_reason is null))
);

comment on table ai.beta_release_approvals is
  'Betaversion godkendt til rådgivere (B-036). Kræver en aktiv retrieval-konfiguration og en valideret svarkvalitet for netop den; godkendes og trækkes tilbage af et menneske.';

create or replace function ai.check_beta_release_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'En betagodkendelse slettes aldrig — den trækkes tilbage' using errcode = 'check_violation';
  end if;
  if pg_catalog.current_setting('ai.acceptance_write', true) is distinct from 'on' then
    raise exception 'Betagodkendelser ændres kun gennem ai.approve_beta_release og ai.revoke_beta_release' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.revoked_at is not null then
      raise exception 'En betagodkendelse registreres aldrig tilbagetrukket' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'revoked_at' - 'revoked_by' - 'revocation_reason') <> (to_jsonb(old) - 'revoked_at' - 'revoked_by' - 'revocation_reason')
     or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'En betagodkendelse kan kun trækkes tilbage, én gang' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger beta_release_approvals_write
  before insert or update or delete on ai.beta_release_approvals
  for each row execute function ai.check_beta_release_write();

create or replace function ai.approve_beta_release(p_label text, p_validation_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := ai.require_permission('system.settings.manage');
  v_validation ai.answer_quality_validations;
  v_cfg knowledge.retrieval_configurations;
  v_id uuid;
begin
  select * into v_validation from ai.answer_quality_validations where id = p_validation_id;
  if v_validation.id is null or v_validation.validated_at is null then
    raise exception 'Betaen kræver en valideret svarkvalitet' using errcode = '22023';
  end if;
  select * into v_cfg from knowledge.retrieval_configurations where id = v_validation.retrieval_configuration_id;
  if v_cfg.status is distinct from 'active' or v_cfg.fingerprint is distinct from v_validation.retrieval_fingerprint then
    raise exception 'Betaen kræver, at den validerede svarkvalitets retrieval-konfiguration er den aktive' using errcode = '22023';
  end if;
  if (knowledge.retrieval_context() #> '{configuration,productionReady}') is distinct from 'true'::jsonb then
    raise exception 'Den aktive retrieval-konfiguration er ikke klar til drift (%)', knowledge.retrieval_context() #>> '{configuration,notReady}' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'En begrundelse er påkrævet' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('ai.acceptance_write', 'on', true);
  insert into ai.beta_release_approvals (label, retrieval_configuration_id, answer_quality_validation_id, approved_by, note)
  values (p_label, v_cfg.id, v_validation.id, v_actor, btrim(p_note))
  returning id into v_id;
  perform pg_catalog.set_config('ai.acceptance_write', '', true);
  perform ai.write_audit('ai.beta_release.approved', 'beta_release_approvals', v_id::text,
    pg_catalog.jsonb_build_object('label', p_label, 'retrieval_configuration_id', v_cfg.id, 'answer_quality_validation_id', v_validation.id,
      'model', v_validation.model_id));
  return v_id;
end;
$$;

create or replace function ai.revoke_beta_release(p_approval_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := ai.require_permission('system.settings.manage');
  v_row ai.beta_release_approvals;
begin
  select * into v_row from ai.beta_release_approvals where id = p_approval_id for update;
  if v_row.id is null or v_row.revoked_at is not null then
    raise exception 'Betagodkendelsen findes ikke eller er allerede trukket tilbage' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'En begrundelse er påkrævet' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('ai.acceptance_write', 'on', true);
  update ai.beta_release_approvals set revoked_at = now(), revoked_by = v_actor, revocation_reason = btrim(p_reason) where id = v_row.id;
  perform pg_catalog.set_config('ai.acceptance_write', '', true);
  perform ai.write_audit('ai.beta_release.revoked', 'beta_release_approvals', v_row.id::text,
    pg_catalog.jsonb_build_object('label', v_row.label, 'reason', btrim(p_reason)));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. De tre tilstande, hver for sig
-- ----------------------------------------------------------------------------

-- Hver tilstand afgøres af sit eget grundlag. En betagodkendelse gælder kun, så længe dens
-- retrieval-konfiguration er den aktive og klar til drift, og dens svarvalidering er valideret
-- for netop den konfiguration — skiftes eller suspenderes konfigurationen, gælder den ikke.
create or replace function ai.beta_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_cfg_id uuid;
  v_retrieval boolean;
  v_validation ai.answer_quality_validations;
  v_release ai.beta_release_approvals;
begin
  perform ai.require_permission('system.settings.manage');
  v_context := knowledge.retrieval_context();
  v_cfg_id := (v_context #>> '{configuration,id}')::uuid;
  v_retrieval := (v_context #> '{configuration,productionReady}') = 'true'::jsonb and (v_context #>> '{configuration,status}') = 'active';
  select * into v_validation from ai.answer_quality_validations a
  where a.retrieval_configuration_id = v_cfg_id and a.validated_at is not null
    and a.retrieval_fingerprint = (v_context #>> '{configuration,fingerprint}')
  order by a.validated_at desc limit 1;
  select * into v_release from ai.beta_release_approvals b
  where b.revoked_at is null and b.retrieval_configuration_id = v_cfg_id and b.answer_quality_validation_id = v_validation.id
  order by b.approved_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'retrievalConfigurationApproved', coalesce(v_retrieval, false),
    'retrievalConfigurationId', v_cfg_id,
    'answerQualityValidated', v_validation.id is not null,
    'answerQualityValidationId', v_validation.id,
    'model', case when v_validation.id is null then null
                  else pg_catalog.jsonb_build_object('id', v_validation.model_id, 'version', v_validation.model_version) end,
    'betaApprovedForAdvisers', coalesce(v_retrieval, false) and v_validation.id is not null and v_release.id is not null,
    'betaReleaseId', v_release.id,
    'betaLabel', v_release.label);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Rettigheder
-- ----------------------------------------------------------------------------

alter table ai.answer_quality_validations enable row level security;
alter table ai.beta_release_approvals enable row level security;
create policy answer_quality_validations_select on ai.answer_quality_validations
  for select to authenticated using (identity.has_permission('system.settings.manage') or identity.has_permission('knowledge.version.publish'));
create policy beta_release_approvals_select on ai.beta_release_approvals
  for select to authenticated using (identity.has_permission('system.settings.manage'));
revoke all on ai.answer_quality_validations, ai.beta_release_approvals from public, anon, authenticated, service_role;
grant select on ai.answer_quality_validations, ai.beta_release_approvals to authenticated;

revoke all on function ai.acceptance_categories(), ai.graded_answer_problem(jsonb), ai.graded_answer_fully_correct(jsonb),
  ai.check_answer_quality_write(), ai.check_beta_release_write(), ai.require_permission(text),
  ai.write_audit(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function ai.record_answer_quality(jsonb), ai.validate_answer_quality(uuid, text, boolean),
  ai.approve_beta_release(text, uuid, text), ai.revoke_beta_release(uuid, text), ai.beta_status()
  from public, anon, authenticated, service_role;
grant execute on function ai.record_answer_quality(jsonb), ai.validate_answer_quality(uuid, text, boolean),
  ai.approve_beta_release(text, uuid, text), ai.revoke_beta_release(uuid, text), ai.beta_status() to authenticated;

-- ----------------------------------------------------------------------------
-- Tilbagerulning (manuelt): drop funktionerne og de to tabeller. Indholdet er historik og bør
-- eksporteres først. Retrieval-registret berøres ikke.
-- ----------------------------------------------------------------------------
