"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ComboboxField } from "@/components/combobox-field";
import { LocationPicker, type LocationOption } from "@/components/location-picker";
import { DateField, FormGrid } from "@/components/form-fields";
import { calcTripWage } from "@/lib/wage";
import { money, todayIso } from "@/lib/format";
import {
  DRIVER_TYPE_LABELS,
  OPERATION_META,
  type DriverType,
  type OperationType
} from "@/lib/labels";
import { addTripsBatch } from "./entry-actions";

type DriverOption = {
  id: string;
  driver_code: string;
  full_name: string;
  driver_type: DriverType;
};

/** One row's refilled input after a failed submit (?f_<i>_* params) */
export type RefillRow = {
  operation: string;
  from: string;
  to: string;
  load_no: string;
  miles: string;
  pay_amount: string;
  notes: string;
};

type TripEntryFormProps = {
  drivers: DriverOption[];
  locations: LocationOption[];
  defaultDriverId?: string;
  defaultDate?: string;
  /** Present when redirected back after a validation error */
  refillRows?: RefillRow[];
};

const INITIAL_ROWS = 3;

/** Bare input for table cells: no label, no border, inherits the roster rhythm */
const cellInput = "h-8 border-0 bg-transparent px-2 shadow-none rounded-none text-[13px] focus-visible:ring-1";
const cellHint = "block text-[10px] leading-tight font-normal text-muted-foreground";

type CalcStatus = "loading" | "auto" | "failed";

/**
 * One entry row: from/to pickers (creatable), operation, Load#, auto-measured
 * miles and rule-priced wage (both hand-editable; the wage sticks once edited,
 * miles re-measures on every endpoint re-pick - same semantics as the old
 * single-trip form). State lives per row instance; field names are positional
 * (row_<index>_) so deleting a middle row only shifts names, never values.
 */
