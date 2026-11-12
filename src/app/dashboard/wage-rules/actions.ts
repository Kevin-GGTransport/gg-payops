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

/** Shared validation for a full version payload; returns an error code or null */
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
  // Bands after the first sit on multiples of 50 (50-99, 100-149, ...);
  // the 1 -> 50 jump is 49 by design (1-49 is the opening band)
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i].miles_from;
    if (from % 50 !== 0 || from <= sorted[i - 1].miles_from) return "tiers_not_50_step";
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
  // Locked once effective (<= today): history stays auditable
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
