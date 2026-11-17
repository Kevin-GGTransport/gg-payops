import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DriverType, OperationType } from "@/lib/labels";
import type { Period } from "@/lib/period";

export type TripRow = {
  id: string;
  driver_id: string;
  /** Submit-time driver name snapshot (never follows later driver edits) */
  driver_name: string | null;
  /** Truck code from the submit-time truck_snapshot */
  truck_code: string | null;
  driver_type: DriverType;
  /** Owner flagged to bill at driver prices (pricing identity override) */
  price_as_driver: boolean;
  trip_date: string;
  operation: OperationType;
  load_no: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_code: string | null;
  to_code: string | null;
  miles: string;
  fuel_gallons: string;
  pay_amount: string;
  /** Owner fuel subsidy snapshot (0 for plain drivers) */
  fuel_subsidy: string;
  notes: string | null;
  /** Shared marker when this leg belongs to a priced package */
  package_id: string | null;
  /** Carrier-side label, e.g. 往返打包 $200.00 (null on $0 member legs) */
  package_note: string | null;
};

const TRIP_SELECT = Prisma.sql`
  SELECT t.id::text, t.driver_id::text, t.driver_name,
         t.truck_snapshot->>'truck_code' AS truck_code,
         d.driver_type::text AS driver_type, d.price_as_driver,
         to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date,
         t.operation::text AS operation, t.load_no,
         t.from_location_id::text AS from_location_id,
         t.to_location_id::text AS to_location_id,
         f.code AS from_code, o.code AS to_code,
         t.miles::text, t.fuel_gallons::text, t.pay_amount::text, t.fuel_subsidy::text,
         t.notes, t.created_at,
         t.package_id, t.package_note
  FROM pay.trips t
  JOIN ops.drivers d ON d.id = t.driver_id
  LEFT JOIN ops.locations f ON f.id = t.from_location_id
  LEFT JOIN ops.locations o ON o.id = t.to_location_id
`;

export type TripListRow = TripRow & { total: number };

/** Editable projection of one trip (powers the edit dialog) */
export type TripEditRow = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  /** Driver type at edit time; wages reprice against it like entry rows */
  driver_type: DriverType | null;
  /** Owner flagged to bill at driver prices (pricing identity override) */
  price_as_driver: boolean;
  trip_date: string;
  operation: string;
  load_no: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_code: string | null;
  to_code: string | null;
  miles: string;
  fuel_gallons: string;
  pay_amount: string;
  /** Owner fuel subsidy snapshot (0 for plain drivers) */
  fuel_subsidy: string;
  notes: string | null;
  package_id: string | null;
  package_note: string | null;
};

export async function getTripById(id: string): Promise<TripEditRow | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = await prisma.$queryRaw<TripEditRow[]>`
    SELECT t.id::text, t.driver_id::text, t.driver_name,
           d.driver_type::text AS driver_type, d.price_as_driver,
           to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date,
           t.operation::text AS operation, t.load_no,
           t.from_location_id::text AS from_location_id,
           t.to_location_id::text AS to_location_id,
           f.code AS from_code, o.code AS to_code,
           t.miles::text, t.fuel_gallons::text, t.pay_amount::text, t.fuel_subsidy::text,
           t.notes,
           t.package_id, t.package_note
    FROM pay.trips t
    LEFT JOIN ops.drivers d ON d.id = t.driver_id
    LEFT JOIN ops.locations f ON f.id = t.from_location_id
    LEFT JOIN ops.locations o ON o.id = t.to_location_id
    WHERE t.id = ${id}::bigint
  `;
  return rows[0] ?? null;
}

/** Trip ledger: filter by date range, drivers, operation, keyword; paginated, each row carries window total */
export async function listTrips(filter: {
  driverIds?: string[];
  operation?: OperationType;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}): Promise<TripListRow[]> {
  const clauses: Prisma.Sql[] = [];
  if (filter.dateFrom) clauses.push(Prisma.sql`t.trip_date >= ${filter.dateFrom}::date`);
  if (filter.dateTo) clauses.push(Prisma.sql`t.trip_date <= ${filter.dateTo}::date`);
  if (filter.driverIds && filter.driverIds.length > 0) {
    clauses.push(Prisma.sql`t.driver_id IN (${Prisma.join(filter.driverIds.map(id => Prisma.sql`${id}::bigint`))})`);
  }
  if (filter.operation) {
    clauses.push(Prisma.sql`t.operation = ${filter.operation}`);
  }
  if (filter.q) {
    const like = `%${filter.q}%`;
    clauses.push(
      Prisma.sql`(t.driver_name ILIKE ${like} OR t.truck_snapshot->>'truck_code' ILIKE ${like} OR t.load_no ILIKE ${like} OR f.code ILIKE ${like} OR o.code ILIKE ${like})`
    );
  }
  const where = clauses.length > 0
    ? Prisma.sql` WHERE ${Prisma.join(clauses, " AND ")}`
    : Prisma.empty;
  const limit = filter.pageSize
    ? Prisma.sql` LIMIT ${filter.pageSize} OFFSET ${(Math.max(filter.page ?? 1, 1) - 1) * filter.pageSize}`
    : Prisma.empty;
  return prisma.$queryRaw<TripListRow[]>`
    SELECT * FROM (
      SELECT list.*, count(*) OVER ()::int AS total FROM (
        ${TRIP_SELECT}${where}
      ) list
    ) page
    ORDER BY page.trip_date DESC, page.driver_name, page.created_at
    ${limit}
  `;
}

