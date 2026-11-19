-- G&G PayOps
-- 0030: payroll statements gain the weekly fuel-by-state rollup. One jsonb
--       array per (driver, period): [{truckCode, stateCode, gallons, miles,
--       amount, note}], entered alongside the trips on the entry sheet (one
--       collapsible fuel section per driver group). Fuel joins the statement
--       lifecycle: drafts track the sheet, verify freezes it, post-verify
--       edits set edited_after_verify. syncStatements never touches this
--       column (it is not in its ON CONFLICT SET list).
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded self-registration.

BEGIN;

ALTER TABLE pay.payroll_statements
  ADD COLUMN IF NOT EXISTS fuel_detail jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pay.payroll_statements.fuel_detail IS
  'Weekly fuel-by-state rollup entered with the sheet: [{truckCode, stateCode, gallons, miles, amount, note}]';

INSERT INTO common._migrations (name)
SELECT '0030_statement_fuel_detail'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0030_statement_fuel_detail'
);

COMMIT;
