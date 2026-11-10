-- G&G PayOps
-- 0002: driver type (人员类型：司机 DRIVER / 车主 OWNER)

BEGIN;

DO $$
BEGIN
  CREATE TYPE ops.driver_type AS ENUM ('DRIVER', 'OWNER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ops.drivers
  ADD COLUMN IF NOT EXISTS driver_type ops.driver_type NOT NULL DEFAULT 'DRIVER';

CREATE INDEX IF NOT EXISTS idx_drivers_org_type
  ON ops.drivers(organization_id, driver_type, status);

COMMENT ON COLUMN ops.drivers.driver_type IS
  '人员类型：DRIVER=司机（驾驶公司车辆），OWNER=车主（自带车辆承运）';

COMMIT;
