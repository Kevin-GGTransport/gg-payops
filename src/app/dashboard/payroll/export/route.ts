import ExcelJS from "exceljs";

import { requireUser } from "@/lib/auth";
import { DRIVER_TYPE_LABELS } from "@/lib/labels";
import { defaultPeriod, periodLabel, periodOf, type Period } from "@/lib/period";
import { listOperationTypes } from "@/lib/queries/operations";
import { mergedPeriodStatements } from "@/lib/queries/statements";
import { driverPeriodTrips } from "@/lib/queries/trips";

const FMT_MONEY = '"$"#,##0.00';
const FMT_ONE = "#,##0.0";
// Detail sheets follow the reference workbook: plain numbers, no $ sign
const FMT_PAY = "#,##0.00";

/** Excel sheet names: <=31 chars, no []:*?/\ ; collide -> numeric suffix */
function sheetName(base: string, used: Set<string>) {
  const clean = base.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "司机";
  let name = clean;
  for (let i = 2; used.has(name); i++) name = `${clean.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(name);
  return name;
}

/** "2026-11-07" -> "11/7" for the banner, matching the reference sheet */
function mdOf(iso: string) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

/** Non-zero-padded "2026-11-7" date cell, the reference sheet's style */
function dateCell(iso: string) {
  return `${iso.slice(0, 4)}-${Number(iso.slice(5, 7))}-${Number(iso.slice(8, 10))}`;
}

const THIN = { style: "thin" as const, color: { argb: "FF000000" } };
const GRID = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/** Reference-sheet look: full thin grid, everything centered */
function gridify(row: ExcelJS.Row, bold = false) {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.border = GRID;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    if (bold) cell.font = { bold: true };
  });
}

/**
 * Build one driver's detail sheet in the reference workbook's shape: a single
 * banner row (name + period + truck annotation), a flat bordered grid of legs
 * (date printed once per day), then the fuel-subsidy line and the Total row -
 * the subsidy lands in the Driver column so the column sum equals total
 * payable.
 */
function addDriverSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  driver: Awaited<ReturnType<typeof mergedPeriodStatements>>[number],
  legs: Awaited<ReturnType<typeof driverPeriodTrips>>,
  period: Period,
  opLabels: Map<string, string>
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { width: 12 }, { width: 16 }, { width: 24 }, { width: 10 }, { width: 10 },
    { width: 12 }, { width: 10, style: { numFmt: FMT_ONE } },
    { width: 12, style: { numFmt: FMT_PAY } }
  ];

  // Banner like "David Gao 10/31-11/6（521）"; no truck -> no annotation
  const banner = sheet.addRow([
    `${driver.full_name} ${mdOf(period.start)}-${mdOf(period.end)}${driver.trucks ? `（${driver.trucks}）` : ""}`
  ]);
  banner.font = { bold: true, size: 12 };
  banner.alignment = { horizontal: "center" };
  sheet.mergeCells(1, 1, 1, 8);

  const header = sheet.addRow(["Date", "Load#", "Nature", "From", "To", "操作方式", "Miles", "Driver"]);
  gridify(header, true);

  let prevDate = "";
  let totalMiles = 0;
  let totalPay = 0;
  let subsidy = 0;
  for (const leg of legs) {
    const row = sheet.addRow([
      leg.trip_date === prevDate ? "" : dateCell(leg.trip_date),
      leg.load_no ?? "",
      `${leg.from_code ?? ""} -> ${leg.to_code ?? ""}`,
      leg.from_code ?? "",
      leg.to_code ?? "",
      leg.operation ? (opLabels.get(leg.operation) ?? leg.operation) : "",
      Number(leg.miles),
      Number(leg.pay_amount)
    ]);
    gridify(row);
    prevDate = leg.trip_date;
    totalMiles += Number(leg.miles);
    totalPay += Number(leg.pay_amount);
    subsidy += Number(leg.fuel_subsidy);
  }

  // Fuel-subsidy settlement line for every driver (and owner): label sits
  // under Load#, amount in the Driver column
  const fuel = sheet.addRow(["", "燃油补助", "", "", "", "", null, Number(subsidy.toFixed(2))]);
  gridify(fuel, true);

  const total = sheet.addRow([
    "Total", "", "", "", "", "",
    Number(totalMiles.toFixed(1)), Number((totalPay + subsidy).toFixed(2))
  ]);
  gridify(total, true);

  // VERIFIED statements freeze the numbers; when a verified sheet was flagged
  // (trips changed after verification) the frozen pay no longer matches the
  // leg sum - append the frozen row so the gap stays visible on the export
  if (driver.id !== null && Math.abs(Number(driver.total_pay) - totalPay) >= 0.005) {
    const frozen = sheet.addRow([
      `工资单合计（核对冻结 ${driver.leg_count} 段）`, "", "", "", "",
      Number(driver.total_miles), Number(driver.total_pay)
    ]);
    frozen.eachCell({ includeEmpty: true }, cell => {
      cell.border = GRID;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { bold: true, color: { argb: "FFB91C1C" } };
    });
    sheet.mergeCells(frozen.number, 1, frozen.number, 5);
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
    param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? periodOf(param) : defaultPeriod();

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
    "总段数", "总里程(mi)", "加油(gal)", "燃油补助($)", "本期工资($)"
  ];
  summary.columns = [
    { width: 18 }, { width: 12 }, { width: 8 }, { width: 10 },
    ...opCodes.map(() => ({ width: 8 })),
    { width: 9 }, { width: 12, style: { numFmt: FMT_ONE } },
    { width: 10, style: { numFmt: FMT_ONE } },
    { width: 12, style: { numFmt: FMT_MONEY } }, { width: 13, style: { numFmt: FMT_MONEY } }
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
      r.leg_count, Number(r.total_miles), Number(r.total_fuel),
      Number(r.total_fuel_subsidy), Number(r.total_pay)
    ]);
  }
  const attended = rows.filter(r => r.leg_count > 0).length;
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const totals = summary.addRow([
    "合计", `${attended} 人出勤`, "",
    sum(r => r.trip_days),
    ...opCodes.map(code => sum(r => r.op_counts[code] ?? 0)),
    sum(r => r.leg_count),
    sum(r => Number(r.total_miles)), sum(r => Number(r.total_fuel)),
    sum(r => Number(r.total_fuel_subsidy)), sum(r => Number(r.total_pay))
  ]);
  totals.font = { bold: true };

  /* ---------- One detail sheet per attended driver ---------- */
  const opLabels = new Map(operations.map(o => [o.code, o.label]));
  const drivers = rows.filter(r => r.leg_count > 0 || r.id !== null);
  const legLists = await Promise.all(drivers.map(d => driverPeriodTrips(period, d.driver_id)));
  const used = new Set<string>(["汇总"]);
  drivers.forEach((d, i) =>
    addDriverSheet(workbook, sheetName(d.full_name, used), d, legLists[i], period, opLabels)
  );

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `工资表-${period.start}~${period.end}.xlsx`;
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="payroll-${period.start}_${period.end}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
