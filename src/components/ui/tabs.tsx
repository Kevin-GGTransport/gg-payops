"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

function Tabs({ ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center gap-0.5 rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 font-mono text-xs font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  forceMount,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  // With forceMount Radix keeps the panel mounted (so its form fields still
  // submit) but no longer hides it itself - CSS must take over
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none data-[state=inactive]:hidden", className)}
      forceMount={forceMount}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
