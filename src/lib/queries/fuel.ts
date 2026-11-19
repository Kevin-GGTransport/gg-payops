import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Fuel-by-state rollup stored inside pay.payroll_statements.fuel_detail.
 *
 * One array per (driver, period), entered alongside the trips on the entry
 * sheet (one collapsible section per driver group) and frozen at verify like
 * the other statement numbers. Raw-SQL access only - values cross RSC/client
 * boundaries as plain strings or numbers, never Prisma Decimal/BigInt.
 */

/** Cap mirrored from the entry action; a malformed payload can't balloon */
export const MAX_FUEL_ROWS = 50;

/** One stored fuel row (the truck code is a submit-time snapshot) */
export type FuelDetailRow = {
  truckCode: string;
  stateCode: string;
  gallons: number;
  miles: number;
  amount: number;
  note: string;
};

/** Narrow an unknown jsonb payload into fuel rows; malformed items drop out */
export function parseFuelDetail(raw: unknown): FuelDetailRow[] {
  if (!Array.isArray(raw)) return [];
  const num = (value: unknown) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const rows: FuelDetailRow[] = [];
  for (const item of raw.slice(0, MAX_FUEL_ROWS)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const stateCode = typeof r.stateCode === "string" ? r.stateCode.toUpperCase() : "";
    if (!stateCode) continue;
    rows.push({
      truckCode: typeof r.truckCode === "string" ? r.truckCode : "",
      stateCode,
      gallons: num(r.gallons),
      miles: num(r.miles),
      amount: num(r.amount),
      note: typeof r.note === "string" ? r.note : ""
    });
  }
  return rows;
}

/** ACTIVE USPS states for the entry sheet's fuel-state dropdown */
export async function activeStateOptions(): Promise<Array<{ code: string; name: string }>> {
  const rows = await prisma.$queryRaw<Array<{ code: string; name: string }>>`
    SELECT code, name FROM ops.state_codes
    WHERE is_active
    ORDER BY name
  `;
  return rows;
}

/**
 * Existing fuel rows keyed by driver id for one period - feeds the entry
 * sheet's per-group fuel prefill (edit a week by returning to its period).
 * Drivers with an empty payload stay absent.
 */
export async function fuelDetailByDriver(
  periodStart: string
): Promise<Record<string, FuelDetailRow[]>> {
  const rows = await prisma.$queryRaw<Array<{ driver_id: string; fuel_detail: unknown }>>`
    SELECT s.driver_id::text AS driver_id, s.fuel_detail
    FROM pay.payroll_statements s
    WHERE s.period_start = ${periodStart}::date
      AND s.fuel_detail <> '[]'::jsonb
  `;
  const map: Record<string, FuelDetailRow[]> = {};
  for (const row of rows) {
    const parsed = parseFuelDetail(row.fuel_detail);
    if (parsed.length > 0) map[row.driver_id] = parsed;
  }
  return map;
}

/** One driver's fuel rows for one period (statement detail card / export) */
export async function statementFuelDetail(
  driverId: string,
  periodStart: string
): Promise<FuelDetailRow[]> {
  const rows = await prisma.$queryRaw<Array<{ fuel_detail: unknown }>>`
    SELECT s.fuel_detail
    FROM pay.payroll_statements s
    WHERE s.driver_id = ${driverId}::bigint AND s.period_start = ${periodStart}::date
    LIMIT 1
  `;
  return parseFuelDetail(rows[0]?.fuel_detail);
}

/**
 * The whole period's fuel rows expanded (truck blocks for the Excel export):
 * one entry per driver with name and rows, ordered truck-then-state so blocks
 * read like the hand-maintained sheet.
 */
export async function listFuelByPeriod(periodStart: string) {
  const byDriver = await fuelDetailByDriver(periodStart);
  const driverIds = Object.keys(byDriver);
  if (driverIds.length === 0) return [];
  const names = await prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
    SELECT id::text, full_name FROM ops.drivers
    WHERE id IN (${Prisma.join(driverIds.map(id => Prisma.sql`${id}::bigint`))})
  `;
  const nameById = new Map(names.map(n => [n.id, n.full_name]));
  return driverIds
    .map(id => ({
      driverId: id,
      driverName: nameById.get(id) ?? "",
      rows: [...byDriver[id]].sort(
        (a, b) => a.truckCode.localeCompare(b.truckCode) || a.stateCode.localeCompare(b.stateCode)
      )
    }))
    .sort((a, b) => a.driverName.localeCompare(b.driverName, "zh-Hans-CN"));
}
