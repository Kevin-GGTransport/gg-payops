import { cn } from "@/lib/utils";
import { DRIVER_TYPE_LABELS, type DriverType } from "@/lib/labels";

/** Shared radio-card look (also the trucks form's ownership picker) */
export const radioCardBase =
  "grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-0 rounded-md border border-line bg-card px-3 py-2.5 transition-colors hover:border-slate-300 has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-route";
export const radioCardNameClass = "text-sm font-bold";
export const radioCardDescClass = "col-start-2 text-[11px] leading-tight text-muted-foreground";
export const radioCardInputClass = "sr-only";

// Selected look keyed off :checked so it follows clicks on the uncontrolled
// radio - a defaultValue-derived class never updates after server render
const DRIVER_ON: Record<DriverType, string> = {
  DRIVER:
    "has-[:checked]:border-route has-[:checked]:bg-route/5 has-[:checked]:[&_svg]:text-route has-[:checked]:[&_.name]:text-route",
  OWNER:
    "has-[:checked]:border-amber-400 has-[:checked]:bg-amber-50 has-[:checked]:[&_svg]:text-amber-700 has-[:checked]:[&_.name]:text-amber-800"
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
        <label key={type} className={cn(radioCardBase, DRIVER_ON[type])}>
          <input className={radioCardInputClass} type="radio" name="driver_type" value={type} defaultChecked={defaultValue === type} />
          {type === "DRIVER" ? <SteeringIcon /> : <TruckIcon />}
          <span className={cn(radioCardNameClass, "name")}>{DRIVER_TYPE_LABELS[type]}</span>
          <span className={radioCardDescClass}>{type === "DRIVER" ? "驾驶公司车辆，按司机结算" : "自带车辆承运，按车主结算"}</span>
        </label>
      ))}
    </fieldset>
  );
}
