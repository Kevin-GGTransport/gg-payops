"use client";

import { ConfirmAction } from "@/components/confirm-action";
import { submitWithToast } from "@/lib/submit-action";

/**
 * One-click statement status action (核对 / 司机确认): a confirm dialog guards
 * the misclick, then the server action runs imperatively under the standard
 * toast contract. The two ledger buttons were verbatim twins of this shape.
 */
export function StatusActionButton({
  statementId,
  action,
  labels,
  triggerClass = "linklike"
}: {
  statementId: string;
  action: (fd: FormData) => Promise<unknown>;
  labels: {
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel: string;
    trigger: string;
    successToast: string;
    failureToast: string;
  };
  triggerClass?: string;
}) {
  return (
    <ConfirmAction
      title={labels.title}
      description={labels.description}
      confirmLabel={labels.confirmLabel}
      pendingLabel={labels.pendingLabel}
      trigger={props => (
        <button {...props} className={triggerClass}>
          {labels.trigger}
        </button>
      )}
      onConfirm={() => {
        const fd = new FormData();
        fd.set("id", statementId);
        fd.set("return_to", window.location.pathname + window.location.search);
        return submitWithToast(fd, action, {
          success: labels.successToast,
          failure: labels.failureToast
        });
      }}
    />
  );
}
