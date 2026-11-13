"use client";

import * as React from "react";
import { MapPointPicker, type MapPick } from "@/components/map-point-picker";

/**
 * In-form map picker for the locations page: every pick (search / click /
 * drag) reverse-fills the sibling address inputs (street / city / state /
 * zip) and records the coordinates into hidden inputs the server action
 * saves. Code / name / type / pay stay manual - the map is an assistant,
 * never a blocker.
 */

/** Address components -> the form's geo fields; missing parts never overwrite */
function addressWrites(components: google.maps.GeocoderAddressComponent[]) {
  const byType = (type: string) => components.find(c => c.types.includes(type));
  const street = [byType("street_number")?.long_name, byType("route")?.long_name]
    .filter(Boolean)
    .join(" ");
  const city =
    byType("locality")?.long_name ??
    byType("postal_town")?.long_name ??
    byType("sublocality")?.long_name ??
    "";
  return [
    ["address_line", street],
    ["city", city],
    ["state_code", byType("administrative_area_level_1")?.short_name ?? ""],
    ["postal_code", byType("postal_code")?.long_name ?? ""]
  ] as const;
}

/** Write into the sibling uncontrolled inputs the server action later reads */
function fillAddressFields(
  form: HTMLFormElement,
  components: google.maps.GeocoderAddressComponent[]
) {
  for (const [name, value] of addressWrites(components)) {
    if (!value) continue;
    const el = form.elements.namedItem(name);
    if (el instanceof HTMLInputElement) el.value = value;
  }
}

export function MapPicker({
  initialLat,
  initialLng
}: {
  /** Saved coordinates to open on (edit mode); null opens on the default view */
  initialLat?: number | null;
  initialLng?: number | null;
}) {
  const [point, setPoint] = React.useState<{ lat: number; lng: number } | null>(
    typeof initialLat === "number" && typeof initialLng === "number"
      ? { lat: initialLat, lng: initialLng }
      : null
  );
  // This wrapper renders inside the location form, so its root finds it
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  function handlePick(pick: MapPick) {
    setPoint(pick);
    const form = rootRef.current?.closest("form");
    if (form && pick.components.length > 0) fillAddressFields(form, pick.components);
  }

  return (
    <div ref={rootRef} className="grid gap-2">
      <MapPointPicker initialLat={initialLat} initialLng={initialLng} onPick={handlePick} />
      <input type="hidden" name="latitude" value={point?.lat ?? ""} />
      <input type="hidden" name="longitude" value={point?.lng ?? ""} />
    </div>
  );
}
