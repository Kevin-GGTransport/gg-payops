"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { syncStatements } from "@/lib/statements";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function revalidateStatementViews() {
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard");
}

/**
 * Freeze one statement: refresh the aggregates off the live trips one last
 * time (drafts always track live, so this only guards against a race) and
 * flip to VERIFIED. One-way and permanent - there is no un-verify, and later
 * trip changes only set the red edited_after_verify flag.
 */
export async function verifyStatement(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const returnTo = str(formData, "return_to");
  if (!id) redirect("/dashboard/payroll");

  const rows = await prisma.$queryRaw<
    Array<{ driver_id: string; period_start: string }>
  >`
    SELECT driver_id::text, to_char(period_start, 'YYYY-MM-DD') AS period_start
    FROM pay.payroll_statements
    WHERE id = ${id}::bigint AND status = 'DRAFT'
    LIMIT 1
  `;
  const target = rows[0];
  if (target) {
    await syncStatements([
      { driverId: target.driver_id, periodStart: target.period_start }
    ]);
    await prisma.$executeRaw`
      UPDATE pay.payroll_statements
      SET status = 'VERIFIED', edited_after_verify = false, updated_at = now()
      WHERE id = ${id}::bigint AND status = 'DRAFT'
    `;
  }

  revalidateStatementViews();
  redirect(returnTo || "/dashboard/payroll");
}
