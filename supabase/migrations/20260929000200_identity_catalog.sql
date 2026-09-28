-- ============================================================================
-- Fase 6 — Permission-katalog og standardroller
--
-- Permissions er præcis eksempeltabellen i docs/03-technical-architecture.md §10
-- (inkl. rettelsen B-001 i docs/decisions.md). Der er ikke opfundet nye permissions.
-- Kataloget udbygges senere uden ændring af kontrollogikken (docs/03 §17, punkt 6).
--
-- Roller er kun samlinger af standardpermissions. Systemet kontrollerer altid
-- permission + scope, aldrig rollenavnet.
-- ============================================================================

insert into identity.permissions (key, description, allowed_scopes) values
  ('learning.progress.read', 'Læse læringsprogression', array['own', 'team', 'all']),
  ('practice.session.write', 'Gennemføre og gemme træningssessioner', array['own']),
  ('assessment.result.read', 'Læse Assessment-resultater', array['own', 'team', 'all']),
  ('advise.case.read', 'Læse kundecases, brugeren ejer eller er tildelt', array['own']),
  ('advise.case.write', 'Oprette og redigere kundecases, brugeren ejer eller er tildelt', array['own']),
  ('analytics.team.read', 'Se Analytics for teams i eget scope', array['team', 'all']),
  ('knowledge.document.read', 'Læse dokumenter i vidensgrundlaget', array['all']),
  ('knowledge.document.read_historical', 'Læse historiske dokumentversioner', array['all']),
  ('knowledge.document.write', 'Uploade og redigere dokumenter', array['all']),
  ('knowledge.version.publish', 'Godkende og aktivere dokumentversioner', array['all']),
  ('identity.user.manage', 'Administrere brugere, roller, teams og lederscopes', array['all']),
  ('system.settings.manage', 'Administrere systemindstillinger', array['all']);

insert into identity.roles (key, name, description) values
  ('advisor', 'Rådgiver', 'Primær bruger: lærer, træner, rådgiver og måles på platformen'),
  ('leader', 'Leder', 'Ser læring og kompetence for teams i eksplicit tildelt lederscope'),
  ('administrator', 'Administrator', 'Forvalter indhold, dokumenter, brugere og indstillinger');

-- Standardpermissions pr. rolle (docs/03 §10).
--
-- Bevidst udeladt i fase 6:
--   * knowledge.document.read / read_historical for Rådgiver og Leder står som "efter grants"
--     i docs/03 — de gives pr. dokument i Knowledge-domænet (senere fase), ikke gennem rollen.
--   * analytics.team.read for Administrator står som "efter rettigheder" — den gives ikke
--     automatisk af administratorrollen. En administrator, der skal se Analytics, tildeles
--     desuden lederrollen og et eksplicit lederscope.
with grants(role_key, permission_key, scope) as (
  values
    -- Rådgiver
    ('advisor', 'learning.progress.read', 'own'),
    ('advisor', 'practice.session.write', 'own'),
    ('advisor', 'assessment.result.read', 'own'),
    ('advisor', 'advise.case.read', 'own'),
    ('advisor', 'advise.case.write', 'own'),
    -- Leder: samme som rådgiver + team-scope på læring, Assessment og Analytics
    ('leader', 'learning.progress.read', 'own'),
    ('leader', 'learning.progress.read', 'team'),
    ('leader', 'practice.session.write', 'own'),
    ('leader', 'assessment.result.read', 'own'),
    ('leader', 'assessment.result.read', 'team'),
    ('leader', 'advise.case.read', 'own'),
    ('leader', 'advise.case.write', 'own'),
    ('leader', 'analytics.team.read', 'team'),
    -- Administrator
    ('administrator', 'learning.progress.read', 'own'),
    ('administrator', 'practice.session.write', 'own'),
    ('administrator', 'assessment.result.read', 'own'),
    ('administrator', 'advise.case.read', 'own'),
    ('administrator', 'advise.case.write', 'own'),
    ('administrator', 'knowledge.document.read', 'all'),
    ('administrator', 'knowledge.document.read_historical', 'all'),
    ('administrator', 'knowledge.document.write', 'all'),
    ('administrator', 'knowledge.version.publish', 'all'),
    ('administrator', 'identity.user.manage', 'all'),
    ('administrator', 'system.settings.manage', 'all')
)
insert into identity.role_permissions (role_id, permission_id, scope)
select r.id, p.id, g.scope
from grants g
join identity.roles r on r.key = g.role_key
join identity.permissions p on p.key = g.permission_key;
