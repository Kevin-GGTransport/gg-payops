"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { calcFuelSubsidy } from "@/lib/wage";
import type { DriverType } from "@/lib/labels";
import { resolveEndpointId } from "@/lib/locations";
import { syncStatements } from "@/lib/statements";
import { periodOf } from "@/lib/period";
import { todayIso } from "@/lib/format";

const MAX_GROUPS = 20;
const MAX_ROWS_PER_GROUP = 50;
const MAX_ROWS_TOTAL = 200;

type ParsedRow = {
  tripDate: string;
  operation: string;
  loadNo: string;
  from: string;
  to: string;
  milesNum: number;
  fuelNum: number;
  payNum: number;
  notes: string;
  /** Shared marker for legs of one priced package (first leg carries the amount) */
  packageId: string | null;
  packageNote: string | null;
};

type ParsedGroup = {
  driverId: string;
  /** Group-level truck (车号): snapshotted at submit, not a stored FK */
  truckId: string;
  rows: ParsedRow[];
};

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function clampCount(value: string, max: number) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toString() !== "Invalid Date";
}

/** Bad or negative numbers fall back to 0 - entry is validation-free, the sheet numeric columns are NOT NULL DEFAULT 0 */
function num0(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const ROW_FIELDS = [
  "trip_date",
  "operation",
  "load_no",
  "from_location",
  "to_location",
  "miles",
  "fuel_gallons",
  "pay_amount",
  "notes"
] as const;

/**
 * Pack every group's raw input as refill params. Groups are renumbered 0..n
 * sequentially; skipIndex drops one group (a single-tab submit that succeeded
 * - that tab is done, the rest come back filled). Returns how many survived.
 */
function packRefill(
  params: URLSearchParams,
  formData: FormData,
  groups: ParsedGroup[],
  skipIndex?: number
) {
  let kept = 0;
  for (let g = 0; g < groups.length; g++) {
    if (g === skipIndex) continue;
    const group = groups[g];
    if (group.driverId) params.set(`f_g_${kept}_driver_id`, group.driverId);
    if (group.truckId) params.set(`f_g_${kept}_truck_id`, group.truckId);
    // Pricing state (计价 mode + manual package amounts): opaque passthrough so
    // hand-edited package prices survive the refill remount
    const pkgState = str(formData, `g_${g}_pkg_state`);
    if (pkgState) params.set(`f_g_${kept}_pkg_state`, pkgState);
    params.set(`f_g_${kept}_row_count`, String(group.rows.length));
    for (let i = 0; i < group.rows.length; i++) {
      for (const field of ROW_FIELDS) {
        const value = str(formData, `g_${g}_row_${i}_${field}`);
        if (value) params.set(`f_g_${kept}_row_${i}_${field}`, value);
      }
    }
    kept++;
  }
  params.set("f_group_count", String(kept));
  return kept;
}

/**
 * Redirect back to the entry page with the error code, the failing group,
 * and every group's input refilled (the failing group's tab opens).
 */
function backWithError(
  error: string,
  formData: FormData,
  groups: ParsedGroup[],
  grp?: number
): never {
  const params = new URLSearchParams({ error });
  if (grp !== undefined) {
    params.set("grp", String(grp));
    params.set("tab", String(grp - 1));
  }
  packRefill(params, formData, groups);
  redirect(`/dashboard?${params.toString()}`);
}

/**
 * Entry is validation-free by design: every submitted row goes in with
 * defaults filling the gaps (missing date -> business today, unknown
 * operation -> the dictionary's first code, bad numbers -> 0, missing
 * endpoints -> NULL). Only two things still block: no driver on a group
 * (driver_id is a NOT NULL FK - a trip cannot exist without an owner)
 * and an empty batch.
 */
export async function addTripsBatch(formData: FormData) {
  await requireUser();

  const groupCount = clampCount(str(formData, "group_count"), MAX_GROUPS);
  if (groupCount === 0) backWithError("no_rows", formData, []);

  // A tab's own submit button carries its group index; absent = submit all tabs
  const scopeRaw = str(formData, "submit_group");
  const scopeNum = Number.parseInt(scopeRaw, 10);
  const scope =
    scopeRaw !== "" && Number.isInteger(scopeNum) && scopeNum >= 0 && scopeNum < groupCount
      ? scopeNum
      : null;

  // Operation dictionary: rows with no/unknown operation fall back to the
  // dictionary's first ACTIVE code (same default the entry sheet opens with)
  const operationRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ops.operation_types WHERE status = 'ACTIVE' ORDER BY sort_order, code
  `;
  if (operationRows.length === 0) backWithError("missing_operation", formData, []);
  const fallbackOperation = operationRows[0].code;
  const validOperations = new Set(operationRows.map(o => o.code));

  const today = todayIso();
  const groups: ParsedGroup[] = [];
  let total = 0;
  for (let g = 0; g < groupCount; g++) {
    const rowCount = Math.min(
      clampCount(str(formData, `g_${g}_row_count`), MAX_ROWS_PER_GROUP),
      MAX_ROWS_TOTAL - total
    );
    const rows: ParsedRow[] = [];
    for (let i = 0; i < rowCount; i++) {
      const p = `g_${g}_row_${i}_`;
      const rawDate = str(formData, `${p}trip_date`);
      const rawOperation = str(formData, `${p}operation`);
      // Reserve rows the clerk never touched are skipped silently (the sheet
      // opens with 10 blank rows). A start alone does NOT count: the sticky
      // carry-over fills the next leg's start automatically - a real row has
      // a destination, a Load# or a note
      const loadNo = str(formData, `${p}load_no`);
      const notes = str(formData, `${p}notes`);
      const to = str(formData, `${p}to_location`);
      if (!to && !loadNo && !notes) continue;
      rows.push({
        // Missing/invalid date falls back to the business today (US Pacific)
        tripDate: isIsoDate(rawDate) ? rawDate : today,
        operation: validOperations.has(rawOperation) ? rawOperation : fallbackOperation,
        loadNo,
        from: str(formData, `${p}from_location`),
        to,
        milesNum: num0(str(formData, `${p}miles`)),
        fuelNum: num0(str(formData, `${p}fuel_gallons`)),
        // Wage snapshot: trust the submitted amount (auto-calculated client-side or
        // hand-edited); no server-side recompute so manual overrides stick
        payNum: num0(str(formData, `${p}pay_amount`)),
        notes,
        packageId: str(formData, `${p}package_id`) || null,
        packageNote: str(formData, `${p}package_note`) || null
      });
    }
    total += rows.length;
    groups.push({
      driverId: str(formData, `g_${g}_driver_id`),
      truckId: str(formData, `g_${g}_truck_id`),
      rows
    });
  }

  if (total === 0) backWithError("no_rows", formData, groups);

  // Single-tab submit: persist only that group (the other tabs' half-filled
  // state is intentionally left out). Groups whose rows were all blank
  // reserve rows drop out entirely.
  const active = (scope === null ? groups.map((_, i) => i) : [scope]).filter(
    g => groups[g].rows.length > 0
  );
  if (active.length === 0) backWithError("no_rows", formData, groups);

  // The one hard requirement left: driver_id is a NOT NULL FK - a trip row
  // cannot exist without an owner
  for (const g of active) {
    if (!groups[g].driverId) backWithError("missing_driver", formData, groups, g + 1);
  }

  // Submit-time snapshots: the driver's current name and the truck's full
  // record, frozen into every trip row (later archive edits never rewrite
  // history; driver_id stays for payroll joins). An unpicked or unknown
  // truck simply stores no snapshot - it is optional now.
  const snapDriverIds = [...new Set(active.map(g => groups[g].driverId))];
  const driverNameRows = await prisma.$queryRaw<
    Array<{ id: string; full_name: string; driver_type: string }>
  >`
    SELECT id::text, full_name, driver_type::text AS driver_type FROM ops.drivers
    WHERE id IN (${Prisma.join(snapDriverIds.map(id => Prisma.sql`${id}::bigint`))})
  `;
  const driverNames = new Map(driverNameRows.map(r => [r.id, r.full_name]));
  const driverTypes = new Map(driverNameRows.map(r => [r.id, r.driver_type as DriverType]));
  for (const g of active) {
    if (!driverNames.has(groups[g].driverId)) {
      backWithError("missing_driver", formData, groups, g + 1);
    }
  }

  // Owner fuel subsidy rate comes from the ACTIVE rule version server-side
  // (the client strip is display-only; the stored snapshot is authoritative)
  const rateRows = await prisma.$queryRaw<Array<{ rate: string }>>`
    SELECT fuel_subsidy_rate::text AS rate FROM pay.wage_rule_versions
    WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1
  `;
  const fuelSubsidyRate = rateRows[0] ? Number(rateRows[0].rate) : 0;
  const snapTruckIds = [
    ...new Set(active.map(g => groups[g].truckId).filter(Boolean))
  ];
  const truckRows = snapTruckIds.length
    ? await prisma.$queryRaw<
        Array<{
          id: string;
          truck_code: string;
          plate_no: string | null;
          truck_type: string | null;
          capacity_note: string | null;
        }>
      >`
        SELECT id::text, truck_code, plate_no, truck_type, capacity_note
        FROM ops.trucks
        WHERE id IN (${Prisma.join(snapTruckIds.map(id => Prisma.sql`${id}::bigint`))})
          AND status = 'ACTIVE'
      `
    : [];
  const truckSnapshots = new Map(
    truckRows.map(t => [
      t.id,
      JSON.stringify({
        truck_id: t.id,
        truck_code: t.truck_code,
        plate_no: t.plate_no,
        truck_type: t.truck_type,
        capacity_note: t.capacity_note
      })
    ])
  );

  // Resolve every distinct submitted endpoint once (free text may create a
  // new location); unresolvable ones simply store NULL
  const endpointIds = new Map<string, string>();
  for (const value of [
    ...new Set(active.flatMap(g => groups[g].rows.flatMap(r => [r.from, r.to])).filter(Boolean))
  ]) {
    if (endpointIds.has(value)) continue;
    endpointIds.set(value, await resolveEndpointId(value));
  }

  const insertRows = active.flatMap(gi =>
    groups[gi].rows.map(row => {
      const snapshot = truckSnapshots.get(groups[gi].truckId);
      return {
        driverId: groups[gi].driverId,
        driverName: driverNames.get(groups[gi].driverId) ?? "",
        truckSnapshot: snapshot,
        tripDate: row.tripDate,
        fromId: endpointIds.get(row.from) ?? "",
        toId: endpointIds.get(row.to) ?? "",
        operation: row.operation,
        loadNo: row.loadNo,
        milesNum: row.milesNum,
        fuelNum: Math.round(row.fuelNum * 100) / 100,
        payNum: Math.round(row.payNum * 100) / 100,
        subsidyNum: calcFuelSubsidy({
          driverType: driverTypes.get(groups[gi].driverId),
          miles: row.milesNum,
          rate: fuelSubsidyRate
        }),
        notes: row.notes || null,
        packageId: row.packageId,
        packageNote: row.packageNote
      };
    })
  );
  if (insertRows.length === 0) backWithError("no_rows", formData, groups);

  const values = insertRows.map(r => Prisma.sql`
    (${r.driverId}::bigint, ${r.tripDate}::date, ${r.operation}, ${r.loadNo},
     ${r.fromId || null}::bigint, ${r.toId || null}::bigint, ${r.milesNum}, ${r.fuelNum}, ${r.payNum},
     ${r.subsidyNum}, ${r.notes}, ${r.driverName}, ${r.truckSnapshot ?? null}::jsonb,
     ${r.packageId}, ${r.packageNote})
  `);
  await prisma.$executeRaw`
    INSERT INTO pay.trips(driver_id, trip_date, operation, load_no,
      from_location_id, to_location_id, miles, fuel_gallons, pay_amount, fuel_subsidy, notes,
      driver_name, truck_snapshot, package_id, package_note)
    VALUES ${Prisma.join(values)}
  `;

  // Entry IS generation: every touched (driver, period) gets its statement
  // synced - created as DRAFT if missing, recomputed otherwise
  await syncStatements(
    insertRows.map(r => ({
      driverId: r.driverId,
      periodStart: periodOf(r.tripDate).start
    }))
  );

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");

  // Restore the submitted week's period so the sheet cover follows along
  const periodParam = `&period=${periodOf(insertRows[0].tripDate).start}`;
  if (scope === null) {
    // Keep the first driver preselected so the clerk can continue with their next date
    redirect(`/dashboard?saved=${insertRows.length}&driver=${groups[0].driverId}${periodParam}`);
  }

  // Single-tab success: that tab's work is done. Refill the other tabs (they
  // renumber around the removed one) and open the tab that took its place;
  // with nothing left, preselect the same driver on the fresh form.
  const params = new URLSearchParams({ saved: String(insertRows.length) });
  const kept = packRefill(params, formData, groups, scope);
  if (kept > 0) {
    params.set("tab", String(Math.min(scope, kept - 1)));
  } else {
    params.set("driver", groups[scope].driverId);
  }
  params.set("period", periodOf(insertRows[0].tripDate).start);
  redirect(`/dashboard?${params.toString()}`);
}
