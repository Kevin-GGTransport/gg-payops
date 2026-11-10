"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { submitFormClean } from "@/lib/form";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Second line (address, person name...); also included in search matching */
  description?: string;
  /** Group heading; buckets follow first-appearance order */
  group?: string;
};

type ComboboxFieldProps = {
  /** Field label; omit for toolbar filters (use aria-label instead) */
  label?: string;
  /** Form field name; the selected value submits via a hidden input */
  name: string;
  options: ComboboxOption[];
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Allow clearing (default true); set false for required fields */
  clearable?: boolean;
  /** Show the search box (default true); disable for short lists */
  searchable?: boolean;
  /** Render labels in mono (code-like values: location codes, employee numbers) */
  mono?: boolean;
  /** Notified on every pick, including clearing (empty string) */
  onValueChange?: (value: string) => void;
  /** Auto-submit the enclosing form after picking (GET filters); empty values stay out of the URL */
  autoSubmit?: boolean;
  className?: string;
  triggerClassName?: string;
  "aria-label"?: string;
};

/** Bucket options by group, preserving first-appearance order */
function toGroups(options: ComboboxOption[]) {
  const buckets = new Map<string, ComboboxOption[]>();
  for (const option of options) {
    const key = option.group ?? "";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(option);
    else buckets.set(key, [option]);
  }
  return Array.from(buckets.entries());
}

/**
 * Generic single-select combobox (shadcn pattern: Popover + Command).
 * Searchable, groupable, clearable; the value submits via a hidden input.
 */
export function ComboboxField({
  label,
  name,
  options,
  defaultValue = "",
  placeholder = "请选择",
  searchPlaceholder = "搜索…",
  clearable = true,
  searchable = true,
  mono = false,
  autoSubmit = false,
  onValueChange,
  className,
  triggerClassName,
  ...rest
}: ComboboxFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(defaultValue);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const submitAfterPick = React.useRef(false);
  const selected = options.find(o => o.value === value) ?? null;
  const groups = React.useMemo(() => toGroups(options), [options]);

  function pick(next: string) {
    setValue(next);
    setOpen(false);
    onValueChange?.(next);
    if (autoSubmit) submitAfterPick.current = true;
  }

  // The hidden input's value lands in the DOM after re-render; submit only then
  React.useEffect(() => {
    if (!autoSubmit || !submitAfterPick.current) return;
    submitAfterPick.current = false;
    const form = rootRef.current?.closest("form");
    if (form) submitFormClean(form);
  }, [value, autoSubmit]);

  return (
    <div ref={rootRef} className={cn(label && "grid gap-1.5 text-xs font-medium text-muted-foreground", className)}>
      {label && <span>{label}</span>}
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={rest["aria-label"] ?? (label ? `选择${label}` : undefined)}
            className={cn("h-9 w-full justify-between px-2.5 font-normal", triggerClassName)}
          >
            {selected ? (
              <>
                <span className={cn("text-[13px] leading-tight", mono && "font-mono font-semibold")}>
                  {selected.label}
                </span>
                {selected.description && (
                  <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">
                    {selected.description}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="min-w-56 w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            {searchable && <CommandInput placeholder={searchPlaceholder} />}
            <CommandList>
              <CommandEmpty>没有匹配的选项。</CommandEmpty>
              {clearable && (
                <CommandItem value={placeholder} onSelect={() => pick("")}>
                  <CheckIcon className={cn(!selected ? "opacity-100" : "opacity-0")} />
                  {placeholder}
                </CommandItem>
              )}
              {groups.map(([group, items]) => (
                <CommandGroup key={group || "default"} heading={group || undefined}>
                  {items.map(option => (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.description ?? ""}`}
                      onSelect={() => pick(option.value)}
                    >
                      <CheckIcon className={cn(value === option.value ? "opacity-100" : "opacity-0")} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("text-[13px] leading-tight", mono && "font-mono font-semibold")}>
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="truncate text-[11px] font-normal leading-tight text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
