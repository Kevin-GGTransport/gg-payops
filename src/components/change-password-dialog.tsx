"use client";

import * as React from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

import {
  changeOwnPassword,
  type ChangePasswordErrorCode
} from "@/app/actions";
import { FormError } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const ERROR_MESSAGES: Record<ChangePasswordErrorCode, string> = {
  wrong_password: "当前密码不正确。",
  short_password: "新密码至少 8 位。",
  mismatch: "两次输入的新密码不一致。"
};

/**
 * Self-service password change, opened from the sidebar footer. Submission
 * calls the return-value action imperatively: a refusal maps its error code
 * to a Chinese message that stays in the dialog; success toasts and closes.
 * The session-bump pattern remounts the form fresh per open - no effects.
 */
export function ChangePasswordButton() {
  // null = closed; every open bumps the number so the form remounts fresh
  const [session, setSession] = React.useState<number | null>(null);

  return (
    <>
      <button
        type="button"
        className="mt-2 flex h-8 w-full items-center justify-start gap-2 rounded-[3px] px-2 text-[12px] text-slate-400 hover:bg-white/10 hover:text-white"
        onClick={() => setSession(s => (s ?? 0) + 1)}
      >
        <KeyRound className="size-3.5" />
        <span className="group-data-[collapsible=icon]:hidden">修改密码</span>
      </button>
      <Dialog
        open={session !== null}
        onOpenChange={open => {
          if (!open) setSession(null);
        }}
      >
        <DialogContent aria-label="修改密码" className="max-h-[90vh]">
          <DialogHeader className="mb-0 border-b border-dashed border-line px-5 pt-4 pb-3">
            <DialogTitle>修改密码</DialogTitle>
          </DialogHeader>
          {session !== null && (
            <ChangePasswordForm key={session} onClose={() => setSession(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const [errorCode, setErrorCode] = React.useState<ChangePasswordErrorCode | null>(null);

  return (
    <form
      className="grid gap-3 px-5 py-4"
      action={async formData => {
        const result = await changeOwnPassword(formData);
        if (result.ok) {
          toast.success("密码已修改");
          onClose();
        } else {
          setErrorCode(result.code);
        }
      }}
    >
      <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        当前密码
        <Input
          type="password"
          name="current_password"
          required
          autoComplete="current-password"
          className="h-9"
        />
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        新密码（至少 8 位）
        <Input
          type="password"
          name="new_password"
          required
          minLength={8}
          autoComplete="new-password"
          className="h-9"
        />
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        确认新密码
        <Input
          type="password"
          name="confirm_password"
          required
          minLength={8}
          autoComplete="new-password"
          className="h-9"
        />
      </label>
      <SubmitButton className="button mt-1">保存新密码</SubmitButton>
    </form>
  );
}
