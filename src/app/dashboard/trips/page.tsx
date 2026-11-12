import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { LedgerPanel, LedgerEmpty } from "@/components/ledger";
import { DriverTypeBadge } from "@/components/badges";
import { PeriodPicker } from "@/components/period-picker";
import { ComboboxField } from "@/components/combobox-field";
import { AutoSubmitDate } from "@/components/auto-submit";
import { FilterSelect } from "@/components/filter-select";
import { BatchDeleteTrips } from "@/components/batch-delete";
import { CleanForm } from "@/components/clean-form";
import { requireUser } from "@/lib/auth";
import { allValues, firstValue, type SearchParams } from "@/lib/search-params";
import { miles as fmtMiles, money, todayIso } from "@/lib/format";
import { currentPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import { OPERATION_META, type OperationType } from "@/lib/labels";
import {
  listTrips,
  payrollMatrix,
  driverPeriodTrips,
  periodPayTotals,
  type DriverPeriodTripRow
} from "@/lib/queries/trips";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { TripsTable } from "./trips-table";
import { PayrollLegsTable } from "./payroll-legs-table";

export const metadata: Metadata = { title: "行程与工资 · G&G PayOps" };

const PAGE_SIZE = 20;

const arrowClass =
  "grid h-9.5 w-8 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40";

function dateParam(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toString() !== "Invalid Date" ? v : undefined;
}

function periodParam(value: string | undefined) {
  return dateParam(value) ? periodOf(dateParam(value)!) : currentPeriod();
}

function intFromParam(value: string | undefined) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Page number window: list all when few pages, otherwise collapse to 1 ... current +/-1 ... last */
function pageWindow(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const middle = [page - 1, page, page + 1].filter(p => p > 1 && p < totalPages);
  const items: Array<number | "…"> = [1];
  if (middle[0] !== undefined && middle[0] > 2) items.push("…");
  items.push(...middle);
  if (middle.length > 0 && middle[middle.length - 1] < totalPages - 1) items.push("…");
  items.push(totalPages);
  return items;
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

export default async function TripsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  // Two views over the same ledger: period rollup (default) / flat ledger
  const view = firstValue(sp.view) === "all" ? "all" : "period";

  if (view === "all") {
    return <AllTripsView sp={sp} />;
  }
  return <PeriodView sp={sp} />;
}

/* ---------------------------------------------------------------------------
   View 1 · 按周期汇总（司机 x 周期矩阵 + 周明细钻取，可删行程）
   ------------------------------------------------------------------------- */
async function PeriodView({ sp }: { sp: SearchParams }) {
  const period = periodParam(firstValue(sp.period));
  const thisWeek = currentPeriod();
  const today = todayIso();
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const pickedId = firstValue(sp.driver) ?? "";

  // Drill-down: start fetching before the matrix so both run in parallel;
  // bigint identities are digits only, other values are dirty params we skip
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

  const picked = pickedId ? rows.find(r => r.driver_id === pickedId) : undefined;
  const pickedLegs = picked && pickedLegsPromise ? await pickedLegsPromise : [];
  const pickedDays = groupByDay(pickedLegs);
  const pickedHref = (d: string | undefined) =>
    `/dashboard/trips?view=period&period=${period.start}${d ? `&driver=${d}` : ""}`;
  const navHref = (p: { start: string }) =>
    `/dashboard/trips?view=period&period=${p.start}${pickedId ? `&driver=${pickedId}` : ""}`;

  return (
    <>
      <PageHeader
        title="行程与工资"
        description="按核算周期（周六 ~ 周五）汇总每位司机的行程与工资，点姓名查看周明细。"
        actions={
          <div className="flex items-center gap-2">
            <Link className="button button-quiet" href={`/dashboard${pickedId ? `?driver=${pickedId}` : ""}`}>
              录入行程
            </Link>
            <Link className="button button-dark" href={`/dashboard/payroll/export?period=${period.start}`}>
              导出工资表
            </Link>
          </div>
        }
      />

      <ViewTabs view="period" />

      <div className="trip-filter">
        <div className="flex items-center gap-2">
          <Link href={navHref(prev)} aria-label="上一周期" className={arrowClass}>‹</Link>
          <PeriodPicker
            selectedStart={period.start}
            selectedLabel={periodLabel(period)}
            todayIso={today}
            totals={periodTotals}
            hrefBase="/dashboard/trips?view=period"
          />
          <Link href={navHref(next)} aria-label="下一周期" className={arrowClass}>›</Link>
        </div>
        <div className="filter-actions">
          {period.start !== thisWeek.start && <Link href="/dashboard/trips?view=period">回到本周</Link>}
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
              periodStart={period.start}
              driverId={picked.driver_id}
            />
          </LedgerPanel>
        </section>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
   View 2 · 全部行程（平铺台账：筛选 / 分页 / 批量删除）
   ------------------------------------------------------------------------- */
function ViewTabs({ view }: { view: "period" | "all" }) {
  const tabs = [
    { key: "period", label: "按周期汇总", href: "/dashboard/trips?view=period" },
    { key: "all", label: "全部行程", href: "/dashboard/trips?view=all" }
  ] as const;
  return (
    <nav className="tabs mb-3" aria-label="视图切换">
      {tabs.map(tab => (
        <Link
          key={tab.key}
          href={tab.href}
          {...(view === tab.key ? { "aria-current": "page" as const } : {})}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

async function AllTripsView({ sp }: { sp: SearchParams }) {
  const q = (firstValue(sp.q) ?? "").trim();
  const dateFrom = dateParam(firstValue(sp.from));
  const dateTo = dateParam(firstValue(sp.to));
  const operationParam = firstValue(sp.operation) as OperationType | undefined;
  const operation = operationParam && operationParam in OPERATION_META ? operationParam : undefined;
  const page = intFromParam(firstValue(sp.page));

  // Sanitize driver ids from the URL (bigint identities are digits only);
  // doing this locally lets all three queries start in parallel
  const selectedIds = allValues(sp.driver).filter(id => /^\d+$/.test(id));
  const hasFilter = selectedIds.length > 0 || Boolean(operation) || Boolean(q) || Boolean(dateFrom) || Boolean(dateTo);

  const [drivers, trips] = await Promise.all([
    activeDriverOptions(),
    listTrips({
      ...(selectedIds.length > 0 ? { driverIds: selectedIds } : {}),
      ...(operation ? { operation } : {}),
      ...(q ? { q } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      page,
      pageSize: PAGE_SIZE
    })
  ]);
  const total = trips[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Serialize current filters + a page number into list URL params */
  function queryWith(over: { page?: number } = {}) {
    const params = new URLSearchParams({ view: "all" });
    for (const id of selectedIds) params.append("driver", id);
    if (operation) params.set("operation", operation);
    if (q) params.set("q", q);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    const pageNo = over.page ?? 1;
    if (pageNo > 1) params.set("page", String(pageNo));
    return params;
  }

  // After deletes the page may overflow (e.g. last page emptied); fall back to page 1
  if (trips.length === 0 && page > 1) {
    redirect(`/dashboard/trips?${queryWith().toString()}`);
  }

  const resetHref = "/dashboard/trips?view=all";
  // Trip entry lives on the home page now; keep the current driver filter preselected
  const entryHref = `/dashboard${selectedIds[0] ? `?driver=${selectedIds[0]}` : ""}`;

  return (
    <>
      <PageHeader
        title="行程与工资"
        description="全部行程的平铺台账：按司机、操作类型与日期区间筛选核对，可勾选批量删除。"
        actions={
          <Link className="button button-dark" href={entryHref}>录入行程</Link>
        }
      />

      <ViewTabs view="all" />

      <CleanForm className="trip-filter" action="/dashboard/trips" method="get">
        <input type="hidden" name="view" value="all" />
        <div className="toolbar">
          <div className="search">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="搜索司机、车号或地点代码"
              aria-label="搜索行程"
            />
            <button type="submit">搜索</button>
          </div>
          <ComboboxField
            name="operation"
            className="contents"
            triggerClassName="h-9.5 w-40"
            defaultValue={operation ?? ""}
            placeholder="全部操作"
            searchable={false}
            autoSubmit
            aria-label="按操作类型筛选"
            options={(Object.entries(OPERATION_META) as Array<[OperationType, (typeof OPERATION_META)[OperationType]]>).map(
              ([key, meta]) => ({ value: key, label: `${meta.label} · ${meta.desc}` })
            )}
          />
          <FilterSelect
            name="driver"
            multiple
            options={drivers.map(d => ({ value: d.id, label: `${d.driver_code} · ${d.full_name}` }))}
            selected={selectedIds}
            placeholder="全部司机"
            aria-label="按司机筛选"
          />
          <AutoSubmitDate
            type="date"
            className="filter-select"
            name="from"
            defaultValue={dateFrom ?? ""}
            aria-label="开始日期"
          />
          <AutoSubmitDate
            type="date"
            className="filter-select"
            name="to"
            defaultValue={dateTo ?? ""}
            aria-label="结束日期"
          />
          <div className="filter-actions">
            {hasFilter && <Link href={resetHref}>重置筛选</Link>}
          </div>
        </div>
      </CleanForm>

      <section aria-label="行程台账">
        <LedgerPanel label={<>行程台账<b>{total} 段</b></>}>
          <TripsTable
            trips={trips}
            returnTo={queryWith({ page }).toString()}
            empty={
              hasFilter
                ? "没有符合条件的行程。调整筛选条件，或点右上角「录入行程」前往首页录入。"
                : "还没有行程。点右上角「录入行程」前往首页开始记录。"
            }
          />
        </LedgerPanel>
        <div className="table-foot">
          <div className="foot-left">
            <BatchDeleteTrips returnTo={queryWith({ page }).toString()} />
            <span>
              共 {total} 条{totalPages > 1 ? ` · 第 ${page}/${totalPages} 页` : ""}
            </span>
          </div>
          {totalPages > 1 && (
            <nav className="pager" aria-label="分页">
              {page > 1 && <Link href={`/dashboard/trips?${queryWith({ page: page - 1 })}`} aria-label="上一页">‹</Link>}
              {pageWindow(page, totalPages).map((item, i) =>
                item === "…" ? (
                  <span key={`gap-${i}`} className="pager-gap">…</span>
                ) : (
                  <Link
                    key={item}
                    href={`/dashboard/trips?${queryWith({ page: item })}`}
                    {...(item === page ? { "aria-current": "page" as const, className: "on" } : {})}
                  >
                    {item}
                  </Link>
                )
              )}
              {page < totalPages && <Link href={`/dashboard/trips?${queryWith({ page: page + 1 })}`} aria-label="下一页">›</Link>}
            </nav>
          )}
        </div>
      </section>
    </>
  );
}
