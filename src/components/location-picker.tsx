"use client";

import { ComboboxField } from "@/components/combobox-field";
import { LOCATION_TYPE_LABELS, type LocationType } from "@/lib/labels";

export type LocationOption = {
  id: string;
  code: string;
  name: string;
  location_type: LocationType;
  address: string | null;
  /** Driver standard pay for this location; prices the trip leg (0 = unset) */
  standard_pay_amount: number;
};

/** Max length of a hand-typed location text (kept short so it fits locations.code) */
export const FREE_TEXT_MAX = 48;

type LocationPickerProps = {
  /** Field label; omit inside tables (column headers already label the cell) */
  label?: string;
  /** Form field name (trip from/to); submits "loc:<id>" / "txt:<text>", empty string for none */
  name: string;
  locations: LocationOption[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  /** Allow picking the raw typed text when nothing matches (saved server-side on submit) */
  creatable?: boolean;
  /** Notified on every pick, including clearing (empty string) */
  onValueChange?: (value: string) => void;
  "aria-label"?: string;
};

/**
 * Location picker: mono code + address, grouped by type. In creatable mode the
 * search box doubles as free-text entry - no match offers 使用 “文本” which
 * submits as txt:<text> and is filed as an OTHER location server-side.
 */
export function LocationPicker({
  label,
  name,
  locations,
  defaultValue = "",
  placeholder = "不指定",
  className,
  triggerClassName,
  creatable = false,
  onValueChange,
  ...rest
}: LocationPickerProps) {
  return (
    <ComboboxField
      label={label}
      name={name}
      className={className}
      triggerClassName={triggerClassName}
      defaultValue={defaultValue}
      placeholder={placeholder}
      searchPlaceholder="搜索代码、地址，或直接输入"
      mono
      onValueChange={onValueChange}
      labelForValue={value => (value.startsWith("txt:") ? value.slice(4) : undefined)}
      aria-label={rest["aria-label"] ?? (label ? `选择${label}` : undefined)}
      options={locations.map(l => ({
        value: `loc:${l.id}`,
        label: l.code,
        description: l.address ?? l.name,
        group: LOCATION_TYPE_LABELS[l.location_type]
      }))}
      customOption={
        creatable
          ? text => ({
              value: `txt:${text.slice(0, FREE_TEXT_MAX)}`,
              label: `使用 “${text.slice(0, FREE_TEXT_MAX)}”`,
              description: "手动输入的地点，提交后自动存档"
            })
          : undefined
      }
    />
  );
}
