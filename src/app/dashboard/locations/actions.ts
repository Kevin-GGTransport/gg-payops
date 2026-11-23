"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { withFlash } from "@/lib/search-params";
import { codeTaken, makeBackWithError, setRecordStatus, str } from "@/lib/action-helpers";

const TYPES = ["BASE", "AMAZON", "OTHER"] as const;

const FIELDS = [
  "code",
  "name",
  "location_type",
  "class_tag",
  "address_line",
  "city",
  "state_code",
  "postal_code"
] as const;

const backWithError = makeBackWithError({ basePath: "/dashboard/locations", fields: FIELDS });

export async function saveLocation(formData: FormData) {
  await requirePermission("location.write");

  const id = str(formData, "id");
  const code = str(formData, "code").toUpperCase();
  const name = str(formData, "name");
  const locationType = str(formData, "location_type");
  const addressLine = str(formData, "address_line") || null;
  const city = str(formData, "city") || null;
  const stateCode = str(formData, "state_code").toUpperCase() || null;
  const postalCode = str(formData, "postal_code") || null;
  const classTag = str(formData, "class_tag") || null;
  // Map picker coordinates (optional; both or neither)
  const latitudeRaw = str(formData, "latitude");
  const longitudeRaw = str(formData, "longitude");

  if (!code) backWithError("missing_code", formData);
  if (!name) backWithError("missing_name", formData);
  if (!TYPES.includes(locationType as (typeof TYPES)[number])) {
    backWithError("missing_type", formData);
  }
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

  if (await codeTaken({ table: Prisma.sql`ops.locations`, column: Prisma.sql`code`, value: code, excludeId: id || undefined })) {
    backWithError("dup_code", formData);
  }

  if (id) {
    await prisma.$executeRaw`
      UPDATE ops.locations SET
        code = ${code}, name = ${name}, location_type = ${locationType}::ops.location_type,
        is_base = ${locationType === "BASE"}, class_tag = ${classTag},
        address_line = ${addressLine}, city = ${city}, state_code = ${stateCode}, postal_code = ${postalCode},
        latitude = ${lat}::decimal(9,6), longitude = ${lng}::decimal(9,6),
        updated_at = now()
      WHERE id = ${id}::bigint
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO ops.locations(code, name, location_type, is_base, class_tag, address_line, city, state_code, postal_code, latitude, longitude)
      VALUES (
        ${code}, ${name},
        ${locationType}::ops.location_type, ${locationType === "BASE"}, ${classTag},
        ${addressLine}, ${city}, ${stateCode}, ${postalCode},
        ${lat}::decimal(9,6), ${lng}::decimal(9,6)
      )
    `;
  }

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard");
  redirect(withFlash("/dashboard/locations", "", "saved"));
}

export async function setLocationStatus(formData: FormData) {
  await setRecordStatus(formData, {
    permission: "location.write",
    table: Prisma.sql`ops.locations`,
    basePath: "/dashboard/locations",
    revalidatePaths: ["/dashboard"]
  });
}
