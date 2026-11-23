import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { DriverTypeCards } from "@/components/choice-cards";
import { FormGrid, TextField, DateField, TextareaField, CheckboxField, SelectField, SubmitButton, FormError } from "@/components/form-fields";
import { FlashToast } from "@/components/flash-toast";
import { ToolbarSearch, ToolbarTabs } from "@/components/crud-toolbar";
import { requirePermission, getUserPermissions } from "@/lib/permissions";
import { firstValue, formField, parseCrudParams, type SearchParams } from "@/lib/search-params";
import {
  DRIVER_TYPES,
  PRICING_MODE_LABELS,
  PRICING_MODES,
  type DriverType,
  type PricingMode
} from "@/lib/labels";
import { listDrivers, getDriverById, driverTypeCounts } from "@/lib/queries/drivers";
import { saveDriver } from "./actions";
import { DriversTable } from "./drivers-table";

export const metadata: Metadata = { title: "司机管理 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_name: "请填写姓名。",
  missing_type: "请选择人员类型：司机或车主。"
};

export default async function DriversPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("driver.read");
  const canWrite = (await getUserPermissions()).has("driver.write");
  const sp = await searchParams;

  const typeParam = firstValue(sp.type);
  const typeFilter = typeParam === "driver" || typeParam === "owner" ? (typeParam as DriverType) : ("all" as const);
  const q = (firstValue(sp.q) ?? "").trim();
  const { editId, errorCode, isNew, savedMessage } = parseCrudParams(sp, {
    "1": "司机已保存",
    status: "状态已更新"
  });

  const filterQuery = new URLSearchParams();
  if (typeFilter !== "all") filterQuery.set("type", typeFilter);
  if (q) filterQuery.set("q", q);
  const returnTo = filterQuery.toString();
  const closeHref = `/dashboard/drivers${returnTo ? `?${returnTo}` : ""}`;
  const modalParams = new URLSearchParams(filterQuery);
  modalParams.set("new", "1");

  const [drivers, counts, editing] = await Promise.all([
    listDrivers({ type: typeFilter, q }),
    driverTypeCounts(),
    editId ? getDriverById(editId) : Promise.resolve(null)
  ]);

  // URL/form params are external input: whitelist before casting (a tampered
  // ?f_driver_type would otherwise flow into the form as a bogus type)
  const rawType = formField(sp, "driver_type", editing?.driver_type);
  const rawPricingMode = formField(sp, "pricing_mode", editing?.pricing_mode);

  const values = {
    name: formField(sp, "full_name", editing?.full_name),
    type: DRIVER_TYPES.includes(rawType as DriverType) ? (rawType as DriverType) : "DRIVER",
    priceAsDriver:
      firstValue(sp.price_as_driver) !== undefined
        ? firstValue(sp.price_as_driver) === "1"
        : (editing?.price_as_driver ?? false),
    pricingMode: PRICING_MODES.includes(rawPricingMode as PricingMode)
      ? (rawPricingMode as PricingMode)
      : "LEG",
    phone: formField(sp, "phone", editing?.phone),
    licenseNo: formField(sp, "license_no", editing?.license_no),
    licenseClass: formField(sp, "license_class", editing?.license_class),
    licenseExpiresOn: formField(sp, "license_expires_on", editing?.license_expires_on),
    hireDate: formField(sp, "hire_date", editing?.hire_date),
    notes: formField(sp, "notes", editing?.notes)
  };

  const tabs = [
    { key: "all", label: "全部", count: counts.total },
    { key: "DRIVER", label: "司机", count: counts.driver, paramValue: "driver" },
    { key: "OWNER", label: "车主", count: counts.owner, paramValue: "owner" }
  ] as const;

  return (
    <>
      <PageHeader
        title="司机管理"
        description="登记司机与车主档案，作为行程录入和计薪的基础数据。"
        actions={
          canWrite ? (
            <Link className="button button-quiet" href={`/dashboard/drivers?${modalParams.toString()}`}>
              新增登记
            </Link>
          ) : undefined
        }
      />
      {savedMessage && <FlashToast message={savedMessage} param="saved" />}

      <section aria-label="司机名单">
        <div className="toolbar">
          <ToolbarTabs
            tabs={tabs}
            basePath="/dashboard/drivers"
            paramKey="type"
            activeKey={typeFilter}
            baseParams={filterQuery}
            ariaLabel="按人员类型筛选"
          />
          <ToolbarSearch
            basePath="/dashboard/drivers"
            query={q}
            placeholder="搜索姓名、电话或驾照号"
            ariaLabel="搜索司机"
            hiddenFields={typeFilter !== "all" ? { type: typeFilter.toLowerCase() } : undefined}
          />
        </div>

        <LedgerPanel>
          <DriversTable
            drivers={drivers}
            returnTo={returnTo}
            canWrite={canWrite}
            empty={
              q || typeFilter !== "all"
                ? "没有符合条件的记录。换个筛选条件，或直接新增一位司机 / 车主。"
                : "还没有司机档案。点右上角「新增登记」登记第一位司机或车主。"
            }
          />
        </LedgerPanel>
      </section>

      <ModalShell
        open={canWrite && (isNew || Boolean(editing) || Boolean(errorCode))}
        closeHref={closeHref}
        title={editing ? `编辑 ${editing.full_name}` : "登记司机 / 车主"}
      >
        <form action={saveDriver} aria-label="司机登记卡">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <input type="hidden" name="return_to" value={returnTo} />
          <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
          <DriverTypeCards defaultValue={values.type === "OWNER" ? "OWNER" : "DRIVER"} />
          <FormGrid>
            <TextField label="姓名" name="full_name" required placeholder="中英文均可" defaultValue={values.name} maxLength={120} />
            <TextField label="电话" name="phone" placeholder="+1-209-…" defaultValue={values.phone} maxLength={32} />
            <TextField label="驾照号" name="license_no" placeholder="如 D1234567" defaultValue={values.licenseNo} maxLength={64} />
            <TextField label="驾照类型" name="license_class" placeholder="如 A" defaultValue={values.licenseClass} maxLength={32} />
            <DateField label="驾照到期日" name="license_expires_on" defaultValue={values.licenseExpiresOn} />
            <DateField label="入职日期" name="hire_date" defaultValue={values.hireDate} />
            <CheckboxField
              label="计价身份"
              name="price_as_driver"
              defaultChecked={values.priceAsDriver}
              hint="车主按司机价计价（规则用司机价列，不乘车主系数）"
            />
            <SelectField
              label="计价方式"
              name="pricing_mode"
              defaultValue={values.pricingMode ?? "LEG"}
              options={Object.entries(PRICING_MODE_LABELS).map(([value, label]) => ({ value, label }))}
              hint="录入行程时计价下拉自动跟随，可临时手改"
            />
            <TextareaField label="备注" name="notes" placeholder="结算方式、车辆信息等" defaultValue={values.notes} />
          </FormGrid>
          <SubmitButton>{editing ? "保存修改" : "登记入册"}</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
