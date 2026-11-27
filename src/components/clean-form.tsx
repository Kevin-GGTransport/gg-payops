"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type CleanFormProps = Omit<ComponentProps<"form">, "action" | "method"> & {
  /** GET target path for the filtered list */
  action: string;
};

/**
 * GET filter form wired for App Router soft navigation.
 *
 * A string `action` + native submission makes the browser do a full document
 * navigation (React only intercepts function actions), which flashes the
 * segment loading skeleton. A function action is intercepted for every submit
 * source — button clicks, Enter, and the requestSubmit() calls made by
 * FilterSelect / ComboboxField(autoSubmit) / AutoSubmitDateField — so we
 * serialize FormData into a querystring (empty values dropped, matching
 * submitFormClean's URL hygiene) and push it through the router.
 */
export function CleanForm({ action, ...rest }: CleanFormProps) {
  const router = useRouter();
  return (
    <form
      {...rest}
      action={(formData: FormData) => {
        const params = new URLSearchParams();
        for (const [name, value] of formData.entries()) {
          const v = String(value).trim();
          if (v) params.append(name, v);
        }
        const query = params.toString();
        router.push(query ? `${action}?${query}` : action);
      }}
    />
  );
}
