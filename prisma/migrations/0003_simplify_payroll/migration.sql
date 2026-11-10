-- G&G PayOps
-- 0003: 精简重构 —— 移除自动计薪机器，改为「工资单 + 趟次条目」手动录入模型
-- 操作固定四种：DEL / EMPTY / BOBTAIL / LIVE
-- Load# 必填且组织内唯一

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 删除旧的计薪结果表（按依赖顺序，触发器随表删除）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
  pay.statement_workflow_logs,
  pay.issues,
  pay.statement_state_mileages,
  pay.trip_state_mileages,
  pay.statement_load_summaries,
  pay.load_allocations,
  pay.trip_leg_loads,
  pay.trip_legs,
  pay.trips,
  pay.calculation_runs,
  pay.pay_statements,
  pay.pay_periods
CASCADE;

DROP FUNCTION IF EXISTS pay.protect_immutable_statement() CASCADE;

-- ---------------------------------------------------------------------------
-- 2. 删除旧的路线 / 参数 / 操作码机器
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
  ops.route_state_splits,
  ops.routes,
  ops.pay_parameter_items,
  ops.pay_parameter_versions,
  ops.operation_codes
CASCADE;

DROP FUNCTION IF EXISTS ops.check_route_state_balance() CASCADE;

-- ---------------------------------------------------------------------------
-- 3. 删除当前未使用的基础设施表
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
  common.notifications,
  common.number_sequences,
  common.dictionaries,
  common.attachments,
  common.audit_logs
CASCADE;

-- ---------------------------------------------------------------------------
-- 4. 清理旧枚举，建立新枚举
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS pay.period_status, pay.calculation_status, pay.issue_severity,
  pay.issue_status, pay.workflow_action, pay.statement_status;
DROP TYPE IF EXISTS ops.pay_target, ops.route_source_type, ops.verification_status,
  ops.parameter_status;

DO $$
BEGIN
  CREATE TYPE ops.operation_type AS ENUM ('DEL', 'EMPTY', 'BOBTAIL', 'LIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE pay.statement_status AS ENUM ('DRAFT', 'SUBMITTED', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5. pay.statements 工资单
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay.statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  statement_no varchar(32) NOT NULL,
  driver_id uuid NOT NULL REFERENCES ops.drivers(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status pay.statement_status NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_statements_org_no UNIQUE (organization_id, statement_no),
  CONSTRAINT uq_statements_driver_period UNIQUE (organization_id, driver_id, period_start),
  CONSTRAINT ck_statement_period CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_statements_org_status
  ON pay.statements(organization_id, status, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_statements_driver
  ON pay.statements(driver_id);

-- ---------------------------------------------------------------------------
-- 6. pay.entries 趟次条目
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay.entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  statement_id uuid NOT NULL REFERENCES pay.statements(id) ON DELETE CASCADE,
  trip_no integer NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  operation ops.operation_type NOT NULL,
  load_no varchar(64) NOT NULL,
  from_location_id uuid REFERENCES ops.locations(id),
  to_location_id uuid REFERENCES ops.locations(id),
  miles numeric(10,2) NOT NULL DEFAULT 0 CHECK (miles >= 0),
  pay_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (pay_amount >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entries_statement_trip UNIQUE (statement_id, trip_no),
  CONSTRAINT uq_entries_load_no UNIQUE (organization_id, load_no)
);

CREATE INDEX IF NOT EXISTS idx_entries_statement
  ON pay.entries(statement_id, trip_no);
CREATE INDEX IF NOT EXISTS idx_entries_org_date
  ON pay.entries(organization_id, entry_date DESC);

COMMENT ON TABLE pay.statements IS '司机/车主工资单：一个司机一个结算周期一张单。';
COMMENT ON TABLE pay.entries IS '工资单趟次条目：operation 为 DEL/EMPTY/BOBTAIL/LIVE，load_no 必填且组织内唯一。';

COMMIT;
