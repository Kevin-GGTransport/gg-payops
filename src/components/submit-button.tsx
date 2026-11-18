"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * Submit button with an in-flight guard: while the enclosing <form action> is
 * pending it disables and swaps its label, so a double click can never fire a
 * second submit. Works with plain className buttons (page helper classes) and
 * with cva variants via variant/size props.
 */
export function SubmitButton({
  children,
  pendingLabel = "提交中…",
  variant,
  size,
  className,
  disabled,
  ...rest
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      data-slot="submit-button"
      disabled={pending || disabled}
      className={cn(variant || size ? buttonVariants({ variant, size, className }) : className)}
      {...rest}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
