-- G&G PayOps
-- 0007: 行程就是行程 —— 移除柜号字段；查重由应用层按 同司机+同日+同操作+同起终点 拦截

BEGIN;

ALTER TABLE pay.trips DROP COLUMN IF EXISTS load_no;

COMMENT ON TABLE pay.trips IS '行程记录：日期/操作/起终点/里程。周六~周五核算周期，工资在工资管理页汇总核算。';

COMMIT;
