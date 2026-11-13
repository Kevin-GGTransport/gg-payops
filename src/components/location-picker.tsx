"use client";

import * as React from "react";
import { MapPinIcon } from "lucide-react";
import { ComboboxField } from "@/components/combobox-field";
import { MapPointPicker, type MapPick } from "@/components/map-point-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LOCATION_TYPE_LABELS, type LocationType } from "@/lib/labels";

export type LocationOption = {
  id: string;
  code: string;
  name: string;
  location_type: LocationType;
  address: string | null;
  /** USPS zip; feeds special-route pricing (free-text zip legs) */
  postal_code: string | null;
  /** Driver standard pay for this location; prices the trip leg (0 = unset) */
  standard_pay_amount: number;
};

/** Max length of a hand-typed location text (kept short so it fits locations.code) */
export const FREE_TEXT_MAX = 48;
/** Map-picked addresses run against locations.name (varchar(120)) */
const MAP_ADDRESS_MAX = 120;
/** Marker separating the address text from the geocode payload */
const GEO_SUFFIX = "|geo:";

/** Component extract for reuse across hint contexts */
function componentByType(
  components: google.maps.GeocoderAddressComponent[],
  type: string
) {
  return components.find(c => c.types.includes(type));
}

/** MapPick -> "txt:<address>|geo:<lat>,<lng>;<street>;<city>;<state>;<zip>" */
export function encodeMapPick(pick: MapPick): string {
  const clean = (s: string | undefined) => (s ?? "").replaceAll("|", " ").replaceAll(";", " ").trim();
  const address = clean(pick.label).slice(0, MAP_ADDRESS_MAX);
  // Without a resolved address there is nothing to file or geocode server-side
  if (!address) return "";
  const street = clean(
    [
      componentByType(pick.components, "street_number")?.long_name,
      componentByType(pick.components, "route")?.long_name
    ]
      .filter(Boolean)
      .join(" ")
  );
  const city = clean(
    componentByType(pick.components, "locality")?.long_name ??
      componentByType(pick.components, "postal_town")?.long_name ??
      componentByType(pick.components, "sublocality")?.long_name
  );
  const state = clean(componentByType(pick.components, "administrative_area_level_1")?.short_name);
  const zip = clean(componentByType(pick.components, "postal_code")?.long_name);
  return `txt:${address}${GEO_SUFFIX}${pick.lat},${pick.lng};${street};${city};${state};${zip}`;
}

/** Display/geocode-safe address: everything before the geo payload */
export function stripGeoSuffix(value: string): string {
  const at = value.indexOf(GEO_SUFFIX);
  return at >= 0 ? value.slice(0, at) : value;
}

type LocationPickerProps = {
  /** Field label; omit inside tables (column headers already label the cell) */
  label?: string;
  /** Form field name (trip from/to); submits "loc:<id>" / "txt:<text>", empty string for none */
  name: string;
  locations: LocationOption[];
  defaultValue?: string;
  /** Controlled value (see ComboboxField); carry-over starts use this */
  value?: string;
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
 * search box doubles as free-text entry - no match offers 使用 "文本" which
 * submits as txt:<text> and is filed as an OTHER location server-side - and a
 * 地图选点 action opens the map (search / click / drag) whose pick submits as
 * txt:<address>|geo:<lat>,<lng>;… carrying coordinates + address components.
 */
export function LocationPicker({
  label,
  name,
  locations,
  defaultValue = "",
  value,
  placeholder = "不指定",
  className,
  triggerClassName,
  creatable = false,
  onValueChange,
  ...rest
}: LocationPickerProps) {
  // Own state so the map dialog can write the value; stays controlled when
  // the host drives it (entry-form carry-over starts)
  const [internal, setInternal] = React.useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;
  const [mapOpen, setMapOpen] = React.useState(false);
  const [mapPick, setMapPick] = React.useState<MapPick | null>(null);

  function commit(next: string) {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
  }

  function openMap(closePopover: () => void) {
    closePopover();
    setMapPick(null);
    setMapOpen(true);
  }

  function confirmMapPick() {
    if (!mapPick) return;
    const encoded = encodeMapPick(mapPick);
    if (encoded) commit(encoded);
    setMapOpen(false);
    setMapPick(null);
  }

  return (
    <>
      <ComboboxField
        label={label}
        name={name}
        className={className}
        triggerClassName={triggerClassName}
        defaultValue={defaultValue}
        value={current}
        placeholder={placeholder}
        searchPlaceholder="搜索代码、地址，或直接输入"
        mono
        onValueChange={commit}
        labelForValue={v => (v.startsWith("txt:") ? stripGeoSuffix(v.slice(4)) : undefined)}
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
        footerAction={
          creatable
            ? ({ close }) => (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-accent"
                  onClick={() => openMap(close)}
                >
                  <MapPinIcon className="size-4 shrink-0 opacity-60" />
                  地图选点
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    搜索或点选地图位置
                  </span>
                </button>
              )
            : undefined
        }
      />

      {/* Radix unmounts closed dialog content, so the map starts fresh per open */}
      <Dialog open={mapOpen} onOpenChange={open => (open ? setMapOpen(true) : setMapOpen(false))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>地图选点</DialogTitle>
          </DialogHeader>
          <MapPointPicker
            heightClass="h-64"
            onPick={setMapPick}
            hintFor={({ picked, resolving, point, label: pickedLabel }) =>
              resolving
                ? "解析地址中…"
                : picked && pickedLabel
                  ? `已选：${pickedLabel}`
                  : picked && point
                    ? `坐标 ${point.lat}, ${point.lng} · 无解析地址`
                    : "搜索地址或点击地图选点，选点后点「使用该地点」"
            }
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMapOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!mapPick || !mapPick.label}
              onClick={confirmMapPick}
            >
              使用该地点
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
