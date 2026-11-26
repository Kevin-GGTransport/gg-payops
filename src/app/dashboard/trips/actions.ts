"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission, assertDriverScope, getLinkedDriverId } from "@/lib/permissions";
import { calcFuelSubsidy } from "@/lib/wage";
import { resolveEndpointId, resolveEndpointIds } from "@/lib/locations";
import { syncStatements, syncStatementsInTx, type StatementRef } from "@/lib/statements";
import { periodOf } from "@/lib/period";
import { todayIso } from "@/lib/format";
import { getTripById, getTripsByIds, type TripEditRow } from "@/lib/queries/trips";
import { isIsoDate, str } from "@/lib/action-helpers";

/** Bad or negative numbers fall back to 0 - same lenient semantics as entry */
function num0(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Full-path returns land on the driver period detail page; anything else is a
 *  query string against the trips list */
function backPath(returnTo: string) {
  return returnTo.startsWith("/")
    ? returnTo
    : `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
}

/** Cap for the detail sheet's appended rows (mirrors the entry sheet's caps) */
const MAX_NEW_ROWS = 20;
const MAX_FUEL_ROWS = 50;
const MAX_FEE_ROWS = 20;

/** Pricing context shared by every edit path: ACTIVE operation codes + the
 *  current owner fuel-subsidy rate */
async function pricingContext() {
  const [operationRows, rateRows] = await Promise.all([
    prisma.$queryRaw<Array<{ code: string }>>`
      SELECT code FROM ops.operation_types WHERE status = 'ACTIVE' ORDER BY sort_order, code
    `,
    prisma.$queryRaw<Array<{ rate: string }>>`
      SELECT fuel_subsidy_rate::text AS rate FROM pay.wage_rule_versions
      WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1
    `
  ]);
  return {
    validOperations: new Set(operationRows.map(o => o.code)),
    /** Dictionary's first ACTIVE code - the same default the sheets open with */
    fallbackOperation: operationRows[0]?.code ?? "",
    fuelSubsidyRate: rateRows[0] ? Number(rateRows[0].rate) : 0
  };
}

/**
 * Write one trip's editable fields (shared by the dialog save and the inline
 * ledger batch). Validation-free like entry: invalid date / unknown operation
 * keep the stored value, bad numbers become 0, blank endpoints clear to NULL,
 * bare endpoint text is find-or-created as a location (txt: protocol). Driver
 * and truck snapshot stay untouched - reassigning a trip is not an edit fix,
 * and settle_date is never written here (claiming is its own action). Returns
 * the (driver, period) refs the caller must sync statements for: a deferred
 * leg's money only lives in periodOf(settle_date); a follow-date leg keeps
 * old AND new trip_date period (a date edit may cross the week boundary).
 */
async function applyTripUpdate(
  id: string,
  current: TripEditRow,
  formData: FormData,
  /** Field-name prefix: "" for the dialog, `leg_<id>_` for inline ledger rows */
  prefix: string,
  validOperations: Set<string>,
  fuelSubsidyRate: number,
  /** Batch callers pass a shared transaction + pre-resolved endpoints */
  options?: {
    tx?: Prisma.TransactionClient;
    endpointIds?: Map<string, string>;
  }
): Promise<StatementRef[]> {
  const rawOperation = str(formData, `${prefix}operation`);

  // Bare endpoint text goes through the txt: protocol (existing code matches,
  // unknown text find-or-creates an OTHER location)
  const endpoint = (key: string) => {
    const value = str(formData, `${prefix}${key}`);
    if (!value) return "";
    return value.startsWith("loc:") || value.startsWith("txt:") ? value : `txt:${value}`;
  };

  const fromToken = endpoint("from_location");
  const toToken = endpoint("to_location");
  const [fromId, toId] = options?.endpointIds
    ? [options.endpointIds.get(fromToken) ?? "", options.endpointIds.get(toToken) ?? ""]
    : await Promise.all([resolveEndpointId(fromToken), resolveEndpointId(toToken)]);

  // Owner fuel subsidy re-snapshots on every edit (miles x the ACTIVE rate;
  // plain drivers stay 0 - driver type itself never changes on an edit).
  // Miles ledger as integers: typed decimals round on save, same as entry
  const milesNum = Math.round(num0(str(formData, `${prefix}miles`)));
  const newDate = isIsoDate(str(formData, `${prefix}trip_date`))
    ? str(formData, `${prefix}trip_date`)
    : current.trip_date;

  await (options?.tx ?? prisma).$executeRaw`
    UPDATE pay.trips SET
      trip_date = ${newDate}::date,
      operation = ${validOperations.has(rawOperation) ? rawOperation : current.operation},
      load_no = ${str(formData, `${prefix}load_no`)},
      from_location_id = ${fromId || null}::bigint,
      to_location_id = ${toId || null}::bigint,
      miles = ${milesNum},
      fuel_gallons = ${Math.round(num0(str(formData, `${prefix}fuel_gallons`)) * 100) / 100},
      pay_amount = ${Math.round(num0(str(formData, `${prefix}pay_amount`)) * 100) / 100},
      fuel_subsidy = ${calcFuelSubsidy({ driverType: current.driver_type ?? undefined, miles: milesNum, rate: fuelSubsidyRate })},
      notes = ${str(formData, `${prefix}notes`) || null},
      sort_order = CASE WHEN ${newDate}::date <> ${current.trip_date}::date THEN NULL ELSE sort_order END
    WHERE id = ${id}::bigint
  `;

  // Statements follow the money: a deferred leg pays in its settle period
  // only (its trip_date period never counted it), a follow-date leg keeps
  // both sides of a possible period move
  if (current.settle_date) {
    return [
      { driverId: current.driver_id, periodStart: periodOf(current.settle_date).start }
    ];
  }
  return [
    { driverId: current.driver_id, periodStart: periodOf(current.trip_date).start },
    { driverId: current.driver_id, periodStart: periodOf(newDate).start }
  ];
}

/**
 * Edit one trip (the ledger dialog's save). See applyTripUpdate for the
 * lenient field semantics. A leg inside a DONE statement's confirmation
 * snapshot is a read-only archive row - the only door back to editable is
 * reopening that statement (payroll/actions reopenStatement).
 */
export async function updateTrip(formData: FormData) {
  await requirePermission("trip.write");
  const id = str(formData, "id");
  const backTo = backPath(str(formData, "return_to"));
  if (!id) redirect(backTo);

  const current = await getTripById(id);
  if (!current) redirect(backTo);
  await assertDriverScope(current.driver_id);
  if (current.locked) {
    redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=leg_locked`);
  }

  const { validOperations, fuelSubsidyRate } = await pricingContext();
  const refs = await applyTripUpdate(id, current, formData, "", validOperations, fuelSubsidyRate);

  // DRAFT and VERIFIED recompute live; DONE only ever got the read-only
  // refusal above (the flag arm stays for the fuel/fee bookkeeping paths)
  await syncStatements(refs);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}saved=1`);
}

/**
 * Save the whole driver period detail sheet in one submit: dirty legs +
 * appended rows (leg_new_<i>*, INSERTed with entry's lenient semantics),
 * fuel-by-state rows (replace per driver+period, same-state rows merge) and
 * custom-fee rows (replace, never merged). Client-side pre-validation keeps
 * bad rows from reaching the server; the checks below remain the backstop
 * and refuel every typed row through URL params on the way back. Fuel and
 * fees always write (the editors open with the stored truth, so an untouched
 * section rewrites itself); DRAFT/VERIFIED sheets take the payload live,
 * while DONE (archived) sheets only take the payload plus the permanent
 * edited flag - their numbers stay frozen.
 */
export async function saveStatementSheet(formData: FormData) {
  await requirePermission("trip.write");
  const backTo = backPath(str(formData, "return_to"));
  const driverId = str(formData, "driver_id");
  const periodRaw = str(formData, "period");
  if (!/^\d+$/.test(driverId) || !isIsoDate(periodRaw)) redirect("/dashboard/payroll");
  await assertDriverScope(driverId);
  const period = periodOf(periodRaw);

  // ---- Legs: only the dirty ids are written; appended rows INSERT
  const ids = str(formData, "dirty_ids")
    .split(",")
    .map(s => s.trim())
    .filter(id => /^\d+$/.test(id));
  const newRowCount = Math.min(
    Number.parseInt(str(formData, "new_row_count"), 10) || 0,
    MAX_NEW_ROWS
  );
  // Untouched appended rows skip silently (the sheet opens each fresh row
  // with a default date, so content = any endpoint / Load# / note)
  const newRows: Array<{ p: string }> = [];
  for (let i = 0; i < newRowCount; i++) {
    const p = `leg_new_${i}_`;
    const from = str(formData, `${p}from_location`);
    const to = str(formData, `${p}to_location`);
    const loadNo = str(formData, `${p}load_no`);
    const notes = str(formData, `${p}notes`);
    if (!from && !to && !loadNo && !notes) continue;
    newRows.push({ p });
  }

  // ---- Fuel-by-state rows (the default direction/truck code is not content)
  type FuelRow = {
    no: number;
    stateCode: string;
    truckCode: string;
    gallons: number;
    miles: number;
    amount: number;
    note: string;
  };
  const fuelCount = Math.min(
    Number.parseInt(str(formData, "f_fuel_row_count"), 10) || 0,
    MAX_FUEL_ROWS
  );
  const fuelRows: FuelRow[] = [];
  for (let i = 0; i < fuelCount; i++) {
    const p = `f_fuel_row_${i}_`;
    const stateCode = str(formData, `${p}state_code`).toUpperCase().slice(0, 2);
    const gallonsRaw = str(formData, `${p}gallons`);
    const milesRaw = str(formData, `${p}miles`);
    const amountRaw = str(formData, `${p}amount`);
    const note = str(formData, `${p}note`).slice(0, 200);
    if (!stateCode && !gallonsRaw && !milesRaw && !amountRaw && !note) continue;
    fuelRows.push({
      no: i + 1,
      stateCode,
      truckCode: str(formData, `${p}truck_code`).slice(0, 32),
      gallons: num0(gallonsRaw),
      miles: num0(milesRaw),
      amount: num0(amountRaw),
      note
    });
  }

  // ---- Custom-fee rows (amount ADDS to the payout; miles informational)
  type FeeRow = { no: number; label: string; miles: number; amount: number; note: string };
  const feeCount = Math.min(
    Number.parseInt(str(formData, "f_fee_row_count"), 10) || 0,
    MAX_FEE_ROWS
  );
  const feeRows: FeeRow[] = [];
  for (let i = 0; i < feeCount; i++) {
    const p = `f_fee_row_${i}_`;
    const label = str(formData, `${p}label`).slice(0, 60);
    const amountRaw = str(formData, `${p}amount`);
    const milesRaw = str(formData, `${p}miles`);
    const note = str(formData, `${p}note`).slice(0, 200);
    if (!label && !amountRaw && !milesRaw && !note) continue;
    feeRows.push({ no: i + 1, label, miles: num0(milesRaw), amount: num0(amountRaw), note });
  }

  // ---- Backstop validation: refuel everything typed on the way back
  const backWithError = (error: string, rowNo: number): never => {
    const params = new URLSearchParams({ error, period: period.start });
    if (error.startsWith("fuel_")) params.set("fuel", String(rowNo));
    else params.set("fee", String(rowNo));
    const repack = (prefix: string, fields: string[], count: number) => {
      let kept = 0;
      for (let i = 0; i < count; i++) {
        let any = false;
        for (const field of fields) {
          const value = str(formData, `${prefix}${i}_${field}`);
          if (value) {
            params.set(`${prefix}${kept}_${field}`, value);
            any = true;
          }
        }
        if (any) kept++;
      }
      if (kept > 0) params.set(`${prefix}count`, String(kept));
    };
    repack("f_fuel_row_", ["state_code", "gallons", "miles", "amount", "note", "truck_code"], fuelCount);
    repack("f_fee_row_", ["label", "miles", "amount", "note"], feeCount);
    redirect(`${backTo}?${params.toString()}`);
  };

  const stateRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ops.state_codes WHERE is_active
  `;
  const validStates = new Set(stateRows.map(s => s.code));
  for (const row of fuelRows) {
    if (!row.stateCode) backWithError("fuel_missing_state", row.no);
    if (!validStates.has(row.stateCode)) backWithError("fuel_bad_state", row.no);
  }
  for (const row of feeRows) {
    if (!row.label) backWithError("fee_missing_label", row.no);
  }

  // Fuel/fees always write when there is anything to write OR anything to
  // clear (an existing statement may hold rows the editor just emptied);
  // a stray empty submit with no statement at all is a plain no-op
  const hasSectionContent = fuelRows.length > 0 || feeRows.length > 0;
  const existingStatement = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id::text, status::text AS status FROM pay.payroll_statements
    WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
    LIMIT 1
  `;
  const statementStatus = existingStatement[0]?.status ?? null;
  if (
    ids.length === 0 &&
    newRows.length === 0 &&
    !hasSectionContent &&
    statementStatus === null
  ) {
    redirect(backTo);
  }

  const { validOperations, fallbackOperation, fuelSubsidyRate } = await pricingContext();

  // ---- Legs: one batch read for the dirty rows + one parallel endpoint
  // resolve for the whole sheet (each dirty row used to cost a point read,
  // each row a pair of sequential resolutions); every write below - leg
  // updates, the appended-rows INSERT, fuel, fees and the statement sync -
  // shares ONE transaction, so a mid-sheet failure rolls back the whole save.
  const endpointToken = (key: string) => {
    const value = str(formData, key);
    if (!value) return "";
    return value.startsWith("loc:") || value.startsWith("txt:") ? value : `txt:${value}`;
  };
  const endpointIds = await resolveEndpointIds([
    ...ids.flatMap(id => [
      endpointToken(`leg_${id}_from_location`),
      endpointToken(`leg_${id}_to_location`)
    ]),
    ...newRows.flatMap(({ p }) => [
      endpointToken(`${p}from_location`),
      endpointToken(`${p}to_location`)
    ])
  ]);
  const currentById = new Map((await getTripsByIds(ids)).map(row => [row.id, row]));

  // Read-only archive backstop: a leg frozen inside a DONE statement's
  // snapshot refuses the whole batch (the frozen sheet already renders
  // read-only; this closes the server door for any other caller)
  if (ids.some(id => currentById.get(id)?.locked)) {
    backWithError("leg_locked", 0);
  }

  // One driver lookup feeds every appended row: the name snapshot and the
  // subsidy's driver type
  const driverRows = newRows.length > 0
    ? await prisma.$queryRaw<Array<{ full_name: string; driver_type: string }>>`
        SELECT full_name, driver_type::text AS driver_type
        FROM ops.drivers
        WHERE id = ${driverId}::bigint
        LIMIT 1
      `
    : [];
  const driver = driverRows[0];
  const today = todayIso();

  // Appended rows as one INSERT's VALUES list (entry's lenient semantics)
  const newLegs =
    driver
      ? newRows.map(({ p }) => {
          const rawDate = str(formData, `${p}trip_date`);
          const tripDate = isIsoDate(rawDate) ? rawDate : today;
          const rawOperation = str(formData, `${p}operation`);
          const milesNum = Math.round(num0(str(formData, `${p}miles`)));
          return {
            tripDate,
            sql: Prisma.sql`
              (${driverId}::bigint, ${tripDate}::date,
               ${validOperations.has(rawOperation) ? rawOperation : fallbackOperation},
               ${str(formData, `${p}load_no`)},
               ${endpointIds.get(endpointToken(`${p}from_location`)) || null}::bigint,
               ${endpointIds.get(endpointToken(`${p}to_location`)) || null}::bigint,
               ${milesNum},
               ${Math.round(num0(str(formData, `${p}fuel_gallons`)) * 100) / 100},
               ${Math.round(num0(str(formData, `${p}pay_amount`)) * 100) / 100},
               ${calcFuelSubsidy({ driverType: driver.driver_type === "OWNER" ? "OWNER" : "DRIVER", miles: milesNum, rate: fuelSubsidyRate })},
               ${str(formData, `${p}notes`) || null},
               ${driver.full_name})
            `
          };
        })
      : [];

  const refs: StatementRef[] = [];
  await prisma.$transaction(
    async tx => {
      for (const id of ids) {
        const current = currentById.get(id);
        if (!current) continue;
        refs.push(
          ...(await applyTripUpdate(id, current, formData, `leg_${id}_`, validOperations, fuelSubsidyRate, {
            tx,
            endpointIds
          }))
        );
      }

      if (newLegs.length > 0) {
        await tx.$executeRaw`
          INSERT INTO pay.trips
            (driver_id, trip_date, operation, load_no, from_location_id, to_location_id,
             miles, fuel_gallons, pay_amount, fuel_subsidy, notes, driver_name)
          VALUES ${Prisma.join(newLegs.map(leg => leg.sql))}
        `;
        for (const leg of newLegs) {
          refs.push({ driverId, periodStart: periodOf(leg.tripDate).start });
        }
      }

      // ---- Fuel: merge same states (sums per column, first note wins);
      // DRAFT/VERIFIED take the payload, DONE is a read-only archive whose
      // fuel is part of the confirmation snapshot - an identical rewrite
      // (the editor always submits its rows) passes as a no-op, any real
      // change must reopen the sheet first. Rows emptied to zero still write
      // on live sheets (an existing statement may hold the set being cleared)
      if (hasSectionContent || statementStatus !== null) {
        if (fuelRows.length > 0 || statementStatus !== null) {
          const merged = new Map<string, FuelRow>();
          for (const row of fuelRows) {
            const dup = merged.get(row.stateCode);
            if (dup) {
              dup.gallons += row.gallons;
              dup.miles += row.miles;
              dup.amount += row.amount;
              if (!dup.note) dup.note = row.note;
            } else {
              merged.set(row.stateCode, { ...row });
            }
          }
          const payload = JSON.stringify(
            [...merged.values()].map(r => ({
              truckCode: r.truckCode,
              stateCode: r.stateCode,
              gallons: Math.round(r.gallons * 1000) / 1000,
              miles: Math.round(r.miles * 10) / 10,
              amount: Math.round(r.amount * 100) / 100,
              ...(r.note ? { note: r.note } : {})
            }))
          );
          if (statementStatus === "DONE") {
            // redirect() throws, so the shared transaction rolls back
            const same = await tx.$queryRaw<Array<{ same: boolean }>>`
              SELECT (COALESCE(fuel_detail, '[]'::jsonb) IS NOT DISTINCT FROM ${payload}::jsonb) AS same
              FROM pay.payroll_statements
              WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
            `;
            if (!same[0]?.same) backWithError("fuel_locked", 1);
          } else {
            await tx.$executeRaw`
              INSERT INTO pay.payroll_statements
                (driver_id, period_start, period_end, trip_days, leg_count, total_miles, total_fuel, total_pay, fuel_detail)
              VALUES (${driverId}::bigint, ${period.start}::date, ${period.end}::date,
                      0, 0, 0, 0, 0, ${payload}::jsonb)
              ON CONFLICT (driver_id, period_start) DO UPDATE SET
                fuel_detail = EXCLUDED.fuel_detail, updated_at = now()
              WHERE pay.payroll_statements.status IN ('DRAFT', 'VERIFIED')
            `;
          }
        }
      }

      // ---- Fees: replace semantics (no merge), sum written in lockstep
      const feePayload = JSON.stringify(
        feeRows.map(r => ({
          label: r.label,
          miles: Math.round(r.miles * 10) / 10,
          amount: Math.round(r.amount * 100) / 100,
          ...(r.note ? { note: r.note } : {})
        }))
      );
      const feeTotal = Math.round(feeRows.reduce((acc, r) => acc + r.amount, 0) * 100) / 100;
      await tx.$executeRaw`
        INSERT INTO pay.payroll_statements
          (driver_id, period_start, period_end, trip_days, leg_count, total_miles, total_fuel, total_pay,
           custom_fees, total_custom_fees)
        VALUES (${driverId}::bigint, ${period.start}::date, ${period.end}::date,
                0, 0, 0, 0, 0, ${feePayload}::jsonb, ${feeTotal})
        ON CONFLICT (driver_id, period_start) DO UPDATE SET
          custom_fees = EXCLUDED.custom_fees,
          total_custom_fees = EXCLUDED.total_custom_fees,
          updated_at = now()
        WHERE pay.payroll_statements.status IN ('DRAFT', 'VERIFIED')
      `;
      await tx.$executeRaw`
        UPDATE pay.payroll_statements
        SET custom_fees = ${feePayload}::jsonb,
            total_custom_fees = ${feeTotal},
            edited_after_verify = true,
            updated_at = now()
        WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
          AND status = 'DONE'
      `;

      await syncStatementsInTx(tx, refs);
    },
    { timeout: 30_000 }
  );

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}saved=1`);
}

