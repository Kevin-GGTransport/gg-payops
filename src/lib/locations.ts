import { prisma } from "@/lib/prisma";

/** Location codes are short (varchar(16)); free text is uppercased and capped for the code column */
const CODE_MAX = 16;

/**
 * Resolve one submitted endpoint ("loc:<id>" verified against the DB, "txt:<text>"
 * find-or-created as an OTHER location) into a bigint id string; unresolvable
 * endpoints return "" (stored as NULL - entry no longer blocks on them). Map-picked
 * endpoints carry a "|geo:<lat>,<lng>;<street>;<city>;<state>;<zip>" suffix
 * (see location-picker) which enriches the created location with coordinates
 * and structured address fields.
 */
export async function resolveEndpointId(value: string): Promise<string> {
  if (!value) return "";
  if (value.startsWith("loc:")) {
    const id = value.slice(4);
    if (!/^\d+$/.test(id)) return "";
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ops.locations WHERE id = ${id}::bigint LIMIT 1
    `;
    return rows[0]?.id ?? "";
  }
  if (value.startsWith("txt:")) {
    const [addressPart, geoPart] = value.slice(4).split("|geo:");
    const text = addressPart.trim();
    const code = text.toUpperCase().slice(0, CODE_MAX);
    if (!code) return "";
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ops.locations WHERE code = ${code} LIMIT 1
    `;
    if (existing[0]) return existing[0].id;

    // Parse the map payload; anything missing just stays null
    let lat: number | null = null;
    let lng: number | null = null;
    let street: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let zip: string | null = null;
    if (geoPart) {
      const [coords, ...parts] = geoPart.split(";");
      const [latRaw, lngRaw] = coords?.split(",") ?? [];
      const latNum = Number(latRaw);
      const lngNum = Number(lngRaw);
      if (
        Number.isFinite(latNum) &&
        Number.isFinite(lngNum) &&
        latNum >= -90 &&
        latNum <= 90 &&
        lngNum >= -180 &&
        lngNum <= 180
      ) {
        lat = latNum;
        lng = lngNum;
      }
      street = parts[0]?.trim() || null;
      city = parts[1]?.trim() || null;
      zip = parts[3]?.trim() || null;
      const stateRaw = parts[2]?.trim().toUpperCase() || "";
      // Guard the state_codes FK: unknown codes (non-US picks) file as null
      if (stateRaw) {
        const knownState = await prisma.$queryRaw<{ one: number }[]>`
          SELECT 1 AS one FROM ops.state_codes WHERE code = ${stateRaw} LIMIT 1
        `;
        if (knownState[0]) state = stateRaw;
      }
    }

    // Rare race: concurrent insert loses ON CONFLICT and returns nothing -> re-select
    const inserted = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO ops.locations (code, name, location_type, address_line, city, state_code, postal_code, latitude, longitude)
      VALUES (
        ${code}, ${text}, 'OTHER'::ops.location_type,
        ${street ?? text}, ${city}, ${state}, ${zip},
        ${lat}::decimal(9,6), ${lng}::decimal(9,6)
      )
      ON CONFLICT (code) DO NOTHING
      RETURNING id::text
    `;
    if (inserted[0]) return inserted[0].id;
    const again = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ops.locations WHERE code = ${code} LIMIT 1
    `;
    return again[0]?.id ?? "";
  }
  return "";
}

/**
 * Resolve a batch of submitted endpoints in parallel (distinct values only -
 * a sheet's rows repeat the same handful of endpoints, and each value costs
 * up to 4 sequential queries when resolved one by one).
 */
export async function resolveEndpointIds(values: string[]): Promise<Map<string, string>> {
  const distinct = [...new Set(values.filter(Boolean))];
  const resolved = await Promise.all(
    distinct.map(value => resolveEndpointId(value).then(id => [value, id] as const))
  );
  return new Map(resolved);
}
