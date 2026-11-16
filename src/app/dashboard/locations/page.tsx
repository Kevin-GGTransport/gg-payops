import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { SubmitButton, FormError } from "@/components/form-fields";
import { MapPicker } from "@/components/map-picker";
import { requireUser } from "@/lib/auth";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { LOCATION_TYPE_LABELS, type LocationType } from "@/lib/labels";
import { listLocations, getLocationById, locationTypeCounts } from "@/lib/queries/locations";
import { saveLocation } from "./actions";
import { LocationFormFields } from "./location-form-fields";
import { LocationsTable } from "./locations-table";

export const metadata: Metadata = { title: "位置管理 · G&G PayOps" };

const VALID_TYPES = Object.keys(LOCATION_TYPE_LABELS) as LocationType[];

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "请填写位置代码。",
  missing_name: "请填写位置名称。",
  missing_type: "请选择位置类型。",
  bad_pay: "基准金额必须是大于等于 0 的数字。",
  bad_coords: "地图坐标无效，请重新选点或清空坐标。",
  bad_state: "州代码不在系统州表中，请检查州一栏。",
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
    amazonClass: formField(sp, "amazon_class", editing?.amazon_class ?? ""),
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
          <LocationFormFields values={values} />
          {/* Map picker: search or click to pin, fills the address fields above */}
          <MapPicker
            initialLat={editing?.latitude != null ? Number(editing.latitude) : null}
            initialLng={editing?.longitude != null ? Number(editing.longitude) : null}
          />
          <SubmitButton>{editing ? "保存修改" : "登记位置"}</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
