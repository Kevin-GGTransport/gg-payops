"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormGrid, NumberField, TextField } from "@/components/form-fields";
import type { WageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { updateVersion } from "./actions";

type TierRow = { miles_from: string; amount: string };
type SpecialRow = { from_postal: string; to_postal: string; amount: string; note: string };

const cellInput =
  "h-8 border-0 bg-transparent px-2 shadow-none rounded-none text-[13px] focus-visible:ring-1";

/** Whole-version editor for a PENDING version: dynamic tier/special rows
 *  submit positional FormData (same convention as the entry sheet).
 *  The save button lives in the modal's pinned footer via form="wage-version-edit". */
export function VersionForm({ version }: { version: WageRuleVersionDetail }) {
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

  return (
    <form id="wage-version-edit" action={updateVersion} aria-label="版本编辑">
      <input type="hidden" name="id" value={version.id} />
      <input type="hidden" name="tier_count" value={tiers.length} />
      <input type="hidden" name="special_count" value={specials.length} />

      <div className="grid gap-5 px-5 py-4">
        <FormGrid className="gap-x-3 px-0 pt-0 md:grid-cols-6">
          <TextField
            label="版本名"
            name="name"
            required
            defaultValue={version.name}
            maxLength={120}
            className="md:col-span-3"
          />
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground md:col-span-3">
            生效日期
            <Input
              type="date"
              name="effective_from"
              defaultValue={version.effective_from}
              required
              aria-label="生效日期"
              className="h-9 font-mono text-[13px]"
            />
          </label>
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
