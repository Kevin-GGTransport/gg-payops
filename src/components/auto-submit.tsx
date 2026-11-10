"use client";

import type { ComponentProps } from "react";
import { submitFormClean } from "@/lib/form";

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
