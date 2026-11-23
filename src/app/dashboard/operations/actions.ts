"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { withFlash } from "@/lib/search-params";
import { codeTaken, makeBackWithError, setRecordStatus, str } from "@/lib/action-helpers";
import { getOperationTypeById } from "@/lib/queries/operations";

const FIELDS = ["code", "label", "description", "sort_order"] as const;

const backWithError = makeBackWithError({ basePath: "/dashboard/operations", fields: FIELDS });

function revalidateDictionary() {
  revalidatePath("/dashboard/operations");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
}

export async function saveOperation(formData: FormData) {
  await requirePermission("operation.write");

  const id = str(formData, "id");
  const existing = id ? await getOperationTypeById(id) : null;
  if (id && !existing) backWithError("missing_operation", formData);
  // System rows (EMPTY / BOBTAIL): the code is wired into wage / Load# logic
  // and its input is disabled (so never submitted) - always keep the stored one
  const code = existing?.is_system ? existing.code : str(formData, "code").toUpperCase();
  const label = str(formData, "label");
  const description = str(formData, "description") || null;
  const sortOrderRaw = str(formData, "sort_order") || "100";
  const requiresLoad = str(formData, "requires_load") === "1";

  if (!code) backWithError("missing_code", formData);
  if (!/^[A-Z0-9_-]{1,16}$/.test(code)) backWithError("bad_code", formData);
  if (!label) backWithError("missing_label", formData);
  const sortOrder = Number.parseInt(sortOrderRaw, 10);
  if (!Number.isFinite(sortOrder) || sortOrder < 0) backWithError("bad_sort", formData);

  if (
    await codeTaken({
      table: Prisma.sql`ops.operation_types`,
      column: Prisma.sql`code`,
      value: code,
      excludeId: id || undefined
    })
  ) {
    backWithError("dup_code", formData);
  }

  // Renaming a code that trips already store breaks their FK and history;
  // block with a friendly error instead of letting Postgres 500
  if (existing && existing.code !== code && existing.trip_count > 0) {
    backWithError("op_in_use", formData);
  }

  if (existing) {
    await prisma.$executeRaw`
      UPDATE ops.operation_types SET
        code = ${code}, label = ${label}, description = ${description},
        sort_order = ${sortOrder}, requires_load = ${requiresLoad}, updated_at = now()
      WHERE id = ${id}::bigint
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO ops.operation_types(code, label, description, sort_order, requires_load)
      VALUES (${code}, ${label}, ${description}, ${sortOrder}, ${requiresLoad})
    `;
  }

  revalidateDictionary();
  redirect(withFlash("/dashboard/operations", "", "saved"));
}

export async function setOperationStatus(formData: FormData) {
  await setRecordStatus(formData, {
    permission: "operation.write",
    table: Prisma.sql`ops.operation_types`,
    basePath: "/dashboard/operations",
    revalidatePaths: ["/dashboard", "/dashboard/trips"],
    validate: async id => {
      const existing = await getOperationTypeById(id);
      if (!existing) redirect("/dashboard/operations");
      // System rows must stay selectable (wage calc + Load# lock depend on them)
      if (existing.is_system) return { error: "system_locked" };
      return null;
    }
  });
}

export async function deleteOperation(formData: FormData) {
  await requirePermission("operation.write");
  const id = str(formData, "id");
  if (!id) redirect("/dashboard/operations");

  const existing = await getOperationTypeById(id);
  if (!existing) redirect("/dashboard/operations");
  const fail = (error: string): never => {
    const params = new URLSearchParams({ error, edit: id });
    redirect(`/dashboard/operations?${params.toString()}`);
  };
  if (existing.is_system) fail("system_locked");
  // The FK would reject it anyway; fail with a readable message first
  if (existing.trip_count > 0) fail("op_in_use");

  await prisma.$executeRaw`
    DELETE FROM ops.operation_types WHERE id = ${id}::bigint
  `;
  revalidateDictionary();
  redirect(withFlash("/dashboard/operations", "", "deleted"));
}
