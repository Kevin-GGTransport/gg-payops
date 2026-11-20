"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { isPermissionCode } from "@/lib/permission-catalog";
import { withFlash } from "@/lib/search-params";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function backWithError(error: string, formData: FormData): never {
  const params = new URLSearchParams();
  const id = str(formData, "id");
  if (id) params.set("edit", id);
  else params.set("new", "1");
  params.set("error", error);
  const name = str(formData, "name");
  const code = str(formData, "code");
  if (name) params.set("f_name", name);
  if (code) params.set("f_code", code);
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("perm_") && value === "1") params.set(key, "1");
  }
  redirect(`/dashboard/roles?${params.toString()}`);
}

/** Uppercase snake codes in the house style of SUPER_ADMIN / FINANCE_CLERK */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,30}$/;

function revalidateRoles() {
  revalidatePath("/dashboard/roles");
  revalidatePath("/dashboard/accounts");
}

/**
 * Create a custom role or edit one. System presets are name-only (their
 * locked matrix submits no perm_ keys, and a tampered payload is ignored);
 * custom roles rebuild the grant set against the catalog whitelist.
 */
export async function saveRole(formData: FormData) {
  await requirePermission("role.write");

  const id = str(formData, "id");
  const name = str(formData, "name");
  const code = str(formData, "code").toUpperCase();

  if (!name) backWithError("missing_name", formData);
  if (!id) {
    if (!code) backWithError("missing_code", formData);
    if (!CODE_PATTERN.test(code)) backWithError("bad_code", formData);
  }

  // Whitelist: unknown perm_ keys drop out silently (the UI only offers the catalog)
  const codes = [...formData.entries()]
    .filter(([key, value]) => key.startsWith("perm_") && value === "1")
    .map(([key]) => key.slice("perm_".length))
    .filter(isPermissionCode);

  let isSystem = false;
  if (id) {
    const rows = await prisma.$queryRaw<Array<{ is_system: boolean }>>`
      SELECT is_system FROM common.roles WHERE id = ${id}::bigint LIMIT 1
    `;
    if (!rows[0]) redirect("/dashboard/roles");
    isSystem = rows[0].is_system;
  }
  // A custom role is a grant set - it cannot exist empty; presets carry the
  // migrated matrix and never take submitted grants
  if (!isSystem && codes.length === 0) backWithError("no_permissions", formData);

  try {
    if (id && isSystem) {
      await prisma.$executeRaw`
        UPDATE common.roles SET name = ${name}, updated_at = now()
        WHERE id = ${id}::bigint
      `;
    } else if (id) {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`
          UPDATE common.roles SET name = ${name}, updated_at = now()
          WHERE id = ${id}::bigint
        `;
        await tx.$executeRaw`DELETE FROM common.role_permissions WHERE role_id = ${id}::bigint`;
        await tx.$executeRaw`
          INSERT INTO common.role_permissions(role_id, permission_id)
          SELECT ${id}::bigint, p.id FROM common.permissions p
          WHERE p.code IN (${Prisma.join(codes.map(c => Prisma.sql`${c}`))})
        `;
      });
    } else {
      await prisma.$transaction(async tx => {
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO common.roles(code, name, is_system)
          VALUES (${code}, ${name}, false)
          RETURNING id::text
        `;
        const newId = inserted[0]?.id;
        if (newId) {
          await tx.$executeRaw`
            INSERT INTO common.role_permissions(role_id, permission_id)
            SELECT ${newId}::bigint, p.id FROM common.permissions p
            WHERE p.code IN (${Prisma.join(codes.map(c => Prisma.sql`${c}`))})
          `;
        }
      });
    }
  } catch (error) {
    // Raw-SQL unique violation (P2010 + PG 23505) = the code is taken
    const text = error instanceof Prisma.PrismaClientKnownRequestError
      ? `${error.message} ${((error.meta as { message?: string } | undefined)?.message ?? "")}`
      : String((error as { message?: string })?.message ?? "");
    if (text.includes("23505") || text.includes("duplicate key")) {
      backWithError("dup_code", formData);
    }
    throw error;
  }

  revalidateRoles();
  redirect(withFlash("/dashboard/roles", "", "saved"));
}

/** Only unused custom roles can go; presets and assigned roles refuse */
export async function deleteRole(formData: FormData) {
  await requirePermission("role.write");

  const id = str(formData, "id");
  if (!id) redirect("/dashboard/roles");

  const rows = await prisma.$queryRaw<Array<{ is_system: boolean; user_count: number }>>`
    SELECT r.is_system,
           (SELECT count(*)::int FROM common.user_roles ur WHERE ur.role_id = r.id) AS user_count
    FROM common.roles r
    WHERE r.id = ${id}::bigint
    LIMIT 1
  `;
  const role = rows[0];
  if (role?.is_system) {
    redirect(`/dashboard/roles?edit=${id}&error=system_locked`);
  }
  if (role && role.user_count > 0) {
    redirect(`/dashboard/roles?edit=${id}&error=role_in_use`);
  }

  // role_permissions cascades with the role row
  await prisma.$executeRaw`
    DELETE FROM common.roles WHERE id = ${id}::bigint AND is_system = false
  `;

  revalidateRoles();
  redirect(withFlash("/dashboard/roles", "", "deleted"));
}
