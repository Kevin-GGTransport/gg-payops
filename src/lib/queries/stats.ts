import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/period";

/**
 * Period statistics for the fleet-wide 数据统计 page. Raw-SQL access only -
 * values cross the RSC boundary as plain strings (bigint ids, decimals).
 */

/**
 * 01 各州里程: fleet-wide per-state miles for one period, off every
 * statement's fuel_detail by-state rows (the fuel section's hand-entered
 * state miles). States with no miles at all drop out.
 */
export async function stateMileageByPeriod(
  period: Period
): Promise<Array<{ state: string; miles: string }>> {
  return prisma.$queryRaw<Array<{ state: string; miles: string }>>`
    SELECT e->>'stateCode' AS state,
           sum((e->>'miles')::numeric)::text AS miles
    FROM pay.payroll_statements s
    CROSS JOIN LATERAL jsonb_array_elements(s.fuel_detail) e
    WHERE s.period_start = ${period.start}::date
    GROUP BY 1
    HAVING sum((e->>'miles')::numeric) > 0
    ORDER BY 1
  `;
}

/** One load allocation row: a trip's whole mileage/pay on its single Load# */
export type LoadAllocationRow = {
  driverId: string;
  driverName: string;
  tripDate: string;
  /** Chain ordinal within the driver's day (1-based, id order - the same
   *  walk the detail sheet's day groups use) */
  tripNo: number;
  loadNo: string;
  miles: string;
  payAmount: string;
};

/**
 * 02 按趟分摊至 Load #: every trip of the period across all drivers, with
 * the per-(driver, date) chain ordinal. Each row is 100% of its trip (the
 * data model carries exactly one Load# per trip).
 */
export async function periodLoadAllocations(period: Period): Promise<LoadAllocationRow[]> {
  return prisma.$queryRaw<LoadAllocationRow[]>`
    SELECT t.driver_id::text AS "driverId",
           d.full_name AS "driverName",
           to_char(t.trip_date, 'YYYY-MM-DD') AS "tripDate",
           row_number() OVER (PARTITION BY t.driver_id, t.trip_date ORDER BY t.id)::int AS "tripNo",
           t.load_no AS "loadNo",
           t.miles::text AS miles,
           t.pay_amount::text AS "payAmount"
    FROM pay.trips t
    JOIN ops.drivers d ON d.id = t.driver_id
    WHERE COALESCE(t.settle_date, t.trip_date) >= ${period.start}::date
      AND COALESCE(t.settle_date, t.trip_date) <= ${period.end}::date
    ORDER BY t.trip_date, d.full_name, t.id
  `;
}
