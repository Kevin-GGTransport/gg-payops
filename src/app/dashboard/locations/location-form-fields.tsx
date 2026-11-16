"use client";

import * as React from "react";

import { ComboboxField } from "@/components/combobox-field";
import { FormGrid, NumberField, TextField } from "@/components/form-fields";
import { LOCATION_TYPE_LABELS, type LocationType } from "@/lib/labels";

const VALID_TYPES = Object.keys(LOCATION_TYPE_LABELS) as LocationType[];

const CLASS_OPTIONS = [
  { value: "", label: "未分类" },
  { value: "A", label: "A类" },
  { value: "B", label: "B类" }
] as const;

/**
 * Location dictionary fields with type-linked pricing columns: Amazon
 * warehouses get the A/B class selector (wage route matcher) and have their
 * standard price managed on /dashboard/wage-rules; every other type keeps the
 * per-location standard pay field here (BASE-leg pricing for odd stops like
 * Walmart). Client-side so the fields follow the picked type live.
 */
export function LocationFormFields({
  values
}: {
  values: {
    code: string;
    name: string;
    type: string;
    pay: string;
    amazonClass: string;
    addressLine: string;
    city: string;
    stateCode: string;
    postalCode: string;
  };
}) {
  const [type, setType] = React.useState<string>(
    VALID_TYPES.includes(values.type as LocationType) ? values.type : "AMAZON"
  );
  const isAmazon = type === "AMAZON";

  return (
    <FormGrid>
      <TextField label="代码" name="code" required placeholder="如 ONT8" defaultValue={values.code} maxLength={16} />
      <TextField label="名称" name="name" required placeholder="如 Ontario 亚马逊仓" defaultValue={values.name} maxLength={120} />
      <ComboboxField
        label="类型"
        name="location_type"
        defaultValue={type}
        placeholder="请选择类型"
        clearable={false}
        searchable={false}
        onValueChange={setType}
        options={VALID_TYPES.map(t => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))}
      />
      {isAmazon ? (
        <>
          <label className="grid content-start gap-1.5 text-[13px] font-medium">
            类别
            <select
              name="amazon_class"
              defaultValue={values.amazonClass}
              aria-label="Amazon 仓类别"
              className="h-9 rounded-md border border-line bg-transparent px-3 text-[13px] font-normal focus-visible:ring-1"
            >
              {CLASS_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] font-normal text-muted-foreground">
              工资规则按类别匹配（ST ↔ A类/B类）；标准价在工资规则页维护
            </span>
          </label>
        </>
      ) : (
        <NumberField label="基准金额（$，基地往返一趟）" name="standard_pay_amount" min={0} step={0.01} defaultValue={values.pay} />
      )}
      <TextField label="街道地址" name="address_line" placeholder="如 25503 Industrial Blvd" defaultValue={values.addressLine} maxLength={255} />
      <TextField label="城市" name="city" placeholder="如 Hayward" defaultValue={values.city} maxLength={80} />
      <TextField label="州" name="state_code" placeholder="如 CA" defaultValue={values.stateCode} maxLength={2} />
      <TextField label="邮编" name="postal_code" placeholder="如 94545" defaultValue={values.postalCode} maxLength={16} />
    </FormGrid>
  );
}
