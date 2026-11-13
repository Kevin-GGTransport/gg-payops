import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/period";
import type { DriverType, StatementStatus } from "@/lib/labels";
import { payrollMatrix } from "@/lib/queries/trips";

/**
 * One driver's period rollup as shown on the payroll page. `status === null`
 * means no statement exists yet: the numbers are live aggregates from trips
 * and generating is the next action.
 */
export type StatementRow = {
  id: string | null;
  driver_id: string;
  full_name: string;
  driver_type: DriverType;
  period_start: string;
  period_end: string;
  status: StatementStatus | null;
  trip_days: number;
  leg_count: number;
  total_miles: string;
  total_fuel: string;
  total_pay: string;
  /** Leg counts per operation code (frozen when generated, live otherwise) */
  op_counts: Record<string, number>;
  trucks: string;
  note: string | null;
};

/** A stored statement: id/status always present (merged rows may lack them) */
export type GeneratedStatementRow = Omit<StatementRow, "id" | "status"> & {
  id: string;
  status: StatementStatus;
};

export type StatementStatusCounts = {
  total: number;
  draft: number;
  reviewed: number;
  verified: number;
  done: number;
};

const STATEMENT_SELECT = Prisma.sql`
  SELECT s.id::text, s.driver_id::text, d.full_name, d.driver_type::text AS driver_type,
         to_char(s.period_start, 'YYYY-MM-DD') AS period_start,
         to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
         s.status::text AS status, s.trip_days, s.leg_count,
         s.total_miles::text AS total_miles, s.total_fuel::text AS total_fuel,
         s.total_pay::text AS total_pay, s.op_counts, s.trucks, s.note
  FROM pay.payroll_statements s
  JOIN ops.drivers d ON d.id = s.driver_id
`;

/**
 * Statement list: every period by default, one period when `period` is set.
 * Status tabs and the name search share the period/q scoping so the counts
 * always match what the tabs will show.
 */
export async function listStatements(filter: {
  period: string | null;
  status: StatementStatus | "all";
  q: string;
}) {
  const scope = [
    filter.period ? Prisma.sql` AND s.period_start = ${filter.period}::date` : Prisma.sql``,
    filter.q ? Prisma.sql` AND d.full_name ILIKE ${`%${filter.q}%`}` : Prisma.sql``
  ];
  const statusClause =
    filter.status === "all" ? Prisma.sql`` : Prisma.sql` AND s.status = ${filter.status}::pay.statement_status`;

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<GeneratedStatementRow[]>`
      ${STATEMENT_SELECT}
      WHERE 1 = 1 ${scope[0]} ${scope[1]} ${statusClause}
      ORDER BY s.period_start DESC, d.full_name
    `,
    prisma.$queryRaw<StatementStatusCounts[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE s.status = 'DRAFT')::int AS draft,
             count(*) FILTER (WHERE s.status = 'REVIEWED')::int AS reviewed,
             count(*) FILTER (WHERE s.status = 'VERIFIED')::int AS verified,
             count(*) FILTER (WHERE s.status = 'DONE')::int AS done
      FROM pay.payroll_statements s
      JOIN ops.drivers d ON d.id = s.driver_id
      WHERE 1 = 1 ${scope[0]} ${scope[1]}
    `
  ]);
  return { rows, counts: counts[0] ?? { total: 0, draft: 0, reviewed: 0, verified: 0, done: 0 } };
}

export async function getStatementById(id: string) {
  const rows = await prisma.$queryRaw<GeneratedStatementRow[]>`
    ${STATEMENT_SELECT} WHERE s.id = ${id}::bigint LIMIT 1
  `;
  return rows[0] ?? null;
}

/** The driver's statement for one period, shown on the period detail sheet */
export async function getStatementByDriverPeriod(driverId: string, periodStart: string) {
  const rows = await prisma.$queryRaw<GeneratedStatementRow[]>`
    ${STATEMENT_SELECT}
    WHERE s.driver_id = ${driverId}::bigint AND s.period_start = ${periodStart}::date
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Per-period statement totals, feeding the period picker's wage column */
export async function statementPeriodTotals() {
  const rows = await prisma.$queryRaw<{ start: string; legs: number; pay: string }[]>`
    SELECT to_char(period_start, 'YYYY-MM-DD') AS start,
           sum(leg_count)::int AS legs,
           sum(total_pay)::text AS pay
    FROM pay.payroll_statements
    GROUP BY period_start
  `;
  return Object.fromEntries(
    rows.map(r => [r.start, { legs: r.legs, pay: Number(r.pay) }])
  ) satisfies Record<string, { legs: number; pay: number }>;
}

/**
 * One period's full rollup: every active driver, statements winning over the
 * live aggregates for the same driver. Un-generated drivers keep live numbers
 * with status null. Drivers who were deactivated after generating still show
 * their frozen row (the pay is owed).
 */
export async function mergedPeriodStatements(period: Period): Promise<StatementRow[]> {
  const [matrix, generated] = await Promise.all([
    payrollMatrix(period),
    listStatements({ period: period.start, status: "all", q: "" })
  ]);
  const byDriver = new Map(generated.rows.map(s => [s.driver_id, s]));

  const rows = matrix.map(r => {
    const s = byDriver.get(r.driver_id);
    return s ?? {
      id: null,
      driver_id: r.driver_id,
      full_name: r.full_name,
      driver_type: r.driver_type,
      period_start: period.start,
      period_end: period.end,
      status: null,
      trip_days: r.trip_days,
      leg_count: r.leg_count,
      total_miles: r.total_miles,
      total_fuel: r.total_fuel,
      total_pay: r.total_pay,
      op_counts: r.op_counts,
      trucks: r.trucks,
      note: null
    };
  });
  const matrixDrivers = new Set(matrix.map(r => r.driver_id));
  rows.push(...generated.rows.filter(s => !matrixDrivers.has(s.driver_id)));
  rows.sort((a, b) => a.full_name.localeCompare(b.full_name, "zh-Hans-CN"));
  return rows;
}
