"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { withFlash } from "@/lib/search-params";
import { Prisma } from "@prisma/client";
import { makeBackWithError, setRecordStatus, str } from "@/lib/action-helpers";

const FIELDS = [
  "full_name",
  "driver_type",
  "price_as_driver",
  "pricing_mode",
  "phone",
  "license_no",
  "license_class",
  "license_expires_on",
  "hire_date",
  "notes"
] as const;

/** pricing_mode whitelist - anything else falls back to per-leg pricing */
const PRICING_MODES = new Set(["LEG", "DAY", "ROUND_TRIP"]);

const backWithError = makeBackWithError({ basePath: "/dashboard/drivers", fields: FIELDS });

export async function saveDriver(formData: FormData) {
  await requirePermission("driver.write");

  const id = str(formData, "id");
  const fullName = str(formData, "full_name");
  const driverType = str(formData, "driver_type");
  const priceAsDriver = str(formData, "price_as_driver") === "1";
  const pricingModeRaw = str(formData, "pricing_mode");
  const pricingMode = PRICING_MODES.has(pricingModeRaw) ? pricingModeRaw : "LEG";
  const phone = str(formData, "phone") || null;
  const licenseNo = str(formData, "license_no") || null;
  const licenseClass = str(formData, "license_class") || null;
  const licenseExpiresOn = str(formData, "license_expires_on") || null;
  const hireDate = str(formData, "hire_date") || null;
  const notes = str(formData, "notes") || null;
  const returnTo = str(formData, "return_to");

  if (!fullName) backWithError("missing_name", formData);
  if (driverType !== "DRIVER" && driverType !== "OWNER") {
    backWithError("missing_type", formData);
  }

  if (id) {
    await prisma.$executeRaw`
      UPDATE ops.drivers SET
        full_name = ${fullName},
        driver_type = ${driverType}::ops.driver_type,
        price_as_driver = ${priceAsDriver},
        pricing_mode = ${pricingMode},
        phone = ${phone},
        license_no = ${licenseNo},
        license_class = ${licenseClass},
        license_expires_on = ${licenseExpiresOn}::date,
        hire_date = ${hireDate}::date,
        notes = ${notes},
        updated_at = now()
      WHERE id = ${id}::bigint
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO ops.drivers(
        full_name, driver_type, price_as_driver, pricing_mode,
        phone, license_no, license_class, license_expires_on, hire_date, notes
      )
      VALUES (
        ${fullName}, ${driverType}::ops.driver_type, ${priceAsDriver}, ${pricingMode},
        ${phone}, ${licenseNo}, ${licenseClass}, ${licenseExpiresOn}::date, ${hireDate}::date, ${notes}
      )
    `;
  }

  revalidatePath("/dashboard/drivers");
  revalidatePath("/dashboard");
  redirect(withFlash("/dashboard/drivers", returnTo, "saved"));
}

export async function setDriverStatus(formData: FormData) {
  await setRecordStatus(formData, {
    permission: "driver.write",
    table: Prisma.sql`ops.drivers`,
    basePath: "/dashboard/drivers",
    revalidatePaths: ["/dashboard"]
  });
}