function EntryRow({
  index,
  driverType,
  locations,
  defaults,
  removable,
  onRemove,
  onPayChange
}: {
  index: number;
  driverType: DriverType | undefined;
  locations: LocationOption[];
  defaults?: RefillRow;
  removable: boolean;
  onRemove: () => void;
  onPayChange: (value: string) => void;
}) {
  const prefix = `row_${index}_`;
  const [operation, setOperation] = React.useState(defaults?.operation || "DEL");
  const [fromValue, setFromValue] = React.useState(defaults?.from || "");
  const [toValue, setToValue] = React.useState(defaults?.to || "");
  const [milesValue, setMilesValue] = React.useState(defaults?.miles || "0");
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  // Ignore stale responses after a quick endpoint re-pick
  const requestId = React.useRef(0);

  // Sticky manual wage: null = auto-follow the rule; once set (hand edit or
  // error restore) basis changes never overwrite it - only "按规则重算" drops back
  const [manualPay, setManualPay] = React.useState<string | null>(defaults?.pay_amount || null);

  React.useEffect(() => {
    if (!fromValue || !toValue) return;
    const id = ++requestId.current;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/distance?from=${encodeURIComponent(fromValue)}&to=${encodeURIComponent(toValue)}`
        );
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
  }, [fromValue, toValue]);

  // Free-text endpoints never carry BASE pricing -> mileage tier, same as a
  // picked non-BASE location, so they resolve to null endpoints here
  const wageEndpoint = (value: string) =>
    locations.find(l => `loc:${l.id}` === value) ?? null;

  const autoPay = React.useMemo(
    () =>
      calcTripWage({
        driverType,
        operation: operation as OperationType | undefined,
        miles: Number(milesValue) || 0,
        from: wageEndpoint(fromValue),
        to: wageEndpoint(toValue)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driverType, operation, milesValue, fromValue, toValue, locations]
  );

  const payValue = manualPay ?? autoPay.toFixed(2);

  React.useEffect(() => {
    onPayChange(payValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payValue]);

  const phase = !fromValue || !toValue ? "idle" : status;
  const milesHint =
    phase === "loading"
      ? "测算中…"
      : manual
        ? "手动输入"
        : phase === "failed"
          ? "未能测算，请手动填写"
          : phase === "auto"
            ? "已测算，可修改"
            : "选好两端后自动测算";

  return (
    <tr>
      <td className="mono text-center text-muted-foreground">{index + 1}</td>
      <td className="w-44 min-w-40">
        <LocationPicker
          name={`${prefix}from_location`}
          locations={locations}
          creatable
          defaultValue={defaults?.from || ""}
          placeholder="起点"
          aria-label={`第 ${index + 1} 程起点`}
          triggerClassName="h-8 justify-start px-2 font-normal"
          onValueChange={setFromValue}
        />
      </td>
      <td className="w-44 min-w-40">
        <LocationPicker
          name={`${prefix}to_location`}
          locations={locations}
          creatable
          defaultValue={defaults?.to || ""}
          placeholder="终点"
          aria-label={`第 ${index + 1} 程终点`}
          triggerClassName="h-8 justify-start px-2 font-normal"
          onValueChange={setToValue}
        />
      </td>
      <td className="w-36 min-w-32">
        <ComboboxField
          name={`${prefix}operation`}
          defaultValue={defaults?.operation || "DEL"}
          clearable={false}
          searchable={false}
          aria-label={`第 ${index + 1} 程操作`}
          triggerClassName="h-8 justify-start px-2 font-normal"
          onValueChange={setOperation}
          options={(Object.entries(OPERATION_META) as Array<[OperationType, (typeof OPERATION_META)[OperationType]]>).map(
            ([key, meta]) => ({ value: key, label: meta.label, description: meta.desc })
          )}
        />
      </td>
      <td className="w-32 min-w-28">
        <Input
          name={`${prefix}load_no`}
          defaultValue={defaults?.load_no || ""}
          maxLength={64}
          placeholder="如 LD101"
          aria-label={`第 ${index + 1} 程 Load#`}
          className={`${cellInput} font-mono font-semibold`}
        />
      </td>
      <td className="w-24 min-w-24">
        <Input
          type="number"
          name={`${prefix}miles`}
          min={0}
          step={0.1}
          value={milesValue}
          onChange={e => {
            setMilesValue(e.target.value);
            setManual(true);
          }}
          aria-label={`第 ${index + 1} 程里程`}
          className={`${cellInput} text-right font-mono`}
        />
        <span className={`${cellHint} text-right ${phase === "failed" ? "text-destructive" : ""}`}>{milesHint}</span>
      </td>
      <td className="w-28 min-w-28">
        <Input
          type="number"
          name={`${prefix}pay_amount`}
          min={0}
          step={0.01}
          value={payValue}
          onChange={e => setManualPay(e.target.value)}
          aria-label={`第 ${index + 1} 程工资`}
          className={`${cellInput} text-right font-mono`}
        />
        <span className={`${cellHint} text-right`}>
          {manualPay !== null ? (
            <>
              手动 ·{" "}
              <button type="button" className="linklike" onClick={() => setManualPay(null)}>
                重算
              </button>
            </>
          ) : (
            "按规则计算"
          )}
        </span>
      </td>
      <td>
        <Input
          name={`${prefix}notes`}
          defaultValue={defaults?.notes || ""}
          placeholder="选填"
          aria-label={`第 ${index + 1} 程备注`}
          className={cellInput}
        />
      </td>
      <td className="actions">
        {removable && (
          <button type="button" className="linklike danger" onClick={onRemove}>
            删除
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Full trip-entry form: shared driver + date on top, then a spreadsheet-like
 * row table (one date can carry many legs). Submits everything to
 * addTripsBatch in one atomic multi-row INSERT.
 */
export function TripEntryForm({
  drivers,
  locations,
  defaultDriverId = "",
  defaultDate,
  refillRows
}: TripEntryFormProps) {
  const initialCount = refillRows?.length || INITIAL_ROWS;
  const [rows, setRows] = React.useState<number[]>(() =>
    Array.from({ length: initialCount }, (_, i) => i + 1)
  );
  // Stable row keys: never reused within a session even after deletions
  const [nextId, setNextId] = React.useState(initialCount + 1);
  const [driverId, setDriverId] = React.useState(defaultDriverId);
  // Row id -> current pay value, for the footer total
  const [pays, setPays] = React.useState<Record<number, string>>({});

  const driverType = drivers.find(d => d.id === driverId)?.driver_type;
  const totalPay = Object.values(pays).reduce((acc, v) => acc + (Number(v) || 0), 0);

  return (
    <form action={addTripsBatch} aria-label="录入行程">
      <div className="panel">
        <div className="panel-cap">选择司机与日期，一天可连录多段行程</div>
        <FormGrid className="pb-3.5">
          <ComboboxField
            label="司机 / 车主"
            name="driver_id"
            defaultValue={defaultDriverId}
            placeholder="请选择司机"
            searchPlaceholder="搜索车号或姓名"
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
          <DateField
            label="日期"
            name="trip_date"
            required
            defaultValue={defaultDate || todayIso()}
          />
        </FormGrid>

        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>起点</th><th>终点</th><th>操作</th>
                <th>Load#</th>
                <th className="num">里程 (mi)</th>
                <th className="num">本趟工资 ($)</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rowId, i) => (
                <EntryRow
                  key={rowId}
                  index={i}
                  driverType={driverType}
                  locations={locations}
                  defaults={refillRows?.[i]}
                  removable={rows.length > 1}
                  onRemove={() => setRows(current => current.filter(id => id !== rowId))}
                  onPayChange={value =>
                    setPays(current => ({ ...current, [rowId]: value }))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>

        <input type="hidden" name="row_count" value={rows.length} />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-8"
              onClick={() => {
                setRows(current => [...current, nextId]);
                setNextId(id => id + 1);
              }}
            >
              <PlusIcon className="size-4" />
              添加行程
            </Button>
            <span className="text-xs text-muted-foreground">
              共 {rows.length} 段 · 工资合计 <b className="font-mono">{money(totalPay)}</b>
            </span>
          </div>
          <Button type="submit" className="h-9 px-5">记入 {rows.length} 段行程</Button>
        </div>
      </div>
    </form>
  );
}
