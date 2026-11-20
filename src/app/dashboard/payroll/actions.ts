"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { syncStatements } from "@/lib/statements";
import { periodOf } from "@/lib/period";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function revalidateStatementViews() {
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard");
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toString() !== "Invalid Date";
}

/** Bad or negative numbers fall back to 0 - same lenient rule as the sheet */
function num0(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const MAX_FUEL_ROWS = 50;

/**
 * Save the statement detail sheet's fuel-by-state editor. Same storage and
 * lifecycle rules as the entry sheet's fuel section (replace semantics per
 * (driver, period), same-state rows merge, DRAFT takes the payload while
 * VERIFIED keeps frozen numbers and only takes fuel + the permanent red
 * flag) - this is the in-place fix surface, the entry sheet is the capture
 * surface. An all-empty submit is a legitimate clear here (no trips are
 * required to ride along).
 */
export async function saveStatementFuel(formData: FormData) {
  await requireUser();

  const driverId = str(formData, "driver_id");
  const periodRaw = str(formData, "period");
  if (!driverId || !isIsoDate(periodRaw)) redirect("/dashboard/payroll");
  const period = periodOf(periodRaw);
  const base = `/dashboard/trips/${driverId}`;

  const rowCount = Math.min(
    Number.parseInt(str(formData, "f_fuel_row_count"), 10) || 0,
    MAX_FUEL_ROWS
  );
  type Row = {
    no: number;
    stateCode: string;
    truckCode: string;
    gallons: number;
    miles: number;
    amount: number;
    note: string;
  };
  const rows: Row[] = [];
  for (let i = 0; i < rowCount; i++) {
    const p = `f_fuel_row_${i}_`;
    const stateCode = str(formData, `${p}state_code`).toUpperCase().slice(0, 2);
    const gallonsRaw = str(formData, `${p}gallons`);
    const milesRaw = str(formData, `${p}miles`);
    const amountRaw = str(formData, `${p}amount`);
    const note = str(formData, `${p}note`).slice(0, 200);
    if (!stateCode && !gallonsRaw && !milesRaw && !amountRaw && !note) continue;
    rows.push({
      no: i + 1,
      stateCode,
      truckCode: str(formData, `${p}truck_code`).slice(0, 32),
      gallons: num0(gallonsRaw),
      miles: num0(milesRaw),
      amount: num0(amountRaw),
      note
    });
  }

  const backWithError = (error: string, fuelNo: number): never => {
    const params = new URLSearchParams({ error, fuel: String(fuelNo), period: period.start });
    let kept = 0;
    for (let i = 0; i < rowCount; i++) {
      let any = false;
      for (const field of ["state_code", "gallons", "miles", "amount", "note", "truck_code"]) {
        const value = str(formData, `f_fuel_row_${i}_${field}`);
        if (value) {
          params.set(`f_fuel_row_${kept}_${field}`, value);
          any = true;
        }
      }
      if (any) kept++;
    }
    if (kept > 0) params.set("f_fuel_row_count", String(kept));
    redirect(`${base}?${params.toString()}`);
  };

  const stateRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ops.state_codes WHERE is_active
  `;
  const validStates = new Set(stateRows.map(s => s.code));
  for (const row of rows) {
    if (!row.stateCode) backWithError("fuel_missing_state", row.no);
    if (!validStates.has(row.stateCode)) backWithError("fuel_bad_state", row.no);
  }

  // Merge same states (sums per column, first note wins) - the editor may
  // legitimately hold two rows for one state
  const merged = new Map<string, Row>();
  for (const row of rows) {
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
    WHERE pay.payroll_statements.status = 'DRAFT'
  `;
  await prisma.$executeRaw`
    UPDATE pay.payroll_statements
    SET fuel_detail = ${payload}::jsonb, edited_after_verify = true, updated_at = now()
    WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
      AND status IN ('VERIFIED', 'DONE')
  `;

  revalidateStatementViews();
  revalidatePath(`/dashboard/trips/${driverId}`);
  redirect(`${base}?period=${period.start}&fuel_saved=${merged.size}`);
}

/**
 * Freeze one statement: refresh the aggregates off the live trips one last
 * time (drafts always track live, so this only guards against a race) and
 * flip to VERIFIED. One-way and permanent - there is no un-verify, and later
 * trip changes only set the red edited_after_verify flag.
 */
export async function verifyStatement(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const returnTo = str(formData, "return_to");
  if (!id) redirect("/dashboard/payroll");

  const rows = await prisma.$queryRaw<
    Array<{ driver_id: string; period_start: string }>
  >`
    SELECT driver_id::text, to_char(period_start, 'YYYY-MM-DD') AS period_start
    FROM pay.payroll_statements
    WHERE id = ${id}::bigint AND status = 'DRAFT'
    LIMIT 1
  `;
  const target = rows[0];
  if (target) {
    await syncStatements([
      { driverId: target.driver_id, periodStart: target.period_start }
    ]);
    await prisma.$executeRaw`
      UPDATE pay.payroll_statements
      SET status = 'VERIFIED', edited_after_verify = false, updated_at = now()
      WHERE id = ${id}::bigint AND status = 'DRAFT'
    `;
  }

  revalidateStatementViews();
  redirect(returnTo || "/dashboard/payroll");
}

/**
 * Mark one statement as driver-confirmed (the DONE enum slot): only a
 * VERIFIED sheet can advance - verification stays the required first step -
 * and the numbers are already frozen since then, so nothing is recomputed.
 * One-way like verify: no un-confirm exists.
 */
export async function confirmDriverStatement(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const returnTo = str(formData, "return_to");
  if (!id) redirect("/dashboard/payroll");

  await prisma.$executeRaw`
    UPDATE pay.payroll_statements
    SET status = 'DONE', updated_at = now()
    WHERE id = ${id}::bigint AND status = 'VERIFIED'
  `;

  revalidateStatementViews();
  redirect(returnTo || "/dashboard/payroll");
}

/** Why a copy was refused; the dialog maps these to Chinese messages */
export type CopyErrorCode =
  | "bad_request"
  | "no_trips"
  | "source_not_draft"
  | "target_same"
  | "target_missing"
  | "target_verified"
  | "target_has_trips";

/**
 * Duplicate one DRAFT statement's whole leg set onto another driver. Dates,
 * operations, loads, endpoints, miles and pay_amount are copied verbatim
 * (manual price overrides and package structures survive); only the identity
 * columns are rewritten - driver_id/driver_name to the target, truck_snapshot
 * to the picked truck - and fuel subsidy is re-derived for the TARGET's type
 * at the current ACTIVE rate (same snapshot-at-write rule as entry, never
 * copied: an owner target earns the subsidy, a driver target does not).
 * Source trips stay untouched - this is a copy, not a move.
 *
 * All guards run inside one transaction. The target driver row is locked
 * FOR UPDATE first, which serializes concurrent copies onto the same target
 * (the second one then sees the first's trips and refuses); the target
 * statement row lock fences a verify racing this copy - inserting into a just-
 * verified statement would only set the permanent red flag, so it is blocked
 * instead. On success the target statement is synced (draft recomputed) and
 * the browser lands on the target's detail sheet.
 */
export async function copyStatement(
  formData: FormData
): Promise<{ ok: false; code: CopyErrorCode } | undefined> {
  await requireUser();

  const id = str(formData, "id");
  const targetDriverId = str(formData, "target_driver_id");
  const targetTruckId = str(formData, "target_truck_id");
  if (!id || !targetDriverId) return { ok: false, code: "bad_request" };

  // Owner fuel subsidy rate comes from the ACTIVE rule version server-side,
  // same source as entry (the stored snapshot is authoritative)
  const rateRows = await prisma.$queryRaw<Array<{ rate: string }>>`
    SELECT fuel_subsidy_rate::text AS rate FROM pay.wage_rule_versions
    WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1
  `;
  const fuelSubsidyRate = rateRows[0] ? Number(rateRows[0].rate) : 0;

  type CopyGuard = { code: CopyErrorCode };
  type CopyDone = { periodStart: string };

  const result: CopyGuard | CopyDone = await prisma.$transaction(async tx => {
    const sources = await tx.$queryRaw<
      Array<{ driver_id: string; period_start: string; period_end: string }>
    >`
      SELECT driver_id::text,
             to_char(period_start, 'YYYY-MM-DD') AS period_start,
             to_char(period_end, 'YYYY-MM-DD') AS period_end
      FROM pay.payroll_statements
      WHERE id = ${id}::bigint AND status = 'DRAFT'
      LIMIT 1
    `;
    const source = sources[0];
    if (!source) return { code: "source_not_draft" as const };
    if (source.driver_id === targetDriverId) return { code: "target_same" as const };

    // Lock the target driver row: the serialization point for copies onto the
    // same target (the statement row may not exist yet, trips have no lockable
    // "nothing" to grab). Inactive drivers still show old statements, so being
    // stricter than the picker here is intentional.
    const targets = await tx.$queryRaw<
      Array<{ full_name: string; driver_type: string }>
    >`
      SELECT full_name, driver_type::text AS driver_type
      FROM ops.drivers
      WHERE id = ${targetDriverId}::bigint AND status = 'ACTIVE'
      LIMIT 1
      FOR UPDATE
    `;
    const target = targets[0];
    if (!target) return { code: "target_missing" as const };

    // If the target already has a statement, lock its row and require DRAFT -
    // copying into a verified one would only raise the permanent red flag
    const existing = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status
      FROM pay.payroll_statements
      WHERE driver_id = ${targetDriverId}::bigint
        AND period_start = ${source.period_start}::date
      FOR UPDATE
    `;
    if (existing[0] && existing[0].status !== "DRAFT") {
      return { code: "target_verified" as const };
    }

    // The target must be a clean slate for the period - appending would double
    // the same work on two pay sheets
    const counts = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pay.trips
      WHERE driver_id = ${targetDriverId}::bigint
        AND trip_date >= ${source.period_start}::date
        AND trip_date <= ${source.period_end}::date
    `;
    if (Number(counts[0]?.count ?? 0) > 0) return { code: "target_has_trips" as const };

    // Truck snapshot: the picked truck's full record, frozen (entry-time
    // pattern); an unknown or deactivated truck simply stores no snapshot
    let truckSnapshot: string | null = null;
    if (targetTruckId) {
      const trucks = await tx.$queryRaw<
        Array<{
          truck_code: string;
          plate_no: string | null;
          truck_type: string | null;
          capacity_note: string | null;
        }>
      >`
        SELECT truck_code, plate_no, truck_type, capacity_note
        FROM ops.trucks
        WHERE id = ${targetTruckId}::bigint AND status = 'ACTIVE'
        LIMIT 1
      `;
      const truck = trucks[0];
      if (truck) {
        truckSnapshot = JSON.stringify({
          truck_id: targetTruckId,
          truck_code: truck.truck_code,
          plate_no: truck.plate_no,
          truck_type: truck.truck_type,
          capacity_note: truck.capacity_note
        });
      }
    }

    const inserted = await tx.$executeRaw`
      INSERT INTO pay.trips(driver_id, trip_date, operation, load_no,
        from_location_id, to_location_id, miles, fuel_gallons, pay_amount, fuel_subsidy, notes,
        driver_name, truck_snapshot, package_id, package_note)
      SELECT ${targetDriverId}::bigint, t.trip_date, t.operation, t.load_no,
             t.from_location_id, t.to_location_id, t.miles, t.fuel_gallons, t.pay_amount,
             CASE WHEN ${target.driver_type} = 'OWNER'
                  THEN round(t.miles * ${fuelSubsidyRate}::numeric, 2)
                  ELSE 0 END,
             t.notes, ${target.full_name}, ${truckSnapshot}::jsonb,
             t.package_id, t.package_note
      FROM pay.trips t
      WHERE t.driver_id = ${source.driver_id}::bigint
        AND t.trip_date >= ${source.period_start}::date
        AND t.trip_date <= ${source.period_end}::date
    `;
    if (inserted === 0) return { code: "no_trips" as const };
    return { periodStart: source.period_start };
  });

  if ("code" in result) return { ok: false, code: result.code };

  // Only the target needs syncing - the source's trips did not change. Drafts
  // always track the live ledger, so this creates the target statement if the
  // driver had none and recomputes it otherwise.
  await syncStatements([{ driverId: targetDriverId, periodStart: result.periodStart }]);

  revalidateStatementViews();
  redirect(`/dashboard/trips/${targetDriverId}?period=${result.periodStart}`);
}

/** Why a truck change was refused; the dialog maps these to Chinese messages */
export type ChangeTruckErrorCode =
  | "bad_request"
  | "statement_missing"
  | "truck_missing"
  | "no_trips";

/**
 * Re-stamp one statement's whole period onto a different truck: every leg's
 * truck_snapshot is replaced with the picked truck's full record (entry-time
 * pattern); dates, amounts and package structures stay exactly as stored.
 * Unlike the copy this is allowed on VERIFIED sheets too - a wrong truck is a
 * bookkeeping fix, not a pay change - so syncStatements only raises the
 * permanent red flag there, and the frozen sheets' trucks annotation is
 * refreshed separately below (money stays frozen) so the list column and the
 * export banner show the truck that actually hauled.
 *
 * The statement row is locked FOR UPDATE first, the same serialization point
 * the copy uses, so a verify or copy racing this rewrite lands strictly
 * before or after it - never interleaved.
 */
export async function changeStatementTruck(
  formData: FormData
): Promise<{ ok: false; code: ChangeTruckErrorCode } | undefined> {
  await requireUser();

  const id = str(formData, "id");
  const targetTruckId = str(formData, "target_truck_id");
  const returnTo = str(formData, "return_to");
  if (!id || !targetTruckId) return { ok: false, code: "bad_request" };

  type Guard = { code: ChangeTruckErrorCode };
  type Done = { driverId: string; periodStart: string; periodEnd: string };

  const result: Guard | Done = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<
      Array<{ driver_id: string; period_start: string; period_end: string }>
    >`
      SELECT driver_id::text,
             to_char(period_start, 'YYYY-MM-DD') AS period_start,
             to_char(period_end, 'YYYY-MM-DD') AS period_end
      FROM pay.payroll_statements
      WHERE id = ${id}::bigint
      FOR UPDATE
    `;
    const statement = rows[0];
    if (!statement) return { code: "statement_missing" as const };

    // Truck snapshot: the picked truck's full record, frozen (entry-time
    // pattern); an unknown or deactivated truck refuses the change
    const trucks = await tx.$queryRaw<
      Array<{
        truck_code: string;
        plate_no: string | null;
        truck_type: string | null;
        capacity_note: string | null;
      }>
    >`
      SELECT truck_code, plate_no, truck_type, capacity_note
      FROM ops.trucks
      WHERE id = ${targetTruckId}::bigint AND status = 'ACTIVE'
      LIMIT 1
    `;
    const truck = trucks[0];
    if (!truck) return { code: "truck_missing" as const };
    const truckSnapshot = JSON.stringify({
      truck_id: targetTruckId,
      truck_code: truck.truck_code,
      plate_no: truck.plate_no,
      truck_type: truck.truck_type,
      capacity_note: truck.capacity_note
    });

    const updated = await tx.$executeRaw`
      UPDATE pay.trips
      SET truck_snapshot = ${truckSnapshot}::jsonb, updated_at = now()
      WHERE driver_id = ${statement.driver_id}::bigint
        AND trip_date >= ${statement.period_start}::date
        AND trip_date <= ${statement.period_end}::date
    `;
    if (updated === 0) return { code: "no_trips" as const };
    return {
      driverId: statement.driver_id,
      periodStart: statement.period_start,
      periodEnd: statement.period_end
    };
  });

  if ("code" in result) return { ok: false, code: result.code };

  // Drafts recompute in place (trucks included); VERIFIED/DONE only get the
  // red flag - which is why their frozen trucks annotation needs the extra
  // refresh
  await syncStatements([{ driverId: result.driverId, periodStart: result.periodStart }]);
  await prisma.$executeRaw`
    UPDATE pay.payroll_statements s
    SET trucks = COALESCE(agg.trucks, ''), updated_at = now()
    FROM (
      SELECT string_agg(DISTINCT t.truck_snapshot->>'truck_code', ', ' ORDER BY t.truck_snapshot->>'truck_code') AS trucks
      FROM pay.trips t
      WHERE t.driver_id = ${result.driverId}::bigint
        AND t.trip_date >= ${result.periodStart}::date
        AND t.trip_date <= ${result.periodEnd}::date
    ) agg
    WHERE s.driver_id = ${result.driverId}::bigint
      AND s.period_start = ${result.periodStart}::date
      AND s.status IN ('VERIFIED', 'DONE')
  `;

  revalidateStatementViews();
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}saved=1`);
}
