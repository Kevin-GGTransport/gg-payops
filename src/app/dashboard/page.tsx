import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel, LedgerEmpty } from "@/components/ledger";
import { DriverTypeBadge, OperationBadge } from "@/components/badges";
import { requireUser } from "@/lib/auth";
import { miles as fmtMiles } from "@/lib/format";
import { currentPeriod, periodLabel } from "@/lib/period";
import { listTrips, periodGauge } from "@/lib/queries/trips";
import { driverTypeCounts } from "@/lib/queries/drivers";

export const metadata: Metadata = { title: "工作台 · G&G PayOps" };

export default async function DashboardPage() {
  await requireUser();

  const period = currentPeriod();
  const [gauge, trips, counts] = await Promise.all([
    periodGauge(period),
    listTrips({ dateFrom: period.start, dateTo: period.end, page: 1, pageSize: 20 }),
    driverTypeCounts()
  ]);
  const weekMiles = Number(gauge.total_miles);

  return (
    <>
      <PageHeader
        title="工作台"
        description="核算周期内的人员与行程总览。工资核算将在下一阶段自动进行。"
      />

      <section className="gauge" aria-label="本周期读数">
        <header className="gauge-head">
          <span className="gauge-title">本周期读数</span>
          <span className="gauge-range">{periodLabel(period)} · 周六 ~ 周五</span>
        </header>
        <div className="gauge-ticks" aria-hidden="true" />
        <div className="gauge-grid">
          <div className="gauge-cell">
            <span className="gauge-label">在册人员</span>
            <strong className="gauge-value">{counts.total}<em>人</em></strong>
            <span className="gauge-sub">司机 {counts.driver} · 车主 {counts.owner}</span>
          </div>
          <div className="gauge-cell">
            <span className="gauge-label">出勤司机</span>
            <strong className="gauge-value">{gauge.active_drivers}<em>人</em></strong>
            <span className="gauge-sub">本周期有行程记录</span>
          </div>
          <div className="gauge-cell">
            <span className="gauge-label">行程</span>
            <strong className="gauge-value">{gauge.legs}<em>段</em></strong>
            <span className="gauge-sub">按操作类型逐段记录</span>
          </div>
          <div className="gauge-cell gauge-hot">
            <span className="gauge-label">里程</span>
            <strong className="gauge-value">{fmtMiles(weekMiles)}<em>mi</em></strong>
            <span className="gauge-sub">周期累计 · 计薪依据</span>
          </div>
        </div>
      </section>

      <section aria-label="本周期行程">
        <LedgerPanel label={<>本周期行程<b>最近 {Math.min(trips.length, 20)} 段</b></>}>
          <table className="roster">
            <thead>
              <tr>
                <th>日期</th><th>司机 / 车主</th><th>操作</th><th>起点 → 终点</th><th className="num">Miles</th>
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 && (
                <LedgerEmpty colSpan={5}>本周期还没有行程。到「行程管理」页开始记录。</LedgerEmpty>
              )}
              {trips.slice(0, 20).map(trip => (
                <tr key={trip.id}>
                  <td className="mono">{trip.trip_date}</td>
                  <td>
                    <span className="strong">{trip.driver_name}</span>
                    <span className="muted-inline">{trip.driver_code}</span>
                    <DriverTypeBadge type={trip.driver_type} />
                  </td>
                  <td><OperationBadge operation={trip.operation} /></td>
                  <td className="mono">
                    {trip.from_code ?? "—"} <span className="route-arrow">→</span> {trip.to_code ?? "—"}
                  </td>
                  <td className="num">{fmtMiles(trip.miles)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LedgerPanel>
      </section>

      <p className="notice">
        下一步：周期结束后按位置基准金额与操作类型自动核算工资。
        前往 <Link href="/dashboard/trips">行程管理</Link>。
      </p>
    </>
  );
}
