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
