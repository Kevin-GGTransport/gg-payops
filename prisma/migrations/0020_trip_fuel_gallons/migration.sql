-- G&G PayOps
-- 0020: per-trip fuel-up record. pay.trips gains fuel_gallons (US gallons,
--       2 decimals, default 0) so the payroll sheet and the driver period
--       detail can report weekly fuel alongside miles and pay. Pure ledger
--       field - wage pricing never reads it.
-- Idempotent-ish: guarded by the _migrations registration done alongside.

BEGIN;

ALTER TABLE pay.trips
  ADD COLUMN fuel_gallons numeric(8, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN pay.trips.fuel_gallons IS 'Fuel added on this leg, US gallons (manual entry, not priced)';

COMMIT;
