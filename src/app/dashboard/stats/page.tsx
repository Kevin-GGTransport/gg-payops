import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { PeriodPicker } from "@/components/period-picker";
import { requirePermission } from "@/lib/permissions";
import { miles as fmtMiles, money, todayIso } from "@/lib/format";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { defaultPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import { statementPeriodTotals } from "@/lib/queries/statements";
import { periodLoadAllocations, stateMileageByPeriod } from "@/lib/queries/stats";

export const metadata: Metadata = { title: "数据统计 · G&G PayOps" };

const arrowClass =
  "grid h-9.5 w-8 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40";

/** "2026-11-07" -> "11/7" like the reference sheet's trip labels */
function mdOf(iso: string) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

/**
 * Fleet-wide period statistics: 01 各州里程 (per-state miles off the fuel
 * section's by-state rows) and 02 按趟分摊至 Load # (every trip of the
 * period, each carrying 100% of its mileage/pay on its single Load#).
 * Pure read-only rollup - numbers live in the statements/trips they derive
 * from, so DRAFT edits reflect here immediately.
 */
export default async function StatsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("report.read");
  const sp = await searchParams;

  const periodParam = (firstValue(sp.period) ?? "").trim();
  const period =
    /^\d{4}-\d{2}-\d{2}$/.test(periodParam) && new Date(periodParam).toString() !== "Invalid Date"
      ? periodOf(periodParam)
      : defaultPeriod();
  const defaultWeek = defaultPeriod();
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);

  const [stateMiles, loads, pickerTotals] = await Promise.all([
    stateMileageByPeriod(period),
    periodLoadAllocations(period),
    statementPeriodTotals()
  ]);
  const stateMilesTotal = stateMiles.reduce((acc, r) => acc + Number(r.miles), 0);
  const loadsMilesTotal = loads.reduce((acc, r) => acc + Number(r.miles), 0);
  const loadsPayTotal = loads.reduce((acc, r) => acc + Number(r.payAmount), 0);

  return (
    <>
      <PageHeader
        title="数据统计"
        description="按周期汇总全队：01 各州里程（来自加油·按州区登记的里程）与 02 按趟分摊至 Load #（每趟 100% 计入其货单）。"
      />

      <div className="trip-filter">
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/stats?period=${prev.start}`} aria-label="上一周期" className={arrowClass}>‹</Link>
          <PeriodPicker
            selectedStart={period.start}
            selectedLabel={periodLabel(period)}
            todayIso={todayIso()}
            totals={pickerTotals}
            hrefBase="/dashboard/stats"
          />
          <Link href={`/dashboard/stats?period=${next.start}`} aria-label="下一周期" className={arrowClass}>›</Link>
        </div>
        <div className="filter-actions">
          {period.start !== defaultWeek.start && (
            <Link href={`/dashboard/stats?period=${defaultWeek.start}`}>回到上周</Link>
          )}
          <Link href={`/dashboard/payroll?period=${period.start}`}>查看工资单</Link>
        </div>
      </div>

      {/* Left/right on wide screens like the reference sheet, stacked below xl */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label="各州里程">
          <LedgerPanel
            label={
              <>
                01 · 各州里程
                <b>
                  {stateMiles.length > 0
                    ? `${stateMiles.length} 州 · 合计 ${fmtMiles(stateMilesTotal.toString())} mi`
                    : "未登记"}
                </b>
              </>
            }
          >
            <table className="roster">
              <thead>
                <tr>
                  <th>州</th>
                  <th className="num">实际 Miles</th>
                </tr>
              </thead>
              <tbody>
                {stateMiles.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="empty">
                      本周期没有按州加油数据（里程在录入页的「加油 · 按州」区登记）。
                    </td>
                  </tr>
                ) : (
                  <>
                    {stateMiles.map(row => (
                      <tr key={row.state}>
                        <td className="mono">{row.state}</td>
                        <td className="mono num">{fmtMiles(row.miles)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>州里程合计</strong>
                      </td>
                      <td className="mono num strong">
                        <strong>{fmtMiles(stateMilesTotal.toString())}</strong>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </LedgerPanel>
        </section>

        <section aria-label="按趟分摊至 Load #">
          <LedgerPanel
            label={
              <>
                02 · 按趟分摊至 Load #
                <b>
                  {loads.length > 0
                    ? `${loads.length} 趟 · ${fmtMiles(loadsMilesTotal.toString())} mi · ${money(loadsPayTotal.toString())}`
                    : "本周期无行程"}
                </b>
              </>
            }
          >
            <table className="roster">
              <thead>
                <tr>
                  <th>司机</th>
                  <th>行程</th>
                  <th>Load #</th>
                  <th className="num">里程占比</th>
                  <th className="num">分摊 Miles</th>
                  <th className="num">分摊工资</th>
                </tr>
              </thead>
              <tbody>
                {loads.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      本周期没有行程。
                    </td>
                  </tr>
                ) : (
                  <>
                    {loads.map(row => (
                      <tr key={`${row.driverId}-${row.tripDate}-${row.tripNo}`}>
                        <td>{row.driverName}</td>
                        <td className="mono">{mdOf(row.tripDate)} · 第{row.tripNo}趟</td>
                        <td className="mono">{row.loadNo || "—"}</td>
                        <td className="mono num">100.0%</td>
                        <td className="mono num">{fmtMiles(row.miles)}</td>
                        <td className="mono num">{money(row.payAmount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4}>
                        <strong>货单合计</strong>
                      </td>
                      <td className="mono num strong">
                        <strong>{fmtMiles(loadsMilesTotal.toString())}</strong>
                      </td>
                      <td className="mono num strong">
                        <strong>{money(loadsPayTotal.toString())}</strong>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </LedgerPanel>
        </section>
      </div>
    </>
  );
}
