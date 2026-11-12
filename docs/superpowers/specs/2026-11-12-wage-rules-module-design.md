# 工资计算规则管理（Wage Rules）设计

日期：2026-11-12 · 状态：已获用户批准

## 背景

司机工资的里程分档费率目前硬编码在 `src/lib/wage.ts:21-28`（$50/$80/$120，
150mi 后每 50mi +$30），车主 ×2 与 BOBTAIL ×0.5 乘数同样写死。调价需要改代码发版。
纸质规则《司机工资明细算法 - CA Local V1.02406》（生效 2026-06-01）已给出完整费率表。

定位澄清（用户确认）：

- **一期只做核心计算规则**：里程分档 + 车主乘数 + BOBTAIL 乘数 + 特例路线对。
  奖励/补助（RENO、出勤 Bonus、Driver Assist、车主燃油补助）缺数据来源，留二期。
- **带生效日期版本化**：每版规则有 `effective_from`，按行程日期取当时有效版，
  与 PDF 的「生效日期」语义对齐；已生效版本锁定只读，改价 = 发新版。
- **档位 + 递增 + 乘数**建模：档位表只存司机价；车主价由「车主乘数」导出
  （PDF 明说「车主是司机两倍」）；「150mi 后每超 50mi +$30」存为递增额字段，
  不显式建 250+ 的高档位行。

计价链（与现有语义一致，用户确认）：

```
1. 位置代码匹配：起/终点为 BASE 时取对端 standard_pay_amount
   —— 继续放「位置管理」页维护（已可改），不进版本化
2. 只有 zipcode 的腿（自由输入/无标准价）：
   特例邮编对（如 94545↔99301 单程 $550，随版本可配）
     ↓ 不匹配
   里程档位（档位表 + 超档递增额）
     ↓
   × 车主乘数（OWNER 司机） × BOBTAIL 乘数（BOBTAIL 操作）
```

- `pay_amount` 是录入时快照，服务端不重算；规则改动**不追溯**已录入行程。
- 特例点对价**默认乘车主乘数**（PDF 未写明，按其他规则惯例；可在版本内调整乘数实现不乘）。

## 数据层

手写迁移 `prisma/migrations/0017_wage_rules/migration.sql`，
经 `db-migrate.sh` 应用并登记 `common._migrations`（勿用 `prisma migrate dev`）。

```sql
CREATE TABLE pay.wage_rule_versions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                varchar(120) NOT NULL,
  effective_from      date NOT NULL,
  owner_multiplier    numeric(5,2) NOT NULL DEFAULT 2.00,
  bobtail_multiplier  numeric(5,2) NOT NULL DEFAULT 0.50,
  overage_increment   numeric(12,2) NOT NULL DEFAULT 30.00,  -- 超最高档后每 50mi 递增
  status              varchar(16) NOT NULL DEFAULT 'ACTIVE',
  notes               varchar(255),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wage_rule_effective UNIQUE (effective_from)
);

CREATE TABLE pay.wage_rule_tiers (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id   bigint NOT NULL REFERENCES pay.wage_rule_versions(id) ON DELETE CASCADE,
  miles_from   int NOT NULL CHECK (miles_from >= 1),
  amount       numeric(12,2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT uq_wage_tier_version_miles UNIQUE (version_id, miles_from)
);

CREATE TABLE pay.wage_rule_special_routes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id      bigint NOT NULL REFERENCES pay.wage_rule_versions(id) ON DELETE CASCADE,
  from_postal     varchar(10) NOT NULL,
  to_postal       varchar(10) NOT NULL,
  one_way_amount  numeric(12,2) NOT NULL CHECK (one_way_amount >= 0),
  note            varchar(255)
);
CREATE INDEX idx_wage_special_routes_version ON pay.wage_rule_special_routes(version_id);
```

初始数据（`NOT EXISTS` 防重跑，按 PDF 导入）：

- 版本「CA Local 2026-06 版」，`effective_from = 2026-06-01`，×2 / ×0.5 / 递增 $30
- 档位：1→$50、50→$80、100→$120、150→$150、200→$180、250→$210
- 特例：94545 ↔ 99301 单程 $550（备注：华盛顿线，来回 $1100 = 2×550；
  中间提卸货按实际迈数算 = 该腿不匹配直达对即自然落回里程档）

`prisma/schema.prisma` 同步补 WageRuleVersion / WageRuleTier / WageRuleSpecialRoute
模型（仅镜像 DDL；读写照旧 raw SQL，bigint id `::bigint` cast 传参）。

## 计算层（`src/lib/wage.ts` 改造）

纯函数、零依赖风格保持：

- `mileageTierWage(miles, tiers, overageIncrement)`——档位与递增额从参数进；
  miles 落档取该档价（`floor(miles/50)` 落到 `miles_from` 最接近且不超过的档）；
  超出最高档 = 最高档价 + 递增额 × `floor(miles/50) − floor(最高档miles_from/50)`
  （例：最高档 250→$210、递增 $30 时，299mi=$210、300mi=$240、350mi=$270）；
  删除硬编码。
