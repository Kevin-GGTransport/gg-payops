"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const FIELDS = [
  "full_name",
  "driver_type",
  "phone",
  "license_no",
  "license_class",
  "license_expires_on",
  "hire_date",
  "notes"
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
  redirect(`/dashboard/drivers?${params.toString()}`);
}

export async function saveDriver(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const fullName = str(formData, "full_name");
  const driverType = str(formData, "driver_type");
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
        full_name, driver_type,
        phone, license_no, license_class, license_expires_on, hire_date, notes
      )
      VALUES (
        ${fullName}, ${driverType}::ops.driver_type,
        ${phone}, ${licenseNo}, ${licenseClass}, ${licenseExpiresOn}::date, ${hireDate}::date, ${notes}
      )
    `;
  }

  revalidatePath("/dashboard/drivers");
  revalidatePath("/dashboard");
  redirect(returnTo ? `/dashboard/drivers?${returnTo}` : "/dashboard/drivers");
}

export async function setDriverStatus(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const status = str(formData, "status");
  const returnTo = str(formData, "return_to");

  if (!id || !["ACTIVE", "INACTIVE"].includes(status)) {
    redirect(returnTo ? `/dashboard/drivers?${returnTo}` : "/dashboard/drivers");
  }

  await prisma.$executeRaw`
    UPDATE ops.drivers
    SET status = ${status}::common.record_status, updated_at = now()
    WHERE id = ${id}::bigint
  `;

  revalidatePath("/dashboard/drivers");
  revalidatePath("/dashboard");
  redirect(returnTo ? `/dashboard/drivers?${returnTo}` : "/dashboard/drivers");
}
