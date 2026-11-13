import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BaseField = {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  className?: string;
};

const fieldClass = "grid gap-1.5 text-xs font-medium text-muted-foreground";

export function TextField({ label, name, required, placeholder, defaultValue, maxLength, className }: BaseField & { maxLength?: number }) {
  return (
    <label className={cn(fieldClass, className)}>
      {label}
      <Input name={name} required={required} placeholder={placeholder} defaultValue={defaultValue} maxLength={maxLength} />
    </label>
  );
}

export function DateField({ label, name, required, defaultValue, className }: BaseField) {
  return (
    <label className={cn(fieldClass, className)}>
      {label}
      <Input type="date" name={name} required={required} defaultValue={defaultValue} />
    </label>
  );
}

export function NumberField({
  label,
  name,
  required,
  defaultValue,
  min,
  step,
  placeholder,
  className,
  value,
  onValueChange
}: BaseField & { min?: number; step?: number; value?: string; onValueChange?: (value: string) => void }) {
  return (
    <label className={cn(fieldClass, className)}>
      {label}
      <Input
        type="number"
        name={name}
        required={required}
        placeholder={placeholder}
        min={min}
        step={step}
        {...(value !== undefined ? { value, onChange: (e) => onValueChange?.(e.target.value) } : { defaultValue })}
      />
    </label>
  );
}

export function TextareaField({ label, name, placeholder, defaultValue, rows = 2, className }: BaseField & { rows?: number }) {
  return (
    <label className={cn(fieldClass, className)}>
      {label}
      <Textarea name={name} placeholder={placeholder} defaultValue={defaultValue} rows={rows} />
    </label>
  );
}

/** Native checkbox: submits "1" when checked, nothing when unchecked */
export function CheckboxField({
  label,
  name,
  defaultChecked,
  className,
  hint
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={cn(fieldClass, className)}>
      {label}
      <span className="flex h-9 items-center gap-2">
        <input
          type="checkbox"
          name={name}
          value="1"
          defaultChecked={defaultChecked}
          className="size-4 accent-(--color-route)"
        />
        <span className="text-[13px] font-normal text-foreground">{hint ?? label}</span>
      </span>
    </label>
  );
}

export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-x-2.5 gap-y-3 px-4 pt-3.5 max-md:grid-cols-1", className)}>{children}</div>;
}

export function SubmitButton({ children }: { children: ReactNode }) {
  return <Button type="submit" className="mx-4 mb-4 mt-3.5 w-[calc(100%-2rem)]">{children}</Button>;
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      {message}
    </p>
  );
}
