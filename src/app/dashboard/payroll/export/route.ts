import ExcelJS from "exceljs";

import { requireUser } from "@/lib/auth";
import { DRIVER_TYPE_LABELS, STATEMENT_STATUS_LABELS } from "@/lib/labels";
import { currentPeriod, periodLabel, periodOf, type Period } from "@/lib/period";
import { listOperationTypes } from "@/lib/queries/operations";
import { mergedPeriodStatements } from "@/lib/queries/statements";
import { driverPeriodTrips } from "@/lib/queries/trips";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function dowOf(iso: string) {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const FMT_MONEY = '"$"#,##0.00';
const FMT_ONE = "#,##0.0";

/** Excel sheet names: <=31 chars, no []:*?/\ ; collide -> numeric suffix */
function sheetName(base: string, used: Set<string>) {
  const clean = base.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "司机";
  let name = clean;
  for (let i = 2; used.has(name); i++) name = `${clean.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(name);
  return name;
}

type DayGroup = {
  date: string;
  miles: number;
  fuel: number;
  pay: number;
};

/** Build one driver's detail sheet: every leg, day subtotals, week totals */
function addDriverSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  driver: Awaited<ReturnType<typeof mergedPeriodStatements>>[number],
  legs: Awaited<ReturnType<typeof driverPeriodTrips>>,
  period: Period
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { width: 14 }, { width: 10 }, { width: 12 }, { width: 28 },
    { width: 10, style: { numFmt: FMT_ONE } },
    { width: 10, style: { numFmt: FMT_ONE } },
    { width: 13, style: { numFmt: FMT_MONEY } },
    { width: 26 }
  ];

  // Driver identity + period + statement status, then the detail table
  const info = sheet.addRow([`${driver.full_name} · ${DRIVER_TYPE_LABELS[driver.driver_type]} · 车号：${driver.trucks || "—"}`]);
  info.font = { bold: true, size: 12 };
  sheet.mergeCells(1, 1, 1, 8);
  const sub = sheet.addRow([
    `核算周期 ${periodLabel(period)}（${period.start} ~ ${period.end}） · 工资单：${driver.status ? STATEMENT_STATUS_LABELS[driver.status] : "未生成"}`
  ]);
  sub.font = { color: { argb: "FF71717A" } };
  sheet.mergeCells(2, 1, 2, 8);
  sheet.addRow([]);

  const header = sheet.addRow(["日期", "操作", "Load#", "起点 → 终点", "里程(mi)", "加油(gal)", "本趟工资($)", "备注"]);
  header.font = { bold: true };

  // Legs arrive sorted by date then origin -> destination; group per day
  const days = new Map<string, DayGroup>();
  for (const leg of legs) {
    const day = days.get(leg.trip_date) ?? { date: leg.trip_date, miles: 0, fuel: 0, pay: 0 };
    sheet.addRow([
      `${leg.trip_date.slice(5).replace("-", "/")} 周${dowOf(leg.trip_date)}`,
      leg.operation, leg.load_no || "—",
      `${leg.from_code ?? "—"} → ${leg.to_code ?? "—"}`,
      Number(leg.miles), Number(leg.fuel_gallons), Number(leg.pay_amount),
      leg.notes ?? ""
    ]);
    day.miles += Number(leg.miles);
    day.fuel += Number(leg.fuel_gallons);
    day.pay += Number(leg.pay_amount);
    days.set(leg.trip_date, day);
  }

  for (const day of days.values()) {
    const row = sheet.addRow([`小计 · ${day.date.slice(5).replace("-", "/")} 周${dowOf(day.date)}`, "", "", "", day.miles, day.fuel, day.pay, ""]);
    row.font = { bold: true };
    sheet.mergeCells(row.number, 1, row.number, 4);
  }

  const totals = sheet.addRow([
    `行程合计 · ${legs.length} 段 / ${days.size} 天`, "", "", "",
    ...legs.reduce(
      (acc, l) => [acc[0] + Number(l.miles), acc[1] + Number(l.fuel_gallons), acc[2] + Number(l.pay_amount)],
      [0, 0, 0]
    ),
    ""
  ]);
  totals.font = { bold: true };
  sheet.mergeCells(totals.number, 1, totals.number, 4);

  // Generated statements freeze the numbers; when the frozen pay was adjusted
  // by hand it no longer matches the leg sum - show both so the gap is visible
  const legPay = legs.reduce((acc, l) => acc + Number(l.pay_amount), 0);
  if (driver.id !== null && Math.abs(Number(driver.total_pay) - legPay) >= 0.005) {
    const frozen = sheet.addRow([
      `工资单合计（${driver.leg_count} 段）`, "", "", "",
      Number(driver.total_miles), Number(driver.total_fuel), Number(driver.total_pay),
      driver.note ?? ""
    ]);
    frozen.font = { bold: true };
    sheet.mergeCells(frozen.number, 1, frozen.number, 4);
  }
}

/**
 * Payroll workbook for one period (Sat~Fri): a summary sheet (one row per
 * driver, statements winning over live aggregates) plus one detail sheet per
 * attended driver with every leg, day subtotals and week totals.
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

  // Operation columns follow the dictionary, plus legacy codes still present
  // in this period's trips/statements so totals never lose history
  const opCodes = [
    ...operations.map(o => o.code),
    ...[...new Set(rows.flatMap(r => Object.keys(r.op_counts)))].filter(
      code => !operations.some(o => o.code === code)
    )
  ];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "G&G PayOps";

  /* ---------- Summary sheet: what the old CSV carried ---------- */
  const summary = workbook.addWorksheet("汇总");
  const headerCells = [
    "车号", "姓名", "类型", "出勤天数",
    ...opCodes,
    "总段数", "总里程(mi)", "加油(gal)", "本期工资($)"
  ];
  summary.columns = [
    { width: 18 }, { width: 12 }, { width: 8 }, { width: 10 },
    ...opCodes.map(() => ({ width: 8 })),
    { width: 9 }, { width: 12, style: { numFmt: FMT_ONE } },
    { width: 10, style: { numFmt: FMT_ONE } }, { width: 13, style: { numFmt: FMT_MONEY } }
  ];
  const title = summary.addRow([`核算周期 ${periodLabel(period)}（${period.start} ~ ${period.end}）`]);
  title.font = { bold: true, size: 12 };
  summary.mergeCells(1, 1, 1, headerCells.length);
  summary.addRow([]);
  const header = summary.addRow(headerCells);
  header.font = { bold: true };
  for (const r of rows) {
    summary.addRow([
      r.trucks, r.full_name, DRIVER_TYPE_LABELS[r.driver_type], r.trip_days,
      ...opCodes.map(code => r.op_counts[code] ?? 0),
      r.leg_count, Number(r.total_miles), Number(r.total_fuel), Number(r.total_pay)
    ]);
  }
  const attended = rows.filter(r => r.leg_count > 0).length;
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const totals = summary.addRow([
    "合计", `${attended} 人出勤`, "",
    sum(r => r.trip_days),
    ...opCodes.map(code => sum(r => r.op_counts[code] ?? 0)),
    sum(r => r.leg_count),
    sum(r => Number(r.total_miles)), sum(r => Number(r.total_fuel)), sum(r => Number(r.total_pay))
  ]);
  totals.font = { bold: true };

  /* ---------- One detail sheet per attended driver ---------- */
  const drivers = rows.filter(r => r.leg_count > 0 || r.id !== null);
  const legLists = await Promise.all(drivers.map(d => driverPeriodTrips(period, d.driver_id)));
  const used = new Set<string>(["汇总"]);
  drivers.forEach((d, i) => addDriverSheet(workbook, sheetName(d.full_name, used), d, legLists[i], period));

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `工资表-${period.start}~${period.end}.xlsx`;
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="payroll-${period.start}_${period.end}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
