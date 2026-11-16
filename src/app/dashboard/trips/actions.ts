"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { resolveEndpointId } from "@/lib/locations";
import { getTripById } from "@/lib/queries/trips";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toString() !== "Invalid Date";
}

/** Bad or negative numbers fall back to 0 - same lenient semantics as entry */
function num0(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Edit one trip. Validation-free like entry: invalid date / unknown operation
 * keep the stored value, bad numbers become 0, blank endpoints clear to NULL,
 * bare endpoint text is find-or-created as a location (txt: protocol). Driver
 * and truck snapshot stay untouched - reassigning a trip is not an edit fix.
 */
export async function updateTrip(formData: FormData) {
  await requireUser();
  const id = str(formData, "id");
  // Full paths (leading "/") land on the driver period detail page; anything
  // else stays a query string against the trips list
  const returnTo = str(formData, "return_to");
  const backTo = returnTo.startsWith("/")
    ? returnTo
    : `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
  if (!id) redirect(backTo);

  const current = await getTripById(id);
  if (!current) redirect(backTo);

  const operationRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ops.operation_types WHERE status = 'ACTIVE' ORDER BY sort_order, code
  `;
  const validOperations = new Set(operationRows.map(o => o.code));
  const rawOperation = str(formData, "operation");

  // Bare endpoint text goes through the txt: protocol (existing code matches,
  // unknown text find-or-creates an OTHER location)
  const endpoint = (key: string) => {
    const value = str(formData, key);
    if (!value) return "";
    return value.startsWith("loc:") || value.startsWith("txt:") ? value : `txt:${value}`;
  };

  const [fromId, toId] = await Promise.all([
    resolveEndpointId(endpoint("from_location")),
    resolveEndpointId(endpoint("to_location"))
  ]);

  await prisma.$executeRaw`
    UPDATE pay.trips SET
      trip_date = ${isIsoDate(str(formData, "trip_date")) ? str(formData, "trip_date") : current.trip_date}::date,
      operation = ${validOperations.has(rawOperation) ? rawOperation : current.operation},
      load_no = ${str(formData, "load_no")},
      from_location_id = ${fromId || null}::bigint,
      to_location_id = ${toId || null}::bigint,
      miles = ${num0(str(formData, "miles"))},
      fuel_gallons = ${Math.round(num0(str(formData, "fuel_gallons")) * 100) / 100},
      pay_amount = ${Math.round(num0(str(formData, "pay_amount")) * 100) / 100},
      notes = ${str(formData, "notes") || null}
    WHERE id = ${id}::bigint
  `;

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(backTo);
}

export async function deleteTrip(formData: FormData) {
  await requireUser();
  const id = str(formData, "id");
  // Full paths (leading "/") land on the driver period detail page; anything
  // else stays a query string against the trips list
  const returnTo = str(formData, "return_to");
  const backTo = returnTo.startsWith("/")
    ? returnTo
    : `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
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
