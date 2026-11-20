import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/period";
import type { DriverType, StatementStatus } from "@/lib/labels";

/**
 * One driver's period rollup as shown on the payroll page. `status === null`
 * means no statement exists - only ACTIVE drivers without trips (no entry,
 * nothing to pay); every driver with trips gets a statement at entry time.
 */
export type StatementRow = {
  id: string | null;
  driver_id: string;
  full_name: string;
  driver_type: DriverType;
  period_start: string;
  period_end: string;
  status: StatementStatus | null;
  /** Permanent flag: trips changed under a checked statement (detail red) */
  edited_after_verify: boolean;
  trip_days: number;
  leg_count: number;
  total_miles: string;
  total_fuel: string;
  total_pay: string;
  /** Owner fuel subsidy of the period (live in DRAFT, frozen once checked) */
  total_fuel_subsidy: string;
  /** Signed net of custom fees (ADD minus SUB); stays editable after verify */
  total_custom_fees: string;
  /** Custom fee rows as stored (jsonb array; parse via parseCustomFees) */
  custom_fees: unknown;
  /** Leg counts per operation code (live in DRAFT, frozen once checked) */
  op_counts: Record<string, number>;
  trucks: string;
  note: string | null;
  /** Gallons summed off fuel_detail (the by-state rollup, not total_fuel) */
  fuel_gal: string;
  /** Live trip sum for the period (the list's "differs from frozen" hint) */
  live_pay: string;
  /** Verification-time snapshot (jsonb as stored; null before 0031 / drafts) */
  verify_snapshot: unknown;
};

/** A stored statement: id/status always present (merged rows may lack them) */
export type GeneratedStatementRow = Omit<StatementRow, "id" | "status"> & {
  id: string;
  status: StatementStatus;
};

/** One leg's editable fields as frozen at verification (raw strings off jsonb) */
export type SnapshotLeg = {
  id: string;
  trip_date: string;
  operation: string;
  load_no: string | null;
  from_code: string | null;
  to_code: string | null;
  miles: string;
  fuel_gallons: string;
  pay_amount: string;
  notes: string | null;
};

/** One fuel-by-state row as frozen at verification */
export type SnapshotFuelRow = {
  stateCode: string;
  gallons: number;
  miles: number;
  amount: number;
};