/** Why a day reorder was refused; the sheet maps the code to Chinese */
export type ReorderDayErrorCode = "bad_request" | "trips_changed" | "archived";

/**
 * Persist one day's drag order (save-on-drop, independent of the big sheet
 * save). orderedIds must be EXACTLY the day's current leg set - anything else
 * (another tab added/deleted a leg, a batch save landed first) refuses with
 * trips_changed instead of guessing. Positions land as array ordinals via
 * unnest WITH ORDINALITY; statements then re-sync so a DONE sheet keeps the
 * permanent edited_after_verify convention (order never changes aggregates).
 * Return-value action: no redirect, no revalidatePath - the client already
 * holds the optimistic order and the page is auth-dynamic.
 */
export async function reorderDayLegs(input: {
  driverId: string;
  tripDate: string;
  orderedIds: string[];
}): Promise<{ ok: true } | { ok: false; code: ReorderDayErrorCode }> {
  await requirePermission("trip.write");
  const { driverId = "", tripDate = "", orderedIds = [] } = input ?? {};
  const ids = [...new Set(orderedIds.filter(id => /^\d+$/.test(id)))];
  if (
    !/^\d+$/.test(driverId) ||
    !isIsoDate(tripDate) ||
    ids.length === 0 ||
    ids.length !== orderedIds.length
  ) {
    return { ok: false, code: "bad_request" };
  }
  await assertDriverScope(driverId);

  return prisma.$transaction(
    async tx => {
      // Fresh truth for the set-match guard; racing saves may interleave
      // under READ COMMITTED with benign outcomes (a concurrently inserted
      // leg keeps NULL and appends; a deleted one is skipped by the
      // positional UPDATE)
      const current = await tx.$queryRaw<Array<{ id: string; locked: boolean }>>`
        SELECT t.id::text,
               EXISTS (
                 SELECT 1 FROM pay.payroll_statements s
                 WHERE s.driver_id = t.driver_id
                   AND s.period_start = (COALESCE(t.settle_date, t.trip_date)
                       - ((extract(dow from COALESCE(t.settle_date, t.trip_date)) + 1) % 7)
                         * interval '1 day')::date
                   AND s.status = 'DONE'
                   AND (s.verify_snapshot->'legs')
                       @> jsonb_build_array(jsonb_build_object('id', t.id::text))
               ) AS locked
        FROM pay.trips t
        WHERE t.driver_id = ${driverId}::bigint AND t.trip_date = ${tripDate}::date
      `;
      const currentSet = new Set(current.map(r => r.id));
      if (currentSet.size !== ids.length || ids.some(id => !currentSet.has(id))) {
        return { ok: false as const, code: "trips_changed" as const };
      }
      // Read-only archive: a frozen leg in the day refuses the reorder (the
      // day may still hold unsettled legs, which stay draggable - but the
      // set-match guard needs the whole day, so any frozen leg blocks it)
      if (current.some(r => r.locked)) {
        return { ok: false as const, code: "archived" as const };
      }
      await tx.$executeRaw`
        UPDATE pay.trips t
        SET sort_order = o.pos::int
        FROM unnest(ARRAY[${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))}])
          WITH ORDINALITY AS o(id, pos)
        WHERE t.id = o.id
          AND t.driver_id = ${driverId}::bigint
          AND t.trip_date = ${tripDate}::date
      `;
      await syncStatementsInTx(tx, [{ driverId, periodStart: periodOf(tripDate).start }]);
      return { ok: true as const };
    },
    { timeout: 30_000 }
  );
}


