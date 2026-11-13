"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** URL-driven shadcn Dialog: open comes from server searchParams, closing
 *  navigates back to closeHref. Header (and the close button) plus the
 *  optional footer stay pinned; only the body scrolls. */
export function ModalShell({
  open,
  closeHref,
  title,
  wide,
  footer,
  children
}: {
  open: boolean;
  closeHref: string;
  title: string;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) router.push(closeHref); }}>
      <DialogContent
        aria-label={title}
        className={cn("flex flex-col overflow-hidden", wide && "max-w-[880px]")}
      >
        <DialogHeader className="mb-0 shrink-0 border-b border-dashed border-line px-5 pt-4 pb-3">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
