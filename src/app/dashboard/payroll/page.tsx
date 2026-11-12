import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel, LedgerEmpty } from "@/components/ledger";
import { DriverTypeBadge } from "@/components/badges";
import { requireUser } from "@/lib/auth";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { todayIso, miles as fmtMiles, money } from "@/lib/format";
import { currentPeriod, periodLabel, periodOf, shiftPeriod, type Period } from "@/lib/period";
import {
  payrollMatrix,
  driverPeriodTrips,
  periodPayTotals,
  type DriverPeriodTripRow,
  type PayrollMatrixRow
} from "@/lib/queries/trips";
import { PeriodPicker } from "./period-picker";
import { PayrollLegsTable } from "./payroll-legs-table";

export const metadata: Metadata = { title: "工资管理 · G&G PayOps" };

const arrowClass =
  "grid h-9.5 w-8 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40";

function periodFromParam(param: string | undefined): Period {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param) && new Date(param).toString() !== "Invalid Date") {
    return periodOf(param);
  }
  return currentPeriod();
}

/** Group one driver's period legs by date; each group carries day subtotals */
function groupByDay(legs: DriverPeriodTripRow[]) {
  const days: Array<{ date: string; legs: DriverPeriodTripRow[]; miles: number; pay: number }> = [];
  for (const leg of legs) {
    const day = days.find(d => d.date === leg.trip_date);
    if (day) {
      day.legs.push(leg);
      day.miles += Number(leg.miles);
      day.pay += Number(leg.pay_amount);
    } else {
      days.push({
        date: leg.trip_date,
        legs: [leg],
        miles: Number(leg.miles),
        pay: Number(leg.pay_amount)
      });
    }
  }
  return days;
}

