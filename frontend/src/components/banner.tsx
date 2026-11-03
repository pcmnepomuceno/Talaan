import type { ReactNode } from "react";
import { Icon } from "./icon";

// DESIGN.md 6.10, inline error banner. role="alert" announces it when it appears.
export function Banner({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex gap-3 rounded-sm border border-error-border bg-error-bg p-4 text-error-text">
      <Icon name="error" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body font-semibold">{title}</p>
        {children && <div className="text-caption">{children}</div>}
      </div>
    </div>
  );
}
