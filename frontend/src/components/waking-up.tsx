"use client";

import { useEffect, useState } from "react";

// DESIGN.md 6.12 (slow start note). The free-tier API can take a minute to wake (19 s measured), so a
// request that is still pending after WAKE_MS explains itself. The paragraph is always mounted: a live
// region that arrives together with its text is often not announced.
export const WAKE_MS = 3000;
const MESSAGE = "Starting up. This can take up to a minute the first time.";

export function WakingUp({ pending }: { pending: boolean }) {
  const [late, setLate] = useState(false);
  if (!pending && late) setLate(false); // settled: drop it in the same render, never a stale frame
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setLate(true), WAKE_MS);
    return () => clearTimeout(t);
  }, [pending]);
  const show = pending && late;
  return (
    <p aria-live="polite" className={show ? "mt-3 text-caption text-text-muted" : "sr-only"}>
      {show ? MESSAGE : ""}
    </p>
  );
}
