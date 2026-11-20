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
const MAX_FUEL_ROWS_PER_GROUP = 50;
const MAX_FEE_ROWS_PER_GROUP = 20;

type ParsedRow = {
  tripDate: string;
  operation: string;
  loadNo: string;
  from: string;
  to: string;
  milesNum: number;
  payNum: number;
  notes: string;
  /** Shared marker for legs of one priced package (first leg carries the amount) */
  packageId: string | null;
  packageNote: string | null;
};

/** One fuel-by-state row of a group's fuel section (weekly rollup) */
type ParsedFuelRow = {
  /** Display row number as the sheet shows it (for error positions) */
  no: number;
  stateCode: string;
  gallons: number;
  miles: number;
  amount: number;
  note: string;
};

/** One custom-fee row of a group's fee section (amount ADDS to the payout) */
type ParsedFeeRow = {
  /** Display row number as the sheet shows it (for error positions) */
  no: number;
  label: string;
  /** Informational only - never part of any pricing */
  miles: number;
  amount: number;
  note: string;
};

type ParsedGroup = {
  driverId: string;
  /** Group-level truck (车号): snapshotted at submit, not a stored FK */
  truckId: string;
  rows: ParsedRow[];
  /** Fuel-by-state rows of this group's fuel section; empty rows skipped */
  fuelRows: ParsedFuelRow[];
  /** Custom-fee rows of this group's fee section; empty rows skipped */
  feeRows: ParsedFeeRow[];
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
  "pay_amount",
  "notes"
] as const;

const FUEL_ROW_FIELDS = ["state_code", "gallons", "miles", "amount", "note"] as const;
const FEE_ROW_FIELDS = ["label", "miles", "amount", "note"] as const;

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
    // Fuel-by-state rows ride the same refill (renumbered over content rows)
    const fuelCount = clampCount(str(formData, `g_${g}_fuel_row_count`), MAX_FUEL_ROWS_PER_GROUP);
    let fuelKept = 0;
    for (let i = 0; i < fuelCount; i++) {
      let any = false;
      for (const field of FUEL_ROW_FIELDS) {
        const value = str(formData, `g_${g}_fuel_row_${i}_${field}`);
        if (value) {
          params.set(`f_g_${kept}_fuel_row_${fuelKept}_${field}`, value);
          any = true;
        }
      }
      if (any) fuelKept++;
    }
    if (fuelKept > 0) params.set(`f_g_${kept}_fuel_row_count`, String(fuelKept));
    // Custom-fee rows ride the same refill (renumbered over content rows)
    const feeCount = clampCount(str(formData, `g_${g}_fee_row_count`), MAX_FEE_ROWS_PER_GROUP);
    let feeKept = 0;
    for (let i = 0; i < feeCount; i++) {
      let any = false;
      for (const field of FEE_ROW_FIELDS) {
        const value = str(formData, `g_${g}_fee_row_${i}_${field}`);
        if (value) {
          params.set(`f_g_${kept}_fee_row_${feeKept}_${field}`, value);
          any = true;
        }
      }
      if (any) feeKept++;
    }
    if (feeKept > 0) params.set(`f_g_${kept}_fee_row_count`, String(feeKept));
    kept++;
  }
  params.set("f_group_count", String(kept));
  return kept;
}

/**
 * Redirect back to the entry page with the error code, the failing group
 * (and fuel-row position when the error is a fuel one), and every group's
 * input refilled (the failing group's tab opens). The sheet's cover period
 * rides along so backfilling a historical week doesn't snap back to the
 * default week on a validation error.
 */
function backWithError(
  error: string,
  formData: FormData,
  groups: ParsedGroup[],
  grp?: number,
  fuel?: number,
  fee?: number
): never {
  const params = new URLSearchParams({ error });
  if (grp !== undefined) {
    params.set("grp", String(grp));
    params.set("tab", String(grp - 1));
    if (fuel !== undefined) params.set("fuel", String(fuel));
    if (fee !== undefined) params.set("fee", String(fee));
  }
  const sheetPeriod = str(formData, "sheet_period");
  if (isIsoDate(sheetPeriod)) params.set("period", periodOf(sheetPeriod).start);
  packRefill(params, formData, groups);
  redirect(`/dashboard?${params.toString()}`);
}

/**
 * Merge fuel rows into `target` by state (dup states within a group or across
 * two groups sharing one driver sum up; the first non-empty note wins).
 */
