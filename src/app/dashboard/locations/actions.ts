"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const TYPES = ["BASE", "AMAZON", "OTHER"] as const;

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function backWithError(error: string, formData: FormData): never {
  const params = new URLSearchParams();
  const id = str(formData, "id");
  if (id) params.set("edit", id);
  params.set("error", error);
  for (const field of ["code", "name", "location_type", "standard_pay_amount", "address_line", "city", "state_code", "postal_code"]) {
    const value = str(formData, field);
    if (value) params.set(`f_${field}`, value);
  }
  redirect(`/dashboard/locations?${params.toString()}`);
}

export async function saveLocation(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const code = str(formData, "code").toUpperCase();
  const name = str(formData, "name");
  const locationType = str(formData, "location_type");
  const standardPay = str(formData, "standard_pay_amount") || "0";
  const addressLine = str(formData, "address_line") || null;
  const city = str(formData, "city") || null;
  const stateCode = str(formData, "state_code").toUpperCase() || null;
  const postalCode = str(formData, "postal_code") || null;
  // Map picker coordinates (optional; both or neither)
  const latitudeRaw = str(formData, "latitude");
  const longitudeRaw = str(formData, "longitude");

  if (!code) backWithError("missing_code", formData);
  if (!name) backWithError("missing_name", formData);
  if (!TYPES.includes(locationType as (typeof TYPES)[number])) {
    backWithError("missing_type", formData);
  }
  const pay = Number(standardPay);
  if (!Number.isFinite(pay) || pay < 0) backWithError("bad_pay", formData);
  const lat = latitudeRaw === "" ? null : Number(latitudeRaw);
  const lng = longitudeRaw === "" ? null : Number(longitudeRaw);
  const coordsValid =
    (lat === null && lng === null) ||
    (lat !== null &&
      lng !== null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180);
  if (!coordsValid) backWithError("bad_coords", formData);
  // Guard the state_code FK with a friendly error instead of a raw 500 page
  if (stateCode) {
    const knownState = await prisma.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM ops.state_codes WHERE code = ${stateCode} LIMIT 1
    `;
    if (knownState.length === 0) backWithError("bad_state", formData);
  }

  const conflicts = id
    ? await prisma.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM ops.locations
        WHERE code = ${code} AND id <> ${id}::bigint LIMIT 1
      `
    : await prisma.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM ops.locations
        WHERE code = ${code} LIMIT 1
      `;
  if (conflicts.length > 0) backWithError("dup_code", formData);

  if (id) {
    await prisma.$executeRaw`
      UPDATE ops.locations SET
        code = ${code}, name = ${name}, location_type = ${locationType}::ops.location_type,
        is_base = ${locationType === "BASE"}, standard_pay_amount = ${pay},
        address_line = ${addressLine}, city = ${city}, state_code = ${stateCode}, postal_code = ${postalCode},
        latitude = ${lat}::decimal(9,6), longitude = ${lng}::decimal(9,6),
        updated_at = now()
      WHERE id = ${id}::bigint
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO ops.locations(code, name, location_type, is_base, standard_pay_amount, address_line, city, state_code, postal_code, latitude, longitude)
      VALUES (
        ${code}, ${name},
        ${locationType}::ops.location_type, ${locationType === "BASE"}, ${pay},
        ${addressLine}, ${city}, ${stateCode}, ${postalCode},
        ${lat}::decimal(9,6), ${lng}::decimal(9,6)
      )
    `;
  }

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard");
  redirect("/dashboard/locations");
}

export async function setLocationStatus(formData: FormData) {
  await requireUser();
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !["ACTIVE", "INACTIVE"].includes(status)) redirect("/dashboard/locations");

  await prisma.$executeRaw`
    UPDATE ops.locations
    SET status = ${status}::common.record_status, updated_at = now()
    WHERE id = ${id}::bigint
  `;
  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard");
  redirect("/dashboard/locations");
}
