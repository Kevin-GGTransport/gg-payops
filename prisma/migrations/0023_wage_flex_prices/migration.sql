-- G&G PayOps
-- 0023: flexible wage pricing.
--   ops.locations.amazon_class: A/B classification for Amazon warehouses,
--     consumed by the AMAZON_A / AMAZON_B route matchers below.
--   pay.wage_rule_prices: unified price rules per wage-rule version.
--     driver_id NULL = applies to every driver; unit is the billing unit -
--     LEG prices one trip, ROUND_TRIP / DAY suggest package prices in the
--     entry sheet. from_class / to_class / operation are matchers (NULL =
--     any side / any operation); classes: STK, HW, SHIPPER (by location
--     code), AMAZON_A, AMAZON_B (by warehouse class). driver_amount is the
--     driver price; owner_amount optional (NULL = fill by hand at entry).
--   pay.trips.package_id / package_note: legs of one priced package share
--     the id; the first leg carries the amount, the rest bill $0.
-- Idempotent-ish: guarded by the _migrations registration done alongside.

BEGIN;

ALTER TABLE ops.locations
  ADD COLUMN amazon_class char(1);

ALTER TABLE ops.locations
  ADD CONSTRAINT ck_locations_amazon_class CHECK (amazon_class IN ('A', 'B'));

COMMENT ON COLUMN ops.locations.amazon_class IS 'Amazon warehouse class A/B used by wage route matchers (NULL = unclassified)';

CREATE TABLE pay.wage_rule_prices (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id    bigint NOT NULL REFERENCES pay.wage_rule_versions(id) ON DELETE CASCADE,
  driver_id     bigint REFERENCES ops.drivers(id),
  unit          varchar(20) NOT NULL,
  from_class    varchar(20),
  to_class      varchar(20),
  operation     varchar(20),
  label         varchar(100),
  driver_amount numeric(12, 2) NOT NULL,
  owner_amount  numeric(12, 2),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_wage_prices_unit CHECK (unit IN ('LEG', 'ROUND_TRIP', 'DAY')),
  CONSTRAINT ck_wage_prices_amounts CHECK (
    driver_amount >= 0 AND (owner_amount IS NULL OR owner_amount >= 0)
  )
);

CREATE INDEX idx_wage_prices_version ON pay.wage_rule_prices (version_id);

CREATE INDEX idx_wage_prices_driver ON pay.wage_rule_prices (driver_id);

COMMENT ON TABLE pay.wage_rule_prices IS 'Flexible price rules per wage-rule version: per-driver or global, unit LEG/ROUND_TRIP/DAY, class-based route matchers';

ALTER TABLE pay.trips
  ADD COLUMN package_id varchar(40),
  ADD COLUMN package_note text;

COMMENT ON COLUMN pay.trips.package_id IS 'Shared id for legs of one priced package; the first leg carries the amount, the rest bill 0';

COMMENT ON COLUMN pay.trips.package_note IS 'Package display label, e.g. 往返打包 $200';

COMMIT;
