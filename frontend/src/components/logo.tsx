type Variant = "on-paper" | "on-ink";

// Geometry: DESIGN.md 1.1 (64 x 64 grid). Up to 32px the simplified mark (two lines, stroke 5) is used.
// `decorative` hides the mark from screen readers when visible text already names it (Wordmark).
export function Logo({
  variant,
  size = 32,
  decorative = false,
}: {
  variant: Variant;
  size?: number;
  decorative?: boolean;
}) {
  const ink = variant === "on-ink";
  const line = ink ? "fill-bar-text stroke-bar-text" : "fill-primary stroke-primary";
  const margin = ink ? "fill-bar-stamp" : "fill-stamp";
  const small = size <= 32;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Talaan" })}
    >
      <rect x="6" y="10" width="52" height="5" rx="2" className={`${line} stroke-0`} />
      <rect x="19" y="10" width="5" height="46" rx="2" className={margin} />
      <path
        d={small ? "M31 30H55 M31 44H47" : "M31 27H55 M31 37H55 M31 47H45"}
        className={`${line} fill-none`}
        strokeWidth={small ? 5 : 3.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ variant, size = 32 }: { variant: Variant; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Logo variant={variant} size={size} decorative />
      <span
        className={`text-bar-title ${variant === "on-ink" ? "text-bar-text" : "text-primary"}`}
      >
        Talaan
      </span>
    </span>
  );
}
