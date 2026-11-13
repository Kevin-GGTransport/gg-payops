-- G&G PayOps
-- 0021: drivers and trucks are picked independently at entry time, so the
--       legacy per-driver truck number is dead weight. Drop the column and
--       its unique constraint; trips already snapshot the truck they ran on
--       (pay.trips.truck_snapshot->>'truck_code'), payroll export derives
--       the truck numbers from there.
-- Idempotent-ish: guarded by the _migrations registration done alongside.

BEGIN;

ALTER TABLE ops.drivers DROP CONSTRAINT IF EXISTS uq_drivers_code;

ALTER TABLE ops.drivers DROP COLUMN IF EXISTS driver_code;

COMMIT;