- `resolveBaseWage` 不动（BASE 端点 → 对端 `standard_pay_amount` 原逻辑）。
- 新增 `resolveSpecialRoute(fromPostal, toPostal, specialRoutes)`：邮编双向匹配，
  命中返回单程固定价。
- `calcTripWage(input, rule)` 加规则参数；命中顺序与第 1 节计价链一致：
  BASE 端点（位置代码匹配）→ 特例邮编对（仅两端均非 BASE 的腿可命中）→ 里程档；
  之后乘车主/BOBTAIL 乘数，`roundCents` 收尾。
- 新增 `pickVersion(versions, tripDate)`：`effective_from <= tripDate` 的最大日期版
  （ACTIVE）；无可用版本返回 null（调用方兜底 $0 并提示）。
- **金额精度**：金额一律 `numeric(12,2)`、乘数 `numeric(5,2)`；每步计算
  `roundCents` 到两位小数；界面展示统一两位小数（档位价 $50.00、乘数 ×2.00、
  递增额 $30.00、录入表 autoPay 与特例价同样两位小数）。

## 查询与动作

`src/lib/queries/wage-rules.ts`：

- `activeWageRuleVersions()`：生效中 + 未来已排版本（录入表用）。
- `wageRuleVersionsList()`：管理页时间线（新→旧，含档位数/特例数摘要）。
- `wageRuleVersionDetail(id)`：版本详情含全部档位与特例行。

`src/app/dashboard/wage-rules/actions.ts`（照 drivers 模式：先查后插 +
23505 兜底、`revalidatePath` 三连、`?error=` 中文错误码）：

- `createVersion(sourceId, ...)`：复制源版全部值（档位/乘数/递增额/特例），
  生效日期默认明天（业务时区 `todayIso()` + 1）。
- `updateVersion(id, payload)`：**仅允许 `effective_from > 今天` 的版本**；
  整版本一次性保存（档位/特例随版本整体提交，避免半编辑状态）。
- `deleteVersion(id)`：同样仅未生效版本。

版本锁定规则：`effective_from <= 今天`（业务时区）的版本一律只读——今天的行程
正在按这版算，改动会造成同日不一致。配错当天版本只能发次日新版。

## 页面 `/dashboard/wage-rules`（主导航「工资规则」，第 6 项）

套用 drivers/trucks 成熟模式（PageHeader + LedgerPanel + ModalShell + Server Actions）：

- **版本时间线**（LedgerPanel，新→旧）：每行 = 版本名、生效日期、
  状态徽章（已生效/待生效）、摘要（N 档 $min~$max · 车主×N · 递增$N · 特例 N 条）。
- **版本详情**：
  - 已生效版本：全只读钢印展示——档位表、乘数、递增额、特例点对。
  - 待生效版本：可编辑表单（档位增删改金额、乘数、递增额、特例增删），整体保存。
- **「基于此版创建新版本」**按钮 → ModalShell：预填复制值 + 生效日期（默认明天）。
- 校验（Server Action 端，中文错误）：至少 1 档；档位 `miles_from` ≥1 且按 50 步长
  递进无缝（1, 50, 100, …）；首档必须从 1 开始（ zipcode 腿任何里程都有档可落）；
  乘数 > 0；金额 ≥ 0；邮编 5 位数字；生效日期唯一。

## 录入表联动（`trip-entry-form.tsx` + `dashboard/page.tsx`）

- 服务端并行取 `activeWageRuleVersions()` 传入表单 props。
- `autoPay` useMemo：按**每行行程日期** `pickVersion` → `calcTripWage(rule)`；
  日期改到新版生效日之后自动用新值。无可用版本（如日期早于首版）→ $0 并提示。
- 手改工资 sticky、「重算」恢复规则价的现有逻辑不变。
- `entry-actions.ts` 不动：继续信任提交金额快照落库。

## 范围外（一期明确不做）

- 奖励/补助项（RENO、出勤 Bonus、Driver Assist、车主燃油补助）——缺数据来源
- 湾区/LA 区域维度（drivers 无区域字段，且 PDF 两列数值当前相同）
- 位置标准价（`standard_pay_amount`）版本化——留在位置管理
- 历史行程按新版重算（快照哲学：不追溯）

## 验证

项目无测试框架，验证 = `pnpm type-check` + `pnpm lint` + verify 端到端：

1. 迁移本地应用：初始版本只读展示正确（6 档、×2、×0.5、$30、特例 94545↔99301）。
2. 手算矩阵对照 autoPay：各档边界 49/50/99/100/149/150、超档递增 299/300/349/350、
   特例命中与不命中、BASE 端点优先、OWNER/BOBTAIL 乘数组合。
3. 创建未来版本（改某档价）→ 录入表行日期拨到生效日 → autoPay 变新值；
   拨回生效日前 → 恢复旧值；已生效版本不可编辑。
4. 录入 → 行程与工资页核算矩阵金额与录入一致（快照未被破坏）。
