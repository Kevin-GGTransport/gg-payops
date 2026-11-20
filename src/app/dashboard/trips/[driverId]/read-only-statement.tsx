import { Fragment } from "react";
import { LedgerPanel } from "@/components/ledger";
import { fuel as fmtFuel, miles as fmtMiles, money } from "@/lib/format";
import type { DriverPeriodTripRow } from "@/lib/queries/trips";
import type { FuelDetailRow } from "@/lib/queries/fuel";
import type { FeeDetailRow } from "@/lib/queries/fees";

/** Same day-grouping shape the page's groupByDay produces */
export type ReadOnlyDay = {
  date: string;
  legs: DriverPeriodTripRow[];
  miles: number;
  fuel: number;
  pay: number;
  subsidy: number;
};

/**
 * Read-only settlement sheet for driver-linked accounts (and anyone without
 * trip.write): the same three sections as the editable sheet - day ledger,
 * fuel by state, custom fees - rendered as plain server tables. No editors,
 * no save bar; the 司机确认 button stays on the page header.
 */
export function ReadOnlyStatement({
  days,
  fuelDetail,
  feeDetail,
  feeTotal
}: {
  days: ReadOnlyDay[];
  fuelDetail: FuelDetailRow[];
  feeDetail: FeeDetailRow[];
  feeTotal: number;
}) {
  const legCount = days.reduce((n, d) => n + d.legs.length, 0);
  const totalMiles = days.reduce((n, d) => n + d.miles, 0);
  const totalPay = days.reduce((n, d) => n + d.pay, 0);
  const totalSubsidy = days.reduce((n, d) => n + d.subsidy, 0);
  const fuelRollup = fuelDetail.reduce(
    (acc, row) => ({
      gallons: acc.gallons + row.gallons,
      amount: acc.amount + row.amount
    }),
    { gallons: 0, amount: 0 }
  );

  return (
    <>
      <section aria-label="按日明细" className="mt-4">
        <LedgerPanel
          label={
            <>
              按日明细
              <b>
                {days.length} 天 · {legCount} 段 · {fmtMiles(String(totalMiles))} mi · {money(totalPay)}
                {totalSubsidy > 0 && ` · 补助 ${money(totalSubsidy)}`}
              </b>
            </>
          }
        >
          <table className="roster">
            <thead>
              <tr>
                <th>日期</th>
                <th>操作</th>
                <th>Load #</th>
                <th>起点 → 终点</th>
                <th className="num">里程 (mi)</th>
                <th className="num">加油 (gal)</th>
                <th className="num">工资</th>
              </tr>
            </thead>
            <tbody>
              {days.map(day => (
                <Fragment key={day.date}>
                  <tr className="matrix-sub">
                    <td className="mono">{day.date}</td>
                    <td colSpan={3}>当日小计</td>
                    <td className="mono num">{fmtMiles(String(day.miles))}</td>
                    <td className="mono num">{fmtFuel(String(day.fuel))}</td>
                    <td className="mono num">{money(day.pay)}</td>
                  </tr>
                  {day.legs.map(leg => (
                    <tr key={leg.id}>
                      <td className="mono">{leg.trip_date}</td>
                      <td className="mono">{leg.operation}</td>
                      <td className="mono">{leg.load_no || "—"}</td>
                      <td className="mono">
                        {leg.from_code ?? "?"} → {leg.to_code ?? "?"}
                      </td>
                      <td className="mono num">{fmtMiles(leg.miles)}</td>
                      <td className="mono num">{fmtFuel(leg.fuel_gallons)}</td>
                      <td className="mono num">{money(leg.pay_amount)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {legCount === 0 && (
                <tr>
                  <td colSpan={7} className="empty">本周期没有行程。</td>
                </tr>
              )}
            </tbody>
          </table>
        </LedgerPanel>
      </section>

      <section aria-label="加油按州汇总" className="mt-4">
        <LedgerPanel
          label={
            <>
              加油 · 按州
              <b>{fuelDetail.length > 0 ? `${fuelDetail.length} 州 · ${fmtFuel(String(fuelRollup.gallons))} gal` : "未录入"}</b>
            </>
          }
        >
          <table className="roster">
            <thead>
              <tr>
                <th>州</th>
                <th>车号</th>
                <th className="num">Miles</th>
                <th className="num">加油 (gal)</th>
                <th className="num">金额</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {fuelDetail.map(row => (
                <tr key={`${row.truckCode}-${row.stateCode}`}>
                  <td className="mono">{row.stateCode}</td>
                  <td className="mono">{row.truckCode || "—"}</td>
                  <td className="mono num">{fmtMiles(String(row.miles))}</td>
                  <td className="mono num">{fmtFuel(String(row.gallons))}</td>
                  <td className="mono num">{money(String(row.amount))}</td>
                  <td>{row.note || "—"}</td>
                </tr>
              ))}
              {fuelDetail.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">未录入按州加油。</td>
                </tr>
              )}
            </tbody>
          </table>
        </LedgerPanel>
      </section>

      <section aria-label="自定义费用" className="mt-4">
        <LedgerPanel
          label={
            <>
              自定义费用
              <b>{feeDetail.length > 0 ? `${feeDetail.length} 笔 · ${money(feeTotal)}` : "未录入"}</b>
            </>
          }
        >
          <table className="roster">
            <thead>
              <tr>
                <th>名称</th>
                <th className="num">里程 (mi)</th>
                <th className="num">金额</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {feeDetail.map((row, i) => (
                <tr key={`${row.label}-${i}`}>
                  <td>{row.label}</td>
                  <td className="mono num">{row.miles > 0 ? fmtMiles(String(row.miles)) : "—"}</td>
                  <td className="mono num">{money(String(row.amount))}</td>
                  <td>{row.note || "—"}</td>
                </tr>
              ))}
              {feeDetail.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">未录入自定义费用。</td>
                </tr>
              )}
            </tbody>
          </table>
        </LedgerPanel>
      </section>
    </>
  );
}
