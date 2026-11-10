-- G&G PayOps
-- 0006: 第一阶段只做「行程录入」
-- 1) 移除手动金额的工资单模型（statements/entries/adjustments）
-- 2) 新建 pay.trips：纯行程数据（日期/柜号/操作/起终点/里程），金额由下一阶段的核算引擎自动计算
-- 3) 核算周期 = 周六 ~ 下周五，由 trip_date 自动推导，不单独建表

BEGIN;

DROP TABLE IF EXISTS pay.adjustments, pay.entries, pay.statements CASCADE;

CREATE TABLE IF NOT EXISTS pay.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  driver_id uuid NOT NULL REFERENCES ops.drivers(id),
  trip_date date NOT NULL DEFAULT CURRENT_DATE,
  load_no varchar(64) NOT NULL,
  operation ops.operation_type NOT NULL,
  from_location_id uuid REFERENCES ops.locations(id),
  to_location_id uuid REFERENCES ops.locations(id),
  miles numeric(10,2) NOT NULL DEFAULT 0 CHECK (miles >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_driver_date
  ON pay.trips(driver_id, trip_date DESC);
CREATE INDEX IF NOT EXISTS idx_trips_org_date
  ON pay.trips(organization_id, trip_date DESC);

COMMENT ON TABLE pay.trips IS '行程记录：只录入柜号/操作/起终点/里程；周六~周五为一个核算周期，工资计算在下一阶段自动进行。';
COMMENT ON COLUMN pay.trips.load_no IS '柜号（container/trailer），同一柜号往返多行属正常';

COMMIT;
