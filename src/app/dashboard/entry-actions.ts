"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const OPERATIONS = ["DEL", "EMPTY", "BOBTAIL", "LIVE"] as const;
/** Operations hauling a container: Load# required; BOBTAIL / EMPTY may leave it blank */
const LOAD_REQUIRED = new Set<string>(["DEL", "LIVE"]);
const MAX_ROWS = 50;

/** Location codes are short (varchar(16)); free text is uppercased and capped for the code column */
const CODE_MAX = 16;

type ParsedRow = {
  operation: string;
  loadNo: string;
  from: string;
  to: string;
  milesValue: string;
  payValue: string;
  notes: string;
};

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Redirect back to the entry page with the error code, the failing row number and every row's input refilled */
function backWithError(
  error: string,
  formData: FormData,
  rowCount: number,
  leg?: number
): never {
  const params = new URLSearchParams({ error });
  if (leg !== undefined) params.set("leg", String(leg));
  const driverId = str(formData, "driver_id");
  if (driverId) params.set("f_driver_id", driverId);
  const tripDate = str(formData, "trip_date");
  if (tripDate) params.set("f_trip_date", tripDate);
  params.set("f_row_count", String(rowCount));
  for (let i = 0; i < rowCount; i++) {
    for (const field of ["operation", "load_no", "from_location", "to_location", "miles", "pay_amount", "notes"]) {
      const value = str(formData, `row_${i}_${field}`);
      if (value) params.set(`f_${i}_${field}`, value);
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

  const driverId = str(formData, "driver_id");
  const tripDate = str(formData, "trip_date");
  const rowCount = Math.min(Math.max(Number.parseInt(str(formData, "row_count"), 10) || 0, 0), MAX_ROWS);

  if (!driverId) backWithError("missing_driver", formData, rowCount);
  if (!tripDate) backWithError("missing_date", formData, rowCount);
  if (rowCount === 0) backWithError("no_rows", formData, rowCount);

  const rows: ParsedRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push({
      operation: str(formData, `row_${i}_operation`),
      loadNo: str(formData, `row_${i}_load_no`),
      from: str(formData, `row_${i}_from_location`),
      to: str(formData, `row_${i}_to_location`),
      milesValue: str(formData, `row_${i}_miles`) || "0",
      payValue: str(formData, `row_${i}_pay_amount`) || "0",
      notes: str(formData, `row_${i}_notes`) || ""
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const leg = i + 1;
    if (!OPERATIONS.includes(row.operation as (typeof OPERATIONS)[number])) {
      backWithError("missing_operation", formData, rowCount, leg);
    }
    if (!row.loadNo && LOAD_REQUIRED.has(row.operation)) {
      backWithError("missing_load", formData, rowCount, leg);
    }
    const milesNum = Number(row.milesValue);
    if (!Number.isFinite(milesNum) || milesNum < 0) backWithError("bad_miles", formData, rowCount, leg);
    // Wage snapshot: trust the submitted amount (auto-calculated client-side or
    // hand-edited); no server-side recompute so manual overrides stick
    const payNum = Number(row.payValue);
    if (!Number.isFinite(payNum) || payNum < 0) backWithError("bad_pay", formData, rowCount, leg);
    if (!row.from && !row.to) backWithError("missing_route", formData, rowCount, leg);
  }

  // Resolve every distinct endpoint once (free text may create a new location)
  const endpointIds = new Map<string, string>();
  for (const value of [...new Set(rows.flatMap(r => [r.from, r.to]).filter(Boolean))]) {
    const id = await resolveEndpointId(value);
    if (!id) backWithError("bad_location", formData, rowCount);
    endpointIds.set(value, id);
  }

  // Duplicate guard: one DB read for this driver+date, compared in memory
  // against both existing rows and the rows within this batch
  const existing = await prisma.$queryRaw<
    Array<{ operation: string; from_location_id: string | null; to_location_id: string | null }>
  >`
    SELECT operation::text AS operation, from_location_id::text AS from_location_id, to_location_id::text AS to_location_id
    FROM pay.trips
    WHERE driver_id = ${driverId}::bigint AND trip_date = ${tripDate}::date
  `;
  const seen = new Set(
    existing.map(r => `${r.operation}|${r.from_location_id ?? ""}|${r.to_location_id ?? ""}`)
  );

  const insertRows = rows.map((row, idx) => {
    const fromId = endpointIds.get(row.from) ?? "";
    const toId = endpointIds.get(row.to) ?? "";
    const key = `${row.operation}|${fromId}|${toId}`;
    if (seen.has(key)) backWithError("dup_trip", formData, rowCount, idx + 1);
    seen.add(key);
    return {
      fromId,
      toId,
      operation: row.operation,
      loadNo: row.loadNo,
      milesNum: Number(row.milesValue),
      payNum: Math.round(Number(row.payValue) * 100) / 100,
      notes: row.notes || null
    };
  });

  const values = insertRows.map(r => Prisma.sql`
    (${driverId}::bigint, ${tripDate}::date, ${r.operation}::ops.operation_type, ${r.loadNo},
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
  // Keep the driver preselected so the clerk can continue with the next date
  redirect(`/dashboard?saved=${insertRows.length}&driver=${driverId}`);
}
