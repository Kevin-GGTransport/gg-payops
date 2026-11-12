# 工资计算规则管理（Wage Rules）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/lib/wage.ts` 里硬编码的工资规则（里程档位、车主×2、BOBTAIL×0.5）搬进带生效日期的版本化数据库表，提供管理页面，录入表按行日期取版计价。

**Architecture:** 三张新表（`pay.wage_rule_versions` / `_tiers` / `_special_routes`，迁移 0017）；`wage.ts` 改为吃参数的纯函数；新增 `/dashboard/wage-rules` 管理页（时间线 + 版本详情 + 复制发新版）；`pay_amount` 仍是录入时快照，服务端不重算。

**Tech Stack:** Next.js 16 App Router + Server Actions（无 REST）、Prisma 6.19 raw SQL（`$queryRaw`/`$executeRaw`，bigint id `::bigint` cast）、shadcn/ui + RosterTable、PostgreSQL（Neon）。

**Spec:** `docs/superpowers/specs/2026-11-12-wage-rules-module-design.md`

## Global Constraints

- 注释一律英文；UI 文案与错误消息一律中文。
- 金额 `numeric(12,2)`、乘数 `numeric(5,2)`；计算每步 `roundCents`；界面统一两位小数。
- 主键 bigint identity（禁 uuid）；无 organization 维度；表在 `pay` schema。
- 数据库迁移：手写幂等 SQL 放 `prisma/migrations/NNNN_name/migration.sql`，用 `pnpm db:migrate`（自定义 db-migrate.sh + `common._migrations` 登记）应用。**勿用 `prisma migrate dev`**。
- 写操作走 `prisma.$executeRaw` 手写 SQL，不用 Prisma model 客户端。
- Server Action 收尾三连：`revalidatePath(本模块)` + `revalidatePath("/dashboard")` + `redirect`。
- 「今天」一律 `todayIso()`（America/Los_Angeles，`src/lib/format.ts`），勿用 UTC/北京时间。
- 无测试框架（spec 已确认）：每个任务的门是 `pnpm type-check` 绿 + 指定浏览器验证；最后 Task 5 跑完整验证矩阵。
- Next.js 16 有破坏性变更：写代码前如涉及陌生 API，先查 `node_modules/next/dist/docs/`。

---

### Task 1: 迁移 0017_wage_rules + schema.prisma 镜像

**Files:**
- Create: `prisma/migrations/0017_wage_rules/migration.sql`
- Modify: `prisma/schema.prisma`（文件末尾追加三个 model）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 表 `pay.wage_rule_versions(id, name, effective_from, owner_multiplier, bobtail_multiplier, overage_increment, status, notes, created_at, updated_at)`、`pay.wage_rule_tiers(id, version_id, miles_from, amount)`、`pay.wage_rule_special_routes(id, version_id, from_postal, to_postal, one_way_amount, note)`；初始数据一版（2026-06-01，6 档 + 特例 94545↔99301）。后续任务全部 SQL 依赖这些列名。

- [ ] **Step 1: 写迁移文件**

创建 `prisma/migrations/0017_wage_rules/migration.sql`，内容如下（照 0016 的头部注释 + BEGIN/COMMIT + 幂等 guard 风格）：

```sql
-- G&G PayOps
-- 0017: wage rule versions, replacing the hardcoded tiers in src/lib/wage.ts.
--       Source of truth: paper spec 司机工资明细算法 CA Local V1.02406
--       (effective 2026-06-01). One row per version keyed by effective_from
--       (unique); tier rows store driver-price bands (the paper's owner column
--       is exactly 2x, so a multiplier covers it); overage_increment is added
--       per 50mi past the top tier; special routes are fixed-price postal
--       pairs (94545<->99301 Washington run, one-way $550 = half of the
--       $1100 round trip; a leg that stops midway simply falls back to tiers).
--       Idempotent: CREATE IF NOT EXISTS + NOT EXISTS guards on seed rows.

BEGIN;

CREATE TABLE IF NOT EXISTS pay.wage_rule_versions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               varchar(120) NOT NULL,
  effective_from     date NOT NULL,
  owner_multiplier   numeric(5,2)  NOT NULL DEFAULT 2.00,
  bobtail_multiplier numeric(5,2)  NOT NULL DEFAULT 0.50,
  overage_increment  numeric(12,2) NOT NULL DEFAULT 30.00,
  status             varchar(16)   NOT NULL DEFAULT 'ACTIVE',
  notes              varchar(255),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wage_rule_effective UNIQUE (effective_from)
);

CREATE TABLE IF NOT EXISTS pay.wage_rule_tiers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES pay.wage_rule_versions(id) ON DELETE CASCADE,
  miles_from int NOT NULL CHECK (miles_from >= 1),
  amount     numeric(12,2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT uq_wage_tier_version_miles UNIQUE (version_id, miles_from)
);

CREATE TABLE IF NOT EXISTS pay.wage_rule_special_routes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id     bigint NOT NULL REFERENCES pay.wage_rule_versions(id) ON DELETE CASCADE,
  from_postal    varchar(10) NOT NULL,
  to_postal      varchar(10) NOT NULL,
  one_way_amount numeric(12,2) NOT NULL CHECK (one_way_amount >= 0),
  note           varchar(255)
);
CREATE INDEX IF NOT EXISTS idx_wage_special_routes_version
  ON pay.wage_rule_special_routes(version_id);

-- Seed: the paper spec, verbatim (driver-price bands)
INSERT INTO pay.wage_rule_versions(name, effective_from, owner_multiplier, bobtail_multiplier, overage_increment, notes)
SELECT 'CA Local 2026-06 版', DATE '2026-06-01', 2.00, 0.50, 30.00,
       '纸质《司机工资明细算法 CA Local V1.02406》初始导入'
WHERE NOT EXISTS (SELECT 1 FROM pay.wage_rule_versions WHERE effective_from = DATE '2026-06-01');

INSERT INTO pay.wage_rule_tiers(version_id, miles_from, amount)
SELECT v.id, t.miles_from, t.amount
FROM pay.wage_rule_versions v
JOIN (VALUES (1, 50.00), (50, 80.00), (100, 120.00), (150, 150.00), (200, 180.00), (250, 210.00)
) AS t(miles_from, amount) ON true
WHERE v.effective_from = DATE '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM pay.wage_rule_tiers tt
    WHERE tt.version_id = v.id AND tt.miles_from = t.miles_from
  );

INSERT INTO pay.wage_rule_special_routes(version_id, from_postal, to_postal, one_way_amount, note)
SELECT v.id, '94545', '99301', 550.00,
       '华盛顿线：来回 $1100（2×单程）；中途提卸货按实际迈数落里程档'
FROM pay.wage_rule_versions v
WHERE v.effective_from = DATE '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM pay.wage_rule_special_routes r
    WHERE r.version_id = v.id AND r.from_postal = '94545' AND r.to_postal = '99301'
  );

COMMIT;
```

- [ ] **Step 2: 应用迁移**

```bash
pnpm db:migrate
```

预期输出包含 0017 被执行并登记；再跑一次应显示跳过（幂等验证）。

- [ ] **Step 3: 验证种子数据**

```bash
DB_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
/opt/homebrew/opt/postgresql@18/bin/psql "$DB_URL" -c "
SELECT v.id, v.name, v.effective_from, v.owner_multiplier, v.overage_increment,
       count(t.id) AS tiers,
       (SELECT count(*) FROM pay.wage_rule_special_routes r WHERE r.version_id = v.id) AS specials
FROM pay.wage_rule_versions v LEFT JOIN pay.wage_rule_tiers t ON t.version_id = v.id
GROUP BY v.id ORDER BY v.effective_from;"
```

预期：1 行，`CA Local 2026-06 版`，`2026-06-01`，`2.00`，`30.00`，tiers=6，specials=1。（psql 路径若不存在，改用 `psql`。）

