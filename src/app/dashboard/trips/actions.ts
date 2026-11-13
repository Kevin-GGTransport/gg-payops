"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
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
