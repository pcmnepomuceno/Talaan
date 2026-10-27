"use client";

import { useId, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";
const options: Theme[] = ["light", "dark", "system"];
const label: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };
const listeners = new Set<() => void>();

function read(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

function apply(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// Fires only in the other tabs of this origin, so a change in one tab reaches the rest.
// key null means localStorage.clear().
function onStorage(e: StorageEvent) {
  if (e.key !== "theme" && e.key !== null) return;
  apply(e.newValue === "light" || e.newValue === "dark" ? e.newValue : "system");
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", onStorage); // same function twice is a no-op
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function write(t: Theme) {
  apply(t);
  try {
    if (t === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", t);
  } catch {}
  listeners.forEach((l) => l());
}

export function ThemeToggle() {
  // Server snapshot is "system" so hydration matches; the client re-reads the real value after.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  // Unique per instance: a shared name would merge two toggles on one page into one radio group.
  const name = useId();
  return (
    <fieldset className="flex h-11 w-fit gap-1 rounded-sm border border-border-subtle bg-surface-subtle p-1">
      <legend className="sr-only">Theme</legend>
      {options.map((o) => (
        <label
          key={o}
          className="flex cursor-pointer items-center rounded-xs px-4 text-body-medium text-text-secondary has-checked:bg-primary has-checked:text-text-inverse has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
        >
          <input
            type="radio"
            name={name}
            value={o}
            checked={theme === o}
            onChange={() => write(o)}
            className="sr-only"
          />
          {label[o]}
        </label>
      ))}
    </fieldset>
  );
}