export async function deleteTrip(formData: FormData) {
  await requirePermission("trip.write");
  const id = str(formData, "id");
  const backTo = backPath(str(formData, "return_to"));
  if (!id) redirect(backTo);

  // Driver + period are needed to sync the statement after the row is gone
  const current = await getTripById(id);
  if (!current) redirect(backTo);
  await assertDriverScope(current.driver_id);
  // Read-only archive: a frozen leg refuses the delete (reopen first)
  if (current.locked) {
    redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=leg_locked`);
  }

  await prisma.$executeRaw`DELETE FROM pay.trips WHERE id = ${id}::bigint`;

  // A deferred leg's money lives in its settle period, not its date's
  await syncStatements([
    { driverId: current.driver_id, periodStart: periodOf(current.settle_date ?? current.trip_date).start }
  ]);

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  redirect(backTo);
}

export async function deleteTripsBatch(formData: FormData) {
  await requirePermission("trip.write");
  const ids = formData.getAll("selected").map(String).filter(Boolean);
  const returnTo = str(formData, "return_to");
  const backTo = `/dashboard/trips${returnTo ? `?${returnTo}` : ""}`;
  if (ids.length === 0) redirect(backTo);

  // Affected (driver, period) pairs before the rows disappear
  const doomed = await prisma.$queryRaw<
    Array<{ driver_id: string; trip_date: string; settle_date: string | null; locked: boolean }>
  >`
    SELECT t.driver_id::text,
           to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date,
           to_char(t.settle_date, 'YYYY-MM-DD') AS settle_date,
           EXISTS (
             SELECT 1 FROM pay.payroll_statements s
             WHERE s.driver_id = t.driver_id
               AND s.period_start = (COALESCE(t.settle_date, t.trip_date)
                   - ((extract(dow from COALESCE(t.settle_date, t.trip_date)) + 1) % 7)
                     * interval '1 day')::date
               AND s.status = 'DONE'
               AND (s.verify_snapshot->'legs')
                   @> jsonb_build_array(jsonb_build_object('id', t.id::text))
           ) AS locked
    FROM pay.trips t
    WHERE t.id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))})
  `;
  // Driver-linked accounts may only batch-delete their own legs
  const linked = await getLinkedDriverId();
  if (linked !== null && doomed.some(r => r.driver_id !== linked)) {
    redirect("/dashboard/forbidden");
  }
  // Read-only archive: any frozen leg refuses the whole batch
  if (doomed.some(r => r.locked)) {
    redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=leg_locked`);
  }

  await prisma.$executeRaw`DELETE FROM pay.trips WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))})`;

  await syncStatements(
    doomed.map(r => ({
      driverId: r.driver_id,
      periodStart: periodOf(r.settle_date ?? r.trip_date).start
    }))
  );

  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
  redirect(backTo);
}

