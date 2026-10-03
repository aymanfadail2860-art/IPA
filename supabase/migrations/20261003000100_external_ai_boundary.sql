-- ============================================================================
-- 8B-I2.5 — Ekstern AI-datagrænse: kundedata kan aldrig tillades i matricen
-- (docs/08b §8.2 lag L4, K-6, K-9; B-022)
--
--   * Kundeidentificerbare data må ikke forlade platformens godkendte trust boundary til en
--     ekstern AI-udbyder uden en senere, eksplicit godkendt politik.
--   * customer_identifiable kan derfor kun være 'deny' — som audit_access. Hverken
--     ai.set_data_category_rule, administratoren eller service-rollen kan ændre det. Kun en
--     ny migration med henvisning til en beslutning kan.
--   * Det er en sikkerhedsstramning: de eksisterende rækker er allerede 'deny'.
-- ============================================================================

alter table ai.data_category_policy
  add constraint customer_identifiable_always_denied check (category <> 'customer_identifiable' or rule = 'deny');

comment on constraint customer_identifiable_always_denied on ai.data_category_policy is
  'Kundedata sendes aldrig til en ekstern AI-udbyder (8B-I2.5, docs/08b §8). Kan kun ophæves ved en ny migration og en eksplicit beslutning.';
