-- 行程快照：提交时刻固化司机姓名与车辆全字段，档案后续变更不影响历史行程。
-- driver_id 保留（工资聚合/筛选用）；车辆不建外键，纯快照。
ALTER TABLE pay.trips
  ADD COLUMN driver_name varchar(120),
  ADD COLUMN truck_snapshot jsonb;
