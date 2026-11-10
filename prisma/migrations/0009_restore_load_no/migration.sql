-- G&G PayOps
-- 0009: restore load_no as a required field on trip entry (reverts 0007's drop)

BEGIN;

ALTER TABLE pay.trips ADD COLUMN load_no varchar(64) NOT NULL DEFAULT '';

ALTER TABLE pay.trips ALTER COLUMN load_no DROP DEFAULT;

COMMENT ON COLUMN pay.trips.load_no IS 'Load number (container/trailer); multiple legs per load are normal';

COMMIT;
