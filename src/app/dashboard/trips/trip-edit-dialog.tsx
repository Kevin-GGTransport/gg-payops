import { ModalShell } from "@/components/modal-shell";
import {
  DateField,
  FormGrid,
  NumberField,
  SubmitButton,
  TextField,
  TextareaField
} from "@/components/form-fields";
import { ComboboxField } from "@/components/combobox-field";
import type { OperationTypeRow } from "@/lib/queries/operations";
import type { TripEditRow } from "@/lib/queries/trips";
import { updateTrip } from "./actions";

/**
 * URL-driven edit dialog (same contract as the payroll edit card): the page
 * fetches the trip when ?edit=<id> is present and renders this shell; saving
 * goes through the updateTrip server action.
 */
export function TripEditDialog({
  editing,
  operations,
  closeHref,
  returnTo
}: {
  editing: TripEditRow | null;
  /** Operation dictionary for the picker (ACTIVE codes) */
  operations: OperationTypeRow[];
  /** URL that drops the ?edit param */
  closeHref: string;
  /** Serialized filters the save redirects back to */
  returnTo: string;
}) {
  return (
    <ModalShell
      open={Boolean(editing)}
      closeHref={closeHref}
      title={editing ? `编辑行程 · ${editing.driver_name ?? ""}（${editing.trip_date}）` : "编辑行程"}
    >
      {editing && (
        <form action={updateTrip} aria-label="行程编辑卡">
          <input type="hidden" name="id" value={editing.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <FormGrid>
            <DateField label="日期" name="trip_date" defaultValue={editing.trip_date} />
            <ComboboxField
              label="操作"
              name="operation"
              defaultValue={editing.operation}
              placeholder="选择操作"
              clearable={false}
              searchable={false}
              options={operations
                .filter(o => o.status === "ACTIVE")
                .map(o => ({
                  value: o.code,
                  label: o.label !== o.code ? `${o.code} · ${o.label}` : o.code,
                  ...(o.description ? { description: o.description } : {})
                }))}
            />
            <TextField label="Load#" name="load_no" defaultValue={editing.load_no} placeholder="如 12345" />
            <TextField label="起点代码" name="from_location" defaultValue={editing.from_code ?? ""} placeholder="如 ONT" />
            <TextField label="终点代码" name="to_location" defaultValue={editing.to_code ?? ""} placeholder="如 LAX" />
            <NumberField label="Miles" name="miles" required min={0} step={0.01} defaultValue={editing.miles} />
            <NumberField label="加油 (gal)" name="fuel_gallons" required min={0} step={0.01} defaultValue={editing.fuel_gallons} />
            <NumberField label="本趟工资 ($)" name="pay_amount" required min={0} step={0.01} defaultValue={editing.pay_amount} />
            <TextareaField label="备注" name="notes" defaultValue={editing.notes ?? ""} className="col-span-2 max-md:col-span-1" />
          </FormGrid>
          <SubmitButton>保存修改</SubmitButton>
        </form>
      )}
    </ModalShell>
  );
}
