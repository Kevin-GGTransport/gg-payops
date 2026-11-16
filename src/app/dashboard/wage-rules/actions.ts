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
type PriceRuleInput = {
  driver_id: string | null;
  unit: string;
  from_class: string | null;
  to_class: string | null;
  operation: string | null;
  label: string | null;
  driver_amount: number;
  owner_amount: number | null;
};

const PRICE_UNITS = new Set(["LEG", "ROUND_TRIP", "DAY"]);
const PRICE_CLASSES = new Set(["STK", "HW", "SHIPPER", "AMAZON_A", "AMAZON_B"]);

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

/** Flexible price-rule rows; fully blank rows are skipped */
function parsePriceRules(formData: FormData): PriceRuleInput[] {
  const count = Number(str(formData, "price_count") || "0");
  const rules: PriceRuleInput[] = [];
  for (let i = 0; i < count; i++) {
    const p = `price_${i}_`;
    const unit = str(formData, `${p}unit`);
    const driverId = str(formData, `${p}driver_id`);
    const amountRaw = str(formData, `${p}driver_amount`);
    if (!unit && !driverId && !amountRaw) continue;
    const ownerRaw = str(formData, `${p}owner_amount`);
    rules.push({
      driver_id: driverId || null,
      unit,
      from_class: str(formData, `${p}from_class`) || null,
      to_class: str(formData, `${p}to_class`) || null,
      operation: str(formData, `${p}operation`) || null,
      label: str(formData, `${p}label`) || null,
      driver_amount: Number(amountRaw),
      owner_amount: ownerRaw === "" ? null : Number(ownerRaw)
    });
  }
  return rules;
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
  prices: PriceRuleInput[];
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
  for (const rule of input.prices) {
    if (!PRICE_UNITS.has(rule.unit)) return "bad_price_unit";
    if (rule.driver_id !== null && !/^\d+$/.test(rule.driver_id)) return "bad_price_driver";
    if (
      (rule.from_class !== null && !PRICE_CLASSES.has(rule.from_class)) ||
      (rule.to_class !== null && !PRICE_CLASSES.has(rule.to_class))
    ) {
      return "bad_price_class";
    }
    if (!(rule.driver_amount >= 0)) return "bad_price_amount";
    if (rule.owner_amount !== null && !(rule.owner_amount >= 0)) return "bad_price_amount";
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

/** Replace a version's whole child payload (params + tiers + specials + prices) */
async function writeVersionChildren(
  id: string,
  input: {
    name: string;
    effectiveFrom: string;
    ownerMultiplier: number;
    bobtailMultiplier: number;
    overageIncrement: number;
    tiers: TierInput[];
    specials: SpecialInput[];
    prices: PriceRuleInput[];
  }
) {
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE pay.wage_rule_versions SET
        name = ${input.name}, effective_from = ${input.effectiveFrom}::date,
        owner_multiplier = ${input.ownerMultiplier}, bobtail_multiplier = ${input.bobtailMultiplier},
        overage_increment = ${input.overageIncrement}, updated_at = now()
      WHERE id = ${id}::bigint
    `,
    prisma.$executeRaw`DELETE FROM pay.wage_rule_tiers WHERE version_id = ${id}::bigint`,
    ...input.tiers.map(tier =>
      prisma.$executeRaw`
        INSERT INTO pay.wage_rule_tiers(version_id, miles_from, amount)
        VALUES (${id}::bigint, ${tier.miles_from}, ${tier.amount})
      `
    ),
    prisma.$executeRaw`DELETE FROM pay.wage_rule_special_routes WHERE version_id = ${id}::bigint`,
    ...input.specials.map(special =>
      prisma.$executeRaw`
        INSERT INTO pay.wage_rule_special_routes(version_id, from_postal, to_postal, one_way_amount, note)
        VALUES (${id}::bigint, ${special.from_postal}, ${special.to_postal}, ${special.one_way_amount}, ${special.note})
      `
    ),
    prisma.$executeRaw`DELETE FROM pay.wage_rule_prices WHERE version_id = ${id}::bigint`,
    ...input.prices.map(rule =>
      prisma.$executeRaw`
        INSERT INTO pay.wage_rule_prices(version_id, driver_id, unit, from_class, to_class,
                                         operation, label, driver_amount, owner_amount)
        VALUES (${id}::bigint, ${rule.driver_id}::bigint, ${rule.unit}, ${rule.from_class},
                ${rule.to_class}, ${rule.operation}, ${rule.label}, ${rule.driver_amount},
                ${rule.owner_amount})
      `
    )
  ]);
}

/**
 * Save the rules of the version the form shows. A version already effective
 * BEFORE today is locked history: saving clones it into a new version
 * effective TODAY (same params + children) and writes the edits there - the
 * user just edits and saves, version bookkeeping stays automatic. Versions
 * effective today or later save in place.
 */
export async function saveVersion(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const back = (error: string) => `/dashboard/wage-rules?v=${id}&error=${error}`;

  const existing = await prisma.$queryRaw<
    Array<{ effective_from: string }>
  >`
    SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from
    FROM pay.wage_rule_versions WHERE id = ${id}::bigint LIMIT 1
  `;
  if (existing.length === 0) redirect("/dashboard/wage-rules");

  const today = todayIso();
  let targetId = id;
  if (existing[0].effective_from < today) {
    // Locked history -> clone to a today-effective version first
    if (await effectiveDateTaken(today, id)) redirect("/dashboard/wage-rules?error=dup_date");
    const inserted = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO pay.wage_rule_versions(name, effective_from, owner_multiplier, bobtail_multiplier, overage_increment, notes)
      SELECT name, ${today}::date, owner_multiplier, bobtail_multiplier, overage_increment,
             concat('自版本 #', ${id}::bigint::text, ' 复制调价')
      FROM pay.wage_rule_versions WHERE id = ${id}::bigint
      RETURNING id::text
    `;
    targetId = inserted[0]?.id ?? id;
    await prisma.$executeRaw`
      INSERT INTO pay.wage_rule_tiers(version_id, miles_from, amount)
      SELECT ${targetId}::bigint, miles_from, amount FROM pay.wage_rule_tiers
      WHERE version_id = ${id}::bigint
    `;
    await prisma.$executeRaw`
      INSERT INTO pay.wage_rule_special_routes(version_id, from_postal, to_postal, one_way_amount, note)
      SELECT ${targetId}::bigint, from_postal, to_postal, one_way_amount, note
      FROM pay.wage_rule_special_routes WHERE version_id = ${id}::bigint
    `;
    await prisma.$executeRaw`
      INSERT INTO pay.wage_rule_prices(version_id, driver_id, unit, from_class, to_class,
                                       operation, label, driver_amount, owner_amount)
      SELECT ${targetId}::bigint, driver_id, unit, from_class, to_class, operation, label,
             driver_amount, owner_amount
      FROM pay.wage_rule_prices WHERE version_id = ${id}::bigint
    `;
  }

  const name = str(formData, "name");
  const effectiveFrom = str(formData, "effective_from") || today;
  const ownerMultiplier = Number(str(formData, "owner_multiplier"));
  const bobtailMultiplier = Number(str(formData, "bobtail_multiplier"));
  const overageIncrement = Number(str(formData, "overage_increment"));
  const tiers = parseTiers(formData);
  const specials = parseSpecials(formData);
  const prices = parsePriceRules(formData);

  const error = validateVersion({
    name, effectiveFrom, ownerMultiplier, bobtailMultiplier, overageIncrement, tiers, specials, prices
  });
  if (error) redirect(back(error));
  // The cloned target is born today; hand-edited dates may not slip into the past
  if (effectiveFrom < today) redirect(back("past_date"));
  if (await effectiveDateTaken(effectiveFrom, targetId)) redirect(back("dup_date"));

  await writeVersionChildren(targetId, {
    name, effectiveFrom, ownerMultiplier, bobtailMultiplier, overageIncrement, tiers, specials, prices
  });

  revalidatePath("/dashboard/wage-rules");
  revalidatePath("/dashboard");
  redirect(`/dashboard/wage-rules?v=${targetId}&saved=1`);
}

/** Copy an existing version (params + children) under a new date (advanced: schedule) */
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
  // Today is allowed (same-day adjustment); before today would be born locked
  if (effectiveFrom < todayIso()) redirect(back("past_date"));
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
  await prisma.$executeRaw`
    INSERT INTO pay.wage_rule_prices(version_id, driver_id, unit, from_class, to_class,
                                     operation, label, driver_amount, owner_amount)
    SELECT ${newId}::bigint, driver_id, unit, from_class, to_class, operation, label,
           driver_amount, owner_amount
    FROM pay.wage_rule_prices WHERE version_id = ${sourceId}::bigint
  `;

  revalidatePath("/dashboard/wage-rules");
  revalidatePath("/dashboard");
  redirect(`/dashboard/wage-rules?v=${newId}`);
}

/**
 * Amazon warehouse dictionary prices (round-trip standard pay + A/B class).
 * These are dictionary values, not versioned pricing - they write straight
 * to ops.locations.
 */
export async function saveWarehousePrices(formData: FormData) {
  await requireUser();

  const count = Number(str(formData, "warehouse_count") || "0");
  for (let i = 0; i < count; i++) {
    const id = str(formData, `warehouse_${i}_id`);
    if (!id || !/^\d+$/.test(id)) continue;
    const amazonClass = str(formData, `warehouse_${i}_amazon_class`);
    const payRaw = str(formData, `warehouse_${i}_standard_pay`);
    const pay = Number(payRaw);
    await prisma.$executeRaw`
      UPDATE ops.locations SET
        amazon_class = ${amazonClass === "A" || amazonClass === "B" ? amazonClass : null},
        standard_pay_amount = ${Number.isFinite(pay) && pay >= 0 ? pay : 0},
        updated_at = now()
      WHERE id = ${id}::bigint AND location_type = 'AMAZON'
    `;
  }

  revalidatePath("/dashboard/wage-rules");
  revalidatePath("/dashboard");
  redirect("/dashboard/wage-rules?warehouses=1");
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
