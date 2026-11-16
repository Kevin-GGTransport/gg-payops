-- G&G PayOps
-- 0025: class tags + per-driver pricing identity (all additive, safe ahead
-- of the deploy).
--   ops.locations.class_tag: free-form tag (A类 / 东湾 / 海柜点 ...). Rules
--     can match by tag, so re-tagging a location instantly re-prices every
--     rule that points at the tag - locations change, rules follow.
--   pay.wage_rule_prices.from_tag / to_tag: tag matchers; at most one of
--     (location id, tag) set per side.
--   ops.drivers.price_as_driver: owner-type driver who bills at DRIVER
--     prices everywhere (rules use the driver column, mileage fallback skips
--     the owner multiplier).
-- Idempotent-ish: guarded by the _migrations registration done alongside.

BEGIN;

ALTER TABLE ops.locations
  ADD COLUMN class_tag varchar(40);

COMMENT ON COLUMN ops.locations.class_tag IS 'Free-form class tag; wage price rules can match endpoints by tag';

ALTER TABLE pay.wage_rule_prices
  ADD COLUMN from_tag varchar(40),
  ADD COLUMN to_tag varchar(40);

COMMENT ON COLUMN pay.wage_rule_prices.from_tag IS 'Tag matcher for the start side (mutually exclusive with from_location_id)';

COMMENT ON COLUMN pay.wage_rule_prices.to_tag IS 'Tag matcher for the end side (mutually exclusive with to_location_id)';

ALTER TABLE ops.drivers
  ADD COLUMN price_as_driver boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ops.drivers.price_as_driver IS 'Owner-type driver billed at driver prices (rules use the driver column, no owner multiplier)';

COMMIT;
