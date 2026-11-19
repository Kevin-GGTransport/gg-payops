"use client";

import * as React from "react";
import { CameraIcon, ChevronDownIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PeriodPicker } from "@/components/period-picker";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { ComboboxField } from "@/components/combobox-field";
import { ConfirmAction } from "@/components/confirm-action";
import { SubmitButton } from "@/components/submit-button";
import { DateField } from "@/components/date-field";
import { LocationPicker, type LocationOption } from "@/components/location-picker";
import { calcFuelSubsidy, calcTripWage, matchPackageRule, type WageRuleData } from "@/lib/wage";
import { money, todayIso } from "@/lib/format";
import { defaultPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/period";
import {
  clearEntryDraft,
  collectDraftFromDOM,
  readEntryDraft,
  writeEntryDraft
} from "@/lib/entry-draft";
import {
  DRIVER_TYPE_LABELS,
  PRICING_MODE_LABELS,
  type DriverType,
  type OperationType,
  type PricingMode
} from "@/lib/labels";
import { addTripsBatch } from "./entry-actions";
import { PhotoImport, type PhotoApply } from "./photo-import";

type DriverOption = {
  id: string;
  full_name: string;
  driver_type: DriverType;
  /** Owner-type driver billed at driver prices (pricing identity override) */
  price_as_driver: boolean;
  /** Entry pricing mode this group's 计价 dropdown follows on driver pick */
  pricing_mode: PricingMode;
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

/** One USPS state of the fuel-section dropdown */
export type StateOption = { code: string; name: string };

/** One fuel-section row's initial values (saved week, draft or failed-submit refill) */
export type FuelRowDefault = {
  state: string;
  gallons: string;
  miles: string;
  amount: string;
  note: string;
};

/** One row's initial values (photo import or failed-submit refill) */
export type RefillRow = {
  trip_date?: string;
  operation: string;
  from: string;
  to: string;
  load_no: string;
  miles: string;
  pay_amount: string;
  notes: string;
};

/** One group's initial shape: one driver + one truck + its own rows */
export type RefillGroup = {
  driverId: string;
  truckId: string;
  rows: RefillRow[];
  /** Serialized pkg state (计价 mode + manual package amounts) from the failed-submit refill */
  pkgState?: string;
  /** Fuel-section rows from the failed-submit refill */
  fuelRows?: FuelRowDefault[];
};

type TripEntryFormProps = {
  drivers: DriverOption[];
  trucks: TruckOption[];
  locations: LocationOption[];
  /** Operation dictionary (ACTIVE rows); the row dropdown reads it */
  operations: OperationOption[];
  /** The single ACTIVE wage-rule version; every row prices by it */
  wageRule: WageRuleData | null;
  /** USPS dictionary (ACTIVE rows); the fuel-section state dropdown reads it */
  states: StateOption[];
  /** The cover period's saved fuel rows per driver, prefilling the fuel
   *  sections when a week is reopened (edit-a-week = return to its period) */
  fuelByDriver?: Record<string, FuelRowDefault[]>;
  defaultDriverId?: string;
  /** Present when redirected back after a validation error */
  refillGroups?: RefillGroup[];
  /** Tab to open first (0-based group index, restored from redirect params) */
  initialActiveIndex?: number;
  /** Pay-period start covering the sheet (a Saturday); defaults to this week */
  initialPeriodStart?: string;
};

const INITIAL_ROWS = 10;
/** Blank fuel rows a fresh fuel section opens with (a week is a few states) */
const FUEL_INITIAL_ROWS = 2;

/** Draft-restored groups take ids from here so they always mount fresh */
const DRAFT_GROUP_ID_BASE = 1_000;

/** Locations carrying this class tag are container docks (wage rules key on it) */
const DOCK_CLASS_TAG = "码头";
/** Dock -> base (HW/SHIPPER) leg defaults to this operation: 提柜 - the
 *  container is picked up at the terminal and hauled to the warehouse */
const DOCK_TO_BASE_OPERATION = "CNTRPU";
/** Base (HW/SHIPPER) -> dock leg defaults to this operation: 还柜 - the
 *  empty container goes back to the terminal */
const BASE_TO_DOCK_OPERATION = "CNTRDEL";

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
  { id: "miles", header: "里程 (mi)", size: 92, minSize: 80 },
  { id: "pay_amount", header: "本趟工资 ($)", size: 100, minSize: 92 },
  { id: "notes", header: "备注", size: 182, minSize: 100 },
  { id: "delete", header: "操作", size: 40, enableResizing: false, meta: { headerClass: "px-1.5" } }
];

/** Columns-only instance has no rows; keep the reference stable across renders */
const NO_ROWS: unknown[] = [];

/** Column layout of the per-group fuel section, fed to the same shared TanStack
 *  shell the trip sheet uses so both tables read as one family */
export const FUEL_SHEET_COLUMNS: ColumnDef<unknown, unknown>[] = [
  { id: "seq", header: "#", size: 44, enableResizing: false, meta: { headerClass: "ctr" } },
  { id: "state", header: "州", size: 132, minSize: 100 },
  { id: "gallons", header: "加仑 (gal)", size: 104, minSize: 84 },
  { id: "miles", header: "里程 (mi)", size: 104, minSize: 84 },
  { id: "amount", header: "金额 ($)", size: 104, minSize: 84 },
  { id: "note", header: "备注", size: 200, minSize: 120 },
  { id: "delete", header: "操作", size: 56, enableResizing: false, meta: { headerClass: "px-1.5" } }
];

/** Weekday suffix of a day-separator band (same rendering as the payroll ledger) */
const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function dowOf(iso: string) {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

type CalcStatus = "loading" | "auto" | "failed";

/** Package pricing mode of one group sheet (per-leg default) */
type PkgUnit = PricingMode;

/** One priced package planned from the sheet: legs share one amount */
type PkgPlan = { id: string; date: string; rowIds: number[]; unit: Exclude<PkgUnit, "LEG"> };

/** Pricing state of one group sheet: the hand-set 计价 mode plus manual
 *  package-amount overrides keyed by plan id. Serialized into a hidden form
 *  field so the draft and the failed-submit refill carry it across the
 *  remounts that would otherwise silently drop it back to rule suggestions. */
export type PkgState = { unit: PkgUnit; amounts: Record<string, string> };

const PKG_STATE_KEY_MAX = 32;
const PKG_STATE_VALUE_MAX = 16;
const PKG_STATE_ENTRIES_MAX = 50;

/** Validate a persisted pkg-state JSON string (draft or URL refill); anything
 *  malformed drops to undefined so the sheet falls back to roster defaults */
function parsePkgState(raw: string): PkgState | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { unit, amounts } = parsed as { unit?: unknown; amounts?: unknown };
    if (unit !== "LEG" && unit !== "DAY" && unit !== "ROUND_TRIP") return undefined;
    const clean: Record<string, string> = {};
    if (amounts !== undefined) {
      if (typeof amounts !== "object" || amounts === null) return undefined;
      for (const [key, value] of Object.entries(amounts as Record<string, unknown>).slice(
        0,
        PKG_STATE_ENTRIES_MAX
      )) {
        if (
          key.length > PKG_STATE_KEY_MAX ||
          typeof value !== "string" ||
          value.length > PKG_STATE_VALUE_MAX
        ) {
          continue;
        }
        clean[key] = value;
      }
    }
    return { unit, amounts: clean };
  } catch {
    return undefined;
  }
}

