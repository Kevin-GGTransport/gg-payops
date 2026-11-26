-- G&G PayOps
-- 0035: trips gain a pay-settlement period override. settle_date NULL =
--       follow trip_date (the previous behavior, all legacy rows); non-NULL =
--       the leg's money lands in periodOf(settle_date) instead of its real
--       business date. Set by the "claim unsettled legs into this period"
--       flow: a leg entered after its own period's statement was
--       driver-confirmed (DONE) has its wage in no sheet; claiming it into
--       the open settlement period stores that period's start (Saturday)
--       here. Always normalized so it never equals the leg's own trip_date
--       period. Every money/aggregation query switches to
--       COALESCE(t.settle_date, t.trip_date); pure trip-management views
--       (trips list, entry rows, day reorder) keep trip_date.
--       No index: the fleet's weekly volume is small and scans already run
--       through idx_trips_driver_date.
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded self-registration.

BEGIN;

ALTER TABLE pay.trips
  ADD COLUMN IF NOT EXISTS settle_date date;

COMMENT ON COLUMN pay.trips.settle_date IS
  'Pay-settlement period override: money lands in periodOf(settle_date) instead of periodOf(trip_date). NULL = follow trip_date. Stored as a period start (Saturday).';

INSERT INTO common._migrations (name)
SELECT '0035_trip_settle_date'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0035_trip_settle_date'
);

COMMIT;
