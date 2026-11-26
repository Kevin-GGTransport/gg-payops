-- G&G PayOps
-- 0034: trips gain a manual intra-day order. sort_order NULL = auto
--       (chain legs head-to-tail per day, the previous behavior); non-NULL =
--       the clerk's drag order inside trip_date. driverPeriodTrips reads
--       ORDER BY (trip_date, sort_order NULLS LAST, id) and treats any day
--       holding at least one non-NULL value as manual; a trip_date edit
--       resets sort_order to NULL (the leg then appends by id inside a
--       manual day, or re-chains when the new day is all-NULL).
--       Statements are aggregates - order never affects their numbers, and
--       syncStatements never touches trips, so a stored order survives every
--       re-sync. No index: reads already run through idx_trips_driver_date
--       and the intra-day sort only ever spans one driver's day.
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded self-registration.

BEGIN;

ALTER TABLE pay.trips
  ADD COLUMN IF NOT EXISTS sort_order int;

COMMENT ON COLUMN pay.trips.sort_order IS
  'Manual intra-day order from the payroll sheet drag handle; NULL = auto chain order. Reset to NULL when trip_date changes.';

INSERT INTO common._migrations (name)
SELECT '0034_trips_sort_order'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0034_trips_sort_order'
);

COMMIT;
