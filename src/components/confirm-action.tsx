"use client";

import * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

/**
 * Confirm dialog for client-side async operations (replaces the old native
 * confirm() + inline pattern): the trigger render-prop opens the dialog;
 * confirming runs onConfirm with the confirm button busy until it settles,
 * then the dialog closes. Spread {...triggerProps} FIRST, then add your own
 * overrides (className, disabled, children...).
 */
export function ConfirmAction({
  trigger,
  title = "请确认",
  description,
  confirmLabel = "确定",
  pendingLabel = "处理中…",
  danger = false,
  onConfirm
}: {
  /** Render the trigger; spread the injected props so the click opens the dialog */
  trigger: (triggerProps: React.ComponentProps<"button">) => React.ReactNode;
  title?: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
  /** Destructive confirm button (for delete-style actions) */
  danger?: boolean;
  /** Async confirm handler; the dialog stays open (busy) until it resolves */
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <>
      {trigger({
        type: "button",
        onClick: () => setOpen(true)
      })}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent aria-describedby={description ? undefined : "confirm-desc-fallback"}>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : (
            <span id="confirm-desc-fallback" className="sr-only">
              {title}
            </span>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className={danger ? buttonVariants({ variant: "destructive", size: "sm" }) : undefined}
              disabled={pending}
              onClick={event => {
                // Hold the dialog open while onConfirm runs (Radix would
                // otherwise close it immediately)
                event.preventDefault();
                setPending(true);
                Promise.resolve(onConfirm())
                  .then(() => setOpen(false))
                  .finally(() => setPending(false));
              }}
            >
              {pending ? pendingLabel : confirmLabel}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
