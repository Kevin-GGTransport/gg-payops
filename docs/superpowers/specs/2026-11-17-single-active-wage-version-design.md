# 设计：工资规则「单一生效版」模式

日期：2026-11-17
状态：已与用户确认方案 A

## 背景与动机

现行版本机制按 `effective_from <= 行程日期` 挑选生效版本：

- 61 条固定价格规则只存在于 2026-11-15 生效的新版，老版本一条规则都没有；
- 录入历史日期的行程时命中老版本，全部落到距离档位计价（当日 bug：HW→SCK8 单程 100 被算成 58mi 档位价 80）；
- 「锁定历史、保存即克隆今日版」机制又让改价路径绕一圈。

业务上只需要：**任一时刻恰有一个计费标准版本生效，手动切换，切换即全量生效**。

## 决策（已确认）

1. **日期彻底解耦**：不论行程日期，一律按当前唯一生效版本计价；切换后新录入/重新编辑的行程按新生效版算（已存金额不回溯）。
2. **直接编辑，删克隆**：生效中的版本可改，保存即生效；删掉整套「锁定历史、自动克隆今日版」机制。
3. **只换不空**：「设为生效」是唯一开关操作，点哪个哪个生效、其余全部自动失效；任何时刻恰有一个生效版，不存在零生效状态（避免录入无规则可用）。

## 方案（A：status 列驱动）

`pay.wage_rule_versions.status` 列已存在（varchar(16) 默认 'ACTIVE'，代码此前只读不写）。语义改为：

- `ACTIVE` = 生效中（至多一版）
- `INACTIVE` = 未生效

单值约束由切换 action 的一个事务保证，不加数据库层约束。弃用指针表（方案 B）与单表无版本（方案 C）。

## 数据模型

- **删** `effective_from` 列及 `uq_wage_rule_effective` 唯一约束（迁移 0026）
- 版本展示日期改用已有 `created_at`
- `status` 成为唯一开关

## 查询层（`src/lib/queries/wage-rules.ts`）

| 现状 | 改为 |
|---|---|
| `activeWageRuleVersions(): WageRuleData[]`（全部 ACTIVE，调用方按日期挑） | `currentWageRule(): Promise<WageRuleData \| null>`（只取 ACTIVE 那版） |
| `wageRuleVersionsList()`（含 effective_from） | 返回全部版本，携带 `status`，日期列改 `created_at` |
| `wageRuleVersionDetail()`（含 effective_from） | 去掉 effective_from |

`src/lib/wage.ts`：删 `pickVersion()`；`WageRuleData` 去掉 `effective_from` 字段。

## 消费方改造

- `dashboard/page.tsx`（录入页）、`trips/page.tsx`、`trips/[driverId]/page.tsx`：改用 `currentWageRule()`，向下游传**单个** `wageRule: WageRuleData | null`
- `trip-entry-form.tsx`：prop `wageRules: WageRuleData[]` → `wageRule: WageRuleData | null`；删除每行按日期 `pickVersion`（约 L420）与打包建议按包日期挑版本（约 L762），直接用传入的单版本
- `trip-edit-dialog.tsx`：同上（约 L191）
- 工资单（statements）不受影响：只汇总已存 `pay_amount`

## 工资规则页交互

- **版本列表**（`wage-rules-table.tsx`）：「生效日期」列 → 「状态」列（生效中/未生效徽章）；未生效行操作列加**「设为生效」**（ConfirmButton，确认文案提示将替换当前生效版）；`today` prop 移除
- **编辑器**（`rules-editor.tsx`）：
  - 表单「生效日期」字段移除；删 `locked`/`today` props 与锁定提示
  - **「添加价格规则」「添加档位」按钮从表格上方移到表格下方**，做成整行浅蓝按钮——与录入行程页「添加行程」同款交互（提交 3d9322b 的既定模式）
- **页面**（`page.tsx`）：默认打开当前 ACTIVE 版本；`canDelete = status !== 'ACTIVE'`；页头按钮「预排未来版本」→「新建版本」（复制当前生效版，仅填名称，创建后为未生效草稿）；保存提示文案改为「已保存；生效中版本的改动即刻计入新录入的行程」
- 错误文案：删 `past_date`/`dup_date`，保留其余校验（乘数、档位、价格规则）

## Server actions（`wage-rules/actions.ts`）

- `saveVersion`：删克隆分支与 `effective_from` 处理，原地写 children；`effectiveDateTaken` 辅助函数删除
- `createVersion`：只收 `source_id` + `name`，复制 params/tiers/prices，新版本 `status='INACTIVE'`
- **新增 `activateVersion`**：单事务 `UPDATE ... SET status='INACTIVE' WHERE status='ACTIVE'` → `UPDATE ... SET status='ACTIVE' WHERE id=$id`；`revalidatePath` wage-rules 与 dashboard
- `deleteVersion`：改为仅 `status <> 'ACTIVE'` 可删，否则 `error=locked`

## 迁移（0026_wage_version_single_active，手写 SQL + psql）

```sql
ALTER TABLE pay.wage_rule_versions DROP CONSTRAINT uq_wage_rule_effective;
ALTER TABLE pay.wage_rule_versions DROP COLUMN effective_from;
UPDATE pay.wage_rule_versions SET status = 'INACTIVE';
UPDATE pay.wage_rule_versions v SET status = 'ACTIVE'
  WHERE EXISTS (SELECT 1 FROM pay.wage_rule_prices p WHERE p.version_id = v.id);
```

按业务条件（含价格规则）定位接任生效的版本，不硬编码 id。本地与线上 Neon 各应用一次，并登记 `common._migrations`。

## 附带修复：「保存规则」无法保存

**根因（已复现）**：`saveVersion` 对 `effective_from < 今天` 的版本先克隆出「今日生效」新版本，但表单里未修改的「生效日期」字段仍提交旧日期，随后校验 `effectiveFrom < today → past_date` 必然拦截——生效日期早于今天的版本**永远无法保存**，且每次失败都会留下一个同名垃圾克隆版本（本地 id=6、线上 id=5 均为复现/用户尝试的产物，已清理）。

**消解方式**：本设计删除整套克隆机制与日期校验，该 bug 随重构消失，无需单独修复。

## 测试与验收

1. `pnpm type-check`、`pnpm lint` 通过
2. verify 流程：登录 → 工资规则页恰一版「生效中」→ 新建复制版 → 改一条价格 → 「设为生效」确认切换（旧版变未生效）→ 录入页录 HW→SCK8 按新版计价；行程编辑弹窗同
3. 版本历史表状态列正确；生效版无删除入口；未生效版可删

## 非目标

- 不做按日期回溯历史版本计价
- 不做生效切换审计日志
- 工资单/已存行程金额不回溯重算
