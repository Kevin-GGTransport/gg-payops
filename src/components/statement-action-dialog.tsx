"use client";

import * as React from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Session-keyed action dialog: the shared skeleton of the payroll one-pick
 * dialogs (复制工资单 / 改车号). The trigger bumps a session number and the
 * form child is keyed by it, so every open mounts fresh picks with no reset
 * effects - the convention both dialogs duplicated verbatim.
 */
export function SessionActionDialog({
  ariaLabel,
  title,
  triggerLabel,
  triggerClassName = "linklike",
  children
}: {
  ariaLabel: string;
  title: React.ReactNode;
  triggerLabel: string;
  triggerClassName?: string;
  /** Receives close(); render the form body + footer (keyed remount per open) */
  children: (close: () => void) => React.ReactNode;
}) {
  // null = closed; every open bumps the number so the form remounts fresh
  const [session, setSession] = React.useState<number | null>(null);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setSession(s => (s ?? 0) + 1)}
      >
        {triggerLabel}
      </button>
      <Dialog
        open={session !== null}
        onOpenChange={open => {
          if (!open) setSession(null);
        }}
      >
        <DialogContent aria-label={ariaLabel} className="max-h-[90vh]">
          <DialogHeader className="mb-0 border-b border-dashed border-line px-5 pt-4 pb-3">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {session !== null && (
            <React.Fragment key={session}>{children(() => setSession(null))}</React.Fragment>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Standard cancel/confirm row of the action-dialog forms (pending-aware) */
export function DialogFormFooter({
  pending,
  canConfirm,
  confirmLabel,
  pendingLabel,
  onCancel,
  onConfirm
}: {
  pending: boolean;
  canConfirm: boolean;
  confirmLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className="button button-quiet" disabled={pending} onClick={onCancel}>
        取消
      </button>
      <button
        type="button"
        className="button button-dark"
        disabled={!canConfirm || pending}
        onClick={onConfirm}
      >
        {pending ? pendingLabel : confirmLabel}
      </button>
    </div>
  );
}
