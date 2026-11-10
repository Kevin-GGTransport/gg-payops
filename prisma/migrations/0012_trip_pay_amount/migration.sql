-- G&G PayOps
-- 0012: per-trip wage column (pay_amount), captured at entry time.
--       Auto-derived client-side (endpoint standard pay, or mileage tier when
--       neither end is BASE) x owner(x2) x bobtail(x0.5); manual override
--       allowed; legacy rows stay 0.

BEGIN;

ALTER TABLE pay.trips ADD COLUMN IF NOT EXISTS pay_amount numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN pay.trips.pay_amount IS
  'Wage for this leg ($): base (endpoint standard pay, or mileage tier when neither end is BASE) x owner(x2) x bobtail(x0.5); manual override allowed; 0 = legacy row';

COMMIT;
