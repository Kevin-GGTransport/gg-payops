"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ComboboxField } from "@/components/combobox-field";
import { FormGrid, NumberField, TextField } from "@/components/form-fields";
import type { LocationOption } from "@/components/location-picker";
import type { WageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { saveVersion } from "./actions";

type TierRow = { miles_from: string; amount: string };
type PriceRow = {
  driver_id: string;
  unit: string;
  /** Endpoint side as "loc:<id>" / "tag:<name>" / "" = any */
  from: string;
  to: string;
  operation: string;
  label: string;
  driver_amount: string;
  owner_amount: string;
};

type DriverOption = { id: string; full_name: string; driver_type: string; price_as_driver: boolean };
type OperationOption = { code: string; label: string };

const PRICE_UNITS = [
  { value: "LEG", label: "按趟" },
  { value: "ROUND_TRIP", label: "按往返" },
  { value: "DAY", label: "按天" }
] as const;

const cellInput =
  "h-8 border-0 bg-transparent px-2 shadow-none rounded-none text-[13px] focus-visible:ring-1";
const cellSelect =
  "h-8 border-0 bg-transparent px-1.5 shadow-none rounded-none text-[13px] focus-visible:ring-1 cursor-pointer";

/** Compact styled native select: the per-row dropdowns stay light */
function CellSelect({
  name,
  value,
  onChange,
  options,
  ariaLabel
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <select
      name={name}
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={cellSelect}
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Whole-ruleset editor for one wage-rule version: the price-rule table is the
 * ONLY pricing primitive (适用司机 x 起点/终点位置 x 操作 x 计价单位 x 两档价),
 * with the mileage tiers as the no-match fallback. Positional FormData, same
 * convention as the entry sheet. Saves in place - the ACTIVE version takes
 * effect immediately, INACTIVE versions are editable presets.
 */
export function RulesEditor({
  version,
  drivers,
  operations,
  locations
}: {
  version: WageRuleVersionDetail;
  drivers: DriverOption[];
  operations: OperationOption[];
  locations: LocationOption[];
}) {
  const [tiers, setTiers] = React.useState<TierRow[]>(
    version.tiers.map(t => ({
      miles_from: String(t.miles_from),
      amount: Number(t.amount).toFixed(2)
    }))
  );
  const [prices, setPrices] = React.useState<PriceRow[]>(
    version.price_rules.map(rule => ({
      driver_id: rule.driver_id ?? "",
      unit: rule.unit,
      from: rule.from_location_id
        ? `loc:${rule.from_location_id}`
        : rule.from_tag
          ? `tag:${rule.from_tag}`
          : "",
      to: rule.to_location_id
        ? `loc:${rule.to_location_id}`
        : rule.to_tag
          ? `tag:${rule.to_tag}`
          : "",
      operation: rule.operation ?? "",
      label: rule.label ?? "",
      driver_amount: rule.driver_amount.toFixed(2),
      owner_amount: rule.owner_amount === null ? "" : rule.owner_amount.toFixed(2)
    }))
  );
  // Driver lens over the price table: "" = everyone (rules + unscoped)
  const [driverFilter, setDriverFilter] = React.useState("");

  const driverOptions = React.useMemo(
    () => [{ value: "", label: "所有人" }, ...drivers.map(d => ({ value: d.id, label: d.full_name }))],
    [drivers]
  );
  // Driver picker options: searchable, grouped 司机/车主, pricing identity hint
  const driverPickOptions = React.useMemo(
    () =>
      drivers.map(d => ({
        value: d.id,
        label: d.full_name,
        group: d.driver_type === "OWNER" ? "车主" : "司机",
        description: d.price_as_driver ? "按司机价计价" : undefined
      })),
    [drivers]
  );
  // Endpoint picker options: every tag in use + every location, tag creatable
  const sideOptions = React.useMemo(() => {
    const tags = [...new Set(locations.map(l => l.class_tag).filter(Boolean))] as string[];
    return [
      ...tags.map(tag => ({ value: `tag:${tag}`, label: `#${tag}`, group: "类标签" })),
      ...locations.map(l => ({ value: `loc:${l.id}`, label: l.code, group: "位置" }))
    ];
  }, [locations]);
  const sideLabelFor = React.useCallback(
    (value: string) => {
      if (value.startsWith("tag:")) return `#${value.slice(4)}`;
      if (value.startsWith("loc:")) {
        const loc = locations.find(l => l.id === value.slice(4));
        return loc ? loc.code : undefined;
      }
      return undefined;
    },
    [locations]
  );

  const updatePrice = (i: number, patch: Partial<PriceRow>) =>
    setPrices(current => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const overage = Number(version.overage_increment);
  // New band = the next multiple of 50 above the last one (1 -> 50 -> 100 ...)
  const addTier = () =>
    setTiers(current => {
      const last = current[current.length - 1];
      const nextFrom = last
        ? String((Math.floor(Number(last.miles_from) / 50) + 1) * 50)
        : "1";
      return [
        ...current,
        {
          miles_from: nextFrom,
          amount: last ? (Number(last.amount) + overage).toFixed(2) : "50.00"
        }
      ];
    });
  const addPrice = () =>
    setPrices(current => [
      ...current,
      {
        driver_id: driverFilter,
        unit: "LEG",
        from: "",
        to: "",
        operation: "",
        label: "",
        driver_amount: "",
        owner_amount: ""
      }
    ]);

  return (
    <form id="wage-rules-edit" action={saveVersion} aria-label="工资规则编辑">
      <input type="hidden" name="id" value={version.id} />
      <input type="hidden" name="tier_count" value={tiers.length} />
      <input type="hidden" name="price_count" value={prices.length} />

      <div className="grid gap-5 px-4 py-4">
        <FormGrid className="gap-x-3 px-0 pt-0 md:grid-cols-6">
          <TextField
            label="版本名"
            name="name"
            required
            defaultValue={version.name}
            maxLength={120}
            className="md:col-span-3"
          />
          <NumberField
            label="车主乘数（×）"
            name="owner_multiplier"
            min={0.01}
            step={0.01}
            defaultValue={Number(version.owner_multiplier).toFixed(2)}
            className="md:col-span-2"
          />
          <NumberField
            label="燃油补助（$/mi）"
            name="fuel_subsidy_rate"
            min={0}
            step={0.001}
            defaultValue={String(Number(version.fuel_subsidy_rate))}
            className="md:col-span-2"
          />
          <NumberField
            label="BOBTAIL 乘数（×）"
            name="bobtail_multiplier"
            min={0.01}
            step={0.01}
            defaultValue={Number(version.bobtail_multiplier).toFixed(2)}
            className="md:col-span-2"
          />
          <NumberField
            label="超档递增（$/50mi）"
            name="overage_increment"
            min={0}
            step={0.01}
            defaultValue={Number(version.overage_increment).toFixed(2)}
            className="md:col-span-2"
          />
        </FormGrid>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              价格规则（按趟=终价不叠乘数；按往返/按天=录入打包建议价；都没命中走里程档）
            </p>
          </div>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>按司机看价：</span>
            <select
              value={driverFilter}
              onChange={e => setDriverFilter(e.target.value)}
              aria-label="按司机筛选价格规则"
              className={`${cellSelect} border border-line rounded px-2`}
            >
              {driverOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <table>
            <thead>
              <tr>
                <th>适用司机</th>
                <th>起点</th>
                <th>终点</th>
                <th>操作</th>
                <th>类型</th>
                <th>规则名</th>
                <th className="num">司机价 ($)</th>
                <th className="num">车主价 ($)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {/* All rows stay in the DOM (filtered ones hidden) so positional
                  names never shift while the lens is active */}
              {prices.map((price, i) => (
                <tr
                  key={i}
                  className={
                    driverFilter && price.driver_id !== driverFilter && price.driver_id !== ""
                      ? "hidden"
                      : undefined
                  }
                >
                  <td>
                    <ComboboxField
                      name={`price_${i}_driver_id`}
                      value={price.driver_id}
                      placeholder="所有人"
                      searchPlaceholder="搜索姓名"
                      clearable
                      triggerClassName="h-8 w-32 text-[13px]"
                      onValueChange={value => updatePrice(i, { driver_id: value })}
                      aria-label={`价格规则 ${i + 1} 适用司机`}
                      options={driverPickOptions}
                    />
                  </td>
                  <td>
                    <ComboboxField
                      name={`price_${i}_from`}
                      value={price.from}
                      placeholder="任意"
                      searchPlaceholder="标签或位置代码"
                      clearable
                      triggerClassName="h-8 w-28 text-[13px]"
                      onValueChange={value => updatePrice(i, { from: value })}
                      aria-label={`价格规则 ${i + 1} 起点`}
                      labelForValue={sideLabelFor}
                      options={sideOptions}
                      customOption={text => ({
                        value: `tag:${text.slice(0, 40)}`,
                        label: `新建类标签 #${text.slice(0, 40)}`,
                        description: "在位置管理里给位置打这个标签后生效"
                      })}
                    />
                  </td>
                  <td>
                    <ComboboxField
                      name={`price_${i}_to`}
                      value={price.to}
                      placeholder="任意"
                      searchPlaceholder="标签或位置代码"
                      clearable
                      triggerClassName="h-8 w-28 text-[13px]"
                      onValueChange={value => updatePrice(i, { to: value })}
                      aria-label={`价格规则 ${i + 1} 终点`}
                      labelForValue={sideLabelFor}
                      options={sideOptions}
                      customOption={text => ({
                        value: `tag:${text.slice(0, 40)}`,
                        label: `新建类标签 #${text.slice(0, 40)}`,
                        description: "在位置管理里给位置打这个标签后生效"
                      })}
                    />
                  </td>
                  <td>
                    <CellSelect
                      name={`price_${i}_operation`}
                      value={price.operation}
                      onChange={value => updatePrice(i, { operation: value })}
                      options={[
                        { value: "", label: "不限" },
                        ...operations.map(op => ({ value: op.code, label: op.code }))
                      ]}
                      ariaLabel={`价格规则 ${i + 1} 操作限定`}
                    />
                  </td>
                  <td>
                    <CellSelect
                      name={`price_${i}_unit`}
                      value={price.unit}
                      onChange={value => updatePrice(i, { unit: value })}
                      options={PRICE_UNITS}
                      ariaLabel={`价格规则 ${i + 1} 计价类型`}
                    />
                  </td>
                  <td>
                    <Input
                      name={`price_${i}_label`}
                      value={price.label}
                      onChange={e => updatePrice(i, { label: e.target.value })}
                      maxLength={100}
                      placeholder="如 东湾海柜一圈"
                      aria-label={`价格规则 ${i + 1} 规则名`}
                      className={`${cellInput} w-40`}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      name={`price_${i}_driver_amount`}
                      min={0}
                      step={0.01}
                      value={price.driver_amount}
                      onChange={e => updatePrice(i, { driver_amount: e.target.value })}
                      aria-label={`价格规则 ${i + 1} 司机价`}
                      className={`${cellInput} w-24 text-right font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      name={`price_${i}_owner_amount`}
                      min={0}
                      step={0.01}
                      value={price.owner_amount}
                      onChange={e => updatePrice(i, { owner_amount: e.target.value })}
                      placeholder="×乘数"
                      aria-label={`价格规则 ${i + 1} 车主价`}
                      className={`${cellInput} w-24 text-right font-mono`}
                    />
                  </td>
                  <td className="actions">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive"
                      onClick={() => setPrices(current => current.filter((_, j) => j !== i))}
                      aria-label={`删除价格规则 ${i + 1}`}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {prices.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    无价格规则；所有定价都在这里添加
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <button type="button" className="add-row-bar" onClick={addPrice}>
            <PlusIcon className="size-3.5" />
            添加价格规则
          </button>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              里程档位（兜底：无规则命中的行程按此计价；首档 1、按 50 递进）
            </p>
          </div>
          <table>
            <thead>
              <tr>
                <th>起算里程 (mi)</th>
                <th className="num">司机价 ($)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, i) => (
                <tr key={i}>
                  <td>
                    <Input
                      type="number"
                      name={`tier_${i}_miles_from`}
                      min={1}
                      value={tier.miles_from}
                      onChange={e =>
                        setTiers(current =>
                          current.map((t, j) => (j === i ? { ...t, miles_from: e.target.value } : t))
                        )
                      }
                      aria-label={`第 ${i + 1} 档起算里程`}
                      className={`${cellInput} w-24 font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      name={`tier_${i}_amount`}
                      min={0}
                      step={0.01}
                      value={tier.amount}
                      onChange={e =>
                        setTiers(current =>
                          current.map((t, j) => (j === i ? { ...t, amount: e.target.value } : t))
                        )
                      }
                      aria-label={`第 ${i + 1} 档司机价`}
                      className={`${cellInput} w-28 text-right font-mono`}
                    />
                  </td>
                  <td className="actions">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive"
                      onClick={() => setTiers(current => current.filter((_, j) => j !== i))}
                      aria-label={`删除第 ${i + 1} 档`}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="add-row-bar" onClick={addTier}>
            <PlusIcon className="size-3.5" />
            添加档位
          </button>
        </div>
      </div>
    </form>
  );
}
