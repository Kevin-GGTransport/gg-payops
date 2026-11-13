"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { periodOf } from "@/lib/period";
import { STATE_EDITABLE_STATUSES, type StatementStatus } from "@/lib/labels";
import { payrollMatrix } from "@/lib/queries/trips";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function revalidateStatementViews() {
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard");
}

/**
 * Generate this period's statements: one DRAFT row per active driver with
 * trips, snapshotting the live aggregates. Existing (driver, period) rows
 * are skipped, so regenerating after deleting a draft is safe.
 */
export async function generateStatements(formData: FormData) {
  await requireUser();

  const periodStart = str(formData, "period");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    redirect("/dashboard/trips?view=period");
  }
  const period = periodOf(periodStart);
  const rows = (await payrollMatrix(period)).filter(r => r.leg_count > 0);

  let generated = 0;
  for (const r of rows) {
    const inserted = await prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO pay.payroll_statements(
        driver_id, period_start, period_end,
        trip_days, leg_count, total_miles, total_fuel, total_pay, op_counts, trucks
      )
      VALUES (
        ${r.driver_id}::bigint, ${period.start}::date, ${period.end}::date,
        ${r.trip_days}, ${r.leg_count},
        ${r.total_miles}::numeric, ${r.total_fuel}::numeric, ${r.total_pay}::numeric,
        ${JSON.stringify(r.op_counts)}::jsonb, ${r.trucks}
      )
      ON CONFLICT (driver_id, period_start) DO NOTHING
      RETURNING id
    `;
    generated += inserted.length;
  }

  revalidateStatementViews();
  redirect(`/dashboard/payroll?period=${period.start}&generated=${generated}&eligible=${rows.length}`);
}

/** Advance one statement one step forward (DRAFT→REVIEWED→VERIFIED→DONE) */
export async function advanceStatement(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const returnTo = str(formData, "return_to");

  if (id) {
    await prisma.$executeRaw`
      UPDATE pay.payroll_statements
      SET status = CASE status
            WHEN 'DRAFT' THEN 'REVIEWED'::pay.statement_status
            WHEN 'REVIEWED' THEN 'VERIFIED'::pay.statement_status
            WHEN 'VERIFIED' THEN 'DONE'::pay.statement_status
          END,
          updated_at = now()
      WHERE id = ${id}::bigint AND status <> 'DONE'
    `;
  }

  revalidateStatementViews();
  redirect(returnTo || "/dashboard/payroll");
}

/** Step one statement back (DONE→VERIFIED→REVIEWED→DRAFT) */
export async function revertStatement(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const returnTo = str(formData, "return_to");

  if (id) {
    await prisma.$executeRaw`
      UPDATE pay.payroll_statements
      SET status = CASE status
            WHEN 'DONE' THEN 'VERIFIED'::pay.statement_status
            WHEN 'VERIFIED' THEN 'REVIEWED'::pay.statement_status
            WHEN 'REVIEWED' THEN 'DRAFT'::pay.statement_status
          END,
          updated_at = now()
      WHERE id = ${id}::bigint AND status <> 'DRAFT'
    `;
  }

  revalidateStatementViews();
  redirect(returnTo || "/dashboard/payroll");
}

/** Advance every not-yet-DONE statement of one period one step forward */
export async function advancePeriod(formData: FormData) {
  await requireUser();

  const period = str(formData, "period");
  const returnTo = str(formData, "return_to");

  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    await prisma.$executeRaw`
      UPDATE pay.payroll_statements
      SET status = CASE status
            WHEN 'DRAFT' THEN 'REVIEWED'::pay.statement_status
            WHEN 'REVIEWED' THEN 'VERIFIED'::pay.statement_status
            WHEN 'VERIFIED' THEN 'DONE'::pay.statement_status
          END,
          updated_at = now()
      WHERE period_start = ${period}::date AND status <> 'DONE'
    `;
  }

  revalidateStatementViews();
  redirect(returnTo || `/dashboard/payroll?period=${period}`);
}

/** Delete a statement; drafts only - locked numbers must be reverted first */
export async function deleteStatement(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  const returnTo = str(formData, "return_to");

  if (id) {
    await prisma.$executeRaw`
      DELETE FROM pay.payroll_statements
      WHERE id = ${id}::bigint AND status = 'DRAFT'
    `;
  }

  revalidateStatementViews();
  redirect(returnTo || "/dashboard/payroll");
}

const EDIT_FIELDS = [
  "trip_days",
  "leg_count",
  "total_miles",
  "total_fuel",
  "total_pay",
  "status",
  "note"
] as const;

function backWithError(error: string, formData: FormData): never {
  const params = new URLSearchParams();
  params.set("edit", str(formData, "id"));
  params.set("error", error);
  for (const field of EDIT_FIELDS) {
    const value = str(formData, field);
    if (value) params.set(`f_${field}`, value);
  }
  redirect(`/dashboard/payroll?${params.toString()}`);
}

/**
 * Edit a statement's snapshot numbers, note and status. Only DRAFT and
 * VERIFIED statements are editable; DONE is reachable via advance only.
 */
export async function saveStatement(formData: FormData) {
  await requireUser();

  const id = str(formData, "id");
  if (!id) redirect("/dashboard/payroll");

  const status = str(formData, "status") as StatementStatus;
  if (!STATE_EDITABLE_STATUSES.includes(status)) backWithError("bad_status", formData);

  const tripDays = Number(str(formData, "trip_days"));
  const legCount = Number(str(formData, "leg_count"));
  const totalMiles = str(formData, "total_miles") || "0";
  const totalFuel = str(formData, "total_fuel") || "0";
  const totalPay = str(formData, "total_pay") || "0";
  const note = str(formData, "note") || null;

  if (
    !Number.isInteger(tripDays) || tripDays < 0 ||
    !Number.isInteger(legCount) || legCount < 0 ||
    ![totalMiles, totalFuel, totalPay].every(v => /^\d+(\.\d{1,2})?$/.test(v))
  ) {
    backWithError("bad_number", formData);
  }

  // Guard against races: the WHERE clause re-checks editability
  const updated = await prisma.$executeRaw`
    UPDATE pay.payroll_statements SET
      trip_days = ${tripDays},
      leg_count = ${legCount},
      total_miles = ${totalMiles}::numeric,
      total_fuel = ${totalFuel}::numeric,
      total_pay = ${totalPay}::numeric,
      status = ${status}::pay.statement_status,
      note = ${note},
      updated_at = now()
    WHERE id = ${id}::bigint AND status IN ('DRAFT', 'VERIFIED')
  `;
  if (updated === 0) backWithError("locked", formData);

  revalidateStatementViews();
  redirect(`/dashboard/payroll?period=${str(formData, "return_period")}`);
}
