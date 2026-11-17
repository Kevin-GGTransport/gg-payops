-- G&G PayOps
-- 0026: wage-rule versions switch to a single-active model.
--   pay.wage_rule_versions.status becomes the ONLY switch: 'ACTIVE' marks the
--   single version in force ('INACTIVE' otherwise); activating a version is a
--   manual switch that deactivates every other one. effective_from no longer
--   drives version selection - ALL trips price by the current ACTIVE version
--   regardless of date - so the column and its unique constraint go away.
--   Version display dates now come from created_at.
--   Data: the one version carrying price rules takes over as ACTIVE; versions
--   without rules (the pre-unification relic) go INACTIVE.

BEGIN;

ALTER TABLE pay.wage_rule_versions
  DROP CONSTRAINT uq_wage_rule_effective;

ALTER TABLE pay.wage_rule_versions
  DROP COLUMN effective_from;

COMMENT ON COLUMN pay.wage_rule_versions.status IS 'ACTIVE = the single version in force (at most one row); INACTIVE = stored preset';

UPDATE pay.wage_rule_versions SET status = 'INACTIVE';

UPDATE pay.wage_rule_versions v SET status = 'ACTIVE'
  WHERE EXISTS (SELECT 1 FROM pay.wage_rule_prices p WHERE p.version_id = v.id);

COMMIT;