export default async function PayrollPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  const period = periodFromParam(firstValue(sp.period));
  const thisWeek = currentPeriod();
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const today = todayIso();
  const navHref = (p: Period) => `/dashboard/payroll?period=${p.start}`;

  // Drill-down: start fetching before the matrix so both run in parallel;
  // bigint identities are digits only, other values are dirty params we skip
  const pickedId = firstValue(sp.driver);
  const pickedLegsPromise = pickedId && /^\d+$/.test(pickedId)
    ? driverPeriodTrips(period, pickedId)
    : null;

  const [rows, periodTotals] = await Promise.all([payrollMatrix(period), periodPayTotals()]);
  const totals = rows.reduce(
    (acc, row) => ({
      drivers: acc.drivers + (row.leg_count > 0 ? 1 : 0),
      days: acc.days + row.trip_days,
      del: acc.del + row.del_count,
      live: acc.live + row.live_count,
      empty: acc.empty + row.empty_count,
      bobtail: acc.bobtail + row.bobtail_count,
      legs: acc.legs + row.leg_count,
      miles: acc.miles + Number(row.total_miles),
      pay: acc.pay + Number(row.total_pay)
    }),
    { drivers: 0, days: 0, del: 0, live: 0, empty: 0, bobtail: 0, legs: 0, miles: 0, pay: 0 }
  );

  // Only honor a driver that exists in this period's matrix; otherwise drop the prefetched legs
  const picked: PayrollMatrixRow | undefined = pickedId
    ? rows.find(r => r.driver_id === pickedId)
    : undefined;
  const pickedLegs = picked && pickedLegsPromise ? await pickedLegsPromise : [];
  const pickedDays = groupByDay(pickedLegs);
  const pickedHref = (d: string | undefined) =>
    `/dashboard/payroll?period=${period.start}${d ? `&driver=${d}` : ""}`;

  return (
    <>
      <PageHeader
        title="工资管理"
        description="按核算周期（周六 ~ 周五）汇总每位司机 / 车主的行程与工资，点姓名查看每日明细。"
        actions={
          <Link className="button button-dark" href={`/dashboard/payroll/export?period=${period.start}`}>
            导出工资表
          </Link>
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
          />
          <Link href={navHref(next)} aria-label="下一周期" className={arrowClass}>›</Link>
        </div>
        <div className="filter-actions">
          {period.start !== thisWeek.start && <Link href="/dashboard/payroll">回到本周</Link>}
        </div>
      </div>

      <section className="gauge" aria-label="本周期读数">
        <header className="gauge-head">
          <span className="gauge-title">本周期读数</span>
          <span className="gauge-range">{periodLabel(period)} · 周六 ~ 周五</span>
        </header>
        <div className="gauge-ticks" aria-hidden="true" />
        <div className="gauge-grid">
          <div className="gauge-cell">
            <span className="gauge-label">出勤人数</span>
            <strong className="gauge-value">{totals.drivers}<em>人</em></strong>
            <span className="gauge-sub">本周期有行程记录</span>
          </div>
          <div className="gauge-cell">
            <span className="gauge-label">行程</span>
            <strong className="gauge-value">{totals.legs}<em>段</em></strong>
            <span className="gauge-sub">{totals.days} 个出勤日</span>
          </div>
          <div className="gauge-cell">
            <span className="gauge-label">总里程</span>
            <strong className="gauge-value">{fmtMiles(totals.miles)}<em>mi</em></strong>
            <span className="gauge-sub">周期累计</span>
          </div>
          <div className="gauge-cell gauge-hot">
            <span className="gauge-label">工资总额</span>
            <strong className="gauge-value">{money(totals.pay)}</strong>
            <span className="gauge-sub">本期应付 · 来自行程本趟工资</span>
          </div>
        </div>
      </section>

      <section aria-label="周期汇总">
        <LedgerPanel label={<>核算矩阵<b>{totals.drivers} 人出勤</b></>}>
          <table className="roster matrix">
            <thead>
              <tr>
                <th>司机 / 车主</th><th>类型</th>
                <th className="num">天数</th>
                <th className="num">DEL</th><th className="num">LIVE</th>
                <th className="num">EMPTY</th><th className="num">BOBTAIL</th>
                <th className="num">总段数</th><th className="num">总里程</th>
                <th className="num">本期工资</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <LedgerEmpty colSpan={10}>还没有在职司机。</LedgerEmpty>}
              {rows.map(row => (
                <tr
                  key={row.driver_id}
                  className={`${row.leg_count === 0 ? "row-off" : ""} ${picked?.driver_id === row.driver_id ? "row-pick" : ""}`}
                >
                  <td>
                    <Link className="cell-link" href={pickedHref(row.driver_id)}>
                      {row.full_name}
                    </Link>
                    <span className="muted-inline">{row.driver_code}</span>
                  </td>
                  <td><DriverTypeBadge type={row.driver_type} /></td>
                  <td className="num">{row.trip_days}</td>
                  <td className="num">{row.del_count || "—"}</td>
                  <td className="num">{row.live_count || "—"}</td>
                  <td className="num">{row.empty_count || "—"}</td>
                  <td className="num">{row.bobtail_count || "—"}</td>
                  <td className="num">{row.leg_count}</td>
                  <td className="num">{fmtMiles(row.total_miles)}</td>
                  <td className="num">{money(row.total_pay)}</td>
                </tr>
              ))}
              <tr className="matrix-total">
                <td colSpan={2}>合计 · {totals.drivers} 人出勤</td>
                <td className="num">{totals.days}</td>
                <td className="num">{totals.del}</td>
                <td className="num">{totals.live}</td>
                <td className="num">{totals.empty}</td>
                <td className="num">{totals.bobtail}</td>
                <td className="num">{totals.legs}</td>
                <td className="num">{fmtMiles(totals.miles)}</td>
                <td className="num">{money(totals.pay)}</td>
              </tr>
            </tbody>
          </table>
        </LedgerPanel>
      </section>

      {picked && (
        <section aria-label="每日明细" className="mt-4">
          <LedgerPanel
            label={
              <>
                <span className="flex items-center gap-3">
                  {picked.full_name} · 本周明细
                  <b>
                    {pickedDays.length} 天 · {picked.leg_count} 段 · {money(picked.total_pay)}
                  </b>
                </span>
                <Link className="panel-x" href={pickedHref(undefined)} aria-label="关闭明细">×</Link>
              </>
            }
          >
            <PayrollLegsTable
              days={pickedDays}
              totalMiles={picked.total_miles}
              totalPay={picked.total_pay}
            />
          </LedgerPanel>
        </section>
      )}

      <p className="notice">
        工资金额来自行程录入时的「本趟工资」（可手动修改），修改行程后此处自动更新。
        奖励项（RENO 补助、出勤 Bonus 等）后续接入。行程在 <Link href="/dashboard/trips">行程管理</Link> 维护。
      </p>
    </>
  );
}
