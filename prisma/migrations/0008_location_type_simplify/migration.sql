-- G&G PayOps
-- 0008: 位置类型收敛 —— BASE(基地) / AMAZON(亚马逊仓) / OTHER(其他)

BEGIN;

-- Postgres 无法删除枚举值，重建类型；存量数据在 USING 里归并：
-- 仓库→亚马逊仓，邮编点/客户→其他
ALTER TYPE ops.location_type RENAME TO location_type_old;
CREATE TYPE ops.location_type AS ENUM ('BASE', 'AMAZON', 'OTHER');

-- 旧默认值 'WAREHOUSE' 无法自动转换，先移除
ALTER TABLE ops.locations ALTER COLUMN location_type DROP DEFAULT;

ALTER TABLE ops.locations
  ALTER COLUMN location_type TYPE ops.location_type
  USING CASE location_type::text
    WHEN 'WAREHOUSE' THEN 'AMAZON'
    WHEN 'ZIP' THEN 'OTHER'
    WHEN 'CUSTOMER' THEN 'OTHER'
    ELSE location_type::text
  END::ops.location_type,
  ALTER COLUMN location_type SET DEFAULT 'AMAZON';

DROP TYPE ops.location_type_old;

COMMENT ON COLUMN ops.locations.location_type IS
  '位置类型：BASE=基地，AMAZON=亚马逊仓，OTHER=其他';

COMMIT;
