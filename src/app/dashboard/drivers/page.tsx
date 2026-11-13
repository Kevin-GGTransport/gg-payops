import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { DriverTypeCards } from "@/components/choice-cards";
import { FormGrid, TextField, DateField, TextareaField, SubmitButton, FormError } from "@/components/form-fields";
import { requireUser } from "@/lib/auth";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import type { DriverType } from "@/lib/labels";
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
  await requireUser();
  const sp = await searchParams;

  const typeParam = firstValue(sp.type);
  const typeFilter = typeParam === "driver" || typeParam === "owner" ? (typeParam as DriverType) : ("all" as const);
  const q = (firstValue(sp.q) ?? "").trim();
  const editId = (firstValue(sp.edit) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";

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

  const values = {
    name: formField(sp, "full_name", editing?.full_name),
    type: formField(sp, "driver_type", editing?.driver_type) as DriverType,
    phone: formField(sp, "phone", editing?.phone),
    licenseNo: formField(sp, "license_no", editing?.license_no),
    licenseClass: formField(sp, "license_class", editing?.license_class),
    licenseExpiresOn: formField(sp, "license_expires_on", editing?.license_expires_on),
    hireDate: formField(sp, "hire_date", editing?.hire_date),
    notes: formField(sp, "notes", editing?.notes)
  };

  const tabs = [
    { key: "all", label: "全部", count: counts.total },
    { key: "DRIVER", label: "司机", count: counts.driver },
    { key: "OWNER", label: "车主", count: counts.owner }
  ] as const;

  return (
    <>
      <PageHeader
        title="司机管理"
        description="登记司机与车主档案，作为行程录入和计薪的基础数据。"
        actions={
          <Link className="button button-quiet" href={`/dashboard/drivers?${modalParams.toString()}`}>
            新增登记
          </Link>
        }
      />

      <section aria-label="司机名单">
        <div className="toolbar">
          <nav className="tabs" aria-label="按人员类型筛选">
            {tabs.map(tab => {
              const params = new URLSearchParams(filterQuery);
              if (tab.key === "all") params.delete("type");
              else params.set("type", tab.key.toLowerCase());
              const active = typeFilter === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={`/dashboard/drivers${params.toString() ? `?${params.toString()}` : ""}`}
                  {...(active ? { "aria-current": "page" as const } : {})}
                >
                  {tab.label}<b>{tab.count}</b>
                </Link>
              );
            })}
          </nav>
          <form className="search" action="/dashboard/drivers" method="get">
            {typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter.toLowerCase()} />}
            <input type="search" name="q" defaultValue={q} placeholder="搜索姓名、电话或驾照号" aria-label="搜索司机" />
            <button type="submit">搜索</button>
          </form>
        </div>

        <LedgerPanel>
          <DriversTable
            drivers={drivers}
            returnTo={returnTo}
            empty={
              q || typeFilter !== "all"
                ? "没有符合条件的记录。换个筛选条件，或直接新增一位司机 / 车主。"
                : "还没有司机档案。点右上角「新增登记」登记第一位司机或车主。"
            }
          />
        </LedgerPanel>
      </section>

      <ModalShell
        open={isNew || Boolean(editing) || Boolean(errorCode)}
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
            <TextareaField label="备注" name="notes" placeholder="结算方式、车辆信息等" defaultValue={values.notes} />
          </FormGrid>
          <SubmitButton>{editing ? "保存修改" : "登记入册"}</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
