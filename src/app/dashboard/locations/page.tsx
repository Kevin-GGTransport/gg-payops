import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { FormGrid, TextField, NumberField, SubmitButton, FormError } from "@/components/form-fields";
import { ComboboxField } from "@/components/combobox-field";
import { requireUser } from "@/lib/auth";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { LOCATION_TYPE_LABELS, type LocationType } from "@/lib/labels";
import { listLocations, getLocationById, locationTypeCounts } from "@/lib/queries/locations";
import { saveLocation } from "./actions";
import { LocationsTable } from "./locations-table";

export const metadata: Metadata = { title: "位置管理 · G&G PayOps" };

const VALID_TYPES = Object.keys(LOCATION_TYPE_LABELS) as LocationType[];

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "请填写位置代码。",
  missing_name: "请填写位置名称。",
  missing_type: "请选择位置类型。",
  bad_pay: "基准金额必须是大于等于 0 的数字。",
  dup_code: "这个位置代码已存在。"
};

export default async function LocationsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  const typeParam = firstValue(sp.type);
  const typeFilter = VALID_TYPES.includes(typeParam as LocationType)
    ? (typeParam as LocationType)
    : ("all" as const);
  const q = (firstValue(sp.q) ?? "").trim();
  const editId = (firstValue(sp.edit) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";

  const [locations, counts, editing] = await Promise.all([
    listLocations({ type: typeFilter, q }),
    locationTypeCounts(),
    editId ? getLocationById(editId) : Promise.resolve(null)
  ]);

  const typeValue = formField(sp, "location_type", editing?.location_type);
  const values = {
    code: formField(sp, "code", editing?.code),
    name: formField(sp, "name", editing?.name),
    type: VALID_TYPES.includes(typeValue as LocationType) ? typeValue : "AMAZON",
    pay: formField(sp, "standard_pay_amount", editing?.standard_pay_amount ?? "0"),
    addressLine: formField(sp, "address_line", editing?.address_line),
    city: formField(sp, "city", editing?.city),
    stateCode: formField(sp, "state_code", editing?.state_code),
    postalCode: formField(sp, "postal_code", editing?.postal_code)
  };

  const tabs = [
    { key: "all", label: "全部", count: counts.total },
    ...VALID_TYPES.map(t => ({ key: t, label: LOCATION_TYPE_LABELS[t], count: counts[t] }))
  ];

  return (
    <>
      <PageHeader
        title="位置管理"
        description="行程起终点与基准金额的基础数据，按类型区分基地、亚马逊仓、其他。"
        actions={<Link className="button button-quiet" href="/dashboard/locations?new=1">新增位置</Link>}
      />

      <section aria-label="位置名单">
        <div className="toolbar">
          <nav className="tabs" aria-label="按类型筛选">
            {tabs.map(tab => {
              const params = new URLSearchParams();
              if (q) params.set("q", q);
              if (tab.key !== "all") params.set("type", tab.key);
              const active = typeFilter === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={`/dashboard/locations${params.toString() ? `?${params.toString()}` : ""}`}
                  {...(active ? { "aria-current": "page" as const } : {})}
                >
                  {tab.label}<b>{tab.count}</b>
                </Link>
              );
            })}
          </nav>
          <form className="search" action="/dashboard/locations" method="get">
            {typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter} />}
            <input type="search" name="q" defaultValue={q} placeholder="搜索代码或名称" aria-label="搜索位置" />
            <button type="submit">搜索</button>
          </form>
        </div>

        <LedgerPanel>
          <LocationsTable
            locations={locations}
            empty="没有符合条件的位置。换筛选条件，或点右上角新增。"
          />
        </LedgerPanel>
      </section>

      <ModalShell
        open={isNew || Boolean(editing) || Boolean(errorCode)}
        closeHref="/dashboard/locations"
        title={editing ? `编辑 ${editing.code}` : "新增位置"}
      >
        <form action={saveLocation} aria-label="位置登记卡">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
          <FormGrid>
            <TextField label="代码" name="code" required placeholder="如 ONT8" defaultValue={values.code} maxLength={16} />
            <TextField label="名称" name="name" required placeholder="如 Ontario 亚马逊仓" defaultValue={values.name} maxLength={120} />
            <ComboboxField
              label="类型"
              name="location_type"
              defaultValue={values.type}
              placeholder="请选择类型"
              clearable={false}
              searchable={false}
              options={VALID_TYPES.map(t => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))}
            />
            <NumberField label="基准金额（$）" name="standard_pay_amount" min={0} step={0.01} defaultValue={values.pay} />
            <TextField label="街道地址" name="address_line" placeholder="如 25503 Industrial Blvd" defaultValue={values.addressLine} maxLength={255} />
            <TextField label="城市" name="city" placeholder="如 Hayward" defaultValue={values.city} maxLength={80} />
            <TextField label="州" name="state_code" placeholder="如 CA" defaultValue={values.stateCode} maxLength={2} />
            <TextField label="邮编" name="postal_code" placeholder="如 94545" defaultValue={values.postalCode} maxLength={16} />
          </FormGrid>
          <SubmitButton>{editing ? "保存修改" : "登记位置"}</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