function mergeFuelRows(target: ParsedFuelRow[], incoming: ParsedFuelRow[]) {
  for (const row of incoming) {
    const dup = target.find(r => r.stateCode === row.stateCode);
    if (dup) {
      dup.gallons += row.gallons;
      dup.miles += row.miles;
      dup.amount += row.amount;
      if (!dup.note) dup.note = row.note;
    } else {
      target.push({ ...row });
    }
  }
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

  // USPS dictionary gates the fuel-state picks (a code outside it cannot have
  // come from the dropdown - treat it as dirty input)
  const stateRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ops.state_codes WHERE is_active
  `;
  const validStates = new Set(stateRows.map(s => s.code));

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
        // Miles ledger as integers: hand-typed decimals round on save (the
        // sheet text stays untouched while typing)
        milesNum: Math.round(num0(str(formData, `${p}miles`))),
        // Wage snapshot: trust the submitted amount (auto-calculated client-side or
        // hand-edited); no server-side recompute so manual overrides stick
        payNum: num0(str(formData, `${p}pay_amount`)),
        notes,
        packageId: str(formData, `${p}package_id`) || null,
        packageNote: str(formData, `${p}package_note`) || null
      });
    }
    total += rows.length;
    // Fuel-by-state section: untouched reserve rows are skipped the same way
    // (no state, no numbers, no note); numbers stay lenient (a miles-only
    // row is legal)
    const fuelRowCount = clampCount(
      str(formData, `g_${g}_fuel_row_count`),
      MAX_FUEL_ROWS_PER_GROUP
    );
    const fuelRows: ParsedFuelRow[] = [];
    for (let i = 0; i < fuelRowCount; i++) {
      const p = `g_${g}_fuel_row_${i}_`;
      const stateCode = str(formData, `${p}state_code`).toUpperCase().slice(0, 2);
      const gallonsRaw = str(formData, `${p}gallons`);
      const milesRaw = str(formData, `${p}miles`);
      const amountRaw = str(formData, `${p}amount`);
      const note = str(formData, `${p}note`).slice(0, 200);
      if (!stateCode && !gallonsRaw && !milesRaw && !amountRaw && !note) continue;
      fuelRows.push({
        no: i + 1,
        stateCode,
        gallons: num0(gallonsRaw),
        miles: num0(milesRaw),
        amount: num0(amountRaw),
        note
      });
    }
    // Custom-fee section: untouched reserve rows skip the same way
    const feeRowCount = clampCount(
      str(formData, `g_${g}_fee_row_count`),
      MAX_FEE_ROWS_PER_GROUP
    );
    const feeRows: ParsedFeeRow[] = [];
    for (let i = 0; i < feeRowCount; i++) {
      const p = `g_${g}_fee_row_${i}_`;
      const label = str(formData, `${p}label`).slice(0, 60);
      const amountRaw = str(formData, `${p}amount`);
      const milesRaw = str(formData, `${p}miles`);
      const note = str(formData, `${p}note`).slice(0, 200);
      if (!label && !amountRaw && !milesRaw && !note) continue;
      feeRows.push({
        no: i + 1,
        label,
        miles: num0(milesRaw),
        amount: num0(amountRaw),
        note
      });
    }
    groups.push({
      driverId: str(formData, `g_${g}_driver_id`),
      truckId: str(formData, `g_${g}_truck_id`),
      rows,
      fuelRows,
      feeRows
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

  // Fuel rows need both owners of the group: the statement (driver) and the
  // truck snapshot (truckCode is baked into every stored fuel row)
  for (const g of active) {
    const group = groups[g];
    if (group.fuelRows.length === 0) continue;
    if (!group.truckId) backWithError("fuel_missing_truck", formData, groups, g + 1);
    for (const row of group.fuelRows) {
      if (!row.stateCode) backWithError("fuel_missing_state", formData, groups, g + 1, row.no);
      if (!validStates.has(row.stateCode)) {
        backWithError("fuel_bad_state", formData, groups, g + 1, row.no);
      }
    }
  }

  // Fee rows are free-form except for one thing: a carried row needs a name
  // (the sheet shows what the money is for; a nameless amount helps nobody)
  for (const g of active) {
    const group = groups[g];
    for (const row of group.feeRows) {
      if (!row.label) backWithError("fee_missing_label", formData, groups, g + 1, undefined, row.no);
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
  // Fuel rows snapshot the group truck's code (they outlive later truck edits)
  const truckCodeById = new Map(truckRows.map(t => [t.id, t.truck_code]));

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
     ${r.fromId || null}::bigint, ${r.toId || null}::bigint, ${r.milesNum}, ${r.payNum},
     ${r.subsidyNum}, ${r.notes}, ${r.driverName}, ${r.truckSnapshot ?? null}::jsonb,
     ${r.packageId}, ${r.packageNote})
  `);
  await prisma.$executeRaw`
    INSERT INTO pay.trips(driver_id, trip_date, operation, load_no,
      from_location_id, to_location_id, miles, pay_amount, fuel_subsidy, notes,
      driver_name, truck_snapshot, package_id, package_note)
    VALUES ${Prisma.join(values)}
  `;

  // Fuel-by-state rollup onto the statement of the sheet's cover week. Every
  // active group writes its driver's whole fuel set (replace semantics): the
  // sheet shows the week's saved rows on open, so what is submitted IS the
  // week's truth - emptied rows mean the clerk cleared them. Two submitted
  // groups sharing one driver merge (sums per state, first note wins); a
  // non-submitted group's fuel is never touched.
  const sheetPeriodStart = periodOf(
    isIsoDate(str(formData, "sheet_period"))
      ? str(formData, "sheet_period")
      : insertRows[0].tripDate
  );
  const fuelSaves = new Map<string, { truckCode: string; rows: ParsedFuelRow[] }>();
  for (const g of active) {
    const group = groups[g];
    const driverId = group.driverId;
    const existing = fuelSaves.get(driverId);
    if (existing) {
      mergeFuelRows(existing.rows, group.fuelRows);
      continue;
    }
    const rows: ParsedFuelRow[] = [];
    mergeFuelRows(rows, group.fuelRows);
    fuelSaves.set(driverId, {
      truckCode: truckCodeById.get(group.truckId) ?? "",
      rows
    });
  }
  for (const [driverId, save] of fuelSaves) {
    const payload = JSON.stringify(
      save.rows.map(r => ({
        truckCode: save.truckCode,
        stateCode: r.stateCode,
        gallons: Math.round(r.gallons * 1000) / 1000,
        miles: Math.round(r.miles * 10) / 10,
        amount: Math.round(r.amount * 100) / 100,
        ...(r.note ? { note: r.note } : {})
      }))
    );
    // DRAFT arm creates the statement when missing (aggregates arrive from
    // syncStatements right after, which never touches fuel_detail);
    // VERIFIED/DONE keep their frozen numbers and only take the fuel plus the
    // permanent edited flag - the same red as a trip edit
    await prisma.$executeRaw`
      INSERT INTO pay.payroll_statements
        (driver_id, period_start, period_end, trip_days, leg_count, total_miles, total_fuel, total_pay, fuel_detail)
      VALUES (${driverId}::bigint, ${sheetPeriodStart.start}::date, ${sheetPeriodStart.end}::date,
              0, 0, 0, 0, 0, ${payload}::jsonb)
      ON CONFLICT (driver_id, period_start) DO UPDATE SET
        fuel_detail = EXCLUDED.fuel_detail, updated_at = now()
      WHERE pay.payroll_statements.status = 'DRAFT'
    `;
    await prisma.$executeRaw`
      UPDATE pay.payroll_statements
      SET fuel_detail = ${payload}::jsonb, edited_after_verify = true, updated_at = now()
      WHERE driver_id = ${driverId}::bigint AND period_start = ${sheetPeriodStart.start}::date
        AND status IN ('VERIFIED', 'DONE')
    `;
  }

  // Custom fees follow the fuel contract: only active groups (a group with
  // fees but no trip rows drops out - same as fuel), two groups sharing one
  // driver concatenate in group order (fees have no merge key), and the
  // submitted set is the week's whole truth (replace semantics)
  const feeSaves = new Map<string, ParsedFeeRow[]>();
  for (const g of active) {
    const group = groups[g];
    const existing = feeSaves.get(group.driverId);
    if (existing) existing.push(...group.feeRows);
    else feeSaves.set(group.driverId, [...group.feeRows]);
  }
  for (const [driverId, rows] of feeSaves) {
    const payload = JSON.stringify(
      rows.map(r => ({
        label: r.label,
        miles: Math.round(r.miles * 10) / 10,
        amount: Math.round(r.amount * 100) / 100,
        ...(r.note ? { note: r.note } : {})
      }))
    );
    const total = Math.round(rows.reduce((acc, r) => acc + r.amount, 0) * 100) / 100;
    // Same two arms as the fuel save: DRAFT upserts (aggregates arrive from
    // syncStatements right after, which never touches these columns);
    // VERIFIED/DONE keep their frozen pay and only take the fees plus the
    // permanent edited flag
    await prisma.$executeRaw`
      INSERT INTO pay.payroll_statements
        (driver_id, period_start, period_end, trip_days, leg_count, total_miles, total_fuel, total_pay,
         custom_fees, total_custom_fees)
      VALUES (${driverId}::bigint, ${sheetPeriodStart.start}::date, ${sheetPeriodStart.end}::date,
              0, 0, 0, 0, 0, ${payload}::jsonb, ${total})
      ON CONFLICT (driver_id, period_start) DO UPDATE SET
        custom_fees = EXCLUDED.custom_fees,
        total_custom_fees = EXCLUDED.total_custom_fees,
        updated_at = now()
      WHERE pay.payroll_statements.status = 'DRAFT'
    `;
    await prisma.$executeRaw`
      UPDATE pay.payroll_statements
      SET custom_fees = ${payload}::jsonb,
          total_custom_fees = ${total},
          edited_after_verify = true,
          updated_at = now()
      WHERE driver_id = ${driverId}::bigint AND period_start = ${sheetPeriodStart.start}::date
        AND status IN ('VERIFIED', 'DONE')
    `;
  }

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
