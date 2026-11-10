"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** URL 参数驱动的 shadcn Dialog：open 由服务端 searchParams 决定，关闭即导航回 closeHref */
export function ModalShell({
  open,
  closeHref,
  title,
  children
}: {
  open: boolean;
  closeHref: string;
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) router.push(closeHref); }}>
      <DialogContent aria-label={title}>
        <DialogHeader className="mb-0 border-b border-dashed border-line px-5 pt-4 pb-3">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
