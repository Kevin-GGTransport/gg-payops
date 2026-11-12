# 车辆管理（Vehicle Management）设计

日期：2026-11-12 · 状态：已获用户批准

## 背景

车辆此前没有独立档案（车号借用司机档案的 `driver_code` 展示）。库中已有建库遗留的空表
`ops.trucks`（车号/车牌/车型/载重说明/状态/备注）与 `ops.driver_truck_assignments`。

定位澄清（用户确认）：

- `ops.driver_truck_assignments` = **车辆驾驶记录表**（哪位司机哪个时段开哪辆车），
  本期不动，留给后续驾驶记录功能。
- 车辆**归属**有两种：**车主**（司机档案中车主型司机）或**公司自有**；变更需留历史。
- **表显里程** = 手动录入的读数历史（每次一条），档案展示最新读数 + 读取日期。

## 数据层

手写迁移 `prisma/migrations/0014_trucks_ownership_odometer/migration.sql`，
经 `db-migrate.sh` 应用并登记 `common._migrations`。

```sql
CREATE TABLE ops.truck_ownerships (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  truck_id        bigint NOT NULL REFERENCES ops.trucks(id),
  owner_driver_id bigint REFERENCES ops.drivers(id),  -- NULL = 公司自有
  valid_from      date NOT NULL,
  valid_to        date,                               -- NULL = 当前生效
  note            varchar(255),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_truck_ownership_period
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- 每辆车最多一条未结束归属
CREATE UNIQUE INDEX uq_truck_ownership_open
  ON ops.truck_ownerships(truck_id) WHERE valid_to IS NULL;
CREATE INDEX idx_truck_ownerships_truck
  ON ops.truck_ownerships(truck_id, valid_from DESC);

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
```

- 当前归属 = 该车 `valid_to IS NULL` 的行（`owner_driver_id` 为 NULL 即公司自有）。
- 换归属：旧行 `valid_to` = 新行 `valid_from` 前一天；新行 `valid_from` = 当天
  （业务时区 America/Los_Angeles 的 `todayIso()`）。归属未变不写历史。
- 读数只增不改，录错可删重录；表显里程 = 最新一条读数。
- `prisma/schema.prisma` 同步补 Truck / TruckOwnership / TruckOdometerReading 模型
  （仅镜像 DDL；查询照旧 raw SQL）。

## 页面 `/dashboard/trucks`（主导航「车辆管理」，司机管理之后）

镜像司机管理（表格 + Modal + server action + `?error=` 中文错误回显）：

- 顶部 tabs：全部 | 公司自有 | 车主（带计数）；搜索：车号/车牌/车型/车主姓名。
- 表格列：车号 | 车牌号 | 车型 | 归属（公司自有 / 车主姓名）| 表显里程（读数 + 日期）
  | 状态 | 操作（编辑 · 里程 · 停用/启用）。

### 新增/编辑 Modal

- 档案：车号（必填唯一）、车牌号、车型、载重说明、备注。
- 归属：双选卡「公司自有 / 车主」；选车主时出现 Combobox（选项 = 启用的车主型司机）。
- 编辑时显示只读归属历史（起止 + 归属）。

### 里程 Modal（操作列「里程」）

- 读数历史倒序：读取日期 | 表显里程 | 备注 | 删除。
- 新增读数：日期（默认今天）、读数（必填 ≥0）、备注（选填）。

## Server actions（`src/app/dashboard/trucks/actions.ts`）

- `saveTruck`：missing_code / dup_code（编辑排除自身）/ owner_invalid；
  事务内建档 + 归属变更判定与写入。
- `setTruckStatus`：停用/启用。
- `addOdometerReading`：bad_date / bad_odometer。
- `deleteOdometerReading`。

## 错误码（中文）

missing_code 请填写车号；dup_code 这个车号已存在；owner_invalid 所选车主无效；
bad_date 日期无效；bad_odometer 表显里程必须是不小于 0 的数字。

## 验证

迁移应用 → type-check/lint → Playwright：登记公司车与车主车各一辆、记两次里程看
最新读数、换归属看历史（旧行收口、新行当天生效）、停用。测试数据清理。
