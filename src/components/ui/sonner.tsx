"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toast host (sonner), mounted once in the dashboard layout.
 * No theme provider in this app - light ledger palette only.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return <Sonner position="top-center" richColors {...props} />;
};

export { Toaster };
