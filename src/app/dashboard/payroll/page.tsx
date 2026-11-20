import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { PeriodPicker } from "@/components/period-picker";
import { requireUser } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import { miles as fmtMiles, money } from "@/lib/format";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { defaultPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import type { StatementStatus } from "@/lib/labels";
import {
  listStatements,
  statementPeriodTotals,
  mergedPeriodStatements
} from "@/lib/queries/statements";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { activeTruckOptions } from "@/lib/queries/trucks";
import { StatementsTable } from "./statements-table";

export const metadata: Metadata = { title: "工资单 · G&G PayOps" };

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "DRAFT", label: "草稿" },
  { key: "VERIFIED", label: "核对" }
] as const;

const arrowClass =
  "grid h-9.5 w-8 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40";

function statusFromTab(tab: string | undefined): StatementStatus | "all" {
  return STATUS_TABS.some(t => t.key === tab && t.key !== "all") ? (tab as StatementStatus) : "all";
}

export default async function PayrollPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  // Two tabs: the period rollup is the default landing view; the archive
  // (statements across all periods) is the second tab
  const view = firstValue(sp.view) === "all" ? "all" : "period";

  const q = (firstValue(sp.q) ?? "").trim();
  const periodParam = (firstValue(sp.period) ?? "").trim();
  const period = /^\d{4}-\d{2}-\d{2}$/.test(periodParam) ? periodParam : null;

  const baseParams = new URLSearchParams();
  if (view === "all") baseParams.set("view", "all");
  if (q) baseParams.set("q", q);

  // Landing period = the week that just closed (same default as entry)
  const defaultWeek = defaultPeriod();
  const shownPeriod = view === "period" ? periodOf(period ?? defaultWeek.start) : null;

  const filterParams = new URLSearchParams(baseParams);
  if (period) filterParams.set("period", period);

  // Period mode: the period rollup (statements, DRAFT numbers live);
  // Archive mode: statements across all periods
  const [merged, archive, pickerTotals, drivers, trucks] = await Promise.all([
    shownPeriod ? mergedPeriodStatements(shownPeriod) : Promise.resolve(null),
    view === "all"
      ? listStatements({ period: null, status: statusFromTab(firstValue(sp.status)), q })
      : Promise.resolve(null),
    statementPeriodTotals(),
    // Copy-dialog pickers, shared by both table views
    activeDriverOptions(),
    activeTruckOptions()
  ]);

  const statusFilter = view === "all" ? statusFromTab(firstValue(sp.status)) : "all";
  const counts = archive?.counts ?? { total: 0, draft: 0, verified: 0 };
  // Each view always has its dataset by construction (period -> merged,
  // archive -> archive); these locals keep the JSX free of non-null assertions
  const mergedRows = merged ?? [];
  const archiveRows = archive?.rows ?? [];

  const tabCount = (key: string) =>
    key === "all" ? counts.total : key === "DRAFT" ? counts.draft : counts.verified;

  // Period-mode aggregates, straight off the merged rows (what you see is what exports)
  const idleDrivers = merged?.filter(r => r.status === null).length ?? 0;
  const totals = (merged ?? []).reduce(
    (acc, r) => ({
      drivers: acc.drivers + (r.leg_count > 0 ? 1 : 0),
      legs: acc.legs + r.leg_count,
      miles: acc.miles + Number(r.total_miles),
      pay: acc.pay + Number(r.total_pay),
      subsidy: acc.subsidy + Number(r.total_fuel_subsidy)
    }),
    { drivers: 0, legs: 0, miles: 0, pay: 0, subsidy: 0 }
  );

  return (
    <>
      <PageHeader
        title="工资单"
        description={
          view === "period" && shownPeriod
            ? `${periodLabel(shownPeriod)} 的汇总：录入行程自动生成草稿工资单，草稿数字实时跟随行程；点「核对」（列表或详情页）后金额冻结，再「司机确认」；核对后的行程改动只在详情页标红。`
            : "所有周期的工资单档案；行程汇总在「按周期」页签。"
        }
        actions={
          <div className="flex items-center gap-2">
            {view === "period" && shownPeriod && (
              <>
                <Link className="button button-dark" href={`/dashboard/payroll/export?period=${shownPeriod.start}`}>
                  导出工资表
                </Link>
                <Link className="button button-quiet" href={`/dashboard/fuel-export?period=${shownPeriod.start}`}>
                  导出加油
                </Link>
              </>
            )}
            <Link className="button button-quiet" href="/dashboard/trips">
              行程台账
            </Link>
          </div>
        }
      />

      {/* View tabs: the period rollup is the landing view (trips live there);
          the archive is the second tab */}
      <div className="mb-3">
        <nav className="tabs" aria-label="视图切换">
          <Link
            href={`/dashboard/payroll${period ? `?period=${period}` : ""}`}
            {...(view === "period" ? { "aria-current": "page" as const } : {})}
          >
            按周期
          </Link>
          <Link
            href={`/dashboard/payroll?view=all`}
            {...(view === "all" ? { "aria-current": "page" as const } : {})}
          >
            全部周期
          </Link>
        </nav>
      </div>

      {view === "period" && shownPeriod ? (
        /* ---------- Period mode: one period's full rollup ---------- */
        <section aria-label="周期汇总">
          <div className="trip-filter">
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/payroll?period=${shiftPeriod(shownPeriod, -1).start}`} aria-label="上一周期" className={arrowClass}>‹</Link>
              <PeriodPicker
                selectedStart={shownPeriod.start}
                selectedLabel={periodLabel(shownPeriod)}
                todayIso={todayIso()}
                totals={pickerTotals}
                hrefBase="/dashboard/payroll"
              />
              <Link href={`/dashboard/payroll?period=${shiftPeriod(shownPeriod, 1).start}`} aria-label="下一周期" className={arrowClass}>›</Link>
            </div>
            <div className="filter-actions">
              {shownPeriod.start !== defaultWeek.start && (
                <Link href={`/dashboard/payroll?period=${defaultWeek.start}`}>回到上周</Link>
              )}
              <Link href="/dashboard/payroll?view=all">全部周期档案</Link>
            </div>
          </div>

          <section className="gauge" aria-label="本周期读数">
            <header className="gauge-head">
              <span className="gauge-title">本周期读数</span>
              <span className="gauge-range">{periodLabel(shownPeriod)} · 周六 ~ 周五 · 草稿实时 / 核对冻结 / 司机确认</span>
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
                <span className="gauge-sub">工资单上的段数</span>
              </div>
              <div className="gauge-cell">
                <span className="gauge-label">总里程</span>
                <strong className="gauge-value">{fmtMiles(totals.miles.toString())}<em>mi</em></strong>
                <span className="gauge-sub">周期累计</span>
              </div>
              <div className="gauge-cell gauge-hot">
                <span className="gauge-label">本期应付</span>
                <strong className="gauge-value">{money((totals.pay + totals.subsidy).toString())}</strong>
                <span className="gauge-sub">
                  {totals.subsidy > 0
                    ? `工资 ${money(totals.pay.toString())} + 燃油补助 ${money(totals.subsidy.toString())}`
                    : "与导出一致"}
                </span>
              </div>
            </div>
          </section>

          <LedgerPanel label={<>汇总矩阵<b>{totals.drivers} 人出勤 · {idleDrivers} 人无行程</b></>}>
            <StatementsTable
              statements={mergedRows}
              drivers={drivers}
              trucks={trucks}
              empty="本周期还没有司机有行程；先去录入行程。"
            />
          </LedgerPanel>
        </section>
      ) : (
        /* ---------- Archive mode: statements across all periods ---------- */
        <section aria-label="工资单档案">
          <div className="toolbar">
            <nav className="tabs" aria-label="按状态筛选">
              {STATUS_TABS.map(tab => {
                const params = new URLSearchParams(filterParams);
                if (tab.key === "all") params.delete("status");
                else params.set("status", tab.key);
                const active = statusFilter === tab.key;
                return (
                  <Link
                    key={tab.key}
                    href={`/dashboard/payroll${params.toString() ? `?${params.toString()}` : ""}`}
                    {...(active ? { "aria-current": "page" as const } : {})}
                  >
                    {tab.label}<b>{tabCount(tab.key)}</b>
                  </Link>
                );
              })}
            </nav>
            <form className="search" action="/dashboard/payroll" method="get">
              <input type="search" name="q" defaultValue={q} placeholder="搜索司机姓名" aria-label="搜索工资单" />
              <button type="submit">搜索</button>
            </form>
          </div>

          <LedgerPanel label={<>工资单档案<b>{archiveRows.length} 张</b></>}>
            <StatementsTable
              statements={archiveRows}
              drivers={drivers}
              trucks={trucks}
              empty={
                q || statusFilter !== "all"
                  ? "没有符合条件的工资单。换个筛选条件看看。"
                  : "还没有工资单。录入行程后会自动生成草稿。"
              }
            />
          </LedgerPanel>
        </section>
      )}
    </>
  );
}
