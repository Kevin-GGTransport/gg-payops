import { cn } from "@/lib/utils";
import { DRIVER_TYPE_LABELS, STATEMENT_STATUS_LABELS, type DriverType, type StatementStatus } from "@/lib/labels";

const cardBase =
  "grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-0 rounded-md border border-line bg-card px-3 py-2.5 transition-colors hover:border-slate-300 has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-route";
const nameClass = "text-sm font-bold";
const descClass = "col-start-2 text-[11px] leading-tight text-muted-foreground";
const inputClass = "sr-only";

const DRIVER_ON: Record<DriverType, string> = {
  DRIVER: "border-route bg-route/5 [&_svg]:text-route [&_.name]:text-route",
  OWNER: "border-amber-400 bg-amber-50 [&_svg]:text-amber-700 [&_.name]:text-amber-800"
};

function SteeringIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" className="row-span-2 text-slate-400">
      <circle cx="12" cy="12" r="8.6" /><circle cx="12" cy="12" r="2.5" />
      <path d="M12 14.5V21M9.7 10.7 3.9 9.2M14.3 10.7l5.8-1.5" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" className="row-span-2 text-slate-400">
      <path d="M2.8 6.4h10.8v10.2H2.8zM13.6 9.6h3.8l3 3.2v3.8h-6.8z" />
      <circle cx="7.2" cy="17.9" r="1.8" /><circle cx="17" cy="17.9" r="1.8" />
    </svg>
  );
}

/** Driver / owner type radio cards (driver registration form) */
export function DriverTypeCards({ defaultValue }: { defaultValue: DriverType }) {
  return (
    <fieldset className="mx-4 mt-3.5 grid grid-cols-2 gap-2 border-0 p-0 max-md:grid-cols-1">
      <legend className="mb-1.5 float-left text-[13px] text-muted-foreground">人员类型</legend>
      {(["DRIVER", "OWNER"] as const).map(type => (
        <label key={type} className={cn(cardBase, defaultValue === type && DRIVER_ON[type])}>
          <input className={inputClass} type="radio" name="driver_type" value={type} defaultChecked={defaultValue === type} />
          {type === "DRIVER" ? <SteeringIcon /> : <TruckIcon />}
          <span className={cn(nameClass, "name")}>{DRIVER_TYPE_LABELS[type]}</span>
          <span className={descClass}>{type === "DRIVER" ? "驾驶公司车辆，按司机结算" : "自带车辆承运，按车主结算"}</span>
        </label>
      ))}
    </fieldset>
  );
}

const STATUS_ON: Partial<Record<StatementStatus, string>> = {
  DRAFT: "border-line bg-muted/60 [&_.name]:text-foreground",
  REVIEWED: "border-amber-400 bg-amber-50 [&_.name]:text-amber-800",
  VERIFIED: "border-route bg-route/5 [&_.name]:text-route"
};

const STATUS_DESC: Partial<Record<StatementStatus, string>> = {
  DRAFT: "刚生成的快照，可改可删",
  REVIEWED: "已过初审，等待对数",
  VERIFIED: "逐项核对中，仍可修改"
};

/** Statement status radio cards (edit dialog; DONE is advance-only) */
export function StatementStatusCards({ defaultValue }: { defaultValue: StatementStatus }) {
  const options = ["DRAFT", "REVIEWED", "VERIFIED"] as const;
  return (
    <fieldset className="mx-4 mt-3.5 grid grid-cols-3 gap-2 border-0 p-0 max-md:grid-cols-1">
      <legend className="mb-1.5 float-left text-[13px] text-muted-foreground">状态</legend>
      {options.map(status => (
        <label key={status} className={cn(cardBase, defaultValue === status && STATUS_ON[status])}>
          <input className={inputClass} type="radio" name="status" value={status} defaultChecked={defaultValue === status} />
          <span className={cn(nameClass, "name col-span-2")}>{STATEMENT_STATUS_LABELS[status]}</span>
          <span className={descClass}>{STATUS_DESC[status]}</span>
        </label>
      ))}
    </fieldset>
  );
}
