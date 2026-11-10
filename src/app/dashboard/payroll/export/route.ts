import { requireUser } from "@/lib/auth";
import { DRIVER_TYPE_LABELS } from "@/lib/labels";
import { currentPeriod, periodLabel, periodOf, type Period } from "@/lib/period";
import { payrollMatrix } from "@/lib/queries/trips";

/** Quote one CSV cell (RFC 4180: wrap in quotes, double embedded quotes) */
function cell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * Payroll CSV for one period (Sat~Fri): one row per active driver plus a
 * totals row. UTF-8 BOM keeps Chinese headers readable when opened in Excel.
 */
export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const param = url.searchParams.get("period");
  const period: Period =
    param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? periodOf(param) : currentPeriod();

  const rows = await payrollMatrix(period);
  const attended = rows.filter(r => r.leg_count > 0).length;
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);

  const lines: Array<Array<string | number>> = [
    [`核算周期 ${periodLabel(period)}（${period.start} ~ ${period.end}）`],
    [],
    [
      "工号", "姓名", "类型", "出勤天数",
      "DEL", "LIVE", "EMPTY", "BOBTAIL",
      "总段数", "总里程(mi)", "本期工资($)"
    ],
    ...rows.map(r => [
      r.driver_code, r.full_name, DRIVER_TYPE_LABELS[r.driver_type], r.trip_days,
      r.del_count, r.live_count, r.empty_count, r.bobtail_count,
      r.leg_count, r.total_miles, r.total_pay
    ]),
    [
      "合计", `${attended} 人出勤`, "",
      sum(r => r.trip_days),
      sum(r => r.del_count), sum(r => r.live_count), sum(r => r.empty_count), sum(r => r.bobtail_count),
      sum(r => r.leg_count),
      (sum(r => Number(r.total_miles))).toFixed(2),
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
