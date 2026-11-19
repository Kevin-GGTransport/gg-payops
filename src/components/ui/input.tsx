import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Filled field style: editable = soft gray fill with no border line
        // (calm on white cards); focusing swaps to white bg + route-blue border
        // (the site's focus color). Read-only drops the fill, so "editable =
        // gray, read-only = plain" reads at a glance.
        "flex h-9 w-full min-w-0 rounded-md border border-transparent bg-muted px-3 py-1 text-sm transition-colors outline-none",
        "placeholder:text-muted-foreground focus-visible:border-route focus-visible:bg-card",
        "read-only:bg-transparent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };
