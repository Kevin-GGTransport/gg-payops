-- G&G PayOps
-- 0032: payroll statements gain per-period custom fees: user-defined
--       amounts ADDED to the payout (reimbursements, allowances...) stored as
--       one jsonb array [{label, miles, amount, note}] plus an aggregate
--       column so lists/exports read it without jsonb parsing (miles is
--       informational only). Same lifecycle as fuel_detail: entered with the
--       sheet or fixed on the detail editor, post-verify edits set
--       edited_after_verify (no per-row red marks - fees are outside the
--       verification snapshot). syncStatements never touches either column.
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded self-registration.

BEGIN;

ALTER TABLE pay.payroll_statements
  ADD COLUMN IF NOT EXISTS custom_fees jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_custom_fees numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN pay.payroll_statements.custom_fees IS
  'User-defined payout additions: [{label, miles, amount, note?}] entered with the sheet or on the detail editor (miles informational)';
COMMENT ON COLUMN pay.payroll_statements.total_custom_fees IS
  'Sum of custom_fees amounts (all fees add to the payout), written in lockstep with custom_fees';

INSERT INTO common._migrations (name)
SELECT '0032_statement_custom_fees'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0032_statement_custom_fees'
);

COMMIT;
