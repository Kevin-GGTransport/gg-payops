import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { FormGrid, TextField, SubmitButton, FormError } from "@/components/form-fields";
import { FlashToast } from "@/components/flash-toast";
import { ComboboxField } from "@/components/combobox-field";
import { MapPicker } from "@/components/map-picker";
import { requirePermission, getUserPermissions } from "@/lib/permissions";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { LOCATION_TYPE_LABELS, type LocationType } from "@/lib/labels";
import { listLocations, getLocationById, locationTagSuggestions, locationTypeCounts } from "@/lib/queries/locations";
import { saveLocation } from "./actions";
import { LocationsTable } from "./locations-table";

export const metadata: Metadata = { title: "位置管理 · G&G PayOps" };

const VALID_TYPES = Object.keys(LOCATION_TYPE_LABELS) as LocationType[];

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "请填写位置代码。",
  missing_name: "请填写位置名称。",
  missing_type: "请选择位置类型。",
  bad_coords: "地图坐标无效，请重新选点或清空坐标。",
  bad_state: "州代码不在系统州表中，请检查州一栏。",
  dup_code: "这个位置代码已存在。"
};

export default async function LocationsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("location.read");
  const canWrite = (await getUserPermissions()).has("location.write");
  const sp = await searchParams;

  const typeParam = firstValue(sp.type);
  const typeFilter = VALID_TYPES.includes(typeParam as LocationType)
    ? (typeParam as LocationType)
    : ("all" as const);
  const q = (firstValue(sp.q) ?? "").trim();
  const editId = (firstValue(sp.edit) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";
  const savedFlash = firstValue(sp.saved);
  const savedMessage =
    savedFlash === "1"
      ? "位置已保存"
      : savedFlash === "status"
        ? "状态已更新"
        : undefined;

  const [locations, counts, editing, tagSuggestions] = await Promise.all([
    listLocations({ type: typeFilter, q }),
    locationTypeCounts(),
    editId ? getLocationById(editId) : Promise.resolve(null),
    locationTagSuggestions()
  ]);

  const typeValue = formField(sp, "location_type", editing?.location_type);
  const values = {
    code: formField(sp, "code", editing?.code),
    name: formField(sp, "name", editing?.name),
    type: VALID_TYPES.includes(typeValue as LocationType) ? typeValue : "AMAZON",
    tag: formField(sp, "class_tag", editing?.class_tag ?? ""),
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
        actions={canWrite ? <Link className="button button-quiet" href="/dashboard/locations?new=1">新增位置</Link> : undefined}
      />
      {savedMessage && <FlashToast message={savedMessage} param="saved" />}

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
            canWrite={canWrite}
            empty="没有符合条件的位置。换筛选条件，或点右上角新增。"
          />
        </LedgerPanel>
      </section>

      <ModalShell
        open={canWrite && (isNew || Boolean(editing) || Boolean(errorCode))}
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
            <TextField label="街道地址" name="address_line" placeholder="如 25503 Industrial Blvd" defaultValue={values.addressLine} maxLength={255} />
            <TextField label="城市" name="city" placeholder="如 Hayward" defaultValue={values.city} maxLength={80} />
            <TextField label="州" name="state_code" placeholder="如 CA" defaultValue={values.stateCode} maxLength={2} />
            <TextField label="邮编" name="postal_code" placeholder="如 94545" defaultValue={values.postalCode} maxLength={16} />
            <div className="grid content-start gap-1.5 text-[13px] font-medium">
              <label htmlFor="location-class-tag">类标签</label>
              <input
                id="location-class-tag"
                name="class_tag"
                list="location-tag-suggestions"
                defaultValue={values.tag}
                maxLength={40}
                placeholder="如 A类 / 东湾"
                aria-label="位置类标签"
                className="h-9 rounded-md border border-line bg-transparent px-3 text-[13px] font-normal focus-visible:ring-1"
              />
              <datalist id="location-tag-suggestions">
                {tagSuggestions.map(tag => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              <span className="text-[11px] font-normal text-muted-foreground">
                工资规则可按标签匹配；改标签，规则计价即时跟着变
              </span>
            </div>
          </FormGrid>
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
