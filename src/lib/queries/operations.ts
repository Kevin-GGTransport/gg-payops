import { prisma } from "@/lib/prisma";
import type { RecordStatus } from "@/lib/labels";

export type OperationTypeRow = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_system: boolean;
  requires_load: boolean;
  status: RecordStatus;
  /** Trips referencing this code (delete guard / roster display) */
  trip_count: number;
};

export async function listOperationTypes(): Promise<OperationTypeRow[]> {
  return prisma.$queryRaw<OperationTypeRow[]>`
    SELECT t.id::text, t.code, t.label, t.description, t.sort_order,
           t.is_system, t.requires_load, t.status::text AS status,
           (SELECT count(*) FROM pay.trips x WHERE x.operation = t.code)::int AS trip_count
    FROM ops.operation_types t
    ORDER BY t.sort_order, t.code
  `;
}

export async function getOperationTypeById(id: string): Promise<OperationTypeRow | null> {
  const rows = await prisma.$queryRaw<OperationTypeRow[]>`
    SELECT t.id::text, t.code, t.label, t.description, t.sort_order,
           t.is_system, t.requires_load, t.status::text AS status,
           (SELECT count(*) FROM pay.trips x WHERE x.operation = t.code)::int AS trip_count
    FROM ops.operation_types t
    WHERE t.id = ${id}::bigint
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Picker/filter options: ACTIVE dictionary rows in sort order */
export async function activeOperationOptions() {
  const rows = await prisma.$queryRaw<
    Array<{ code: string; label: string; description: string | null; requires_load: boolean }>
  >`
    SELECT code, label, description, requires_load
    FROM ops.operation_types
    WHERE status = 'ACTIVE'
    ORDER BY sort_order, code
  `;
  return rows;
}