- [ ] **Step 4: schema.prisma 加镜像 model**

在 `prisma/schema.prisma` 文件末尾（`model Trip` 之后）追加：

```prisma
/// Wage-rule version keyed by effective_from (unique); pricing inputs come
/// from the paper spec and are edited on the /dashboard/wage-rules page.
/// raw-SQL access only (bigint identity ids, no Prisma-client writes)
model WageRuleVersion {
  id                BigInt   @id @default(autoincrement()) @db.BigInt
  name              String   @db.VarChar(120)
  effectiveFrom     DateTime @map("effective_from") @db.Date
  ownerMultiplier   Decimal  @default(2.00) @map("owner_multiplier") @db.Decimal(5, 2)
  bobtailMultiplier Decimal  @default(0.50) @map("bobtail_multiplier") @db.Decimal(5, 2)
  overageIncrement  Decimal  @default(30.00) @map("overage_increment") @db.Decimal(12, 2)
  status            String   @default("ACTIVE") @db.VarChar(16)
  notes             String?  @db.VarChar(255)
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([effectiveFrom], map: "uq_wage_rule_effective")
  @@map("wage_rule_versions")
  @@schema("pay")
}

/// Driver-price mileage band; legs at/above miles_from bill amount
model WageRuleTier {
  id        BigInt  @id @default(autoincrement()) @db.BigInt
  versionId BigInt  @map("version_id") @db.BigInt
  milesFrom Int     @map("miles_from")
  amount    Decimal @db.Decimal(12, 2)

  @@unique([versionId, milesFrom], map: "uq_wage_tier_version_miles")
  @@map("wage_rule_tiers")
  @@schema("pay")
}

/// Fixed-price postal pair (either direction bills one_way_amount)
model WageRuleSpecialRoute {
  id           BigInt  @id @default(autoincrement()) @db.BigInt
  versionId    BigInt  @map("version_id") @db.BigInt
  fromPostal   String  @map("from_postal") @db.VarChar(10)
  toPostal     String  @map("to_postal") @db.VarChar(10)
  oneWayAmount Decimal @map("one_way_amount") @db.Decimal(12, 2)
  note         String? @db.VarChar(255)

  @@index([versionId], map: "idx_wage_special_routes_version")
  @@map("wage_rule_special_routes")
  @@schema("pay")
}
```

- [ ] **Step 5: type-check 绿**

```bash
pnpm type-check
```

预期：无错误。

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/0017_wage_rules/migration.sql prisma/schema.prisma
git commit -m "工资规则迁移 0017：版本表+档位+特例邮编对，按纸质规则导入 2026-06-01 初始版"
```

---

### Task 2: wage.ts 参数化改造 + 查询层 + 录入表按行日期取版

**Files:**
- Modify: `src/lib/wage.ts`（全量重写）
- Create: `src/lib/queries/wage-rules.ts`
- Modify: `src/lib/queries/locations.ts:66-92`（`activeLocationOptions` 透传 `postal_code`）
- Modify: `src/components/location-picker.tsx:6-14`（`LocationOption` 加字段）
- Modify: `src/app/dashboard/trip-entry-form.tsx`（props 穿透 + autoPay 改造 + 行日期受控）
- Modify: `src/app/dashboard/page.tsx`（取数并传 props）

**Interfaces:**
- Consumes: Task 1 的三张表。
- Produces（后续任务依赖的精确签名）:
  - `wage.ts`: `type WageTier = { miles_from: number; amount: number }`、`type WageSpecialRoute = { from_postal: string; to_postal: string; one_way_amount: number }`、`type WageRuleData = { id: string; name: string; effective_from: string; owner_multiplier: number; bobtail_multiplier: number; overage_increment: number; tiers: WageTier[]; special_routes: WageSpecialRoute[] }`、`mileageTierWage(miles: number, tiers: WageTier[], overageIncrement: number): number`、`resolveSpecialRoute(fromPostal: string | null | undefined, toPostal: string | null | undefined, specialRoutes: WageSpecialRoute[]): number | null`、`pickVersion<T extends { effective_from: string }>(versions: T[], tripDate: string): T | null`、`calcTripWage(input: { driverType?; operation?; miles: number; from?; to?; fromPostal?; toPostal?; rule: WageRuleData }): number`
  - `queries/wage-rules.ts`: `activeWageRuleVersions(): Promise<WageRuleData[]>`、`wageRuleVersionsList(): Promise<WageRuleVersionSummary[]>`、`wageRuleVersionDetail(id: string): Promise<WageRuleVersionDetail | null>`、`type WageRuleVersionDetail`（Task 3/4 用）
  - `LocationOption` 增加 `postal_code: string | null`

- [ ] **Step 1: 重写 `src/lib/wage.ts`**

整文件替换为：

```ts
import type { DriverType, LocationType, OperationType } from "@/lib/labels";

/** One trip endpoint, just enough to price a leg (BASE handling + standard pay). */
export type WageEndpoint = {
  location_type: LocationType;
  standard_pay_amount: number;
};

/** One mileage band of a wage-rule version: legs at/above miles_from bill `amount`. */
export type WageTier = {
  miles_from: number;
  amount: number;
};

/** Fixed-price postal pair (e.g. 94545 <-> 99301): either direction bills one_way_amount. */
export type WageSpecialRoute = {
  from_postal: string;
  to_postal: string;
  one_way_amount: number;
};

/** Everything a wage-rule version contributes to pricing (from pay.wage_rule_*). */
export type WageRuleData = {
  id: string;
  name: string;
  effective_from: string;
  owner_multiplier: number;
  bobtail_multiplier: number;
  overage_increment: number;
  tiers: WageTier[];
  special_routes: WageSpecialRoute[];
};

/** Round to cents so the controlled input and numeric(12,2) stay in sync. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Driver-price mileage tiers (CA local pickup/delivery): the leg falls in the
 * highest tier whose miles_from <= miles; past the top tier every extra 50mi
 * adds overage_increment
 * (e.g. top 250->$210 with +$30: 299->$210, 300->$240, 350->$270).
 */
export function mileageTierWage(
  miles: number,
  tiers: WageTier[],
  overageIncrement: number
): number {
  if (!Number.isFinite(miles) || miles <= 0 || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.miles_from - b.miles_from);
  let matched = sorted[0];
  for (const tier of sorted) {
    if (miles >= tier.miles_from) matched = tier;
    else break;
  }
  const bands = Math.floor(miles / 50) - Math.floor(matched.miles_from / 50);
  const base = Number(matched.amount);
  return roundCents(bands > 0 ? base + overageIncrement * bands : base);
}

/** Fixed price for a special postal pair in either direction; null = no match. */
export function resolveSpecialRoute(
  fromPostal: string | null | undefined,
  toPostal: string | null | undefined,
  specialRoutes: WageSpecialRoute[]
): number | null {
  if (!fromPostal || !toPostal) return null;
  for (const route of specialRoutes) {
    const direct = fromPostal === route.from_postal && toPostal === route.to_postal;
    const reverse = fromPostal === route.to_postal && toPostal === route.from_postal;
    if (direct || reverse) return Number(route.one_way_amount);
  }
  return null;
}

/**
 * Pick the version governing a trip date: the latest ACTIVE version with
 * effective_from <= tripDate (null when none covers the date).
 */
export function pickVersion<T extends { effective_from: string }>(
  versions: T[],
  tripDate: string
): T | null {
  let best: T | null = null;
  for (const version of versions) {
    if (
      version.effective_from <= tripDate &&
      (!best || version.effective_from > best.effective_from)
    ) {
      best = version;
    }
  }
  return best;
}

/**
 * Base wage before multipliers:
 * 1. a BASE endpoint prices the leg by the OTHER end's standard_pay_amount
 *    (from-BASE wins when both ends are BASE: price by `to`; missing
 *    counterpart -> $0);
 * 2. else a special postal pair bills its fixed price (zip-only legs);
 * 3. else the mileage tier table + overage increment.
 */