/** The whole verification-time snapshot stored on the statement row */
export type VerifySnapshot = {
  legs: SnapshotLeg[];
  fuel: SnapshotFuelRow[];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Narrow the jsonb payload into a VerifySnapshot. jsonb is trusted-by-us
 * storage but still external input to the type system: anything malformed
 * (legacy shapes, truncation, manual edits) falls back to null, which the
 * detail sheet renders as the statement-level red only.
 */
export function parseVerifySnapshot(value: unknown): VerifySnapshot | null {
  if (!isRecord(value)) return null;
  const legs = value.legs;
  const fuel = value.fuel;
  if (!Array.isArray(legs) || !Array.isArray(fuel)) return null;
  const parsedLegs: SnapshotLeg[] = [];
  for (const leg of legs) {
    if (!isRecord(leg)) return null;
    const id = str(leg.id);
    const date = str(leg.trip_date);
    const operation = str(leg.operation);
    if (id === null || date === null || operation === null) return null;
    parsedLegs.push({
      id,
      trip_date: date,
      operation,
      load_no: str(leg.load_no),
      from_code: str(leg.from_code),
      to_code: str(leg.to_code),
      miles: str(leg.miles) ?? "0",
      fuel_gallons: str(leg.fuel_gallons) ?? "0",
      pay_amount: str(leg.pay_amount) ?? "0",
      notes: str(leg.notes)
    });
  }
  const parsedFuel: SnapshotFuelRow[] = [];
  for (const row of fuel) {
    if (!isRecord(row)) return null;
    const stateCode = str(row.stateCode);
    const gallons = row.gallons;
    const miles = row.miles;
    const amount = row.amount;
    if (
      stateCode === null ||
      typeof gallons !== "number" ||
      typeof miles !== "number" ||
      typeof amount !== "number"
    ) {
      return null;
    }
    parsedFuel.push({ stateCode, gallons, miles, amount });
  }
  return { legs: parsedLegs, fuel: parsedFuel };
}

export type StatementStatusCounts = {
  total: number;
  draft: number;
  verified: number;
};

const STATEMENT_SELECT = Prisma.sql`
  SELECT s.id::text, s.driver_id::text, d.full_name, d.driver_type::text AS driver_type,
         to_char(s.period_start, 'YYYY-MM-DD') AS period_start,
         to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
         s.status::text AS status, s.edited_after_verify,
         s.trip_days, s.leg_count,
         s.total_miles::text AS total_miles, s.total_fuel::text AS total_fuel,
         s.total_pay::text AS total_pay, s.total_fuel_subsidy::text AS total_fuel_subsidy,
         s.total_custom_fees::text AS total_custom_fees, s.custom_fees,
         s.op_counts, s.trucks, s.note,
         (SELECT COALESCE(sum((e->>'gallons')::numeric), 0)
          FROM jsonb_array_elements(s.fuel_detail) e)::text AS fuel_gal,
         (SELECT COALESCE(sum(t.pay_amount), 0)
          FROM pay.trips t
          WHERE t.driver_id = s.driver_id
            AND t.trip_date >= s.period_start
            AND t.trip_date <= s.period_end)::text AS live_pay,
         s.verify_snapshot
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
  // The 核对 tab covers both checked states (VERIFIED + DONE driver
  // confirmed) so confirmed sheets never fall out of the tab
  const statusClause =
    filter.status === "all"
      ? Prisma.sql``
      : filter.status === "VERIFIED"
        ? Prisma.sql` AND s.status IN ('VERIFIED', 'DONE')`
        : Prisma.sql` AND s.status = ${filter.status}::pay.statement_status`;

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<GeneratedStatementRow[]>`
      ${STATEMENT_SELECT}
      WHERE 1 = 1 ${scope[0]} ${scope[1]} ${statusClause}
      ORDER BY s.period_start DESC, d.full_name
    `,
    prisma.$queryRaw<StatementStatusCounts[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE s.status = 'DRAFT')::int AS draft,
             count(*) FILTER (WHERE s.status IN ('VERIFIED', 'DONE'))::int AS verified
      FROM pay.payroll_statements s
      JOIN ops.drivers d ON d.id = s.driver_id
      WHERE 1 = 1 ${scope[0]} ${scope[1]}
    `
  ]);
  return { rows, counts: counts[0] ?? { total: 0, draft: 0, verified: 0 } };
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
           sum(total_pay + total_custom_fees)::text AS pay
    FROM pay.payroll_statements
    GROUP BY period_start
  `;
  return Object.fromEntries(
    rows.map(r => [r.start, { legs: r.legs, pay: Number(r.pay) }])
  ) satisfies Record<string, { legs: number; pay: number }>;
}

/**
 * One period's full rollup: every stored statement, plus ACTIVE drivers
 * without one (no trips - dimmed zero rows for roster context). Drivers who
 * were deactivated after their statement was created still show their row
 * (the pay is owed). Statement numbers are live in DRAFT, frozen once checked
 * (VERIFIED and DONE alike).
 */
export async function mergedPeriodStatements(period: Period): Promise<StatementRow[]> {
  const [generated, actives] = await Promise.all([
    listStatements({ period: period.start, status: "all", q: "" }),
    prisma.$queryRaw<
      Array<{ driver_id: string; full_name: string; driver_type: DriverType }>
    >`
      SELECT id::text AS driver_id, full_name, driver_type::text AS driver_type
      FROM ops.drivers
      WHERE status = 'ACTIVE'
    `
  ]);
  const byDriver = new Map(generated.rows.map(s => [s.driver_id, s]));

  const rows: StatementRow[] = [...generated.rows];
  for (const d of actives) {
    if (byDriver.has(d.driver_id)) continue;
    rows.push({
      id: null,
      driver_id: d.driver_id,
      full_name: d.full_name,
      driver_type: d.driver_type,
      period_start: period.start,
      period_end: period.end,
      status: null,
      edited_after_verify: false,
      trip_days: 0,
      leg_count: 0,
      total_miles: "0",
      total_fuel: "0",
      total_pay: "0",
      total_fuel_subsidy: "0",
      total_custom_fees: "0",
      custom_fees: null,
      op_counts: {},
      trucks: "",
      note: null,
      fuel_gal: "0",
      live_pay: "0",
      verify_snapshot: null
    });
  }
  rows.sort((a, b) => a.full_name.localeCompare(b.full_name, "zh-Hans-CN"));
  return rows;
}