/**
 * Claim unsettled legs into the open settlement period: each claimed leg's
 * money moves to periodOf(settle_date) while its real trip_date stays. Only
 * legs still unsettled are written (settle_date NULL + own period DONE +
 * absent from that confirmation snapshot - the same predicate as
 * unsettledTripsForDriver, re-checked inline so concurrent claims and stale
 * panels collapse to a no-op instead of double-counting). The frozen home
 * sheet is deliberately NOT re-synced: it never counted these legs, so
 * there is nothing to drop there. sort_order clears with the claim - the
 * leg leaves its home day and never joins day groups in the target period.
 */
export async function settleTripsIntoPeriod(formData: FormData) {
  await requirePermission("trip.write");
  const driverId = str(formData, "driver_id");
  const periodRaw = str(formData, "period");
  const ids = formData.getAll("claim").map(String).filter(id => /^\d+$/.test(id));
  const backTo = backPath(str(formData, "return_to"));
  if (!/^\d+$/.test(driverId) || !isIsoDate(periodRaw) || ids.length === 0) {
    redirect("/dashboard/payroll");
  }
  await assertDriverScope(driverId);
  const period = periodOf(periodRaw);

  // The claim target must still be open (no sheet yet, DRAFT or VERIFIED)
  const frozen = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM pay.payroll_statements
    WHERE driver_id = ${driverId}::bigint AND period_start = ${period.start}::date
      AND status = 'DONE'
    LIMIT 1
  `;
  if (frozen.length > 0) {
    redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=claim_frozen`);
  }

  const claimed = await prisma.$executeRaw`
    UPDATE pay.trips t
    SET settle_date = ${period.start}::date, sort_order = NULL, updated_at = now()
    FROM pay.payroll_statements s
    WHERE t.id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::bigint`))})
      AND t.driver_id = ${driverId}::bigint
      AND t.settle_date IS NULL
      AND s.driver_id = t.driver_id
      AND s.period_start = (t.trip_date - ((extract(dow from t.trip_date) + 1) % 7) * interval '1 day')::date
      AND s.status = 'DONE'
      AND s.verify_snapshot IS NOT NULL
      AND NOT ((s.verify_snapshot->'legs') @> jsonb_build_array(jsonb_build_object('id', t.id::text)))
      AND (t.trip_date - ((extract(dow from t.trip_date) + 1) % 7) * interval '1 day')::date
          <> ${period.start}::date
  `;
  if (claimed === 0) {
    redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=claim_none`);
  }

  await syncStatements([{ driverId, periodStart: period.start }]);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}claimed=${claimed}`);
}

/**
 * Release a claimed leg back to unsettled: clears settle_date so the money
 * leaves this period's sheet and the leg re-appears on the claim panel (its
 * home period is DONE and its confirmation snapshot never contained it).
 * Both periods re-sync - the claim period drops the money, the home period
 * stays flagged (DONE) or recomputes (live) as its status dictates.
 */
export async function unsettleTrip(formData: FormData) {
  await requirePermission("trip.write");
  const id = str(formData, "id");
  const backTo = backPath(str(formData, "return_to"));
  if (!id) redirect(backTo);

  const current = await getTripById(id);
  if (!current || !current.settle_date) redirect(backTo);
  await assertDriverScope(current.driver_id);
  // Read-only archive: a frozen leg keeps its settlement (reopen first)
  if (current.locked) {
    redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=leg_locked`);
  }

  const claimPeriod = periodOf(current.settle_date).start;
  await prisma.$executeRaw`
    UPDATE pay.trips
    SET settle_date = NULL, updated_at = now()
    WHERE id = ${id}::bigint AND settle_date IS NOT NULL
  `;

  await syncStatements([
    { driverId: current.driver_id, periodStart: claimPeriod },
    { driverId: current.driver_id, periodStart: periodOf(current.trip_date).start }
  ]);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/trips");
  revalidatePath("/dashboard/payroll");
  redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}saved=1`);
}
