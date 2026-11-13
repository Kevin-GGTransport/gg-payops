import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RecordStatus } from "@/lib/labels";

export type TruckRow = {
  id: string;
  truck_code: string;
  plate_no: string | null;
  truck_type: string | null;
  capacity_note: string | null;
  status: RecordStatus;
  notes: string | null;
  /** Current open ownership row id; null = 归属未登记 */
  ownership_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  /** Latest odometer reading (表显里程) and its date */
  odometer: string | null;
  odometer_date: string | null;
};

export type OwnershipRow = {
  id: string;
  owner_id: string | null;
  owner_name: string | null;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
};

export type OdometerRow = {
  id: string;
  reading_date: string;
  odometer: string;
  note: string | null;
};

const TRUCK_SELECT = Prisma.sql`
  SELECT t.id::text, t.truck_code, t.plate_no, t.truck_type, t.capacity_note,
         t.status::text AS status, t.notes,
         o.id::text AS ownership_id,
         o.owner_driver_id::text AS owner_id,
         d.full_name AS owner_name,
         r.odometer::text AS odometer,
         to_char(r.reading_date, 'MM-DD') AS odometer_date
  FROM ops.trucks t
  LEFT JOIN ops.truck_ownerships o ON o.truck_id = t.id AND o.valid_to IS NULL
  LEFT JOIN ops.drivers d ON d.id = o.owner_driver_id
  LEFT JOIN LATERAL (
    SELECT odometer, reading_date
    FROM ops.truck_odometer_readings
    WHERE truck_id = t.id
    ORDER BY reading_date DESC, id DESC
    LIMIT 1
  ) r ON true
`;

export async function listTrucks(filter: {
  own: "all" | "company" | "owner";
  q: string;
}) {
  // 公司自有 = 有归属行且无车主；车主 = 有归属行且有车主；未登记的只在「全部」出现
  const ownClause =
    filter.own === "all"
      ? Prisma.sql``
      : filter.own === "company"
        ? Prisma.sql` AND o.id IS NOT NULL AND o.owner_driver_id IS NULL`
        : Prisma.sql` AND o.owner_driver_id IS NOT NULL`;
  const qPattern = `%${filter.q}%`;
  const qClause = filter.q
    ? Prisma.sql` AND (t.truck_code ILIKE ${qPattern} OR t.plate_no ILIKE ${qPattern} OR t.truck_type ILIKE ${qPattern} OR d.full_name ILIKE ${qPattern})`
    : Prisma.sql``;

  return prisma.$queryRaw<TruckRow[]>`
    ${TRUCK_SELECT}
    WHERE 1 = 1 ${ownClause} ${qClause}
    ORDER BY t.status = 'ACTIVE' DESC, t.truck_code
  `;
}

export async function getTruckById(id: string) {
  const rows = await prisma.$queryRaw<TruckRow[]>`
    ${TRUCK_SELECT} WHERE t.id = ${id}::bigint LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function truckOwnershipCounts() {
  const rows = await prisma.$queryRaw<
    { total: bigint; company: bigint; owner: bigint }[]
  >`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE o.id IS NOT NULL AND o.owner_driver_id IS NULL) AS company,
           count(*) FILTER (WHERE o.owner_driver_id IS NOT NULL) AS owner
    FROM ops.trucks t
    LEFT JOIN ops.truck_ownerships o ON o.truck_id = t.id AND o.valid_to IS NULL
  `;
  return {
    total: Number(rows[0]?.total ?? 0),
    company: Number(rows[0]?.company ?? 0),
    owner: Number(rows[0]?.owner ?? 0)
  };
}

export async function truckOwnershipHistory(truckId: string) {
  return prisma.$queryRaw<OwnershipRow[]>`
    SELECT o.id::text, o.owner_driver_id::text AS owner_id,
           d.full_name AS owner_name,
           to_char(o.valid_from, 'YYYY-MM-DD') AS valid_from,
           to_char(o.valid_to, 'YYYY-MM-DD') AS valid_to,
           o.note
    FROM ops.truck_ownerships o
    LEFT JOIN ops.drivers d ON d.id = o.owner_driver_id
    WHERE o.truck_id = ${truckId}::bigint
    ORDER BY o.valid_from DESC, o.id DESC
  `;
}

export async function truckOdometerHistory(truckId: string) {
  return prisma.$queryRaw<OdometerRow[]>`
    SELECT id::text, to_char(reading_date, 'YYYY-MM-DD') AS reading_date,
           odometer::text AS odometer, note
    FROM ops.truck_odometer_readings
    WHERE truck_id = ${truckId}::bigint
    ORDER BY reading_date DESC, id DESC
  `;
}

/** Owner picker options: active OWNER-type drivers */
export async function activeOwnerOptions() {
  return prisma.$queryRaw<{ id: string; full_name: string; phone: string | null }[]>`
    SELECT id::text, full_name, phone
    FROM ops.drivers
    WHERE driver_type = 'OWNER' AND status = 'ACTIVE'
    ORDER BY full_name
  `;
}

/** Trip-entry truck picker options: active trucks */
export async function activeTruckOptions() {
  return prisma.$queryRaw<
    { id: string; truck_code: string; plate_no: string | null; truck_type: string | null }[]
  >`
    SELECT id::text, truck_code, plate_no, truck_type
    FROM ops.trucks
    WHERE status = 'ACTIVE'
    ORDER BY truck_code
  `;
}
