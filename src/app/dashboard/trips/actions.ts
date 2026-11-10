"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const OPERATIONS = ["DEL", "EMPTY", "BOBTAIL", "LIVE"] as const;

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function backWithError(error: string, formData: FormData): never {
  const params = new URLSearchParams({ error });
  const driverId = str(formData, "driver_id");
  if (driverId) params.set("driver", driverId);
  for (const field of ["driver_id", "trip_date", "operation", "load_no", "from_location_id", "to_location_id", "miles", "pay_amount", "notes"]) {
    const value = str(formData, field);
    if (value) params.set(`f_${field}`, value);
  }
  redirect(`/dashboard/trips?${params.toString()}`);
}

export async function addTrip(formData: FormData) {
  await requireUser();

  const driverId = str(formData, "driver_id");
  const tripDate = str(formData, "trip_date");
  const operation = str(formData, "operation");
  const loadNo = str(formData, "load_no");
  const fromLocationId = str(formData, "from_location_id");
  const toLocationId = str(formData, "to_location_id");
  const milesValue = str(formData, "miles") || "0";
  const payValue = str(formData, "pay_amount") || "0";
  const notes = str(formData, "notes") || null;

  if (!driverId) backWithError("missing_driver", formData);
  if (!tripDate) backWithError("missing_date", formData);
  if (!OPERATIONS.includes(operation as (typeof OPERATIONS)[number])) {
    backWithError("missing_operation", formData);
  }
  if (!loadNo) backWithError("missing_load", formData);

  const milesNum = Number(milesValue);
  if (!Number.isFinite(milesNum) || milesNum < 0) backWithError("bad_miles", formData);

  // Wage snapshot: trust the submitted amount (auto-calculated client-side or
  // hand-edited); no server-side recompute so manual overrides stick
  const payNum = Number(payValue);
  if (!Number.isFinite(payNum) || payNum < 0) backWithError("bad_pay", formData);

  // Guard against accidental double entry: same driver + date + operation + same from/to counts as duplicate
  const dup = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM pay.trips
    WHERE driver_id = ${driverId}::bigint
      AND trip_date = ${tripDate}::date
      AND operation = ${operation}::ops.operation_type
      AND from_location_id IS NOT DISTINCT FROM ${fromLocationId || null}::bigint
      AND to_location_id IS NOT DISTINCT FROM ${toLocationId || null}::bigint
    LIMIT 1
  `;
  if (dup.length > 0) backWithError("dup_trip", formData);

  await prisma.$executeRaw`
    INSERT INTO pay.trips(
      driver_id, trip_date, operation, load_no,
      from_location_id, to_location_id, miles, pay_amount, notes
    )
    VALUES (
      ${driverId}::bigint, ${tripDate}::date, ${operation}::ops.operation_type, ${loadNo},
      ${fromLocationId || null}::bigint, ${toLocationId || null}::bigint, ${milesNum},
      ${Math.round(payNum * 100) / 100}, ${notes}
    )
  `;

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  // After saving, filter by that driver so the new trip (sorted first) is immediately visible
  redirect(`/dashboard/trips?driver=${driverId}`);
}

export async function deleteTrip(formData: FormData) {
  await requireUser();
  const id = str(formData, "id");
  const returnTo = str(formData, "return_to");
  const backTo = `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
  if (!id) redirect(backTo);

  await prisma.$executeRaw`DELETE FROM pay.trips WHERE id = ${id}::bigint`;

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  redirect(backTo);
}

export async function deleteTripsBatch(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("selected").map(String).filter(Boolean);
  const returnTo = str(formData, "return_to");
  const backTo = `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
  if (ids.length === 0) redirect(backTo);

  await prisma.$executeRaw`DELETE FROM pay.trips WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))})`;

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  redirect(backTo);
}
