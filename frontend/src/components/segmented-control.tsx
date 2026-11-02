"use client";

import { useId } from "react";

// DESIGN.md 6.3. Native radios in a fieldset: the browser gives radio-group semantics, one Tab
// stop and arrow-key selection. The visible segment is 36px inside the 44px track; the label
// around it fills the full 44px height (and overlaps the 1px border) so the touch target is 44.
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
}: {
  label: string;
  hideLabel?: boolean;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  fit?: boolean;
  className?: string;
}) {
  // Unique per instance: a shared name would merge two controls on one page into one radio group.
  const name = useId();
  return (
    <fieldset className={`min-w-0 ${fit ? "w-fit" : ""} ${className}`}>
      <legend className={hideLabel ? "sr-only" : "mb-2 text-caption-bold text-text-primary"}>{label}</legend>
      <div className="flex h-11 rounded-sm border border-border-subtle bg-surface-subtle">
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
    </fieldset>
  );
}
