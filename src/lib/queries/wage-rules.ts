import { prisma } from "@/lib/prisma";
import type { WagePriceRule, WageRuleData } from "@/lib/wage";

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
  price_rule_count: number;
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
           (SELECT count(*)::int FROM pay.wage_rule_prices p
             WHERE p.version_id = v.id) AS price_rule_count,
           v.status, v.notes
    FROM pay.wage_rule_versions v
    LEFT JOIN pay.wage_rule_tiers t ON t.version_id = v.id
    GROUP BY v.id
    ORDER BY v.effective_from DESC
  `;
}

/** Flexible price rules of one version, insertion order */
export async function wageVersionPriceRules(versionId: string): Promise<WagePriceRule[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      driver_id: string | null;
      unit: string;
      from_class: string | null;
      to_class: string | null;
      operation: string | null;
      label: string | null;
      driver_amount: string;
      owner_amount: string | null;
    }>
  >`
    SELECT id::text, driver_id::text AS driver_id, unit, from_class, to_class,
           operation, label, driver_amount::text, owner_amount::text
    FROM pay.wage_rule_prices WHERE version_id = ${versionId}::bigint ORDER BY id
  `;
  return rows.map(row => ({
    id: row.id,
    driver_id: row.driver_id,
    unit: row.unit as WagePriceRule["unit"],
    from_class: row.from_class,
    to_class: row.to_class,
    operation: row.operation,
    label: row.label,
    driver_amount: Number(row.driver_amount),
    owner_amount: row.owner_amount === null ? null : Number(row.owner_amount)
  }));
}

/** Amazon warehouse dictionary rows for the wage console (prices + A/B class) */
export async function amazonWarehouseRows() {
  return prisma.$queryRaw<
    Array<{
      id: string;
      code: string;
      amazon_class: "A" | "B" | null;
      standard_pay_amount: string;
    }>
  >`
    SELECT id::text, code, amazon_class::text AS amazon_class,
           standard_pay_amount::text
    FROM ops.locations
    WHERE location_type = 'AMAZON' AND status = 'ACTIVE'
    ORDER BY code
  `;
}

/** One version's full data (params + tiers + specials + price rules), for detail/edit views */
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
  const [tiers, special_routes, price_rules] = await Promise.all([
    prisma.$queryRaw<Array<{ miles_from: number; amount: string }>>`
      SELECT miles_from, amount::text FROM pay.wage_rule_tiers
      WHERE version_id = ${id}::bigint ORDER BY miles_from
    `,
    prisma.$queryRaw<
      Array<{ from_postal: string; to_postal: string; one_way_amount: string; note: string | null }>
    >`
      SELECT from_postal, to_postal, one_way_amount::text, note
      FROM pay.wage_rule_special_routes WHERE version_id = ${id}::bigint ORDER BY id
    `,
    wageVersionPriceRules(id)
  ]);
  return { ...version, tiers, special_routes, price_rules };
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
  const [tiers, specials, priceRules] = await Promise.all([
    prisma.$queryRaw<Array<{ version_id: string; miles_from: number; amount: string }>>`
      SELECT version_id::text, miles_from, amount::text
      FROM pay.wage_rule_tiers ORDER BY miles_from
    `,
    prisma.$queryRaw<
      Array<{ version_id: string; from_postal: string; to_postal: string; one_way_amount: string }>
    >`
      SELECT version_id::text, from_postal, to_postal, one_way_amount::text
      FROM pay.wage_rule_special_routes ORDER BY id
    `,
    prisma.$queryRaw<
      Array<{
        version_id: string;
        id: string;
        driver_id: string | null;
        unit: string;
        from_class: string | null;
        to_class: string | null;
        operation: string | null;
        label: string | null;
        driver_amount: string;
        owner_amount: string | null;
      }>
    >`
      SELECT version_id::text, id::text, driver_id::text AS driver_id, unit,
             from_class, to_class, operation, label,
             driver_amount::text, owner_amount::text
      FROM pay.wage_rule_prices ORDER BY id
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
      })),
    price_rules: priceRules
      .filter(rule => rule.version_id === version.id)
      .map(rule => ({
        id: rule.id,
        driver_id: rule.driver_id,
        unit: rule.unit as WagePriceRule["unit"],
        from_class: rule.from_class,
        to_class: rule.to_class,
        operation: rule.operation,
        label: rule.label,
        driver_amount: Number(rule.driver_amount),
        owner_amount: rule.owner_amount === null ? null : Number(rule.owner_amount)
      }))
  }));
}
