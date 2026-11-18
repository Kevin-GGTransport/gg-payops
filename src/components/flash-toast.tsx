"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Renders a redirect flash param as a one-shot success toast (replaces the
 * old in-page banner), then scrubs the param from the URL via
 * history.replaceState - pure URL bookkeeping, no navigation and no
 * re-render, so a refresh will not re-fire the toast.
 */
export function FlashToast({
  message,
  param,
  actionLabel,
  actionHref
}: {
  message: string;
  /** Query param carrying the flash (deleted after the toast fires) */
  param: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  const router = useRouter();

  React.useEffect(() => {
    toast.success(
      message,
      actionLabel && actionHref
        ? { action: { label: actionLabel, onClick: () => router.push(actionHref) } }
        : undefined
    );
    const url = new URL(window.location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      const qs = url.searchParams.toString();
      window.history.replaceState(null, "", qs ? `${url.pathname}?${qs}` : url.pathname);
    }
  }, [message, param, actionLabel, actionHref, router]);

  return null;
}
