"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const OPERATIONS = ["DEL", "EMPTY", "BOBTAIL", "LIVE"] as const;
/** Operations hauling a container: Load# required; BOBTAIL / EMPTY may leave it blank */
const LOAD_REQUIRED = new Set<string>(["DEL", "LIVE"]);
const MAX_GROUPS = 20;
const MAX_ROWS_PER_GROUP = 50;
const MAX_ROWS_TOTAL = 200;

/** Location codes are short (varchar(16)); free text is uppercased and capped for the code column */
const CODE_MAX = 16;

type ParsedRow = {
  tripDate: string;
  operation: string;
  loadNo: string;
  from: string;
  to: string;
  milesValue: string;
  payValue: string;
  notes: string;
};

type ParsedGroup = {
  driverId: string;
  /** Group-level default date; each row may still carry its own */
  tripDate: string;
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

/**
 * Redirect back to the entry page with the error code, the failing group / row
 * number, and every group's input refilled.
 */
function backWithError(
  error: string,
  formData: FormData,
  groups: ParsedGroup[],
  grp?: number,
  leg?: number
): never {
  const params = new URLSearchParams({ error });
  if (grp !== undefined) params.set("grp", String(grp));
  if (leg !== undefined) params.set("leg", String(leg));
  params.set("f_group_count", String(groups.length));
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    if (group.driverId) params.set(`f_g_${g}_driver_id`, group.driverId);
    if (group.tripDate) params.set(`f_g_${g}_trip_date`, group.tripDate);
    params.set(`f_g_${g}_row_count`, String(group.rows.length));
    for (let i = 0; i < group.rows.length; i++) {
      for (const field of ["trip_date", "operation", "load_no", "from_location", "to_location", "miles", "pay_amount", "notes"]) {
        const value = str(formData, `g_${g}_row_${i}_${field}`);
        if (value) params.set(`f_g_${g}_row_${i}_${field}`, value);
      }
    }
  }
  redirect(`/dashboard?${params.toString()}`);
}

/**
 * Resolve one submitted endpoint ("loc:<id>" verified against the DB, "txt:<text>"
 * find-or-created as an OTHER location) into a bigint id string.
 */
async function resolveEndpointId(value: string): Promise<string> {
  if (!value) return "";
  if (value.startsWith("loc:")) {
    const id = value.slice(4);
    if (!/^\d+$/.test(id)) return "";
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ops.locations WHERE id = ${id}::bigint LIMIT 1
    `;
    return rows[0]?.id ?? "";
  }
  if (value.startsWith("txt:")) {
    const text = value.slice(4).trim();
    const code = text.toUpperCase().slice(0, CODE_MAX);
    if (!code) return "";
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ops.locations WHERE code = ${code} LIMIT 1
    `;
    if (existing[0]) return existing[0].id;
    // Rare race: concurrent insert loses ON CONFLICT and returns nothing -> re-select
    const inserted = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO ops.locations (code, name, location_type, address_line)
      VALUES (${code}, ${text}, 'OTHER'::ops.location_type, ${text})
      ON CONFLICT (code) DO NOTHING
      RETURNING id::text
    `;
    if (inserted[0]) return inserted[0].id;
    const again = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ops.locations WHERE code = ${code} LIMIT 1
    `;
    return again[0]?.id ?? "";
  }
  return "";
}

