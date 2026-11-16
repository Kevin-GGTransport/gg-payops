"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/date-field";
import { FormGrid, NumberField, TextField } from "@/components/form-fields";
import type { WageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { saveVersion } from "./actions";

type TierRow = { miles_from: string; amount: string };
type SpecialRow = { from_postal: string; to_postal: string; amount: string; note: string };
type PriceRow = {
  driver_id: string;
  unit: string;
  from_class: string;
  to_class: string;
  operation: string;
  label: string;
  driver_amount: string;
  owner_amount: string;
};

type DriverOption = { id: string; full_name: string };
type OperationOption = { code: string; label: string };

/** Matcher classes a price rule can pin (empty = any side) */
export const PRICE_CLASSES = [
  { value: "STK", label: "STK" },
  { value: "HW", label: "HW" },
  { value: "SHIPPER", label: "SHIPPER" },
  { value: "AMAZON_A", label: "A类仓" },
  { value: "AMAZON_B", label: "B类仓" }
] as const;

const PRICE_UNITS = [
  { value: "LEG", label: "按趟" },
  { value: "ROUND_TRIP", label: "按往返" },
  { value: "DAY", label: "按天" }
] as const;

const cellInput =
  "h-8 border-0 bg-transparent px-2 shadow-none rounded-none text-[13px] focus-visible:ring-1";
const cellSelect =
  "h-8 border-0 bg-transparent px-1.5 shadow-none rounded-none text-[13px] focus-visible:ring-1 cursor-pointer";

/** Compact styled native select: five dropdowns per rule row stay light */
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
 * Whole-ruleset editor for one wage-rule version: params, mileage tiers,
 * special postal pairs and the flexible price-rule table (per-driver or
 * global; per-leg / per-round-trip / per-day). Positional FormData, same
 * convention as the entry sheet. Saving a version effective before today
 * auto-clones it to a today-effective version server-side (saveVersion).
 */
export function RulesEditor({
  version,
  drivers,
  operations,
  locked,
  today
}: {
  version: WageRuleVersionDetail;
  drivers: DriverOption[];
  operations: OperationOption[];
  /** Version already effective before today: saving creates today's clone */
  locked: boolean;
  today: string;
}) {
  const [tiers, setTiers] = React.useState<TierRow[]>(
    version.tiers.map(t => ({
      miles_from: String(t.miles_from),
      amount: Number(t.amount).toFixed(2)
    }))
  );
  const [specials, setSpecials] = React.useState<SpecialRow[]>(
    version.special_routes.map(s => ({
      from_postal: s.from_postal,
      to_postal: s.to_postal,
      amount: Number(s.one_way_amount).toFixed(2),
      note: s.note ?? ""
    }))
  );
  const [prices, setPrices] = React.useState<PriceRow[]>(
    version.price_rules.map(rule => ({
      driver_id: rule.driver_id ?? "",
      unit: rule.unit,
      from_class: rule.from_class ?? "",
      to_class: rule.to_class ?? "",
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
  const visiblePrices = prices.map((row, i) => ({ row, i })).filter(
    ({ row }) => !driverFilter || row.driver_id === driverFilter || row.driver_id === ""
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
  const addSpecial = () =>
    setSpecials(current => [...current, { from_postal: "", to_postal: "", amount: "", note: "" }]);
  const addPrice = () =>
    setPrices(current => [
      ...current,
      {
        driver_id: driverFilter,
        unit: "LEG",
        from_class: "",
        to_class: "",
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
      <input type="hidden" name="special_count" value={specials.length} />
      <input type="hidden" name="price_count" value={prices.length} />

      <div className="grid gap-5 px-4 py-4">
        {locked && (
          <p className="notice">
            该版本自 {version.effective_from} 起生效，是锁定历史。在这里修改并保存会自动创建一个<b>今天（{today}）生效</b>的新版本承接改动，历史行程金额不受影响。
          </p>
        )}

        <FormGrid className="gap-x-3 px-0 pt-0 md:grid-cols-6">
          <TextField
            label="版本名"
            name="name"
            required
            defaultValue={version.name}
            maxLength={120}
            className="md:col-span-3"
          />
          <DateField
            label="生效日期"
            name="effective_from"
            defaultValue={version.effective_from}
            required
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
              价格规则（按趟=终价不叠乘数；按往返/按天=录入打包建议价）
            </p>
            <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={addPrice}>
              <PlusIcon className="mr-0.5 size-3.5" /> 添加价格规则
            </Button>
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
                <th>计价单位</th>
                <th>起点</th>
                <th>终点</th>
                <th>操作</th>
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
                    <CellSelect
                      name={`price_${i}_driver_id`}
                      value={price.driver_id}
                      onChange={value => updatePrice(i, { driver_id: value })}
                      options={driverOptions}
                      ariaLabel={`价格规则 ${i + 1} 适用司机`}
                    />
                  </td>
                  <td>
                    <CellSelect
                      name={`price_${i}_unit`}
                      value={price.unit}
                      onChange={value => updatePrice(i, { unit: value })}
                      options={PRICE_UNITS}
                      ariaLabel={`价格规则 ${i + 1} 计价单位`}
                    />
                  </td>
                  <td>
                    <CellSelect
                      name={`price_${i}_from_class`}
                      value={price.from_class}
                      onChange={value => updatePrice(i, { from_class: value })}
                      options={[{ value: "", label: "任意" }, ...PRICE_CLASSES]}
                      ariaLabel={`价格规则 ${i + 1} 起点`}
                    />
                  </td>
                  <td>
                    <CellSelect
                      name={`price_${i}_to_class`}
                      value={price.to_class}
                      onChange={value => updatePrice(i, { to_class: value })}
                      options={[{ value: "", label: "任意" }, ...PRICE_CLASSES]}
                      ariaLabel={`价格规则 ${i + 1} 终点`}
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
                    无价格规则；固定路线价与打包价都在这里添加
                  </td>
                </tr>
              )}
              {visiblePrices.length === 0 && prices.length > 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    该司机暂无专属价格规则（只显示「所有人」与该司机名下的规则）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              里程档位（司机价；首档 1、按 50 递进）
            </p>
            <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={addTier}>
              <PlusIcon className="mr-0.5 size-3.5" /> 添加档位
            </Button>
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
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              特例路线（5 位邮编对，双向单程同价）
            </p>
            <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={addSpecial}>
              <PlusIcon className="mr-0.5 size-3.5" /> 添加特例
            </Button>
          </div>
          <table>
            <thead>
              <tr>
                <th>邮编 A</th>
                <th>邮编 B</th>
                <th className="num">单程价 ($)</th>
                <th>备注</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {specials.map((special, i) => (
                <tr key={i}>
                  <td>
                    <Input
                      name={`special_${i}_from_postal`}
                      value={special.from_postal}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, from_postal: e.target.value } : s))
                        )
                      }
                      maxLength={10}
                      aria-label={`特例 ${i + 1} 邮编 A`}
                      className={`${cellInput} w-24 font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      name={`special_${i}_to_postal`}
                      value={special.to_postal}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, to_postal: e.target.value } : s))
                        )
                      }
                      maxLength={10}
                      aria-label={`特例 ${i + 1} 邮编 B`}
                      className={`${cellInput} w-24 font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      name={`special_${i}_amount`}
                      min={0}
                      step={0.01}
                      value={special.amount}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, amount: e.target.value } : s))
                        )
                      }
                      aria-label={`特例 ${i + 1} 单程价`}
                      className={`${cellInput} w-28 text-right font-mono`}
                    />
                  </td>
                  <td>
                    <Input
                      name={`special_${i}_note`}
                      value={special.note}
                      onChange={e =>
                        setSpecials(current =>
                          current.map((s, j) => (j === i ? { ...s, note: e.target.value } : s))
                        )
                      }
                      maxLength={255}
                      aria-label={`特例 ${i + 1} 备注`}
                      className={`${cellInput} w-52`}
                    />
                  </td>
                  <td className="actions">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive"
                      onClick={() => setSpecials(current => current.filter((_, j) => j !== i))}
                      aria-label={`删除特例 ${i + 1}`}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {specials.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">无特例路线</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </form>
  );
}
