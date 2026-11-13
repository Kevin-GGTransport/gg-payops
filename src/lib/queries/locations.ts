import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LocationType, RecordStatus } from "@/lib/labels";
import { fullAddress } from "@/lib/format";

export type LocationRow = {
  id: string;
  code: string;
  name: string;
  location_type: LocationType;
  address_line: string | null;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  latitude: string | null;
  longitude: string | null;
  standard_pay_amount: string;
  status: RecordStatus;
};

export async function listLocations(filter: { type: LocationType | "all"; q: string }) {
  const typeClause = filter.type === "all"
    ? Prisma.sql``
    : Prisma.sql` AND l.location_type = ${filter.type}::ops.location_type`;
  const qPattern = `%${filter.q}%`;
  const qClause = filter.q
    ? Prisma.sql` AND (l.code ILIKE ${qPattern} OR l.name ILIKE ${qPattern})`
    : Prisma.sql``;

  return prisma.$queryRaw<LocationRow[]>`
    SELECT l.id::text, l.code, l.name, l.location_type::text AS location_type,
           l.address_line, l.city, l.state_code, l.postal_code,
           l.latitude::text AS latitude, l.longitude::text AS longitude,
           l.standard_pay_amount::text, l.status::text AS status
    FROM ops.locations l
    WHERE 1 = 1 ${typeClause} ${qClause}
    ORDER BY l.status = 'ACTIVE' DESC, l.location_type, l.code
  `;
}

export async function getLocationById(id: string) {
  const rows = await prisma.$queryRaw<LocationRow[]>`
    SELECT l.id::text, l.code, l.name, l.location_type::text AS location_type,
           l.address_line, l.city, l.state_code, l.postal_code,
           l.latitude::text AS latitude, l.longitude::text AS longitude,
           l.standard_pay_amount::text, l.status::text AS status
    FROM ops.locations l WHERE l.id = ${id}::bigint LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function locationTypeCounts() {
  const rows = await prisma.$queryRaw<Record<"total" | LocationType, bigint>[]>`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE location_type = 'BASE') AS "BASE",
      count(*) FILTER (WHERE location_type = 'AMAZON') AS "AMAZON",
      count(*) FILTER (WHERE location_type = 'OTHER') AS "OTHER"
    FROM ops.locations
  `;
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    BASE: Number(row?.BASE ?? 0),
    AMAZON: Number(row?.AMAZON ?? 0),
    OTHER: Number(row?.OTHER ?? 0)
  };
}

/** Picker options: address flattened to one line for display */
export async function activeLocationOptions() {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      code: string;
      name: string;
      location_type: string;
      address_line: string | null;
      city: string | null;
      state_code: string | null;
      postal_code: string | null;
      standard_pay_amount: string;
    }>
  >`
    SELECT id::text, code, name, location_type::text AS location_type,
           address_line, city, state_code, postal_code, standard_pay_amount::text
    FROM ops.locations
    WHERE status = 'ACTIVE'
    ORDER BY CASE location_type WHEN 'BASE' THEN 1 WHEN 'AMAZON' THEN 2 ELSE 3 END, code
  `;
  return rows.map(({ location_type, address_line, city, state_code, postal_code, standard_pay_amount, ...rest }) => ({
    ...rest,
    postal_code,
    location_type: location_type as LocationType,
    standard_pay_amount: Number(standard_pay_amount),
    address: fullAddress({ address_line, city, state_code, postal_code }) || null
  }));
}
