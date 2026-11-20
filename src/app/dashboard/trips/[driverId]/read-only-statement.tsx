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
 * fuel by state, custom fees. Phones get card/stacked layouts (a 7-column
 * table has no business on a 390px screen), md+ keeps the ledger tables.
 * No editors, no save bar; the 司机确认 button stays on the page header.
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
          {/* Phone layout: one block per day (date + subtotal head, each leg
              two lines), no horizontal anything */}
          <div className="md:hidden">
            {legCount === 0 && (
              <p className="m-0 px-4 py-5 text-center text-[13px] text-muted-foreground">
                本周期没有行程。
              </p>
            )}
            {days.map(day => (
              <div key={day.date} className="border-b border-line last:border-b-0">
                <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1.5">
                  <span className="font-mono text-[13px] font-semibold">{day.date}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {fmtMiles(String(day.miles))} mi · {money(day.pay)}
                  </span>
                </div>
                <ul className="m-0 mb-3 grid list-none gap-2 px-4 p-0">
                  {day.legs.map(leg => (
                    <li key={leg.id} className="rounded-[3px] bg-muted/60 px-3 py-2">
                      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[13px]">
                        <span className="font-semibold">{leg.operation}</span>
                        {leg.load_no ? <span className="text-muted-foreground">{leg.load_no}</span> : null}
                        <span>
                          {leg.from_code ?? "?"} <span className="text-muted-foreground">→</span> {leg.to_code ?? "?"}
                        </span>
                      </p>
                      <p className="m-0 mt-1 font-mono text-xs text-muted-foreground tabular-nums">
                        {fmtMiles(leg.miles)} mi
                        {Number(leg.fuel_gallons) > 0 && ` · ${fmtFuel(leg.fuel_gallons)} gal`}
                        {" · "}
                        <span className="font-semibold text-foreground">{money(leg.pay_amount)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <table className="roster hidden md:table">
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
          {/* Phone layout: state + truck on the left, gallons + amount right */}
          <div className="md:hidden">
            {fuelDetail.map(row => (
              <div
                key={`${row.truckCode}-${row.stateCode}`}
                className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="m-0 font-mono text-[13px] font-semibold">
                    {row.stateCode}
                    {row.truckCode && (
                      <span className="ml-2 font-normal text-muted-foreground">{row.truckCode}</span>
                    )}
                  </p>
                  {row.note && <p className="m-0 mt-0.5 text-xs text-muted-foreground">{row.note}</p>}
                </div>
                <p className="m-0 shrink-0 text-right font-mono text-[13px] tabular-nums">
                  {fmtMiles(String(row.miles))} mi · {fmtFuel(String(row.gallons))} gal
                  <span className="block font-semibold">{money(String(row.amount))}</span>
                </p>
              </div>
            ))}
            {fuelDetail.length === 0 && (
              <p className="m-0 px-4 py-5 text-center text-[13px] text-muted-foreground">
                未录入按州加油。
              </p>
            )}
          </div>
          <table className="roster hidden md:table">
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
          {/* Phone layout: label left, amount right, meta underneath */}
          <div className="md:hidden">
            {feeDetail.map((row, i) => (
              <div
                key={`${row.label}-${i}`}
                className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="m-0 text-[13px] font-medium">{row.label}</p>
                  {(row.miles > 0 || row.note) && (
                    <p className="m-0 mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                      {row.miles > 0 ? `${fmtMiles(String(row.miles))} mi` : ""}
                      {row.miles > 0 && row.note ? " · " : ""}
                      {row.note || ""}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">
                  {money(String(row.amount))}
                </span>
              </div>
            ))}
            {feeDetail.length === 0 && (
              <p className="m-0 px-4 py-5 text-center text-[13px] text-muted-foreground">
                未录入自定义费用。
              </p>
            )}
          </div>
          <table className="roster hidden md:table">
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
