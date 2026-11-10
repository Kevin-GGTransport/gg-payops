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

type LocationPickerProps = {
  label: string;
  /** Form field name (trip from/to); submits the location id, empty string for none */
  name: string;
  locations: LocationOption[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  /** Notified on every pick, including clearing (empty string) */
  onValueChange?: (value: string) => void;
};

/** Location picker: thin ComboboxField wrapper - mono code + address, grouped by type */
export function LocationPicker({
  label,
  name,
  locations,
  defaultValue = "",
  placeholder = "不指定",
  className,
  onValueChange
}: LocationPickerProps) {
  return (
    <ComboboxField
      label={label}
      name={name}
      className={className}
      defaultValue={defaultValue}
      placeholder={placeholder}
      searchPlaceholder="搜索代码或地址"
      mono
      onValueChange={onValueChange}
      options={locations.map(l => ({
        value: l.id,
        label: l.code,
        description: l.address ?? l.name,
        group: LOCATION_TYPE_LABELS[l.location_type]
      }))}
    />
  );
}
