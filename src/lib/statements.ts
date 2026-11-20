import { prisma } from "@/lib/prisma";
import { periodOf } from "@/lib/period";

export type StatementRef = { driverId: string; periodStart: string };

/**
 * Keep statements in step with trips after every mutation (entry / edit /
 * delete / batch delete). Per (driver, period):
 *
 * - missing statement is created as DRAFT with the live aggregates
 *   (entry = generation - no separate "generate" step exists)
 * - DRAFT and VERIFIED numbers are recomputed in place (核对 is a checked
 *   mark, NOT an archive: the sheet keeps tracking the trips live)
 * - DONE (driver-confirmed) numbers stay frozen on the confirmation-time
 *   snapshot; the mutation only sets edited_after_verify - a permanent audit
 *   flag that is never cleared anywhere
 * - a DRAFT/VERIFIED sheet whose trips are all gone is dropped (no legs, no
 *   statement)
 */
export async function syncStatements(refs: StatementRef[]) {
  const pairs = [
    ...new Map(refs.map(r => [`${r.driverId}|${r.periodStart}`, r])).values()
  ];
  for (const { driverId, periodStart } of pairs) {
    const period = periodOf(periodStart);
    await prisma.$transaction([
      // Upsert the live aggregates; the DO UPDATE arm is guarded so DONE rows
      // keep their frozen numbers. LEFT JOIN keeps zero-trip drivers at one
      // all-zero row, which the empty-sheet cleanup below then removes.
      prisma.$executeRaw`
        INSERT INTO pay.payroll_statements(
          driver_id, period_start, period_end,
          trip_days, leg_count, total_miles, total_fuel, total_pay, total_fuel_subsidy,
          op_counts, trucks
        )
        SELECT
          d.id,
          ${period.start}::date,
          ${period.end}::date,
          count(DISTINCT t.trip_date)::int,
          count(t.id)::int,
          COALESCE(SUM(t.miles), 0),
          COALESCE(SUM(t.fuel_gallons), 0),
          COALESCE(SUM(t.pay_amount), 0),
          COALESCE(SUM(t.fuel_subsidy), 0),
          COALESCE(
            (SELECT jsonb_object_agg(x.operation, x.cnt) FROM (
               SELECT t2.operation, count(*)::int AS cnt
               FROM pay.trips t2
               WHERE t2.driver_id = d.id
                 AND t2.trip_date >= ${period.start}::date
                 AND t2.trip_date <= ${period.end}::date
               GROUP BY t2.operation
             ) x),
            '{}'::jsonb
          ),
          COALESCE(string_agg(DISTINCT t.truck_snapshot->>'truck_code', ', ' ORDER BY t.truck_snapshot->>'truck_code'), '')
        FROM ops.drivers d
        LEFT JOIN pay.trips t
          ON t.driver_id = d.id
          AND t.trip_date >= ${period.start}::date
          AND t.trip_date <= ${period.end}::date
        WHERE d.id = ${driverId}::bigint
        GROUP BY d.id
        ON CONFLICT (driver_id, period_start) DO UPDATE SET
          trip_days = EXCLUDED.trip_days,
          leg_count = EXCLUDED.leg_count,
          total_miles = EXCLUDED.total_miles,
          total_fuel = EXCLUDED.total_fuel,
          total_pay = EXCLUDED.total_pay,
          total_fuel_subsidy = EXCLUDED.total_fuel_subsidy,
          op_counts = EXCLUDED.op_counts,
          trucks = EXCLUDED.trucks,
          updated_at = now()
        WHERE pay.payroll_statements.status IN ('DRAFT', 'VERIFIED')
      `,
      // DONE: numbers frozen on the confirmation snapshot forever; the change
      // is only flagged (detail-sheet red - the list no longer surfaces this
      // flag)
      prisma.$executeRaw`
        UPDATE pay.payroll_statements
        SET edited_after_verify = true, updated_at = now()
        WHERE driver_id = ${driverId}::bigint
          AND period_start = ${period.start}::date
          AND status = 'DONE'
      `,
      // Live sheet with every leg deleted: remove the empty statement.
      // Custom fees are deliberately entered money (a fees-only sheet can
      // exist), so a statement carrying them survives; fuel_detail is
      // intentionally NOT part of this guard (scoped decision kept from the
      // fuel feature)
      prisma.$executeRaw`
        DELETE FROM pay.payroll_statements
        WHERE driver_id = ${driverId}::bigint
          AND period_start = ${period.start}::date
          AND status IN ('DRAFT', 'VERIFIED')
          AND leg_count = 0
          AND custom_fees = '[]'::jsonb
      `
    ]);
  }
}
