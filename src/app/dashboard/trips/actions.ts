"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { calcFuelSubsidy } from "@/lib/wage";
import { resolveEndpointId } from "@/lib/locations";
import { syncStatements, type StatementRef } from "@/lib/statements";
import { periodOf } from "@/lib/period";
import { getTripById, type TripEditRow } from "@/lib/queries/trips";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toString() !== "Invalid Date";
}

/** Bad or negative numbers fall back to 0 - same lenient semantics as entry */
function num0(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Full-path returns land on the driver period detail page; anything else is a
 *  query string against the trips list */
function backPath(returnTo: string) {
  return returnTo.startsWith("/")
    ? returnTo
    : `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
}

/** Pricing context shared by every edit path: ACTIVE operation codes + the
 *  current owner fuel-subsidy rate */
async function pricingContext() {
  const [operationRows, rateRows] = await Promise.all([
    prisma.$queryRaw<Array<{ code: string }>>`
      SELECT code FROM ops.operation_types WHERE status = 'ACTIVE' ORDER BY sort_order, code
    `,
    prisma.$queryRaw<Array<{ rate: string }>>`
      SELECT fuel_subsidy_rate::text AS rate FROM pay.wage_rule_versions
      WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1
    `
  ]);
  return {
    validOperations: new Set(operationRows.map(o => o.code)),
    fuelSubsidyRate: rateRows[0] ? Number(rateRows[0].rate) : 0
  };
}

/**
 * Write one trip's editable fields (shared by the dialog save and the inline
 * ledger batch). Validation-free like entry: invalid date / unknown operation
 * keep the stored value, bad numbers become 0, blank endpoints clear to NULL,
 * bare endpoint text is find-or-created as a location (txt: protocol). Driver
 * and truck snapshot stay untouched - reassigning a trip is not an edit fix.
 * Returns the (driver, period) refs the caller must sync statements for - old
 * AND new period, a date edit may move the leg across the week boundary.
 */
async function applyTripUpdate(
  id: string,
  current: TripEditRow,
  formData: FormData,
  /** Field-name prefix: "" for the dialog, `leg_<id>_` for inline ledger rows */
  prefix: string,
  validOperations: Set<string>,
  fuelSubsidyRate: number
): Promise<StatementRef[]> {
  const rawOperation = str(formData, `${prefix}operation`);

  // Bare endpoint text goes through the txt: protocol (existing code matches,
  // unknown text find-or-creates an OTHER location)
  const endpoint = (key: string) => {
    const value = str(formData, `${prefix}${key}`);
    if (!value) return "";
    return value.startsWith("loc:") || value.startsWith("txt:") ? value : `txt:${value}`;
  };

  const [fromId, toId] = await Promise.all([
    resolveEndpointId(endpoint("from_location")),
    resolveEndpointId(endpoint("to_location"))
  ]);

  // Owner fuel subsidy re-snapshots on every edit (miles x the ACTIVE rate;
  // plain drivers stay 0 - driver type itself never changes on an edit)
  const milesNum = num0(str(formData, `${prefix}miles`));
  const newDate = isIsoDate(str(formData, `${prefix}trip_date`))
    ? str(formData, `${prefix}trip_date`)
    : current.trip_date;

  await prisma.$executeRaw`
    UPDATE pay.trips SET
      trip_date = ${newDate}::date,
      operation = ${validOperations.has(rawOperation) ? rawOperation : current.operation},
      load_no = ${str(formData, `${prefix}load_no`)},
      from_location_id = ${fromId || null}::bigint,
      to_location_id = ${toId || null}::bigint,
      miles = ${milesNum},
      fuel_gallons = ${Math.round(num0(str(formData, `${prefix}fuel_gallons`)) * 100) / 100},
      pay_amount = ${Math.round(num0(str(formData, `${prefix}pay_amount`)) * 100) / 100},
      fuel_subsidy = ${calcFuelSubsidy({ driverType: current.driver_type ?? undefined, miles: milesNum, rate: fuelSubsidyRate })},
      notes = ${str(formData, `${prefix}notes`) || null}
    WHERE id = ${id}::bigint
  `;

  // Statements follow the mutation on both sides of a possible period move
  return [
    { driverId: current.driver_id, periodStart: periodOf(current.trip_date).start },
    { driverId: current.driver_id, periodStart: periodOf(newDate).start }
  ];
}

/**
 * Edit one trip (the ledger dialog's save). See applyTripUpdate for the
 * lenient field semantics.
 */
export async function updateTrip(formData: FormData) {
  await requireUser();
  const id = str(formData, "id");
  const backTo = backPath(str(formData, "return_to"));
  if (!id) redirect(backTo);

  const current = await getTripById(id);
  if (!current) redirect(backTo);

  const { validOperations, fuelSubsidyRate } = await pricingContext();
  const refs = await applyTripUpdate(id, current, formData, "", validOperations, fuelSubsidyRate);

  // DRAFT recomputes; VERIFIED only gets the permanent edited flag
  await syncStatements(refs);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(backTo);
}

/**
 * Save every hand-edited leg of the driver period sheet in one submit.
 * Only the ids listed in dirty_ids are written (unchanged rows submit their
 * inputs too - parsing them would be a no-op, but why pay the round trips).
 */
export async function updateTripsBatch(formData: FormData) {
  await requireUser();
  const backTo = backPath(str(formData, "return_to"));
  const ids = str(formData, "dirty_ids")
    .split(",")
    .map(s => s.trim())
    .filter(id => /^\d+$/.test(id));
  if (ids.length === 0) redirect(backTo);

  const { validOperations, fuelSubsidyRate } = await pricingContext();

  const refs: StatementRef[] = [];
  for (const id of ids) {
    const current = await getTripById(id);
    if (!current) continue;
    refs.push(...await applyTripUpdate(id, current, formData, `leg_${id}_`, validOperations, fuelSubsidyRate));
  }
  await syncStatements(refs);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(backTo);
}

export async function deleteTrip(formData: FormData) {
  await requireUser();
  const id = str(formData, "id");
  const backTo = backPath(str(formData, "return_to"));
  if (!id) redirect(backTo);

  // Driver + period are needed to sync the statement after the row is gone
  const current = await getTripById(id);
  if (!current) redirect(backTo);

  await prisma.$executeRaw`DELETE FROM pay.trips WHERE id = ${id}::bigint`;

  await syncStatements([
    { driverId: current.driver_id, periodStart: periodOf(current.trip_date).start }
  ]);

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  redirect(backTo);
}

export async function deleteTripsBatch(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("selected").map(String).filter(Boolean);
  const returnTo = str(formData, "return_to");
  const backTo = `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
  if (ids.length === 0) redirect(backTo);

  // Affected (driver, period) pairs before the rows disappear
  const doomed = await prisma.$queryRaw<Array<{ driver_id: string; trip_date: string }>>`
    SELECT driver_id::text, to_char(trip_date, 'YYYY-MM-DD') AS trip_date
    FROM pay.trips
    WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))})
  `;

  await prisma.$executeRaw`DELETE FROM pay.trips WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))})`;

  await syncStatements(
    doomed.map(r => ({ driverId: r.driver_id, periodStart: periodOf(r.trip_date).start }))
  );

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  redirect(backTo);
}
