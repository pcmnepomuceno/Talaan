import type { ReactNode } from "react";
import { Icon } from "./icon";

// DESIGN.md 6.11. `action` is a Button supplied by the caller.
export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="text-text-muted">
        <Icon name="description" size={48} />
      </span>
      <h2 className="text-section-title text-text-primary">{title}</h2>
      <p className="text-caption text-text-muted">{message}</p>
      {action}
    </div>
  );
}
