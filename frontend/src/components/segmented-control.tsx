"use client";

import { type Ref, useId } from "react";
import { Icon } from "./icon";

// DESIGN.md 6.3. Native radios in a fieldset: the browser gives radio-group semantics, one Tab
// stop and arrow-key selection. The visible segment is 36px inside the 44px track; the label
// around it fills the full 44px height (and overlaps the 1px border) so the touch target is 44.
// `value` may be null (nothing chosen yet, no radio checked). `required` and `error` turn the
// fieldset into a radiogroup with aria-required/aria-invalid and show "Required" and the message;
// `fieldsetRef` lets a form focus the group (focus the first radio) after a failed submit.
// Default: fills its container with equal segments. `fit`: as wide as its labels, each segment
// sized to its own label (flex-1 has a 0 basis, so in a fit-content box it splits evenly and clips).
export function SegmentedControl<T extends string>({
  label,
  hideLabel = false,
  options,
  value,
  onChange,
  fit = false,
  className = "",
  required = false,
  error,
  fieldsetRef,
}: {
  label: string;
  hideLabel?: boolean;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  required?: boolean;
  error?: string;
  fieldsetRef?: Ref<HTMLFieldSetElement>;
  fit?: boolean;
  className?: string;
}) {
  // Unique per instance: a shared name would merge two controls on one page into one radio group.
  const name = useId();
  const errorId = `${name}-error`;
  const strict = required || error !== undefined;
  return (
    <fieldset
      ref={fieldsetRef}
      role={strict ? "radiogroup" : undefined}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      className={`min-w-0 ${fit ? "w-fit" : ""} ${className}`}
    >
      <legend className={hideLabel ? "sr-only" : "mb-2 w-full text-caption-bold text-text-primary"}>
        {required && !hideLabel ? (
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0">{label}</span>
            <span className="shrink-0 text-caption text-text-muted">Required</span>
          </span>
        ) : (
          label
        )}
      </legend>
      <div
        className={`flex h-11 rounded-sm border ${error ? "border-[1.5px] border-error-text bg-error-bg" : "border-border-subtle bg-surface-subtle"}`}
      >
        {options.map((o) => (
          <label key={o.value} className={`group -my-px flex h-11 min-w-11 cursor-pointer p-1 ${fit ? "flex-auto" : "flex-1"}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className="flex min-w-0 flex-1 items-center justify-center rounded-xs px-1 text-body-medium text-text-secondary transition-colors duration-100 group-has-checked:bg-primary group-has-checked:text-text-inverse group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-focus-ring">
              <span className="truncate">{o.label}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="mt-2 flex gap-1 text-caption text-error-text">
          <Icon name="error" size={20} />
          <span className="min-w-0">{error}</span>
        </p>
      )}
    </fieldset>
  );
}
