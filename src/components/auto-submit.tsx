"use client";

import type { ComponentProps } from "react";
import { submitFormClean } from "@/lib/form";
import { DateField } from "@/components/date-field";

/** Submit the enclosing form on change (no button click); empty values stay out of the URL */
export function AutoSubmitDate(props: ComponentProps<"input">) {
  return (
    <input
      {...props}
      onChange={event => {
        if (event.currentTarget.form) submitFormClean(event.currentTarget.form);
      }}
    />
  );
}

/** Calendar-combo date filter that submits the enclosing form on every committed pick */
export function AutoSubmitDateField(props: Omit<ComponentProps<typeof DateField>, "onValueChange">) {
  return (
    <DateField
      {...props}
      onValueChange={() => {
        // The hidden ISO input lands in the DOM after re-render; submit in a
        // microtask so the form reads the fresh value
        queueMicrotask(() => {
          const field = document.querySelector(`input[name="${props.name}"]`);
          const form = field?.closest("form");
          if (form) submitFormClean(form);
        });
      }}
    />
  );
}
