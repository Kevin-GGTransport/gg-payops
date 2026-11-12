import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { ComboboxField } from "@/components/combobox-field";
import { AutoSubmitDate } from "@/components/auto-submit";
import { FilterSelect } from "@/components/filter-select";
import { BatchDeleteTrips } from "@/components/batch-delete";
import { CleanForm } from "@/components/clean-form";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { allValues, firstValue, type SearchParams } from "@/lib/search-params";
import { OPERATION_META, type OperationType } from "@/lib/labels";
import { listTrips } from "@/lib/queries/trips";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { TripsTable } from "./trips-table";

export const metadata: Metadata = { title: "行程管理 · G&G PayOps" };

const PAGE_SIZE = 20;

function dateParam(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toString() !== "Invalid Date" ? v : undefined;
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

export default async function TripsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

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
    const params = new URLSearchParams();
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

  const resetHref = "/dashboard/trips";
  // Trip entry lives on the home page now; keep the current driver filter preselected
  const entryHref = `/dashboard${selectedIds[0] ? `?driver=${selectedIds[0]}` : ""}`;

  return (
    <>
      <PageHeader
        title="行程管理"
        description="行程按日期逐段登记：操作、起点、终点、里程。可按司机、操作类型与日期区间筛选核对。"
        actions={<Link className="button button-dark" href={entryHref}>录入行程</Link>}
      />

      <CleanForm className="trip-filter" action="/dashboard/trips" method="get">
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
