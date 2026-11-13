import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { DriverTypeBadge } from "@/components/badges";
import { PeriodPicker } from "@/components/period-picker";
import { requireUser } from "@/lib/auth";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { fuel as fmtFuel, miles as fmtMiles, money, todayIso } from "@/lib/format";
import { currentPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import { getDriverById } from "@/lib/queries/drivers";
import {
  driverPeriodTrips,
  periodPayTotals,
  type DriverPeriodTripRow
} from "@/lib/queries/trips";
import { PayrollLegsTable } from "../payroll-legs-table";

export const metadata: Metadata = { title: "周期工资单 · G&G PayOps" };

const arrowClass =
  "grid h-9.5 w-8 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40";

function dateParam(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toString() !== "Invalid Date" ? v : undefined;
}

/** Group one driver's period legs by date; each group carries day subtotals */
function groupByDay(legs: DriverPeriodTripRow[]) {
  const days: Array<{ date: string; legs: DriverPeriodTripRow[]; miles: number; fuel: number; pay: number }> = [];
  for (const leg of legs) {
    const day = days.find(d => d.date === leg.trip_date);
    if (day) {
      day.legs.push(leg);
      day.miles += Number(leg.miles);
      day.fuel += Number(leg.fuel_gallons);
      day.pay += Number(leg.pay_amount);
    } else {
      days.push({
        date: leg.trip_date,
        legs: [leg],
        miles: Number(leg.miles),
        fuel: Number(leg.fuel_gallons),
        pay: Number(leg.pay_amount)
      });
    }
  }
  return days;
}

/**
 * One driver's settlement sheet for one period (Sat ~ Fri): identity masthead,
 * the driver's own gauge strip (legs / miles / fuel / pay), then the day-ledger
 * drill-down with delete. Reached from the payroll matrix (name / pay cell).
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
  const period = dateParam(firstValue(sp.period)) ? periodOf(dateParam(firstValue(sp.period))!) : currentPeriod();
  const thisWeek = currentPeriod();
  const today = todayIso();
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);

  const [legs, periodTotals] = await Promise.all([
    driverPeriodTrips(period, driver.id),
    periodPayTotals()
  ]);
  const days = groupByDay(legs);
  const totals = legs.reduce(
    (acc, leg) => ({
      miles: acc.miles + Number(leg.miles),
      fuel: acc.fuel + Number(leg.fuel_gallons),
      pay: acc.pay + Number(leg.pay_amount)
    }),
    { miles: 0, fuel: 0, pay: 0 }
  );

  // Full-path return so a per-row delete stays on this sheet
  const returnTo = `/dashboard/trips/${driver.id}?period=${period.start}`;
  const navHref = (p: { start: string }) => `/dashboard/trips/${driver.id}?period=${p.start}`;

  return (
    <>
      <PageHeader
        title={`${driver.full_name} · 周期工资单`}
        description={
          <>
            车号 <span className="font-mono">{driver.driver_code}</span> 的本周期行程与工资台账，
            按日分组核对。
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Link className="button button-quiet" href="/dashboard/trips?view=period">
              返回核算矩阵
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
          {period.start !== thisWeek.start && <Link href={`/dashboard/trips/${driver.id}`}>回到本周</Link>}
        </div>
      </div>

      <section className="gauge" aria-label="本周期读数">
        <header className="gauge-head">
          <span className="gauge-title">
            {driver.full_name} <DriverTypeBadge type={driver.driver_type} />
          </span>
          <span className="gauge-range">{periodLabel(period)} · 周六 ~ 周五</span>
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
            <strong className="gauge-value">{fmtFuel(totals.fuel)}<em>gal</em></strong>
            <span className="gauge-sub">录入时登记的加油量</span>
          </div>
          <div className="gauge-cell gauge-hot">
            <span className="gauge-label">本期应付</span>
            <strong className="gauge-value">{money(totals.pay)}</strong>
            <span className="gauge-sub">来自行程本趟工资</span>
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
              </b>
            </>
          }
        >
          <PayrollLegsTable
            days={days}
            totalMiles={String(totals.miles)}
            totalFuel={String(totals.fuel)}
            totalPay={String(totals.pay)}
            returnTo={returnTo}
            storageKey="payops.payroll.detail.cols"
          />
          {legs.length === 0 && (
            <p className="notice mt-3">
              本周期没有行程。可<Link className="linklike" href={`/dashboard?driver=${driver.id}&period=${period.start}`}>前往录入</Link>。
            </p>
          )}
        </LedgerPanel>
      </section>
    </>
  );
}
