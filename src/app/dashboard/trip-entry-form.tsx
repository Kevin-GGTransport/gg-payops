"use client";

import * as React from "react";
import { CameraIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PeriodPicker } from "@/components/period-picker";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { ComboboxField } from "@/components/combobox-field";
import { DateField } from "@/components/date-field";
import { LocationPicker, type LocationOption } from "@/components/location-picker";
import { calcTripWage, matchPackageRule, pickVersion, type WageRuleData } from "@/lib/wage";
import { money, todayIso } from "@/lib/format";
import { currentPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import {
  clearEntryDraft,
  collectDraftFromDOM,
  readEntryDraft,
  writeEntryDraft
} from "@/lib/entry-draft";
import {
  DRIVER_TYPE_LABELS,
  type DriverType,
  type OperationType
} from "@/lib/labels";
import { addTripsBatch } from "./entry-actions";
import { PhotoImport, type PhotoApply } from "./photo-import";

type DriverOption = {
  id: string;
  full_name: string;
  driver_type: DriverType;
  /** Owner-type driver billed at driver prices (pricing identity override) */
  price_as_driver: boolean;
};

type TruckOption = {
  id: string;
  truck_code: string;
  plate_no: string | null;
  truck_type: string | null;
};

/** One dictionary operation (from /dashboard/operations) */
export type OperationOption = {
  code: string;
  label: string;
  description: string | null;
  requires_load: boolean;
};

/** One row's initial values (photo import or failed-submit refill) */
export type RefillRow = {
  trip_date?: string;
  operation: string;
  from: string;
  to: string;
  load_no: string;
  miles: string;
  fuel_gallons?: string;
  pay_amount: string;
  notes: string;
};

/** One group's initial shape: one driver + one truck + its own rows */
export type RefillGroup = {
  driverId: string;
  truckId: string;
  rows: RefillRow[];
};

type TripEntryFormProps = {
  drivers: DriverOption[];
  trucks: TruckOption[];
  locations: LocationOption[];
  /** Operation dictionary (ACTIVE rows); the row dropdown reads it */
  operations: OperationOption[];
  /** Wage-rule versions (current + scheduled); each row prices by its own date */
  wageRules: WageRuleData[];
  defaultDriverId?: string;
  /** Present when redirected back after a validation error */
  refillGroups?: RefillGroup[];
  /** Tab to open first (0-based group index, restored from redirect params) */
  initialActiveIndex?: number;
  /** Pay-period start covering the sheet (a Saturday); defaults to this week */
  initialPeriodStart?: string;
};

const INITIAL_ROWS = 10;

/** Draft-restored groups take ids from here so they always mount fresh */
const DRAFT_GROUP_ID_BASE = 1_000;

/** Compact bordered input for table cells: standard shadcn Input at h-8 */
const cellInput = "h-8 px-2 text-[13px]";
const cellHint = "block text-[10px] leading-tight font-normal text-muted-foreground";

/**
 * Column layout of every group sheet, fed to the shared TanStack shell
 * (columns-only instance - the body rows are the form grid below). Defaults
 * sum past common laptop widths (~1080px), so narrow screens scroll the sheet
 * horizontally; widths persist per storageKey and reset on double-click.
 */
const SHEET_COLUMNS: ColumnDef<unknown, unknown>[] = [
  { id: "handle", header: "", size: 28, enableResizing: false, meta: { headerClass: "px-1" } },
  // Row ordinal = render index, so drag/delete/add renumber it for free
  { id: "seq", header: "序号", size: 48, enableResizing: false, meta: { headerClass: "ctr" } },
  { id: "trip_date", header: "日期", size: 132, minSize: 112 },
  { id: "from_location", header: "起点", size: 130, minSize: 100 },
  { id: "to_location", header: "终点", size: 130, minSize: 100 },
  { id: "operation", header: "操作", size: 72, minSize: 64 },
  { id: "load_no", header: "Load#", size: 90, minSize: 76 },
  { id: "miles", header: "里程 (mi)", size: 82, minSize: 72, meta: { headerClass: "num" } },
  { id: "fuel_gallons", header: "加油 (gal)", size: 78, minSize: 68, meta: { headerClass: "num" } },
  { id: "pay_amount", header: "本趟工资 ($)", size: 100, minSize: 92, meta: { headerClass: "num" } },
  { id: "notes", header: "备注", size: 182, minSize: 100 },
  { id: "delete", header: "操作", size: 40, enableResizing: false, meta: { headerClass: "px-1.5" } }
];

/** Columns-only instance has no rows; keep the reference stable across renders */
const NO_ROWS: unknown[] = [];

/** Weekday suffix of a day-separator band (same rendering as the payroll ledger) */
const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function dowOf(iso: string) {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

type CalcStatus = "loading" | "auto" | "failed";

/** Package pricing mode of one group sheet (per-leg default) */
type PkgUnit = "LEG" | "DAY" | "ROUND_TRIP";

/** One priced package planned from the sheet: legs share one amount */
type PkgPlan = { id: string; date: string; rowIds: number[]; unit: Exclude<PkgUnit, "LEG"> };

const PKG_UNIT_OPTIONS: ReadonlyArray<{ value: PkgUnit; label: string }> = [
  { value: "LEG", label: "按趟计价" },
  { value: "DAY", label: "按天打包" },
  { value: "ROUND_TRIP", label: "按往返打包" }
];

/**
 * Plan packages over a group's filled legs in sheet order: DAY groups every
 * leg of a date into one package; ROUND_TRIP splits the day's legs into
 * circuits that close by returning to the circuit's opening origin (an
 * unclosed tail stays per-leg). Undated legs never group.
 */
function planPackages(
  unit: Exclude<PkgUnit, "LEG">,
  slots: { id: number }[],
  dateByRow: Record<number, string>,
  fromByRow: Record<number, string>,
  toByRow: Record<number, string>
): PkgPlan[] {
  const byDate = new Map<string, number[]>();
  for (const slot of slots) {
    const to = toByRow[slot.id];
    const date = dateByRow[slot.id];
    if (!to || !date) continue;
    const list = byDate.get(date) ?? [];
    list.push(slot.id);
    byDate.set(date, list);
  }
  const plans: PkgPlan[] = [];
  for (const [date, ids] of byDate) {
    if (unit === "DAY") {
      plans.push({ id: `d-${date}`, date, rowIds: ids, unit });
      continue;
    }
    let i = 0;
    let seq = 0;
    while (i < ids.length) {
      const origin = fromByRow[ids[i]];
      if (!origin) {
        // No anchor to close on: this leg stays per-priced
        i++;
        continue;
      }
      let closedAt = -1;
      for (let j = i; j < ids.length; j++) {
        if (toByRow[ids[j]] === origin) {
          closedAt = j;
          break;
        }
      }
      if (closedAt < 0) break; // trailing legs never close: all per-priced
      plans.push({
        id: `r-${date}-${seq++}`,
        date,
        rowIds: ids.slice(i, closedAt + 1),
        unit
      });
      i = closedAt + 1;
    }
  }
  return plans;
}

/**
 * One entry row: per-row date, from/to pickers (creatable), operation, Load#,
 * auto-measured miles and rule-priced wage (both hand-editable; the wage
 * sticks once edited, miles re-measures on every endpoint re-pick). Field
 * names are positional (g_<group>_row_<index>_) so deleting a middle row only
 * shifts names, never values.
 *
 * Memoized: every tab's rows stay mounted (forceMount), so one keystroke in
 * one group must not reconcile every row of every group. All callbacks are
 * group-level and take the row id; GroupSection memoizes them.
 */
const EntryRow = React.memo(function EntryRow({
  rowId,
  groupIndex,
  rowIndex,
  driverId,
  driverType,
  priceAsDriver,
  locations,
  operations,
  wageRules,
  defaults,
  removable,
  carryFrom,
  carryDate,
  onRemove,
  /** Marks the sheet dirty + schedules a draft save; picker fields write their
   *  hidden inputs programmatically (no change event bubbles), so every
   *  non-typing value change must report through here */
  onDirty,
  onPayChange,
  onToChange,
  onFromChange,
  onDateChange,
  onFillChange,
  onArmDrag,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDrop,
  draggable,
  dropMark,
  packagePay,
  packageId,
  packageNote,
  isPackageCarrier
}: {
  /** Stable slot id (never the positional index) */
  rowId: number;
  groupIndex: number;
  rowIndex: number;
  /** Picked driver id; feeds driver-scoped price rules */
  driverId: string;
  driverType: DriverType | undefined;
  /** Owner flagged to bill at driver prices */
  priceAsDriver?: boolean;
  locations: LocationOption[];
  /** Operation dictionary; drives the dropdown and the Load# lock */
  operations: OperationOption[];
  /** Wage-rule versions; the row's own date picks the governing one */
  wageRules: WageRuleData[];
  defaults?: RefillRow;
  removable: boolean;
  /** Current to-value of the previous leg in this group ("" when none yet) */
  carryFrom: string;
  /** Current date of the previous leg ("" when none yet) - sticky follow */
  carryDate: string;
  onRemove: (rowId: number) => void;
  onDirty: () => void;
  onPayChange: (rowId: number, value: string) => void;
  /** Reports every endpoint pick upward (feeds the next leg's carry) */
  onToChange: (rowId: number, value: string) => void;
  /** Reports every start pick upward (package circuit detection) */
  onFromChange: (rowId: number, value: string) => void;
  /** Reports every date change upward (feeds the next leg's date carry) */
  onDateChange: (rowId: number, value: string) => void;
  /** Reports whether this row has any endpoint picked (filled-row counting) */
  onFillChange: (rowId: number, filled: boolean) => void;
  /** Grip press arms / releases whole-row native drag */
  onArmDrag: (rowId: number, armed: boolean) => void;
  onRowDragStart: (event: React.DragEvent<HTMLTableRowElement>, rowId: number) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (event: React.DragEvent<HTMLTableRowElement>, rowId: number) => void;
  onRowDrop: (event: React.DragEvent<HTMLTableRowElement>) => void;
  /** This row is the armed drag source */
  draggable: boolean;
  /** Insertion indicator while a sibling row hovers this one */
  dropMark: "before" | "after" | null;
  /** Package override: this row's wage comes from its package (not auto/manual) */
  packagePay?: string | null;
  /** Package membership marker stored on the trip */
  packageId?: string | null;
  /** Carrier-only display note (e.g. 往返打包 $200.00) */
  packageNote?: string | null;
  /** True when this row carries the package amount (others bill $0) */
  isPackageCarrier?: boolean;
}) {
  const prefix = `g_${groupIndex}_row_${rowIndex}_`;
  const legLabel = `第 ${groupIndex + 1} 组第 ${rowIndex + 1} 程`;
  // Controlled date: the wage rule is picked by the row's own date. No fixed
  // default - new rows open empty; the previous leg's date stickily carries
  // down while this row is untouched (one keystroke covers the whole sheet)
  const [dateValue, setDateValue] = React.useState(defaults?.trip_date || "");
  // Whether the current date came from carry-down, not the user's own edit
  const dateInherited = React.useRef(false);
  // Dictionary order decides the opening choice (seeds: DEL first)
  const defaultOperation = operations[0]?.code ?? "DEL";
  const [operation, setOperation] = React.useState(defaults?.operation || defaultOperation);
  // Container-less operations (requires_load=false) clear and lock Load#
  const operationRequiresLoad = (code: string) =>
    operations.find(o => o.code === code)?.requires_load ?? true;
  const [loadNoValue, setLoadNoValue] = React.useState(
    defaults?.operation && !operationRequiresLoad(defaults.operation) ? "" : defaults?.load_no || ""
  );
  const [fromValue, setFromValue] = React.useState(defaults?.from || "");
  const [toValue, setToValue] = React.useState(defaults?.to || "");
  // Whether the current from value came from carry-over, not the user's own
  // pick (refill/photo defaults count as manual - carry never overwrites them)
  const fromInherited = React.useRef(false);
  const [milesValue, setMilesValue] = React.useState(defaults?.miles || "0");
  // Fuel-up log (US gallons): optional ledger field, never priced - most legs
  // stay empty and submit as 0
  const [fuelValue, setFuelValue] = React.useState(defaults?.fuel_gallons || "");
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  // Ignore stale responses after a quick endpoint re-pick
  const requestId = React.useRef(0);

  // Sticky manual wage: null = auto-follow the rule; once set (hand edit or
  // error restore) basis changes never overwrite it - only "按规则重算" drops back
  const [manualPay, setManualPay] = React.useState<string | null>(defaults?.pay_amount || null);

  // Carry-over start (sticky follow): the previous leg's endpoint fills this
  // leg's start while it is empty or still carry-inherited - a hand-picked
  // start sticks forever, an empty carry never clears what's already there
  React.useEffect(() => {
    if (!carryFrom) return;
    if (fromInherited.current || fromValue === "") {
      fromInherited.current = true;
      setFromValue(carryFrom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carryFrom]);

  // Report the initial (refill/photo) endpoint once so the next leg can carry it
  React.useEffect(() => {
    if (toValue) onToChange(rowId, toValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Date carry-down (sticky follow): while this row's date is empty or still
  // carry-inherited, the previous leg's date fills it - a hand edit sticks
  React.useEffect(() => {
    if (!carryDate) return;
    if (dateInherited.current || dateValue === "") {
      dateInherited.current = true;
      setDateValue(carryDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carryDate]);

  // Report the initial (refill/photo) date once so the next leg can carry it
  React.useEffect(() => {
    if (dateValue) onDateChange(rowId, dateValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the group's date map current (carry source + wage-rule recompute)
  React.useEffect(() => {
    onDateChange(rowId, dateValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateValue]);

  // Filled = has a destination. A start alone can be the sticky carry-over
  // from the previous leg, which must not turn a reserve row "filled"
  React.useEffect(() => {
    onFillChange(rowId, Boolean(toValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toValue]);

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
          // Measured miles land after the debounce that saved the pick itself -
          // persist them so a refresh mid-measure restores the measured value
          onDirty();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDirty is a stable parent callback (useCallback)
  }, [fromValue, toValue]);

  // Free-text endpoints match no price rule (no location id) -> mileage tier
  const wageEndpoint = (value: string) =>
    locations.find(l => `loc:${l.id}` === value) ?? null;

  // Rule price follows the row's own date (future versions price future rows)
  const rule = pickVersion(wageRules, dateValue);
  const autoPay = React.useMemo(
    () =>
      rule
        ? calcTripWage({
            driverId,
            driverType,
            priceAsDriver,
            operation: operation as OperationType | undefined,
            miles: Number(milesValue) || 0,
            from: wageEndpoint(fromValue),
            to: wageEndpoint(toValue),
            rule
          })
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driverId, driverType, priceAsDriver, operation, milesValue, fromValue, toValue, locations, rule]
  );

  // Package override wins over auto/manual: the strip above the sheet is the
  // single source of the package amount; packaged cells are read-only
  const packaged = packagePay !== undefined && packagePay !== null;
  const payValue = packaged ? packagePay : (manualPay ?? autoPay.toFixed(2));

  React.useEffect(() => {
    onPayChange(rowId, payValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payValue]);

  const phase = !fromValue || !toValue ? "idle" : status;
  // Quiet by default: the hint only appears when it carries real state -
  // measuring, hand-edited, or failed. Idle rows stay visually silent.
  const milesHint =
    phase === "loading"
      ? "测算中…"
      : manual
        ? "手动输入"
        : phase === "failed"
          ? "未能测算，请手填"
          : "";

  return (
    <tr
      draggable={draggable}
      onDragStart={event => onRowDragStart(event, rowId)}
      onDragEnd={onRowDragEnd}
      onDragOver={event => onRowDragOver(event, rowId)}
      onDrop={onRowDrop}
      className={`${draggable ? "row-dragging" : ""}${dropMark ? ` drop-${dropMark}` : ""}`}
    >
      <td className="ctr px-1">
        <span
          className="drag-handle"
          aria-label={`拖拽调整${legLabel}顺序`}
          onPointerDown={() => onArmDrag(rowId, true)}
          onPointerUp={() => onArmDrag(rowId, false)}
          onPointerCancel={() => onArmDrag(rowId, false)}
        >
          <GripVerticalIcon className="size-3.5" />
        </span>
      </td>
      <td className="ctr px-1.5 font-mono text-[12px] tabular-nums text-muted-foreground">
        {rowIndex + 1}
      </td>
      <td className="px-1.5">
        <DateField
          name={`${prefix}trip_date`}
          value={dateValue}
          onValueChange={value => {
            dateInherited.current = false;
            setDateValue(value);
            onDirty();
          }}
          aria-label={`${legLabel}日期`}
          size="sm"
        />
      </td>
      <td className="px-1.5">
        <LocationPicker
          name={`${prefix}from_location`}
          locations={locations}
          creatable
          value={fromValue}
          placeholder="起点"
          aria-label={`${legLabel}起点`}
          triggerClassName="h-8"
          onValueChange={value => {
            fromInherited.current = false;
            setFromValue(value);
            onFromChange(rowId, value);
            onDirty();
          }}
        />
      </td>
      <td className="px-1.5">
        <LocationPicker
          name={`${prefix}to_location`}
          locations={locations}
          creatable
          defaultValue={defaults?.to || ""}
          placeholder="终点"
          aria-label={`${legLabel}终点`}
          triggerClassName="h-8"
          onValueChange={value => {
            setToValue(value);
            onToChange(rowId, value);
            onDirty();
          }}
        />
      </td>
      <td className="px-1.5">
        <ComboboxField
          name={`${prefix}operation`}
          defaultValue={defaults?.operation || defaultOperation}
          clearable={false}
          searchable={false}
          aria-label={`${legLabel}操作`}
          triggerClassName="h-8"
          onValueChange={value => {
            setOperation(value);
            if (!operationRequiresLoad(value)) setLoadNoValue("");
            onDirty();
          }}
          // Code-only labels keep the trigger narrow in the table row
          options={operations.map(op => ({
            value: op.code,
            label: op.code
          }))}
        />
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}load_no`}
          value={loadNoValue}
          onChange={e => setLoadNoValue(e.target.value)}
          disabled={!operationRequiresLoad(operation)}
          maxLength={64}
          placeholder={operationRequiresLoad(operation) ? "如 LD101" : "该操作免填"}
          aria-label={`${legLabel}Load#`}
          className={`${cellInput} font-mono font-semibold`}
        />
      </td>
      <td className="px-1.5">
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
          aria-label={`${legLabel}里程`}
          className={`${cellInput} text-right font-mono`}
        />
        {milesHint && (
          <span className={`${cellHint} text-right ${phase === "failed" ? "text-destructive" : ""}`}>
            {milesHint}
          </span>
        )}
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}fuel_gallons`}
          min={0}
          step={0.1}
          value={fuelValue}
          onChange={e => setFuelValue(e.target.value)}
          placeholder="—"
          aria-label={`${legLabel}加油量`}
          className={`${cellInput} text-right font-mono`}
        />
      </td>
      <td className="px-1.5">
        {packageId && (
          <input type="hidden" name={`${prefix}package_id`} value={packageId} />
        )}
        {packageId && packageNote && (
          <input type="hidden" name={`${prefix}package_note`} value={packageNote} />
        )}
        <Input
          type="number"
          name={`${prefix}pay_amount`}
          min={0}
          step={0.01}
          value={payValue}
          readOnly={packaged}
          onChange={e => setManualPay(e.target.value)}
          aria-label={`${legLabel}工资`}
          className={`${cellInput} text-right font-mono`}
        />
        {packaged && (
          <span className={`${cellHint} text-right`}>
            {isPackageCarrier ? "打包价 · 上方计价条改" : "打包内 · $0"}
          </span>
        )}
        {!packaged && manualPay !== null && (
          // data-manual-pay: the draft collector keeps hand-edited wages as
          // manual on restore; auto-priced rows restore empty and recalc
          <span data-manual-pay className={`${cellHint} text-right`}>
            手动 ·{" "}
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setManualPay(null);
                onDirty();
              }}
            >
              重算
            </button>
          </span>
        )}
        {dateValue && !rule && manualPay === null && !packaged && (
          <span className={`${cellHint} text-right`}>该日期无生效规则</span>
        )}
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}notes`}
          defaultValue={defaults?.notes || ""}
          placeholder="选填"
          aria-label={`${legLabel}备注`}
          className={cellInput}
        />
      </td>
      <td className="actions px-1.5">
        {removable && (
          <button type="button" className="linklike danger" onClick={() => onRemove(rowId)}>
            删除
          </button>
        )}
      </td>
    </tr>
  );
});

/** A row slot: stable id (React key, never reused) plus its one-shot defaults */
type RowSlot = { id: number; defaults?: RefillRow };

/** A group slot: stable id + one-shot initial driver/truck/rows */
type GroupSlot = { id: number; driverId: string; truckId: string; rows: RowSlot[] };

/**
 * One driver group as a tab panel: a navy-ruled driver band (driver/truck
 * pickers, filled count, group pay, remove-group), the group's own sheet
 * table (day-separator bands between dates) and an add-row bar under the
 * sheet. Row/driver/date state lives here once mounted; the parent only
 * tracks group existence, row counts and pay totals.
 *
 * Memoized: with every tab force-mounted, a keystroke elsewhere (parent pays /
 * activeId update) must not reconcile this group's rows. All prop callbacks
 * are group-level and stable; per-row handlers below are memoized on top.
 */
const GroupSection = React.memo(function GroupSection({
  index,
  group,
  drivers,
  trucks,
  locations,
  operations,
  wageRules,
  sheetTable,
  removable,
  onRemove,
  onDriverChange,
  onPayChange,
  onForgetRow,
  onFilledChange,
  onDirty,
  dragging,
  onDraggingChange,
  paySum
}: {
  index: number;
  group: GroupSlot;
  drivers: DriverOption[];
  trucks: TruckOption[];
  locations: LocationOption[];
  operations: OperationOption[];
  wageRules: WageRuleData[];
  /** Shared columns-only TanStack instance (thead + colgroup for this sheet) */
  sheetTable: TanstackTable<unknown>;
  removable: boolean;
  onRemove: (groupId: number) => void;
  /** Reports the picked driver upward (feeds the tab label) */
  onDriverChange: (groupId: number, driverId: string) => void;
  onPayChange: (groupId: number, rowId: number, value: string) => void;
  onForgetRow: (groupId: number, rowId: number) => void;
  onFilledChange: (groupId: number, count: number) => void;
  onDirty: () => void;
  /** Live drag source shared across groups (a group only accepts its own) */
  dragging: { groupId: number; rowId: number } | null;
  onDraggingChange: (source: { groupId: number; rowId: number } | null) => void;
  paySum: number;
}) {
  const [driverId, setDriverId] = React.useState(group.driverId);
  const [rows, setRows] = React.useState<RowSlot[]>(group.rows);
  const [nextRowId, setNextRowId] = React.useState(
    group.rows.reduce((max, r) => Math.max(max, r.id), 0) + 1
  );
  // rowId -> current to-value, feeding the next leg's carry-over start
  const [toByRow, setToByRow] = React.useState<Record<number, string>>({});
  // rowId -> current from-value, anchoring package circuit detection
  const [fromByRow, setFromByRow] = React.useState<Record<number, string>>({});
  // rowId -> current date, feeding the next leg's date carry-down
  const [dateByRow, setDateByRow] = React.useState<Record<number, string>>({});
  // Package pricing mode of this sheet (per-leg default); pkgAmounts holds
  // only the clerk's manual overrides keyed by package id - a package without
  // an override prices at its rule suggestion (derived during render, no
  // effect needed)
  const [pkgUnit, setPkgUnit] = React.useState<PkgUnit>("LEG");
  const [pkgAmounts, setPkgAmounts] = React.useState<Record<string, string>>({});
  // Row ids that have at least one endpoint (what the buttons count)
  const [filledIds, setFilledIds] = React.useState<Set<number>>(new Set());
  // Grip pressed but drag not confirmed yet; only that row turns draggable
  const [armedRow, setArmedRow] = React.useState<number | null>(null);
  // Insertion point while a same-group drag hovers this sheet
  const [dropAt, setDropAt] = React.useState<{ id: number; before: boolean } | null>(null);
  const dragActive = dragging?.groupId === group.id;
  const driverRecord = drivers.find(d => d.id === driverId);
  const driverType = driverRecord?.driver_type;
  // Pricing identity: an owner flagged price_as_driver bills as a driver
  const priceAsDriver = driverRecord?.price_as_driver ?? false;

  // Planned packages follow the sheet live (endpoints/dates/rows/mode)
  const plans = React.useMemo(
    () =>
      pkgUnit === "LEG"
        ? []
        : planPackages(pkgUnit, rows, dateByRow, fromByRow, toByRow),
    [pkgUnit, rows, dateByRow, fromByRow, toByRow]
  );

  // Rule suggestion per package: driver-scoped beats global, the package's
  // own date picks the governing version (OWNER: owner column, else driver
  // price x owner multiplier)
  const suggestionByPkg = React.useMemo(() => {
    const map: Record<string, { amount: string; label: string } | null> = {};
    for (const plan of plans) {
      const rule = pickVersion(wageRules, plan.date);
      const match = rule ? matchPackageRule(plan.unit, driverId, rule.price_rules) : null;
      if (!rule || !match) {
        map[plan.id] = null;
        continue;
      }
      const amount =
        driverType === "OWNER" && !priceAsDriver
          ? (match.owner_amount ?? match.driver_amount * rule.owner_multiplier)
          : match.driver_amount;
      map[plan.id] = { amount: amount.toFixed(2), label: match.label ?? "" };
    }
    return map;
  }, [plans, wageRules, driverId, driverType, priceAsDriver]);

  /** Effective amount of a package: manual override, else rule suggestion */
  const amountOf = React.useCallback(
    (planId: string) =>
      planId in pkgAmounts
        ? pkgAmounts[planId]
        : (suggestionByPkg[planId]?.amount ?? ""),
    [pkgAmounts, suggestionByPkg]
  );

  /** Apply (or re-apply) the rule suggestion to one package */
  const applySuggestion = React.useCallback(
    (planId: string) => {
      const amount = suggestionByPkg[planId]?.amount;
      if (amount === undefined) return;
      setPkgAmounts(current => ({ ...current, [planId]: amount }));
      onDirty();
    },
    [suggestionByPkg, onDirty]
  );

  // Per-row package view: rowId -> { pay, carrier } for packaged legs
  const pkgByRow = React.useMemo(() => {
    const map: Record<
      number,
      { pay: string; carrier: boolean; id: string; note: string | null }
    > = {};
    for (const plan of plans) {
      const amount = amountOf(plan.id).trim();
      const note =
        plan.unit === "DAY" ? `日打包 $${amount}` : `往返打包 $${amount}`;
      plan.rowIds.forEach((rowId, i) => {
        const carrier = i === 0;
        map[rowId] = {
          pay: carrier ? amount : "0.00",
          carrier,
          id: `g${group.id}-${plan.id}`,
          note: carrier ? note : null
        };
      });
    }
    return map;
  }, [plans, amountOf, group.id]);

  // Stable per-group reporters (kept out of render so EntryRow memo holds)
  const reportFilled = React.useCallback(
    (count: number) => onFilledChange(group.id, count),
    [group.id, onFilledChange]
  );
  const reportDriver = React.useCallback(
    (driverId: string) => onDriverChange(group.id, driverId),
    [group.id, onDriverChange]
  );

  React.useEffect(() => {
    reportFilled(filledIds.size);
  }, [filledIds.size, reportFilled]);

  const handleFill = React.useCallback((rowId: number, filled: boolean) => {
    setFilledIds(current => {
      if (current.has(rowId) === filled) return current;
      const next = new Set(current);
      if (filled) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);

  // Lift the picked driver so the parent can label this group's tab
  React.useEffect(() => {
    reportDriver(driverId);
  }, [driverId, reportDriver]);

  function addRow() {
    onDirty();
    setRows(current => [...current, { id: nextRowId }]);
    setNextRowId(id => id + 1);
  }

  const removeRowById = React.useCallback(
    (rowId: number) => {
      onDirty();
      onForgetRow(group.id, rowId);
      setFilledIds(current => {
        if (!current.has(rowId)) return current;
        const next = new Set(current);
        next.delete(rowId);
        return next;
      });
      setRows(current => current.filter(r => r.id !== rowId));
      setToByRow(current => {
        if (!(rowId in current)) return current;
        const next = { ...current };
        delete next[rowId];
        return next;
      });
      setDateByRow(current => {
        if (!(rowId in current)) return current;
        const next = { ...current };
        delete next[rowId];
        return next;
      });
    },
    [group.id, onDirty, onForgetRow]
  );

  /** Reorder rows inside this group; stable slot ids travel with their values */
  const moveRow = React.useCallback(
    (fromId: number, toId: number, before: boolean) => {
      setRows(current => {
        const from = current.findIndex(r => r.id === fromId);
        const to = current.findIndex(r => r.id === toId);
        if (from < 0 || to < 0 || from === to) return current;
        const next = [...current];
        const [moved] = next.splice(from, 1);
        const insertAt = next.findIndex(r => r.id === toId) + (before ? 0 : 1);
        next.splice(insertAt, 0, moved);
        return next;
      });
      onDirty();
    },
    [onDirty]
  );

  const endDrag = React.useCallback(() => {
    setArmedRow(null);
    setDropAt(null);
    onDraggingChange(null);
  }, [onDraggingChange]);

  const handleToChange = React.useCallback((rowId: number, value: string) => {
    setToByRow(current =>
      current[rowId] === value ? current : { ...current, [rowId]: value }
    );
  }, []);

  const handleFromChange = React.useCallback((rowId: number, value: string) => {
    setFromByRow(current =>
      current[rowId] === value ? current : { ...current, [rowId]: value }
    );
  }, []);

  const handleDateChange = React.useCallback((rowId: number, value: string) => {
    setDateByRow(current =>
      current[rowId] === value ? current : { ...current, [rowId]: value }
    );
  }, []);

  const handleRowPayChange = React.useCallback(
    (rowId: number, value: string) => onPayChange(group.id, rowId, value),
    [group.id, onPayChange]
  );

  const armDrag = React.useCallback((rowId: number, armed: boolean) => {
    setArmedRow(armed ? rowId : null);
  }, []);

  const dragStart = React.useCallback(
    (event: React.DragEvent<HTMLTableRowElement>, rowId: number) => {
      event.dataTransfer.effectAllowed = "move";
      // Firefox only fires dragover when the drag carries some payload
      event.dataTransfer.setData("text/plain", String(rowId));
      onDraggingChange({ groupId: group.id, rowId });
    },
    [group.id, onDraggingChange]
  );

  const dragOver = React.useCallback(
    (event: React.DragEvent<HTMLTableRowElement>, rowId: number) => {
      // Same-group reorder only: a foreign group's drag keeps the no-drop cursor
      if (!dragActive) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      setDropAt(current =>
        current?.id === rowId && current.before === before
          ? current
          : { id: rowId, before }
      );
    },
    [dragActive]
  );

  const drop = React.useCallback(
    (event: React.DragEvent<HTMLTableRowElement>) => {
      event.preventDefault();
      if (dragging && dropAt) moveRow(dragging.rowId, dropAt.id, dropAt.before);
      endDrag();
    },
    [dragging, dropAt, moveRow, endDrag]
  );

  const prefix = `g_${index}`;

  return (
    <div>
      {/* Driver band: navy top rule opens one group. The tab above already
          names the group (车号) - no duplicated ordinal badge here. Rows carry
          their own dates (no group default), so the band is pickers + totals;
          adding rows lives on the bar under the sheet. */}
      <div className="group-band items-start">
        <ComboboxField
          label="司机 / 车主"
          name={`${prefix}_driver_id`}
          defaultValue={group.driverId}
          placeholder="请选择司机"
          searchPlaceholder="搜索姓名"
          prominent
          clearable={false}
          className="w-56"
          triggerClassName="h-10"
          onValueChange={value => {
            setDriverId(value);
            onDirty();
          }}
          options={drivers.map(d => ({
            value: d.id,
            label: d.full_name,
            description: DRIVER_TYPE_LABELS[d.driver_type],
            group: DRIVER_TYPE_LABELS[d.driver_type]
          }))}
        />
        <ComboboxField
          label="车号"
          name={`${prefix}_truck_id`}
          defaultValue={group.truckId}
          placeholder="请选择车号"
          searchPlaceholder="搜索车号"
          mono
          clearable={false}
          className="w-44"
          triggerClassName="h-10"
          onValueChange={() => onDirty()}
          options={trucks.map(t => ({
            value: t.id,
            label: t.truck_code,
            description: [t.plate_no, t.truck_type].filter(Boolean).join(" · ") || undefined
          }))}
        />
        <div className="ml-auto grid content-start justify-end gap-1.5 text-right text-xs">
          <span className="font-medium text-muted-foreground">本组已填 {filledIds.size} 行</span>
          <span className="flex items-center justify-end gap-2.5">
            <span className="font-mono text-[13px] text-foreground">{money(paySum)}</span>
            {removable && (
              <button type="button" className="linklike danger" onClick={() => onRemove(group.id)}>
                删除组
              </button>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${prefix}-pkg-unit`} className="text-xs font-medium text-muted-foreground">
            计价
          </label>
          <select
            id={`${prefix}-pkg-unit`}
            value={pkgUnit}
            onChange={e => {
              setPkgUnit(e.target.value as PkgUnit);
              onDirty();
            }}
            aria-label={`第 ${index + 1} 组计价方式`}
            className="h-10 rounded-md border border-line bg-transparent px-2.5 text-[13px] focus-visible:ring-1"
          >
            {PKG_UNIT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name={`${prefix}_row_count`} value={rows.length} />
      </div>

      {pkgUnit !== "LEG" && (
        <div className="pkg-strip">
          {plans.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              选好日期和起终点后，{pkgUnit === "DAY" ? "同一天" : "每个往返圈"}自动合成一个打包价；未闭合的散腿仍按趟计价。
            </p>
          ) : (
            plans.map(plan => {
              const amount = amountOf(plan.id);
              const suggestion = suggestionByPkg[plan.id];
              return (
                <div key={plan.id} className="pkg-line">
                  <span className="mono text-xs">{plan.date.slice(5).replace("-", "/")}</span>
                  <span className="text-xs text-muted-foreground">
                    {plan.unit === "DAY" ? "全天" : "往返"} · {plan.rowIds.length} 程
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={amount}
                    placeholder="金额"
                    onChange={e => {
                      setPkgAmounts(current => ({ ...current, [plan.id]: e.target.value }));
                      onDirty();
                    }}
                    aria-label={`${plan.date} 打包金额`}
                    className="h-8 w-28 text-right font-mono text-[13px]"
                  />
                  {amount === "" && (
                    <span className="text-[11px] font-medium text-destructive">未填金额，提交按 $0</span>
                  )}
                  {suggestion && (
                    <span className="text-[11px] text-muted-foreground">
                      {suggestion.label ? `${suggestion.label} · ` : ""}规则 $
                      {suggestion.amount}
                      {amount !== suggestion.amount && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => applySuggestion(plan.id)}
                          >
                            套用
                          </button>
                        </>
                      )}
                    </span>
                  )}
                  {!suggestion && (
                    <span className="text-[11px] text-muted-foreground">无匹配规则，手填</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <RosterTable table={sheetTable}>
        <tbody
          className="tb-group"
          onDragLeave={event => {
            // Drag left this sheet entirely (moving between our own rows doesn't)
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropAt(null);
            }
          }}
        >
            {rows.map((slot, i) => {
              // Day separator band: whenever this row's date differs from the
              // row above (a sheet's first dated row included), a full-width
              // band names the day so multi-day sheets read in blocks
              const date = dateByRow[slot.id] ?? "";
              const prevDate = i > 0 ? (dateByRow[rows[i - 1].id] ?? "") : "";
              const dayStart = date && date !== prevDate ? date : null;
              return (
                <React.Fragment key={slot.id}>
                  {dayStart && (
                    <tr className="day-sep">
                      <td colSpan={SHEET_COLUMNS.length}>
                        {dayStart.slice(5).replace("-", "/")} · 周{dowOf(dayStart)}
                      </td>
                    </tr>
                  )}
                  <EntryRow
                    rowId={slot.id}
                    groupIndex={index}
                    rowIndex={i}
                    driverId={driverId}
                    driverType={driverType}
                    priceAsDriver={priceAsDriver}
                    locations={locations}
                    operations={operations}
                    wageRules={wageRules}
                    defaults={slot.defaults}
                    removable={rows.length > 1}
                    carryFrom={i === 0 ? "" : (toByRow[rows[i - 1].id] ?? "")}
                    carryDate={i === 0 ? "" : (dateByRow[rows[i - 1].id] ?? "")}
                    onRemove={removeRowById}
                    onDirty={onDirty}
                    onPayChange={handleRowPayChange}
                    onToChange={handleToChange}
                    onFromChange={handleFromChange}
                    onDateChange={handleDateChange}
                    onFillChange={handleFill}
                    draggable={armedRow === slot.id}
                    dropMark={dropAt?.id === slot.id ? (dropAt.before ? "before" : "after") : null}
                    packagePay={pkgByRow[slot.id]?.pay ?? null}
                    packageId={pkgByRow[slot.id]?.id ?? null}
                    packageNote={pkgByRow[slot.id]?.note ?? null}
                    isPackageCarrier={pkgByRow[slot.id]?.carrier ?? false}
                    onArmDrag={armDrag}
                    onRowDragStart={dragStart}
                    onRowDragEnd={endDrag}
                    onRowDragOver={dragOver}
                    onRowDrop={drop}
                  />
                </React.Fragment>
              );
            })}
        </tbody>
      </RosterTable>

      {/* Add-row bar sits under the sheet: finishing the last row, the clerk
          continues right there - no scrolling back to the top band */}
      <button type="button" className="add-row-bar" onClick={addRow}>
        <PlusIcon className="size-3.5" />
        添加行程
      </button>
    </div>
  );
});

/**
 * Full trip-entry form: one tab per driver group, each tab a complete entry
 * sheet (driver band + spreadsheet table + its own submit button) whose rows
 * carry their own dates (a recognized sheet is one driver, many days). The
 * bottom bar submits every tab to addTripsBatch in one atomic multi-row
 * INSERT; a tab's own button names its group so only that one is persisted.
 */
export function TripEntryForm({
  drivers,
  trucks,
  locations,
  operations,
  wageRules,
  defaultDriverId = "",
  refillGroups,
  initialActiveIndex,
  initialPeriodStart
}: TripEntryFormProps) {
  const [photoOpen, setPhotoOpen] = React.useState(false);
  // Sheet cover: the pay period this batch belongs to - context display only
  // (rows carry their own dates, nothing defaults from the period anymore)
  const [periodStart, setPeriodStart] = React.useState(
    initialPeriodStart && /^\d{4}-\d{2}-\d{2}$/.test(initialPeriodStart)
      ? periodOf(initialPeriodStart).start
      : currentPeriod().start
  );
  // One columns-only instance shared by every tab's sheet (synced column widths)
  const sheetTable = useRosterTable({
    data: NO_ROWS,
    columns: SHEET_COLUMNS,
    storageKey: "payops.entry.sheet.cols"
  });
  const initialGroups: GroupSlot[] = refillGroups
    ? refillGroups.map((g, i) => ({
        id: i + 1,
        driverId: g.driverId,
        truckId: g.truckId,
        rows: g.rows.map((row, j) => ({ id: j + 1, defaults: row }))
      }))
    : [
        {
          id: 1,
          driverId: defaultDriverId,
          truckId: "",
          rows: Array.from({ length: INITIAL_ROWS }, (_, i) => ({ id: i + 1 }))
        }
      ];
  const [groups, setGroups] = React.useState<GroupSlot[]>(initialGroups);
  const nextGroupId = React.useRef(initialGroups.length + 1);
  // groupId -> picked driver id (tab labels follow the picked 车号)
  const [driverByGroup, setDriverByGroup] = React.useState<Record<number, string>>(() =>
    Object.fromEntries(initialGroups.map(g => [g.id, g.driverId]))
  );
  // Open tab as a group id string (Radix tab values are strings)
  const [activeId, setActiveId] = React.useState(() =>
    String(
      initialGroups[
        Math.min(Math.max(initialActiveIndex ?? 0, 0), initialGroups.length - 1)
      ].id
    )
  );
  /** Restore banner copy; null = fresh form, nothing to announce */
  const [restoredFrom, setRestoredFrom] = React.useState<{
    groups: number;
    filled: number;
  } | null>(null);
  // "<groupId>:<rowId>" -> current pay value, for per-group and grand totals
  const [pays, setPays] = React.useState<Record<string, string>>({});
  // groupId -> filled-row count (rows with at least one endpoint; reserve
  // rows are skipped by the server and stay out of every count)
  const [filledCounts, setFilledCounts] = React.useState<Record<number, number>>({});
  // Live drag source across groups (groupId gates which sheet accepts the drop)
  const [dragging, setDragging] = React.useState<{ groupId: number; rowId: number } | null>(null);
  // Whether the user has changed anything (guards photo-import replacement)
  const dirtyRef = React.useRef(false);

  const totalRows = Object.values(filledCounts).reduce((acc, n) => acc + n, 0);
  const totalPay = Object.values(pays).reduce((acc, v) => acc + (Number(v) || 0), 0);

  const handlePayChange = React.useCallback((groupId: number, rowId: number, value: string) => {
    setPays(current => {
      const key = `${groupId}:${rowId}`;
      // Same value -> skip re-render churn from many rows
      if (current[key] === value) return current;
      return { ...current, [key]: value };
    });
  }, []);

  const handleForgetRow = React.useCallback((groupId: number, rowId: number) => {
    setPays(current => {
      const key = `${groupId}:${rowId}`;
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const handleFilledChange = React.useCallback((groupId: number, count: number) => {
    setFilledCounts(current =>
      current[groupId] === count ? current : { ...current, [groupId]: count }
    );
  }, []);

  // Latest groups / activeId behind refs so the callbacks below stay stable
  // (a new identity would defeat GroupSection's memo on every tab switch)
  const groupsRef = React.useRef(groups);
  const activeIdRef = React.useRef(activeId);
  React.useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  React.useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  /* --- Draft autosave: debounce-serialize the form DOM into localStorage --- */
  const formRef = React.useRef<HTMLFormElement>(null);
  const periodStartRef = React.useRef(periodStart);
  React.useEffect(() => {
    periodStartRef.current = periodStart;
  }, [periodStart]);
  const saveTimer = React.useRef<number | undefined>(undefined);
  const scheduleSave = React.useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const activeIndex = groupsRef.current.findIndex(g => String(g.id) === activeIdRef.current);
      writeEntryDraft(
        collectDraftFromDOM(form, {
          activeIndex: activeIndex < 0 ? 0 : activeIndex,
          periodStart: periodStartRef.current
        })
      );
    }, 600);
  }, []);

  /** Dirty mark + draft save; every structural mutation routes through here */
  const handleDirty = React.useCallback(() => {
    dirtyRef.current = true;
    scheduleSave();
  }, [scheduleSave]);

  /**
   * Draft restore, post-mount: reading localStorage during the first render
   * would mismatch the SSR html (hydration error), so the sheet starts blank
   * and swaps to the draft here. Server refill params win - a submit clears
   * the draft, so both only coexist when the URL was opened stale. Restored
   * groups get fresh high ids so every GroupSection mounts new (their row
   * defaults are one-shot state that a reused instance would ignore).
   */
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot client-only restore; reading localStorage during render would mismatch SSR html */
  React.useEffect(() => {
    if (refillGroups) return;
    const draft = readEntryDraft();
    if (!draft) return;
    const restored: GroupSlot[] = draft.groups.map((g, i) => ({
      id: DRAFT_GROUP_ID_BASE + i + 1,
      driverId: g.driverId,
      truckId: g.truckId,
      rows: g.rows.map((row, j) => ({ id: j + 1, defaults: row }))
    }));
    setGroups(restored);
    nextGroupId.current = DRAFT_GROUP_ID_BASE + restored.length + 1;
    setDriverByGroup(Object.fromEntries(restored.map(g => [g.id, g.driverId])));
    setFilledCounts({});
    setPays({});
    setActiveId(String(restored[Math.min(draft.activeIndex, restored.length - 1)].id));
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.periodStart)) setPeriodStart(draft.periodStart);
    dirtyRef.current = true;
    setRestoredFrom({
      groups: draft.groups.length,
      filled: draft.groups.reduce((acc, g) => acc + g.rows.filter(r => r.to).length, 0)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Drop the stored draft and reset to a blank sheet (both clear affordances) */
  function discardDraft() {
    window.clearTimeout(saveTimer.current);
    clearEntryDraft();
    window.location.reload();
  }

  /** Period picks are pure button/popover state (no change event) - route them
   *  through the draft save so the cover restores with the sheet */
  function changePeriod(next: string) {
    handleDirty();
    setPeriodStart(next);
  }

  const removeGroup = React.useCallback((id: number) => {
    dirtyRef.current = true;
    const index = groupsRef.current.findIndex(g => g.id === id);
    const remaining = groupsRef.current.filter(g => g.id !== id);
    setGroups(remaining);
    // Closing the open tab focuses its former neighbor
    if (activeIdRef.current === String(id)) {
      const neighbor = remaining[Math.min(index, remaining.length - 1)];
      if (neighbor) setActiveId(String(neighbor.id));
    }
    setDriverByGroup(current => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setFilledCounts(current => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPays(current => {
      const prefix = `${id}:`;
      const keys = Object.keys(current);
      if (!keys.some(k => k.startsWith(prefix))) return current;
      return Object.fromEntries(keys.filter(k => !k.startsWith(prefix)).map(k => [k, current[k]]));
    });
    scheduleSave();
  }, [scheduleSave]);

  const handleGroupDriverChange = React.useCallback((groupId: number, driverId: string) => {
    setDriverByGroup(current =>
      current[groupId] === driverId ? current : { ...current, [groupId]: driverId }
    );
  }, []);

  function addGroup() {
    dirtyRef.current = true;
    const id = nextGroupId.current++;
    setGroups(current => [
      ...current,
      { id, driverId: "", truckId: "", rows: Array.from({ length: INITIAL_ROWS }, (_, i) => ({ id: i + 1 })) }
    ]);
    // Open the fresh tab so the clerk picks its driver right away
    setActiveId(String(id));
    scheduleSave();
  }

  function groupPaySum(id: number) {
    const prefix = `${id}:`;
    return Object.entries(pays).reduce(
      (acc, [key, v]) => (key.startsWith(prefix) ? acc + (Number(v) || 0) : acc),
      0
    );
  }

  /**
   * Drop one recognized photo sheet in as a new tab (one driver, rows keep
   * their own dates). Appends after anything typed; only an untouched form is
   * replaced wholesale - appending never destroys input, so no confirm.
   */
  function applyFromPhoto(apply: PhotoApply) {
    const id = nextGroupId.current++;
    const rows: RowSlot[] = apply.rows.map((row, i) => ({
      id: i + 1,
      defaults: {
        trip_date: row.date,
        operation: row.operation,
        from: row.from,
        to: row.to,
        load_no: row.load_no,
        miles: "0",
        pay_amount: "",
        notes: row.notes
      }
    }));
    const group: GroupSlot = { id, driverId: apply.driverId, truckId: "", rows };
    if (dirtyRef.current) {
      setGroups(current => [...current, group]);
    } else {
      setGroups([group]);
      setPays({});
    }
    setDriverByGroup(current => ({ ...current, [id]: apply.driverId }));
    setActiveId(String(id));
    dirtyRef.current = true;
    setPhotoOpen(false);
    scheduleSave();
  }

  // Tab label: the picked driver's name; "无" until one is picked
  const tabLabel = (group: GroupSlot) =>
    drivers.find(d => d.id === driverByGroup[group.id])?.full_name || "无";

  // The bottom "只记本组" button targets whichever tab is open
  const activeGroupIndex = Math.max(
    0,
    groups.findIndex(g => String(g.id) === activeId)
  );
  const activeGroupRows = filledCounts[Number(activeId)] ?? 0;

  return (
    <form
      ref={formRef}
      action={addTripsBatch}
      aria-label="录入行程"
      onChange={e => {
        // Photo-panel events bubble too (it lives inside the form); those
        // don't make the entry rows dirty or feed the draft
        if (!(e.target as HTMLElement).closest("[data-photo-panel]")) {
          dirtyRef.current = true;
          scheduleSave();
        }
      }}
      onSubmit={() => {
        // Submitting either button hands every value to the server action;
        // success refills leftovers via redirect params and failure refills
        // everything, so the local draft must not outlive this submit
        window.clearTimeout(saveTimer.current);
        clearEntryDraft();
      }}
    >
      <div className="panel">
        <PhotoImport
          drivers={drivers}
          locations={locations}
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          onApply={applyFromPhoto}
        />

        {restoredFrom && (
          <div className="flex flex-wrap items-center gap-x-3 border-b border-line bg-amber-50/70 px-3 py-2 text-[13px] text-amber-900/85">
            <span>
              已恢复未提交的草稿：{restoredFrom.groups} 组 · {restoredFrom.filled} 段已填
            </span>
            <button type="button" className="linklike" onClick={discardDraft}>
              清空重来
            </button>
          </div>
        )}

        {/* Sheet cover: the pay period this batch is entered against -
            context display only; rows carry their own dates. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">
            工资周期
          </span>
          <button
            type="button"
            aria-label="上一周期"
            onClick={() => changePeriod(shiftPeriod(periodOf(periodStart), -1).start)}
            className="grid h-7 w-7 place-items-center rounded-md border border-line bg-card font-mono text-sm text-route transition-colors hover:border-route"
          >
            ‹
          </button>
          <PeriodPicker
            selectedStart={periodStart}
            selectedLabel={periodLabel(periodOf(periodStart))}
            todayIso={todayIso()}
            totals={{}}
            onPick={changePeriod}
          />
          <button
            type="button"
            aria-label="下一周期"
            onClick={() => changePeriod(shiftPeriod(periodOf(periodStart), 1).start)}
            className="grid h-7 w-7 place-items-center rounded-md border border-line bg-card font-mono text-sm text-route transition-colors hover:border-route"
          >
            ›
          </button>
        </div>

        {/* Tab switches ride along: the draft stores the open tab, so switching
            alone (no other edit) must still reach the debounced save */}
        <Tabs
          value={activeId}
          onValueChange={next => {
            handleDirty();
            setActiveId(next);
          }}
        >
          {/* Single strip opening the panel: driver tabs, add-group, photo
              import, and the page-wide primary submit (all tabs) */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <TabsList className="h-auto max-w-full flex-wrap">
              {groups.map(group => {
                const filled = filledCounts[group.id] ?? 0;
                return (
                  <TabsTrigger key={group.id} value={String(group.id)}>
                    {tabLabel(group)}
                    {filled > 0 && (
                      <span className="rounded-full bg-route/15 px-1.5 font-mono text-[10px] leading-4 tabular-nums text-route">
                        {filled}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <Button type="button" variant="outline" className="h-8" onClick={addGroup}>
              <PlusIcon className="size-4" />
              添加一组（换司机）
            </Button>
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                className="linklike"
                onClick={() => setPhotoOpen(true)}
              >
                <CameraIcon className="mr-1 inline size-3.5" />
                照片识别
              </button>
              <Button type="submit" className="h-9 px-5">
                记入全部 {totalRows} 段行程
              </Button>
            </div>
          </div>

          {/* forceMount keeps every tab's fields in the DOM (and the submit) */}
          {groups.map((group, gi) => (
            <TabsContent key={group.id} value={String(group.id)} forceMount>
              <GroupSection
                index={gi}
                group={group}
                drivers={drivers}
                trucks={trucks}
                locations={locations}
                operations={operations}
                wageRules={wageRules}
                sheetTable={sheetTable}
                removable={groups.length > 1}
                onRemove={removeGroup}
                onDriverChange={handleGroupDriverChange}
                onPayChange={handlePayChange}
                onForgetRow={handleForgetRow}
                onFilledChange={handleFilledChange}
                onDirty={handleDirty}
                dragging={dragging}
                onDraggingChange={setDragging}
                paySum={groupPaySum(group.id)}
              />
            </TabsContent>
          ))}
        </Tabs>

        <input type="hidden" name="group_count" value={groups.length} />
        {/* Bottom bar: running totals + the current tab's secondary submit.
            The page-wide primary submit lives in the top tab strip. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              共 {groups.length} 组 · {totalRows} 段 · 工资合计{" "}
              <b className="font-mono text-sm text-foreground">{money(totalPay)}</b>
            </span>
            <button
              type="button"
              className="linklike danger"
              onClick={() => {
                if (window.confirm("清空未提交的草稿并重置表单？")) discardDraft();
              }}
            >
              清空表单
            </button>
          </span>
          <Button
            type="submit"
            name="submit_group"
            value={String(activeGroupIndex)}
            variant="outline"
            className="h-9 px-4"
          >
            只记本组 {activeGroupRows} 段
          </Button>
        </div>
      </div>
    </form>
  );
}
