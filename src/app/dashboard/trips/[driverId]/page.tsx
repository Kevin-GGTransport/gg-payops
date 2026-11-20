import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/flash-toast";
import { FormError } from "@/components/form-fields";
import { LedgerPanel } from "@/components/ledger";
import { SubmitButton } from "@/components/submit-button";
import { DriverTypeBadge, StatementStatusBadge } from "@/components/badges";
import { PeriodPicker } from "@/components/period-picker";
import { requireUser } from "@/lib/auth";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { fuel as fmtFuel, miles as fmtMiles, money, todayIso } from "@/lib/format";
import { defaultPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import { getDriverById } from "@/lib/queries/drivers";
import { activeOperationOptions } from "@/lib/queries/operations";
import { activeLocationOptions } from "@/lib/queries/locations";
import { currentWageRule } from "@/lib/queries/wage-rules";
import { driverPeriodTrips, periodPayTotals, type DriverPeriodTripRow } from "@/lib/queries/trips";
import { getStatementByDriverPeriod, parseVerifySnapshot } from "@/lib/queries/statements";
import { activeStateOptions, statementFuelDetail } from "@/lib/queries/fuel";
import { FuelEditor, type FuelEditRow } from "./fuel-editor";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { activeTruckOptions } from "@/lib/queries/trucks";
import { confirmDriverStatement, verifyStatement } from "../../payroll/actions";
import { CopyStatementButton } from "../../payroll/copy-statement-dialog";
import { ChangeTruckButton } from "../../payroll/change-truck-dialog";
import { PayrollLegsTable } from "../payroll-legs-table";

export const metadata: Metadata = { title: "周期工资单 · G&G PayOps" };

/** Fuel-editor error copy (the action redirects back with these codes) */
const FUEL_ERRORS: Record<string, string> = {
  fuel_missing_state: "该行加油未选择州。",
  fuel_bad_state: "该行加油的州不在字典中，请重新选择。"
};

const arrowClass =
  "grid h-9.5 w-8 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40";

function dateParam(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toString() !== "Invalid Date" ? v : undefined;
}

/** Group one driver's period legs by date; each group carries day subtotals */
function groupByDay(legs: DriverPeriodTripRow[]) {
  const days: Array<{
    date: string;
    legs: DriverPeriodTripRow[];
    miles: number;
    fuel: number;
    pay: number;
    subsidy: number;
  }> = [];
  for (const leg of legs) {
    const day = days.find(d => d.date === leg.trip_date);
    if (day) {
      day.legs.push(leg);
      day.miles += Number(leg.miles);
      day.fuel += Number(leg.fuel_gallons);
      day.pay += Number(leg.pay_amount);
      day.subsidy += Number(leg.fuel_subsidy);
    } else {
      days.push({
        date: leg.trip_date,
        legs: [leg],
        miles: Number(leg.miles),
        fuel: Number(leg.fuel_gallons),
        pay: Number(leg.pay_amount),
        subsidy: Number(leg.fuel_subsidy)
      });
    }
  }
  return days;
}

/**
 * One driver's settlement sheet for one period (Sat ~ Fri): identity masthead,
 * the driver's own gauge strip (legs / miles / fuel / pay), then the day-ledger
 * drill-down with delete. Reached from the payroll matrix's 详情 action.
 */
export default async function DriverPeriodPage({
  params,
  searchParams
}: {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const { driverId } = await params;
  if (!/^\d+$/.test(driverId)) notFound();

  const driver = await getDriverById(driverId);
  if (!driver) notFound();

  const sp = await searchParams;
  // Trip edits saved (inline batch or dialog) redirect back here
  const saved = firstValue(sp.saved) === "1";
  // Same landing default as the payroll list: the week that just closed
  const periodParam = dateParam(firstValue(sp.period));
  const period = periodParam ? periodOf(periodParam) : defaultPeriod();
  const defaultWeek = defaultPeriod();
  const today = todayIso();
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);

  const [legs, periodTotals, statement, fuelDetail, stateOptions, locations, wageRule, operationOptions, driverOptions, truckOptions] =
    await Promise.all([
      driverPeriodTrips(period, driver.id),
      periodPayTotals(),
      getStatementByDriverPeriod(driver.id, period.start),
      // Fuel-by-state rollup off the statement (frozen once verified)
      statementFuelDetail(driver.id, period.start),
      // Fuel-editor state dictionary
      activeStateOptions(),
      // Edit-dialog dictionaries (in-page client dialog, always mounted)
      activeLocationOptions(),
      currentWageRule(),
      activeOperationOptions(),
      // Copy-dialog pickers (copy this draft statement onto another driver)
      activeDriverOptions(),
      activeTruckOptions()
    ]);
  const days = groupByDay(legs);
  const totals = legs.reduce(
    (acc, leg) => ({
      miles: acc.miles + Number(leg.miles),
      fuel: acc.fuel + Number(leg.fuel_gallons),
      pay: acc.pay + Number(leg.pay_amount),
      subsidy: acc.subsidy + Number(leg.fuel_subsidy)
    }),
    { miles: 0, fuel: 0, pay: 0, subsidy: 0 }
  );
  // Fuel rollup totals off the statement's by-state rows (the stored week
  // truth); the per-leg ledger sum only shows when none were entered
  const fuelRollup = fuelDetail.reduce(
    (acc, row) => ({
      gallons: acc.gallons + row.gallons,
      miles: acc.miles + row.miles,
      amount: acc.amount + row.amount
    }),
    { gallons: 0, miles: 0, amount: 0 }
  );

  // Fuel editor feed: a failed save's URL refill wins over the stored rows
  const fuelRefillCount = Number.parseInt(firstValue(sp.f_fuel_row_count) ?? "", 10);
  const fuelRefillRows: FuelEditRow[] =
    Number.isFinite(fuelRefillCount) && fuelRefillCount >= 1
      ? Array.from({ length: fuelRefillCount }, (_, i) => ({
          state: firstValue(sp[`f_fuel_row_${i}_state_code`]) ?? "",
          gallons: firstValue(sp[`f_fuel_row_${i}_gallons`]) ?? "",
          miles: firstValue(sp[`f_fuel_row_${i}_miles`]) ?? "",
          amount: firstValue(sp[`f_fuel_row_${i}_amount`]) ?? "",
          note: firstValue(sp[`f_fuel_row_${i}_note`]) ?? "",
          truckCode: firstValue(sp[`f_fuel_row_${i}_truck_code`]) ?? ""
        }))
      : [];
  const fuelEditRows: FuelEditRow[] =
    fuelRefillRows.length > 0
      ? fuelRefillRows
      : fuelDetail.map(r => ({
          state: r.stateCode,
          gallons: String(r.gallons),
          miles: String(r.miles),
          amount: String(r.amount),
          note: r.note,
          truckCode: r.truckCode
        }));
  // Truck snapshot for new editor rows: the stored rows' code, else the
  // statement's truck annotation
  const fuelDefaultTruck =
    fuelDetail[0]?.truckCode || (statement?.trucks ?? "").split(",")[0]?.trim() || "";
  const fuelSavedParam = Number.parseInt(firstValue(sp.fuel_saved) ?? "", 10);
  const fuelSaved = Number.isFinite(fuelSavedParam) && fuelSavedParam >= 0 ? fuelSavedParam : undefined;
  const fuelErrorCode = firstValue(sp.error);
  const fuelRowNo = Number.parseInt(firstValue(sp.fuel) ?? "", 10);
  const fuelError =
    fuelErrorCode && fuelErrorCode in FUEL_ERRORS
      ? `${Number.isFinite(fuelRowNo) && fuelRowNo >= 1 ? `第 ${fuelRowNo} 行：` : ""}${FUEL_ERRORS[fuelErrorCode]}`
      : undefined;

  // Full-path return so verify / per-row delete stays on this sheet
  const returnTo = `/dashboard/trips/${driver.id}?period=${period.start}`;
  const navHref = (p: { start: string }) => `/dashboard/trips/${driver.id}?period=${p.start}`;

  // Draft numbers always equal the live ledger; checked sheets (VERIFIED and
  // DONE alike) freeze them. The permanent edited_after_verify flag (not a
  // live comparison) drives the detail-only red
  const statementFrozen = statement !== null && statement.status !== "DRAFT";

  // Post-verify change localization: diff the live legs against the frozen
  // snapshot so the sheet can mark exactly WHICH cells moved. Legacy rows
  // (null snapshot, verified before 0031) keep the statement-level red only.
  const numEq = (a: string | null, b: string | null) => Number(a ?? 0) === Number(b ?? 0);
  const textEq = (a: string | null, b: string | null) => (a ?? "") === (b ?? "");
  const snapshot = statementFrozen ? parseVerifySnapshot(statement.verify_snapshot) : null;
  const changedFieldsByLeg: Record<string, string[]> = {};
  const addedLegIds: string[] = [];
  const changedFuelStates: string[] = [];
  const addedFuelStates: string[] = [];
  let deletedLegs = 0;
  let deletedFuelStates = 0;
  if (snapshot) {
    const snapById = new Map(snapshot.legs.map(l => [l.id, l]));
    for (const leg of legs) {
      const snap = snapById.get(leg.id);
      if (!snap) {
        addedLegIds.push(leg.id);
        continue;
      }
      snapById.delete(leg.id);
      const fields: string[] = [];
      if (snap.trip_date !== leg.trip_date) fields.push("trip_date");
      if (!textEq(snap.operation, leg.operation)) fields.push("operation");
      if (!textEq(snap.load_no, leg.load_no)) fields.push("load_no");
      if (!textEq(snap.from_code, leg.from_code)) fields.push("from");
      if (!textEq(snap.to_code, leg.to_code)) fields.push("to");
      if (!numEq(snap.miles, leg.miles)) fields.push("miles");
      if (!numEq(snap.fuel_gallons, leg.fuel_gallons)) fields.push("fuel_gallons");
      if (!numEq(snap.pay_amount, leg.pay_amount)) fields.push("pay_amount");
      if (!textEq(snap.notes, leg.notes)) fields.push("notes");
      if (fields.length > 0) changedFieldsByLeg[leg.id] = fields;
    }
    deletedLegs = snapById.size;
    const snapFuel = new Map(snapshot.fuel.map(r => [r.stateCode, r]));
    for (const row of fuelDetail) {
      const snap = snapFuel.get(row.stateCode);
      if (!snap) {
        addedFuelStates.push(row.stateCode);
        continue;
      }
      snapFuel.delete(row.stateCode);
      if (
        snap.gallons !== row.gallons ||
        snap.miles !== row.miles ||
        snap.amount !== row.amount
      ) {
        changedFuelStates.push(row.stateCode);
      }
    }
    deletedFuelStates = snapFuel.size;
  }
  const changedLegCount = Object.keys(changedFieldsByLeg).length;
  // Banner summary off the localized diff (legacy rows keep the plain text)
  const fuelTouched =
    changedFuelStates.length + addedFuelStates.length + deletedFuelStates;
  const changeSummary = snapshot
    ? [
        changedLegCount > 0 ? `${changedLegCount} 段有改动` : null,
        addedLegIds.length > 0 ? `${addedLegIds.length} 段新增` : null,
        deletedLegs > 0 ? `${deletedLegs} 段已删除` : null,
        fuelTouched > 0 ? "加油有改动" : null
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  // Muted name tone for the whole page: dark green once verified, dark red
  // once driver-confirmed or edited after checking - dim shades only
  const nameTone = statement
    ? statement.edited_after_verify || statement.status === "DONE"
      ? "text-red-800"
      : statementFrozen
        ? "text-emerald-800"
        : undefined
    : undefined;

  return (
    <>
      {saved && <FlashToast message="修改已保存" param="saved" />}
      {fuelSaved !== undefined && (
        <FlashToast
          message={fuelSaved > 0 ? `已保存 ${fuelSaved} 州加油` : "已清空本周期加油"}
          param="fuel_saved"
        />
      )}
      {fuelError && <FormError message={fuelError} />}
      <PageHeader
        title={
          <>
            <span className={nameTone}>{driver.full_name}</span> · 周期工资单
          </>
        }
        description={
          statement ? (
            statement.edited_after_verify ? (
              <>
                <StatementStatusBadge status={statement.status} edited />
                <span className="text-red-700">
                  {" "}核对后行程有改动{changeSummary && `（${changeSummary}）`}：核对金额 {money(statement.total_pay)} 已冻结（改动不自动计入）{snapshot ? "，改动处已标红" : ""}，请人工复核。
                </span>
              </>
            ) : (
              <>
                工资单 <StatementStatusBadge status={statement.status} />
                {statement.status === "DONE"
                  ? " 司机已确认，金额冻结；再改行程只在详情页标红。"
                  : statementFrozen
                    ? " 已核对，金额冻结；可标记司机确认；再改行程只在详情页标红。"
                    : " 草稿中，数字实时跟随行程。"}
              </>
            )
          ) : (
            <>本周期行程与工资台账，按日分组核对（无行程，无工资单）。</>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            {statement && legs.length > 0 && (
              <ChangeTruckButton
                statement={statement}
                trucks={truckOptions}
                returnTo={returnTo}
                triggerClassName="button button-quiet"
              />
            )}
            {statement && statement.status === "DRAFT" && legs.length > 0 && (
              <>
                <CopyStatementButton
                  statement={statement}
                  drivers={driverOptions}
                  trucks={truckOptions}
                  triggerClassName="button button-quiet"
                />
                <form action={verifyStatement}>
                  <input type="hidden" name="id" value={statement.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <SubmitButton className="button button-dark" pendingLabel="核对中…">
                    标记核对
                  </SubmitButton>
                </form>
              </>
            )}
            {statement && statement.status === "VERIFIED" && legs.length > 0 && (
              <form action={confirmDriverStatement}>
                <input type="hidden" name="id" value={statement.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <SubmitButton className="button button-dark" pendingLabel="确认中…">
                  司机确认
                </SubmitButton>
              </form>
            )}
            <Link className="button button-quiet" href={`/dashboard/payroll?period=${period.start}`}>
              返回工资单
            </Link>
            <Link className="button button-quiet" href={`/dashboard/fuel-export?period=${period.start}`}>
              导出加油
            </Link>
            <Link className="button button-dark" href={`/dashboard/payroll/export?period=${period.start}`}>
              导出工资表
            </Link>
          </div>
        }
      />

      <div className="trip-filter">
        <div className="flex items-center gap-2">
          <Link href={navHref(prev)} aria-label="上一周期" className={arrowClass}>‹</Link>
          <PeriodPicker
            selectedStart={period.start}
            selectedLabel={periodLabel(period)}
            todayIso={today}
            totals={periodTotals}
            hrefBase={`/dashboard/trips/${driver.id}`}
          />
          <Link href={navHref(next)} aria-label="下一周期" className={arrowClass}>›</Link>
        </div>
        <div className="filter-actions">
          {period.start !== defaultWeek.start && (
            <Link href={`/dashboard/trips/${driver.id}?period=${defaultWeek.start}`}>回到上周</Link>
          )}
        </div>
      </div>

      <section className="gauge" aria-label="本周期读数">
        <header className="gauge-head">
          <span className="gauge-title">
            <span className={nameTone}>{driver.full_name}</span>{" "}
            <DriverTypeBadge type={driver.driver_type} />
          </span>
          <span className="gauge-range">
            {periodLabel(period)} · 周六 ~ 周五{statement?.trucks ? ` · 车号 ${statement.trucks}` : ""}
          </span>
        </header>
        <div className="gauge-ticks" aria-hidden="true" />
        <div className="gauge-grid">
          <div className="gauge-cell">
            <span className="gauge-label">行程</span>
            <strong className="gauge-value">{legs.length}<em>段</em></strong>
            <span className="gauge-sub">{days.length} 个出勤日</span>
          </div>
          <div className="gauge-cell">
            <span className="gauge-label">总里程</span>
            <strong className="gauge-value">{fmtMiles(totals.miles)}<em>mi</em></strong>
            <span className="gauge-sub">周期累计</span>
          </div>
          <div className="gauge-cell">
            <span className="gauge-label">加油量</span>
            <strong className="gauge-value">
              {fmtFuel(fuelDetail.length > 0 ? String(fuelRollup.gallons) : totals.fuel)}<em>gal</em>
            </strong>
            <span className="gauge-sub">
              {fuelDetail.length > 0 ? "按州汇总 · 随工资单冻结" : "录入时登记的加油量"}
            </span>
          </div>
          <div className="gauge-cell gauge-hot">
            <span className="gauge-label">本期应付</span>
            <strong className="gauge-value">{money(totals.pay + totals.subsidy)}</strong>
            <span className="gauge-sub">
              {totals.subsidy > 0
                ? `工资 ${money(totals.pay)} + 燃油补助 ${money(totals.subsidy)}`
                : "来自行程本趟工资"}
            </span>
          </div>
        </div>
      </section>

      <section aria-label="按日明细" className="mt-4">
        <LedgerPanel
          label={
            <>
              按日明细
              <b>
                {days.length} 天 · {legs.length} 段 · {fmtMiles(totals.miles)} mi · {money(totals.pay)}
                {totals.subsidy > 0 && ` · 补助 ${money(totals.subsidy)}`}
              </b>
            </>
          }
        >
          <PayrollLegsTable
            days={days}
            returnTo={returnTo}
            edit={{ locations, operations: operationOptions, wageRule }}
            frozen={statementFrozen}
            storageKey="payops.payroll.detail.cols"
            changes={snapshot ? { changedFieldsByLeg, addedLegIds } : undefined}
          />
          {legs.length === 0 && (
            <p className="notice mt-3">
              本周期没有行程。可<Link className="linklike" href={`/dashboard?driver=${driver.id}&period=${period.start}`}>前往录入</Link>。
            </p>
          )}
        </LedgerPanel>
      </section>

      <section aria-label="加油按州汇总" className="mt-4">
        <LedgerPanel
          label={
            <>
              加油 · 按州
              <b>{fuelDetail.length > 0 ? `${fuelDetail.length} 州 · ${fmtFuel(fuelRollup.gallons)} gal` : "未录入"}</b>
            </>
          }
        >
          <FuelEditor
            driverId={driver.id}
            periodStart={period.start}
            states={stateOptions}
            rows={fuelEditRows}
            defaultTruckCode={fuelDefaultTruck}
            frozen={statementFrozen}
            markings={snapshot ? { changed: changedFuelStates, added: addedFuelStates } : undefined}
          />
        </LedgerPanel>
      </section>
    </>
  );
}
