-- 0029: drivers gain an advisory pricing mode (LEG / DAY / ROUND_TRIP).
--   The trip-entry sheet's package-unit dropdown follows the picked driver's
--   mode; a manual override in the sheet always wins. The server never prices
--   by this column - it is a UI default only.
BEGIN;

ALTER TABLE ops.drivers
  ADD COLUMN IF NOT EXISTS pricing_mode varchar(20) NOT NULL DEFAULT 'LEG';

ALTER TABLE ops.drivers DROP CONSTRAINT IF EXISTS ck_drivers_pricing_mode;
ALTER TABLE ops.drivers
  ADD CONSTRAINT ck_drivers_pricing_mode
  CHECK (pricing_mode IN ('LEG', 'DAY', 'ROUND_TRIP'));

COMMENT ON COLUMN ops.drivers.pricing_mode IS
  'Advisory trip-entry pricing mode: LEG = per-leg rules (default), DAY / ROUND_TRIP = package pricing the entry sheet follows on driver pick. Manual override in the sheet always wins.';

INSERT INTO common._migrations (name)
SELECT '0029_driver_pricing_mode'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0029_driver_pricing_mode'
);

COMMIT;
