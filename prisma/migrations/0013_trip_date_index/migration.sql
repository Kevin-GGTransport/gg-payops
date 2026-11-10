-- G&G PayOps
-- 0013: date-only covering index for pay.trips.
--       Existing idx_trips_driver_date (driver_id, trip_date) cannot serve
--       date-range-only scans (workbench period list, payroll period totals);
--       those fell back to sequential scans. INCLUDE columns let the period
--       aggregates run as index-only scans.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_trips_date
  ON pay.trips (trip_date DESC)
  INCLUDE (driver_id, operation, miles, pay_amount);

COMMIT;
