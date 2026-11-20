"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission, assertDriverScope, getLinkedDriverId } from "@/lib/permissions";
import { calcFuelSubsidy } from "@/lib/wage";
import { resolveEndpointId } from "@/lib/locations";
import { syncStatements, type StatementRef } from "@/lib/statements";
import { periodOf } from "@/lib/period";
import { todayIso } from "@/lib/format";
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

/** Cap for the detail sheet's appended rows (mirrors the entry sheet's caps) */
const MAX_NEW_ROWS = 20;
const MAX_FUEL_ROWS = 50;
const MAX_FEE_ROWS = 20;

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
    /** Dictionary's first ACTIVE code - the same default the sheets open with */
    fallbackOperation: operationRows[0]?.code ?? "",
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
  // plain drivers stay 0 - driver type itself never changes on an edit).
  // Miles ledger as integers: typed decimals round on save, same as entry
  const milesNum = Math.round(num0(str(formData, `${prefix}miles`)));
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
  await requirePermission("trip.write");
  const id = str(formData, "id");
  const backTo = backPath(str(formData, "return_to"));
  if (!id) redirect(backTo);

  const current = await getTripById(id);
  if (!current) redirect(backTo);
  await assertDriverScope(current.driver_id);

  const { validOperations, fuelSubsidyRate } = await pricingContext();
  const refs = await applyTripUpdate(id, current, formData, "", validOperations, fuelSubsidyRate);

  // DRAFT recomputes; VERIFIED only gets the permanent edited flag
  await syncStatements(refs);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}saved=1`);
}

/**
 * Save the whole driver period detail sheet in one submit: dirty legs +
 * appended rows (leg_new_<i>*, INSERTed with entry's lenient semantics),
 * fuel-by-state rows (replace per driver+period, same-state rows merge) and
 * custom-fee rows (replace, never merged). Client-side pre-validation keeps
 * bad rows from reaching the server; the checks below remain the backstop
 * and refuel every typed row through URL params on the way back. Fuel and
 * fees always write (the editors open with the stored truth, so an untouched
 * section rewrites itself); DRAFT/VERIFIED sheets take the payload live,
 * while DONE (archived) sheets only take the payload plus the permanent
 * edited flag - their numbers stay frozen.
 */
export async function saveStatementSheet(formData: FormData) {
  await requirePermission("trip.write");
  const backTo = backPath(str(formData, "return_to"));
  const driverId = str(formData, "driver_id");
  const periodRaw = str(formData, "period");
  if (!/^\d+$/.test(driverId) || !isIsoDate(periodRaw)) redirect("/dashboard/payroll");
  await assertDriverScope(driverId);
  const period = periodOf(periodRaw);

  // ---- Legs: only the dirty ids are written; appended rows INSERT
  const ids = str(formData, "dirty_ids")
    .split(",")
    .map(s => s.trim())
    .filter(id => /^\d+$/.test(id));
  const newRowCount = Math.min(
    Number.parseInt(str(formData, "new_row_count"), 10) || 0,
    MAX_NEW_ROWS
  );
  // Untouched appended rows skip silently (the sheet opens each fresh row
  // with a default date, so content = any endpoint / Load# / note)
  const newRows: Array<{ p: string }> = [];
  for (let i = 0; i < newRowCount; i++) {
    const p = `leg_new_${i}_`;
    const from = str(formData, `${p}from_location`);
    const to = str(formData, `${p}to_location`);
    const loadNo = str(formData, `${p}load_no`);
    const notes = str(formData, `${p}notes`);
    if (!from && !to && !loadNo && !notes) continue;
    newRows.push({ p });
  }

  // ---- Fuel-by-state rows (the default direction/truck code is not content)
  type FuelRow = {
    no: number;
    stateCode: string;
    truckCode: string;
    gallons: number;
    miles: number;
    amount: number;
    note: string;
  };
  const fuelCount = Math.min(
    Number.parseInt(str(formData, "f_fuel_row_count"), 10) || 0,
    MAX_FUEL_ROWS
  );
  const fuelRows: FuelRow[] = [];
  for (let i = 0; i < fuelCount; i++) {
    const p = `f_fuel_row_${i}_`;
    const stateCode = str(formData, `${p}state_code`).toUpperCase().slice(0, 2);
    const gallonsRaw = str(formData, `${p}gallons`);
    const milesRaw = str(formData, `${p}miles`);
    const amountRaw = str(formData, `${p}amount`);
    const note = str(formData, `${p}note`).slice(0, 200);
    if (!stateCode && !gallonsRaw && !milesRaw && !amountRaw && !note) continue;
    fuelRows.push({
      no: i + 1,
      stateCode,
      truckCode: str(formData, `${p}truck_code`).slice(0, 32),
      gallons: num0(gallonsRaw),
      miles: num0(milesRaw),
      amount: num0(amountRaw),
      note
    });
  }

  // ---- Custom-fee rows (amount ADDS to the payout; miles informational)
  type FeeRow = { no: number; label: string; miles: number; amount: number; note: string };
  const feeCount = Math.min(
    Number.parseInt(str(formData, "f_fee_row_count"), 10) || 0,
    MAX_FEE_ROWS
  );
  const feeRows: FeeRow[] = [];
  for (let i = 0; i < feeCount; i++) {
    const p = `f_fee_row_${i}_`;
    const label = str(formData, `${p}label`).slice(0, 60);
    const amountRaw = str(formData, `${p}amount`);
    const milesRaw = str(formData, `${p}miles`);
    const note = str(formData, `${p}note`).slice(0, 200);
    if (!label && !amountRaw && !milesRaw && !note) continue;
    feeRows.push({ no: i + 1, label, miles: num0(milesRaw), amount: num0(amountRaw), note });
  }

  // ---- Backstop validation: refuel everything typed on the way back
  const backWithError = (error: string, rowNo: number): never => {
    const params = new URLSearchParams({ error, period: period.start });
    if (error.startsWith("fuel_")) params.set("fuel", String(rowNo));
    else params.set("fee", String(rowNo));
    const repack = (prefix: string, fields: string[], count: number) => {
      let kept = 0;
      for (let i = 0; i < count; i++) {
        let any = false;
        for (const field of fields) {
          const value = str(formData, `${prefix}${i}_${field}`);
          if (value) {
            params.set(`${prefix}${kept}_${field}`, value);
            any = true;
          }
        }
        if (any) kept++;
      }
      if (kept > 0) params.set(`${prefix}count`, String(kept));
    };
    repack("f_fuel_row_", ["state_code", "gallons", "miles", "amount", "note", "truck_code"], fuelCount);
    repack("f_fee_row_", ["label", "miles", "amount", "note"], feeCount);
    redirect(`${backTo}?${params.toString()}`);
  };

  const stateRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ops.state_codes WHERE is_active
  `;
  const validStates = new Set(stateRows.map(s => s.code));
  for (const row of fuelRows) {
    if (!row.stateCode) backWithError("fuel_missing_state", row.no);
    if (!validStates.has(row.stateCode)) backWithError("fuel_bad_state", row.no);
  }
  for (const row of feeRows) {
    if (!row.label) backWithError("fee_missing_label", row.no);
  }

  // Fuel/fees always write when there is anything to write OR anything to
  // clear (an existing statement may hold rows the editor just emptied);
  // a stray empty submit with no statement at all is a plain no-op
  const hasSectionContent = fuelRows.length > 0 || feeRows.length > 0;
  const existingStatement = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM pay.payroll_statements
    WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
    LIMIT 1
  `;
  const statementExists = existingStatement.length > 0;
  if (
    ids.length === 0 &&
    newRows.length === 0 &&
    !hasSectionContent &&
    !statementExists
  ) {
    redirect(backTo);
  }

  const { validOperations, fallbackOperation, fuelSubsidyRate } = await pricingContext();

  // ---- Legs: updates then inserts, collecting the (driver, period) refs
  const refs: StatementRef[] = [];
  for (const id of ids) {
    const current = await getTripById(id);
    if (!current) continue;
    refs.push(...await applyTripUpdate(id, current, formData, `leg_${id}_`, validOperations, fuelSubsidyRate));
  }

  if (newRows.length > 0) {
    // One driver lookup feeds every appended row: the name snapshot and the
    // subsidy's driver type
    const driverRows = await prisma.$queryRaw<
      Array<{ full_name: string; driver_type: string }>
    >`
      SELECT full_name, driver_type::text AS driver_type
      FROM ops.drivers
      WHERE id = ${driverId}::bigint
      LIMIT 1
    `;
    const driver = driverRows[0];
    if (driver) {
      const today = todayIso();
      for (const { p } of newRows) {
        // Bare endpoint text goes through the txt: protocol like every edit
        const endpoint = (key: string) => {
          const value = str(formData, `${p}${key}`);
          if (!value) return "";
          return value.startsWith("loc:") || value.startsWith("txt:") ? value : `txt:${value}`;
        };
        const [fromId, toId] = await Promise.all([
          resolveEndpointId(endpoint("from_location")),
          resolveEndpointId(endpoint("to_location"))
        ]);
        const rawDate = str(formData, `${p}trip_date`);
        const tripDate = isIsoDate(rawDate) ? rawDate : today;
        const rawOperation = str(formData, `${p}operation`);
        const milesNum = Math.round(num0(str(formData, `${p}miles`)));
        await prisma.$executeRaw`
          INSERT INTO pay.trips
            (driver_id, trip_date, operation, load_no, from_location_id, to_location_id,
             miles, fuel_gallons, pay_amount, fuel_subsidy, notes, driver_name)
          VALUES (${driverId}::bigint, ${tripDate}::date,
                  ${validOperations.has(rawOperation) ? rawOperation : fallbackOperation},
                  ${str(formData, `${p}load_no`)},
                  ${fromId || null}::bigint, ${toId || null}::bigint,
                  ${milesNum},
                  ${Math.round(num0(str(formData, `${p}fuel_gallons`)) * 100) / 100},
                  ${Math.round(num0(str(formData, `${p}pay_amount`)) * 100) / 100},
                  ${calcFuelSubsidy({ driverType: driver.driver_type === "OWNER" ? "OWNER" : "DRIVER", miles: milesNum, rate: fuelSubsidyRate })},
                  ${str(formData, `${p}notes`) || null},
                  ${driver.full_name})
        `;
        refs.push({ driverId, periodStart: periodOf(tripDate).start });
      }
    }
  }

  // ---- Fuel: merge same states (sums per column, first note wins), then
  // the standard two arms - DRAFT upserts, VERIFIED/DONE take fuel + flag.
  // Rows emptied to zero still write (an existing statement may hold the
  // set being cleared)
  if (hasSectionContent || statementExists) {
    if (fuelRows.length > 0 || statementExists) {
      const merged = new Map<string, FuelRow>();
      for (const row of fuelRows) {
        const dup = merged.get(row.stateCode);
        if (dup) {
          dup.gallons += row.gallons;
          dup.miles += row.miles;
          dup.amount += row.amount;
          if (!dup.note) dup.note = row.note;
        } else {
          merged.set(row.stateCode, { ...row });
        }
      }
      const payload = JSON.stringify(
        [...merged.values()].map(r => ({
          truckCode: r.truckCode,
          stateCode: r.stateCode,
          gallons: Math.round(r.gallons * 1000) / 1000,
          miles: Math.round(r.miles * 10) / 10,
          amount: Math.round(r.amount * 100) / 100,
          ...(r.note ? { note: r.note } : {})
        }))
      );
      await prisma.$executeRaw`
        INSERT INTO pay.payroll_statements
          (driver_id, period_start, period_end, trip_days, leg_count, total_miles, total_fuel, total_pay, fuel_detail)
        VALUES (${driverId}::bigint, ${period.start}::date, ${period.end}::date,
                0, 0, 0, 0, 0, ${payload}::jsonb)
        ON CONFLICT (driver_id, period_start) DO UPDATE SET
          fuel_detail = EXCLUDED.fuel_detail, updated_at = now()
        WHERE pay.payroll_statements.status IN ('DRAFT', 'VERIFIED')
      `;
      await prisma.$executeRaw`
        UPDATE pay.payroll_statements
        SET fuel_detail = ${payload}::jsonb, edited_after_verify = true, updated_at = now()
        WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
          AND status = 'DONE'
      `;
    }
  }

  // ---- Fees: replace semantics (no merge), sum written in lockstep
  const feePayload = JSON.stringify(
    feeRows.map(r => ({
      label: r.label,
      miles: Math.round(r.miles * 10) / 10,
      amount: Math.round(r.amount * 100) / 100,
      ...(r.note ? { note: r.note } : {})
    }))
  );
  const feeTotal = Math.round(feeRows.reduce((acc, r) => acc + r.amount, 0) * 100) / 100;
  await prisma.$executeRaw`
    INSERT INTO pay.payroll_statements
      (driver_id, period_start, period_end, trip_days, leg_count, total_miles, total_fuel, total_pay,
       custom_fees, total_custom_fees)
    VALUES (${driverId}::bigint, ${period.start}::date, ${period.end}::date,
            0, 0, 0, 0, 0, ${feePayload}::jsonb, ${feeTotal})
    ON CONFLICT (driver_id, period_start) DO UPDATE SET
      custom_fees = EXCLUDED.custom_fees,
      total_custom_fees = EXCLUDED.total_custom_fees,
      updated_at = now()
    WHERE pay.payroll_statements.status IN ('DRAFT', 'VERIFIED')
  `;
  await prisma.$executeRaw`
    UPDATE pay.payroll_statements
    SET custom_fees = ${feePayload}::jsonb,
        total_custom_fees = ${feeTotal},
        edited_after_verify = true,
        updated_at = now()
    WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
      AND status = 'DONE'
  `;

  await syncStatements(refs);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}saved=1`);
}

export async function deleteTrip(formData: FormData) {
  await requirePermission("trip.write");
  const id = str(formData, "id");
  const backTo = backPath(str(formData, "return_to"));
  if (!id) redirect(backTo);

  // Driver + period are needed to sync the statement after the row is gone
  const current = await getTripById(id);
  if (!current) redirect(backTo);
  await assertDriverScope(current.driver_id);

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
  await requirePermission("trip.write");
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
  // Driver-linked accounts may only batch-delete their own legs
  const linked = await getLinkedDriverId();
  if (linked !== null && doomed.some(r => r.driver_id !== linked)) {
    redirect("/dashboard/forbidden");
  }

  await prisma.$executeRaw`DELETE FROM pay.trips WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))})`;

  await syncStatements(
    doomed.map(r => ({ driverId: r.driver_id, periodStart: periodOf(r.trip_date).start }))
  );

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  redirect(backTo);
}
