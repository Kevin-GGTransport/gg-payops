import ExcelJS from "exceljs";

import { redirect } from "next/navigation";
import { requirePermission, getLinkedDriverId } from "@/lib/permissions";
import { defaultPeriod, periodLabel, periodOf } from "@/lib/period";
import { listFuelByPeriod } from "@/lib/queries/fuel";

const FMT_MONEY = '"$"#,##0.00';
// Miles round to integers in the export (matches the wage workbook)
const FMT_MI = "#,##0";
// Gallons carry three decimals (receipts read like 73.785)
const FMT_GAL = "#,##0.000";

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
 * Fuel-by-state workbook for one period (Sat~Fri): one sheet, one block per
 * truck (the hand-maintained 州 -> MILES/Gallon sheet this replaces), each
 * block ending in its subtotal row and the sheet in a grand total. Mirrors
 * the payroll export's styling so the two downloads read as one family.
 */
export async function GET(request: Request) {
  await requirePermission("payroll.read");
  // Fuel-by-state is fleet-wide truck data - driver-scoped accounts get no cut
  if ((await getLinkedDriverId()) !== null) redirect("/dashboard/forbidden");
  const url = new URL(request.url);
  const param = url.searchParams.get("period");
  const period =
    param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? periodOf(param) : defaultPeriod();

  const drivers = await listFuelByPeriod(period.start);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "G&G PayOps";

  const sheet = workbook.addWorksheet("加油-按州");
  sheet.columns = [
    { width: 12 }, { width: 10 }, { width: 12, style: { numFmt: FMT_MI } },
    { width: 12, style: { numFmt: FMT_GAL } }, { width: 12, style: { numFmt: FMT_MONEY } },
    { width: 28 }
  ];

  const title = sheet.addRow([`核算周期 ${periodLabel(period)}（${period.start} ~ ${period.end}）`]);
  title.font = { bold: true, size: 12 };
  sheet.mergeCells(1, 1, 1, 6);

  const header = sheet.addRow(["车号", "州", "MILES", "Gallon", "金额($)", "备注"]);
  gridify(header, true);

  // Truck blocks: rows carry a truckCode snapshot; blank snapshots group
  // under "—" so no row ever drops off the sheet
  const blocks = new Map<string, typeof drivers[number]["rows"]>();
  for (const driver of drivers) {
    for (const row of driver.rows) {
      const key = row.truckCode || "—";
      const list = blocks.get(key) ?? [];
      list.push(row);
      blocks.set(key, list);
    }
  }

  let grandGallons = 0;
  let grandMiles = 0;
  let grandAmount = 0;
  for (const [truckCode, rows] of blocks) {
    let blockGallons = 0;
    let blockMiles = 0;
    let blockAmount = 0;
    rows.forEach((row, i) => {
      const miles = Math.round(row.miles);
      gridify(
        sheet.addRow([
          i === 0 ? truckCode : "",
          row.stateCode,
          miles,
          row.gallons,
          row.amount,
          row.note
        ])
      );
      blockGallons += row.gallons;
      blockMiles += miles;
      blockAmount += row.amount;
    });
    gridify(
      sheet.addRow([
        `${truckCode} 合计`, "", blockMiles,
        Number(blockGallons.toFixed(3)), Number(blockAmount.toFixed(2)), ""
      ]),
      true
    );
    grandGallons += blockGallons;
    grandMiles += blockMiles;
    grandAmount += blockAmount;
  }

  if (blocks.size > 0) {
    gridify(
      sheet.addRow([
        "总计", "", grandMiles,
        Number(grandGallons.toFixed(3)), Number(grandAmount.toFixed(2)), ""
      ]),
      true
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `加油-按州-${period.start}~${period.end}.xlsx`;
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fuel-${period.start}_${period.end}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
