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
           (SELECT count(*)::int FROM pay.wage_rule_prices p
             WHERE p.version_id = v.id) AS price_rule_count,
           v.status, v.notes
    FROM pay.wage_rule_versions v
    LEFT JOIN pay.wage_rule_tiers t ON t.version_id = v.id
    GROUP BY v.id
    ORDER BY v.effective_from DESC
  `;
}

/** Shape of one price rule row with endpoint codes for display */
export type WagePriceRuleRow = WagePriceRule & {
  from_code: string | null;
  to_code: string | null;
};

type PriceRuleRaw = {
  version_id: string;
  id: string;
  driver_id: string | null;
  unit: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_tag: string | null;
  to_tag: string | null;
  from_code: string | null;
  to_code: string | null;
  operation: string | null;
  label: string | null;
  driver_amount: string;
  owner_amount: string | null;
};

function mapPriceRule(row: PriceRuleRaw): WagePriceRuleRow {
  return {
    id: row.id,
    driver_id: row.driver_id,
    unit: row.unit as WagePriceRule["unit"],
    from_location_id: row.from_location_id,
    to_location_id: row.to_location_id,
    from_tag: row.from_tag,
    to_tag: row.to_tag,
    from_code: row.from_code,
    to_code: row.to_code,
    operation: row.operation,
    label: row.label,
    driver_amount: Number(row.driver_amount),
    owner_amount: row.owner_amount === null ? null : Number(row.owner_amount)
  };
}

/** Flexible price rules of one version, insertion order */
export async function wageVersionPriceRules(versionId: string): Promise<WagePriceRuleRow[]> {
  const rows = await prisma.$queryRaw<PriceRuleRaw[]>`
    SELECT p.id::text, p.driver_id::text AS driver_id, p.unit,
           p.from_location_id::text AS from_location_id,
           p.to_location_id::text AS to_location_id,
           p.from_tag, p.to_tag,
           f.code AS from_code, t.code AS to_code,
           p.operation, p.label, p.driver_amount::text, p.owner_amount::text
    FROM pay.wage_rule_prices p
    LEFT JOIN ops.locations f ON f.id = p.from_location_id
    LEFT JOIN ops.locations t ON t.id = p.to_location_id
    WHERE p.version_id = ${versionId}::bigint ORDER BY p.id
  `;
  return rows.map(mapPriceRule);
}

/** One version's full data (params + tiers + price rules), for detail/edit views */
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
  const [tiers, price_rules] = await Promise.all([
    prisma.$queryRaw<Array<{ miles_from: number; amount: string }>>`
      SELECT miles_from, amount::text FROM pay.wage_rule_tiers
      WHERE version_id = ${id}::bigint ORDER BY miles_from
    `,
    wageVersionPriceRules(id)
  ]);
  return { ...version, tiers, price_rules };
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
  const [tiers, priceRules] = await Promise.all([
    prisma.$queryRaw<Array<{ version_id: string; miles_from: number; amount: string }>>`
      SELECT version_id::text, miles_from, amount::text
      FROM pay.wage_rule_tiers ORDER BY miles_from
    `,
    prisma.$queryRaw<PriceRuleRaw[]>`
      SELECT p.version_id::text, p.id::text, p.driver_id::text AS driver_id, p.unit,
             p.from_location_id::text AS from_location_id,
             p.to_location_id::text AS to_location_id,
             p.from_tag, p.to_tag,
             f.code AS from_code, t.code AS to_code,
             p.operation, p.label, p.driver_amount::text, p.owner_amount::text
      FROM pay.wage_rule_prices p
      LEFT JOIN ops.locations f ON f.id = p.from_location_id
      LEFT JOIN ops.locations t ON t.id = p.to_location_id
      ORDER BY p.id
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
    price_rules: priceRules
      .filter(rule => rule.version_id === version.id)
      .map(rule => ({
        id: rule.id,
        driver_id: rule.driver_id,
        unit: rule.unit as WagePriceRule["unit"],
        from_location_id: rule.from_location_id,
        to_location_id: rule.to_location_id,
        from_tag: rule.from_tag,
        to_tag: rule.to_tag,
        operation: rule.operation,
        label: rule.label,
        driver_amount: Number(rule.driver_amount),
        owner_amount: rule.owner_amount === null ? null : Number(rule.owner_amount)
      }))
  }));
}
