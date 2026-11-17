-- Owner fuel subsidy: per-mile reimbursement for OWNER drivers, priced by the
-- single ACTIVE wage-rule version's fuel_subsidy_rate and snapshotted onto
-- each trip (same philosophy as pay_amount) then frozen into statements.
BEGIN;

ALTER TABLE pay.wage_rule_versions
  ADD COLUMN fuel_subsidy_rate numeric(6,3) NOT NULL DEFAULT 0.100;
COMMENT ON COLUMN pay.wage_rule_versions.fuel_subsidy_rate IS 'Owner fuel subsidy per mile; 0 disables the subsidy line everywhere';

ALTER TABLE pay.trips
  ADD COLUMN fuel_subsidy numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN pay.trips.fuel_subsidy IS 'Owner fuel subsidy snapshot = miles x rate at entry/edit time; 0 for plain drivers';

ALTER TABLE pay.payroll_statements
  ADD COLUMN total_fuel_subsidy numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN pay.payroll_statements.total_fuel_subsidy IS 'Frozen owner fuel subsidy of the period (trips sum at generation time)';

-- Backfill: every OWNER driver's existing trip earns miles x 0.10 (driver
-- type follows the current roster - trips carry no historical type snapshot)
UPDATE pay.trips t
SET fuel_subsidy = round(t.miles * 0.1, 2)
FROM ops.drivers d
WHERE d.id = t.driver_id AND d.driver_type = 'OWNER';

-- Generated statements get the same treatment off their frozen total_miles
UPDATE pay.payroll_statements s
SET total_fuel_subsidy = round(s.total_miles * 0.1, 2)
FROM ops.drivers d
WHERE d.id = s.driver_id AND d.driver_type = 'OWNER';

COMMIT;