export async function addTripsBatch(formData: FormData) {
  await requireUser();

  const groupCount = clampCount(str(formData, "group_count"), MAX_GROUPS);
  if (groupCount === 0) backWithError("no_rows", formData, []);

  const groups: ParsedGroup[] = [];
  let total = 0;
  for (let g = 0; g < groupCount; g++) {
    const groupDate = str(formData, `g_${g}_trip_date`);
    const rowCount = Math.min(
      clampCount(str(formData, `g_${g}_row_count`), MAX_ROWS_PER_GROUP),
      MAX_ROWS_TOTAL - total
    );
    const rows: ParsedRow[] = [];
    for (let i = 0; i < rowCount; i++) {
      rows.push({
        // Per-row date first (a sheet spans many days); falls back to the group default
        tripDate: str(formData, `g_${g}_row_${i}_trip_date`) || groupDate,
        operation: str(formData, `g_${g}_row_${i}_operation`),
        loadNo: str(formData, `g_${g}_row_${i}_load_no`),
        from: str(formData, `g_${g}_row_${i}_from_location`),
        to: str(formData, `g_${g}_row_${i}_to_location`),
        milesValue: str(formData, `g_${g}_row_${i}_miles`) || "0",
        payValue: str(formData, `g_${g}_row_${i}_pay_amount`) || "0",
        notes: str(formData, `g_${g}_row_${i}_notes`) || ""
      });
    }
    total += rows.length;
    groups.push({ driverId: str(formData, `g_${g}_driver_id`), tripDate: groupDate, rows });
  }

  if (total === 0) backWithError("no_rows", formData, groups);

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const grp = g + 1;
    if (!group.driverId) backWithError("missing_driver", formData, groups, grp);
    for (let i = 0; i < group.rows.length; i++) {
      const row = group.rows[i];
      const leg = i + 1;
      if (!isIsoDate(row.tripDate)) backWithError("bad_date", formData, groups, grp, leg);
      if (!OPERATIONS.includes(row.operation as (typeof OPERATIONS)[number])) {
        backWithError("missing_operation", formData, groups, grp, leg);
      }
      if (!row.loadNo && LOAD_REQUIRED.has(row.operation)) {
        backWithError("missing_load", formData, groups, grp, leg);
      }
      const milesNum = Number(row.milesValue);
      if (!Number.isFinite(milesNum) || milesNum < 0) backWithError("bad_miles", formData, groups, grp, leg);
      // Wage snapshot: trust the submitted amount (auto-calculated client-side or
      // hand-edited); no server-side recompute so manual overrides stick
      const payNum = Number(row.payValue);
      if (!Number.isFinite(payNum) || payNum < 0) backWithError("bad_pay", formData, groups, grp, leg);
      if (!row.from && !row.to) backWithError("missing_route", formData, groups, grp, leg);
    }
  }

  // Resolve every distinct endpoint once (free text may create a new location)
  const endpointIds = new Map<string, string>();
  for (const value of [
    ...new Set(groups.flatMap(g => g.rows.flatMap(r => [r.from, r.to])).filter(Boolean))
  ]) {
    const id = await resolveEndpointId(value);
    if (!id) backWithError("bad_location", formData, groups);
    endpointIds.set(value, id);
  }

  // Duplicate guard: one DB read covering every driver and every date in this
  // batch, compared in memory (per row's own driver and date) against both
  // existing rows and this batch
  const driverIds = [...new Set(groups.map(g => g.driverId))];
  const batchDates = [...new Set(groups.flatMap(g => g.rows.map(r => r.tripDate)))];
  const existing = await prisma.$queryRaw<
    Array<{
      driver_id: string;
      trip_date: string;
      operation: string;
      from_location_id: string | null;
      to_location_id: string | null;
      load_no: string | null;
    }>
  >`
    SELECT driver_id::text AS driver_id, trip_date::text AS trip_date, operation::text AS operation,
           from_location_id::text AS from_location_id, to_location_id::text AS to_location_id,
           nullif(load_no, '') AS load_no
    FROM pay.trips
    WHERE driver_id IN (${Prisma.join(driverIds.map(id => Prisma.sql`${id}::bigint`))})
      AND trip_date IN (${Prisma.join(batchDates.map(d => Prisma.sql`${d}::date`))})
  `;
  const seen = new Set(
    existing.map(
      r =>
        `${r.driver_id}|${r.trip_date}|${r.operation}|${r.from_location_id ?? ""}|${r.to_location_id ?? ""}|${r.load_no ?? ""}`
    )
  );

  const insertRows = groups.flatMap((group, gi) =>
    group.rows.map((row, ri) => {
      const fromId = endpointIds.get(row.from) ?? "";
      const toId = endpointIds.get(row.to) ?? "";
      // Same driver + day + operation + route counts as a duplicate only when
      // the container matches too - sheets legitimately log two runs per route
      const key = `${group.driverId}|${row.tripDate}|${row.operation}|${fromId}|${toId}|${row.loadNo}`;
      if (seen.has(key)) backWithError("dup_trip", formData, groups, gi + 1, ri + 1);
      seen.add(key);
      return {
        driverId: group.driverId,
        tripDate: row.tripDate,
        fromId,
        toId,
        operation: row.operation,
        loadNo: row.loadNo,
        milesNum: Number(row.milesValue),
        payNum: Math.round(Number(row.payValue) * 100) / 100,
        notes: row.notes || null
      };
    })
  );

  const values = insertRows.map(r => Prisma.sql`
    (${r.driverId}::bigint, ${r.tripDate}::date, ${r.operation}::ops.operation_type, ${r.loadNo},
     ${r.fromId || null}::bigint, ${r.toId || null}::bigint, ${r.milesNum}, ${r.payNum}, ${r.notes})
  `);
  await prisma.$executeRaw`
    INSERT INTO pay.trips(driver_id, trip_date, operation, load_no,
      from_location_id, to_location_id, miles, pay_amount, notes)
    VALUES ${Prisma.join(values)}
  `;

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  // Keep the first driver preselected so the clerk can continue with their next date
  redirect(`/dashboard?saved=${insertRows.length}&driver=${groups[0].driverId}`);
}
