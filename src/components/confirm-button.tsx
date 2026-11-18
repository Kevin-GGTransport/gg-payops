"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
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
 * Submit button guarded by a confirm dialog (replaces the old native
 * confirm()): the trigger opens the dialog and confirming submits the
 * enclosing form via requestSubmit (keeps the React form action wiring).
 * While the form action is in flight the trigger disables + swaps its label,
 * so the submit cannot double-fire.
 */
export function ConfirmButton({
  message,
  title = "请确认",
  danger = false,
  children,
  className,
  pendingLabel = "处理中…",
  disabled,
  ...rest
}: React.ComponentProps<"button"> & {
  message: string;
  title?: string;
  /** Destructive confirm button (for delete-style actions) */
  danger?: boolean;
  pendingLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const { pending } = useFormStatus();
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        {...rest}
        ref={triggerRef}
        // Always a plain button - the submit only happens on dialog confirm
        type="button"
        className={className}
        disabled={pending || disabled}
        onClick={() => setOpen(true)}
      >
        {pending ? pendingLabel : children}
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={danger ? buttonVariants({ variant: "destructive", size: "sm" }) : undefined}
              onClick={() => {
                setOpen(false);
                // requestSubmit (not form.submit) so the React form action runs
                triggerRef.current?.closest("form")?.requestSubmit();
              }}
            >
              确定
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
