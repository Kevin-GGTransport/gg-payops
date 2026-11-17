import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className
}: {
  /** Plain string, or inline markup (e.g. a state-colored driver name) */
  title: ReactNode;
  /** Plain string, or inline markup (e.g. a mono driver code inside the sentence) */
  description: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("page-head", className)}>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions}
    </header>
  );
}
