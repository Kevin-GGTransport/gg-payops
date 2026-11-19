import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Filled field style, same family as Input (see ui/input.tsx)
        "flex min-h-9 w-full rounded-md border border-transparent bg-muted px-3 py-2 text-sm transition-colors outline-none",
        "placeholder:text-muted-foreground focus-visible:border-route focus-visible:bg-card",
        "read-only:bg-transparent",
        "disabled:cursor-not-allowed disabled:opacity-50 resize-y",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