function resolveBaseWage(input: {
  miles: number;
  from?: WageEndpoint | null;
  to?: WageEndpoint | null;
  fromPostal?: string | null;
  toPostal?: string | null;
  rule: WageRuleData;
}): number {
  if (input.from?.location_type === "BASE") return input.to?.standard_pay_amount ?? 0;
  if (input.to?.location_type === "BASE") return input.from?.standard_pay_amount ?? 0;
  const special = resolveSpecialRoute(
    input.fromPostal,
    input.toPostal,
    input.rule.special_routes
  );
  if (special !== null) return special;
  return mileageTierWage(input.miles, input.rule.tiers, input.rule.overage_increment);
}

/**
 * Full per-trip wage against a rule version:
 * base x (OWNER ? owner_multiplier : 1) x (BOBTAIL ? bobtail_multiplier : 1),
 * rounded to cents. DEL / LIVE / EMPTY bill at full price; an unpicked
 * driverType/operation counts as DRIVER / full price.
 */
export function calcTripWage(input: {
  driverType?: DriverType;
  operation?: OperationType;
  miles: number;
  from?: WageEndpoint | null;
  to?: WageEndpoint | null;
  fromPostal?: string | null;
  toPostal?: string | null;
  rule: WageRuleData;
}): number {
  const base = resolveBaseWage(input);
  const ownerX = input.driverType === "OWNER" ? input.rule.owner_multiplier : 1;
  const bobtailX = input.operation === "BOBTAIL" ? input.rule.bobtail_multiplier : 1;
  return roundCents(base * ownerX * bobtailX);
}
```

注意：旧导出 `mileageTierWage(miles)`（单参）与 `resolveBaseWage`（导出）已删除；全库唯一外部调用点是 `trip-entry-form.tsx`（本任务 Step 5 一并改），type-check 在 Step 6 才会绿。

- [ ] **Step 2: 新建 `src/lib/queries/wage-rules.ts`**

```ts
import { prisma } from "@/lib/prisma";
import type { WageRuleData } from "@/lib/wage";

/** Timeline row for the management page (summary aggregates included) */
export type WageRuleVersionSummary = {
  id: string;
  name: string;
  effective_from: string;
  owner_multiplier: string;
  bobtail_multiplier: string;
  overage_increment: string;
  tier_count: number;
  min_amount: string;
  max_amount: string;
  special_count: number;
  status: string;
  notes: string | null;
};

export async function wageRuleVersionsList() {
  return prisma.$queryRaw<WageRuleVersionSummary[]>`
    SELECT v.id::text, v.name,
           to_char(v.effective_from, 'YYYY-MM-DD') AS effective_from,
           v.owner_multiplier::text, v.bobtail_multiplier::text, v.overage_increment::text,
           count(t.id)::int AS tier_count,
           coalesce(min(t.amount), 0)::text AS min_amount,
           coalesce(max(t.amount), 0)::text AS max_amount,
           (SELECT count(*)::int FROM pay.wage_rule_special_routes r
             WHERE r.version_id = v.id) AS special_count,
           v.status, v.notes
    FROM pay.wage_rule_versions v
    LEFT JOIN pay.wage_rule_tiers t ON t.version_id = v.id
    GROUP BY v.id
    ORDER BY v.effective_from DESC
  `;
}

/** One version's full data (params + tiers + specials), for detail/edit views */
export async function wageRuleVersionDetail(id: string) {
  const versions = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      effective_from: string;
      owner_multiplier: string;
      bobtail_multiplier: string;
      overage_increment: string;
      status: string;
      notes: string | null;
    }>
  >`
    SELECT id::text, name, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           owner_multiplier::text, bobtail_multiplier::text, overage_increment::text,
           status, notes
    FROM pay.wage_rule_versions WHERE id = ${id}::bigint LIMIT 1
  `;
  const version = versions[0];
  if (!version) return null;
  const [tiers, special_routes] = await Promise.all([
    prisma.$queryRaw<Array<{ miles_from: number; amount: string }>>`
      SELECT miles_from, amount::text FROM pay.wage_rule_tiers
      WHERE version_id = ${id}::bigint ORDER BY miles_from
    `,
    prisma.$queryRaw<
      Array<{ from_postal: string; to_postal: string; one_way_amount: string; note: string | null }>
    >`
      SELECT from_postal, to_postal, one_way_amount::text, note
      FROM pay.wage_rule_special_routes WHERE version_id = ${id}::bigint ORDER BY id
    `
  ]);
  return { ...version, tiers, special_routes };
}

export type WageRuleVersionDetail = NonNullable<Awaited<ReturnType<typeof wageRuleVersionDetail>>>;

/** Every ACTIVE version's full rule (current + scheduled); callers pick by date. */
export async function activeWageRuleVersions(): Promise<WageRuleData[]> {
  const versions = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      effective_from: string;
      owner_multiplier: string;
      bobtail_multiplier: string;
      overage_increment: string;
    }>
  >`
    SELECT id::text, name, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           owner_multiplier::text, bobtail_multiplier::text, overage_increment::text
    FROM pay.wage_rule_versions WHERE status = 'ACTIVE'
    ORDER BY effective_from
  `;
  if (versions.length === 0) return [];
  const [tiers, specials] = await Promise.all([
    prisma.$queryRaw<Array<{ version_id: string; miles_from: number; amount: string }>>`
      SELECT version_id::text, miles_from, amount::text
      FROM pay.wage_rule_tiers ORDER BY miles_from
    `,
    prisma.$queryRaw<
      Array<{ version_id: string; from_postal: string; to_postal: string; one_way_amount: string }>
    >`
      SELECT version_id::text, from_postal, to_postal, one_way_amount::text
      FROM pay.wage_rule_special_routes ORDER BY id
    `
  ]);
  return versions.map(version => ({
    id: version.id,
    name: version.name,
    effective_from: version.effective_from,
    owner_multiplier: Number(version.owner_multiplier),
    bobtail_multiplier: Number(version.bobtail_multiplier),
    overage_increment: Number(version.overage_increment),
    tiers: tiers
      .filter(tier => tier.version_id === version.id)
      .map(tier => ({ miles_from: tier.miles_from, amount: Number(tier.amount) })),
    special_routes: specials
      .filter(special => special.version_id === version.id)
      .map(special => ({
        from_postal: special.from_postal,
        to_postal: special.to_postal,
        one_way_amount: Number(special.one_way_amount)
      }))
  }));
}
```

- [ ] **Step 3: LocationOption 透传 postal_code**

`src/components/location-picker.tsx` 的 `LocationOption` 类型（第 6-14 行）加一个字段（放在 `address` 之后）：

```ts
  /** USPS zip; feeds special-route pricing (free-text zip legs) */
  postal_code: string | null;
```

`src/lib/queries/locations.ts` 的 `activeLocationOptions()`（第 86-91 行）返回对象加 `postal_code`：

```ts
  return rows.map(({ location_type, address_line, city, state_code, postal_code, standard_pay_amount, ...rest }) => ({
    ...rest,
    postal_code,
    location_type: location_type as LocationType,
    standard_pay_amount: Number(standard_pay_amount),
    address: fullAddress({ address_line, city, state_code, postal_code }) || null
  }));
```

（`postal_code` 已在 SELECT 与行类型里，只是此前被丢弃；改动只是解构后放回。）

- [ ] **Step 4: `src/app/dashboard/page.tsx` 取数传参**

- import 加：`import { activeWageRuleVersions } from "@/lib/queries/wage-rules";`
- 第 87-91 行的 `Promise.all` 加第四项：

```ts
  const [drivers, trucks, locations, wageRules] = await Promise.all([
    activeDriverOptions(),
    activeTruckOptions(),
    activeLocationOptions(),
    activeWageRuleVersions()
  ]);
```

- `<TripEntryForm>`（第 120-128 行）加 prop：`wageRules={wageRules}`

- [ ] **Step 5: `src/app/dashboard/trip-entry-form.tsx` 接线（5 处编辑）**

5a. 第 13 行 import 改为：

```ts
import { calcTripWage, pickVersion, type WageRuleData } from "@/lib/wage";
```

5b. `TripEntryFormProps`（第 59-70 行）加字段：

```ts
  /** Wage-rule versions (current + scheduled); each row prices by its own date */
  wageRules: WageRuleData[];
```

5c. `EntryRow` 解构参数（第 113-133 行）加 `wageRules,`；其 props 类型（第 134-162 行）加：

```ts
  /** Wage-rule versions; the row's own date picks the governing one */
  wageRules: WageRuleData[];
```

5d. 行日期改受控（autoPay 要按行日期取版）。在 `const [operation, setOperation] = ...`（第 165 行）附近加状态：

```ts
  const [dateValue, setDateValue] = React.useState(defaults?.trip_date || defaultDate);
```

第 296-302 行日期 `<Input>` 改为受控：

```tsx
        <Input
          type="date"
          name={`${prefix}trip_date`}
          value={dateValue}
          onChange={e => setDateValue(e.target.value)}
          aria-label={`${legLabel}日期`}
          className={`${cellInput} font-mono`}
        />
```

5e. autoPay 改造。第 240-254 行的 `wageEndpoint` 保留，紧随其后加邮编解析与新版 autoPay：

```ts
  // Free-text endpoints never carry BASE pricing -> mileage tier, same as a
  // picked non-BASE location, so they resolve to null endpoints here
  const wageEndpoint = (value: string) =>
    locations.find(l => `loc:${l.id}` === value) ?? null;

  // Special-route lookup key: the picked location's zip, or the raw free-text
  // value when it is itself a 5-digit zip (txt:94545)
  const postalOf = (value: string): string | null => {
    const loc = locations.find(l => `loc:${l.id}` === value);
    if (loc) return loc.postal_code ?? null;
    const text = value.startsWith("txt:") ? value.slice(4) : value;
    return /^\d{5}$/.test(text) ? text : null;
  };

  // Rule price follows the row's own date (future versions price future rows)
  const rule = pickVersion(wageRules, dateValue);
  const autoPay = React.useMemo(
    () =>
      rule
        ? calcTripWage({
            driverType,
            operation: operation as OperationType | undefined,
            miles: Number(milesValue) || 0,
            from: wageEndpoint(fromValue),
            to: wageEndpoint(toValue),
            fromPostal: postalOf(fromValue),
            toPostal: postalOf(toValue),
            rule
          })
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driverType, operation, milesValue, fromValue, toValue, locations, rule]
  );
```

并在工资单元格（第 396-403 行 `{manualPay !== null && ...}` 之后）加无规则提示：

```tsx
        {!rule && manualPay === null && (
          <span className={`${cellHint} text-right`}>该日期无生效规则</span>
        )}
```

5f. `GroupSection`（第 442-459 行）解构与 props 类型各加 `wageRules: WageRuleData[];`，第 710-733 行 `<EntryRow>` 调用加 `wageRules={wageRules}`。

5g. `TripEntryForm` 解构（第 748-756 行）加 `wageRules,`，第 1053-1070 行 `<GroupSection>` 调用加 `wageRules={wageRules}`。

- [ ] **Step 6: type-check + lint**

```bash
pnpm type-check && pnpm lint
```

预期：全绿（旧调用点已全部更新）。

- [ ] **Step 7: 浏览器回归（数值不变 + 特例生效）**

启动 `pnpm dev`，登录后在录入页验证（特例腿用手输邮编：起点输入 `94545` 回车选「文本」，终点 `99301`）：

| 输入 | 预期本趟工资 |
|---|---|
| 司机 + txt:A→txt:B + 49 mi | $50.00 |
| 50 / 99 / 100 / 149 / 150 / 199 / 200 / 249 / 250 / 299 / 300 / 350 mi | 80 / 80 / 120 / 120 / 150 / 150 / 180 / 180 / 210 / 210 / 240 / 270 |
| 车主司机 + 100 mi | $240.00 |
| 司机 + BOBTAIL + 100 mi | $60.00 |
| 司机 + txt:94545→txt:99301（里程随意） | $550.00 |
| 司机 + txt:99301→txt:94545 | $550.00 |
| 车主 + txt:94545→txt:99301 | $1,100.00 |
| BASE 位置 + 对端有基准金额的仓 | 对端 standard_pay_amount（行为与改造前一致） |

- [ ] **Step 8: Commit**

```bash
git add src/lib/wage.ts src/lib/queries/wage-rules.ts src/lib/queries/locations.ts src/components/location-picker.tsx src/app/dashboard/page.tsx src/app/dashboard/trip-entry-form.tsx
git commit -m "工资计算参数化：wage.ts 吃 WageRuleData，特例邮编对/档位/乘数全部来自规则版本，录入表按行日期取版计价"
```

---

### Task 3: 管理页（只读部分）：导航 + 时间线 + 版本详情

**Files:**
- Modify: `src/components/rail-nav.tsx:6-12`
- Create: `src/app/dashboard/wage-rules/page.tsx`
- Create: `src/app/dashboard/wage-rules/wage-rules-table.tsx`

**Interfaces:**
- Consumes: Task 2 的 `wageRuleVersionsList()` / `wageRuleVersionDetail(id)` / `WageRuleVersionSummary` / `WageRuleVersionDetail`。
- Produces: 路由 `/dashboard/wage-rules`（`?v=<id>` 展开详情）；`wage-rules-table.tsx` 导出 `WageRulesTable({ versions, today }: { versions: WageRuleVersionSummary[]; today: string })`。Task 4 在此页面上加 actions 与弹窗。

- [ ] **Step 1: 导航加第 6 项**

`src/components/rail-nav.tsx` 的 `items` 数组末尾加：

```ts
  { href: "/dashboard/wage-rules", label: "工资规则", exact: false }
```

- [ ] **Step 2: 新建 `src/app/dashboard/wage-rules/wage-rules-table.tsx`**

```tsx
"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { money } from "@/lib/format";
import type { WageRuleVersionSummary } from "@/lib/queries/wage-rules";

/** 钢印标签：已生效（audit 绿）/ 待生效（amber） */
function EffectiveBadge({ effective }: { effective: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] border px-1.5 py-px text-[11px] font-semibold leading-4 ${
        effective
          ? "border-audit/30 bg-audit/10 text-audit"
          : "border-amber-500/40 bg-amber-50 text-amber-800"
      }`}
    >
      {effective ? "已生效" : "待生效"}
    </span>
  );
}

/** Version timeline on the shared TanStack + shadcn table shell */
export function WageRulesTable({
  versions,
  today,
  activeId
}: {
  versions: WageRuleVersionSummary[];
  today: string;
  activeId?: string;
}) {
  const columns: ColumnDef<WageRuleVersionSummary, unknown>[] = [
    {
      id: "name",
      header: "版本",
      size: 200,
      cell: ({ row }) => <span className="mono strong">{row.original.name}</span>
    },
    {
      id: "effective_from",
      header: "生效日期",
      size: 110,
      cell: ({ row }) => <span className="mono">{row.original.effective_from}</span>
    },
    {
      id: "state",
      header: "状态",
      size: 90,
      cell: ({ row }) => (
        <EffectiveBadge effective={row.original.effective_from <= today} />
      )
    },
    {
      id: "summary",
      header: "规则摘要",
      size: 360,
      meta: { cellClass: "text-muted-foreground" },
      cell: ({ row }) => {
        const v = row.original;
        return (
          <span>
            {v.tier_count} 档 {money(v.min_amount)}~{money(v.max_amount)} · 车主×
            {Number(v.owner_multiplier).toFixed(2)} · BOBTAIL×
            {Number(v.bobtail_multiplier).toFixed(2)} · 超档+{money(v.overage_increment)}/50mi · 特例 {v.special_count} 条
          </span>
        );
      }
    },
    {
      id: "actions",
      header: "操作",
      size: 70,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => (
        <Link href={`/dashboard/wage-rules?v=${row.original.id}`}>详情</Link>
      )
    }
  ];

  const table = useRosterTable({
    data: versions,
    columns,
    storageKey: "payops.wage-rules.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={v => (v.id === activeId ? "row-active" : undefined)}
      empty="还没有任何规则版本。"
    />
  );
}
```

（若 `row-active` 类不存在于 globals.css，改用 `row-off` 的反义：直接删掉 rowClassName。执行时看 Trips 页有没有高亮行类；没有就省略 rowClassName。）

- [ ] **Step 3: 新建 `src/app/dashboard/wage-rules/page.tsx`（Task 3 只读版）**

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { requireUser } from "@/lib/auth";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { money, todayIso } from "@/lib/format";
import { wageRuleVersionsList, wageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { WageRulesTable } from "./wage-rules-table";

export const metadata: Metadata = { title: "工资规则 · G&G PayOps" };

/** Band label: 1–49, 50–99 … 250+（下一档下界 −1；最高档开放） */
function bandLabel(milesFrom: number, nextFrom: number | null) {
  return nextFrom === null ? `${milesFrom}+` : `${milesFrom} – ${nextFrom - 1}`;
}

export default async function WageRulesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  const viewId = (firstValue(sp.v) ?? "").trim();
  const today = todayIso();

  const [versions, detail] = await Promise.all([
    wageRuleVersionsList(),
    viewId ? wageRuleVersionDetail(viewId) : Promise.resolve(null)
  ]);

  const ownerMultiplier = detail ? Number(detail.owner_multiplier) : 1;

  return (
    <>
      <PageHeader
        title="工资规则"
        description="版本化的工资计算规则：里程档位、车主与 BOBTAIL 乘数、特例邮编对；已生效版本只读，改价发新版本。"
      />

      <section aria-label="版本时间线">
        <LedgerPanel>
          <WageRulesTable versions={versions} today={today} activeId={viewId || undefined} />
        </LedgerPanel>
      </section>

      {detail && (
        <section aria-label="版本详情" className="mt-4">
          <LedgerPanel
            label={
              <span className="flex flex-wrap items-center gap-2">
                <b className="mono">{detail.name}</b>
                <span className="mono text-muted-foreground">生效 {detail.effective_from}</span>
                <span
                  className={`inline-flex items-center rounded-[3px] border px-1.5 py-px text-[11px] font-semibold leading-4 ${
                    detail.effective_from <= today
                      ? "border-audit/30 bg-audit/10 text-audit"
                      : "border-amber-500/40 bg-amber-50 text-amber-800"
                  }`}
                >
                  {detail.effective_from <= today ? "已生效（只读）" : "待生效"}
                </span>
              </span>
            }
          >
            <div className="grid gap-6 px-4 py-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  里程档位（司机价；车主 = 司机 × {ownerMultiplier.toFixed(2)}）
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>档位 (mi)</th>
                      <th className="num">司机价</th>
                      <th className="num">车主价</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.tiers.map((tier, i) => {
                      const next = detail.tiers[i + 1]?.miles_from ?? null;
                      const amount = Number(tier.amount);
                      return (
                        <tr key={tier.miles_from}>
                          <td className="mono">{bandLabel(tier.miles_from, next)}</td>
                          <td className="num">{money(amount)}</td>
                          <td className="num">{money(amount * ownerMultiplier)}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="mono">超档</td>
                      <td className="num" colSpan={2}>
                        最高档后每 50 mi + {money(Number(detail.overage_increment))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">特例路线（单程固定价，双向同价）</p>
                {detail.special_routes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">无</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>邮编对</th>
                        <th className="num">单程</th>
                        <th className="num">车主单程</th>
                        <th>备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.special_routes.map((route, i) => (
                        <tr key={i}>
                          <td className="mono">
                            {route.from_postal} ↔ {route.to_postal}
                          </td>
                          <td className="num">{money(Number(route.one_way_amount))}</td>
                          <td className="num">
                            {money(Number(route.one_way_amount) * ownerMultiplier)}
                          </td>
                          <td className="text-muted-foreground">{route.note ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  BOBTAIL 乘数 ×{Number(detail.bobtail_multiplier).toFixed(2)}；
                  BASE 端点腿按位置基准金额计价（位置管理页维护），不落档位。
                </p>
              </div>
            </div>
          </LedgerPanel>
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 4: type-check + 浏览器验证**

```bash
pnpm type-check
```

`pnpm dev` 登录后：导航出现第 6 项「工资规则」；页面列出「CA Local 2026-06 版 / 2026-06-01 / 已生效 / 6 档 $50.00~$210.00 · 车主×2.00 … · 特例 1 条」；点「详情」展开档位表（1 – 49 $50.00 $100.00 … 250+）与特例表（94545 ↔ 99301 $550.00 $1,100.00）。

- [ ] **Step 5: Commit**

```bash
git add src/components/rail-nav.tsx src/app/dashboard/wage-rules/page.tsx src/app/dashboard/wage-rules/wage-rules-table.tsx
git commit -m "工资规则管理页（只读）：导航第 6 项，版本时间线 + 档位/特例钢印详情，已生效/待生效徽章"
```

---

### Task 4: 版本变更：复制发新版 + 待生效版编辑/删除

**Files:**
- Create: `src/app/dashboard/wage-rules/actions.ts`
- Create: `src/app/dashboard/wage-rules/version-form.tsx`
- Modify: `src/app/dashboard/wage-rules/page.tsx`（加 ERROR_MESSAGES、两个 ModalShell、Header 动作按钮、详情区编辑/删除入口）

**Interfaces:**
- Consumes: Task 2 的 `wageRuleVersionDetail` / `WageRuleVersionDetail`；Task 3 的页面骨架。
- Produces: Server Actions `createVersion(formData)` / `updateVersion(formData)` / `deleteVersion(formData)`；客户端组件 `VersionForm({ version, error }: { version: WageRuleVersionDetail; error?: string })`。表单字段名（服务端解析依赖）：`source_id`、`id`、`name`、`effective_from`、`owner_multiplier`、`bobtail_multiplier`、`overage_increment`、`tier_count` + `tier_<i>_miles_from` / `tier_<i>_amount`、`special_count` + `special_<i>_from_postal` / `special_<i>_to_postal` / `special_<i>_amount` / `special_<i>_note`。

- [ ] **Step 1: 新建 `src/app/dashboard/wage-rules/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { todayIso } from "@/lib/format";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

type TierInput = { miles_from: number; amount: number };
type SpecialInput = {
  from_postal: string;
  to_postal: string;
  one_way_amount: number;
  note: string | null;
};

/** Positional tier rows; fully blank rows are skipped (mirrors entry sheet) */
function parseTiers(formData: FormData): TierInput[] {
  const count = Number(str(formData, "tier_count") || "0");
  const tiers: TierInput[] = [];
  for (let i = 0; i < count; i++) {
    const milesRaw = str(formData, `tier_${i}_miles_from`);
    const amountRaw = str(formData, `tier_${i}_amount`);
    if (!milesRaw && !amountRaw) continue;
    tiers.push({ miles_from: Number(milesRaw), amount: Number(amountRaw) });
  }
  return tiers;
}

function parseSpecials(formData: FormData): SpecialInput[] {
  const count = Number(str(formData, "special_count") || "0");
  const specials: SpecialInput[] = [];
  for (let i = 0; i < count; i++) {
    const fromPostal = str(formData, `special_${i}_from_postal`);
    const toPostal = str(formData, `special_${i}_to_postal`);
    if (!fromPostal && !toPostal) continue;
    specials.push({
      from_postal: fromPostal,
      to_postal: toPostal,
      one_way_amount: Number(str(formData, `special_${i}_amount`)),
      note: str(formData, `special_${i}_note`) || null
    });
  }
  return specials;
}

/** Shared validation for a full version payload; returns a Chinese-error code or null */
function validateVersion(input: {
  name: string;
  effectiveFrom: string;
  ownerMultiplier: number;
  bobtailMultiplier: number;
  overageIncrement: number;
  tiers: TierInput[];
  specials: SpecialInput[];
}): string | null {
  if (!input.name) return "missing_name";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return "bad_date";
  if (!(input.ownerMultiplier > 0) || !(input.bobtailMultiplier > 0)) return "bad_multiplier";
  if (!(input.overageIncrement >= 0)) return "bad_overage";
  if (input.tiers.length === 0) return "no_tiers";
  for (const tier of input.tiers) {
    if (!Number.isInteger(tier.miles_from) || tier.miles_from < 1) return "bad_tier_miles";
    if (!(tier.amount >= 0)) return "bad_tier_amount";
  }
  const sorted = [...input.tiers].sort((a, b) => a.miles_from - b.miles_from);
  if (sorted[0].miles_from !== 1) return "tiers_not_from_1";
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].miles_from !== sorted[i - 1].miles_from + 50) return "tiers_not_50_step";
  }
  for (const special of input.specials) {
    if (!/^\d{5}$/.test(special.from_postal) || !/^\d{5}$/.test(special.to_postal)) {
      return "bad_postal";
    }
    if (special.from_postal === special.to_postal) return "bad_postal";
    if (!(special.one_way_amount >= 0)) return "bad_special_amount";
  }
  return null;
}

async function effectiveDateTaken(effectiveFrom: string, exceptId: string) {
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM pay.wage_rule_versions
    WHERE effective_from = ${effectiveFrom}::date AND id <> ${exceptId}::bigint LIMIT 1
  `;
  return rows.length > 0;
}

/** Copy an existing version (params + tiers + specials) under a new date */
export async function createVersion(formData: FormData) {
  await requireUser();

  const sourceId = str(formData, "source_id");
  const name = str(formData, "name");
  const effectiveFrom = str(formData, "effective_from");
  const back = (error: string) => {
    const params = new URLSearchParams({ new: "1", from: sourceId, error });
    if (name) params.set("f_name", name);
    if (effectiveFrom) params.set("f_effective_from", effectiveFrom);
    return `/dashboard/wage-rules?${params.toString()}`;
  };

  if (!sourceId) redirect(back("bad_source"));
  if (!name) redirect(back("missing_name"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) redirect(back("bad_date"));
  // Versions only make sense future-dated: <= today would be born locked
  if (effectiveFrom <= todayIso()) redirect(back("past_date"));
  if (await effectiveDateTaken(effectiveFrom, "0")) redirect(back("dup_date"));

  const inserted = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO pay.wage_rule_versions(name, effective_from, owner_multiplier, bobtail_multiplier, overage_increment, notes)
    SELECT ${name}, ${effectiveFrom}::date, v.owner_multiplier, v.bobtail_multiplier, v.overage_increment,
           concat('基于版本 #', v.id::text, ' 复制')
    FROM pay.wage_rule_versions v WHERE v.id = ${sourceId}::bigint
    RETURNING id::text
  `;
  const newId = inserted[0]?.id;
  if (!newId) redirect(back("bad_source"));

  await prisma.$executeRaw`
    INSERT INTO pay.wage_rule_tiers(version_id, miles_from, amount)
    SELECT ${newId}::bigint, miles_from, amount FROM pay.wage_rule_tiers
    WHERE version_id = ${sourceId}::bigint
  `;
  await prisma.$executeRaw`
    INSERT INTO pay.wage_rule_special_routes(version_id, from_postal, to_postal, one_way_amount, note)
    SELECT ${newId}::bigint, from_postal, to_postal, one_way_amount, note
    FROM pay.wage_rule_special_routes WHERE version_id = ${sourceId}::bigint
  `;

  revalidatePath("/dashboard/wage-rules");
  revalidatePath("/dashboard");
  redirect(`/dashboard/wage-rules?v=${newId}`);
}

/** Whole-version save for a pending version (effective_from > today) */
export async function updateVersion(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const back = (error: string) => `/dashboard/wage-rules?edit=${id}&error=${error}`;

  const existing = await prisma.$queryRaw<
    Array<{ effective_from: string }>
  >`
    SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from
    FROM pay.wage_rule_versions WHERE id = ${id}::bigint LIMIT 1
  `;
  if (existing.length === 0) redirect("/dashboard/wage-rules");
  // Locked once effective (<= today): historical stays auditable
  if (existing[0].effective_from <= todayIso()) redirect(back("locked"));

  const name = str(formData, "name");
  const effectiveFrom = str(formData, "effective_from");
  const ownerMultiplier = Number(str(formData, "owner_multiplier"));
  const bobtailMultiplier = Number(str(formData, "bobtail_multiplier"));
  const overageIncrement = Number(str(formData, "overage_increment"));
  const tiers = parseTiers(formData);
  const specials = parseSpecials(formData);

  const error = validateVersion({
    name, effectiveFrom, ownerMultiplier, bobtailMultiplier, overageIncrement, tiers, specials
  });
  if (error) redirect(back(error));
  if (effectiveFrom <= todayIso()) redirect(back("past_date"));
  if (await effectiveDateTaken(effectiveFrom, id)) redirect(back("dup_date"));

  // Replace children wholesale (the form submits the whole version snapshot)
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE pay.wage_rule_versions SET
        name = ${name}, effective_from = ${effectiveFrom}::date,
        owner_multiplier = ${ownerMultiplier}, bobtail_multiplier = ${bobtailMultiplier},
        overage_increment = ${overageIncrement}, updated_at = now()
      WHERE id = ${id}::bigint
    `,
    prisma.$executeRaw`DELETE FROM pay.wage_rule_tiers WHERE version_id = ${id}::bigint`,
    ...tiers.map(tier =>
      prisma.$executeRaw`
        INSERT INTO pay.wage_rule_tiers(version_id, miles_from, amount)
        VALUES (${id}::bigint, ${tier.miles_from}, ${tier.amount})
      `
    ),
    prisma.$executeRaw`DELETE FROM pay.wage_rule_special_routes WHERE version_id = ${id}::bigint`,
    ...specials.map(special =>
      prisma.$executeRaw`
        INSERT INTO pay.wage_rule_special_routes(version_id, from_postal, to_postal, one_way_amount, note)
        VALUES (${id}::bigint, ${special.from_postal}, ${special.to_postal}, ${special.one_way_amount}, ${special.note})
      `
    )
  ]);

  revalidatePath("/dashboard/wage-rules");
  revalidatePath("/dashboard");
  redirect(`/dashboard/wage-rules?v=${id}`);
}

/** Pending versions only; effective versions are locked forever */
export async function deleteVersion(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const existing = await prisma.$queryRaw<Array<{ effective_from: string }>>`
    SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from
    FROM pay.wage_rule_versions WHERE id = ${id}::bigint LIMIT 1
  `;
  if (existing.length === 0) redirect("/dashboard/wage-rules");
  if (existing[0].effective_from <= todayIso()) {
    redirect(`/dashboard/wage-rules?v=${id}&error=locked`);
  }

  await prisma.$executeRaw`DELETE FROM pay.wage_rule_versions WHERE id = ${id}::bigint`;

  revalidatePath("/dashboard/wage-rules");
  revalidatePath("/dashboard");
  redirect("/dashboard/wage-rules");
}
```

- [ ] **Step 2: 新建 `src/app/dashboard/wage-rules/version-form.tsx`**

```tsx
"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError, FormGrid, NumberField, SubmitButton, TextField } from "@/components/form-fields";
import type { WageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { updateVersion } from "./actions";

type TierRow = { miles_from: string; amount: string };
type SpecialRow = { from_postal: string; to_postal: string; amount: string; note: string };

const cellInput =
  "h-8 border-0 bg-transparent px-2 shadow-none rounded-none text-[13px] focus-visible:ring-1";

/** Whole-version editor for a PENDING version: dynamic tier/special rows
 *  submit positional FormData (same convention as the entry sheet). */
export function VersionForm({
  version,
  errorMessage
}: {
  version: WageRuleVersionDetail;
  errorMessage?: string;
}) {
  const [tiers, setTiers] = React.useState<TierRow[]>(
    version.tiers.map(t => ({
      miles_from: String(t.miles_from),
      amount: Number(t.amount).toFixed(2)
    }))
  );
  const [specials, setSpecials] = React.useState<SpecialRow[]>(
    version.special_routes.map(s => ({
      from_postal: s.from_postal,
      to_postal: s.to_postal,
      amount: Number(s.one_way_amount).toFixed(2),
      note: s.note ?? ""
    }))
  );

  const overage = Number(version.overage_increment);
  const addTier = () =>
    setTiers(current => {
      const last = current[current.length - 1];
      return [
        ...current,
        {
          miles_from: last ? String(Number(last.miles_from) + 50) : "1",
          amount: last ? (Number(last.amount) + overage).toFixed(2) : "50.00"
        }
      ];
    });
  const addSpecial = () =>
    setSpecials(current => [...current, { from_postal: "", to_postal: "", amount: "", note: "" }]);

  return (
    <form action={updateVersion} aria-label="版本编辑">
      <input type="hidden" name="id" value={version.id} />
      <input type="hidden" name="tier_count" value={tiers.length} />
      <input type="hidden" name="special_count" value={specials.length} />
      <FormError message={errorMessage} />

      <div className="grid gap-4 px-5 py-4">
        <FormGrid>
          <TextField label="版本名" name="name" required defaultValue={version.name} maxLength={120} />
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            生效日期
            <Input
              type="date"
              name="effective_from"
              defaultValue={version.effective_from}
              required
              aria-label="生效日期"
              className="h-9 font-mono text-[13px]"
            />
          </label>
          <NumberField
            label="车主乘数（×）"
            name="owner_multiplier"
            min={0.01}
            step={0.01}
            defaultValue={Number(version.owner_multiplier).toFixed(2)}
          />
          <NumberField
            label="BOBTAIL 乘数（×）"
            name="bobtail_multiplier"
            min={0.01}
            step={0.01}
            defaultValue={Number(version.bobtail_multiplier).toFixed(2)}
          />
          <NumberField
            label="超档递增（$/50mi）"
            name="overage_increment"
            min={0}
            step={0.01}
            defaultValue={Number(version.overage_increment).toFixed(2)}
          />
        </FormGrid>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              里程档位（司机价；首档 1、按 50 递进）
            </p>
            <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={addTier}>
              <PlusIcon className="mr-0.5 size-3.5" /> 添加档位
            </Button>
          </div>
          <table>
            <thead>
              <tr>
                <th>起算里程 (mi)</th>
                <th className="num">司机价 ($)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, i) => (
                <tr key={i}>
                  <td>
                    <Input
                      type="number"
                      name={`tier_${i}_miles_from`}
                      min={1}
                      step={50}
                      value={tier.miles_from}
                      onChange={e =>
                        setTiers(current =>
                          current.map((t, j) => (j === i ? { ...t, miles_from: e.target.value } : t))
                        )
                      }
                      aria-label={`第 ${i + 1} 档起算里程`}
                      className={`${cellInput} w-24 font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      name={`tier_${i}_amount`}
                      min={0}
                      step={0.01}
                      value={tier.amount}
                      onChange={e =>
                        setTiers(current =>
                          current.map((t, j) => (j === i ? { ...t, amount: e.target.value } : t))
                        )
                      }
                      aria-label={`第 ${i + 1} 档司机价`}
                      className={`${cellInput} w-28 text-right font-mono`}
                    />
                  </td>
                  <td className="actions">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive"
                      onClick={() => setTiers(current => current.filter((_, j) => j !== i))}
                      aria-label={`删除第 ${i + 1} 档`}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              特例路线（5 位邮编对，双向单程同价）
            </p>
            <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={addSpecial}>
              <PlusIcon className="mr-0.5 size-3.5" /> 添加特例
            </Button>
          </div>
          <table>
            <thead>
              <tr>
                <th>邮编 A</th>
                <th>邮编 B</th>
                <th className="num">单程价 ($)</th>
                <th>备注</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {specials.map((special, i) => (
                <tr key={i}>
                  <td>
                    <Input
                      name={`special_${i}_from_postal`}
                      value={special.from_postal}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, from_postal: e.target.value } : s))
                        )
                      }
                      maxLength={10}
                      aria-label={`特例 ${i + 1} 邮编 A`}
                      className={`${cellInput} w-24 font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      name={`special_${i}_to_postal`}
                      value={special.to_postal}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, to_postal: e.target.value } : s))
                        )
                      }
                      maxLength={10}
                      aria-label={`特例 ${i + 1} 邮编 B`}
                      className={`${cellInput} w-24 font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      name={`special_${i}_amount`}
                      min={0}
                      step={0.01}
                      value={special.amount}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, amount: e.target.value } : s))
                        )
                      }
                      aria-label={`特例 ${i + 1} 单程价`}
                      className={`${cellInput} w-28 text-right font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      name={`special_${i}_note`}
                      value={special.note}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, note: e.target.value } : s))
                        )
                      }
                      maxLength={255}
                      aria-label={`特例 ${i + 1} 备注`}
                      className={`${cellInput} w-40`}
                    />
                  </td>
                  <td className="actions">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive"
                      onClick={() => setSpecials(current => current.filter((_, j) => j !== i))}
                      aria-label={`删除特例 ${i + 1}`}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {specials.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">无特例路线</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end border-t border-line px-5 py-3">
        <SubmitButton>保存版本</SubmitButton>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: 改 `page.tsx` 接弹窗与入口**

在 Task 3 的 `page.tsx` 上做以下编辑：

3a. import 增加：

```ts
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { FormError, FormGrid, SubmitButton, TextField } from "@/components/form-fields";
import { isoPlusDays } from "@/lib/format";
import { createVersion, deleteVersion } from "./actions";
import { VersionForm } from "./version-form";
```

（`money`/`todayIso` 已有；`isoPlusDays` 与 `todayIso` 同在 `@/lib/format`。）

3b. ERROR_MESSAGES 常量（组件外）：

```ts
const ERROR_MESSAGES: Record<string, string> = {
  missing_name: "请填写版本名。",
  bad_date: "生效日期无效。",
  past_date: "生效日期必须晚于今天（已生效版本只读，改价请发新版本）。",
  dup_date: "这个生效日期已有版本。",
  bad_multiplier: "乘数必须大于 0。",
  bad_overage: "超档递增额必须 ≥ 0。",
  no_tiers: "至少需要一个里程档位。",
  tiers_not_from_1: "首个档位必须从 1 英里开始。",
  tiers_not_50_step: "档位必须按 50 英里步长递进（1、50、100…）。",
  bad_tier_miles: "档位起算里程必须是 ≥ 1 的整数。",
  bad_tier_amount: "档位金额必须 ≥ 0。",
  bad_postal: "特例邮编必须是 5 位数字，且两端不能相同。",
  bad_special_amount: "特例单程价必须 ≥ 0。",
  locked: "该版本已生效，不可修改或删除。",
  bad_source: "复制源版本不存在。"
};
```

3c. searchParams 解析段（`viewId` 之后）加：

```ts
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";
  const editId = (firstValue(sp.edit) ?? "").trim();
  const fromId = (firstValue(sp.from) ?? "").trim();
  const namePre = firstValue(sp.f_name);
  const datePre = firstValue(sp.f_effective_from);
```

`Promise.all` 加 `editId ? wageRuleVersionDetail(editId) : Promise.resolve(null)`（变量名 `editing`）。

3d. 弹窗 open 条件与源版本：

```ts
  const tomorrow = isoPlusDays(todayIso(), 1);
  // Default copy source: the version governing today (latest effective), else newest
  const createSourceId =
    fromId || versions.find(v => v.effective_from <= today)?.id || versions[0]?.id || "";
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? "操作出错，请检查后重试。" : undefined;
  const editLocked = editing ? editing.effective_from <= today : false;
```

3e. `PageHeader` 加动作按钮：

```tsx
        actions={
          createSourceId ? (
            <Link className="button button-quiet" href={`/dashboard/wage-rules?new=1&from=${createSourceId}`}>
              基于当前版创建新版本
            </Link>
          ) : undefined
        }
```

3f. 详情面板 label 行：`待生效` 徽章后追加「编辑」链接（只对待生效版）：

```tsx
                {detail.effective_from > today && (
                  <Link href={`/dashboard/wage-rules?edit=${detail.id}`}>编辑</Link>
                )}
```

3g. 详情面板底部（LedgerPanel 内 grid 之后）对待生效版加删除表单：

```tsx
            {detail.effective_from > today && (
              <form action={deleteVersion} className="flex justify-end px-4 pb-4">
                <input type="hidden" name="id" value={detail.id} />
                <button type="submit" className="linklike danger">删除此待生效版本</button>
              </form>
            )}
```

3h. 组件末尾（`</>` 之前）加两个 ModalShell：

```tsx
      <ModalShell
        open={isNew && Boolean(createSourceId)}
        closeHref="/dashboard/wage-rules"
        title="创建新版本"
      >
        <form action={createVersion} aria-label="创建新版本">
          <input type="hidden" name="source_id" value={createSourceId} />
          <div className="grid gap-4 px-5 py-4">
            <FormError message={errorMessage} />
            <p className="text-xs text-muted-foreground">
              复制当前版本的档位、乘数、递增额与特例路线，生效后旧版本自动成为历史。
            </p>
            <FormGrid>
              <TextField
                label="版本名"
                name="name"
                required
                defaultValue={namePre ?? `CA Local ${tomorrow.slice(0, 7).replace("-", "年")} 版`}
                maxLength={120}
              />
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                生效日期（须晚于今天）
                <Input
                  type="date"
                  name="effective_from"
                  defaultValue={datePre ?? tomorrow}
                  required
                  aria-label="生效日期"
                  className="h-9 font-mono text-[13px]"
                />
              </label>
            </FormGrid>
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <SubmitButton>创建版本</SubmitButton>
          </div>
        </form>
      </ModalShell>

      <ModalShell
        open={Boolean(editing) && !editLocked}
        closeHref={`/dashboard/wage-rules?v=${editId}`}
        title={`编辑 ${editing?.name ?? ""}`}
      >
        {editing && (
          <VersionForm version={editing} errorMessage={editing && editLocked ? undefined : errorMessage} />
        )}
      </ModalShell>
```

（3h 中 create 弹窗用到 `Input`：import 加 `import { Input } from "@/components/ui/input";`。已生效版本点「编辑」链接时 `editLocked` 为 true，弹窗不 open、停留在只读详情。）

- [ ] **Step 4: type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 5: 浏览器验证**

1. 已生效版本详情：无「编辑」链接（只读钢印）。
2. 点「基于当前版创建新版本」→ 弹窗预填名与明天日期 → 创建 → 跳到新版本详情，徽章「待生效」。
3. 待生效版本「编辑」→ 弹窗改某档金额（如 100 档 120→125）→ 保存 → 详情与时间线摘要更新。
4. 校验：新建时选今天 → 报「生效日期必须晚于今天」；编辑时删光档位保存 → 「至少需要一个里程档位」。
5. 待生效版本「删除此待生效版本」→ 从时间线消失。
6. 回录入页：行日期拨到新版本生效日之后 + 100 mi → $125.00；拨回生效日前 → $120.00。

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/wage-rules/actions.ts src/app/dashboard/wage-rules/version-form.tsx src/app/dashboard/wage-rules/page.tsx
git commit -m "工资规则版本变更：复制发新版（弹窗）+ 待生效版整版编辑/删除，已生效版本锁定只读"
```

---

### Task 5: 端到端验证 + 线上迁移

**Files:**
- 无新文件（验证任务；如发现缺陷，修复后补 commit）

**Interfaces:**
- Consumes: Task 1-4 全部产出。
- Produces: 验证结论；线上 Neon 库结构与本地一致。

- [ ] **Step 1: 静态检查**

```bash
pnpm lint && pnpm type-check
```

- [ ] **Step 2: 用 verify 技能跑全链路**

调用 verify 技能（登录 → 录入 → 行程与工资）。核对清单：

1. 录入页计算矩阵（Task 2 Step 7 的全表，含档位边界 49/50/99/100/149/150/199/200/249/250/299/300/349/350、车主×2、BOBTAIL×0.5、特例双向 $550、BASE 端点价、无规则日期 $0 提示）。
2. 工资规则页：时间线、详情、复制发新版、待生效编辑/删除、锁定行为（Task 4 Step 5）。
3. 录入 → 提交 → `/dashboard/trips?view=period` 核算矩阵：工资合计与录入一致（快照未被破坏）。
4. 手改工资 sticky +「重算」恢复规则价仍工作。

发现偏差：修复 → 重跑相关项 → 补 commit（消息描述缺陷与修法）。

- [ ] **Step 3: 线上 Neon 应用迁移（需用户确认）**

向用户确认后执行（连接串存于 memory `production-neon-database.md`）：

```bash
/opt/homebrew/opt/postgresql@18/bin/psql "<线上连接串>" -f prisma/migrations/0017_wage_rules/migration.sql
# 然后登记：
/opt/homebrew/opt/postgresql@18/bin/psql "<线上连接串>" -c "INSERT INTO common._migrations(name) VALUES ('0017_wage_rules') ON CONFLICT DO NOTHING;"
```

预期：线上三张表 + 同一份种子数据。（迁移幂等，重复执行安全。）

- [ ] **Step 4: 收尾 commit（如有修复）+ 汇报**

向用户汇报：完成的任务清单、验证矩阵结果、线上库状态。

---

## Self-Review 记录

- Spec 覆盖：三张表（T1）、金额精度 numeric + roundCents + 两位小数展示（T1 DDL/T2 wage.ts/T3 money()）、计算链 BASE→特例→档位→乘数（T2）、pickVersion 按行日期（T2）、版本锁定 ≤今天只读（T4 actions）、导航第 6 项与管理页（T3）、复制发新版/整版提交/校验（T4）、录入表无版本 $0 提示（T2 5e）、快照不追溯（不变式，T5 验证 3）。范围外项（奖励/区域/重算）未实现 ✓（spec 明确不做）。
- 类型一致性：`WageRuleData`/`WageTier`/`WageSpecialRoute` 在 T2 定义、T2 表单与 T4 无冲突消费；`wageRuleVersionDetail` 返回 `{...version, tiers, special_routes}` 与 `WageRuleVersionDetail` 一致；表单字段名与 actions 解析一一对应（`tier_<i>_miles_from` 等）。
- 已知留白（有意）：T3 表格 `row-active` 类若不存在则省略 rowClassName（步骤内已给替代）；T4 update 校验失败后表单回读库值（用户编辑不保留），v1 取舍。
