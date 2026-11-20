-- G&G PayOps
-- 0031: payroll statements gain the verification-time snapshot. verifyStatement
--       captures the period's whole leg set (the detail sheet's editable
--       fields) plus the then-current fuel_detail into one jsonb object, so
--       the detail sheet can diff live rows against the frozen moment and
--       mark exactly WHICH cells changed after verification. NULL = legacy
--       verified rows from before this column: those fall back to the
--       statement-level red banner only. Drafts never carry a snapshot;
--       syncStatements never touches this column (not in its ON CONFLICT
--       SET list), so the frozen moment survives every later recompute.
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded self-registration.

BEGIN;

ALTER TABLE pay.payroll_statements
  ADD COLUMN IF NOT EXISTS verify_snapshot jsonb;

COMMENT ON COLUMN pay.payroll_statements.verify_snapshot IS
  'Frozen at verification: {legs: [{id, trip_date, operation, load_no, from_code, to_code, miles, fuel_gallons, pay_amount, notes}], fuel: [...]} for cell-level post-verify diffing; NULL on legacy rows';

INSERT INTO common._migrations (name)
SELECT '0031_statement_verify_snapshot'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0031_statement_verify_snapshot'
);

COMMIT;
