import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/flash-toast";
import { FormError } from "@/components/form-fields";
import { LedgerPanel } from "@/components/ledger";
import { SubmitButton } from "@/components/submit-button";
import { StatusActionButton } from "@/components/status-action-button";
import { DriverTypeBadge, StatementStatusBadge } from "@/components/badges";
import { PeriodPicker } from "@/components/period-picker";
import { requirePermission, getLinkedDriverId, getUserPermissions } from "@/lib/permissions";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { fuel as fmtFuel, miles as fmtMiles, money, shortPeriod, todayIso } from "@/lib/format";
import { defaultPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import { getDriverById } from "@/lib/queries/drivers";
import { activeOperationOptions } from "@/lib/queries/operations";
import { activeLocationOptions } from "@/lib/queries/locations";
import { currentWageRule } from "@/lib/queries/wage-rules";
import {
  driverPeriodTrips,
  periodPayTotals,
  unsettledTripsForDriver,
  type DriverPeriodTripRow
} from "@/lib/queries/trips";
import { getStatementByDriverPeriod, parseVerifySnapshot } from "@/lib/queries/statements";
import { activeStateOptions, parseFuelDetail } from "@/lib/queries/fuel";
import { feesTotal, parseCustomFees } from "@/lib/queries/fees";
import { FuelEditor, type FuelEditRow } from "./fuel-editor";
import { FeeEditor, type FeeEditRow } from "./fee-editor";
import { StatementSheetForm } from "./statement-sheet";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { activeTruckOptions } from "@/lib/queries/trucks";
import { confirmDriverStatement, reopenStatement, verifyStatement } from "../../payroll/actions";
import { CopyStatementButton } from "../../payroll/copy-statement-dialog";
import { ChangeTruckButton } from "../../payroll/change-truck-dialog";
import { PayrollLegsTable } from "../payroll-legs-table";
import { settleTripsIntoPeriod } from "../actions";
import { ReadOnlyStatement } from "./read-only-statement";

export const metadata: Metadata = { title: "周期工资单 · G&G PayOps" };

/** Fuel-editor error copy (the action redirects back with these codes) */
const FUEL_ERRORS: Record<string, string> = {
  fuel_missing_state: "该行加油未选择州。",
  fuel_bad_state: "该行加油的州不在字典中，请重新选择。"
};

/** Fee-editor error copy (the action redirects back with these codes) */
const FEE_ERRORS: Record<string, string> = {
  fee_missing_label: "该行费用未填写名称。"
};

/** Leg/claim error copy (the actions redirect back with these codes) */
const LEG_ERRORS: Record<string, string> = {
  leg_locked: "该行程属司机已确认的工资单（只读），请先「退回编辑」后再修改。",
  fuel_locked: "加油明细属已确认的工资单（只读），请先「退回编辑」后再修改。",
  claim_frozen: "本周期工资单已冻结，无法计入未结行程。",
  claim_none: "所选行程已不是未结状态，请刷新后重试。"
};

const arrowClass =
  "grid h-11 w-11 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40 md:h-9.5 md:w-8";

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
  await requirePermission("trip.read");
  const [{ driverId }, sp] = await Promise.all([params, searchParams]);
  if (!/^\d+$/.test(driverId)) notFound();

  // Driver record, scope and permissions are independent - fetch together
  // (they used to serialize three awaits before the page's data load)
  const [driver, scopedDriverId, permissions] = await Promise.all([
    getDriverById(driverId),
    getLinkedDriverId(),
    getUserPermissions()
  ]);
  if (!driver) notFound();

  // Driver-linked accounts bounce off other drivers' sheets (gently, back to
  // their own payroll list); they read a static sheet and may only confirm
  if (scopedDriverId !== null && scopedDriverId !== driverId) {
    redirect("/dashboard/payroll");
  }
  const canWrite = permissions.has("trip.write");
  const canVerify = permissions.has("payroll.write");
  const canConfirm = permissions.has("payroll.confirm");
  const readOnly = !canWrite || scopedDriverId !== null;
  // Trip edits saved (inline batch or dialog) redirect back here
  const saved = firstValue(sp.saved) === "1";
  // Same landing default as the payroll list: the week that just closed
  const periodParam = dateParam(firstValue(sp.period));
  const period = periodParam ? periodOf(periodParam) : defaultPeriod();
  const defaultWeek = defaultPeriod();
  const today = todayIso();
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);

  const [legs, periodTotals, statement, stateOptions, locations, wageRule, operationOptions, driverOptions, truckOptions, unsettled] =
    await Promise.all([
      driverPeriodTrips(period, driver.id),
      periodPayTotals(),
      getStatementByDriverPeriod(driver.id, period.start),
      // Fuel-editor state dictionary
      activeStateOptions(),
      // Edit-dialog dictionaries (in-page client dialog, always mounted)
      activeLocationOptions(),
      currentWageRule(),
      activeOperationOptions(),
      // Copy-dialog pickers (copy this draft statement onto another driver)
      activeDriverOptions(),
      activeTruckOptions(),
      // Claim panel feed (unsettled legs of older frozen periods)
      !readOnly ? unsettledTripsForDriver(driver.id) : Promise.resolve([])
    ]);
  // Fuel-by-state (frozen once verified) and custom fees (stay editable after
  // verify, no red marks) parse straight off the statement row - the detail
  // SELECT carries both payloads (two point queries on the same row dropped)
  const fuelDetail = statement ? parseFuelDetail(statement.fuel_detail) : [];
  const feeDetail = statement ? parseCustomFees(statement.custom_fees) : [];
  // Deferred (claimed unsettled) legs pay in this period but keep real dates
  // outside it: they never join day groups (no chaining, no intra-day freeze,
  // no attendance day) - the sheet renders them as a trailing read-only group.
  // Totals below still count every leg: the period's pay must include them.
  const deferredLegs = legs.filter(l => l.settle_date !== null);
  const days = groupByDay(legs.filter(l => l.settle_date === null));
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
  // The unified save's backstop errors (client-side pre-validation normally
  // catches these before a round-trip happens)
  const errorCode = firstValue(sp.error);
  const fuelRowNo = Number.parseInt(firstValue(sp.fuel) ?? "", 10);
  const fuelError =
    errorCode && errorCode in FUEL_ERRORS
      ? `${Number.isFinite(fuelRowNo) && fuelRowNo >= 1 ? `第 ${fuelRowNo} 行：` : ""}${FUEL_ERRORS[errorCode]}`
      : undefined;
  // Leg/claim refusals (read-only archive, frozen claim target, stale panel)
  const legError = errorCode && errorCode in LEG_ERRORS ? LEG_ERRORS[errorCode] : undefined;
  // Claim success flash (count comes from the action's redirect)
  const claimedCount = firstValue(sp.claimed);

  // Fee editor feed: a failed save's URL refill wins over the stored rows
  const feeRefillCount = Number.parseInt(firstValue(sp.f_fee_row_count) ?? "", 10);
  const feeRefillRows: FeeEditRow[] =
    Number.isFinite(feeRefillCount) && feeRefillCount >= 1
      ? Array.from({ length: feeRefillCount }, (_, i) => ({
          label: firstValue(sp[`f_fee_row_${i}_label`]) ?? "",
          amount: firstValue(sp[`f_fee_row_${i}_amount`]) ?? "",
          miles: firstValue(sp[`f_fee_row_${i}_miles`]) ?? "",
          note: firstValue(sp[`f_fee_row_${i}_note`]) ?? ""
        }))
      : [];
  const feeEditRows: FeeEditRow[] =
    feeRefillRows.length > 0
      ? feeRefillRows
      : feeDetail.map(r => ({
          label: r.label,
          // 0 reads as the empty placeholder, not a typed "0" the clerk
          // would have to clear before entering a real number
          amount: r.amount > 0 ? String(r.amount) : "",
          miles: r.miles > 0 ? String(r.miles) : "",
          note: r.note
        }));
  const feeRowNo = Number.parseInt(firstValue(sp.fee) ?? "", 10);
  const feeError =
    errorCode && errorCode in FEE_ERRORS
      ? `${Number.isFinite(feeRowNo) && feeRowNo >= 1 ? `第 ${feeRowNo} 行：` : ""}${FEE_ERRORS[errorCode]}`
      : undefined;
  // Sum of the stored fees (the refill holds the about-to-be truth only on a
  // failed save, so the gauge always reads the stored set)
  const feeTotal = feesTotal(feeDetail);

  // Full-path return so verify / per-row delete stays on this sheet
  const returnTo = `/dashboard/trips/${driver.id}?period=${period.start}`;
  const navHref = (p: { start: string }) => `/dashboard/trips/${driver.id}?period=${p.start}`;

  // 核对 (VERIFIED) keeps tracking the live ledger; only the driver-confirmed
  // DONE sheet is archived - its numbers freeze on the confirmation-time
  // snapshot. The permanent edited_after_verify flag (not a live comparison)
  // drives the detail-only red
  const archived = statement !== null && statement.status === "DONE";

  // Post-confirmation change localization: diff the live legs against the
  // frozen snapshot so the sheet can mark exactly WHICH cells moved. Legacy
  // rows (null snapshot) keep the statement-level red only.
  const numEq = (a: string | null, b: string | null) => Number(a ?? 0) === Number(b ?? 0);
  const textEq = (a: string | null, b: string | null) => (a ?? "") === (b ?? "");
  const snapshot = archived && statement ? parseVerifySnapshot(statement.verify_snapshot) : null;
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
  // The permanent audit flag keeps firing for resolved diversions (a claimed
  // leg left, a sanctioned fee edit landed); with a snapshot the localized
  // diff decides visibility - legacy no-snapshot rows keep the flag-only form
  const flagVisible = snapshot
    ? changeSummary !== "" && statement !== null && statement.edited_after_verify
    : statement !== null && statement.edited_after_verify;
  // Muted name tone for the whole page: dark green once verified, dark red
  // once driver-confirmed (archived) or edited after confirmation - dim
  // shades only
  const nameTone = statement
    ? statement.edited_after_verify || statement.status === "DONE"
      ? "text-red-800"
      : statement.status === "VERIFIED"
        ? "text-emerald-800"
        : undefined
    : undefined;

  return (
    <>
      {saved && <FlashToast message="修改已保存" param="saved" />}
      {claimedCount && <FlashToast message={`已计入 ${claimedCount} 段行程`} param="claimed" />}
      {fuelError && <FormError message={fuelError} />}
      {feeError && <FormError message={feeError} />}
      {legError && <FormError message={legError} />}
      <PageHeader
        title={
          <>
            <span className={nameTone}>{driver.full_name}</span> · 周期工资单
          </>
        }
        description={
          statement ? (
            flagVisible ? (
              <>
                <StatementStatusBadge status={statement.status} edited />
                <span className="text-red-700">
                  {" "}司机确认后行程有改动{changeSummary && `（${changeSummary}）`}：留档金额 {money(statement.total_pay)} 已冻结（改动不自动计入）{snapshot ? "，改动处已标红" : ""}，请人工复核。
                </span>
              </>
            ) : (
              <>
                工资单 <StatementStatusBadge status={statement.status} />
                {statement.status === "DONE"
                  ? " 司机已确认（留档），行程只读；修改须「退回编辑」后重新确认。"
                  : statement.status === "VERIFIED"
                    ? " 已核对（数字仍实时跟随行程）；可标记司机确认，确认后冻结留档。"
                    : " 草稿中，数字实时跟随行程。"}
              </>
            )
          ) : (
            <>本周期行程与工资台账，按日分组核对（无行程，无工资单）。</>
          )
        }
        actions={
          /* One visual system: every secondary action is quiet, exactly one
              dark primary (the status driver) closes the row */
          <div className="flex flex-wrap items-center gap-2">
            <Link className="button button-quiet" href={`/dashboard/payroll?period=${period.start}`}>
              返回工资单
            </Link>
            {canVerify && !readOnly && statement && legs.length > 0 && (
              <ChangeTruckButton
                statement={statement}
                trucks={truckOptions}
                returnTo={returnTo}
                triggerClassName="button button-quiet"
              />
            )}
            {canVerify && !readOnly && statement && statement.status === "DRAFT" && legs.length > 0 && (
              <CopyStatementButton
                statement={statement}
                drivers={driverOptions}
                trucks={truckOptions}
                triggerClassName="button button-quiet"
              />
            )}
            {!readOnly && (
              <Link className="button button-quiet" href={`/dashboard/fuel-export?period=${period.start}`}>
                导出加油
              </Link>
            )}
            <Link className="button button-quiet" href={`/dashboard/payroll/export?period=${period.start}`}>
              导出工资表
            </Link>
            {canVerify && statement && statement.status === "DRAFT" && legs.length > 0 && (
              <form action={verifyStatement}>
                <input type="hidden" name="id" value={statement.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <SubmitButton className="button button-dark" pendingLabel="核对中…">
                  标记核对
                </SubmitButton>
              </form>
            )}
            {canConfirm && statement && statement.status === "VERIFIED" && legs.length > 0 && (
              <form action={confirmDriverStatement}>
                <input type="hidden" name="id" value={statement.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <SubmitButton className="button button-dark" pendingLabel="确认中…">
                  司机确认
                </SubmitButton>
              </form>
            )}
            {canConfirm && !readOnly && statement && statement.status === "DONE" && (
              /* The only door back from the frozen archive: reopen to edit,
                 fix, then confirm again to re-lock a fresh snapshot */
              <StatusActionButton
                statementId={statement.id}
                action={reopenStatement}
                triggerClass="button button-quiet"
                labels={{
                  title: "退回编辑？",
                  description:
                    "该工资单已司机确认。退回后行程恢复可编辑、数字实时跟随，修改后需重新点「司机确认」更新并锁定快照（原留档快照将被覆盖，不留历史）。",
                  confirmLabel: "退回编辑",
                  pendingLabel: "退回中…",
                  trigger: "退回编辑",
                  successToast: "已退回编辑",
                  failureToast: "退回失败，请重试"
                }}
              />
            )}
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
            <strong className="gauge-value">{money(totals.pay + totals.subsidy + feeTotal)}</strong>
            <span className="gauge-sub">
              {totals.subsidy > 0 || feeTotal > 0
                ? `工资 ${money(totals.pay)}${totals.subsidy > 0 ? ` + 补助 ${money(totals.subsidy)}` : ""}${
                    feeTotal > 0 ? ` + 费用 ${money(feeTotal)}` : ""
                  }`
                : "来自行程本趟工资"}
            </span>
          </div>
        </div>
      </section>

      {!archived && !readOnly && unsettled.length > 0 && (
        /* Legs entered after their own period was driver-confirmed: their
           wage counts nowhere. Checking rows moves the money into THIS
           period (settle_date) while the real business dates stay. */
        <section aria-label="未结行程" className="mt-4">
          <LedgerPanel
            label={
              <>
                未结行程
                <b>{unsettled.length} 段 · 工资未计入任何工资单</b>
              </>
            }
          >
            <form action={settleTripsIntoPeriod}>
              <input type="hidden" name="driver_id" value={driver.id} />
              <input type="hidden" name="period" value={period.start} />
              <input type="hidden" name="return_to" value={returnTo} />
              <table className="roster">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>操作</th>
                    <th>Load #</th>
                    <th>起点 → 终点</th>
                    <th className="num">里程 (mi)</th>
                    <th className="num">工资</th>
                    <th>原属周期</th>
                    <th>计入</th>
                  </tr>
                </thead>
                <tbody>
                  {unsettled.map(u => (
                    <tr key={u.id}>
                      <td className="mono">{u.trip_date}</td>
                      <td className="mono">{u.operation}</td>
                      <td className="mono">{u.load_no || "—"}</td>
                      <td className="mono">
                        {u.from_code ?? "?"} <span className="text-muted-foreground">→</span> {u.to_code ?? "?"}
                      </td>
                      <td className="mono num">{fmtMiles(u.miles)}</td>
                      <td className="mono num">{money(u.pay_amount)}</td>
                      <td className="mono">
                        {shortPeriod(u.frozen_period_start, u.frozen_period_end)}（已冻结）
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          name="claim"
                          value={u.id}
                          defaultChecked
                          aria-label={`计入行程 ${u.trip_date} ${u.operation}`}
                          className="size-4"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="m-0 text-xs text-muted-foreground">
                  勾选的行程工资将计入 {periodLabel(period)}，业务日期保持不变。
                </p>
                <SubmitButton className="button button-dark" pendingLabel="计入中…">
                  计入本周期结算
                </SubmitButton>
              </div>
            </form>
          </LedgerPanel>
        </section>
      )}

      {readOnly ? (
        /* Driver-linked / write-less accounts: static sheet, confirm stays in
           the header - no editors, no save bar, nothing to corrupt */
        <ReadOnlyStatement
          days={days}
          deferred={deferredLegs}
          fuelDetail={fuelDetail}
          feeDetail={feeDetail}
          feeTotal={feeTotal}
        />
      ) : (
        /* One form wraps the three editable sections: legs, fuel, fees share a
           single save (the save bar derives its hint off what each section
           reports through the sheet context) */
        <StatementSheetForm
          driverId={driver.id}
          periodStart={period.start}
          returnTo={returnTo}
          frozen={archived}
          states={stateOptions}
        >
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
                deferred={deferredLegs}
                deferredLocked={archived}
                returnTo={returnTo}
                edit={{ locations, operations: operationOptions, wageRule }}
                newLegCtx={{
                  driverId: driver.id,
                  driverType: driver.driver_type,
                  priceAsDriver: driver.price_as_driver,
                  // Fresh rows open on today when it falls inside the viewed
                  // period, else the period's Saturday
                  defaultDate:
                    today >= period.start && today <= period.end ? today : period.start
                }}
                storageKey="payops.payroll.detail.cols"
                changes={snapshot ? { changedFieldsByLeg, addedLegIds } : undefined}
              />
              {legs.length === 0 && (
                <p className="notice mt-3">
                  本周期没有行程。可<Link className="linklike" href={`/dashboard?driver=${driver.id}&period=${period.start}`}>前往录入</Link>，或点下方「添加行程」直接补录。
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
                states={stateOptions}
                rows={fuelEditRows}
                defaultTruckCode={fuelDefaultTruck}
                markings={snapshot ? { changed: changedFuelStates, added: addedFuelStates } : undefined}
              />
            </LedgerPanel>
          </section>

          <section aria-label="自定义费用" className="mt-4">
            <LedgerPanel
              label={
                <>
                  自定义费用
                  <b>
                    {feeDetail.length > 0
                      ? `${feeDetail.length} 笔 · ${money(feeTotal)}`
                      : "未录入"}
                  </b>
                </>
              }
            >
              <FeeEditor rows={feeEditRows} />
            </LedgerPanel>
          </section>
        </StatementSheetForm>
      )}
    </>
  );
}