export type PeriodGauge = {
  legs: number;
  total_miles: string;
  active_drivers: number;
};

/** Workbench gauge: one index-only aggregate scan instead of fetching every period row */
export async function periodGauge(period: Period) {
  const rows = await prisma.$queryRaw<PeriodGauge[]>`
    SELECT count(*)::int AS legs,
           COALESCE(SUM(t.miles), 0)::text AS total_miles,
           count(DISTINCT t.driver_id)::int AS active_drivers
    FROM pay.trips t
    WHERE t.trip_date >= ${period.start}::date
      AND t.trip_date <= ${period.end}::date
  `;
  return rows[0] ?? { legs: 0, total_miles: "0", active_drivers: 0 };
}

export type PayrollMatrixRow = {
  driver_id: string;
  /** Truck numbers this driver ran in the period, from trip snapshots */
  trucks: string;
  full_name: string;
  driver_type: DriverType;
  trip_days: number;
  /** Leg counts keyed by operation code (codes from the ops.operation_types dictionary) */
  op_counts: Record<string, number>;
  leg_count: number;
  total_miles: string;
  total_fuel: string;
  total_pay: string;
  /** Owner fuel subsidy of the period (0 for plain drivers) */
  total_fuel_subsidy: string;
};

/** Payroll: driver x operation matrix for the period (includes active drivers without trips) */
export async function payrollMatrix(period: Period) {
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<
      Array<Omit<PayrollMatrixRow, "op_counts">>
    >`
      SELECT d.id::text AS driver_id,
             COALESCE(
               string_agg(DISTINCT t.truck_snapshot->>'truck_code', ', ' ORDER BY t.truck_snapshot->>'truck_code'),
               ''
             ) AS trucks,
             d.full_name,
             d.driver_type::text AS driver_type,
             count(DISTINCT t.trip_date)::int AS trip_days,
             count(t.id)::int AS leg_count,
             COALESCE(SUM(t.miles), 0)::text AS total_miles,
             COALESCE(SUM(t.fuel_gallons), 0)::text AS total_fuel,
             COALESCE(SUM(t.pay_amount), 0)::text AS total_pay,
             COALESCE(SUM(t.fuel_subsidy), 0)::text AS total_fuel_subsidy
      FROM ops.drivers d
      LEFT JOIN pay.trips t
        ON t.driver_id = d.id
        AND t.trip_date >= ${period.start}::date
        AND t.trip_date <= ${period.end}::date
      WHERE d.status = 'ACTIVE'
      GROUP BY d.id, d.full_name, d.driver_type
      ORDER BY d.full_name
    `,
    prisma.$queryRaw<Array<{ driver_id: string; operation: string; cnt: number }>>`
      SELECT driver_id::text AS driver_id, operation, count(*)::int AS cnt
      FROM pay.trips
      WHERE trip_date >= ${period.start}::date AND trip_date <= ${period.end}::date
      GROUP BY driver_id, operation
    `
  ]);
  const byDriver = new Map<string, Record<string, number>>();
  for (const c of counts) {
    const bucket = byDriver.get(c.driver_id) ?? {};
    bucket[c.operation] = c.cnt;
    byDriver.set(c.driver_id, bucket);
  }
  return rows.map(r => ({ ...r, op_counts: byDriver.get(r.driver_id) ?? {} }));
}

export type DriverPeriodTripRow = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  driver_type: DriverType;
  price_as_driver: boolean;
  trip_date: string;
  operation: OperationType;
  load_no: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_code: string | null;
  to_code: string | null;
  miles: string;
  fuel_gallons: string;
  pay_amount: string;
  /** Owner fuel subsidy snapshot (0 for plain drivers) */
  fuel_subsidy: string;
  notes: string | null;
  package_id: string | null;
  package_note: string | null;
};

/**
 * Try to walk the whole day as ONE route: an Eulerian trail over the leg
 * multigraph (each leg is an edge, its destination feeds the next origin).
 * Choices and the start anchor follow entry order (id); the step budget
 * guards pathological days. Returns null when no full trail exists.
 */
