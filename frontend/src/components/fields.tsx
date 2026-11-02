"use client";

import { type ComponentProps, type ReactNode, useId, useState } from "react";
import { Icon } from "./icon";

// DESIGN.md 6.2. React 19 passes `ref` as a normal prop, so spreading `props` onto the native
// element forwards it along with every native attribute (name, autoComplete, inputMode...).
// `required` shows "Required" and sets aria-required. TextField and Textarea do not set the native
// attribute (no browser validation popups); Select does, so an empty placeholder value is invalid.
type FieldProps = { label: string; helper?: string; error?: string; required?: boolean };

function Field({
  id,
  label,
  required,
  helper,
  error,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="min-w-0 text-caption-bold text-text-primary">
          {label}
        </label>
        {required && <span className="shrink-0 text-caption text-text-muted">Required</span>}
      </div>
      {children}
      {helper && (
        <p id={`${id}-helper`} className="text-caption text-text-muted">
          {helper}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex gap-1 text-caption text-error-text">
          <Icon name="error" size={20} />
          <span className="min-w-0">{error}</span>
        </p>
      )}
    </div>
  );
}

function useFieldId(id?: string) {
  const auto = useId();
  return id ?? auto;
}

type CallerAria = Pick<ComponentProps<"input">, "aria-describedby" | "aria-invalid" | "aria-required">;

// Merges with the caller's ARIA props: their describedby ids come first; error and required win
// over the caller's aria-invalid/aria-required, otherwise the caller's value stands.
function aria(id: string, { helper, error, required }: Omit<FieldProps, "label">, caller: CallerAria) {
  const describedBy = [caller["aria-describedby"], helper && `${id}-helper`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    "aria-invalid": error ? true : caller["aria-invalid"],
    "aria-required": required ? true : caller["aria-required"],
    "aria-describedby": describedBy || undefined,
  };
}

// The visible box. State comes from props so disabled and error never fight hover in CSS order.
function box(error?: string, disabled?: boolean) {
  const shared = "min-h-12 rounded-sm text-body-medium transition-colors duration-100";
  if (disabled) return `${shared} border border-border-subtle bg-surface-subtle text-text-muted`;
  if (error) return `${shared} border-[1.5px] border-error-text bg-error-bg text-text-primary`;
  return `${shared} border border-border-input bg-surface-card text-text-primary hover:border-border-strong`;
}

// Focus is a 2px primary ring drawn over the border (6.2), not the offset ring of 6.1.
const ring = "focus-visible:outline-primary focus-visible:-outline-offset-1";

type TextFieldProps = FieldProps &
  Omit<ComponentProps<"input">, "prefix"> & { prefix?: ReactNode; suffix?: ReactNode };

export function TextField({
  label,
  helper,
  error,
  required,
  prefix,
  suffix,
  id,
  className = "",
  ...props
}: TextFieldProps) {
  const fid = useFieldId(id);
  return (
    <Field id={fid} label={label} required={required} helper={helper} error={error}>
      <div
        className={`flex items-center gap-2 px-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-1 has-[input:focus-visible]:outline-primary ${box(error, props.disabled)}`}
      >
        {prefix && <span className="shrink-0 whitespace-nowrap text-text-muted">{prefix}</span>}
        <input
          {...props}
          {...aria(fid, { helper, error, required }, props)}
          className={`h-11 min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-muted disabled:cursor-not-allowed ${className}`}
        />
        {suffix && (
          <span className="flex shrink-0 items-center whitespace-nowrap text-text-muted">{suffix}</span>
        )}
      </div>
    </Field>
  );
}

export function PasswordField(props: Omit<TextFieldProps, "type" | "prefix" | "suffix">) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? "text" : "password"}
      suffix={
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          className="-mr-3 flex size-11 items-center justify-center rounded-sm text-text-secondary hover:text-text-primary focus-visible:-outline-offset-2 disabled:text-text-muted"
        >
          <Icon name={shown ? "visibility_off" : "visibility"} size={20} />
        </button>
      }
    />
  );
}

export function Textarea({
  label,
  helper,
  error,
  required,
  id,
  className = "",
  ...props
}: FieldProps & ComponentProps<"textarea">) {
  const fid = useFieldId(id);
  return (
    <Field id={fid} label={label} required={required} helper={helper} error={error}>
      <textarea
        rows={4}
        {...props}
        {...aria(fid, { helper, error, required }, props)}
        className={`resize-y px-4 py-3 text-body placeholder:text-text-muted disabled:cursor-not-allowed ${ring} ${box(error, props.disabled)} ${className}`}
      />
    </Field>
  );
}

// Native <select>. `placeholder` adds an empty first option, disabled and hidden so it shows as the
// initial value (pass value="" or defaultValue="") but cannot be picked again from the menu. While
// it is selected the text is muted (CSS :has). Options reset to primary text for the menu.
export function Select({
  label,
  helper,
  error,
  required,
  placeholder,
  id,
  className = "",
  children,
  ...props
}: FieldProps & ComponentProps<"select"> & { placeholder?: string }) {
  const fid = useFieldId(id);
  return (
    <Field id={fid} label={label} required={required} helper={helper} error={error}>
      <div className="relative">
        <select
          {...props}
          required={required}
          {...aria(fid, { helper, error, required }, props)}
          className={`h-12 w-full appearance-none truncate pr-11 pl-4 disabled:cursor-not-allowed [&:has(option[value='']:checked)]:text-text-muted [&_option]:text-text-primary ${ring} ${box(error, props.disabled)} ${className}`}
        >
          {placeholder !== undefined && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {children}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-text-secondary">
          <Icon name="expand_more" size={20} />
        </span>
      </div>
    </Field>
  );
}
