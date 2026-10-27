"use client";

import { useSyncExternalStore } from "react";
import { SegmentedControl } from "./segmented-control";

type Theme = "light" | "dark" | "system";
const options = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;
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
  return (
    <SegmentedControl label="Theme" hideLabel options={options} value={theme} onChange={write} className="w-fit" />
  );
}
