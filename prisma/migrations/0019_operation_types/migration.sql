-- G&G PayOps
-- 0019: operation types become a managed dictionary (add / edit / deactivate
--       via the dashboard). Replaces the hard-coded DEL/EMPTY/BOBTAIL/LIVE enum:
--       - new table ops.operation_types (bigint identity, per house convention)
--       - LIVE is dropped (no rows reference it anywhere), PICK UP (code PU)
--         takes its place
--       - pay.trips.operation converts from the ops.operation_type enum to
--         varchar with an FK, so deleting a referenced code is impossible
--       - is_system guards EMPTY / BOBTAIL whose behavior is wired into the
--         app (Load# lock, bobtail wage multiplier)
-- Idempotent-ish: guarded by the _migrations registration done alongside.

BEGIN;

CREATE TABLE ops.operation_types (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         varchar(16)  NOT NULL UNIQUE,
  label        varchar(60)  NOT NULL,
  description  varchar(120),
  sort_order   integer      NOT NULL DEFAULT 100,
  is_system    boolean      NOT NULL DEFAULT false,
  requires_load boolean    NOT NULL DEFAULT false,
  status       common.record_status NOT NULL DEFAULT 'ACTIVE',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ops.operation_types IS 'Managed operation dictionary for trip legs (entry dropdown, filters, badges)';

INSERT INTO ops.operation_types (code, label, description, sort_order, is_system, requires_load) VALUES
  ('DEL',     'DEL',     '卸货 / 送柜',       10, false, true),
  ('PU',      'PICK UP', '提货 / 提柜',       20, false, true),
  ('EMPTY',   'EMPTY',   '带空柜行驶',       30, true,  false),
  ('BOBTAIL', 'BOBTAIL', '车头单独行驶',     40, true,  false);

ALTER TABLE pay.trips
  ALTER COLUMN operation TYPE varchar(16) USING operation::text;

ALTER TABLE pay.trips
  ADD CONSTRAINT trips_operation_fkey FOREIGN KEY (operation)
  REFERENCES ops.operation_types (code);

DROP TYPE ops.operation_type;

COMMIT;
