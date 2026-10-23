import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-xl border border-ink-200 bg-white px-3.5 text-ink-900 shadow-xs " +
  "placeholder:text-ink-400 transition-colors hover:border-ink-300 " +
  "focus:border-gold-500 focus:outline-none focus:ring-3 focus:ring-gold-300/60 " +
  "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500 " +
  "aria-invalid:border-danger-600 aria-invalid:focus:ring-danger-600/25";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11 text-base sm:text-sm", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2.5 text-base sm:text-sm", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(control, "h-11 appearance-none pr-9 text-base sm:text-sm", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-500"
        aria-hidden
      />
    </div>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-ink-800", className)} {...props} />;
}

type FieldProps = {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | string[];
  children: ReactNode;
  className?: string;
  optional?: boolean;
};

/** Label + control + hint + error, wired up for screen readers via ids. */
export function Field({ label, htmlFor, hint, error, children, className, optional }: FieldProps) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ml-1 font-normal text-ink-500">(optional)</span> : null}
      </Label>
      {children}
      {hint && !message ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={`${htmlFor}-error`} className="text-xs font-medium text-danger-700" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Props to spread on a control inside <Field> so it is described by the hint/error. */
export function describedBy(id: string, error?: string | string[], hint?: boolean) {
  const has = Array.isArray(error) ? error.length > 0 : Boolean(error);
  return {
    id,
    "aria-invalid": has || undefined,
    "aria-describedby": has ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cn("size-5 shrink-0 rounded border-ink-300 accent-ink-900", className)}
      {...props}
    />
  );
}
