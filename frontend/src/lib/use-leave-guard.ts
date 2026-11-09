"use client";

import { useEffect } from "react";
import { isLeavingForLogin } from "./http";

/** Reload and tab close only: registered while `active` (there is something to lose), removed when it ends and on unmount. */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (isLeavingForLogin()) return; // a 401 redirect: prompting could strand the form on "Saving…"
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
