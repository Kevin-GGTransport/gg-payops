import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { PeriodPicker } from "@/components/period-picker";
import { StatementStatusCards } from "@/components/choice-cards";
import { FormGrid, NumberField, TextareaField, SubmitButton, FormError } from "@/components/form-fields";
import { requireUser } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import { miles as fmtMiles, money } from "@/lib/format";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { currentPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import { STATEMENT_STATUS_LABELS, type StatementStatus } from "@/lib/labels";
import {
  listStatements,
  getStatementById,
  statementPeriodTotals,
  mergedPeriodStatements
} from "@/lib/queries/statements";
import { saveStatement, advancePeriod, generateStatements } from "./actions";
import { StatementsTable } from "./statements-table";

export const metadata: Metadata = { title: "工资单 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  bad_status: "状态只能是草稿、审核或核对；「完成」请用列表上的推进操作。",
  bad_number: "数字填写有误：天数为整数，金额为非负数字（最多两位小数）。",
  locked: "只有草稿和核对状态的工资单可以编辑。",
  not_found: "这张工资单不存在，可能已被删除。"
};

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "DRAFT", label: "草稿" },
  { key: "REVIEWED", label: "审核" },
  { key: "VERIFIED", label: "核对" },
  { key: "DONE", label: "完成" }
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

  const q = (firstValue(sp.q) ?? "").trim();
  const periodParam = (firstValue(sp.period) ?? "").trim();
  const period = /^\d{4}-\d{2}-\d{2}$/.test(periodParam) ? periodParam : null;
  const editId = (firstValue(sp.edit) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const generated = Number(firstValue(sp.generated) ?? NaN);
  const eligible = Number(firstValue(sp.eligible) ?? NaN);

  // Keep status/q when the picker navigates between periods (archive mode)
  const baseParams = new URLSearchParams();
  if (q) baseParams.set("q", q);
  const baseQuery = baseParams.toString();

  const thisWeek = currentPeriod();
  const shownPeriod = period ? periodOf(period) : null;
  const prev = shownPeriod ? shiftPeriod(shownPeriod, -1) : null;
  const next = shownPeriod ? shiftPeriod(shownPeriod, 1) : null;

  const filterParams = new URLSearchParams(baseParams);
  if (period) filterParams.set("period", period);
  const returnQuery = filterParams.toString();
  // Full path: actions redirect() to it verbatim (same contract as drivers)
  const returnTo = `/dashboard/payroll${returnQuery ? `?${returnQuery}` : ""}`;
  const closeHref = returnTo;

  // Period mode: the period rollup (statements + live rows merged);
  // Archive mode (no period): generated statements across all periods
  const [merged, archive, pickerTotals, editing] = await Promise.all([
    shownPeriod ? mergedPeriodStatements(shownPeriod) : Promise.resolve(null),
    period ? Promise.resolve(null) : listStatements({ period: null, status: statusFromTab(firstValue(sp.status)), q }),
    statementPeriodTotals(),
    editId ? getStatementById(editId) : Promise.resolve(null)
  ]);

  const statusFilter = period ? "all" : statusFromTab(firstValue(sp.status));
  const counts = archive?.counts ?? { total: 0, draft: 0, reviewed: 0, verified: 0, done: 0 };

  const values = {
    tripDays: formField(sp, "trip_days", editing?.trip_days?.toString()),
    legCount: formField(sp, "leg_count", editing?.leg_count?.toString()),
    totalMiles: formField(sp, "total_miles", editing?.total_miles),
    totalFuel: formField(sp, "total_fuel", editing?.total_fuel),
    totalPay: formField(sp, "total_pay", editing?.total_pay),
    status: (formField(sp, "status", editing?.status) || "DRAFT") as StatementStatus,
    note: formField(sp, "note", editing?.note)
  };

  const tabCount = (key: string) =>
    key === "all" ? counts.total
    : key === "DRAFT" ? counts.draft
    : key === "REVIEWED" ? counts.reviewed
    : key === "VERIFIED" ? counts.verified
    : counts.done;

  // Editing is only offered for DRAFT / VERIFIED (advance-only DONE)
  const editable = editing === null || editing.status === "DRAFT" || editing.status === "VERIFIED";

  // Period-mode aggregates, straight off the merged rows (what you see is what exports)
  const ungenerated = merged?.filter(r => r.status === null && r.leg_count > 0).length ?? 0;
  const pendingAdvance = merged?.filter(r => r.status && r.status !== "DONE").length ?? 0;
  const totals = (merged ?? []).reduce(
    (acc, r) => ({
      drivers: acc.drivers + (r.leg_count > 0 ? 1 : 0),
      legs: acc.legs + r.leg_count,
      miles: acc.miles + Number(r.total_miles),
      pay: acc.pay + Number(r.total_pay)
    }),
    { drivers: 0, legs: 0, miles: 0, pay: 0 }
  );

  return (
    <>
      <PageHeader
        title="工资单"
        description={
          period && shownPeriod
            ? `${periodLabel(shownPeriod)} 的汇总：未生成的按行程实时计，生成后冻结走 草稿 → 审核 → 核对 → 完成。`
            : "每司机每核算周期一张，生成时冻结快照；点周期查看该周汇总与流转。"
        }
        actions={
          <div className="flex items-center gap-2">
            {period && (
              <Link className="button button-dark" href={`/dashboard/payroll/export?period=${period}`}>
                导出工资表
              </Link>
            )}
            <Link className="button button-quiet" href="/dashboard/trips">
              行程台账
            </Link>
          </div>
        }
      />

      {period && shownPeriod ? (
        /* ---------- Period mode: one period's full rollup ---------- */
        <section aria-label="周期汇总">
          <div className="trip-filter">
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/payroll?period=${prev!.start}`} aria-label="上一周期" className={arrowClass}>‹</Link>
              <PeriodPicker
                selectedStart={period}
                selectedLabel={periodLabel(shownPeriod)}
                todayIso={todayIso()}
                totals={pickerTotals}
                hrefBase="/dashboard/payroll"
              />
              <Link href={`/dashboard/payroll?period=${next!.start}`} aria-label="下一周期" className={arrowClass}>›</Link>
            </div>
            <div className="filter-actions">
              {period !== thisWeek.start && <Link href="/dashboard/payroll">回到本周</Link>}
              <Link href={`/dashboard/payroll${baseQuery ? `?${baseQuery}` : ""}`}>全部周期档案</Link>
              {ungenerated > 0 && (
                <form action={generateStatements}>
                  <input type="hidden" name="period" value={period} />
                  <button type="submit" className="linklike">
                    生成本期工资单（{ungenerated} 人待生成）
                  </button>
                </form>
              )}
              {pendingAdvance > 0 && (
                <form action={advancePeriod}>
                  <input type="hidden" name="period" value={period} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button type="submit" className="linklike">
                    本周期全部推进（{pendingAdvance} 张未完成）
                  </button>
                </form>
              )}
            </div>
          </div>

          {Number.isFinite(generated) && (
            <p className="mb-3 rounded-md border border-audit/30 bg-audit/10 px-3 py-2 text-[13px] text-audit">
              {generated > 0
                ? `已生成 ${generated} 张草稿工资单（已存在的自动跳过）。`
                : eligible > 0
                  ? "本周期所有有行程的司机都已有工资单，未新增。"
                  : "本周期暂无可生成的工资单（没有行程记录）。"}
            </p>
          )}

          <section className="gauge" aria-label="本周期读数">
            <header className="gauge-head">
              <span className="gauge-title">本周期读数</span>
              <span className="gauge-range">{periodLabel(shownPeriod)} · 周六 ~ 周五 · 已生成用快照</span>
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
                <span className="gauge-sub">快照与实时合并</span>
              </div>
              <div className="gauge-cell">
                <span className="gauge-label">总里程</span>
                <strong className="gauge-value">{fmtMiles(totals.miles.toString())}<em>mi</em></strong>
                <span className="gauge-sub">周期累计</span>
              </div>
              <div className="gauge-cell gauge-hot">
                <span className="gauge-label">工资总额</span>
                <strong className="gauge-value">{money(totals.pay.toString())}</strong>
                <span className="gauge-sub">本期应付 · 与导出一致</span>
              </div>
            </div>
          </section>

          <LedgerPanel label={<>汇总矩阵<b>{merged!.length} 人 · {ungenerated} 人未生成</b></>}>
            <StatementsTable
              statements={merged!}
              returnTo={returnTo}
              returnQuery={returnQuery}
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

          <div className="toolbar">
            <div className="flex items-center gap-2">
              <PeriodPicker
                selectedStart={thisWeek.start}
                selectedLabel="按周期查看汇总"
                todayIso={todayIso()}
                totals={pickerTotals}
                hrefBase="/dashboard/payroll"
              />
            </div>
          </div>

          <LedgerPanel label={<>工资单档案<b>{archive!.rows.length} 张</b></>}>
            <StatementsTable
              statements={archive!.rows}
              returnTo={returnTo}
              returnQuery={returnQuery}
              empty={
                q || statusFilter !== "all"
                  ? "没有符合条件的工资单。换个筛选条件，或点周期去生成。"
                  : "还没有工资单。点上方周期选择任一周，进去点「生成本期工资单」。"
              }
            />
          </LedgerPanel>
        </section>
      )}

      <ModalShell
        open={Boolean(editing)}
        closeHref={closeHref}
        title={editing ? `编辑 · ${editing.full_name}（${periodLabel(periodOf(editing.period_start))}）` : "编辑工资单"}
      >
        {editing && editable ? (
          <form action={saveStatement} aria-label="工资单编辑卡">
            <input type="hidden" name="id" value={editing.id ?? ""} />
            <input type="hidden" name="return_period" value={editing.period_start} />
            <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
            <StatementStatusCards defaultValue={values.status} />
            <FormGrid>
              <NumberField label="出勤天数" name="trip_days" required min={0} step={1} defaultValue={values.tripDays} />
              <NumberField label="总段数" name="leg_count" required min={0} step={1} defaultValue={values.legCount} />
              <NumberField label="总里程 (mi)" name="total_miles" required min={0} step={0.01} defaultValue={values.totalMiles} />
              <NumberField label="加油 (gal)" name="total_fuel" required min={0} step={0.01} defaultValue={values.totalFuel} />
              <NumberField label="本周期工资 ($)" name="total_pay" required min={0} step={0.01} defaultValue={values.totalPay} />
              <TextareaField label="备注" name="note" placeholder="如：补 11/13 一段 $85" defaultValue={values.note} />
            </FormGrid>
            <SubmitButton>保存修改</SubmitButton>
          </form>
        ) : (
          <div className="grid gap-2 px-4 pb-2 text-[13px] text-muted-foreground">
            <p>
              当前状态为「{editing ? STATEMENT_STATUS_LABELS[editing.status ?? "DRAFT"] : ""}」，只有草稿和核对状态可以编辑。
              请先在列表上回退到核对，或删除草稿后重新生成。
            </p>
          </div>
        )}
      </ModalShell>
    </>
  );
}
