"use client";

import type { ComponentProps } from "react";

/** 提交前弹 confirm，取消则阻止提交（用于危险操作按钮） */
export function ConfirmButton({
  message,
  children,
  ...rest
}: ComponentProps<"button"> & { message: string }) {
  return (
    <button
      {...rest}
      onClick={event => {
        if (!confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
