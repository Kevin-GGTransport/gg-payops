-- G&G PayOps
-- 0028: payroll statements switch to auto-draft + verify-freeze.
--   Statuses collapse to DRAFT / VERIFIED (REVIEWED -> DRAFT, DONE ->
--   VERIFIED); the enum keeps its legacy values but the app never uses them.
--   DRAFT numbers always track the live trips (recomputed on every trip
--   mutation); VERIFIED freezes them at verify time. Any trip change under a
--   VERIFIED statement sets edited_after_verify - a permanent audit flag
--   that is never cleared (the sheet just turns red).
--   Backfill: every (driver, period) group of trips without a statement gets
--   a DRAFT one, so "entry = generation" holds for history too.
-- Idempotent-ish: guarded by the _migrations registration at the end.

BEGIN;

ALTER TABLE pay.payroll_statements
  ADD COLUMN IF NOT EXISTS edited_after_verify boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN pay.payroll_statements.edited_after_verify IS
  'Permanent flag: a trip under this VERIFIED statement changed after verification. Never cleared - the numbers stay frozen, the sheet turns red.';
COMMENT ON COLUMN pay.payroll_statements.status IS
  'DRAFT = live numbers recomputed on every trip change; VERIFIED = frozen at verify time. REVIEWED/DONE are legacy enum values, no longer used.';

UPDATE pay.payroll_statements SET status = 'DRAFT'   WHERE status = 'REVIEWED';
UPDATE pay.payroll_statements SET status = 'VERIFIED' WHERE status = 'DONE';

-- Backfill DRAFT statements for every trip group that never got one.
-- Period start = the Saturday on or before trip_date (Sat ~ Fri period).
WITH period_trips AS (
  SELECT driver_id,
         (trip_date - ((extract(dow from trip_date) + 1) % 7) * interval '1 day')::date AS period_start,
         trip_date, miles, fuel_gallons, pay_amount, fuel_subsidy,
         operation, truck_snapshot->>'truck_code' AS truck_code
  FROM pay.trips
),
per_driver_period AS (
  SELECT driver_id, period_start,
         count(DISTINCT trip_date)::int AS trip_days,
         count(*)::int AS leg_count,
         COALESCE(SUM(miles), 0) AS total_miles,
         COALESCE(SUM(fuel_gallons), 0) AS total_fuel,
         COALESCE(SUM(pay_amount), 0) AS total_pay,
         COALESCE(SUM(fuel_subsidy), 0) AS total_fuel_subsidy,
         COALESCE(string_agg(DISTINCT truck_code, ', ' ORDER BY truck_code), '') AS trucks
  FROM period_trips
  GROUP BY driver_id, period_start
),
op_counts AS (
  SELECT driver_id, period_start, jsonb_object_agg(operation, cnt) AS op_counts
  FROM (
    SELECT driver_id, period_start, operation, count(*)::int AS cnt
    FROM period_trips
    GROUP BY driver_id, period_start, operation
  ) x
  GROUP BY driver_id, period_start
)
INSERT INTO pay.payroll_statements(
  driver_id, period_start, period_end,
  trip_days, leg_count, total_miles, total_fuel, total_pay, total_fuel_subsidy,
  op_counts, trucks
)
SELECT p.driver_id, p.period_start, p.period_start + 6,
       p.trip_days, p.leg_count, p.total_miles, p.total_fuel, p.total_pay,
       p.total_fuel_subsidy, o.op_counts, p.trucks
FROM per_driver_period p
JOIN op_counts o USING (driver_id, period_start)
ON CONFLICT (driver_id, period_start) DO NOTHING;

INSERT INTO common._migrations (name)
SELECT '0028_statement_auto_draft_verify'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0028_statement_auto_draft_verify'
);

COMMIT;
