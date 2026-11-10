import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DriverType, RecordStatus } from "@/lib/labels";

export type DriverRow = {
  id: string;
  driver_code: string;
  full_name: string;
  driver_type: DriverType;
  phone: string | null;
  license_no: string | null;
  license_class: string | null;
  license_expires_on: string | null;
  hire_date: string | null;
  status: RecordStatus;
  notes: string | null;
};

const DRIVER_SELECT = Prisma.sql`
  SELECT d.id::text, d.driver_code, d.full_name, d.driver_type::text AS driver_type,
         d.phone, d.license_no, d.license_class,
         to_char(d.license_expires_on, 'YYYY-MM-DD') AS license_expires_on,
         to_char(d.hire_date, 'YYYY-MM-DD') AS hire_date,
         d.status::text AS status, d.notes
  FROM ops.drivers d
`;

export async function listDrivers(filter: {
  type: DriverType | "all";
  q: string;
}) {
  const typeClause = filter.type === "all"
    ? Prisma.sql``
    : Prisma.sql` AND d.driver_type = ${filter.type.toUpperCase()}::ops.driver_type`;
  const qPattern = `%${filter.q}%`;
  const qClause = filter.q
    ? Prisma.sql` AND (d.full_name ILIKE ${qPattern} OR d.driver_code ILIKE ${qPattern} OR d.phone ILIKE ${qPattern} OR d.license_no ILIKE ${qPattern})`
    : Prisma.sql``;

  return prisma.$queryRaw<DriverRow[]>`
    ${DRIVER_SELECT}
    WHERE 1 = 1 ${typeClause} ${qClause}
    ORDER BY d.status = 'ACTIVE' DESC, d.driver_code
  `;
}

export async function getDriverById(id: string) {
  const rows = await prisma.$queryRaw<DriverRow[]>`
    ${DRIVER_SELECT} WHERE d.id = ${id}::bigint LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function driverTypeCounts() {
  const rows = await prisma.$queryRaw<{ total: bigint; driver_count: bigint; owner_count: bigint }[]>`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE driver_type = 'DRIVER') AS driver_count,
           count(*) FILTER (WHERE driver_type = 'OWNER') AS owner_count
    FROM ops.drivers
  `;
  return {
    total: Number(rows[0]?.total ?? 0),
    driver: Number(rows[0]?.driver_count ?? 0),
    owner: Number(rows[0]?.owner_count ?? 0)
  };
}

export async function activeDriverOptions() {
  return prisma.$queryRaw<{ id: string; driver_code: string; full_name: string; driver_type: DriverType }[]>`
    SELECT id::text, driver_code, full_name, driver_type::text AS driver_type
    FROM ops.drivers WHERE status = 'ACTIVE'
    ORDER BY driver_type, driver_code
  `;
}
