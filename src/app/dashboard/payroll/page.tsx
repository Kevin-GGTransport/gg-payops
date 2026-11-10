import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel, LedgerEmpty } from "@/components/ledger";
import { DriverTypeBadge } from "@/components/badges";
import { PeriodRuler } from "@/components/period-ruler";
import { requireUser } from "@/lib/auth";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { dateIso, miles as fmtMiles } from "@/lib/format";
import { currentPeriod, periodOf, shiftPeriod, type Period } from "@/lib/period";
import { payrollMatrix } from "@/lib/queries/trips";

export const metadata: Metadata = { title: "工资管理 · G&G PayOps" };

function periodFromParam(param: string | undefined): Period {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param) && new Date(param).toString() !== "Invalid Date") {
    return periodOf(param);
  }
  return currentPeriod();
}

export default async function PayrollPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  const period = periodFromParam(firstValue(sp.period));
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const today = dateIso(new Date());
  const navHref = (p: Period) => `/dashboard/payroll?period=${p.start}`;

  const rows = await payrollMatrix(period);
  const totals = rows.reduce(
    (acc, row) => ({
      drivers: acc.drivers + (row.leg_count > 0 ? 1 : 0),
      days: acc.days + row.trip_days,
      del: acc.del + row.del_count,
      live: acc.live + row.live_count,
      empty: acc.empty + row.empty_count,
      bobtail: acc.bobtail + row.bobtail_count,
      legs: acc.legs + row.leg_count,
      miles: acc.miles + Number(row.total_miles)
    }),
    { drivers: 0, days: 0, del: 0, live: 0, empty: 0, bobtail: 0, legs: 0, miles: 0 }
  );

  return (
    <>
      <PageHeader
        title="工资管理"
        description="按核算周期汇总每位司机 / 车主的行程。金额核算规则下一阶段接入，自动从此处带出。"
      />

      <PeriodRuler period={period} prevHref={navHref(prev)} nextHref={navHref(next)} todayIso={today} />

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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <LedgerEmpty colSpan={9}>还没有在职司机。</LedgerEmpty>}
              {rows.map(row => (
                <tr key={row.driver_id} className={row.leg_count === 0 ? "row-off" : ""}>
                  <td className="strong">{row.full_name}<span className="muted-inline">{row.driver_code}</span></td>
                  <td><DriverTypeBadge type={row.driver_type} /></td>
                  <td className="num">{row.trip_days}</td>
                  <td className="num">{row.del_count || "—"}</td>
                  <td className="num">{row.live_count || "—"}</td>
                  <td className="num">{row.empty_count || "—"}</td>
                  <td className="num">{row.bobtail_count || "—"}</td>
                  <td className="num">{row.leg_count}</td>
                  <td className="num">{fmtMiles(row.total_miles)}</td>
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
              </tr>
            </tbody>
          </table>
        </LedgerPanel>
      </section>

      <p className="notice">
        下一阶段：按位置基准金额与操作类型自动计算应付工资（DEL / LIVE 计费、EMPTY / BOBTAIL 规则）。
        行程数据在 <Link href="/dashboard/trips">行程管理</Link> 维护。
      </p>
    </>
  );
}
