"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { todayIso, isoPlusDays } from "@/lib/format";

const FIELDS = [
  "truck_code",
  "plate_no",
  "truck_type",
  "capacity_note",
  "notes",
  "ownership_kind",
  "owner_driver_id"
] as const;

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function backWithError(error: string, formData: FormData): never {
  const params = new URLSearchParams();
  const id = str(formData, "id");
  if (id) params.set("edit", id);
  params.set("error", error);
  for (const field of FIELDS) {
    const value = str(formData, field);
    if (value) params.set(`f_${field}`, value);
  }
  redirect(`/dashboard/trucks?${params.toString()}`);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toString() !== "Invalid Date";
}

/**
 * Apply the ownership change: close the open row (valid_to = day before the
 * new row's valid_from, never before its own valid_from) and open a new one.
 * Unchanged ownership writes nothing.
 */
async function applyOwnership(truckId: string, ownerDriverId: string | null) {
  const desired = ownerDriverId ?? null;
  const open = await prisma.$queryRaw<{ id: string; owner_driver_id: string | null }[]>`
    SELECT id::text, owner_driver_id::text AS owner_driver_id
    FROM ops.truck_ownerships
    WHERE truck_id = ${truckId}::bigint AND valid_to IS NULL
    LIMIT 1
  `;
  // No-op only when an open row already matches; a truck with no open row
  // gets one even for company ownership (未登记 ≠ 公司自有)
  if (open[0] && (open[0].owner_driver_id ?? null) === desired) return;

  const today = todayIso();
  const yesterday = isoPlusDays(today, -1);
  await prisma.$transaction(async tx => {
    if (open[0]) {
      // GREATEST keeps the period check intact on a same-day re-change
      await tx.$executeRaw`
        UPDATE ops.truck_ownerships
        SET valid_to = GREATEST(valid_from, ${yesterday}::date), updated_at = now()
        WHERE id = ${open[0].id}::bigint
      `;
    }
    await tx.$executeRaw`
      INSERT INTO ops.truck_ownerships(truck_id, owner_driver_id, valid_from)
      VALUES (${truckId}::bigint, ${desired}::bigint, ${today}::date)
    `;
  });
}

export async function saveTruck(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const code = str(formData, "truck_code").toUpperCase();
  const plateNo = str(formData, "plate_no") || null;
  const truckType = str(formData, "truck_type") || null;
  const capacityNote = str(formData, "capacity_note") || null;
  const notes = str(formData, "notes") || null;
  const ownershipKind = str(formData, "ownership_kind");
  const ownerDriverId = str(formData, "owner_driver_id") || null;
  const returnTo = str(formData, "return_to");

  if (!code) backWithError("missing_code", formData);
  // Radio always submits; anything but "owner" (missing/blank) means company
  const desiredOwner = ownershipKind === "owner" ? ownerDriverId : null;
  if (desiredOwner) {
    const owners = await prisma.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM ops.drivers
      WHERE id = ${desiredOwner}::bigint
        AND driver_type = 'OWNER' AND status = 'ACTIVE'
      LIMIT 1
    `;
    if (owners.length === 0) backWithError("owner_invalid", formData);
  }

  const conflicts = id
    ? await prisma.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM ops.trucks
        WHERE truck_code = ${code}
          AND id <> ${id}::bigint
        LIMIT 1
      `
    : await prisma.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM ops.trucks
        WHERE truck_code = ${code}
        LIMIT 1
      `;
  if (conflicts.length > 0) backWithError("dup_code", formData);

  let truckId = id;
  let duplicate = false;
  try {
    if (id) {
      await prisma.$executeRaw`
        UPDATE ops.trucks SET
          truck_code = ${code},
          plate_no = ${plateNo},
          truck_type = ${truckType},
          capacity_note = ${capacityNote},
          notes = ${notes},
          updated_at = now()
        WHERE id = ${id}::bigint
      `;
    } else {
      const inserted = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO ops.trucks(truck_code, plate_no, truck_type, capacity_note, notes)
        VALUES (${code}, ${plateNo}, ${truckType}, ${capacityNote}, ${notes})
        RETURNING id::text
      `;
      truckId = inserted[0].id;
    }
  } catch (error) {
    const err = error as { message?: unknown };
    if (typeof err.message === "string" && err.message.includes("23505")) {
      duplicate = true;
    } else {
      throw error;
    }
  }

  if (duplicate) backWithError("dup_code", formData);
  await applyOwnership(truckId, desiredOwner);

  revalidatePath("/dashboard/trucks");
  revalidatePath("/dashboard");
  redirect(returnTo ? `/dashboard/trucks?${returnTo}` : "/dashboard/trucks");
}

export async function setTruckStatus(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const status = str(formData, "status");
  const returnTo = str(formData, "return_to");

  if (!id || !["ACTIVE", "INACTIVE"].includes(status)) {
    redirect(returnTo ? `/dashboard/trucks?${returnTo}` : "/dashboard/trucks");
  }

  await prisma.$executeRaw`
    UPDATE ops.trucks
    SET status = ${status}::common.record_status, updated_at = now()
    WHERE id = ${id}::bigint
  `;

  revalidatePath("/dashboard/trucks");
  revalidatePath("/dashboard");
  redirect(returnTo ? `/dashboard/trucks?${returnTo}` : "/dashboard/trucks");
}

export async function addOdometerReading(formData: FormData) {
  await requireUser();

  const truckId = str(formData, "truck_id");
  const readingDate = str(formData, "reading_date");
  const odometer = str(formData, "odometer");
  const note = str(formData, "note") || null;
  const returnTo = str(formData, "return_to");

  const backToModal = () =>
    `/dashboard/trucks?odo=${truckId}${returnTo ? `&${returnTo}` : ""}`;

  if (!truckId) redirect(returnTo ? `/dashboard/trucks?${returnTo}` : "/dashboard/trucks");
  if (!isIsoDate(readingDate)) redirect(`${backToModal()}&error=bad_date`);
  const value = Number(odometer);
  if (!Number.isFinite(value) || value < 0) redirect(`${backToModal()}&error=bad_odometer`);

  await prisma.$executeRaw`
    INSERT INTO ops.truck_odometer_readings(truck_id, reading_date, odometer, note)
    VALUES (${truckId}::bigint, ${readingDate}::date, ${value}, ${note})
  `;

  revalidatePath("/dashboard/trucks");
  redirect(backToModal());
}

export async function deleteOdometerReading(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const truckId = str(formData, "truck_id");
  const returnTo = str(formData, "return_to");

  if (id && truckId) {
    await prisma.$executeRaw`
      DELETE FROM ops.truck_odometer_readings
      WHERE id = ${id}::bigint AND truck_id = ${truckId}::bigint
    `;
  }

  revalidatePath("/dashboard/trucks");
  redirect(`/dashboard/trucks?odo=${truckId}${returnTo ? `&${returnTo}` : ""}`);
}
