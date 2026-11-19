/**
 * Local draft persistence for the trip-entry sheet.
 *
 * The entry form keeps every value in per-row React state fed by named form
 * fields, so the cheapest reliable snapshot is the DOM itself: every group
 * (driver/truck + N rows) exposes hidden inputs under positional names
 * (g_<group>_driver_id, g_<g>_row_<i>_<field>), exactly what the server action
 * reads. Restoring replays them through the same one-shot defaults channel
 * the photo import and validation refills use.
 */

const DRAFT_KEY = "payops.entry.draft.v1";

/** Server-side caps mirrored here so a corrupted draft can't balloon the form */
const MAX_GROUPS = 20;
const MAX_ROWS_PER_GROUP = 50;

export type DraftRow = {
  trip_date?: string;
  operation: string;
  from: string;
  to: string;
  load_no: string;
  miles: string;
  fuel_gallons?: string;
  /** Only kept for hand-edited wages (data-manual-pay rows); auto-priced rows restore empty and recalc */
  pay_amount: string;
  notes: string;
};

export type DraftGroup = {
  driverId: string;
  truckId: string;
  rows: DraftRow[];
  /** Serialized group pkg state (计价 mode + manual package amounts); opaque here */
  pkg?: string;
};

export type EntryDraft = {
  v: 1;
  /** 0-based open tab */
  activeIndex: number;
  /** Pay-period cover (ISO start date) */
  periodStart: string;
  groups: DraftGroup[];
};

function field(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : "";
}

/** A row carries user content when anything beyond the auto-filled date is set */
function rowHasContent(row: DraftRow): boolean {
  return Boolean(row.to || row.from || row.load_no || row.notes || row.fuel_gallons || row.trip_date);
}

/**
 * Serialize the live entry form into a draft. Empty sheets (no driver, no
 * row content anywhere) return null so the caller drops the stored draft.
 */
export function collectDraftFromDOM(
  form: HTMLFormElement,
  meta: { activeIndex: number; periodStart: string }
): EntryDraft | null {
  const groupCount = Number.parseInt(field(form, "group_count"), 10) || 0;
  const groups: DraftGroup[] = [];
  let anyContent = false;

  for (let g = 0; g < groupCount && g < MAX_GROUPS; g++) {
    const rowCount = Number.parseInt(field(form, `g_${g}_row_count`), 10) || 0;
    const rows: DraftRow[] = [];
    for (let i = 0; i < rowCount && i < MAX_ROWS_PER_GROUP; i++) {
      const p = `g_${g}_row_${i}_`;
      const payInput = form.elements.namedItem(`${p}pay_amount`);
      // Manual-wage marker lives on the hint inside the same row's <tr>
      const isManual =
        payInput instanceof HTMLInputElement &&
        Boolean(payInput.closest("tr")?.querySelector("[data-manual-pay]"));
      const row: DraftRow = {
        trip_date: field(form, `${p}trip_date`),
        operation: field(form, `${p}operation`),
        from: field(form, `${p}from_location`),
        to: field(form, `${p}to_location`),
        load_no: field(form, `${p}load_no`),
        miles: field(form, `${p}miles`) || "0",
        fuel_gallons: field(form, `${p}fuel_gallons`),
        pay_amount: isManual ? field(form, `${p}pay_amount`) : "",
        notes: field(form, `${p}notes`)
      };
      if (rowHasContent(row)) anyContent = true;
      rows.push(row);
    }
    const driverId = field(form, `g_${g}_driver_id`);
    const truckId = field(form, `g_${g}_truck_id`);
    if (driverId || truckId) anyContent = true;
    const pkg = field(form, `g_${g}_pkg_state`);
    groups.push({ driverId, truckId, rows, pkg: pkg || undefined });
  }

  if (!anyContent) return null;
  return {
    v: 1,
    activeIndex: Math.min(Math.max(meta.activeIndex, 0), Math.max(groups.length - 1, 0)),
    periodStart: meta.periodStart,
    groups
  };
}

export function writeEntryDraft(draft: EntryDraft | null) {
  try {
    if (!draft) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private mode / quota) - drafts stay session-only
  }
}

export function clearEntryDraft() {
  writeEntryDraft(null);
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Read and validate the stored draft; anything malformed is dropped silently */
export function readEntryDraft(): EntryDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const d = parsed as Record<string, unknown>;
    if (d.v !== 1 || !Array.isArray(d.groups)) return null;

    const groups: DraftGroup[] = (d.groups as unknown[]).slice(0, MAX_GROUPS).map(rawGroup => {
      const g = (rawGroup ?? {}) as Record<string, unknown>;
      const rawRows = Array.isArray(g.rows) ? (g.rows as unknown[]).slice(0, MAX_ROWS_PER_GROUP) : [];
      const rows: DraftRow[] = rawRows.map(rawRow => {
        const r = (rawRow ?? {}) as Record<string, unknown>;
        return {
          trip_date: str(r.trip_date),
          operation: str(r.operation),
          from: str(r.from),
          to: str(r.to),
          load_no: str(r.load_no),
          miles: str(r.miles) || "0",
          fuel_gallons: str(r.fuel_gallons),
          pay_amount: str(r.pay_amount),
          notes: str(r.notes)
        };
      });
      return { driverId: str(g.driverId), truckId: str(g.truckId), rows, pkg: str(g.pkg) || undefined };
    });

    if (groups.length === 0) return null;
    const activeIndex = Number(d.activeIndex);
    const periodStart = /^\d{4}-\d{2}-\d{2}$/.test(str(d.periodStart)) ? str(d.periodStart) : "";
    return {
      v: 1,
      activeIndex: Number.isInteger(activeIndex) ? Math.min(Math.max(activeIndex, 0), groups.length - 1) : 0,
      periodStart,
      groups
    };
  } catch {
    return null;
  }
}
