-- 车辆归属历史：owner_driver_id 为 NULL 表示公司自有；
-- 每辆车最多一条未结束记录（valid_to IS NULL），即当前归属。
CREATE TABLE ops.truck_ownerships (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  truck_id        bigint NOT NULL REFERENCES ops.trucks(id),
  owner_driver_id bigint REFERENCES ops.drivers(id),
  valid_from      date NOT NULL,
  valid_to        date,
  note            varchar(255),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_truck_ownership_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX uq_truck_ownership_open
  ON ops.truck_ownerships(truck_id) WHERE valid_to IS NULL;
CREATE INDEX idx_truck_ownerships_truck
  ON ops.truck_ownerships(truck_id, valid_from DESC);

-- 表显里程读数：手动录入、只增不改（录错删除重录）；最新一条即车辆表显里程。
CREATE TABLE ops.truck_odometer_readings (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  truck_id     bigint NOT NULL REFERENCES ops.trucks(id),
  reading_date date NOT NULL,
  odometer     numeric(10,1) NOT NULL CHECK (odometer >= 0),
  note         varchar(255),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_truck_odometer_truck_date
  ON ops.truck_odometer_readings(truck_id, reading_date DESC);
