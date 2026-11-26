import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/period";
import { chainDayLegs } from "@/lib/queries/trips";

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

/** One leg as the trip walker sees it (location types drive Base checks) */
type AllocationLeg = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  trip_date: string;
  load_no: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  from_type: string | null;
  to_type: string | null;
  miles: string;
  pay_amount: string;
  sort_order: number | null;
};

/** One load's slice of its trip (02 按趟分摊至 Load # output row) */
export type LoadAllocationRow = {
  driverId: string;
  driverName: string;
  /** Date of the trip's Base-departure leg */
  tripDate: string;
  /** Ordinal among the driver's Base departures in the period (1-based) */
  tripNo: number;
  loadNo: string;
  /** Mileage share within the trip, e.g. "30.0%" */
  share: string;
  miles: string;
  payAmount: string;
  /** Trip never closed back at a BASE location - numbers stay hidden */
  unreturned: boolean;
};

export type LoadAllocations = {
  rows: LoadAllocationRow[];
  /** Base-departure trips this period, loadless ones included */
  tripCount: number;
  /** Trips with loads but no Base return (rows carry the marker) */
  unreturnedCount: number;
};

/**
 * Split a load_no cell the way the reference sheet does: 、，;； and line
 * breaks become separators, leftover spaces are stripped (typos inside a
 * number), empty fragments and "—" drop out. Empty result = loadless leg.
 */
function parseLoads(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .replace(/[、，;；\r\n]+/g, ",")
    .replace(/ /g, "")
    .split(",")
    .map(s => s.trim())
    .filter(s => s !== "" && s !== "—");
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * 02 按趟分摊至 Load #: the reference workbook's allocation, fleet-wide.
 *
 * A trip (趟) runs from a BASE-departure leg until the chain reaches Base
 * again - legs join while the previous leg's destination feeds the next
 * leg's origin and that destination is not Base, across day boundaries.
 * Each leg's miles split equally across the Load#s it carries; a Load#
 * spanning several legs of the same trip accumulates its weights. A load's
 * share = its accumulated weight / the trip's total weight (loadless
 * BOBTAIL/EMPTY legs carry no weight). Allocated miles/pay = whole-trip
 * totals x share, the trip's last load eating the rounding residual so
 * each trip sums to exactly its totals. Trips that never return to Base
 * keep their rows but show 未回 Base instead of numbers; legs that break
 * the chain without departing Base are dropped, like the sheet's H=0 rows.
 */
export async function periodLoadAllocations(period: Period): Promise<LoadAllocations> {
  const legs = await prisma.$queryRaw<AllocationLeg[]>`
    SELECT t.id::text AS id,
           t.driver_id::text AS driver_id,
           d.full_name AS driver_name,
           to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date,
           t.load_no,
           t.from_location_id::text AS from_location_id,
           t.to_location_id::text AS to_location_id,
           f.location_type::text AS from_type,
           o.location_type::text AS to_type,
           t.miles::text AS miles,
           t.pay_amount::text AS pay_amount,
           t.sort_order
    FROM pay.trips t
    JOIN ops.drivers d ON d.id = t.driver_id
    LEFT JOIN ops.locations f ON f.id = t.from_location_id
    LEFT JOIN ops.locations o ON o.id = t.to_location_id
    WHERE COALESCE(t.settle_date, t.trip_date) >= ${period.start}::date
      AND COALESCE(t.settle_date, t.trip_date) <= ${period.end}::date
    ORDER BY t.driver_id, t.trip_date, t.sort_order NULLS LAST, t.id
  `;

  const byDriver = new Map<string, AllocationLeg[]>();
  for (const leg of legs) {
    const bucket = byDriver.get(leg.driver_id);
    if (bucket) bucket.push(leg);
    else byDriver.set(leg.driver_id, [leg]);
  }

  const rows: LoadAllocationRow[] = [];
  let tripCount = 0;
  let unreturnedCount = 0;
  let driverTripNo = 0;

  for (const driverLegs of byDriver.values()) {
    // Same day grouping + intra-day ordering the payroll detail shows
    const days: AllocationLeg[][] = [];
    for (const leg of driverLegs) {
      const day = days[days.length - 1];
      if (day && day[0].trip_date === leg.trip_date) day.push(leg);
      else days.push([leg]);
    }
    const ordered = days.flatMap(day =>
      day.some(l => l.sort_order !== null) ? day : chainDayLegs(day)
    );

    // Walk legs into trips: Base departure opens one, adjacency continues
    // it (previous destination feeds this origin, that destination not
    // Base); anything else breaks the chain and is left unallocated
    const trips: AllocationLeg[][] = [];
    let open: AllocationLeg[] | null = null;
    for (const leg of ordered) {
      const last = open?.[open.length - 1] ?? null;
      if (leg.from_type === "BASE") {
        if (open) trips.push(open);
        open = [leg];
      } else if (
        last &&
        leg.from_location_id !== null &&
        last.to_location_id === leg.from_location_id &&
        last.to_type !== "BASE"
      ) {
        open?.push(leg);
      } else if (open) {
        trips.push(open);
        open = null;
      }
    }
    if (open) trips.push(open);

    // Ordinal counts every Base departure of this driver, loadless or not
    driverTripNo = 0;
    for (const trip of trips) {
      tripCount += 1;
      driverTripNo += 1;
      // Insertion order = first appearance along the chained legs
      const weights = new Map<string, number>();
      for (const leg of trip) {
        const loads = parseLoads(leg.load_no);
        if (loads.length === 0) continue;
        const w = Number(leg.miles) / loads.length;
        for (const load of loads) weights.set(load, (weights.get(load) ?? 0) + w);
      }
      if (weights.size === 0) continue; // loadless trip: no allocation rows

      const unreturned = !trip.some(l => l.to_type === "BASE");
      if (unreturned) unreturnedCount += 1;

      const tripMiles = trip.reduce((acc, l) => acc + Number(l.miles), 0);
      const tripPay = trip.reduce((acc, l) => acc + Number(l.pay_amount), 0);
      const denom = [...weights.values()].reduce((acc, w) => acc + w, 0);
      const entries = [...weights.entries()];

      let milesLeft = round2(tripMiles);
      let payLeft = round2(tripPay);
      entries.forEach(([load, w], i) => {
        const share = denom > 0 ? w / denom : 1 / entries.length;
        // Last load takes the residual so the trip sums to its totals
        const miles = i === entries.length - 1 ? milesLeft : round2(tripMiles * share);
        const pay = i === entries.length - 1 ? payLeft : round2(tripPay * share);
        milesLeft = round2(milesLeft - miles);
        payLeft = round2(payLeft - pay);
        rows.push({
          driverId: trip[0].driver_id,
          driverName: trip[0].driver_name ?? "—",
          tripDate: trip[0].trip_date,
          tripNo: driverTripNo,
          loadNo: load,
          share: `${(share * 100).toFixed(1)}%`,
          miles: miles.toString(),
          payAmount: pay.toString(),
          unreturned
        });
      });
    }
  }

  // Fleet-wide display order: departure date, then driver, then trip
  // ordinal; loads of one trip keep their first-appearance order (stable)
  rows.sort(
    (a, b) =>
      a.tripDate.localeCompare(b.tripDate) ||
      a.driverName.localeCompare(b.driverName, "zh-Hans-CN") ||
      a.tripNo - b.tripNo
  );

  return { rows, tripCount, unreturnedCount };
}
