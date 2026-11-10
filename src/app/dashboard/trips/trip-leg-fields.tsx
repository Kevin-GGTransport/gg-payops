"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { NumberField } from "@/components/form-fields";
import { ComboboxField } from "@/components/combobox-field";
import { LocationPicker, type LocationOption } from "@/components/location-picker";
import { calcTripWage } from "@/lib/wage";
import {
  DRIVER_TYPE_LABELS,
  OPERATION_META,
  type DriverType,
  type OperationType
} from "@/lib/labels";

type DriverOption = {
  id: string;
  driver_code: string;
  full_name: string;
  driver_type: DriverType;
};

type TripLegFieldsProps = {
  drivers: DriverOption[];
  locations: LocationOption[];
  defaultDriverId?: string;
  defaultOperation?: string;
  defaultFromId?: string;
  defaultToId?: string;
  defaultMiles?: string;
  /** Error-restore value; presence starts the wage field in manual mode */
  defaultPay?: string;
};

type CalcStatus = "loading" | "auto" | "failed";

/**
 * Trip form grid: driver, operation, from/to pickers, miles (Google Distance
 * Matrix auto-measure) and the per-trip wage. The wage auto-follows the rule
 * (endpoint standard pay, or mileage tier when neither end is BASE) x owner(x2)
 * x bobtail(x0.5) until the user edits it - then it stays manual ("按规则重算"
 * switches back), unlike miles which re-measures on every endpoint re-pick.
 */
export function TripLegFields({
  drivers,
  locations,
  defaultDriverId = "",
  defaultOperation = "DEL",
  defaultFromId = "",
  defaultToId = "",
  defaultMiles = "0",
  defaultPay = ""
}: TripLegFieldsProps) {
  const [driverId, setDriverId] = React.useState(defaultDriverId);
  const [operation, setOperation] = React.useState(defaultOperation);
  const [fromId, setFromId] = React.useState(defaultFromId);
  const [toId, setToId] = React.useState(defaultToId);
  const [milesValue, setMilesValue] = React.useState(defaultMiles);
  // "loading" start: status only shows once both ends are set, and every path
  // there is already measuring (pre-filled on error restore, or a fresh pick)
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  // Ignore stale responses after a quick location re-pick
  const requestId = React.useRef(0);

  // Sticky manual wage: null = auto-follow the rule; once set (hand edit or
  // error restore) basis changes never overwrite it - only "按规则重算"
  // drops back to auto. Derived below, no state-sync effect needed.
  const [manualPay, setManualPay] = React.useState<string | null>(defaultPay || null);

  React.useEffect(() => {
    if (!fromId || !toId) return;
    const id = ++requestId.current;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/distance?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { miles: number | null } = await res.json();
        if (cancelled || id !== requestId.current) return;
        if (typeof data.miles === "number" && data.miles > 0) {
          setStatus("auto");
          setManual(false);
          setMilesValue(String(data.miles));
        } else {
          setStatus("failed");
        }
      } catch {
        if (!cancelled && id === requestId.current) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromId, toId]);

  const fromLoc = locations.find(l => l.id === fromId);
  const toLoc = locations.find(l => l.id === toId);
  const driverType = drivers.find(d => d.id === driverId)?.driver_type;

  const autoPay = React.useMemo(
    () =>
      calcTripWage({
        driverType,
        operation: operation as OperationType | undefined,
        miles: Number(milesValue) || 0,
        from: fromLoc,
        to: toLoc
      }),
    [driverType, operation, milesValue, fromLoc, toLoc]
  );

  const payValue = manualPay ?? autoPay.toFixed(2);

  function pickFrom(value: string) {
    setFromId(value);
    if (value && toId) setStatus("loading");
  }

  function pickTo(value: string) {
    setToId(value);
    if (value && fromId) setStatus("loading");
  }

  // "Idle" (an end missing) is derived, not stored
  const phase = !fromId || !toId ? "idle" : status;
  const hint =
    phase === "loading"
      ? "Google 地图测算中…"
      : manual
        ? "手动输入里程"
        : phase === "failed"
          ? "未能自动测算，请手动填写"
          : phase === "auto"
            ? "已按 Google 地图测算，可手动修改"
            : "选好起点和终点后自动测算";

  return (
    <>
      <ComboboxField
        label="司机 / 车主"
        name="driver_id"
        defaultValue={defaultDriverId}
        placeholder="请选择司机"
        searchPlaceholder="搜索工号或姓名"
        mono
        clearable={false}
        onValueChange={setDriverId}
        options={drivers.map(d => ({
          value: d.id,
          label: d.driver_code,
          description: `${d.full_name}（${DRIVER_TYPE_LABELS[d.driver_type]}）`,
          group: DRIVER_TYPE_LABELS[d.driver_type]
        }))}
      />
      <ComboboxField
        label="操作类型"
        name="operation"
        defaultValue={defaultOperation}
        placeholder="请选择操作"
        clearable={false}
        searchable={false}
        onValueChange={setOperation}
        options={(Object.entries(OPERATION_META) as Array<[OperationType, (typeof OPERATION_META)[OperationType]]>).map(
          ([key, meta]) => ({ value: key, label: `${meta.label} · ${meta.desc}` })
        )}
      />
      <LocationPicker
        label="起点"
        name="from_location_id"
        locations={locations}
        defaultValue={defaultFromId}
        onValueChange={pickFrom}
      />
      <LocationPicker
        label="终点"
        name="to_location_id"
        locations={locations}
        defaultValue={defaultToId}
        onValueChange={pickTo}
      />
      <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        <NumberField
          label="里程（mi）"
          name="miles"
          min={0}
          step={0.1}
          value={milesValue}
          onValueChange={value => {
            setMilesValue(value);
            setManual(true);
          }}
        />
        <span className={cn("text-[11px] font-normal", phase === "failed" && "text-destructive")}>{hint}</span>
      </div>
      <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        <NumberField
          label="本趟工资（$）"
          name="pay_amount"
          min={0}
          step={0.01}
          value={payValue}
          onValueChange={setManualPay}
        />
        <span className="text-[11px] font-normal">
          {manualPay !== null ? (
            <>
              手动输入工资金额 ·{" "}
              <button type="button" className="linklike" onClick={() => setManualPay(null)}>
                按规则重算
              </button>
            </>
          ) : (
            "已按定价规则自动计算，可手动修改"
          )}
        </span>
      </div>
    </>
  );
}
