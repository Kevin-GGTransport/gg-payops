import type { Metadata } from "next";
import Link from "next/link";

import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel, LedgerEmpty } from "@/components/ledger";
import {
  FormGrid,
  TextField,
  TextareaField,
  DateField,
  NumberField,
  SubmitButton,
  FormError
} from "@/components/form-fields";
import { requireUser } from "@/lib/auth";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { todayIso, odometerMi } from "@/lib/format";
import {
  listTrucks,
  getTruckById,
  truckOwnershipCounts,
  truckOwnershipHistory,
  truckOdometerHistory,
  activeOwnerOptions
} from "@/lib/queries/trucks";
import { saveTruck, addOdometerReading, deleteOdometerReading } from "./actions";
import { OwnershipPicker } from "./ownership-picker";
import { TrucksTable } from "./trucks-table";

export const metadata: Metadata = { title: "车辆管理 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "请填写车号。",
  dup_code: "这个车号已存在，请换一个。",
  owner_invalid: "所选车主无效，请重新选择。",
  bad_date: "读取日期无效。",
  bad_odometer: "表显里程必须是不小于 0 的数字。"
};

export default async function TrucksPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  const ownParam = firstValue(sp.own);
  const ownFilter =
    ownParam === "company" || ownParam === "owner" ? ownParam : ("all" as const);
  const q = (firstValue(sp.q) ?? "").trim();
  const editId = (firstValue(sp.edit) ?? "").trim();
  const odoId = (firstValue(sp.odo) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";

  const filterQuery = new URLSearchParams();
  if (ownFilter !== "all") filterQuery.set("own", ownFilter);
  if (q) filterQuery.set("q", q);
  const returnTo = filterQuery.toString();
  const closeHref = `/dashboard/trucks${returnTo ? `?${returnTo}` : ""}`;
  const modalParams = new URLSearchParams(filterQuery);
  modalParams.set("new", "1");

  const [trucks, counts, owners, editing, odoTruck] = await Promise.all([
    listTrucks({ own: ownFilter, q }),
    truckOwnershipCounts(),
    activeOwnerOptions(),
    editId ? getTruckById(editId) : Promise.resolve(null),
    odoId ? getTruckById(odoId) : Promise.resolve(null)
  ]);
  const [ownershipHistory, odometerHistory] = await Promise.all([
    editing ? truckOwnershipHistory(editing.id) : Promise.resolve([]),
    odoTruck ? truckOdometerHistory(odoTruck.id) : Promise.resolve([])
  ]);

  const values = {
    code: formField(sp, "truck_code", editing?.truck_code),
    plateNo: formField(sp, "plate_no", editing?.plate_no),
    truckType: formField(sp, "truck_type", editing?.truck_type),
    capacityNote: formField(sp, "capacity_note", editing?.capacity_note),
    notes: formField(sp, "notes", editing?.notes),
    kind: formField(sp, "ownership_kind", editing?.owner_id ? "owner" : "company"),
    ownerId: formField(sp, "owner_driver_id", editing?.owner_id ?? "")
  };

  const tabs = [
    { key: "all", label: "全部", count: counts.total },
    { key: "company", label: "公司自有", count: counts.company },
    { key: "owner", label: "车主", count: counts.owner }
  ] as const;

  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? "保存出错，请检查后重试。" : undefined;
  // Odometer errors redirect back into the odometer modal; form errors open the truck form
  const odoOpen = Boolean(odoTruck);
  const editOpen = !odoOpen && (isNew || Boolean(editing) || Boolean(errorCode));

  return (
    <>
      <PageHeader
        title="车辆管理"
        description="登记车辆档案、归属与表显里程，作为车队基础数据。"
        actions={
          <Link className="button button-quiet" href={`/dashboard/trucks?${modalParams.toString()}`}>
            新增登记
          </Link>
        }
      />

      <section aria-label="车辆名单">
        <div className="toolbar">
          <nav className="tabs" aria-label="按归属筛选">
            {tabs.map(tab => {
              const params = new URLSearchParams(filterQuery);
              if (tab.key === "all") params.delete("own");
              else params.set("own", tab.key);
              const active = ownFilter === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={`/dashboard/trucks${params.toString() ? `?${params.toString()}` : ""}`}
                  {...(active ? { "aria-current": "page" as const } : {})}
                >
                  {tab.label}<b>{tab.count}</b>
                </Link>
              );
            })}
          </nav>
          <form className="search" action="/dashboard/trucks" method="get">
            {ownFilter !== "all" && <input type="hidden" name="own" value={ownFilter} />}
            <input type="search" name="q" defaultValue={q} placeholder="搜索车号、车牌、车型或车主" aria-label="搜索车辆" />
            <button type="submit">搜索</button>
          </form>
        </div>

        <LedgerPanel>
          <TrucksTable
            trucks={trucks}
            returnTo={returnTo}
            empty={
              q || ownFilter !== "all"
                ? "没有符合条件的记录。换个筛选条件，或直接新增一辆车。"
                : "还没有车辆档案。点右上角「新增登记」登记第一辆车。"
            }
          />
        </LedgerPanel>
      </section>

      <ModalShell
        open={editOpen}
        closeHref={closeHref}
        title={editing ? `编辑 ${editing.truck_code}` : "登记车辆"}
      >
        <form action={saveTruck} aria-label="车辆登记卡">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <input type="hidden" name="return_to" value={returnTo} />
          <FormError message={errorMessage} />
          <OwnershipPicker
            owners={owners}
            defaultKind={values.kind === "owner" ? "owner" : "company"}
            defaultOwnerId={values.ownerId ?? ""}
          />
          <FormGrid>
            <TextField label="车号" name="truck_code" required placeholder="如 1018" defaultValue={values.code} maxLength={32} />
            <TextField label="车牌号" name="plate_no" placeholder="如 8ABC123" defaultValue={values.plateNo} maxLength={32} />
            <TextField label="车型" name="truck_type" placeholder="如 Day Cab" defaultValue={values.truckType} maxLength={64} />
            <TextField label="载重说明" name="capacity_note" placeholder="如 40ft 柜" defaultValue={values.capacityNote} maxLength={120} />
            <TextareaField label="备注" name="notes" placeholder="购置、保险等信息" defaultValue={values.notes} className="col-span-2 max-md:col-span-1" />
          </FormGrid>
          <SubmitButton>{editing ? "保存修改" : "登记入册"}</SubmitButton>
        </form>
        {editing && ownershipHistory.length > 0 && (
          <div className="border-t border-dashed border-line px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">归属历史</p>
            <ul className="grid gap-1 text-[13px]">
              {ownershipHistory.map(row => (
                <li key={row.id} className="flex items-baseline justify-between gap-3">
                  <span>
                    {row.owner_name ?? "公司自有"}
                    {!row.valid_to && <span className="muted-inline">现任</span>}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.valid_from} ~ {row.valid_to ?? "今"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={odoOpen}
        closeHref={closeHref}
        title={`${odoTruck?.truck_code ?? ""} · 表显里程`}
      >
        <FormError message={errorMessage} />
        <form action={addOdometerReading} aria-label="记入表显里程">
          <input type="hidden" name="truck_id" value={odoTruck?.id ?? ""} />
          <input type="hidden" name="return_to" value={returnTo} />
          <FormGrid className="grid-cols-3 max-md:grid-cols-1">
            <DateField label="读取日期" name="reading_date" required defaultValue={todayIso()} />
            <NumberField label="表显里程 (mi)" name="odometer" required min={0} step={0.1} placeholder="如 123456.7" />
            <TextField label="备注" name="note" placeholder="选填" maxLength={255} />
          </FormGrid>
          <SubmitButton>记入读数</SubmitButton>
        </form>
        <div className="border-t border-dashed border-line">
          <table className="roster">
            <thead>
              <tr><th>读取日期</th><th className="num">表显里程</th><th>备注</th><th>操作</th></tr>
            </thead>
            <tbody>
              {odometerHistory.length === 0 && (
                <LedgerEmpty colSpan={4}>还没有读数。记入第一条表显里程。</LedgerEmpty>
              )}
              {odometerHistory.map(row => (
                <tr key={row.id}>
                  <td className="mono">{row.reading_date}</td>
                  <td className="mono num strong">{odometerMi(row.odometer)}</td>
                  <td>{row.note ?? "—"}</td>
                  <td className="actions">
                    <form action={deleteOdometerReading}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="truck_id" value={odoTruck?.id ?? ""} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <button type="submit" className="linklike danger">删除</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ModalShell>
    </>
  );
}