const PKG_UNIT_OPTIONS: ReadonlyArray<{ value: PkgUnit; label: string }> = (
  Object.entries(PRICING_MODE_LABELS) as Array<[PkgUnit, string]>
).map(([value, label]) => ({ value, label }));

/**
 * Plan packages over a group's filled legs: DAY groups every leg of a date
 * into one package; ROUND_TRIP chains the date's legs road-order (each next
 * leg's from feeds the previous to, sheet order breaks ties) and cuts one
 * package per circuit that returns to its opening origin - interleaved entry
 * re-orders into road order instead of swallowing other trips' legs, and
 * dead-end walks stay per-leg. Undated legs never group.
 *
 * Endpoints compare by filing key, mirroring resolveEndpointId on the server:
 * a roster pick keys by its location code, a hand-typed endpoint by the
 * uppercase code (16 chars, geo payload stripped) the server reuses for the
 * same place - so "94587" picked from the roster and "94587" typed by hand
 * close one circuit instead of pricing per-trip.
 */
function planPackages(
  unit: Exclude<PkgUnit, "LEG">,
  slots: { id: number }[],
  effDateByRow: Record<number, string>,
  effFromByRow: Record<number, string>,
  toByRow: Record<number, string>,
  codeByLocId: Map<string, string>
): PkgPlan[] {
  const keyOf = (value: string | undefined): string => {
    if (!value) return "";
    if (value.startsWith("loc:")) return codeByLocId.get(value.slice(4)) ?? value;
    if (value.startsWith("txt:")) {
      // locations.code column caps at 16 chars (CODE_MAX in lib/locations);
      // importing that server module here would drag prisma into the client
      const code = value.slice(4).split("|geo:")[0].trim().toUpperCase().slice(0, 16);
      return code || value;
    }
    return value;
  };
  const fromKey = new Map<number, string>();
  const toKey = new Map<number, string>();
  for (const slot of slots) {
    fromKey.set(slot.id, keyOf(effFromByRow[slot.id]));
    toKey.set(slot.id, keyOf(toByRow[slot.id]));
  }
  const byDate = new Map<string, number[]>();
  for (const slot of slots) {
    const to = toByRow[slot.id];
    const date = effDateByRow[slot.id];
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
    let seq = 0;
    const remaining = [...ids];
    while (remaining.length > 0) {
      const head = remaining.shift()!;
      const origin = fromKey.get(head) ?? "";
      // No anchor to close on: this leg stays per-priced
      if (!origin) continue;
      const rowIds = [head];
      let cursorTo = toKey.get(head);
      while (cursorTo !== origin) {
        const next = remaining.findIndex(id => fromKey.get(id) === cursorTo);
        if (next < 0) break; // dead end: the walked legs stay per-priced
        const leg = remaining.splice(next, 1)[0];
        rowIds.push(leg);
        cursorTo = toKey.get(leg);
      }
      if (cursorTo === origin) {
        plans.push({ id: `r-${date}-${seq++}`, date, rowIds, unit });
      }
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
 * Date and start arrive as CONTROLLED effective values: the group derives the
 * carry chain top-down in one render (previous leg's date/to fills an untouched
 * row) instead of each row accepting a carry in an effect and reporting back -
 * that round-trip re-rendered the whole sheet once per row down the chain.
 * A hand edit reports upward and sticks (the group keeps it as the row's own).
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
  wageRule,
  defaults,
  removable,
  dateValue,
  fromValue,
  onRemove,
  /** Marks the sheet dirty + schedules a draft save; picker fields write their
   *  hidden inputs programmatically (no change event bubbles), so every
   *  non-typing value change must report through here */
  onDirty,
  onPayChange,
  /** Reports every miles change upward (feeds the owner fuel-subsidy strip) */
  onMilesChange,
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
  wageRule: WageRuleData | null;
  defaults?: RefillRow;
  removable: boolean;
  /** Effective date (own, else carried from the previous leg) - group-derived */
  dateValue: string;
  /** Effective start (own, else the previous leg's to) - group-derived */
  fromValue: string;
  onRemove: (rowId: number) => void;
  onDirty: () => void;
  onPayChange: (rowId: number, value: string) => void;
  onMilesChange: (rowId: number, value: string) => void;
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
  // Dictionary order decides the opening choice (seeds: DEL first)
  const defaultOperation = operations[0]?.code ?? "DEL";
  const [operation, setOperation] = React.useState(defaults?.operation || defaultOperation);
  // Once the operation is hand-picked (or arrived via photo/refill), endpoint
  // picks stop steering it - mirroring the date/from sticky-follow above. A
  // restored draft/photo value equal to the running default counts as
  // untouched: the DOM snapshot cannot tell "hand-picked DEL" from "never
  // looked at", and the special-route effect re-derives the same DEL for
  // ordinary pairs anyway.
  const presetOperation = defaults?.operation || "";
  const operationTouched = React.useRef(
    presetOperation !== "" && presetOperation !== defaultOperation
  );
  // Container-less operations (requires_load=false) clear and lock Load#
  const operationRequiresLoad = (code: string) =>
    operations.find(o => o.code === code)?.requires_load ?? true;
  const [loadNoValue, setLoadNoValue] = React.useState(
    defaults?.operation && !operationRequiresLoad(defaults.operation) ? "" : defaults?.load_no || ""
  );
  const [toValue, setToValue] = React.useState(defaults?.to || "");
  const [milesValue, setMilesValue] = React.useState(defaults?.miles || "0");
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  // Ignore stale responses after a quick endpoint re-pick
  const requestId = React.useRef(0);

  // Sticky manual wage: null = auto-follow the rule; once set (hand edit or
  // error restore) basis changes never overwrite it - only "按规则重算" drops back
  const [manualPay, setManualPay] = React.useState<string | null>(defaults?.pay_amount || null);

  // Report the initial (refill/photo) endpoints/date once so the next leg can
  // carry them; every later change reports directly from the pick handlers.
  // Only the one-shot defaults count - the effective from/date may already be
  // a carry on mount, and reporting that would pin it as this row's own
  React.useEffect(() => {
    if (toValue) onToChange(rowId, toValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (defaults?.from) onFromChange(rowId, defaults.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (defaults?.trip_date) onDateChange(rowId, defaults.trip_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Special-route defaults: while the operation is untouched it follows the
  // endpoints - dock-tagged yard -> base (HW/SHIPPER) reads as a container
  // pickup (提柜), base -> dock as a container return (还柜); anything else
  // falls back to the dictionary default
  React.useEffect(() => {
    if (operationTouched.current) return;
    const from = wageEndpoint(fromValue);
    const to = wageEndpoint(toValue);
    const fromDock = from?.class_tag === DOCK_CLASS_TAG;
    const toDock = to?.class_tag === DOCK_CLASS_TAG;
    const fromBase = from?.location_type === "BASE";
    const toBase = to?.location_type === "BASE";
    const autoOperation =
      fromDock && toBase
        ? DOCK_TO_BASE_OPERATION
        : fromBase && toDock
          ? BASE_TO_DOCK_OPERATION
          : defaultOperation;
    setOperation(autoOperation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromValue, toValue]);

  // Every row prices by the single ACTIVE rule version
  const rule = wageRule;
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

  // Miles feed the owner fuel-subsidy strip above the add-row bar
  React.useEffect(() => {
    onMilesChange(rowId, milesValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milesValue]);

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
            onDateChange(rowId, value);
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
          triggerClassName="h-8 px-2"
          onValueChange={value => {
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
          triggerClassName="h-8 px-2"
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
          value={operation}
          clearable={false}
          searchable={false}
          aria-label={`${legLabel}操作`}
          triggerClassName="h-8 px-2"
          onValueChange={value => {
            operationTouched.current = true;
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
          className={`${cellInput} font-mono`}
        />
        {milesHint && (
          <span className={`${cellHint} ${phase === "failed" ? "text-destructive" : ""}`}>
            {milesHint}
          </span>
        )}
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
          className={`${cellInput} font-mono`}
        />
        {packaged && (
          <span className={cellHint}>
            {isPackageCarrier ? "打包价 · 上方计价条改" : "打包内 · $0"}
          </span>
        )}
        {!packaged && manualPay !== null && (
          // data-manual-pay: the draft collector keeps hand-edited wages as
          // manual on restore; auto-priced rows restore empty and recalc
          <span data-manual-pay className={cellHint}>
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
          <span className={cellHint}>该日期无生效规则</span>
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

/**
 * One fuel-by-state row of the group's fuel section: state dropdown plus
 * gallons / state-miles / amount and a note. Values are group-held (the
 * section totals and dup hints derive from them in the group's render, one
 * frame); field names are positional like the trip rows so deleting a middle
 * row only shifts names, never values. Memoized for the same reason as
 * EntryRow - every tab stays mounted.
 */
const FuelRow = React.memo(function FuelRow({
  rowId,
  groupIndex,
  rowIndex,
  states,
  value,
  removable,
  /** Display row number of the first row sharing this state (dup hint), if any */
  dupOf,
  onRemove,
  onChange,
  onDirty
}: {
  rowId: number;
  groupIndex: number;
  rowIndex: number;
  states: StateOption[];
  value: FuelRowDefault;
  removable: boolean;
  dupOf: number | null;
  onRemove: (rowId: number) => void;
  onChange: (rowId: number, patch: Partial<FuelRowDefault>) => void;
  /** Picker fields write their hidden inputs programmatically (no change
   *  event bubbles), so every non-typing change reports through here */
  onDirty: () => void;
}) {
  const prefix = `g_${groupIndex}_fuel_row_${rowIndex}_`;
  const label = `第 ${groupIndex + 1} 组加油第 ${rowIndex + 1} 行`;
  return (
    <tr>
      <td className="ctr px-1.5 font-mono text-[12px] tabular-nums text-muted-foreground">
        {rowIndex + 1}
      </td>
      <td className="px-1.5">
        <ComboboxField
          name={`${prefix}state_code`}
          value={value.state}
          placeholder="州"
          searchPlaceholder="搜索缩写 / 州名"
          mono
          triggerLabelOnly
          triggerClassName="h-8 w-full px-2"
          aria-label={`${label}州`}
          onValueChange={next => {
            onChange(rowId, { state: next });
            onDirty();
          }}
          options={states.map(s => ({ value: s.code, label: s.code, description: s.name }))}
        />
        {dupOf !== null && (
          <span className={`${cellHint} text-amber-600`}>
            与第 {dupOf + 1} 行重复，保存时合并
          </span>
        )}
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}gallons`}
          min={0}
          step={0.001}
          value={value.gallons}
          onChange={e => onChange(rowId, { gallons: e.target.value })}
          placeholder="—"
          aria-label={`${label}加仑`}
          className={`${cellInput} font-mono`}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}miles`}
          min={0}
          step={0.1}
          value={value.miles}
          onChange={e => onChange(rowId, { miles: e.target.value })}
          placeholder="—"
          aria-label={`${label}里程`}
          className={`${cellInput} font-mono`}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}amount`}
          min={0}
          step={0.01}
          value={value.amount}
          onChange={e => onChange(rowId, { amount: e.target.value })}
          placeholder="—"
          aria-label={`${label}金额`}
          className={`${cellInput} font-mono`}
        />
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}note`}
          value={value.note}
          maxLength={200}
          placeholder="选填"
          aria-label={`${label}备注`}
          className={cellInput}
          onChange={e => onChange(rowId, { note: e.target.value })}
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

/** A fuel-section slot: stable id plus its current values (group-held state) */
type FuelSlot = { id: number; value: FuelRowDefault };

/** A group slot: stable id + one-shot initial driver/truck/rows */
type GroupSlot = {
  id: number;
  driverId: string;
  truckId: string;
  rows: RowSlot[];
  /** Restored pricing state (draft/refill); a fresh group starts undefined */
  pkg?: PkgState;
  /** Fuel-section initial rows (saved week, draft or failed-submit refill);
   *  absent = seed empty rows (or the saved set once a driver is picked) */
  fuelDefaults?: FuelRowDefault[];
};

/** Seed the fuel slots from defaults, or open with blank reserve rows */
function toFuelSlots(defaults: FuelRowDefault[] | undefined): FuelSlot[] {
  const source = defaults && defaults.length > 0 ? defaults : [];
  const rows = source.map((value, i) => ({ id: i + 1, value: { ...value } }));
  if (rows.length === 0) {
    return Array.from({ length: FUEL_INITIAL_ROWS }, (_, i) => ({
      id: i + 1,
      value: { state: "", gallons: "", miles: "", amount: "", note: "" }
    }));
  }
  return rows;
}

/** Rows that carry anything a submission would keep */
function fuelSlotHasContent(slot: FuelSlot) {
  const v = slot.value;
  return Boolean(v.state || v.gallons || v.miles || v.amount || v.note);
}

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
  wageRule,
  states,
  fuelByDriver,
  sheetTable,
  removable,
  onRemove,
  onDriverChange,
  onPayChange,
  onMilesChange,
  onForgetRow,
  onFilledChange,
  onDirty,
  dragging,
  onDraggingChange,
  paySum,
  subsidyRate,
  subsidyMiles,
  subsidyAmount
}: {
  index: number;
  group: GroupSlot;
  drivers: DriverOption[];
  trucks: TruckOption[];
  locations: LocationOption[];
  operations: OperationOption[];
  wageRule: WageRuleData | null;
  /** USPS dictionary for the fuel-section state dropdown */
  states: StateOption[];
  /** Cover-period saved fuel rows per driver (week prefill on driver pick) */
  fuelByDriver?: Record<string, FuelRowDefault[]>;
  /** Shared columns-only TanStack instance (thead + colgroup for this sheet) */
  sheetTable: TanstackTable<unknown>;
  removable: boolean;
  onRemove: (groupId: number) => void;
  /** Reports the picked driver upward (feeds the tab label) */
  onDriverChange: (groupId: number, driverId: string) => void;
  onPayChange: (groupId: number, rowId: number, value: string) => void;
  onMilesChange: (groupId: number, rowId: number, value: string) => void;
  onForgetRow: (groupId: number, rowId: number) => void;
  onFilledChange: (groupId: number, count: number) => void;
  onDirty: () => void;
  /** Live drag source shared across groups (a group only accepts its own) */
  dragging: { groupId: number; rowId: number } | null;
  onDraggingChange: (source: { groupId: number; rowId: number } | null) => void;
  paySum: number;
  /** Owner fuel subsidy of this group's current rows (primitives keep the memo) */
  subsidyRate: number;
  subsidyMiles: number;
  subsidyAmount: number;
}) {
  const [driverId, setDriverId] = React.useState(group.driverId);
  // Current truck pick mirrors the uncontrolled combobox so the fuel section
  // can hint when rows exist without a truck to snapshot
  const [truckId, setTruckId] = React.useState(group.truckId);
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
  // Package pricing mode of this sheet (per-leg default); it starts at the
  // roster setting of the group's initial driver and re-follows on every
  // driver switch. pkgAmounts holds only the clerk's manual overrides keyed
  // by package id - a package without an override prices at its rule
  // suggestion (derived during render, no effect needed). Both restore from
  // a persisted pkg state (draft/refill) when one rode in with the group
  const [pkgUnit, setPkgUnit] = React.useState<PkgUnit>(
    () => group.pkg?.unit ?? drivers.find(d => d.id === group.driverId)?.pricing_mode ?? "LEG"
  );
  const [pkgAmounts, setPkgAmounts] = React.useState<Record<string, string>>(
    () => group.pkg?.amounts ?? {}
  );
  // Row ids that have at least one endpoint (what the buttons count)
  const [filledIds, setFilledIds] = React.useState<Set<number>>(new Set());
  // Grip pressed but drag not confirmed yet; only that row turns draggable
  const [armedRow, setArmedRow] = React.useState<number | null>(null);
  // Insertion point while a same-group drag hovers this sheet
  const [dropAt, setDropAt] = React.useState<{ id: number; before: boolean } | null>(null);
  // Fuel section: explicit defaults (saved week / draft / refill) win at
  // mount, else the saved rows of the group's opening driver, else blanks.
  // Driver switches re-load the picked driver's saved set (mirroring the
  // pkg-mode reset above) - the section always shows the week's truth
  const [fuelSlots, setFuelSlots] = React.useState<FuelSlot[]>(() =>
    toFuelSlots(group.fuelDefaults ?? (group.driverId ? fuelByDriver?.[group.driverId] : undefined))
  );
  const [fuelOpen, setFuelOpen] = React.useState(false);
  // Fuel sheet's own columns-only TanStack instance (widths persist per key)
  const fuelTable = useRosterTable({
    data: NO_ROWS,
    columns: FUEL_SHEET_COLUMNS,
    storageKey: "payops.entry.fuel.cols"
  });
  const dragActive = dragging?.groupId === group.id;
  const driverRecord = drivers.find(d => d.id === driverId);
  const driverType = driverRecord?.driver_type;
  // Pricing identity: an owner flagged price_as_driver bills as a driver
  const priceAsDriver = driverRecord?.price_as_driver ?? false;
  // Fuel subsidy: OWNER drivers only (price_as_driver included), needs a rate
  const showSubsidy = driverType === "OWNER" && subsidyRate > 0;

  // Location code per roster id: circuit detection compares filing keys, so
  // the same place picked from the roster and typed by hand chains together
  const codeByLocId = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const location of locations) map.set(location.id, location.code);
    return map;
  }, [locations]);

  // Effective carry chain, derived top-down in ONE pass: a row without its own
  // date follows the previous leg's, a row without its own start takes the
  // previous leg's to. The maps hold only hand edits / refill defaults, so
  // changing a leg's date or endpoint re-flows every untouched row below in
  // this same render - no per-row accept-and-report effect round-trips
  // cascading one full-sheet re-render per row down the chain.
  const eff = React.useMemo(() => {
    const dates: Record<number, string> = {};
    const froms: Record<number, string> = {};
    const dateList: string[] = [];
    const fromList: string[] = [];
    rows.forEach((slot, i) => {
      const prevDate = i > 0 ? dateList[i - 1] : "";
      const date = slot.id in dateByRow ? dateByRow[slot.id] : prevDate;
      const from =
        slot.id in fromByRow ? fromByRow[slot.id] : i > 0 ? (toByRow[rows[i - 1].id] ?? "") : "";
      dates[slot.id] = date;
      froms[slot.id] = from;
      dateList[i] = date;
      fromList[i] = from;
    });
    return { dates, froms, dateList, fromList };
  }, [rows, dateByRow, fromByRow, toByRow]);

  // Planned packages follow the sheet live (endpoints/dates/rows/mode) - fed
  // the effective endpoints so carried starts anchor circuits like picks
  const plans = React.useMemo(
    () =>
      pkgUnit === "LEG"
        ? []
        : planPackages(pkgUnit, rows, eff.dates, eff.froms, toByRow, codeByLocId),
    [pkgUnit, rows, eff, toByRow, codeByLocId]
  );

  // Rule suggestion per package: driver-scoped beats global (OWNER: owner
  // column, else driver price x owner multiplier)
  const suggestionByPkg = React.useMemo(() => {
    const map: Record<string, { amount: string; label: string } | null> = {};
    for (const plan of plans) {
      const rule = wageRule;
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
  }, [plans, wageRule, driverId, driverType, priceAsDriver]);

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
      // Static note: the amount lives in pay_amount and may be edited later
      // on the statement sheet, so it must not be baked into the note
      const note = plan.unit === "DAY" ? "日打包" : "往返打包";
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
      setFromByRow(current => {
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

  const handleRowMilesChange = React.useCallback(
    (rowId: number, value: string) => onMilesChange(group.id, rowId, value),
    [group.id, onMilesChange]
  );

  /** Patch one fuel row's values (group-held; typing also bubbles a change
   *  event to the form's draft save, pickers report through onDirty) */
  const handleFuelChange = React.useCallback((rowId: number, patch: Partial<FuelRowDefault>) => {
    setFuelSlots(current =>
      current.map(slot => (slot.id === rowId ? { ...slot, value: { ...slot.value, ...patch } } : slot))
    );
  }, []);

  const removeFuelRow = React.useCallback(
    (rowId: number) => {
      onDirty();
      setFuelSlots(current => current.filter(slot => slot.id !== rowId));
    },
    [onDirty]
  );

  function addFuelRow() {
    onDirty();
    // Fresh slot id = above every existing one (stable keys, never reused)
    const id = fuelSlots.reduce((max, slot) => Math.max(max, slot.id), 0) + 1;
    setFuelSlots(current => [
      ...current,
      { id, value: { state: "", gallons: "", miles: "", amount: "", note: "" } }
    ]);
  }

  // Fuel dup hints and totals derive straight off the slots in this render -
  // one frame, no report-back round-trips. Content rows only.
  const fuelContent = fuelSlots.filter(fuelSlotHasContent);
  const fuelDupOf = React.useMemo(() => {
    const firstByState = new Map<string, number>();
    const dupOf = new Map<number, number>();
    fuelSlots.forEach((slot, i) => {
      const state = slot.value.state;
      if (!state) return;
      const first = firstByState.get(state);
      if (first === undefined) firstByState.set(state, i);
      else dupOf.set(slot.id, first);
    });
    return dupOf;
  }, [fuelSlots]);
  const fuelTotals = React.useMemo(
    () =>
      fuelContent.reduce(
        (acc, slot) => ({
          gallons: acc.gallons + (Number(slot.value.gallons) || 0),
          miles: acc.miles + (Number(slot.value.miles) || 0),
          amount: acc.amount + (Number(slot.value.amount) || 0)
        }),
        { gallons: 0, miles: 0, amount: 0 }
      ),
    [fuelContent]
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
            // Package mode follows the picked driver's roster setting; manual
            // package amounts are keyed by date-only ids and must never cross
            // a driver switch, so they reset with the mode
            setPkgUnit(drivers.find(d => d.id === value)?.pricing_mode ?? "LEG");
            setPkgAmounts({});
            // Fuel follows the driver too: their saved rows for this cover
            // week load in (empty when none) so the section always shows the
            // week's truth before it is submitted
            const loadedFuel = toFuelSlots(fuelByDriver?.[value]);
            setFuelSlots(loadedFuel);
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
          onValueChange={value => {
            setTruckId(value);
            onDirty();
          }}
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
          {showSubsidy && (
            <span className="font-mono text-[13px] text-muted-foreground">
              燃油补助 {money(subsidyAmount)}
            </span>
          )}
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
            className="h-10 rounded-md border border-transparent bg-muted px-2.5 text-[13px] focus-visible:border-route focus-visible:bg-card"
          >
            {PKG_UNIT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name={`${prefix}_row_count`} value={rows.length} />
        <input type="hidden" name={`${prefix}_fuel_row_count`} value={fuelSlots.length} />
        {/* Pricing state rides the form so the draft collector and the
            failed-submit refill both round-trip it across remounts */}
        <input
          type="hidden"
          name={`${prefix}_pkg_state`}
          value={JSON.stringify({ unit: pkgUnit, amounts: pkgAmounts })}
        />
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
              const date = eff.dateList[i];
              const prevDate = i > 0 ? eff.dateList[i - 1] : "";
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
                    wageRule={wageRule}
                    defaults={slot.defaults}
                    removable={rows.length > 1}
                    dateValue={eff.dateList[i]}
                    fromValue={eff.fromList[i]}
                    onRemove={removeRowById}
                    onDirty={onDirty}
                    onPayChange={handleRowPayChange}
                    onMilesChange={handleRowMilesChange}
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

      {/* Owner fuel-subsidy strip: the per-mile reimbursement line under the
          sheet, live off the current miles; server snapshots per leg on submit */}
      {showSubsidy && (
        <div className="pkg-strip">
          <div className="pkg-line">
            <span className="text-xs font-medium text-foreground">燃油补助（车主）</span>
            <span className="text-xs text-muted-foreground">
              里程合计{" "}
              {subsidyMiles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi × $
              {subsidyRate.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 3
              })}
              /mi
            </span>
            <b className="font-mono text-[13px]">{money(subsidyAmount)}</b>
            <span className="text-[11px] text-muted-foreground">按段随行程记入，与工资分列</span>
          </div>
        </div>
      )}

      {/* Add-row bar sits under the sheet: finishing the last row, the clerk
          continues right there - no scrolling back to the top band */}
      <button type="button" className="add-row-bar" onClick={addRow}>
        <PlusIcon className="size-3.5" />
        添加行程
      </button>

      {/* Fuel-by-state rollup of this group's week: one collapsible section
          per driver group, submitted with the trips onto the statement's
          fuel_detail. Collapsed by default - most weeks it opens once at
          receipt-tally time. */}
      <Collapsible
        open={fuelOpen}
        onOpenChange={setFuelOpen}
        className="mt-3 border-t border-line"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[13px] font-medium text-foreground"
              aria-label={`展开第 ${index + 1} 组加油`}
            >
              <ChevronDownIcon
                className={`size-3.5 text-muted-foreground transition-transform ${fuelOpen ? "" : "-rotate-90"}`}
              />
              加油 · 按州
              {fuelContent.length > 0 && (
                <span className="rounded-full bg-route/15 px-1.5 font-mono text-[10px] leading-4 tabular-nums text-route">
                  {fuelContent.length}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          <span className="flex items-center gap-3 font-mono text-[12px] text-muted-foreground">
            {fuelContent.length > 0 && (
              <>
                <span>{fuelTotals.gallons.toLocaleString("en-US", { maximumFractionDigits: 3 })} gal</span>
                <span>{fuelTotals.miles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi</span>
                <span>${fuelTotals.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </>
            )}
          </span>
        </div>
        {/* forceMount keeps the collapsed content in the DOM so the named
            fuel inputs always ride the form submit and the draft collector;
            this radix-ui build does not set the hidden attribute on a forced
            content, so the tailwind class does the hiding (display:none
            inputs still submit) */}
        <CollapsibleContent forceMount className={fuelOpen ? "" : "hidden"}>
          <div className="pb-1">
            <RosterTable table={fuelTable}>
              <tbody className="tb-group">
                {fuelSlots.map((slot, i) => {
                  const dup = fuelDupOf.get(slot.id);
                  return (
                    <FuelRow
                      key={slot.id}
                      rowId={slot.id}
                      groupIndex={index}
                      rowIndex={i}
                      states={states}
                      value={slot.value}
                      removable={fuelSlots.length > 1}
                      dupOf={dup === undefined ? null : dup}
                      onRemove={removeFuelRow}
                      onChange={handleFuelChange}
                      onDirty={onDirty}
                    />
                  );
                })}
              </tbody>
            </RosterTable>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" className="linklike" onClick={addFuelRow}>
                <PlusIcon className="mr-1 inline size-3.5" />
                添加州
              </button>
              {fuelContent.length > 0 && !truckId && (
                <span className="text-[11px] font-medium text-amber-600">
                  录了加油需选车号
                </span>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
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
  wageRule,
  states,
  fuelByDriver,
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
      : defaultPeriod().start
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
        rows: g.rows.map((row, j) => ({ id: j + 1, defaults: row })),
        pkg: parsePkgState(g.pkgState ?? ""),
        fuelDefaults:
          g.fuelRows && g.fuelRows.length > 0 ? g.fuelRows.map(row => ({ ...row })) : undefined
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
  // "<groupId>:<rowId>" -> current miles value, for the owner fuel-subsidy lines
  const [milesByRow, setMilesByRow] = React.useState<Record<string, string>>({});
  // groupId -> filled-row count (rows with at least one endpoint; reserve
  // rows are skipped by the server and stay out of every count)
  const [filledCounts, setFilledCounts] = React.useState<Record<number, number>>({});
  // Live drag source across groups (groupId gates which sheet accepts the drop)
  const [dragging, setDragging] = React.useState<{ groupId: number; rowId: number } | null>(null);
  // Whether the user has changed anything (guards photo-import replacement)
  const dirtyRef = React.useRef(false);

  const totalRows = Object.values(filledCounts).reduce((acc, n) => acc + n, 0);
  const totalPay = Object.values(pays).reduce((acc, v) => acc + (Number(v) || 0), 0);

  // Owner fuel subsidy: live per-row miles x the ACTIVE version's rate (each
  // leg rounded to cents, matching the server-side per-trip snapshot)
  const subsidyRate = wageRule?.fuel_subsidy_rate ?? 0;
  const subsidyOf = (groupId: number) => {
    const prefix = `${groupId}:`;
    let milesSum = 0;
    let amount = 0;
    for (const [key, value] of Object.entries(milesByRow)) {
      if (!key.startsWith(prefix)) continue;
      const milesNum = Number(value) || 0;
      milesSum += milesNum;
      amount += calcFuelSubsidy({ driverType: "OWNER", miles: milesNum, rate: subsidyRate });
    }
    return { milesSum, amount };
  };
  const isOwnerGroup = (groupId: number) =>
    drivers.find(d => d.id === driverByGroup[groupId])?.driver_type === "OWNER";
  const totalSubsidy = subsidyRate > 0
    ? groups.reduce((acc, g) => acc + (isOwnerGroup(g.id) ? subsidyOf(g.id).amount : 0), 0)
    : 0;

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
    setMilesByRow(current => {
      const key = `${groupId}:${rowId}`;
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const handleMilesChange = React.useCallback((groupId: number, rowId: number, value: string) => {
    setMilesByRow(current => {
      const key = `${groupId}:${rowId}`;
      if (current[key] === value) return current;
      return { ...current, [key]: value };
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
      rows: g.rows.map((row, j) => ({ id: j + 1, defaults: row })),
      pkg: parsePkgState(g.pkg ?? ""),
      fuelDefaults:
        g.fuelRows && g.fuelRows.length > 0
          ? g.fuelRows.map(row => ({ ...row }))
          : fuelByDriver?.[g.driverId]
            ? fuelByDriver[g.driverId].map(row => ({ ...row }))
            : undefined
    }));
    setGroups(restored);
    nextGroupId.current = DRAFT_GROUP_ID_BASE + restored.length + 1;
    setDriverByGroup(Object.fromEntries(restored.map(g => [g.id, g.driverId])));
    setFilledCounts({});
    setPays({});
    setMilesByRow({});
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

  /**
   * Period picks navigate instead of flipping client state: the server then
   * refetches the new week's saved fuel (the fuel sections prefill from it),
   * while the in-progress sheet travels along as a draft - its periodStart is
   * rewritten to the target week right before the redirect so the cover and
   * the restored draft agree. The restore effect re-runs on the remount.
   */
  function changePeriod(next: string) {
    const form = formRef.current;
    if (form) {
      const activeIndex = groupsRef.current.findIndex(g => String(g.id) === activeIdRef.current);
      writeEntryDraft(
        collectDraftFromDOM(form, {
          activeIndex: activeIndex < 0 ? 0 : activeIndex,
          periodStart: next
        })
      );
    }
    // Full reload on purpose: the server component must refetch the new
    // week's saved fuel and the form must remount for the one-shot draft
    // restore - a client-side router.push keeps this instance alive and
    // skips both
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/dashboard?period=${next}`);
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
    setMilesByRow(current => {
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
      setMilesByRow({});
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
              <SubmitButton className="h-9 px-5" pendingLabel="记入中…">
                记入全部 {totalRows} 段行程
              </SubmitButton>
            </div>
          </div>

          {/* forceMount keeps every tab's fields in the DOM (and the submit) */}
          {groups.map((group, gi) => {
            const subsidy = isOwnerGroup(group.id) && subsidyRate > 0 ? subsidyOf(group.id) : null;
            return (
              <TabsContent key={group.id} value={String(group.id)} forceMount>
                <GroupSection
                  index={gi}
                  group={group}
                  drivers={drivers}
                  trucks={trucks}
                  locations={locations}
                  operations={operations}
                  wageRule={wageRule}
                  states={states}
                  fuelByDriver={fuelByDriver}
                  sheetTable={sheetTable}
                  removable={groups.length > 1}
                  onRemove={removeGroup}
                  onDriverChange={handleGroupDriverChange}
                  onPayChange={handlePayChange}
                  onMilesChange={handleMilesChange}
                  onForgetRow={handleForgetRow}
                  onFilledChange={handleFilledChange}
                  onDirty={handleDirty}
                  dragging={dragging}
                  onDraggingChange={setDragging}
                  paySum={groupPaySum(group.id)}
                  subsidyRate={subsidyRate}
                  subsidyMiles={subsidy?.milesSum ?? 0}
                  subsidyAmount={subsidy?.amount ?? 0}
                />
              </TabsContent>
            );
          })}
        </Tabs>

        <input type="hidden" name="group_count" value={groups.length} />
        {/* Cover period rides the form so the action's redirects (success,
            error refill) restore the week being entered instead of the default */}
        <input type="hidden" name="sheet_period" value={periodStart} />
        {/* Bottom bar: running totals + the current tab's secondary submit.
            The page-wide primary submit lives in the top tab strip. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              共 {groups.length} 组 · {totalRows} 段 · 工资合计{" "}
              <b className="font-mono text-sm text-foreground">{money(totalPay)}</b>
              {totalSubsidy > 0 && (
                <>
                  {" "}· 补助合计{" "}
                  <b className="font-mono text-sm text-foreground">{money(totalSubsidy)}</b>
                </>
              )}
            </span>
            <ConfirmAction
              danger
              title="清空未提交的草稿并重置表单？"
              description="清空后需重新录入，已提交的行程不受影响。"
              confirmLabel="清空"
              trigger={props => (
                <button {...props} className="linklike danger">
                  清空表单
                </button>
              )}
              onConfirm={() => discardDraft()}
            />
          </span>
          <SubmitButton
            name="submit_group"
            value={String(activeGroupIndex)}
            variant="outline"
            className="h-9 px-4"
            pendingLabel="记入中…"
          >
            只记本组 {activeGroupRows} 段
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
