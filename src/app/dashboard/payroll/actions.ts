"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { syncStatements } from "@/lib/statements";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function revalidateStatementViews() {
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard");
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
