-- G&G PayOps
-- 0036: backfill confirmation snapshots for legacy DONE statements (rows
--       confirmed before 0031 introduced verify_snapshot, 2026-11-20).
--       Without a snapshot the unsettled-leg detection cannot tell which
--       legs were part of the confirmed set, so late entries into those
--       frozen periods are invisible to the claim panel (e.g. 11/07-period
--       rows confirmed 11/18, then five legs entered 11/25 - $330 hanging).
--       Reconstruction rule: the confirmed set is the first leg_count legs
--       by entry order (created_at, id) - ids are a monotonic entry counter
--       and the boundary has been verified against the live data. Legs
--       beyond leg_count stay outside the snapshot and surface as
--       unsettled. Statements where live legs were deleted post-confirm
--       simply get a smaller snapshot (the diff then reports the deletions,
--       which is the truth). Money columns (leg_count, totals) are never
--       touched - only the missing jsonb payload is derived.
--       The projection mirrors confirmDriverStatement verbatim so the
--       cell-level diff treats backfilled rows like fresh confirmations.
-- Idempotent: the WHERE clause is a no-op on re-run + guarded
-- self-registration.

BEGIN;

UPDATE pay.payroll_statements s
SET verify_snapshot = (
  SELECT jsonb_build_object(
    'legs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', c.id::text,
          'trip_date', to_char(c.trip_date, 'YYYY-MM-DD'),
          'operation', c.operation,
          'load_no', c.load_no,
          'from_code', f.code,
          'to_code', o.code,
          'miles', to_char(c.miles, 'FM999999990.00'),
          'fuel_gallons', to_char(c.fuel_gallons, 'FM999999990.000'),
          'pay_amount', to_char(c.pay_amount, 'FM999999990.00'),
          'notes', c.notes
        ) ORDER BY c.trip_date, c.sort_order NULLS LAST, c.id)
      FROM (
        SELECT t.* FROM pay.trips t
        WHERE t.driver_id = s.driver_id
          AND COALESCE(t.settle_date, t.trip_date) >= s.period_start
          AND COALESCE(t.settle_date, t.trip_date) <= s.period_end
        ORDER BY t.created_at, t.id
        LIMIT s.leg_count
      ) c
      LEFT JOIN ops.locations f ON f.id = c.from_location_id
      LEFT JOIN ops.locations o ON o.id = c.to_location_id
    ), '[]'::jsonb),
    'fuel', s.fuel_detail
  )
), updated_at = now()
WHERE s.status = 'DONE'
  AND s.verify_snapshot IS NULL;

INSERT INTO common._migrations (name)
SELECT '0036_backfill_legacy_verify_snapshots'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0036_backfill_legacy_verify_snapshots'
);

COMMIT;
