-- G&G PayOps
-- 0010: drivers.id becomes bigint identity (1,2,3...); drop drivers.organization_id

BEGIN;

-- Release FKs referencing drivers.id
ALTER TABLE pay.trips DROP CONSTRAINT trips_driver_id_fkey;
ALTER TABLE ops.driver_truck_assignments DROP CONSTRAINT driver_truck_assignments_driver_id_fkey;
ALTER TABLE ops.drivers DROP CONSTRAINT drivers_organization_id_fkey;

-- Drop org-scoped indexes/constraints
ALTER TABLE ops.drivers DROP CONSTRAINT uq_drivers_org_code;
DROP INDEX IF EXISTS ops.idx_drivers_org_status;
DROP INDEX IF EXISTS ops.idx_drivers_org_type;

-- Rebuild id as bigint identity, drop organization_id
DELETE FROM ops.drivers;
ALTER TABLE ops.drivers DROP CONSTRAINT drivers_pkey;
ALTER TABLE ops.drivers DROP COLUMN id;
ALTER TABLE ops.drivers DROP COLUMN organization_id;
ALTER TABLE ops.drivers ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;

-- Constraints without org scoping
ALTER TABLE ops.drivers ADD CONSTRAINT uq_drivers_code UNIQUE (driver_code);
CREATE INDEX idx_drivers_type_status ON ops.drivers (driver_type, status);

-- FK columns follow the new id type (tables are empty; cast is never evaluated)
ALTER TABLE ops.driver_truck_assignments ALTER COLUMN driver_id TYPE bigint USING driver_id::text::bigint;
ALTER TABLE pay.trips ALTER COLUMN driver_id TYPE bigint USING driver_id::text::bigint;
ALTER TABLE ops.driver_truck_assignments
  ADD CONSTRAINT driver_truck_assignments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES ops.drivers(id);
ALTER TABLE pay.trips
  ADD CONSTRAINT trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES ops.drivers(id);

COMMIT;
