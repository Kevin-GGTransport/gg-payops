-- G&G PayOps
-- 0022: per-driver per-period payroll statements with a status flow.
--       pay.statement_status is rebuilt (old DRAFT/SUBMITTED/PAID from the
--       0003/0004 era had no table using it): DRAFT -> REVIEWED -> VERIFIED
--       -> DONE. Statements snapshot the period aggregates at generation
--       time so later trip edits never silently move reviewed numbers.
-- Idempotent-ish: guarded by the _migrations registration done alongside.

BEGIN;

DROP TYPE IF EXISTS pay.statement_status;

CREATE TYPE pay.statement_status AS ENUM ('DRAFT', 'REVIEWED', 'VERIFIED', 'DONE');

CREATE TABLE pay.payroll_statements (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id     bigint NOT NULL REFERENCES ops.drivers(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        pay.statement_status NOT NULL DEFAULT 'DRAFT',
  -- Snapshot of the period aggregates, frozen at generation time
  trip_days     integer NOT NULL,
  leg_count     integer NOT NULL,
  total_miles   numeric(10, 2) NOT NULL,
  total_fuel    numeric(10, 2) NOT NULL,
  total_pay     numeric(12, 2) NOT NULL,
  op_counts     jsonb NOT NULL DEFAULT '{}',
  trucks        text NOT NULL DEFAULT '',
  note          text,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_statements_driver_period UNIQUE (driver_id, period_start),
  CONSTRAINT ck_statements_period_week CHECK (period_end = period_start + 6)
);

COMMENT ON TABLE pay.payroll_statements IS 'Per-driver per-period payroll statement (frozen snapshot + status flow)';

CREATE INDEX idx_statements_period ON pay.payroll_statements (period_start DESC);

CREATE INDEX idx_statements_status ON pay.payroll_statements (status);

COMMIT;
