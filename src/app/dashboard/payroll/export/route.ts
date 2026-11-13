import { requireUser } from "@/lib/auth";
import { DRIVER_TYPE_LABELS } from "@/lib/labels";
import { currentPeriod, periodLabel, periodOf, type Period } from "@/lib/period";
import { listOperationTypes } from "@/lib/queries/operations";
import { mergedPeriodStatements } from "@/lib/queries/statements";

/** Quote one CSV cell (RFC 4180: wrap in quotes, double embedded quotes) */
function cell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * Payroll CSV for one period (Sat~Fri): one row per active driver plus a
 * totals row. Generated statements win over the live aggregates (frozen
 * snapshot); drivers without one keep the live numbers. UTF-8 BOM keeps
 * Chinese headers readable when opened in Excel.
 */
export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const param = url.searchParams.get("period");
  const period: Period =
    param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? periodOf(param) : currentPeriod();

  const [rows, operations] = await Promise.all([
    mergedPeriodStatements(period),
    listOperationTypes()
  ]);

  const attended = rows.filter(r => r.leg_count > 0).length;
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);
  // Operation columns follow the dictionary, plus legacy codes still present
  // in this period's trips/statements so totals never lose history
  const opCodes = [
    ...operations.map(o => o.code),
    ...[...new Set(rows.flatMap(r => Object.keys(r.op_counts)))].filter(
      code => !operations.some(o => o.code === code)
    )
  ];

  const lines: Array<Array<string | number>> = [
    [`核算周期 ${periodLabel(period)}（${period.start} ~ ${period.end}）`],
    [],
    [
      "车号", "姓名", "类型", "出勤天数",
      ...opCodes,
      "总段数", "总里程(mi)", "加油(gal)", "本期工资($)"
    ],
    ...rows.map(r => [
      r.trucks, r.full_name, DRIVER_TYPE_LABELS[r.driver_type], r.trip_days,
      ...opCodes.map(code => r.op_counts[code] ?? 0),
      r.leg_count, r.total_miles, r.total_fuel, r.total_pay
    ]),
    [
      "合计", `${attended} 人出勤`, "",
      sum(r => r.trip_days),
      ...opCodes.map(code => sum(r => r.op_counts[code] ?? 0)),
      sum(r => r.leg_count),
      (sum(r => Number(r.total_miles))).toFixed(2),
      (sum(r => Number(r.total_fuel))).toFixed(2),
      (sum(r => Number(r.total_pay))).toFixed(2)
    ]
  ];

  const csv =
    "﻿" + lines.map(cols => cols.map(cell).join(",")).join("\r\n") + "\r\n";
  const filename = `工资表-${period.start}~${period.end}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${period.start}_${period.end}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
