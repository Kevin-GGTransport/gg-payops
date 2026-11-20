import { prisma } from "@/lib/prisma";

/**
 * Custom per-period fees stored inside pay.payroll_statements.custom_fees.
 *
 * One array per (driver, period): user-defined amounts ADDED to the payout
 * (reimbursements, allowances...) entered alongside the trips on the entry
 * sheet (one collapsible section per driver group) or fixed on the detail
 * editor. The miles column is informational only (like the fuel rows' state
 * miles). Fees sit outside the verification snapshot: post-verify edits only
 * set edited_after_verify, no per-row red marks. Raw-SQL access only -
 * values cross RSC/client boundaries as plain strings or numbers.
 */

/** Cap mirrored from the entry/detail actions; a malformed payload can't balloon */
export const MAX_FEE_ROWS = 20;

/** One stored fee row */
export type FeeDetailRow = {
  label: string;
  /** Informational only - never part of any pricing */
  miles: number;
  amount: number;
  note: string;
};

/** Narrow an unknown jsonb payload into fee rows; malformed items drop out */
export function parseCustomFees(raw: unknown): FeeDetailRow[] {
  if (!Array.isArray(raw)) return [];
  const num = (value: unknown) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const rows: FeeDetailRow[] = [];
  for (const item of raw.slice(0, MAX_FEE_ROWS)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label) continue;
    rows.push({
      label,
      miles: num(r.miles),
      amount: num(r.amount),
      note: typeof r.note === "string" ? r.note : ""
    });
  }
  return rows;
}

/** Sum of fee amounts rounded to cents (they all ADD to the payout) - the
 *  single definition every payout surface and both write paths share */
export function feesTotal(rows: FeeDetailRow[]): number {
  const total = rows.reduce((acc, r) => acc + r.amount, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Existing fee rows keyed by driver id for one period - feeds the entry
 * sheet's per-group fee prefill (edit a week by returning to its period).
 * Drivers with an empty payload stay absent.
 */
export async function customFeesByDriver(
  periodStart: string
): Promise<Record<string, FeeDetailRow[]>> {
  const rows = await prisma.$queryRaw<Array<{ driver_id: string; custom_fees: unknown }>>`
    SELECT s.driver_id::text AS driver_id, s.custom_fees
    FROM pay.payroll_statements s
    WHERE s.period_start = ${periodStart}::date
      AND s.custom_fees <> '[]'::jsonb
  `;
  const map: Record<string, FeeDetailRow[]> = {};
  for (const row of rows) {
    const parsed = parseCustomFees(row.custom_fees);
    if (parsed.length > 0) map[row.driver_id] = parsed;
  }
  return map;
}

/** One driver's fee rows for one period (statement detail card / export) */
export async function statementCustomFees(
  driverId: string,
  periodStart: string
): Promise<FeeDetailRow[]> {
  const rows = await prisma.$queryRaw<Array<{ custom_fees: unknown }>>`
    SELECT s.custom_fees
    FROM pay.payroll_statements s
    WHERE s.driver_id = ${driverId}::bigint AND s.period_start = ${periodStart}::date
    LIMIT 1
  `;
  return parseCustomFees(rows[0]?.custom_fees);
}
