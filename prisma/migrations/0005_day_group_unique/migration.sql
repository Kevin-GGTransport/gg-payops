-- G&G PayOps
-- 0005: 趟次 = 日期组。一天多段共享同一 trip_no，取消 (statement_id, trip_no) 唯一约束
--      （重复录入由应用层软校验拦截）

BEGIN;

ALTER TABLE pay.entries DROP CONSTRAINT IF EXISTS uq_entries_statement_trip;

COMMENT ON COLUMN pay.entries.trip_no IS '趟次序号（按日期分组，同一天的所有段共享）';

COMMIT;