function oneDayTrail(chainable: DriverPeriodTripRow[]): DriverPeriodTripRow[] | null {
  const outgoing = new Map<string, DriverPeriodTripRow[]>();
  for (const leg of chainable) {
    const bucket = outgoing.get(leg.from_location_id!);
    if (bucket) bucket.push(leg);
    else outgoing.set(leg.from_location_id!, [leg]);
  }
  const trail: DriverPeriodTripRow[] = [];
  const used = new Set<string>();
  let budget = 5000;

  const walk = (origin: string | null): boolean => {
    if (used.size === chainable.length) return true;
    for (const cand of origin === null ? [] : outgoing.get(origin) ?? []) {
      if (used.has(cand.id) || budget-- <= 0) continue;
      used.add(cand.id);
      trail.push(cand);
      if (walk(cand.to_location_id)) return true;
      used.delete(cand.id);
      trail.pop();
    }
    return false;
  };

  // Start candidates in entry order; null destinations cannot continue
  for (const start of chainable) {
    used.add(start.id);
    trail.push(start);
    if (walk(start.to_location_id)) return trail;
    used.delete(start.id);
    trail.pop();
    if (budget <= 0) return null;
  }
  return null;
}

/**
 * Greedy fallback for days that cannot fully chain (missed legs, disjoint
 * tours): follow origin -> destination while possible, restart from the
 * earliest entered leftover when the chain breaks.
 */
function greedyChain(chainable: DriverPeriodTripRow[]): DriverPeriodTripRow[] {
  const chained: DriverPeriodTripRow[] = [];
  const remaining = [...chainable];
  while (remaining.length > 0) {
    const last = chained[chained.length - 1];
    const found = last?.to_location_id
      ? remaining.findIndex(l => l.from_location_id === last.to_location_id)
      : -1;
    chained.push(...remaining.splice(found === -1 ? 0 : found, 1));
  }
  return chained;
}

/**
 * Order one day's legs head-to-tail: each leg's destination feeds the next
 * leg's origin, round trips stay together. Days whose legs form one route
 * come out as a single unbroken chain; otherwise entry order (id) decides
 * ties and restarts. NULL-origin legs never chain and go last.
 */
function chainDayLegs(legs: DriverPeriodTripRow[]): DriverPeriodTripRow[] {
  const chainable = legs.filter(l => l.from_location_id !== null);
  const orphans = legs.filter(l => l.from_location_id === null);
  return [...(oneDayTrail(chainable) ?? greedyChain(chainable)), ...orphans];
}

/**
 * Payroll drill-down: every leg of one driver inside the period, grouped by
 * date, each day chained origin -> destination (entry order fills the gaps).
 */
export async function driverPeriodTrips(period: Period, driverId: string) {
  const rows = await prisma.$queryRaw<DriverPeriodTripRow[]>`
    SELECT t.id::text, t.driver_id::text, t.driver_name,
           d.driver_type::text AS driver_type, d.price_as_driver,
           to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date,
           t.operation::text AS operation, t.load_no,
           t.from_location_id::text AS from_location_id,
           t.to_location_id::text AS to_location_id,
           f.code AS from_code, o.code AS to_code,
           t.miles::text, t.fuel_gallons::text, t.pay_amount::text, t.fuel_subsidy::text,
           t.notes,
           t.package_id, t.package_note
    FROM pay.trips t
    JOIN ops.drivers d ON d.id = t.driver_id
    LEFT JOIN ops.locations f ON f.id = t.from_location_id
    LEFT JOIN ops.locations o ON o.id = t.to_location_id
    WHERE t.driver_id = ${driverId}::bigint
      AND t.trip_date >= ${period.start}::date
      AND t.trip_date <= ${period.end}::date
    ORDER BY t.trip_date, t.id
  `;
  // created_at ties within a submitted batch (one multi-row INSERT shares the
  // transaction timestamp), so id - the entry order - is the only stable base
  // before chaining
  const days: DriverPeriodTripRow[][] = [];
  for (const row of rows) {
    const day = days[days.length - 1];
    if (day && day[0].trip_date === row.trip_date) day.push(row);
    else days.push([row]);
  }
  return days.flatMap(chainDayLegs);
}

/**
 * Wage totals keyed by period start (Sat~Fri) across all history —
 * small dataset, powers the period picker's per-period wage column.
 */
export async function periodPayTotals() {
  const rows = await prisma.$queryRaw<Array<{ period_start: string; legs: number; pay: string }>>`
    SELECT (t.trip_date - ((extract(dow from t.trip_date) + 1) % 7) * interval '1 day')::date::text
             AS period_start,
           count(*)::int AS legs,
           COALESCE(SUM(t.pay_amount), 0)::text AS pay
    FROM pay.trips t
    GROUP BY 1
  `;
  return Object.fromEntries(
    rows.map(r => [r.period_start, { legs: r.legs, pay: Number(r.pay) }] as const)
  );
}
