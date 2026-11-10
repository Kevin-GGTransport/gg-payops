-- G&G PayOps
-- 0004: 对齐真实 Excel 工资单（10_17-10_23.xlsx）的录入模型
-- 1) 趟次条目增加 车主金额（Driver / Owner 双金额列）
-- 2) 柜号（原 Load#）取消全局唯一：同一柜号当日往返属正常业务
-- 3) 新增 工资单调整项（补助 / DETENTION / 燃油补助 / 扣保险 …）

BEGIN;

ALTER TABLE pay.entries
  ADD COLUMN IF NOT EXISTS owner_amount numeric(12,2) NOT NULL DEFAULT 0
  CHECK (owner_amount >= 0);

DROP INDEX IF EXISTS uq_entries_load_no;
ALTER TABLE pay.entries
  DROP CONSTRAINT IF EXISTS uq_entries_load_no;

COMMENT ON COLUMN pay.entries.load_no IS '柜号（container/trailer），同一柜号当日往返可出现多行';
COMMENT ON COLUMN pay.entries.pay_amount IS '司机金额（Driver 列）';
COMMENT ON COLUMN pay.entries.owner_amount IS '车主金额（Owner 列）';

CREATE TABLE IF NOT EXISTS pay.adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  statement_id uuid NOT NULL REFERENCES pay.statements(id) ON DELETE CASCADE,
  label varchar(60) NOT NULL,
  driver_amount numeric(12,2) NOT NULL DEFAULT 0,
  owner_amount numeric(12,2) NOT NULL DEFAULT 0,
  sort_no integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adjustments_statement
  ON pay.adjustments(statement_id, sort_no);

COMMENT ON TABLE pay.adjustments IS '工资单调整项：补助、DETENTION、燃油补助、扣保险等，金额可正可负（扣款为负）。';

COMMIT;
