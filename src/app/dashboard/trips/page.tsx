import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel, LedgerEmpty } from "@/components/ledger";
import { DriverTypeBadge, OperationBadge } from "@/components/badges";
import { FormGrid, DateField, TextareaField, TextField, SubmitButton, FormError } from "@/components/form-fields";
import { ComboboxField } from "@/components/combobox-field";
import { TripLegFields } from "./trip-leg-fields";
import { SelectAll } from "@/components/select-all";
import { AutoSubmitDate } from "@/components/auto-submit";
import { FilterSelect } from "@/components/filter-select";
import { BatchDeleteTrips } from "@/components/batch-delete";
import { ConfirmButton } from "@/components/confirm-button";
import { CleanForm } from "@/components/clean-form";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { allValues, firstValue, formField, type SearchParams } from "@/lib/search-params";
import { dateIso, miles as fmtMiles, money } from "@/lib/format";
import { OPERATION_META, type OperationType } from "@/lib/labels";
import { listTrips } from "@/lib/queries/trips";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { activeLocationOptions } from "@/lib/queries/locations";
import { addTrip, deleteTrip } from "./actions";

export const metadata: Metadata = { title: "行程管理 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_driver: "请选择司机 / 车主。",
  missing_date: "请填写行程日期。",
  missing_operation: "请选择操作类型。",
  missing_load: "请填写 Load#。",
  bad_miles: "里程必须是不小于 0 的数字。",
  bad_pay: "本趟工资必须是不小于 0 的数字。",
  dup_trip: "这一天相同操作、相同起终点的行程已存在，请勿重复录入。"
};

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

  const errorCode = firstValue(sp.error);
  const isAdd = firstValue(sp.add) === "1";
  const today = dateIso(new Date());
  const q = (firstValue(sp.q) ?? "").trim();
  const dateFrom = dateParam(firstValue(sp.from));
  const dateTo = dateParam(firstValue(sp.to));
  const operationParam = firstValue(sp.operation) as OperationType | undefined;
  const operation = operationParam && operationParam in OPERATION_META ? operationParam : undefined;
  const page = intFromParam(firstValue(sp.page));

  const drivers = await activeDriverOptions();

  // Keep only ids from the active driver list; guards against dirty URL params
  const driverIdSet = new Set(drivers.map(d => d.id));
  const selectedIds = allValues(sp.driver).filter(id => driverIdSet.has(id));
  const hasFilter = selectedIds.length > 0 || Boolean(operation) || Boolean(q) || Boolean(dateFrom) || Boolean(dateTo);

  const [trips, locations] = await Promise.all([
    listTrips({
      ...(selectedIds.length > 0 ? { driverIds: selectedIds } : {}),
      ...(operation ? { operation } : {}),
      ...(q ? { q } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      page,
      pageSize: PAGE_SIZE
    }),
    activeLocationOptions()
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
  const pageQuery = queryWith({ page }).toString();
  const addHref = `/dashboard/trips?${pageQuery ? `${pageQuery}&` : ""}add=1`;

  const defaultOperation = (formField(sp, "operation", "DEL") as OperationType) ?? "DEL";

  return (
    <>
      <PageHeader
        title="行程管理"
        description="行程按日期逐段登记：操作、起点、终点、里程。可按司机、操作类型与日期区间筛选核对。"
        actions={<Link className="button button-dark" href={addHref}>录入行程</Link>}
      />

      <CleanForm className="trip-filter" action="/dashboard/trips" method="get">
        <div className="toolbar">
          <div className="search">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="搜索司机、工号或地点代码"
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
          <table className="roster">
            <thead>
              <tr>
                <th className="check-cell">{trips.length > 0 && <SelectAll />}</th>
                <th>日期</th><th>司机 / 车主</th><th>操作</th><th>Load#</th><th>起点 → 终点</th><th className="num">Miles</th><th className="num">本趟工资</th><th className="hidden lg:table-cell">备注</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 && (
                <LedgerEmpty colSpan={10}>
                  {hasFilter
                    ? "没有符合条件的行程。调整筛选条件，或点右上角「录入行程」。"
                    : "还没有行程。点右上角「录入行程」开始记录。"}
                </LedgerEmpty>
              )}
              {trips.map(leg => (
                <tr key={leg.id}>
                  <td className="check-cell">
                    <input
                      type="checkbox"
                      className="row-check"
                      name="selected"
                      value={leg.id}
                      aria-label={`选择 ${leg.driver_name} ${leg.trip_date} 的行程`}
                    />
                  </td>
                  <td className="mono">{leg.trip_date}</td>
                  <td>
                    <span className="strong">{leg.driver_name}</span>
                    <span className="muted-inline">{leg.driver_code}</span>
                    <DriverTypeBadge type={leg.driver_type} />
                  </td>
                  <td><OperationBadge operation={leg.operation} /></td>
                  <td className="mono">{leg.load_no || "—"}</td>
                  <td className="mono">
                    {leg.from_code ?? "—"} <span className="route-arrow">→</span> {leg.to_code ?? "—"}
                  </td>
                  <td className="num">{fmtMiles(leg.miles)}</td>
                  <td className="num">{money(leg.pay_amount)}</td>
                  <td className="notes-cell hidden lg:table-cell">{leg.notes ?? "—"}</td>
                  <td className="actions">
                    <form action={deleteTrip}>
                      <input type="hidden" name="id" value={leg.id} />
                      <input type="hidden" name="return_to" value={queryWith({ page }).toString()} />
                      <ConfirmButton type="submit" className="linklike danger" message="删除这条行程？">
                        删除
                      </ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      <ModalShell
        open={isAdd || Boolean(errorCode)}
        closeHref={`/dashboard/trips?${queryWith({ page })}`}
        title="录入行程"
      >
        <form action={addTrip} aria-label="录入行程">
          <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
          <FormGrid>
            <DateField label="日期" name="trip_date" required defaultValue={formField(sp, "trip_date", today)} />
            <TextField
              label="Load#"
              name="load_no"
              required
              placeholder="如 TGHU1234567"
              defaultValue={formField(sp, "load_no")}
              maxLength={64}
            />
          </FormGrid>
          <FormGrid>
            <TripLegFields
              drivers={drivers}
              locations={locations}
              defaultDriverId={formField(sp, "driver_id", selectedIds[0] ?? "")}
              defaultOperation={defaultOperation}
              defaultFromId={formField(sp, "from_location_id")}
              defaultToId={formField(sp, "to_location_id")}
              defaultMiles={formField(sp, "miles", "0")}
              defaultPay={formField(sp, "pay_amount")}
            />
            <TextareaField label="备注" name="notes" placeholder="选填" defaultValue={formField(sp, "notes")} />
          </FormGrid>
          <SubmitButton>记入行程</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
